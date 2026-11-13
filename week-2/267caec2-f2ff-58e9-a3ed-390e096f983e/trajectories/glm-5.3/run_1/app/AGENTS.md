# Cutline Jury Desk

A juried web and digital design prize program: studios enter paid submissions,
jurors score blind entries against conflicts, and the director runs rounds into
a normalised shortlist cut and embargoed reveals.

## Repository map

- `run.json` — install, build and serve commands (`npm ci`, `npm run build`, `npm start`). The server binds 0.0.0.0 on `APP_PUBLIC_PORT` (default 4173).
- `src/server/` — TypeScript server. `index.ts` boots, applies the schema and seed in the background, and runs the email sender, jury-packet rewriter and embargo watcher loops.
- `src/server/domain/` — every business rule in one place: `time.ts` (zone boundaries and labels), `entries.ts` (entry state machine, fee tier, studio masking), `rounds.ts` (panel counts, round guards, standings, jury packet), `scoring.ts` (round score, ranking, exact half-up rounding), `images.ts` (upload checks and re-encoding), `mail.ts` (queued emails), `programs.ts`, `seed.ts`.
- `src/server/api/` — route handlers per resource; all errors flow through `http/errors.ts`.
- `src/server/providers/` — Kill Bill, S3/MinIO and SMTP clients; each turns failure into its documented 503 without retrying inside a request.
- `src/client/` — TypeScript client bundled by esbuild (`main.ts` routes; `pages/` screens; `shuffle.ts` is The Cut Shuffle).
- `THIRD_PARTY_NOTICES.md` — shipped packages, bundled fonts (Archivo, IBM Plex) and the Lucide icon set.

## Local development notes

- The provided Kill Bill in this environment answers with a bare Tomcat 404 on every `/api/v1` path; the desk correctly treats that as billing being unreachable (`503 payments_paused`) and keeps drafts unchanged. To exercise the payment path locally, a throwaway Kill Bill emulator can be run on `127.0.0.1:9999` and the desk restarted with `KILLBILL_URL=http://127.0.0.1:9999`. No mock exists inside the app.
- `dist/` is generated build output. `npm ci && npm run build && npm start` reproduces it.
- Postgres credentials and provider URLs are read from the environment only (see `src/server/config.ts`).
