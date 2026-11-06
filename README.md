# Melivor — Ecommerce Storefront + Merchant Dashboard

A working full-stack starter storefront built to closely follow **your final approved Melivor homepage design**: muted blush and burgundy, gently 3D product displays, rounded cards, a lifestyle hero, category arches, and a two-tool fit/wellness section. The brand logo is a transparency-adjusted copy of the **exact logo you uploaded**; its original file is included in `public/assets/melivor-original-upload.jpg`.

This is an independent ecommerce project, **not a Shopify installation or a Shopify feature-complete replacement**. It includes functional core merchant workflows and a SQLite database, but enterprise-grade payment gateways, carrier contracts, email delivery, complex regional tax/compliance, and hosted operations still require configuration or further integration.

## Quick start (no npm installation required)

1. Install **Node.js 22.13 or later** (Node 22's native SQLite module is used).
2. Extract the project ZIP and open a terminal in `melivor_fullstack/`.
3. Start it:

   ```bash
   npm start
   ```

4. Visit **http://localhost:3000** for the shop, and **http://localhost:3000/admin** for the merchant dashboard.
5. On first run, the terminal prints a **one-time setup token**. Enter it at `/admin`, choose an administrator email, and set a strong password (12+ characters). After setup, sign in with those credentials.

Data persists in `data/melivor.sqlite`; restarting does **not** reset your products, orders, settings or users. Initial catalog data is sample content for designing the store, not actual inventory. Change prices, photos, sizes, descriptions, and shipping settings before accepting real orders.

### Docker

```bash
docker compose up --build
```

Visit http://localhost:3000. The included Docker Compose service stores the SQLite database and uploaded images in persistent Docker volumes. Retrieve the setup token with `docker compose logs melivor`.

## Storefront features

- Responsive, approved-style homepage featuring your original logo and image compositions derived from the approved visual.
- Categories, searchable product catalog, sorting, collection navigation, product pages and size/color variants.
- Local shopping bag with quantity adjustment, stock checking, favorites/wishlist and server-side repricing.
- Guest checkout, customer registration/sign-in, account order history, discount codes, shipping/tax calculations, order confirmation.
- **Cash on delivery** and **manual bank-transfer** order methods. Payment status starts **pending**; processing card/wallet charges is intentionally not claimed.
- Bra size calculator with inch/cm measurements, estimated US and UK cup sizing and sister-size guidance.
- Period tracker: saved start dates, cycle/duration settings, next period estimate, monthly calendar, local export and delete. **All cycle history stays in this browser's local storage and is never sent to Melivor's servers.** These predictions are estimates, not contraceptive or medical advice.
- Newsletter signup, store pages and branded footer.

## Merchant dashboard features (`/admin`)

| Area | Available features |
|---|---|
| Overview | Revenue/order totals, current month sales, recent orders, low-stock alerts |
| Orders | Review guest/customer orders and line items, contact and shipping details, update payment/fulfillment/status, internal notes, stock restocking on cancellation |
| Products | Add/edit/soft-archive, category, collection, draft/published status, pricing, compare-at and cost, featured selection, image uploads, size/color/SKU/stock variants |
| Collections | Add/edit/delete, publish/hide, descriptions, navigation |
| Inventory | View per-variant stock and make adjustments |
| Customers | Registered and guest customer summaries, lifetime spend, deactivate/reactivate account |
| Discounts | Percent or fixed value, minimum order, usage caps, expiration, enable/disable |
| Pages | Add, edit, publish and delete informational pages |
| Marketing | Newsletter subscriber list and CSV export |
| Analytics | 30 latest sales dates, product bestseller revenue/units, order status breakdown |
| Settings | Store brand copy, contact email, currency, flat shipping, free-shipping threshold, base tax percentage, cash-on-delivery/bank transfer, basic policies |
| Activity | Audit log of major store changes |

## Project structure

```text
melivor_fullstack/
├── server.js                   Node.js API, database, security and file serving
├── package.json                Scripts and minimum runtime version
├── public/
│   ├── index.html              Storefront entry
│   ├── app.js                  Customer UI and fit/wellness tools
│   ├── admin.html              Merchant dashboard entry
│   ├── admin.js                Dashboard UI and API actions
│   ├── styles.css              Shared styling + mobile responsiveness
│   ├── assets/                 Brand logo and approved-design-derived images
│   └── uploads/                Images uploaded by administrators
├── data/                       SQLite database created on first run
├── scripts/smoke.mjs           Read-only API smoke checks
├── Dockerfile
└── docker-compose.yml
```

No external JavaScript packages are required at runtime. The server uses Node's built-in HTTP, crypto, file handling and SQLite APIs. Products, customers, orders, collections, discounts and settings are genuinely persisted to SQLite. Cart and period history are stored client-side for privacy and convenience.

## Merchant setup checklist

1. Create the admin account using the one-time token. Change the sample product names, photos and variant inventories to your actual stock.
2. Confirm your legal business information, tax treatment, shipping rate, returns policy and contact email in Settings and Pages.
3. Set pricing and currency. **Changing the currency symbol in Settings does not convert prices**; update product price values to match.
4. Review cash-on-delivery and manual bank-transfer methods. Turn off either method if unavailable. Configure actual payment provider integration before offering card or wallet payments.
5. Configure your domain, HTTPS reverse proxy, production security, database backups, error monitoring and email notifications before launch.
6. Add real product photography: the included photos and lifestyle panels are cropped from the approved AI homepage concept and are **visual placeholders**, not photos of actual inventory.

## Deployment / security notes

- Set `NODE_ENV=production` and serve behind **HTTPS**; secure login cookies are then enabled. If TLS terminates at a proxy, ensure the browser connects over HTTPS.
- Keep `data/` and `.env` private; never publish either in a static hosting bucket. Back up `data/melivor.sqlite`, its WAL/SHM sidecars when present (prefer an application-level SQLite backup), and `public/uploads/`.
- Admin and customer passwords use salted scrypt hashes. Login cookies use random hashed session tokens and are HttpOnly and SameSite=Lax. JSON writes include Origin checking, and the admin APIs check role authorization.
- For a multi-server/high-traffic deployment, replace the single-file SQLite setup with a managed database and add application monitoring, transactional email, abuse prevention and production-grade fulfillment workflows.
- This app has no automated email sender, shipping label purchase, payment-gateway refund execution, full multi-location inventory, carrier rate quotes, Shopify app marketplace, POS, or advanced tax engine. Dashboard status fields are **operational records**, not proof that a bank has charged or refunded a customer.
- Period tracking data is intentionally not in the merchant database; browser/device changes lose access unless users export their own local file. Do not silently move this sensitive data to a server.
- Use policies appropriate to where you operate, including ecommerce consumer protection, privacy and tax requirements.

## Configuration

`.env.example` contains optional settings. The server reads `.env` automatically if present. Default host is `127.0.0.1` (local-only). In a container, it binds `0.0.0.0` through the Compose environment. For a remote host, place it behind a reverse proxy.

**Read-only smoke test while the server is running**:

```bash
npm run check
npm run smoke
```

For custom port, run `PORT=3001 npm start` and `BASE_URL=http://localhost:3001 npm run smoke`.

## Design fidelity

`DESIGN_REFERENCE.png` is the approved static mockup for side-by-side visual reference. The UI reproduces the primary approved composition in responsive HTML/CSS rather than stretching one screenshot across the whole page. The carefully cropped images are static starter artwork and can be replaced in the admin. Exact font metrics and individual product imagery may differ from the illustration because the reference was an image, not source code with design tokens.
