(() => {
'use strict';
/* ==========================================================================
   Akwaaba Mall - single-page app (vanilla JS, no build step)
   Sections: helpers · state/api · cart · product card + sheet · router/chrome ·
   views (mall, stores, store, search, cart, checkout, pay, done, track, account, admin)
   ========================================================================== */

/* ============ helpers ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const money = (n) => 'GH₵' + Number(n || 0).toFixed(2);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };
const fmtTime = (t) => new Date(t).toLocaleString('en-GH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));

const I = {
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', back: '<path d="M15 6l-6 6 6 6"/>', chev: '<path d="m9 6 6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="m5 12 5 5L20 7"/>', up: '<path d="M12 19V5M5 12l7-7 7 7"/>', down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a1 1 0 0 0 1 .8h9.3a1 1 0 0 0 1-.8L20.5 8H6"/>',
  truck: '<path d="M1 6h13v10H1zM14 10h4l4 3v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  snow: '<path d="M12 2v20M4.2 7l15.6 10M4.2 17 19.8 7"/>', phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>', cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  shop: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9"/><path d="M5 12v8h14v-8"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>', pin: '<path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
};
const ic = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[n]}</svg>`;
const priceHTML = (n) => { const [w, d] = Number(n).toFixed(2).split('.'); return `<span class="price"><small>GH₵</small>${w}${d === '00' ? '' : `<i>.${d}</i>`}</span>`; };

const PAY = {
  momo_mtn: ['<span class="mark mtn">MTN</span>', 'MTN MoMo', 'Approve on your phone'],
  momo_telecel: ['<span class="mark tel">Tel</span>', 'Telecel Cash', 'Approve on your phone'],
  momo_airteltigo: ['<span class="mark atl">AT</span>', 'AirtelTigo Money', 'Approve on your phone'],
  card: [`<span class="mark">${ic('card')}</span>`, 'Card', 'Visa or Mastercard'],
  cod: [`<span class="mark">${ic('cash')}</span>`, 'Pay on delivery', 'Cash or MoMo when it arrives'],
};
const FAV = ['Sachet Water', 'Local Rice', 'Tilapia', 'Eggs (crate', 'Coca-Cola 50cl', 'Vegetable Oil', 'Whole Frozen Chicken', 'Sugar Bread', 'Tomatoes', 'Milo 400g'];
const SUGGEST = ['Water', 'Rice', 'Tilapia', 'Eggs', 'Gari', 'Milo', 'Tomatoes', 'Bread'];

/* ============ state + api ============ */
const state = {
  config: null, stores: [], storeMap: new Map(), products: [], byId: new Map(),
  cart: load('akw_cart', {}), token: localStorage.getItem('akw_token'), user: load('akw_user', null),
  last: load('akw_last', {}), trks: load('akw_trks', []), recents: load('akw_recent', []), mallRow: null,
};
const S = (id) => state.storeMap.get(id);
const view = $('#view'), qInput = $('#q');
let pollTimer = null, cleanup = null, viewActs = {}, hooks = {};

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  let res;
  try { res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new Error('No internet connection. Check your network and try again.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Something went wrong'); e.status = res.status; throw e; }
  return data;
}
function toast(msg, ms = 2400) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms);
}

/* ============ catalog + cart ============ */
async function loadCatalog() {
  const [cfg, cat] = await Promise.all([api('/api/config'), api('/api/catalog')]);
  state.config = cfg; state.stores = cat.stores; state.products = cat.products;
  state.storeMap = new Map(cat.stores.map((s) => [s.id, s])); state.byId = new Map(cat.products.map((p) => [p.id, p]));
  $('#brandName').textContent = cfg.mall; document.title = cfg.mall;
  for (const id of Object.keys(state.cart)) {
    const p = state.byId.get(Number(id));
    if (!p || p.stock < 1) delete state.cart[id]; else state.cart[id] = Math.min(state.cart[id], p.stock);
  }
  save('akw_cart', state.cart);
}
const cartCount = () => Object.values(state.cart).reduce((a, b) => a + b, 0);
const cartSubtotal = () => Object.entries(state.cart).reduce((s, [id, q]) => s + (state.byId.get(Number(id))?.price || 0) * q, 0);
const cartItems = () => Object.entries(state.cart).map(([id, qty]) => ({ p: state.byId.get(Number(id)), qty })).filter((x) => x.p);
function setQty(id, qty) {
  const p = state.byId.get(id); if (!p) return;
  qty = Math.max(0, Math.min(qty, p.stock, 99));
  if (qty === 0) delete state.cart[id]; else state.cart[id] = qty;
  save('akw_cart', state.cart);
}

/* ============ product card + sheet ============ */
const artInner = (p) => (p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="em" aria-hidden="true">${esc(p.emoji)}</span>`);
const badgesHTML = (p) => `<span class="badges">${p.cold ? '<span class="badge">Chilled</span>' : ''}${p.adult ? '<span class="badge adult">18+</span>' : ''}${p.stock > 0 && p.stock <= 5 ? `<span class="badge low">${p.stock} left</span>` : ''}</span>`;
function ctl(p) {
  if (p.stock < 1) return '<span class="oos">Sold out</span>';
  const n = state.cart[p.id] || 0;
  if (!n) return `<button class="add" data-act="add" data-id="${p.id}" aria-label="Add ${esc(p.name)} to cart">${ic('plus')}</button>`;
  return `<div class="stepper"><button data-act="dec" data-id="${p.id}" aria-label="Remove one ${esc(p.name)}">${ic('minus')}</button><b aria-live="polite">${n}</b><button data-act="inc" data-id="${p.id}" aria-label="Add one ${esc(p.name)}">${ic('plus')}</button></div>`;
}
function card(p, o = {}) {
  const s = S(p.store);
  return `<article class="p ${p.stock < 1 ? 'out' : ''}" data-pid="${p.id}" style="--c:${s.color}">
    <button class="art" data-act="open" data-id="${p.id}" aria-label="View ${esc(p.name)}">${badgesHTML(p)}${artInner(p)}</button>
    <div class="p-body"><button class="p-name" data-act="open" data-id="${p.id}">${esc(p.name)}</button>
      <div class="p-unit">${o.store ? esc(s.name) : 'per ' + esc(p.unit)}</div>
      <div class="p-row">${priceHTML(p.price)}<div class="ctl">${ctl(p)}</div></div></div></article>`;
}
function sheetAct(p) {
  if (p.stock < 1) return '<span class="oos">Sold out</span>';
  const n = state.cart[p.id] || 0;
  if (!n) return `<button class="btn sun" data-act="add" data-id="${p.id}">Add to cart</button>`;
  return `<div class="stepper"><button data-act="dec" data-id="${p.id}" aria-label="Remove one">${ic('minus')}</button><b>${n}</b><button data-act="inc" data-id="${p.id}" aria-label="Add one">${ic('plus')}</button></div><a class="btn" href="#/cart" data-act="close">View cart</a>`;
}
function refreshCtl(id) {
  const p = state.byId.get(id); if (!p) return;
  $$(`[data-pid="${id}"] .ctl`).forEach((el) => { el.innerHTML = ctl(p); });
  const sh = $(`.sheet[data-pid="${id}"] #sheetAct`); if (sh) sh.innerHTML = sheetAct(p);
}
function change(id, d) {
  const p = state.byId.get(id); const cur = state.cart[id] || 0;
  if (d > 0 && cur >= p.stock) return toast(`Only ${p.stock} of ${p.name} in stock`);
  setQty(id, cur + d); refreshCtl(id); chrome();
  if (d > 0) { const b = $('#cartBar'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
  if (hooks.cart) hooks.cart();
}
let lastFocus = null;
function openSheet(id) {
  closeSheet(); const p = state.byId.get(id); if (!p) return; const s = S(p.store);
  lastFocus = document.activeElement;
  const related = state.products.filter((x) => x.store === p.store && x.aisle === p.aisle && x.id !== p.id).slice(0, 8);
  const w = document.createElement('div'); w.className = 'sheet-back'; w.id = 'sheetBack';
  w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(p.name)}" data-pid="${p.id}" style="--c:${s.color}">
    <button class="sheet-x" data-act="close" aria-label="Close">${ic('x')}</button>
    <div class="art">${badgesHTML(p)}${artInner(p)}</div>
    <div class="sheet-b"><h2 class="disp">${esc(p.name)}</h2>
      <div class="sheet-meta"><span>per ${esc(p.unit)}</span><a href="#/store/${s.id}?aisle=${enc(p.aisle)}" data-act="close">${esc(s.name)}: ${esc(p.aisle)}</a></div>
      ${priceHTML(p.price)}
      ${p.cold ? `<p class="small muted">Kept chilled. Packed last in an insulated bag.</p>` : ''}
      ${p.adult ? '<p class="small muted">You must be 18 or older to buy this item.</p>' : ''}
      <div class="sheet-act" id="sheetAct">${sheetAct(p)}</div></div>
    ${related.length ? `<div class="sheet-more"><h3>More from ${esc(p.aisle)}</h3><div class="row-p">${related.map((r) => card(r)).join('')}</div></div>` : ''}</div>`;
  document.body.appendChild(w); document.body.classList.add('lock'); $('.sheet-x', w).focus();
}
function closeSheet() {
  const w = $('#sheetBack'); if (!w) return; w.remove(); document.body.classList.remove('lock');
  try { lastFocus?.focus({ preventScroll: true }); } catch { /* element gone */ }
}

/* ============ common actions (event delegation) ============ */
const common = {
  add: (t) => change(Number(t.dataset.id), 1), inc: (t) => change(Number(t.dataset.id), 1), dec: (t) => change(Number(t.dataset.id), -1),
  open: (t) => openSheet(Number(t.dataset.id)), close: () => closeSheet(), retry: () => { state.products = []; route(); },
};
document.addEventListener('click', (e) => {
  if (e.target.id === 'sheetBack') return closeSheet();
  const t = e.target.closest('[data-act]'); if (!t) return;
  const fn = common[t.dataset.act] || viewActs[t.dataset.act]; if (fn) fn(t, e);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

/* ============ router + chrome ============ */
const routeName = () => (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'home');
function chrome() {
  const n = cartCount(); const r = routeName();
  $$('[data-cart-count]').forEach((e) => { e.textContent = n; e.classList.toggle('zero', n === 0); });
  $('#cartTotal').textContent = money(cartSubtotal());
  $('#cartBar').hidden = !(n > 0 && ['home', 'stores', 'store', 'search'].includes(r));
  document.body.classList.toggle('notabs', ['checkout', 'pay', 'admin'].includes(r));
  const map = { home: 'home', stores: 'stores', store: 'stores', cart: 'cart', checkout: 'cart', pay: 'cart', track: 'track', done: 'track', account: 'account', admin: 'account' };
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === map[r]));
}
const setAccLabel = () => { $('#accLabel').textContent = state.user ? state.user.name.split(' ')[0].slice(0, 10) : 'Account'; };
function go(h) { if (location.hash === h) route(); else location.hash = h; }
function showPortal(s) {
  const p = $('#portal'); p.style.background = `color-mix(in srgb, ${s.color} 82%, #000)`;
  p.innerHTML = `<span class="em">${esc(s.emoji)}</span><b>${esc(s.name)}</b><span>Welcome in</span>`; p.classList.add('on');
}
const hidePortal = () => $('#portal').classList.remove('on');

async function route() {
  clearInterval(pollTimer); if (cleanup) { cleanup(); cleanup = null; }
  viewActs = {}; hooks = {}; closeSheet(); view.onclick = null;
  const h = location.hash.replace(/^#/, '') || '/';
  const [pathPart, q = ''] = h.split('?'); const seg = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b] = seg;
  if (a !== 'search') qInput.value = '';
  chrome(); window.scrollTo({ top: 0, behavior: 'instant' });
  if (!state.products.length) {
    try { view.innerHTML = '<div class="empty"><div class="big">🛒</div><p>Opening the mall…</p></div>'; await loadCatalog(); }
    catch (e) { view.innerHTML = `<div class="empty"><div class="big">📡</div><h2 class="disp">Can't reach the mall</h2><p>${esc(e.message)}</p><button class="btn" data-act="retry">Try again</button></div>`; viewActs.retry = common.retry; hidePortal(); return; }
  }
  view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
  chrome();
  if (!a) viewMall();
  else if (a === 'stores') viewStores();
  else if (a === 'store') viewStore(b, new URLSearchParams(q).get('aisle'));
  else if (a === 'search') viewSearch(b || '');
  else if (a === 'cart') viewCart();
  else if (a === 'checkout') viewCheckout();
  else if (a === 'pay') viewPay(b);
  else if (a === 'done') viewDone(b);
  else if (a === 'track') viewTrack(b);
  else if (a === 'account') viewAccount();
  else if (a === 'admin') viewAdmin();
  else viewMall();
  setTimeout(hidePortal, 60);
}

const footer = () => `<footer class="foot"><p>Free delivery on orders over ${money(state.config.freeDeliveryOver)}. Chilled items travel in insulated bags.</p><p>Pickup: ${esc(state.config.pickupAddress)}</p>${state.config.livePayments ? '' : '<p>Demo mode: no real money is charged and prices are samples.</p>'}<p><a href="#/admin">Staff sign-in</a></p></footer>`;
const emptyState = (emoji, title, text, btn) => `<div class="empty"><div class="big">${emoji}</div><h2 class="disp">${esc(title)}</h2><p>${esc(text)}</p>${btn || ''}</div>`;

/* ============ MALL (home + walk-through floor plan) ============ */
function viewMall() {
  const L = state.stores.filter((s) => s.side === 'L'), R = state.stores.filter((s) => s.side === 'R'); const rows = Math.max(L.length, R.length);
  const count = (id) => state.products.filter((p) => p.store === id).length;
  let first = false; try { first = !sessionStorage.getItem('akw_seen'); sessionStorage.setItem('akw_seen', '1'); } catch { /* ignore */ }
  const unit = (s, i, k) => `<button class="unit ${s.side}" data-act="unit" data-id="${s.id}" data-row="${i}" data-side="${s.side}" data-name="${esc(s.name)}" style="--c:${s.color};grid-row:${i + 1};grid-column:${s.side === 'L' ? 1 : 3}" aria-label="Walk to ${esc(s.name)}">
      <span class="awning" style="--i:${k}"></span><span class="u-body"><span class="u-ico">${esc(s.emoji)}</span><span class="u-name">${esc(s.name)}</span><span class="u-meta">${count(s.id)} items</span></span></button>`;
  const favs = FAV.map((f) => state.products.find((p) => p.name.startsWith(f) && p.stock > 0)).filter(Boolean);
  const aisles = state.stores.flatMap((s) => [...new Set(state.products.filter((p) => p.store === s.id).map((p) => p.aisle))].map((a) => ({ s, a })));
  view.innerHTML = `
  <div class="home-top ${first ? 'rolled' : ''}">
    <div class="welcome"><h1 class="disp">Akwaaba.</h1><p>That means welcome. ${state.stores.length} stores under one roof: walk in, fill your trolley, and we deliver it or hold it for pickup.</p></div>
    <div class="planwrap"><section class="plan" aria-label="Mall floor plan">
      <div class="plan-grid" id="plan" style="grid-template-rows:repeat(${rows},140px)">
        <div class="concourse" aria-hidden="true"></div>
        ${L.map((s, i) => unit(s, i, i * 2)).join('')}${R.map((s, i) => unit(s, i, i * 2 + 1)).join('')}
        <div class="you" id="you" aria-hidden="true">${ic('cart')}</div>
      </div>
      <div class="entrance">Main entrance</div></section>
      <div class="plan-ctl"><button class="btn line" data-act="walk" data-d="-1">${ic('up')} Walk up</button><button class="btn line" data-act="walk" data-d="1">${ic('down')} Walk down</button>
        <button class="btn sun hide" id="enterL" data-act="enter-side" data-side="L"></button><button class="btn sun hide" id="enterR" data-act="enter-side" data-side="R"></button></div>
    </div>
  <ul class="perks">
    <li>${ic('truck')}<div><b>Free delivery over ${money(state.config.freeDeliveryOver)}</b><span>All 16 regions, or collect from the mall.</span></div></li>
    <li>${ic('snow')}<div><b>Cold store stays cold</b><span>Chilled items are packed last in insulated bags.</span></div></li>
    <li>${ic('phone')}<div><b>Pay your way</b><span>MoMo, card, or cash on delivery.</span></div></li>
  </ul>
  </div>
  <section class="sec"><div class="sec-h"><h2 class="sec-t">Mall favourites</h2></div><div class="row-p">${favs.map((p) => card(p)).join('')}</div></section>
  <section class="sec"><div class="sec-h"><h2 class="sec-t">Jump to an aisle</h2><a class="sec-link" href="#/stores">All stores ${ic('chev')}</a></div>
    <div class="chips">${aisles.map(({ s, a }) => `<a class="chip" href="#/store/${s.id}?aisle=${enc(a)}">${esc(s.emoji)} ${esc(a)}</a>`).join('')}</div></section>
  ${footer()}`;

  const grid = $('#plan'), you = $('#you'); const unitsAt = (r) => $$('.unit', grid).filter((u) => Number(u.dataset.row) === r);
  const yFor = (r) => (r >= rows ? grid.offsetHeight - 50 : unitsAt(r)[0].offsetTop + unitsAt(r)[0].offsetHeight * 0.58 - 19);
  let row = state.mallRow ?? rows, busy = false;
  const mark = () => {
    $$('.unit', grid).forEach((u) => u.classList.toggle('near', Number(u.dataset.row) === row));
    ['L', 'R'].forEach((side) => {
      const b = $('#enter' + side), u = unitsAt(row).find((x) => x.dataset.side === side);
      b.classList.toggle('hide', !u); if (u) { b.textContent = 'Enter ' + u.dataset.name; b.dataset.id = u.dataset.id; }
    });
  };
  const setRow = (r, walking) => {
    row = Math.max(0, Math.min(rows, r)); state.mallRow = row; you.style.top = yFor(row) + 'px'; you.style.setProperty('--dx', '0px');
    you.classList.toggle('walking', !!walking); if (walking) setTimeout(() => you.classList.remove('walking'), 800); mark();
  };
  async function enterStore(id) {
    if (busy) return; const u = $$('.unit', grid).find((x) => x.dataset.id === id); if (!u) return; busy = true;
    setRow(Number(u.dataset.row), true); await sleep(800);
    you.style.setProperty('--dx', (u.dataset.side === 'L' ? -38 : 38) + 'px'); await sleep(300);
    showPortal(S(id)); await sleep(320); go('#/store/' + id);
  }
  you.style.transition = 'none'; setRow(row, false); void you.offsetWidth; you.style.transition = '';
  viewActs.walk = (t) => { if (!busy) setRow(row + Number(t.dataset.d), true); };
  viewActs.unit = (t) => enterStore(t.dataset.id);
  viewActs['enter-side'] = (t) => enterStore(t.dataset.id);
  const onKey = (e) => {
    if (/input|textarea|select/i.test(e.target.tagName) || $('#sheetBack')) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); if (!busy) setRow(row + (e.key === 'ArrowDown' ? 1 : -1), true); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const b = $('#enter' + (e.key === 'ArrowLeft' ? 'L' : 'R')); if (!b.classList.contains('hide')) enterStore(b.dataset.id); }
  };
  const onResize = () => { you.style.transition = 'none'; you.style.top = yFor(row) + 'px'; void you.offsetWidth; you.style.transition = ''; };
  document.addEventListener('keydown', onKey); window.addEventListener('resize', onResize);
  cleanup = () => { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
}

/* ============ STORES (directory) ============ */
function viewStores() {
  view.innerHTML = `<h1 class="disp page-t">Stores</h1><p class="muted" style="margin:-6px 0 18px">Everything is on the ground floor. Enter a store, or go straight to an aisle.</p>
  <div class="dir">${state.stores.map((s) => { const ps = state.products.filter((p) => p.store === s.id); const aisles = [...new Set(ps.map((p) => p.aisle))];
    return `<article class="dir-item" style="--c:${s.color}"><div class="dir-sw"><span>${esc(s.emoji)}</span></div><div class="dir-main">
      <h2 class="disp"><a href="#/store/${s.id}">${esc(s.name)}</a></h2><p>${esc(s.tagline)}</p>
      <div class="dir-aisles">${aisles.map((a) => `<a href="#/store/${s.id}?aisle=${enc(a)}">${esc(a)}</a>`).join('')}</div>
      <a class="dir-go" href="#/store/${s.id}">Enter store ${ic('chev')}</a></div></article>`; }).join('')}</div>${footer()}`;
}

/* ============ STORE ============ */
function viewStore(id, aisleWanted) {
  const s = S(id); if (!s) return go('#/');
  const prods = state.products.filter((p) => p.store === id); const aisles = [...new Set(prods.map((p) => p.aisle))];
  const next = state.stores[(state.stores.findIndex((x) => x.id === id) + 1) % state.stores.length];
  view.innerHTML = `
  <div class="sign" style="--c:${s.color}"><span class="awning big" style="--c:${s.color}"></span>
    <div class="sign-board"><div class="sign-top"><button class="back" data-act="mall">${ic('back')} Mall</button></div>
      <div class="sign-main"><span class="sign-ico">${esc(s.emoji)}</span><div><h1 class="disp">${esc(s.name)}</h1><p>${esc(s.tagline)}</p><p class="sign-sub">${prods.length} products in ${aisles.length} aisles</p></div></div>
      ${id === 'cold' ? `<div class="cold-note">${ic('snow')}<span>Chilled items are packed last in an insulated bag. A small cold-bag fee applies to delivery orders.</span></div>` : ''}</div></div>
  <div class="aisle-tabs"><div class="chips" role="tablist" aria-label="Aisles">${aisles.map((a, i) => `<button class="chip" data-act="aisle" data-i="${i}">${esc(a)}</button>`).join('')}</div></div>
  ${aisles.map((a, i) => { const list = prods.filter((p) => p.aisle === a); return `<section class="aisle" id="aisle-${i}" data-i="${i}"><div class="aisle-h"><h2>${esc(a)}</h2><span class="aisle-n">Aisle ${i + 1}, ${list.length} items</span></div><div class="grid-p">${list.map((p) => card(p)).join('')}</div></section>`; }).join('')}
  <a class="nextdoor" href="#/store/${next.id}"><div><span>Next door</span><b>${esc(next.emoji)} ${esc(next.name)}</b></div>${ic('chev')}</a>${footer()}`;
  const chips = $$('.aisle-tabs .chip'); const setOn = (i) => { chips.forEach((c, k) => c.classList.toggle('on', k === i)); chips[i]?.scrollIntoView({ inline: 'center', block: 'nearest' }); };
  setOn(0);
  const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) setOn(Number(en.target.dataset.i)); }), { rootMargin: '-30% 0px -60% 0px' });
  $$('.aisle').forEach((el) => io.observe(el)); cleanup = () => io.disconnect();
  viewActs.mall = () => go('#/'); viewActs.aisle = (t) => $('#aisle-' + t.dataset.i).scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  if (aisleWanted) { const i = aisles.indexOf(aisleWanted); if (i >= 0) setTimeout(() => $('#aisle-' + i)?.scrollIntoView(), 80); }
}

/* ============ SEARCH ============ */
function viewSearch(term) {
  qInput.value = term; view.innerHTML = '<h1 class="disp page-t" id="sTitle"></h1><div id="results"></div>';
  viewActs.sugg = (t) => { qInput.value = t.dataset.t; history.replaceState(null, '', '#/search/' + enc(t.dataset.t)); renderSearch(t.dataset.t); };
  renderSearch(term);
}
function renderSearch(raw) {
  const term = raw.trim().toLowerCase(); const title = $('#sTitle'), box = $('#results'); if (!title || !box) return;
  if (!term) {
    title.textContent = 'Search the mall';
    const chip = (t) => `<button class="chip" data-act="sugg" data-t="${esc(t)}">${esc(t)}</button>`;
    box.innerHTML = `${state.recents.length ? `<div class="sec-h"><h2 class="sec-t">Recent</h2></div><div class="row">${state.recents.map(chip).join('')}</div>` : ''}<div class="sec-h" style="margin-top:22px"><h2 class="sec-t">Popular</h2></div><div class="row">${SUGGEST.map(chip).join('')}</div>`; return;
  }
  const words = term.split(/\s+/);
  const res = state.products.map((p) => { const hay = (p.name + ' ' + p.aisle + ' ' + S(p.store).name).toLowerCase(); return words.every((w) => hay.includes(w)) ? { p, score: p.name.toLowerCase().startsWith(words[0]) ? 0 : 1 } : null; }).filter(Boolean).sort((a, b) => a.score - b.score).map((x) => x.p);
  title.textContent = res.length ? `${res.length} result${res.length > 1 ? 's' : ''} for “${raw.trim()}”` : `No results for “${raw.trim()}”`;
  box.innerHTML = res.length ? `<div class="grid-p">${res.map((p) => card(p, { store: true })).join('')}</div>` : emptyState('🔎', 'Nothing matched', 'Check the spelling, or try a broader word like rice, fish or water.');
}
let sTimer;
qInput.addEventListener('focus', () => { if (routeName() !== 'search') go('#/search'); });
qInput.addEventListener('input', () => {
  const v = qInput.value; if (routeName() !== 'search') { location.hash = '#/search/' + enc(v); return; }
  history.replaceState(null, '', '#/search/' + enc(v)); clearTimeout(sTimer); sTimer = setTimeout(() => renderSearch(v), 80);
});
qInput.addEventListener('change', () => { const v = qInput.value.trim(); if (v.length > 1) { state.recents = [v, ...state.recents.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 6); save('akw_recent', state.recents); } });
$('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); qInput.blur(); });

/* ============ CART ============ */
function viewCart() {
  const items = cartItems();
  if (!items.length) { view.innerHTML = emptyState('🛒', 'Your cart is empty', 'Walk through the mall and add what you need.', '<a class="btn sun" href="#/">Start shopping</a>'); return; }
  const sub = cartSubtotal(), free = state.config.freeDeliveryOver, left = free - sub, hasCold = items.some((i) => i.p.cold);
  const groups = state.stores.map((s) => ({ s, lines: items.filter((i) => i.p.store === s.id) })).filter((g) => g.lines.length);
  view.innerHTML = `<h1 class="disp page-t">Your cart</h1><div class="cart-wrap"><div>
    <div class="ship"><p>${left > 0 ? `Add ${money(left)} more for free delivery` : 'Free delivery unlocked'}</p><div class="track"><i style="width:${Math.min(100, (sub / free) * 100)}%"></i></div></div>
    ${groups.map(({ s, lines }) => `<section class="cgroup" style="--c:${s.color}"><div class="cgroup-h"><span>${esc(s.emoji)}</span>${esc(s.name)}</div>${lines.map(({ p, qty }) => `<div class="cline" data-pid="${p.id}" style="--c:${s.color}">
      <button class="art" data-act="open" data-id="${p.id}" aria-label="View ${esc(p.name)}">${artInner(p)}</button>
      <div class="line-main"><div><div class="line-n">${esc(p.name)}</div><div class="line-u">${money(p.price)} per ${esc(p.unit)}</div></div>
      <div class="line-r"><div class="stepper"><button data-act="dec" data-id="${p.id}" aria-label="Remove one">${ic('minus')}</button><b>${qty}</b><button data-act="inc" data-id="${p.id}" aria-label="Add one">${ic('plus')}</button></div><span class="line-tot">${money(p.price * qty)}</span></div></div></div>`).join('')}</section>`).join('')}
    <p style="margin-top:14px"><button class="btn line sm" data-act="clear">Clear cart</button></p></div>
    <aside class="summary"><div class="tot"><div><span>Subtotal (${cartCount()} items)</span><b>${money(sub)}</b></div><div><span>Delivery</span><span class="muted">Worked out at checkout</span></div></div>
      ${hasCold ? '<p class="small muted" style="margin-top:12px">Chilled items go in an insulated bag. A small cold-bag fee applies to delivery orders.</p>' : ''}
      <a class="btn sun block desk-only" style="margin-top:16px" href="#/checkout">Checkout, ${money(sub)}</a></aside></div>
    <div class="actionbar mob-only"><a class="btn sun" href="#/checkout">Checkout, ${money(sub)}</a></div>`;
  hooks.cart = () => viewCart();
  viewActs.clear = () => { if (confirm('Remove everything from your cart?')) { state.cart = {}; save('akw_cart', state.cart); chrome(); viewCart(); } };
}

/* ============ CHECKOUT ============ */
function viewCheckout() {
  const items = cartItems(); if (!items.length) return go('#/cart');
  const hasAdult = items.some((i) => i.p.adult); const L = state.last, U = state.user || {}; const regions = Object.keys(state.config.zones);
  const choice = (name, val, mark, title, sub, checked) => `<label class="choice ${checked ? 'sel' : ''}"><input type="radio" name="${name}" value="${val}" ${checked ? 'checked' : ''}>${mark}<span><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span></label>`;
  view.innerHTML = `<a class="back" style="background:#e8ebe2;color:var(--forest);margin-bottom:14px" href="#/cart">${ic('back')} Cart</a><h1 class="disp page-t">Checkout</h1>
  <form class="co" id="coForm" novalidate><div class="co-main">
    <section class="panel"><div class="step"><i>1</i>How should we get it to you?</div><div class="choices">
      ${choice('delivery_method', 'delivery', `<span class="mark">${ic('truck')}</span>`, 'Delivery', 'To your door, anywhere in Ghana', true)}
      ${choice('delivery_method', 'pickup', `<span class="mark">${ic('shop')}</span>`, 'Pickup, free', esc(state.config.pickupAddress), false)}</div></section>
    <section class="panel"><div class="step"><i>2</i>Your details</div><div class="form">
      <div class="grid2"><label class="field"><span>Full name</span><input name="name" autocomplete="name" required value="${esc(L.name || U.name || '')}"></label>
      <label class="field"><span>Phone</span><input name="phone" inputmode="tel" autocomplete="tel" placeholder="024 412 3456" required value="${esc(L.phone || U.phone || '')}"></label></div>
      <div id="addrBox" class="form"><div class="grid2"><label class="field"><span>Region</span><select name="region"><option value="">Choose region</option>${regions.map((r) => `<option ${L.region === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
      <label class="field"><span>Town or area</span><input name="town" placeholder="e.g. Tamale, Kaladan" value="${esc(L.town || '')}"></label></div>
      <label class="field"><span>House or street description</span><input name="address" placeholder="House number, street, near…" value="${esc(L.address || '')}"></label>
      <div class="grid2"><label class="field"><span>GhanaPost GPS (optional)</span><input name="gps" placeholder="GA-123-4567" value="${esc(L.gps || '')}"></label>
      <label class="field"><span>Landmark (optional)</span><input name="landmark" value="${esc(L.landmark || '')}"></label></div></div>
      <label class="field"><span>Note for the packer or rider (optional)</span><input name="note" maxlength="200"></label></div></section>
    <section class="panel"><div class="step"><i>3</i>Payment</div><div class="choices">
      ${Object.entries(PAY).map(([k, [mk, nm, sub]], i) => choice('payment_method', k, mk, nm, sub, i === 0)).join('')}</div>
      <p class="small muted" id="payHint" style="margin-top:10px"></p></section>
    ${hasAdult ? '<label class="age"><input type="checkbox" name="age_confirmed"><span>I am <b>18 years or older</b>. My cart has beer in it.</span></label>' : ''}
  </div>
  <aside class="side"><div class="panel"><div class="step" style="font-size:1.2rem">Order summary</div>
    <div class="mini-items">${items.map((i) => `<div><span>${i.qty} × ${esc(i.p.name)}</span><span>${money(i.p.price * i.qty)}</span></div>`).join('')}</div><div class="tot" id="sumBox"></div>
    <p class="small muted" id="etaTxt" style="margin-top:10px"></p><div id="coErr"></div>
    <button class="btn sun block desk-only" type="submit" style="margin-top:12px" data-place>Place order</button></div></aside>
  <div class="actionbar mob-only"><button class="btn sun" type="submit" data-place>Place order</button></div></form>`;
  const form = $('#coForm'); const val = (n) => (form.elements[n]?.value ?? '').trim();
  const body = () => ({ items: items.map((i) => ({ id: i.p.id, qty: i.qty })), delivery_method: val('delivery_method'), region: val('region') });
  const renderSum = (q, msg) => {
    const sub = q?.subtotal ?? cartSubtotal();
    $('#sumBox').innerHTML = `<div><span>Subtotal</span><span>${money(sub)}</span></div><div><span>Delivery</span><span>${q ? (q.delivery ? money(q.delivery) : val('delivery_method') === 'pickup' ? 'Pickup' : 'Free') : '-'}</span></div>${q?.coldFee ? `<div><span>Cold bag</span><span>${money(q.coldFee)}</span></div>` : ''}<div class="grand"><span>Total</span><span>${money(q?.total ?? sub)}</span></div>`;
    $('#etaTxt').textContent = msg || q?.eta || ''; $$('[data-place]').forEach((b) => { b.textContent = q ? `Place order, ${money(q.total)}` : 'Place order'; });
  };
  let qt; const refreshQuote = () => {
    clearTimeout(qt); qt = setTimeout(async () => {
      if (!document.body.contains(form)) return; const pickup = val('delivery_method') === 'pickup'; $('#addrBox').classList.toggle('hide', pickup);
      if (!pickup && !val('region')) return renderSum(null, 'Choose your region to see the delivery fee.');
      try { const q = await api('/api/quote', { method: 'POST', body: body() }); if (document.body.contains(form)) renderSum(q); } catch (e) { if (document.body.contains(form)) renderSum(null, e.message); }
    }, 150);
  };
  const refreshOpts = () => {
    $$('.choice', form).forEach((o) => o.classList.toggle('sel', o.querySelector('input').checked));
    const pm = $('input[name=payment_method]:checked', form).value;
    $('#payHint').textContent = pm === 'cod' ? 'You pay when your order arrives.' : state.config.livePayments ? 'You will go to a secure payment page for MoMo or card.' : 'Demo mode: you will simulate the payment on the next screen.';
  };
  form.addEventListener('change', () => { refreshOpts(); refreshQuote(); }); refreshOpts(); refreshQuote();
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const btns = $$('[data-place]'), err = $('#coErr'); err.innerHTML = ''; btns.forEach((b) => { b.disabled = true; b.textContent = 'Placing order…'; });
    const fd = Object.fromEntries(new FormData(form).entries()); const payload = { ...fd, items: body().items, age_confirmed: !!fd.age_confirmed };
    try {
      const r = await api('/api/orders', { method: 'POST', body: payload });
      state.last = { name: fd.name, phone: fd.phone, region: fd.region, town: fd.town, address: fd.address, gps: fd.gps, landmark: fd.landmark }; save('akw_last', state.last);
      state.trks = [r.order.tracking, ...state.trks.filter((t) => t !== r.order.tracking)].slice(0, 10); save('akw_trks', state.trks);
      state.cart = {}; save('akw_cart', state.cart);
      if (r.needsPayment) { if (r.livePayments) { const p = await api(`/api/orders/${r.order.tracking}/pay`, { method: 'POST', body: {} }); location.href = p.redirect; return; } go('#/pay/' + r.order.tracking); }
      else go('#/done/' + r.order.tracking);
    } catch (ex) {
      err.innerHTML = `<div class="error">${esc(ex.message)}</div>`; btns.forEach((b) => { b.disabled = false; b.textContent = 'Place order'; });
      if (ex.status === 409) loadCatalog().catch(() => {}); window.scrollTo({ top: $('#coErr').getBoundingClientRect().top + scrollY - 160, behavior: 'smooth' });
    }
  });
  cleanup = () => clearTimeout(qt);
}

/* ============ PAYMENT (demo) ============ */
async function viewPay(trk) {
  let o; try { o = (await api('/api/track/' + enc(trk))).order; } catch (e) { view.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  if (o.paymentStatus === 'paid') return go('#/done/' + trk);
  const [mk, nm] = PAY[o.paymentMethod] || PAY.card; const isMomo = o.paymentMethod.startsWith('momo_');
  view.innerHTML = `<div class="paybox"><div class="panel"><div class="row">${mk}<b>${esc(nm)}</b></div>
    <div class="amount disp" style="margin-top:12px">${money(o.total)}</div><p class="muted small">Order ${esc(o.tracking)}. Your items are held for 30 minutes.</p>
    <div class="note"><b>Demo mode.</b> No real money is charged. With live payments on, this step is Paystack's secure page.</div>
    <form id="payForm" class="form">${isMomo ? `<label class="field"><span>MoMo number to charge</span><input id="mn" inputmode="tel" placeholder="024 412 3456" value="${esc(state.last.phone || '')}" required></label>
    <ol class="how"><li><i>1</i>Enter the number that holds your MoMo wallet.</li><li><i>2</i>A prompt appears on that phone.</li><li><i>3</i>Enter your PIN to approve.</li></ol>` : '<p class="small muted">Card details are never typed into the demo.</p>'}
    <div id="payErr"></div><button class="btn sun block" type="submit">${isMomo ? 'Simulate MoMo approval' : 'Simulate card payment'}</button></form></div></div>`;
  $('#payForm').onsubmit = async (e) => {
    e.preventDefault(); const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Waiting for approval…';
    try { await api(`/api/orders/${trk}/pay`, { method: 'POST', body: { momo_number: $('#mn')?.value || '' } }); go('#/done/' + trk); }
    catch (ex) { $('#payErr').innerHTML = `<div class="error">${esc(ex.message)}</div>`; b.disabled = false; b.textContent = 'Try again'; }
  };
}

/* ============ ORDER PLACED ============ */
async function viewDone(trk) {
  let o; try { o = (await api('/api/track/' + enc(trk))).order; } catch (e) { view.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  view.innerHTML = `<div class="success"><div class="tick"><svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg></div><h1 class="disp">Medaase, ${esc(o.firstName)}.</h1>
    <p class="muted">${o.paymentMethod === 'cod' ? 'Your order is confirmed. Pay when it arrives.' : 'Payment received. Your order is confirmed.'} ${esc(o.eta)}.</p>
    <div class="trk" id="trkNum">${esc(o.tracking)}</div><p class="small muted">Keep this tracking number. Total ${money(o.total)}.</p>
    <div class="row" style="justify-content:center;margin-top:16px"><button class="btn line" data-act="copy" data-t="${esc(o.tracking)}">${ic('copy')} Copy number</button><a class="btn sun" href="#/track/${esc(o.tracking)}">Track order</a></div>
    <p style="margin-top:18px"><a class="sec-link" href="#/">Back to the mall</a></p></div>`;
  viewActs.copy = async (t) => { try { await navigator.clipboard.writeText(t.dataset.t); toast('Tracking number copied'); } catch { toast('Press and hold the number to copy it'); } };
}

/* ============ TRACKING ============ */
async function viewTrack(trk) {
  if (!trk) {
    view.innerHTML = `<h1 class="disp page-t">Orders</h1><section class="panel"><form id="trkForm" class="form"><label class="field"><span>Tracking number</span><input id="tn" placeholder="AKW-AB12-CD34" autocapitalize="characters" autocomplete="off" required></label><div id="trkErr"></div><button class="btn" type="submit">Track order</button></form></section><div id="myList"></div>`;
    $('#trkForm').onsubmit = (e) => { e.preventDefault(); const v = $('#tn').value.trim().toUpperCase().replace(/[\s-]/g, ''); if (!/^AKW[A-Z0-9]{8}$/.test(v)) { $('#trkErr').innerHTML = '<div class="error">That does not look right. Tracking numbers look like AKW-AB12-CD34.</div>'; return; } go(`#/track/AKW-${v.slice(3, 7)}-${v.slice(7)}`); };
    let orders = [];
    if (state.user) { try { orders = (await api('/api/my/orders')).orders; } catch { /* fall back to local list */ } }
    if (!orders.length && state.trks.length) { const r = await Promise.allSettled(state.trks.slice(0, 6).map((t) => api('/api/track/' + enc(t)))); orders = r.filter((x) => x.status === 'fulfilled').map((x) => x.value.order); }
    const box = $('#myList'); if (!box) return;
    box.innerHTML = orders.length ? `<div class="sec"><div class="sec-h"><h2 class="sec-t">Your orders</h2></div>${orders.map((o) => `<a class="ord-card" href="#/track/${esc(o.tracking)}"><div class="row sb"><b>${esc(o.tracking)}</b><span class="pill ${['delivered', 'collected'].includes(o.status) ? 'ok' : o.status === 'cancelled' ? 'bad' : 'warn'}">${esc(o.statusLabel)}</span></div><div class="small muted">${fmtTime(o.createdAt)}, ${money(o.total)}, ${o.items.length} item${o.items.length > 1 ? 's' : ''}</div></a>`).join('')}</div>` : '';
    return;
  }
  const draw = async (first) => {
    let o; try { o = (await api('/api/track/' + enc(trk))).order; } catch (e) { if (first) view.innerHTML = `<div class="error">${esc(e.message)}</div><a class="btn" href="#/track">Try another number</a>`; return; }
    if (!$('#tlBox') && !first) return;
    if (!state.trks.includes(o.tracking)) { state.trks = [o.tracking, ...state.trks].slice(0, 10); save('akw_trks', state.trks); }
    const cancelled = o.status === 'cancelled', idx = o.flow.indexOf(o.status); const last = {}; o.events.forEach((ev) => { last[ev.status] = ev; });
    const pct = cancelled ? 0 : Math.max(0, idx) / (o.flow.length - 1); const finished = ['delivered', 'collected'].includes(o.status);
    const steps = o.flow.map((s, i) => { const ev = last[s]; const cls = i < idx || (i === idx && finished) ? 'done' : i === idx ? 'now' : ''; return `<li class="${cls}"><i></i><b>${esc(o.flowLabels[i])}</b>${ev ? `<span>${fmtTime(ev.at)}${ev.location ? ', ' + esc(ev.location) : ''}</span>${ev.note && ev.note !== o.flowLabels[i] ? `<span><br>${esc(ev.note)}</span>` : ''}` : ''}</li>`; }).join('');
    const canCancel = state.user && ['awaiting_payment', 'confirmed'].includes(o.status);
    view.innerHTML = `<div id="tlBox"><a class="back" style="background:#e8ebe2;color:var(--forest);margin-bottom:14px" href="#/track">${ic('back')} Orders</a>
    <section class="status-hero"><p>Tracking number</p><div style="font-family:var(--display);font-stretch:90%;font-weight:800;letter-spacing:.06em;font-size:1.3rem;margin-bottom:10px">${esc(o.tracking)}</div><h2 class="disp">${esc(o.statusLabel)}</h2><p>${cancelled ? 'This order was cancelled.' : esc(o.eta)}</p>
      ${cancelled ? '' : `<div class="route" aria-hidden="true"><span class="a"></span><span class="b"></span><i style="width:calc((100% - 24px) * ${pct})"></i><span class="van" style="left:calc(12px + (100% - 24px) * ${pct})">${o.deliveryMethod === 'pickup' ? '🛍️' : '🛵'}</span></div>`}
      ${o.status === 'awaiting_payment' ? `<a class="btn sun block" style="margin-top:16px" href="#/pay/${esc(o.tracking)}">Complete payment</a>` : ''}</section>
    <section class="panel" style="margin-top:14px"><div class="step" style="font-size:1.2rem">Progress</div><ul class="timeline">${cancelled ? o.events.map((ev) => `<li class="done"><i></i><b>${esc(ev.note || ev.status)}</b><span>${fmtTime(ev.at)}</span></li>`).join('') : steps}</ul></section>
    <section class="panel"><div class="step" style="font-size:1.2rem">Order summary${o.hasCold ? ' <span class="badge" style="margin-left:6px">Chilled items</span>' : ''}</div>
      <div class="mini-items">${o.items.map((i) => `<div><span>${esc(i.emoji)} ${i.qty} × ${esc(i.name)}</span><span>${money(i.price * i.qty)}</span></div>`).join('')}</div>
      <div class="tot"><div><span>Subtotal</span><span>${money(o.subtotal)}</span></div><div><span>Delivery</span><span>${o.delivery ? money(o.delivery) : o.deliveryMethod === 'pickup' ? 'Pickup' : 'Free'}</span></div>${o.coldFee ? `<div><span>Cold bag</span><span>${money(o.coldFee)}</span></div>` : ''}<div class="grand"><span>Total</span><span>${money(o.total)}</span></div></div>
      <p class="small muted" style="margin-top:12px">${esc((PAY[o.paymentMethod] || [0, o.paymentMethod])[1])}: ${o.paymentStatus === 'paid' ? 'paid' : o.paymentStatus === 'pay_on_delivery' ? 'pay on delivery' : 'not paid yet'}.${o.deliveryMethod === 'delivery' ? ` Delivering to ${esc(o.town)}, ${esc(o.region)}.` : ''}</p>
      ${canCancel ? '<p style="margin-top:12px"><button class="btn warn sm" data-act="cancel">Cancel order</button></p>' : ''}</section></div>`;
    viewActs.cancel = async () => { if (!confirm('Cancel this order?')) return; try { await api(`/api/orders/${trk}/cancel`, { method: 'POST', body: {} }); toast('Order cancelled'); draw(false); } catch (ex) { toast(ex.message, 3600); } };
  };
  await draw(true);
  pollTimer = setInterval(() => { if (!document.hidden) draw(false); }, 10000);
}

/* ============ ACCOUNT ============ */
let deferredInstall = null;
async function viewAccount() {
  if (!state.user) {
    let mode = 'login';
    view.innerHTML = `<h1 class="disp page-t">Account</h1><section class="panel"><div class="seg"><button data-act="mode" data-m="login" class="on">Log in</button><button data-act="mode" data-m="reg">Create account</button></div>
      <form id="authForm" class="form"><label class="field hide" id="nmRow"><span>Full name</span><input id="an" autocomplete="name"></label><label class="field"><span>Phone number</span><input id="ap" inputmode="tel" autocomplete="tel" required></label>
      <label class="field"><span>Password</span><input id="aw" type="password" minlength="6" autocomplete="current-password" required><small id="pwHint">At least 6 characters.</small></label><div id="authErr"></div><button class="btn" id="authBtn" type="submit">Log in</button></form>
      <p class="small muted" style="margin-top:12px">An account is optional. It keeps your orders in one place and lets you cancel before packing starts.</p></section>${installCard()}`;
    viewActs.mode = (t) => { mode = t.dataset.m; $$('.seg button').forEach((b) => b.classList.toggle('on', b === t)); $('#nmRow').classList.toggle('hide', mode !== 'reg'); $('#authBtn').textContent = mode === 'reg' ? 'Create account' : 'Log in'; $('#aw').autocomplete = mode === 'reg' ? 'new-password' : 'current-password'; };
    viewActs.install = installApp;
    $('#authForm').onsubmit = async (e) => {
      e.preventDefault();
      try { const r = await api(mode === 'reg' ? '/api/register' : '/api/login', { method: 'POST', body: { name: $('#an').value, phone: $('#ap').value, password: $('#aw').value } });
        state.token = r.token; state.user = r.user; localStorage.setItem('akw_token', r.token); save('akw_user', r.user); setAccLabel(); toast('Welcome, ' + r.user.name.split(' ')[0]); viewAccount();
      } catch (ex) { $('#authErr').innerHTML = `<div class="error">${esc(ex.message)}</div>`; }
    };
    return;
  }
  view.innerHTML = `<h1 class="disp page-t">Hello, ${esc(state.user.name.split(' ')[0])}</h1><section class="panel row sb"><div><b>${esc(state.user.name)}</b><div class="small muted">${esc(state.user.phone)}</div></div><button class="btn line sm" data-act="logout">Log out</button></section>${installCard()}
    <div class="sec"><div class="sec-h"><h2 class="sec-t">My orders</h2></div><div id="myOrders" class="muted">Loading…</div></div>`;
  viewActs.install = installApp;
  viewActs.logout = async () => { try { await api('/api/logout', { method: 'POST', body: {} }); } catch { /* ignore */ } state.token = null; state.user = null; localStorage.removeItem('akw_token'); localStorage.removeItem('akw_user'); setAccLabel(); viewAccount(); };
  try { const { orders } = await api('/api/my/orders'); const box = $('#myOrders'); if (!box) return;
    box.innerHTML = orders.length ? orders.map((o) => `<a class="ord-card" href="#/track/${esc(o.tracking)}"><div class="row sb"><b>${esc(o.tracking)}</b><span class="pill">${esc(o.statusLabel)}</span></div><div class="small muted">${fmtTime(o.createdAt)}, ${money(o.total)}</div></a>`).join('') : emptyState('📦', 'No orders yet', 'When you place an order it will show up here.', '<a class="btn sun" href="#/">Start shopping</a>');
  } catch (ex) { if (ex.status === 401) { state.token = null; state.user = null; localStorage.removeItem('akw_token'); setAccLabel(); viewAccount(); } else if ($('#myOrders')) $('#myOrders').innerHTML = `<div class="error">${esc(ex.message)}</div>`; }
}
const installCard = () => (deferredInstall ? `<section class="panel" style="margin-top:14px"><b>Install Akwaaba Mall</b><p class="small muted" style="margin:4px 0 12px">Add it to your home screen to shop like a normal app.</p><button class="btn sun sm" data-act="install">Install app</button></section>`
  : /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone ? '<section class="panel" style="margin-top:14px"><b>Install on iPhone</b><p class="small muted" style="margin-top:4px">Tap the Share button, then choose Add to Home Screen.</p></section>' : '');
async function installApp() { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('#installBtn').hidden = true; }

/* ============ ADMIN ============ */
function viewAdmin() {
  let key = sessionStorage.getItem('akw_admin') || '', statuses = {}, products = [];
  const aapi = async (path, method = 'GET', body) => {
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'x-admin-key': key }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Error'); return d;
  };
  const lock = () => {
    view.innerHTML = `<h1 class="disp page-t">Staff sign-in</h1><section class="panel"><form id="keyForm" class="form"><label class="field"><span>Admin key</span><input id="akey" type="password" autocomplete="off" required><small>Printed in the server console and saved in data/admin-key.txt.</small></label><div id="loginErr"></div><button class="btn">Enter</button></form></section>`;
    $('#keyForm').onsubmit = (e) => { e.preventDefault(); key = $('#akey').value.trim(); sessionStorage.setItem('akw_admin', key); open(); };
  };
  const open = async () => { try { await drawOrders(true); } catch (e) { sessionStorage.removeItem('akw_admin'); lock(); $('#loginErr').innerHTML = `<div class="error">${esc(e.message)}</div>`; } };
  async function drawOrders(shell) {
    const f = $('#stFilter')?.value || ''; const d = await aapi('/api/admin/orders' + (f ? '?status=' + enc(f) : '')); statuses = d.statuses;
    if (shell || !$('#orderList')) {
      view.innerHTML = `<h1 class="disp page-t">Mall admin</h1><div class="seg" style="grid-template-columns:repeat(3,1fr)"><button class="on" data-act="tab" data-tab="orders">Orders</button><button data-act="tab" data-tab="stock">Stock and prices</button><button data-act="tab" data-tab="lock">Lock</button></div>
        <section id="ordersTab"><div class="row"><select id="stFilter" class="sm-in"><option value="">All statuses</option>${Object.entries(statuses).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select><button class="btn line sm" data-act="refresh">Refresh</button></div><div id="orderList" style="margin-top:12px"></div></section>
        <section id="stockTab" class="hide"><label class="field" style="margin-bottom:10px"><input id="pf" placeholder="Filter products…"></label><div style="overflow:auto"><table class="atable"><thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Photo link (https)</th><th>On</th><th></th></tr></thead><tbody id="pbody"></tbody></table></div></section>`;
      $('#stFilter').onchange = () => drawOrders(false); $('#pf').oninput = drawStock;
    }
    $('#orderList').innerHTML = d.orders.length ? d.orders.map((o) => `<div class="panel ord" data-t="${esc(o.tracking)}"><div class="row sb"><b>${esc(o.tracking)}</b><span class="pill">${esc(o.statusLabel)}</span></div>
      <div class="small muted">${new Date(o.createdAt).toLocaleString()}, ${money(o.total)}, ${esc(o.paymentMethod)} (${esc(o.paymentStatus)}), ${esc(o.deliveryMethod)}</div>
      <div style="margin-top:6px">${esc(o.name)}, <a href="tel:${esc(o.phone)}" style="text-decoration:underline">${esc(o.phone)}</a></div>
      <div class="small">${o.deliveryMethod === 'pickup' ? 'Pickup' : `${esc(o.address)}, ${esc(o.town)}, ${esc(o.region)}${o.gps ? ', ' + esc(o.gps) : ''}${o.landmark ? ', near ' + esc(o.landmark) : ''}`}${o.note ? `<br>Note: ${esc(o.note)}` : ''}</div>
      <div class="small muted" style="margin-top:4px">${o.items.map((i) => `${i.qty} × ${esc(i.name)}${i.cold ? ' (chilled)' : ''}`).join(', ')}</div>
      <div class="row" style="margin-top:10px"><select class="sm-in st">${Object.entries(statuses).filter(([k]) => k !== 'awaiting_payment').map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
      <input class="sm-in note" style="flex:1;min-width:140px" placeholder="Note or location (optional)"><button class="btn sm" data-act="upd">Update</button></div></div>`).join('') : emptyState('📭', 'No orders yet', 'New orders appear here as customers place them.');
  }
  async function loadStock() { products = (await aapi('/api/admin/products')).products; drawStock(); }
  function drawStock() {
    const f = ($('#pf')?.value || '').toLowerCase();
    $('#pbody').innerHTML = products.filter((p) => !f || (p.name + p.store + p.aisle).toLowerCase().includes(f)).map((p) => `<tr data-id="${p.id}"><td>${esc(p.emoji)} ${esc(p.name)}<br><small class="muted">${esc(p.store)}: ${esc(p.aisle)}</small></td>
      <td><input class="pr" type="number" step="0.01" min="0" value="${p.price}"></td><td><input class="sk" type="number" min="0" value="${p.stock}"></td><td><input class="wide im" type="url" placeholder="https://…" value="${esc(p.image || '')}"></td>
      <td><input type="checkbox" class="ac" ${p.active ? 'checked' : ''}></td><td><button class="btn sm" data-act="sv">Save</button></td></tr>`).join('');
  }
  viewActs.tab = async (t) => {
    if (t.dataset.tab === 'lock') { sessionStorage.removeItem('akw_admin'); key = ''; return lock(); }
    $$('.seg button').forEach((b) => b.classList.toggle('on', b === t)); $('#ordersTab').classList.toggle('hide', t.dataset.tab !== 'orders'); $('#stockTab').classList.toggle('hide', t.dataset.tab !== 'stock');
    if (t.dataset.tab === 'stock') { try { await loadStock(); } catch (ex) { toast(ex.message, 3500); } }
  };
  viewActs.refresh = () => drawOrders(false).catch((ex) => toast(ex.message, 3500));
  viewActs.upd = async (t) => { const c = t.closest('.ord'); try { await aapi(`/api/admin/orders/${c.dataset.t}/status`, 'POST', { status: $('.st', c).value, note: $('.note', c).value, location: $('.note', c).value }); drawOrders(false); } catch (ex) { toast(ex.message, 3500); } };
  viewActs.sv = async (t) => { const tr = t.closest('tr'); try { await aapi('/api/admin/products/' + tr.dataset.id, 'PATCH', { price: $('.pr', tr).value, stock: $('.sk', tr).value, active: $('.ac', tr).checked, image: $('.im', tr).value }); t.textContent = 'Saved'; setTimeout(() => (t.textContent = 'Save'), 1200); loadCatalog().catch(() => {}); } catch (ex) { toast(ex.message, 3500); } };
  if (key) open(); else lock();
}

/* ============ global wiring ============ */
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.products.length) loadCatalog().then(() => { $$('[data-pid]').forEach((el) => refreshCtl(Number(el.dataset.pid))); chrome(); }).catch(() => {}); });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('#installBtn').hidden = false; });
$('#installBtn').addEventListener('click', installApp);
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; deferredInstall = null; toast('Akwaaba Mall is installed'); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
setAccLabel(); route();
})();
