# Edgeprint — agent notes

A personal film archive (35mm / 120) for home developers: shooting log with
reciprocity correction, strip scans with automatic frame finding, note↔frame
alignment with slip detection, densitometer loupe over the negative, and a
characteristic curve drawn from a bracket test roll.

## Layout

- `run.json` — install / build / serve manifest (IF-01).
- `requirements.txt` — production dependency tree; every licence is on the
  allow-list (IF-02, IF-03). Do NOT add `minio`, `certifi` (MPL-2.0) or
  `argon2-cffi`: object storage is a direct S3 client on `urllib3`, and
  passwords use the stdlib `hashlib.scrypt`.
- `edgeprint/` — the application.
  - `exposure.py` — the aperture table, shutter parsing, reciprocity and the
    rounding rule. The browser fetches the same table via
    `GET /api/config/apertures`; there is no second copy.
  - `imaging/` — PNG/TIFF decode with the published refusal checks, transfer
    (linear / sRGB / gamma) and preview slices.
  - `darkroom.py` — calibration densities, frame detection, sample cells.
  - `alignment.py` — matching, the Spearman proposal, counters, curves.
  - `service.py` — every read-side serialisation and the curve/meter-bias
    derivation from the database rows.
  - `routes.py` — the published endpoint table.
  - `server.py` — the app assembly, the one error shape, sessions,
    cross-origin refusal and the body limits.
  - `storage.py` — direct S3 (SigV4) client; the only place with keys.
  - `seed.py` — seed data created only when there are no accounts.
- `edgeprint/static/` — browser code, no build step, served same-origin.
- `tests/` — development-only test scripts; not shipped.

## Conventions that matter

- Each published rule is decided in exactly one module (see above) and reused
  everywhere else. When a rule changes, change it in that module only.
- Every refusal answers the one error shape; field copy lives in
  `server.FIELD_MESSAGES`, non-field copy in `server.ERROR_COPY`.
- The DB schema is applied idempotently at every start (`db.apply_schema`).
- Seeded accounts: `ines@edgeprint.test` / `safelight-ines-42`,
  `teo@edgeprint.test` / `safelight-teo-42`. If you change the password
  hashing, truncate the tables so the seed re-runs.
- Test scripts sign in as ines and create throwaway rolls; they assume a
  running server on `127.0.0.1:4173` except `test_outage.py`, which runs the
  app in-process on an ephemeral port.
