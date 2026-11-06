# Ommezwaai Feeler

A storefront for city riders who want to replace a working 50cc petrol scooter with an electric one. It sells bolt-in retrofit kits and built e-mopeds, and before it takes a kit deposit it proves in millimetres that the kit fits the rider's own frame.

## What it does

- **Prove the fit.** Enter a plate (the shop reads the plate registry) or enter frame details by hand, drive the traction pack and hub motor along their rails in a live 3D drawing, and read the clearance at each station next to the server's verdict.
- **Quote and share.** Pack, hub, road class, units, fulfilment and delivery country update the figures in place and live in the address.
- **Pay in stages.** A deposit and three instalments, VAT per line in whole cents, paid through Kill Bill. A payment reads pending until Kill Bill's notification is believed. Instalments are collected monthly by the server; failures are retried and then move the order into arrears.
- **Refunds, withdrawal, workshop fitting.** The fitter refunds part of a line across payments; riders may withdraw; a posted kit may switch to workshop fitting with a VAT correction.
- **Test rides.** Compare bikes, hold a slot on the server's clock, confirm and cancel; the fitter opens slots and marks outcomes.
- **Desk.** The fitter sees provider-confirmed payments, issues refunds, dispatches or fits orders, records delivery and the class-move inspection.

## Run it

`run.json` holds the commands: `npm ci`, `npm run build`, `node --max-semi-space-size=4 dist/server/index.js` (a smaller young generation, since several instances may share a host). The server listens on `0.0.0.0` and `APP_PUBLIC_PORT` (default 4173) and serves the built client and the API from one process. `GET /api/health` answers `{"status":"ok"}` as soon as it listens. The provider variables below have no default: the process will not start without them.

## Environment

| Variable | Service | Use |
|---|---|---|
| `DATABASE_URL` | PostgreSQL | all shop data; schema and seed are applied on every start |
| `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` | Kill Bill | accounts, purchases, refunds, payment reads, health |
| `KILLBILL_CALLBACK_ORIGIN` | Kill Bill | origin of this instance's notification URL (default `http://main:<APP_PUBLIC_PORT>`) |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit | receipts, credit notes, VAT corrections, inspection and ride mails |
| `WIREMOCK_URL` | WireMock | the national plate registry stand-in |
| `APP_PUBLIC_PORT` | | listening port |
| `HOLD_SECONDS` | | test-ride hold length in real seconds (default 600) |
| `SESSION_SECONDS` | | session length in real seconds (default 43200) |
| `SHOP_CLOCK_START`, `SHOP_CLOCK_RATE` | | the shop clock that every business time rule reads |

Seeded accounts: `fitter@ommezwaai.example` (fitter) and three riders; passwords are published in the brief.
