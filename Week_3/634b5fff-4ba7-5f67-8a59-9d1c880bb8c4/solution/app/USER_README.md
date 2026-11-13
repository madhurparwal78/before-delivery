# Svovlstik Press: The Last Bundle

A real-time 3D, scroll-driven picture book of Hans Christian Andersen's *The Little Match-Seller* (H. P. Paull translation) that doubles as the
storefront for 240 numbered keepsake boxes from Svovlstik Press, an invented one-person letterpress.

* **Collectors and gift buyers** read the tale, strike a match in each of four chapters, light the whole bundle, find passages and boxes through
  typo-tolerant search, hold one exact number while a real 3D match burns down, pay by card (with a 3-D Secure bank check) or bank transfer, and later
  look up their order by reference and email to download the certificate PDF. Gift orders send the recipient a notice with no prices.
* **Staff** sign in through Keycloak: the *maker* uploads plate art; the *packer* finds boxes, packs them (card captured, courier booked), marks refunded boxes
  back on the shelf and clears the dead-letter list; the *treasurer* issues partial and full refunds, schedules the charity rate, issues monthly charity
  statements (PDF) and watches webhook deliveries to the charity.

## Run it

`run.json` holds the three commands the host runs in order, from this directory:

```
npm ci            # install, from the lockfile
npm run build     # vite builds the client into dist/client, esbuild bundles the server into dist/server
npm run serve     # node dist/server/main.mjs, foreground, 0.0.0.0:$APP_PUBLIC_PORT (default 4173)
```

`GET /api/health` answers `{"status":"ok"}` as soon as the server listens, also while a service is down. The schema, realm roles, seeded staff, search
indexes, queues, storage bucket and webhook application are created idempotently on every serve, retrying in the background for any service that is not yet up.

## Environment (read once at start by `server/config.ts`, never sent to the browser)

| Service | Variables |
|---|---|
| Postgres (system of record) | `DATABASE_URL` |
| Kill Bill (billing ledger) | `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` |
| WireMock (card gateway, bank, courier) | `WIREMOCK_URL` |
| Keycloak (staff sign-in) | `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` |
| Valkey (holds, lookup counters) | `VALKEY_URL` |
| RabbitMQ (durable events) | `AMQP_URL` |
| Meilisearch (search) | `MEILISEARCH_URL`, `MEILISEARCH_API_KEY` |
| MinIO (files) | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Gotenberg (PDFs) | `GOTENBERG_URL` |
| Mailpit (email) | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| Svix (outbound webhooks) | `SVIX_URL`, `SVIX_API_KEY` |
| ntfy (push alerts) | `NTFY_URL`, `NTFY_USERNAME`, `NTFY_PASSWORD` |
| App | `APP_PUBLIC_URL`, `APP_PUBLIC_PORT` |

Published settings (defaults in brackets): `HOLD_SECONDS` [600], `AUTH_SECONDS` [604800], `CHALLENGE_SECONDS` [300], `TRANSFER_SECONDS` [unset: banking-day deadline],
`LOOKUP_WINDOW_SECONDS` [900], `LOW_STOCK_THRESHOLDS` [24,5], `PRESS_NAMESPACE` [empty: prefixes every Valkey key, queue, index, topic and Svix application],
`PRESS_CLOCK_START` [unset: real time], `GATEWAY_CALLBACK_SECRET` [sandbox secret], `CHARITY_WEBHOOK_SECRET` [published signing secret], `CHARITY_WEBHOOK_URL` [unset].

## Layout

* `shared/` copy, domain constants, money arithmetic and the tale, imported by server and client.
* `server/` the Fastify API, the domain flows (holds, checkout, callbacks, packing, refunds, statements, fulfilment events), and the service clients.
* `client/` the React application; `client/src/scene` is the three.js scene (alley, visions, shelf, held match).
* `narration/` one Ogg file per chapter (offline speech synthesis of the public-domain text).
* `THIRD_PARTY_NOTICES.md`, `assets.json` licences and provenance of every dependency and asset.
