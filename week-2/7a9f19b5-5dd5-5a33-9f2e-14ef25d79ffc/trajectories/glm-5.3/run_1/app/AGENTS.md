# Lightfall

Southerly Light Works' platform for specifying and ordering architectural luminaires in New Zealand.

## Commands

- `npm ci` — install dependencies from the lockfile
- `npm run build` — compile the server (`tsc`, output in `dist/`) and bundle the browser app (`esbuild`, output in `build/client/`)
- `npm run start` — serve the app on `0.0.0.0:$APP_PUBLIC_PORT` (default 4173)

`/app/run.json` is the run manifest used by the deployment tooling.

## Layout

- `server/` — TypeScript HTTP server: API endpoints (`routes_*.ts`), Postgres schema and seed (`db.ts`, `seed_data.ts`, `seed.ts`), domain rules shared with the browser (`domain.ts`), Kill Bill client (`killbill.ts`), MinIO storage (`storage.ts`), PocketBase collaboration (`pocketbase.ts`), Mailpit mailer (`mail.ts`), PDF writer (`pdf.ts`), quote share worker (`shares.ts`), idempotency records (`idempotency.ts`), clearance stock movements (`stock.ts`).
- `client/` — TypeScript browser app: views (`views/`), shared domain code (`lib/`), 3D shapes and canvases (`three/`), self-hosted fonts (`assets/fonts/`), design system (`styles.css`).
- `THIRD_PARTY_NOTICES.md` — shipped packages and bundled fonts with their licences.

## Services

Postgres is the system of record. Kill Bill handles card authorisation, capture, refunds, trade invoices and payments (external payment plugin `__EXTERNAL_PAYMENT__`, transaction keys `<orderKey>-auth|-capture|-refund-<n>|-payment`). Mailpit receives every outgoing email. MinIO stores covers, spec sheets and quote PDFs. PocketBase carries presence, comments and placement changes, relayed to browsers through `/api/projects/<id>/live`.

## Notes

- The GST rule, the light-pool geometry and the order state machine each live in exactly one module (`server/domain.ts`, `server/orders.ts`) and are mirrored on the browser side (`client/lib/domain.ts`).
- Money is integer cents without GST throughout.
- Schema and seed data apply on every start, idempotently.
