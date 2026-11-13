# The Last Bundle — Svovlstik Press

A scroll-driven 3D picture book of Hans Christian Andersen's little match girl
that is also the storefront for 240 numbered keepsake boxes.

## Running it

```
npm ci
npm run build      # tsc for the server, vite for the client
npm run serve      # binds 0.0.0.0:4173, honours APP_PUBLIC_PORT
```

`run.json` holds the same three commands. Every credential is read from the
environment; nothing is hard-coded and nothing reaches the browser. The app
starts with any service down, answers `GET /api/health`, and picks each service
up when it returns.

## Where each rule lives

Each domain rule is decided in exactly one place.

| Rule | File |
|---|---|
| Price, sale split, refund split, gateway fee, box and payment transitions | `src/server/domain.ts` |
| Rounding half up and kroner formatting | `src/shared/money.ts` |
| Every published copy string | `src/shared/copy.ts` |
| The tale's eight passages and sentence splitting | `src/shared/tale.ts` |
| Copenhagen months, banking-day transfer deadline, edition close | `src/server/copenhagen.ts` |
| Business clock and real clock | `src/server/clock.ts` |
| Charity rate in force, effective dating | `src/server/rates.ts` |
| Hold grant, refusal and release | `src/server/holds.ts` |
| Box state writes, stock crossings, search sync | `src/server/boxes.ts` |
| Authorisation, capture, void, settle, refund | `src/server/payments.ts` |
| Signed callbacks, dedupe, ordering, waiting refunds | `src/server/callbacks.ts` |
| Outbox, deliveries, retries, dead letters | `src/server/fulfilment.ts` |
| Idempotency keys | `src/server/idempotency.ts` |
| Chapter ranges | `src/client/scene/chapters.ts` |
| Interface motion lengths and the one curve | `src/client/motion.ts` |

## Shapes worth remembering

- All money is integer øre. A box is 149,500 gross; the order total is 158,400.
  At the seed rate of 3150 basis points the charity share is 37,674 and the
  maker's is 81,926.
- A hold lives as a Valkey key `hold:<number>` with a TTL, so it ends on its own
  edge with nothing running. Postgres mirrors `held` for the Valkey-down shelf,
  and a once-a-second sweep reconciles the mirror and pushes the change over
  `GET /api/shelf/events`.
- At most one live claim per number: a Valkey set-if-absent plus the partial
  unique index `orders_one_live_claim`.
- `order.paid` and `box.packed` are written in the same transaction as the paid
  state and published to RabbitMQ afterwards, so a broker outage loses none.
  Each effect is guarded by a row in `event_effects`, so a redelivery repeats
  nothing.
- Certificates, statements and plate art live in MinIO; the app serves every
  download itself after its own check.
- Charity events are kept in `pending_webhooks` before they go to Svix, and
  maker alerts in `pending_alerts` before they go to ntfy, so an outage holds
  them rather than losing them.

## Testing notes

- A staff bearer token for scripts:
  `curl -s -X POST "$AUTH_ISSUER_URL/protocol/openid-connect/token" -d
  "grant_type=password&client_id=$AUTH_CLIENT_ID&client_secret=$AUTH_CLIENT_SECRET&username=packer&password=Packer-Press-2026!&scope=openid"`
- Short timers make the clocks observable: `HOLD_SECONDS=6`, `AUTH_SECONDS=20`,
  `TRANSFER_SECONDS=10`. `PRESS_CLOCK_START` moves the business clock.
- The Keycloak redirect goes to `APP_PUBLIC_URL`, so browse the app on the same
  host as that value or the staff session cookie will not follow you back.
- `scripts/make-narration.sh` regenerates the seven narration files. It needs
  `espeak-ng` and `ffmpeg`, which are build-time tools only.
