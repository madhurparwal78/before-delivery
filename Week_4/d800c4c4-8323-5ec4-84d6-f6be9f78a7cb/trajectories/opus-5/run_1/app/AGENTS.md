# Pegworth Desk — working notes

Counter, catalogue and back office for a neighbourhood tool library. One Node
process serves the browser app and the API; state lives only in Postgres, the
Kill Bill tenant and the S3 bucket.

## Running it

```
npm ci && npm run build && npm run start   # binds 0.0.0.0 on APP_PUBLIC_PORT, default 4173
npm run typecheck                          # strict tsc, no emit
npm run notices                            # regenerates THIRD_PARTY_NOTICES.md
```

`run.json` holds the grader's `install`, `build` and `serve` commands. Every
service URL and credential is read from the environment at start (`src/server/env.ts`)
and never reaches the browser.

## Layout

| Path | What lives there |
| --- | --- |
| `src/shared` | Types, published copy, money and status-word formatting, library-time primitives, and the sign-in `next` rule. Imported by both sides. |
| `src/server/domain` | Pure rules: the opening calendar, fee lines, loan/hold/fee/membership transitions, board placement and counts, session idleness, passwords. |
| `src/server/repo` | Schema, seed and the queries that build each API resource. |
| `src/server/services` | Kill Bill, S3 (hand-rolled SigV4), SMTP, the outbox and the status prober. |
| `src/server/http` | The one refusal pipeline, the router, the boundary checks and the route modules. |
| `src/client` | React app: screens, the pegboard SVG, dialogs with focus traps, polls. |

## Rules that live in exactly one place

- Library wall-clock conversion, repeated and skipped times — `src/shared/time.ts`
- Open days, due dates, `due_by`, the closing instant, lateness — `src/server/domain/calendar.ts`
- Fee lines, the per-item cap, late fee so far — `src/server/domain/fees.ts`
- Loan, hold, fee and membership transitions — `src/server/domain/transitions.ts`
- Board placement, counts and item status — `src/server/domain/board.ts`
- Outline, item, loan and fee status words — `src/shared/status-words.ts`
- Hold queue positions — `readHolds` in `src/server/repo/inventory.ts`
- A loan's open days late and late fee so far — `overdueFiguresFor` in `src/server/repo/loans.ts`
- Whether a session has ended — `src/server/domain/session.ts`
- Whether a sign-in `next` path is followed — `destinationAfterSignIn` in `src/shared/screens.ts`
- The API error precedence — `runRoute` in `src/server/http/pipeline.ts`

The browser never counts days or works out money. It formats what the API
returns, and converts typed Return time text to an offset only for sending.

## Things worth knowing before changing them

- **Lateness is compared on wall-clock time, not instants.** That is what makes
  both halves of the hour the clocks repeat land on the same library date and
  give the same open days late.
- **Fee invoices are raised as Kill Bill drafts** and committed when the fee is
  paid or waived. Kill Bill refuses a credit aimed at a committed invoice, and an
  account-level credit is applied to whichever invoice is oldest — which would
  clear the wrong fee when a member owes more than one. Crediting the draft keeps
  the waiver on that fee's own invoice.
- **The account invoice list leaves `items` out and reports `amount` as 0.** Read
  each invoice singly with `?withItems=true`.
- **Kill Bill account tags** are posted as a JSON array in the body, not as a
  query parameter, or `AUTO_PAY_OFF` silently never applies.
- **Joins take a transaction-scoped advisory lock on the email,** so simultaneous
  joins give one 202 and one 409 rather than two Kill Bill accounts.
- **Photo objects are written only after a loan's transition is won,** and are
  deleted again if Kill Bill then fails, so a refused or losing request leaves
  nothing in the bucket.
- **A session that one instance judges ended is written down as ended,** so it
  never comes back on an instance with a longer `SESSION_IDLE_SECONDS`.
- **`usePoll` ignores 401s and skips `setState` when the JSON is unchanged.** That
  is what keeps refreshes from disturbing focus, dialogs, typed text or photos.
- Dialogs take focus from `Dialog`'s mount effect, never `autoFocus`, so a dialog
  opening on top of another gets focus after the one below has gone inert.
