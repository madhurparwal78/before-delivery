# Lowfield Console — project memory

## Environment
- /app is empty at start; build from scratch. Node 22.14.0, npm 10.9.2, internet access OK.
- Services (all reachable): Postgres at `DATABASE_URL`, MinIO at S3_ENDPOINT path-style bucket `S3_BUCKET`, Kill Bill at `KILLBILL_URL` (tenant id 1, KILLBILL_API_KEY=gfkit-dev + secret headers).
- Port: APP_PUBLIC_PORT=4173.

## Kill Bill integration (verified by probing)
- Every KB request needs: basic auth `KILLBILL_USERNAME:KILLBILL_PASSWORD`, `X-Killbill-ApiKey`, `X-Killbill-ApiSecret`, AND `Accept: application/json` (without Accept, JSON endpoints 404 with html).
- Catalog: `POST /1.0/kb/catalog` with `Content-Type: text/xml` (application/xml → 415, text/xml works). Simple-catalog JSON endpoint is NOT in this build (404). Catalog XML shape: see /tmp/lowfield-catalog.xml; used plan-level `<recurringBillingMode>IN_ARREAR` + `<usages><usage billingMode="IN_ARREAR" usageType="CONSUMABLE"><billingPeriod>MONTHLY</billingPeriod><tiers><tier><blocks><tieredBlock><unit>billable-second</unit><size>1</size><prices><price><currency>USD</currency><value>0.001</value></price></prices><max>-1</max>...`. Catalog uploaded returns 201. Empty-catalog check: `GET /1.0/kb/catalog` returns [] when none.
- Account: `GET /1.0/kb/accounts?externalKey=X` (200 or 404 html→treat missing). Create: `POST /1.0/kb/accounts` body {name, externalKey, currency:"USD", country:"US", timeZone:"UTC", referenceTime ISO}. Returns 201 empty body; re-read by key.
- Subscription: `POST /1.0/kb/subscriptions` body {accountId, externalKey, planName} ONLY (productName/billingPeriod/priceList must be omitted when planName given). 201. Lookup: `GET /1.0/kb/accounts/<id>/bundles` → array; bundle.subscriptions[] with subscriptionId, planName, state ACTIVE. NOTE: bundle externalKey is auto-set to bundleId, not our sub externalKey — look up by account bundles and find ACTIVE subscription with our externalKey. The sub externalKey is returned in subscriptions[].externalKey.
- Usage record: `POST /1.0/kb/usages` body {subscriptionId, trackingId, unitUsageRecords:[{unitType:"billable-second", usageRecords:[{recordDate:"YYYY-MM-DD", amount: 60}]}]} → 201. Duplicate trackingId → 400 code 50000 "A usage record with tracking ID X already exists" (treat as accepted per DP-46).
- Usage read: `GET /1.0/kb/usages/<subId>/billable-second?startDate=..&endDate=..` → rolledUpUnits amount.
- Plan change: `PUT /1.0/kb/subscriptions/<subId>` body {planName} → 204. Verify by reading bundle back (immediately ACTIVE with new plan).
- Startup seeding retried until KB reachable (catalog+accounts+subs by external key).

## Notes
- THIRD_PARTY_NOTICES.md must list prod dependency tree with licenses (MIT/ISC/BSD/Apache-2.0/0BSD/OFL-1.1 only).
- Node pg supports application_name via PGAPPNAME env or client config. Use dedicated client with `application_name: lowfield-stream:<session_id>` per stream (DP-19).
