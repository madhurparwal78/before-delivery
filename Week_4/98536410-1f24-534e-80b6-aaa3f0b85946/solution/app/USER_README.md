# Tramela Estate

A shared operations and click-and-collect platform for regional groups of ironmongery, paint and
garden-hardware shops (ferragens) in mainland Portugal and the Azores.

- **Regional leads** watch every shop of their group on a live map, filter it (the view is kept in the
  address), suspend or resume a shop and replay the last 24 hours of orders.
- **Store managers** run stock, till sales (safe under retries), holds, effective-dated opening hours,
  collection and returns for their own shop.
- **Shoppers** find the nearest shop that has an item, hold it, choose a collection slot in the shop's
  local time and place one order per press.
- **Customer care** find a customer's orders, read and verify an order's chained history and download the
  order document.

## Run it

`run.json` holds the commands:

```
npm ci
npm run build
npm run start
```

The server listens on `0.0.0.0` at `APP_PUBLIC_PORT` (default 4173), creates its schema and seed data, and
creates the object-storage bucket if it is missing. `GET /api/health` answers `{"status":"ok"}` once ready.

## Environment

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | source of truth |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3-compatible storage | order documents and return labels |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | SMTP sink | confirmation messages (`MAIL_FROM` defaults to `Tramela Estate <encomendas@tramela.example>`) |
| `HOLD_SECONDS` (600), `HOLD_SWEEP_SECONDS` (15), `REQUEST_KEY_TTL_SECONDS` (86400), `SESSION_SECONDS` (43200), `SIGN_IN_WINDOW_SECONDS` (900) | the app | timing |
| `APP_PUBLIC_PORT` (4173), `APP_PUBLIC_URL` | the app | listen port and public address |

None of these reaches the browser.

## Seeded sign-ins

Every seeded person signs in with the password `estate-demo-2026`, for example
`lead.atlantico@tramela.example` (regional lead), `gerente.faro@tramela.example` (manager of two shops),
`apoio.atlantico@tramela.example` (care) and `cliente.ana@tramela.example` (shopper).
