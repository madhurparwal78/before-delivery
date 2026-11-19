# Fio Contado Desk

A working desk for one independent life-cycle assessor: gathers supplier facts through private answer pages by mail,
records meter readings on a phone with poor signal, works out a footprint across six measures from a third-party
factor library, compares reduction scenarios, asks a third-party score service for the textile score, makes a
signed-off dossier PDF and publishes a public product passport.

## Run it

The commands are in `run.json`:

```sh
npm ci          # install from the lockfile
npm run build   # type-check, then bundle server and client into dist/
npm start       # serve on 0.0.0.0:$APP_PUBLIC_PORT (default 4173)
```

The schema and seed apply themselves on every serve, and several copies starting together are safe.

## Environment

| Variable | Service | Default |
|---|---|---|
| `DATABASE_URL` | Postgres, every desk's data | required |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO, evidence and dossier files | required |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit over SMTP | required |
| `WIREMOCK_URL` | the factor library and the score service | required |
| `GOTENBERG_URL` | Gotenberg, the dossier PDF | required |
| `APP_PUBLIC_URL` | the address used in private page mail | required |
| `APP_PUBLIC_PORT` | the listening port | `4173` |
| `SESSION_SECONDS` | session lifetime | `28800` |
| `ANSWER_PAGE_SECONDS` | answer page lifetime | `1209600` |
| `SIGN_OFF_PAGE_SECONDS` | sign-off page lifetime | `1209600` |
| `REMINDER_AFTER_SECONDS` | one reminder after | `604800` |
| `REQUEST_RATE_WINDOW_SECONDS` | request limit window | `3600` |
| `FILE_RATE_WINDOW_SECONDS` | download limit window | `3600` |
| `CLOSURE_WAIT_SECONDS` | wait before a closed label is erased | `2592000` |

No value reaches the browser. When a provider is unreachable the app still starts and answers `/api/health`; only the
actions that need that provider answer their 503.
