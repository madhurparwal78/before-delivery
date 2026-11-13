# Squallglass

A browser lane-defence strategy game in Orrel Sound. Create an account, learn in unranked practice, earn verified campaign completions, make and prove private challenge revisions, publish challenges, compete on ordinary and Kathmandu season boards, and study immutable command replays with shared playback.

Requires Node.js 20 or later and the three configured backing services. From this directory, use the commands in `run.json`:

```
npm ci
npm run build
npm run start
```

The foreground server binds `0.0.0.0`; `APP_PUBLIC_PORT` selects its port, default `4173`. `/api/health` returns liveness even during dependency outages. Serving applies schema, seed encounters and index settings idempotently. No provider is needed at build time. Missing service configuration emits diagnostics without stopping static pages; dependent operations return the documented unavailable response.

Environment variables read at startup:

| Variable | Service / purpose |
|---|---|
| `APP_PUBLIC_PORT` | HTTP listener port |
| `DATABASE_URL` | PostgreSQL application connection string |
| `S3_ENDPOINT` | MinIO endpoint |
| `S3_REGION` | MinIO signing region |
| `S3_BUCKET` | Existing private MinIO bucket |
| `S3_FORCE_PATH_STYLE` | MinIO addressing; `true` for path style |
| `S3_ACCESS_KEY_ID` | MinIO application access key |
| `S3_SECRET_ACCESS_KEY` | MinIO application secret |
| `MEILISEARCH_URL` | Meilisearch endpoint |
| `MEILISEARCH_API_KEY` | Meilisearch application API key |

All service settings are required explicitly. Credentials stay on the server. Only PostgreSQL, MinIO and Meilisearch hold persistent state; there is no browser-storage fallback. Multiple processes can share these providers.

The browser and authoritative verifier import `src/shared/simulation.ts`. Rules are inspectable at `/api/rules` and through Rules navigation. Charge and time conversion is centralized in `src/shared/format.ts`; ranking is server-only. Source remains available for review in `src/`, but HTTP serves only the built public directory and documented APIs.

Use `npm run typecheck` for strict TypeScript and unused-symbol checks. `assets.json` inventories bundled font binaries; `THIRD_PARTY_NOTICES.md` lists runtime and build packages and full font licences. All other visual artwork is original procedural SVG/CSS.
