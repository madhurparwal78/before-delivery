# Chauraha Bazaar

A multi-seller marketplace for Indian shoppers. One cart becomes one parcel per seller, and every rupee, unit, pincode and delivery date is decided once on the server.

- **Shoppers** search with typo tolerance and facets, see a delivery promise per seller for their pincode, compare products, seller offers and EMI tenures, fill a multi-seller cart (coupon, gift wrap, one-day delivery, save for later), pay by UPI, card, net banking, card EMI, Chauraha balance or cash on delivery, track each parcel, download invoices, return a line and see the exact refund.
- **Guest viewers** open a shared wishlist or cart link without an account and add an item to their own cart.
- **Sellers** list products within a 200-listing quota, keep stock true, pack, print stored labels, ship and deliver, answer returns and read a settlement statement that explains every deduction.
- **Support agents** look up an order across its shipments, refund a line or reopen a declined return.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type check, Vite client build, esbuild server bundle) |
| serve | `npm run start` (foreground, `0.0.0.0`, port `APP_PUBLIC_PORT`, default 4173) |

The server answers pages and `/api` from one origin. `GET /api/health` answers 200 `{"status":"ok"}` once the Postgres schema is applied and 503 `{"status":"starting"}` before. The schema and the seed are applied on every start and seed only an empty database.

## Environment

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | the single source of truth: catalogue, stock, carts, orders, sessions, codes, rate counters, idempotency records, the settlement ledger | Postgres |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | invoices, labels, listing photos, the GST certificate (private bucket; the app streams files) | MinIO |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | payment of record: PURCHASE legs and REFUND transactions | Kill Bill |
| `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`, `SEARCH_INDEX` (default `listings`) | faceted, typo-tolerant search | Meilisearch |
| `WIREMOCK_URL` | SMS gateway and the UPI and net-banking provider | WireMock |
| `APP_PUBLIC_PORT` | listening port (default 4173) | |
| `OTP_TTL_SECONDS` (300), `CODE_WINDOW_SECONDS` (900), `CODE_RESEND_SECONDS` (30), `ACCESS_TTL_SECONDS` (900), `SESSION_TTL_SECONDS` (2592000), `UPI_EXPIRY_SECONDS` (600), `SHARE_TTL_SECONDS` (2592000), `RATE_WINDOW_SECONDS` (60), `IDEMPOTENCY_TTL_SECONDS` (86400) | timings, whole seconds, defaults in brackets | |

No credential or service URL is hard-coded, logged or sent to the browser. If Postgres is unreachable at boot the app keeps retrying and health answers 503; if Kill Bill, MinIO, Meilisearch or WireMock is unreachable the app still boots and each feature shows its outage behaviour.

## Seeded personas

Shoppers Asha Verma, Ravi Iyer and Meera Das; sellers Kaveri Handlooms, Ganga Steelworks, Marine Drive Gadgets and Sabarmati Electronics; support agent Nikhil Rao. Sign-in is a password followed by a 6-digit SMS code sent through the SMS gateway. Their addresses, passwords and phone numbers are the seed data published in the task brief.
