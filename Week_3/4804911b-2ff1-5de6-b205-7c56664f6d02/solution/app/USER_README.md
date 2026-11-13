# Interval, by Vasant Talkies Drinks

The public brand site and pack-price record of an invented Indian packaged-drinks house. A drink's 3D pack, its batch code, a
printable dated notice and a signed machine message all state one server-decided price. Household buyers read a pack on a
phone, kirana owners find a price and print the notice, stockists receive signed price messages, and the house editor imports
the plant's price sheet and publishes notices. Sales, carts, payments and stock are out of scope.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` |
| serve | `npm run start` (Node.js 22, foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

Schema and seed data are applied on every start and change nothing the second time. `GET /api/health` answers `{"status":"ok"}`
whether or not Svix, Gotenberg, RabbitMQ, Meilisearch or MinIO are reachable.

## Environment

| Variable | Service | Used for |
|---|---|---|
| `DATABASE_URL` | Postgres | system of record: catalogue, prices, notices, accounts, sessions, sheets, deliveries, the outbox, `copyId` |
| `SVIX_URL`, `SVIX_API_KEY` | Svix | signs and delivers stockist messages, rotates secrets, lists delivery attempts |
| `GOTENBERG_URL` | Gotenberg | renders notice PDFs from HTML |
| `AMQP_URL`, `AMQP_CONNECT_ADDRESS` (optional) | RabbitMQ | the durable work queue and its dead queue |
| `MEILISEARCH_URL`, `MEILISEARCH_API_KEY` | Meilisearch | the rebuildable pack-search index |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO | private bucket holding notice PDFs and original price sheets |
| `MINIO_PUBLIC_URL` (optional) | MinIO | the address signed links are signed for; defaults to `S3_ENDPOINT` |
| `STOCKIST_ENDPOINT_ALLOWED_CIDRS` (optional) | none | comma-separated private ranges that may receive `http` messages; default none |
| `INTERVAL_TEST_CLOCK` (optional) | none | `on` enables `PUT`/`DELETE /api/test/clock`; otherwise they answer 404 |
| `TZ` (optional) | none | never changes a result; every date decision runs in Asia/Kolkata |
| `APP_PUBLIC_PORT` | none | listening port |

None of these reach the browser. Postgres holds all product data, MinIO holds bytes, Meilisearch holds an index that can be
rebuilt from Postgres, and RabbitMQ holds work; nothing is written to local disk.

## Seeded accounts

| Role | Email | Password |
|---|---|---|
| editor | `editor@vasant-talkies.example` | `Interval-Editor-2026` |
| stockist | `orders@sagar-traders.example` | `Interval-Stock-A1` |
| stockist | `orders@deccan-cold.example` | `Interval-Stock-B2` |
