# Undersign — repository notes

Collaborative document e-signing for Wickmoor Paper Co. TypeScript on Node.js 22
for both server and browser. Exactly three services: PostgreSQL, MinIO, Mailpit.

## Layout

```
run.json                 install / build / serve manifest
scripts/build.ts         esbuild bundles the server and the browser app into dist/
src/shared/              rules and copy both sides need
src/server/              HTTP, domain, data access, PDF toolkit, service adapters
src/client/              the browser app: screens, ui helpers, stylesheet
```

`npm run build` type-checks both programs, bundles `src/server/main.ts` to
`dist/server/main.js` and `src/client/main.ts` to `dist/public/assets/app.js`,
then copies the fonts and the pdf.js renderer beside them. `npm run start`
serves `dist/`.

## Where each domain rule is decided

Every rule lives in exactly one place. Change it there, nowhere else.

| Rule | File |
|---|---|
| Document transitions | `src/server/domain/transitions.ts` (`canDocumentMove`) |
| Recipient transitions | `src/server/domain/transitions.ts` (`canRecipientMove`), performed in `model/flow.ts` |
| Link state precedence | `src/server/domain/linkState.ts` |
| Next step text, row status words | `src/shared/nextStep.ts` |
| Field clamping, default sizes, minimum size | `src/shared/geometry.ts` |
| Audit hash and chain | `src/server/domain/audit.ts` |
| Role checks | `src/server/domain/roles.ts` |
| Field completeness and the walk order | `src/shared/fields.ts` |
| Every published string | `src/shared/copy.ts` |

## Things worth knowing

- **No PDF library.** `src/server/pdf/` is a small toolkit: `parse.ts` indexes a
  file by scanning for `N G obj` markers rather than trusting its cross-reference
  table, `build.ts` writes every object plainly so pages can be counted by
  reading the file, and `complete.ts` wraps each original page in a form XObject
  and draws the field values over it. Node's `zlib` covers FlateDecode.
- **No S3 or SMTP library.** `services/storage.ts` signs its own SigV4 requests;
  `services/mail.ts` speaks SMTP directly, which is what keeps mail headers
  exactly as the brief specifies (`headerSafe` folds each run of CR/LF into one
  space).
- **Live updates** use one SSE route, `/api/events`, with a `scope` query. The
  server recomputes the screen's payload every second and pushes it only when it
  changed, so a change made by another instance sharing the database arrives
  without any cross-instance messaging.
- **Motion runs on `requestAnimationFrame`**, never CSS transitions, because the
  verifier pauses and advances the browser clock. `ui/motion.ts` has `animate`
  for one-shot travel and `Glide` for the panel and sheet, which reverses from
  wherever it is instead of jumping.
- **Reminder links.** Link secrets are stored only as hashes, so a reminder
  issues its own link inside the turn's existing lifetime; the signer's earlier
  link keeps working and its expiry does not move. `new-link` instead
  deactivates every earlier link.
- **Completed-copy links.** Sealing issues a fresh link per recipient for the
  download line in the completed email. The document is closed by then, so every
  link for it reports `completed` and can fetch the PDF.
- **Mail goes out before the HTTP response** on send, new link, finish, decline
  and void, so a caller that reads Mailpit or the document JSON straight after
  sees the settled delivery state.
- **The one place JSON takes a shape** is `shaped()` in `src/client/api.ts` and
  `pdfjs()` in `src/client/ui/pdfjs.ts`. Database rows are declared as type
  aliases, not interfaces, so they satisfy `pg`'s row constraint without casts.

## Verifying changes

There is no test suite in the repository. To check a change by hand, run the
four grading instances (main plus the storage-down, email-down and short-timer
copies) and drive them with a browser:

- main on 4173; storage at a dead address on 4174; email at a dead address on
  4175; `LINK_TTL_SECONDS=8 REMINDER_COOLDOWN_SECONDS=4 MAIL_RETRY_SECONDS=2`
  with its own bucket on 4176.
- Mailpit's API at `http://mailpit:8025/api/v1/messages` reads the mail.
- `POST /api/grading/setup` with `X-Grading-Key: $GRADING_KEY` seeds teams and
  documents; `GET /api/grading/samples/<name>` serves the built-in PDFs.

Held email and failed seals are retried by `services/workers.ts` on a one-second
tick, but only on an instance whose latest health check passes for both email
and storage.
