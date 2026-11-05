# Turnstone Studio

A self-hosted storefront and publishing pipeline for one independent 3D model author. The author
uploads a model package, watches it pass a publishing queue that validates it, converts it to a
real-time GLB in metres and a print-ready STL in millimetres, renders a preview and indexes it, then
sets visibility, licence prices and limited editions and sells licences directly to visitors.

## Running it

The app starts cold from its own manifest:

```bash
npm ci        # install
npm run build # build
npm run start # serve
```

It listens on `APP_PUBLIC_PORT`, or 4173 when that is unset, and answers `GET /api/health` with
`200 {"status":"ok"}` once it is ready.

### Services it needs

| Service | Used for |
|---|---|
| PostgreSQL | source of truth: models, revisions, queue jobs, state, plans, collections, licences, edition units, idempotency records |
| MinIO | submitted packages byte for byte under their SHA-256, plus both derivatives and the preview |
| Kill Bill | the author's plan subscription, and every purchase and refund as an invoice and payment |
| Mailpit | receipt, refund and plan-change email |
| Meilisearch | the public catalogue index and its facets |

Each service address and credential arrives in the environment; none is compiled in.

## Signing in

Seeded accounts, each landing on its own route:

| Role | Email | Password | Lands on |
|---|---|---|---|
| Author | `author@ashgrove.test` | `turnstone-author-1` | `/studio` |
| Editor | `editor@ashgrove.test` | `turnstone-editor-1` | `/studio/review` |
| Contributor | `kit@contrib.test` | `turnstone-contrib-1` | `/contribute` |
| Contributor | `sol@contrib.test` | `turnstone-contrib-2` | `/contribute` |
| Staff | `support@ashgrove.test` | `turnstone-staff-1` | `/staff` |

Visitors browse and buy without an account; a purchase returns a receipt link at `/r/<token>`.

## What each role can do

- **Author** uploads packages, watches the queue, sets visibility, prices, licences, editions, the
  default camera and hotspots, and manages plan limits, collections, embeds, read API keys and the
  catalogue export.
- **Visitor** browses the faceted catalogue, inspects a model in the Survey Ring and buys a licence
  or claims a numbered limited-edition copy.
- **Contributor** submits model drafts and texture sets for review and sees nothing but their own.
- **Editor** reviews drafts, moves models between draft, in review, published and withdrawn, and
  curates collections.
- **Staff** finds orders, issues seat and full refunds and checks service and queue health. Staff
  never see a service credential or address.

## Reading the catalogue from outside

A documented read API serves the published catalogue with capped pagination and a documented sort
tiebreak. It accepts only keys the author has issued, allows 60 requests per key in any 60 seconds
and answers the 61st with `429` and a `Retry-After` hint. Published models can also be embedded in a
third-party page; an embed stops rendering once the model is withdrawn or hidden, or the plan falls
below Pro.

## Interface

Every screen works by keyboard alone, at 375, 768 and 1280 pixels wide, and under reduced motion.
The interface is published in English and German; switching language keeps the reading position and
re-renders every string, amount and date in that locale's format.
