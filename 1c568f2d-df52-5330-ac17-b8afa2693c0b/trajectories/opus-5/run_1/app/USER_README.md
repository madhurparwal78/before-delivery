# Clearhouse — Fenwick Science Centre clearance desk

Clearhouse is the internal desk where Fenwick Science Centre staff clear small
interactive exhibit pieces before they reach the public wall.

## Signing in

Open `/login` and sign in with one of the seeded accounts below. Every account
uses the same passphrase:

```
deku-demo-pw-2026
```

| Work email | Name | Role | What the role may do |
|---|---|---|---|
| `rosa.aldridge@example.com` | Rosa Aldridge | `maker` | draft a piece, cite catalogue objects, submit it, revise it |
| `tobias.lund@example.com` | Tobias Lund | `maker` | the same, for its own pieces |
| `priya.raman@example.com` | Priya Raman | `licence_reviewer` | start a review, acknowledge flagged duplicates, record the licence review |
| `dan.whitlock@example.com` | Dan Whitlock | `access_reviewer` | start a review, record the accessibility review |
| `halima.osei@example.com` | Halima Osei | `lead` | clear, return, reject, schedule, unschedule, publish, withdraw, adjust fees, reset the quarter, export and import the pack |
| `gregor.pyne@example.com` | Gregor Pyne | `auditor` | read every staff surface and the audit trail, and export it |

## Surfaces

| Address | What it holds |
|---|---|
| `/` | the clearance queue, with the nine state counts and both review marks |
| `/pieces/<PIECE_ID>` | the piece desk and its decision rail |
| `/catalogue` | the board of 20,000 catalogue objects |
| `/catalogue/<OBJECT_ID>` | one object, its record and its duplicate check |
| `/schedule` | the featured schedule, one piece to a UTC day |
| `/budget` | the quarter budget, its committed total and the fee controls |
| `/audit` | the append-only trail, with filters and `Export CSV` |
| `/settings` | preferences, and the clearance pack for a lead |
| `/wall` | the public exhibit wall (no session needed) |
| `/wall/<PIECE_ID>` | one published piece's plaque |

## A first walk through

1. Sign in as Rosa, press `New piece`, save a title and a summary, then press
   `Add object` and cite a few objects. Press `Submit for clearance`.
2. Sign in as Priya, open the piece from `Needs my decision`, press
   `Start review`, then `Record licence review`. If a cited object carries
   `Possible duplicate`, follow its `View` link and press `Acknowledge` first.
3. Sign in as Dan and record the accessibility review.
4. Sign in as Halima, press `Clear for the wall`, book a free day on
   `/schedule`, and press `Publish now` once that day has arrived.
5. Open `/wall` with no session to see the card, and its plaque for the sources.

## Running it

`run.json` holds the install, build and serve commands. The app serves on
`0.0.0.0` at `APP_PUBLIC_PORT`, creates its schema and runs its seed on start,
and answers `GET /api/health` once the database is ready.
