# Northbar Camera Hire Tallyslate

Renters price and hold serialised camera and lighting kits, upload insurance and confirm payment through a private booking link. Staff review insurance, publish rate cards, prep and scan units out and back in, store condition photos and maintain a paired movement ledger.

Run the three commands in `run.json`, in order:

```
npm ci
npm run build
npm run start
```

Use Node.js 22 LTS. Serve applies the Postgres schema and seed safely on every start, creates the MinIO bucket if necessary, and binds `0.0.0.0` on `APP_PUBLIC_PORT` (default 4173). Health is `GET /api/health`. Provider outages do not prevent pages or database health from being served.

Set all of these environment variables before serving:

| Service | Variables |
|---|---|
| Postgres | `DATABASE_URL` |
| Kill Bill | `KILLBILL_URL`, `KILLBILL_USERNAME`, `KILLBILL_PASSWORD`, `KILLBILL_API_KEY`, `KILLBILL_API_SECRET` |
| MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE` (`true` or `false`), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Mailpit SMTP | `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` |
| Process | `APP_PUBLIC_PORT` (default 4173), `HOLD_SECONDS` (positive integer, default 172800) |

There are no other environment variables or configuration defaults. `MAIL_FROM` supplies the sender, `Northbar Camera Hire <desk@northbar.example>`. All credentials remain on the server. No services beyond the four above are used. All runtime assets are local.

The initial staff passcodes are the brief's seeded owner and prep-tech passcodes. Sign in at `/desk`. Renters use the private link created after a hold; treat that link as private access to its booking.

`npm run typecheck` checks strict TypeScript. `node scripts/notices.mjs` regenerates package notices from the installed dependency tree and bundled font licences.
