'use strict';
/**
 * Akwaaba Mall - backend (zero npm dependencies).
 * Node >= 22.13 (uses built-in node:sqlite). Serves the PWA from ./public and the JSON API under /api.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const seed = require('./seed');

// ------------------------------------------------------------------ config
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PAYSTACK_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const LIVE_PAYMENTS = !!PAYSTACK_KEY;
const AUTO_TRACK = (process.env.AUTO_TRACK ?? (LIVE_PAYMENTS ? '0' : '1')) === '1'; // demo: auto-advance orders
const MALL = {
  name: process.env.MALL_NAME || 'Akwaaba Mall',
  currency: 'GHS',
  freeDeliveryOver: 300,
  coldChainFee: 5,
  pickupAddress: process.env.PICKUP_ADDRESS || 'Akwaaba Mall pickup desk',
  zones: { // delivery fee in GHS by region + ETA text
    'Northern': { fee: 15, eta: 'Same day if ordered before 4pm, otherwise next day' },
    'Greater Accra': { fee: 20, eta: 'Same day if ordered before 4pm, otherwise next day' },
    'Ashanti': { fee: 20, eta: 'Within 1-2 days' },
    'Savannah': { fee: 25, eta: 'Within 1-2 days' },
    'North East': { fee: 25, eta: 'Within 1-2 days' },
    'Upper East': { fee: 30, eta: 'Within 2-3 days' },
    'Upper West': { fee: 30, eta: 'Within 2-3 days' },
    'Bono': { fee: 30, eta: 'Within 2-3 days' },
    'Bono East': { fee: 30, eta: 'Within 2-3 days' },
    'Ahafo': { fee: 30, eta: 'Within 2-3 days' },
    'Eastern': { fee: 30, eta: 'Within 2-3 days' },
    'Central': { fee: 30, eta: 'Within 2-3 days' },
    'Western': { fee: 35, eta: 'Within 2-4 days' },
    'Western North': { fee: 35, eta: 'Within 2-4 days' },
    'Volta': { fee: 35, eta: 'Within 2-4 days' },
    'Oti': { fee: 35, eta: 'Within 2-4 days' },
  },
};
const PAY_METHODS = ['momo_mtn', 'momo_telecel', 'momo_airteltigo', 'card', 'cod'];
const STATUS_LABEL = {
  awaiting_payment: 'Awaiting payment', confirmed: 'Order confirmed', packing: 'Packing your items',
  dispatched: 'Dispatched', out_for_delivery: 'Out for delivery', delivered: 'Delivered',
  ready_for_pickup: 'Ready for pickup', collected: 'Collected', cancelled: 'Cancelled',
};
const FLOW_DELIVERY = ['confirmed', 'packing', 'dispatched', 'out_for_delivery', 'delivered'];
const FLOW_PICKUP = ['confirmed', 'packing', 'ready_for_pickup', 'collected'];

// ------------------------------------------------------------------ database
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'mall.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS stores (id TEXT PRIMARY KEY, name TEXT, tagline TEXT, emoji TEXT, color TEXT, side TEXT, sort INTEGER);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL REFERENCES stores(id), aisle TEXT NOT NULL,
  name TEXT NOT NULL, unit TEXT, price_p INTEGER NOT NULL, stock INTEGER NOT NULL DEFAULT 0,
  emoji TEXT, cold INTEGER DEFAULT 0, adult INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tracking TEXT NOT NULL UNIQUE, user_id INTEGER,
  name TEXT, phone TEXT, region TEXT, town TEXT, address TEXT, gps TEXT, landmark TEXT, note TEXT,
  delivery_method TEXT, payment_method TEXT, payment_status TEXT, status TEXT,
  subtotal_p INTEGER, delivery_p INTEGER, cold_p INTEGER, total_p INTEGER, has_cold INTEGER, eta TEXT,
  manual INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER, name TEXT, emoji TEXT, unit TEXT, qty INTEGER, price_p INTEGER, cold INTEGER);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id),
  status TEXT, note TEXT, location TEXT, at INTEGER);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id),
  provider TEXT, method TEXT, reference TEXT, status TEXT, amount_p INTEGER, created_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);
`);

for (const s of seed.stores) db.prepare('UPDATE stores SET color=? WHERE id=?').run(s.color, s.id); // keep awning colours in sync
if (!db.prepare('PRAGMA table_info(products)').all().some((c) => c.name === 'image')) db.exec('ALTER TABLE products ADD COLUMN image TEXT');

if (db.prepare('SELECT COUNT(*) AS n FROM stores').get().n === 0) {
  const s1 = db.prepare('INSERT INTO stores (id,name,tagline,emoji,color,side,sort) VALUES (?,?,?,?,?,?,?)');
  const s2 = db.prepare('INSERT INTO products (store_id,aisle,name,unit,price_p,stock,emoji,cold,adult) VALUES (?,?,?,?,?,?,?,?,?)');
  db.exec('BEGIN');
  seed.stores.forEach((s, i) => s1.run(s.id, s.name, s.tagline, s.emoji, s.color, s.side, i));
  seed.products.forEach((p) => s2.run(p.store, p.aisle, p.name, p.unit, p.price_p, p.stock, p.emoji, p.cold, p.adult));
  db.exec('COMMIT');
  console.log(`Seeded ${seed.stores.length} stores and ${seed.products.length} products.`);
}

// admin key: env var, or generated once and kept in data/admin-key.txt
let ADMIN_KEY = process.env.ADMIN_KEY || '';
if (!ADMIN_KEY) {
  const f = path.join(DATA_DIR, 'admin-key.txt');
  if (fs.existsSync(f)) ADMIN_KEY = fs.readFileSync(f, 'utf8').trim();
  else { ADMIN_KEY = crypto.randomBytes(9).toString('base64url'); fs.writeFileSync(f, ADMIN_KEY + '\n', { mode: 0o600 }); }
}

// ------------------------------------------------------------------ helpers
const now = () => Date.now();
const GHS = (p) => p / 100;
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (msg, code = 400) => new HttpError(code, msg);
const clean = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const cleanImg = (v) => { v = clean(v, 300); return v === '' || /^https:\/\/\S+$/.test(v) || /^\/[\w\-./]+$/.test(v) ? v : null; };
const normPhone = (p) => {
  let d = String(p || '').replace(/[\s\-()]/g, '');
  if (d.startsWith('+233')) d = '0' + d.slice(4); else if (d.startsWith('233')) d = '0' + d.slice(3);
  return /^0[235][0-9]{8}$/.test(d) ? d : null; // Ghana mobile numbers
};
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const productOut = (r) => ({ id: r.id, store: r.store_id, aisle: r.aisle, name: r.name, unit: r.unit, price: GHS(r.price_p), stock: r.stock, emoji: r.emoji, image: r.image || '', cold: !!r.cold, adult: !!r.adult });

function newTracking() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    const b = crypto.randomBytes(8); let s = '';
    for (let i = 0; i < 8; i++) s += A[b[i] % A.length];
    const t = `AKW-${s.slice(0, 4)}-${s.slice(4)}`;
    if (!db.prepare('SELECT 1 FROM orders WHERE tracking=?').get(t)) return t;
  }
}
function addEvent(orderId, status, note, location) {
  db.prepare('INSERT INTO order_events (order_id,status,note,location,at) VALUES (?,?,?,?,?)').run(orderId, status, note || '', location || '', now());
}
function setStatus(order, status, note, location, manual) {
  db.prepare('UPDATE orders SET status=?, manual=CASE WHEN ? THEN 1 ELSE manual END WHERE id=?').run(status, manual ? 1 : 0, order.id);
  addEvent(order.id, status, note || STATUS_LABEL[status], location);
}

function getUser(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const row = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(sha(m[1]));
  return row || null;
}
function requireAdmin(req) {
  if (!safeEq(req.headers['x-admin-key'] || '', ADMIN_KEY)) throw bad('Admin key required', 401);
}
const hits = new Map(); // tiny in-memory rate limiter
function limit(req, key, max, windowMs) {
  const ip = req.socket.remoteAddress || '?'; const k = key + ip; const t = now();
  const arr = (hits.get(k) || []).filter((x) => t - x < windowMs);
  if (arr.length >= max) throw bad('Too many attempts, please wait a few minutes.', 429);
  arr.push(t); hits.set(k, arr);
}

// ------------------------------------------------------------------ order logic
function quote(items, region, method) {
  const merged = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const id = Number(it?.id), qty = Math.floor(Number(it?.qty));
    if (!Number.isInteger(id) || !(qty >= 1)) continue;
    merged.set(id, Math.min(99, (merged.get(id) || 0) + qty));
  }
  if (!merged.size) throw bad('Your cart is empty.');
  if (merged.size > 60) throw bad('Too many different items in one order.');
  const lines = []; let subtotal = 0, hasCold = false, hasAdult = false;
  for (const [id, qty] of merged) {
    const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id);
    if (!p) throw bad('One of the items is no longer available.');
    if (p.stock < qty) throw bad(p.stock > 0 ? `Only ${p.stock} left of ${p.name}.` : `${p.name} is out of stock.`, 409);
    lines.push({ p, qty }); subtotal += p.price_p * qty; hasCold ||= !!p.cold; hasAdult ||= !!p.adult;
  }
  let delivery = 0, cold = 0, eta = '';
  if (method === 'pickup') eta = 'Ready for pickup in about 30-45 minutes';
  else {
    const z = MALL.zones[region]; if (!z) throw bad('Please choose a delivery region.');
    delivery = subtotal >= MALL.freeDeliveryOver * 100 ? 0 : z.fee * 100;
    if (hasCold) cold = MALL.coldChainFee * 100;
    eta = z.eta;
  }
  return { lines, subtotal, delivery, cold, total: subtotal + delivery + cold, hasCold, hasAdult, eta };
}

function createOrder(b, user) {
  const method = b.delivery_method === 'pickup' ? 'pickup' : 'delivery';
  const pay = PAY_METHODS.includes(b.payment_method) ? b.payment_method : null;
  if (!pay) throw bad('Please choose a payment method.');
  const name = clean(b.name, 80), phone = normPhone(b.phone);
  if (name.length < 2) throw bad('Please enter your name.');
  if (!phone) throw bad('Enter a valid Ghana mobile number, e.g. 0244123456.');
  const region = clean(b.region, 40), town = clean(b.town, 80), address = clean(b.address, 200);
  if (method === 'delivery' && (!region || town.length < 2 || address.length < 3)) throw bad('Please complete your delivery address.');
  const gps = clean(b.gps, 20).toUpperCase();
  if (gps && !/^[A-Z]{2,3}-?\d{3,4}-?\d{4}$/.test(gps)) throw bad('GhanaPost GPS looks like GA-123-4567.');
  const q = quote(b.items, region, method);
  if (q.hasAdult && !b.age_confirmed) throw bad('Please confirm you are 18+ to buy beer.');
  const tracking = newTracking();
  const paid = pay === 'cod' ? 'pay_on_delivery' : 'unpaid';
  let orderId;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const { p, qty } of q.lines) { // re-check stock atomically
      const r = db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?').run(qty, p.id, qty);
      if (!r.changes) throw bad(`${p.name} just sold out.`, 409);
    }
    orderId = Number(db.prepare(`INSERT INTO orders (tracking,user_id,name,phone,region,town,address,gps,landmark,note,delivery_method,payment_method,
      payment_status,status,subtotal_p,delivery_p,cold_p,total_p,has_cold,eta,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(tracking, user?.id ?? null, name, phone, region, town, address, gps, clean(b.landmark, 120), clean(b.note, 200), method, pay, paid,
        'awaiting_payment', q.subtotal, q.delivery, q.cold, q.total, q.hasCold ? 1 : 0, q.eta, now()).lastInsertRowid);
    const ins = db.prepare('INSERT INTO order_items (order_id,product_id,name,emoji,unit,qty,price_p,cold) VALUES (?,?,?,?,?,?,?,?)');
    for (const { p, qty } of q.lines) ins.run(orderId, p.id, p.name, p.emoji, p.unit, qty, p.price_p, p.cold);
    addEvent(orderId, 'placed', 'Order received', MALL.name);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (pay === 'cod') setStatus(order, 'confirmed', 'Order confirmed - pay on delivery/pickup', MALL.name);
  return order;
}

function markPaid(order, provider, reference, method) {
  if (order.payment_status === 'paid') return;
  db.prepare("UPDATE orders SET payment_status='paid' WHERE id=?").run(order.id);
  db.prepare('INSERT INTO payments (order_id,provider,method,reference,status,amount_p,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(order.id, provider, method, reference, 'success', order.total_p, now());
  if (order.status === 'awaiting_payment') setStatus(order, 'confirmed', `Payment received (${provider}). Order confirmed`, MALL.name);
}

function cancelOrder(order, note) {
  const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id=?').all(order.id);
  db.exec('BEGIN');
  try {
    for (const it of items) db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(it.qty, it.product_id);
    db.prepare("UPDATE orders SET status='cancelled', manual=1 WHERE id=?").run(order.id);
    addEvent(order.id, 'cancelled', note || 'Order cancelled', '');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function orderOut(o, full) {
  const items = db.prepare('SELECT name,emoji,unit,qty,price_p,cold FROM order_items WHERE order_id=?').all(o.id)
    .map((i) => ({ name: i.name, emoji: i.emoji, unit: i.unit, qty: i.qty, price: GHS(i.price_p), cold: !!i.cold }));
  const events = db.prepare('SELECT status,note,location,at FROM order_events WHERE order_id=? ORDER BY at, id').all(o.id);
  const flow = o.delivery_method === 'pickup' ? FLOW_PICKUP : FLOW_DELIVERY;
  const out = {
    tracking: o.tracking, status: o.status, statusLabel: STATUS_LABEL[o.status] || o.status,
    deliveryMethod: o.delivery_method, paymentMethod: o.payment_method, paymentStatus: o.payment_status,
    region: o.region, town: o.town, eta: o.eta, hasCold: !!o.has_cold,
    subtotal: GHS(o.subtotal_p), delivery: GHS(o.delivery_p), coldFee: GHS(o.cold_p), total: GHS(o.total_p),
    createdAt: o.created_at, firstName: (o.name || '').split(' ')[0], items, events, flow,
    flowLabels: flow.map((s) => STATUS_LABEL[s]),
  };
  if (full) Object.assign(out, { name: o.name, phone: o.phone, address: o.address, gps: o.gps, landmark: o.landmark, note: o.note });
  return out;
}

// ---- live payments (Paystack hosted page: supports MoMo + card). Demo mode is used when no key is set.
async function paystack(pathname, method, body) {
  const r = await fetch('https://api.paystack.co' + pathname, {
    method, headers: { Authorization: `Bearer ${PAYSTACK_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.status) throw bad(j.message || 'Payment provider error', 502);
  return j.data;
}
async function verifyLive(order) {
  const pay = db.prepare("SELECT * FROM payments WHERE order_id=? AND status='initiated' ORDER BY id DESC").get(order.id);
  if (!pay) return;
  const d = await paystack('/transaction/verify/' + encodeURIComponent(pay.reference), 'GET');
  if (d.status === 'success' && d.amount >= order.total_p && d.currency === 'GHS') {
    db.prepare("UPDATE payments SET status='success' WHERE id=?").run(pay.id);
    const fresh = db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
    db.prepare("UPDATE orders SET payment_status='unpaid' WHERE id=?").run(order.id); // let markPaid record it
    markPaid({ ...fresh, payment_status: 'unpaid' }, 'Paystack', pay.reference, order.payment_method);
    db.prepare('DELETE FROM payments WHERE id=?').run(pay.id);
  }
}

// ------------------------------------------------------------------ routes
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

route('GET', '/api/health', () => ({ ok: true, live: LIVE_PAYMENTS }));
route('GET', '/api/config', () => ({
  mall: MALL.name, currency: 'GHS', freeDeliveryOver: MALL.freeDeliveryOver, coldChainFee: MALL.coldChainFee,
  zones: Object.fromEntries(Object.entries(MALL.zones).map(([k, v]) => [k, v])), pickupAddress: MALL.pickupAddress,
  livePayments: LIVE_PAYMENTS, payMethods: PAY_METHODS,
}));
route('GET', '/api/catalog', () => ({
  stores: db.prepare('SELECT * FROM stores ORDER BY sort').all().map((s) => ({ id: s.id, name: s.name, tagline: s.tagline, emoji: s.emoji, color: s.color, side: s.side })),
  products: db.prepare('SELECT * FROM products WHERE active=1 ORDER BY id').all().map(productOut),
}));

route('POST', '/api/register', ({ req, body }) => {
  limit(req, 'reg', 10, 15 * 60e3);
  const name = clean(body.name, 80), phone = normPhone(body.phone), pw = String(body.password || '');
  if (name.length < 2) throw bad('Please enter your name.');
  if (!phone) throw bad('Enter a valid Ghana mobile number.');
  if (pw.length < 6) throw bad('Password must be at least 6 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE phone=?').get(phone)) throw bad('That phone number already has an account. Please log in.', 409);
  const salt = crypto.randomBytes(16).toString('hex');
  const id = Number(db.prepare('INSERT INTO users (name,phone,pass_hash,salt) VALUES (?,?,?,?)').run(name, phone, hashPw(pw, salt), salt).lastInsertRowid);
  return session(id, name, phone);
});
route('POST', '/api/login', ({ req, body }) => {
  limit(req, 'login', 15, 15 * 60e3);
  const phone = normPhone(body.phone); const u = phone && db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (!u || !safeEq(hashPw(String(body.password || ''), u.salt), u.pass_hash)) throw bad('Wrong phone number or password.', 401);
  return session(u.id, u.name, u.phone);
});
function session(id, name, phone) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash,user_id,created_at) VALUES (?,?,?)').run(sha(token), id, now());
  return { token, user: { id, name, phone } };
}
route('GET', '/api/me', ({ user }) => { if (!user) throw bad('Not logged in', 401); return { user: { id: user.id, name: user.name, phone: user.phone } }; });
route('POST', '/api/logout', ({ req }) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); if (m) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(m[1])); return { ok: true };
});

route('POST', '/api/quote', ({ body }) => {
  const q = quote(body.items, clean(body.region, 40), body.delivery_method === 'pickup' ? 'pickup' : 'delivery');
  return { subtotal: GHS(q.subtotal), delivery: GHS(q.delivery), coldFee: GHS(q.cold), total: GHS(q.total), eta: q.eta, hasAdult: q.hasAdult, hasCold: q.hasCold };
});

route('POST', '/api/orders', ({ req, body, user }) => {
  limit(req, 'order', 30, 15 * 60e3);
  const o = createOrder(body, user);
  return { order: orderOut(o, true), needsPayment: o.payment_method !== 'cod', livePayments: LIVE_PAYMENTS };
});

// Start payment. Demo mode: simulates a MoMo approval. Live mode: returns Paystack checkout URL.
route('POST', '/api/orders/:tracking/pay', async ({ params, body }) => {
  const o = db.prepare('SELECT * FROM orders WHERE tracking=?').get(params.tracking);
  if (!o) throw bad('Order not found', 404);
  if (o.payment_status === 'paid') return { order: orderOut(o), paid: true };
  if (o.status === 'cancelled') throw bad('This order was cancelled. Please place a new order.', 409);
  if (o.payment_method === 'cod') throw bad('This order is pay-on-delivery.');
  if (LIVE_PAYMENTS) {
    const reference = `${o.tracking}-${crypto.randomBytes(4).toString('hex')}`;
    const d = await paystack('/transaction/initialize', 'POST', {
      email: `${o.phone}@customers.akwaabamall.example`, amount: o.total_p, currency: 'GHS', reference,
      callback_url: `${PUBLIC_URL}/#/track/${o.tracking}`, channels: ['mobile_money', 'card'], metadata: { tracking: o.tracking },
    });
    db.prepare('INSERT INTO payments (order_id,provider,method,reference,status,amount_p,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(o.id, 'Paystack', o.payment_method, reference, 'initiated', o.total_p, now());
    return { redirect: d.authorization_url };
  }
  // ---- DEMO: no real money moves
  if (o.payment_method.startsWith('momo_')) {
    if (!normPhone(body.momo_number)) throw bad('Enter the Mobile Money number to charge, e.g. 0244123456.');
  }
  markPaid(o, 'DEMO', 'DEMO-' + crypto.randomBytes(4).toString('hex'), o.payment_method);
  return { order: orderOut(db.prepare('SELECT * FROM orders WHERE id=?').get(o.id)), paid: true, demo: true };
});

route('GET', '/api/track/:tracking', async ({ params }) => {
  const t = params.tracking.toUpperCase();
  let o = db.prepare('SELECT * FROM orders WHERE tracking=?').get(t);
  if (!o) throw bad('No order found with that tracking number.', 404);
  if (LIVE_PAYMENTS && o.payment_status === 'unpaid') { try { await verifyLive(o); } catch { /* ignore */ } o = db.prepare('SELECT * FROM orders WHERE id=?').get(o.id); }
  return { order: orderOut(o) };
});
route('POST', '/api/orders/:tracking/cancel', ({ params, user }) => {
  const o = db.prepare('SELECT * FROM orders WHERE tracking=?').get(params.tracking);
  if (!o) throw bad('Order not found', 404);
  if (!user || o.user_id !== user.id) throw bad('Please log in to the account that placed this order.', 401);
  if (!['awaiting_payment', 'confirmed'].includes(o.status)) throw bad('This order is already being prepared and cannot be cancelled.', 409);
  cancelOrder(o, 'Cancelled by customer');
  return { order: orderOut(db.prepare('SELECT * FROM orders WHERE id=?').get(o.id)) };
});
route('GET', '/api/my/orders', ({ user }) => {
  if (!user) throw bad('Please log in.', 401);
  return { orders: db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 50').all(user.id).map((o) => orderOut(o)) };
});

// ---- admin
route('GET', '/api/admin/orders', ({ req, query }) => {
  requireAdmin(req);
  const st = clean(query.get('status'), 30);
  const rows = st ? db.prepare('SELECT * FROM orders WHERE status=? ORDER BY id DESC LIMIT 200').all(st) : db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 200').all();
  return { orders: rows.map((o) => orderOut(o, true)), statuses: STATUS_LABEL };
});
route('POST', '/api/admin/orders/:tracking/status', ({ req, params, body }) => {
  requireAdmin(req);
  const o = db.prepare('SELECT * FROM orders WHERE tracking=?').get(params.tracking);
  if (!o) throw bad('Order not found', 404);
  const st = clean(body.status, 30);
  if (!STATUS_LABEL[st] || st === 'awaiting_payment') throw bad('Unknown status');
  if (st === 'cancelled') { if (o.status !== 'cancelled') cancelOrder(o, clean(body.note, 200) || 'Cancelled'); }
  else {
    setStatus(o, st, clean(body.note, 200) || STATUS_LABEL[st], clean(body.location, 100), true);
    if (['delivered', 'collected'].includes(st) && o.payment_status === 'pay_on_delivery') db.prepare("UPDATE orders SET payment_status='paid' WHERE id=?").run(o.id);
  }
  return { order: orderOut(db.prepare('SELECT * FROM orders WHERE id=?').get(o.id), true) };
});
route('GET', '/api/admin/products', ({ req }) => { requireAdmin(req); return { products: db.prepare('SELECT * FROM products ORDER BY store_id, aisle, name').all().map((r) => ({ ...productOut(r), active: !!r.active })) }; });
route('PATCH', '/api/admin/products/:id', ({ req, params, body }) => {
  requireAdmin(req);
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(Number(params.id));
  if (!p) throw bad('Product not found', 404);
  const price = body.price !== undefined ? Math.round(Number(body.price) * 100) : p.price_p;
  const stock = body.stock !== undefined ? Math.floor(Number(body.stock)) : p.stock;
  const active = body.active !== undefined ? (body.active ? 1 : 0) : p.active;
  if (!(price >= 0) || !(stock >= 0)) throw bad('Invalid price or stock');
  const image = body.image !== undefined ? cleanImg(body.image) : (p.image || '');
  if (image === null) throw bad('Image must be an https:// link');
  db.prepare('UPDATE products SET price_p=?, stock=?, active=?, image=? WHERE id=?').run(price, stock, active, image, p.id);
  return { product: productOut(db.prepare('SELECT * FROM products WHERE id=?').get(p.id)) };
});
route('POST', '/api/admin/products', ({ req, body }) => {
  requireAdmin(req);
  const store = clean(body.store, 20), name = clean(body.name, 100), aisle = clean(body.aisle, 60);
  if (!db.prepare('SELECT 1 FROM stores WHERE id=?').get(store) || !name || !aisle) throw bad('store, aisle and name are required');
  const price = Math.round(Number(body.price) * 100), stock = Math.floor(Number(body.stock || 0));
  if (!(price >= 0) || !(stock >= 0)) throw bad('Invalid price or stock');
  const id = Number(db.prepare('INSERT INTO products (store_id,aisle,name,unit,price_p,stock,emoji,cold,adult,image) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(store, aisle, name, clean(body.unit, 20) || 'each', price, stock, clean(body.emoji, 8) || '🛒', body.cold ? 1 : 0, body.adult ? 1 : 0, cleanImg(body.image) || '').lastInsertRowid);
  return { product: productOut(db.prepare('SELECT * FROM products WHERE id=?').get(id)) };
});

// ------------------------------------------------------------------ http server
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'",
};
function send(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC });
  res.end(s);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 200_000) { reject(bad('Request too large', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    const noCache = ['sw.js', 'index.html', 'manifest.webmanifest'].includes(path.basename(file));
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': noCache ? 'no-cache' : 'public, max-age=86400', ...SEC });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) {
        if (routes.some((x) => x.re.test(url.pathname))) throw bad('Method not allowed', 405);
        throw bad('Not found', 404);
      }
      const params = r.re.exec(url.pathname).groups || {};
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {};
      const out = await r.handler({ req, params, body, query: url.searchParams, user: getUser(req) });
      return send(res, 200, out);
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    console.error(e); send(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
});

// ------------------------------------------------------------------ background jobs
setInterval(() => { // release stock held by unpaid online-payment orders after 30 minutes
  const stale = db.prepare("SELECT * FROM orders WHERE status='awaiting_payment' AND created_at < ?").all(now() - 30 * 60e3);
  for (const o of stale) { try { cancelOrder(o, 'Cancelled - payment not completed in 30 minutes'); } catch (e) { console.error(e); } }
}, 5 * 60e3).unref();

if (AUTO_TRACK) setInterval(() => { // DEMO: move orders along so you can watch tracking work
  const rows = db.prepare("SELECT * FROM orders WHERE manual=0 AND status IN ('confirmed','packing','dispatched','out_for_delivery','ready_for_pickup') AND payment_status IN ('paid','pay_on_delivery')").all();
  const where = { packing: 'Packing area', dispatched: `${MALL.name} dispatch bay`, out_for_delivery: 'On the road to you', ready_for_pickup: MALL.pickupAddress, delivered: 'Delivered', collected: 'Collected' };
  for (const o of rows) {
    const last = db.prepare('SELECT at FROM order_events WHERE order_id=? ORDER BY id DESC LIMIT 1').get(o.id);
    if (now() - last.at < 40e3) continue;
    const flow = o.delivery_method === 'pickup' ? FLOW_PICKUP : FLOW_DELIVERY;
    const next = flow[flow.indexOf(o.status) + 1]; if (!next) continue;
    let note = STATUS_LABEL[next];
    if (next === 'packing' && o.has_cold) note = 'Packing your items - cold items are packed last in an insulated cooler bag';
    setStatus(o, next, note, where[next], false);
    if (['delivered', 'collected'].includes(next) && o.payment_status === 'pay_on_delivery') db.prepare("UPDATE orders SET payment_status='paid' WHERE id=?").run(o.id);
  }
}, 20e3).unref();

server.listen(PORT, () => {
  console.log(`\n${MALL.name} running at ${PUBLIC_URL}`);
  console.log(`Payments: ${LIVE_PAYMENTS ? 'LIVE (Paystack)' : 'DEMO mode (no real money moves). Set PAYSTACK_SECRET_KEY for live payments.'}`);
  console.log(`Auto order tracking demo: ${AUTO_TRACK ? 'ON (AUTO_TRACK=0 to disable)' : 'off'}`);
  console.log(`Admin page: ${PUBLIC_URL}/#/admin   key: ${ADMIN_KEY}\n`);
});
