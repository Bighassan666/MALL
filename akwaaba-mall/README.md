# Akwaaba Mall — Ghana market-style mall (PWA)

Walk a mall corridor, step into stores (Drinks Hall, Kitchen Pantry, Cold Store, Fresh Market, Bakery & Snacks,
Home & Care), pick items from aisles into a trolley, pay (MoMo / card / cash on delivery) and track the order with a
unique tracking number. Installable on phones (PWA). Works offline for browsing.

## Run
Requires **Node 22.13+** (uses built-in SQLite — no `npm install` needed).

    node server.js            # http://localhost:3000

On first start it creates `data/mall.db`, seeds 6 stores / 109 sample products, and prints the **admin key**
(also saved in `data/admin-key.txt`). Admin page: `/#/admin` (footer link: Staff sign-in) (orders, status updates, stock & prices).

## Environment variables
| Var | Purpose |
|---|---|
| `PORT` | default 3000 |
| `PUBLIC_URL` | your public https URL (needed for live payment callbacks) |
| `MALL_NAME`, `PICKUP_ADDRESS` | branding and pickup location |
| `ADMIN_KEY` | set your own admin key |
| `PAYSTACK_SECRET_KEY` | enables LIVE payments (Paystack hosted page: MoMo + card). Without it the app runs in DEMO mode: no money moves |
| `AUTO_TRACK` | `1` = demo auto-advances order status every ~40s (default on in demo mode, off when live). Orders you update in Admin are never auto-advanced |
| `DATA_DIR` | where the database lives (use a persistent disk in production) |

## Install as a phone app
PWAs need **HTTPS** (localhost is exempt). Deploy to any Node host with a persistent disk (VPS, Render, Railway, Fly.io),
open the site on the phone: Android Chrome shows an **Install** button; iPhone: Share → Add to Home Screen.

## Customise
- Stores, aisles, products: `seed.js` (only used on first run) or the Admin page afterwards.
- Colours/branding: CSS variables at the top of `public/styles.css`, icons in `public/icons/`.
- Delivery fees/regions: `MALL.zones` in `server.js`.

## Before going live (important)
- Test live payments with Paystack test keys first. The Paystack code path is written to their documented API but has
  **not** been run against Paystack here.
- Prices are sample prices. Beer needs an 18+ confirmation (built in); check local rules for selling alcohol.
- Put the app behind HTTPS and back up `data/mall.db`.

## File layout
One HTML file (`public/index.html`), one CSS file (`public/styles.css`), one JS file (`public/app.js`, includes the admin screen).
`public/sw.js` (service worker) and `public/manifest.webmanifest` must stay separate files - browsers require that for PWA install.

## Design notes
- Idea: a market stall. Each store wears its own striped awning (floor plan, store sign, directory). Everything else stays quiet.
- Fonts (self-hosted, work offline, SIL Open Font License): Archivo (condensed headlines, names, prices) and Figtree (text) in `public/fonts/`.
- Store colours live in `seed.js` and are re-applied on every start.
- Product pictures: items show an emoji tile by default. In Admin > Stock and prices you can paste an https:// photo link per product and it replaces the emoji everywhere.
- Navigation: bottom tabs on phones (Mall, Stores, Cart, Orders, Account), top menu on desktop.
