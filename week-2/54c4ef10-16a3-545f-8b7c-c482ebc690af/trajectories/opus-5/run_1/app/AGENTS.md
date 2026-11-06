# Edgeprint — repository notes

A personal archive for home-developed 35mm and 120 film: shooting logs, strip
scans, frame detection, note-to-frame alignment, calibrated density and the
film's characteristic curve. PostgreSQL and MinIO are the only datastores.

## Layout

```
run.json                 install / build / serve manifest (run-manifest-v1)
requirements.txt         numpy, pillow, psycopg2-binary
server/
  __main__.py            waits for PostgreSQL, seeds, prepares the bucket, serves
  config.py              every credential and endpoint, read from the environment
  web.py                 HTTP server, sessions, static files, page shell routing
  pages.py               the page shell, signed-out redirects and the bootstrap
  api.py                 routing table, auth, rolls, entries, alignment, curves
  scans_api.py           uploads, calibration, detection, nudges, readings
  records.py             loading one account's records, deriving every figure
  pixels.py              stored original -> linear values, with a decode cache
  storage.py             MinIO over SigV4 (originals and preview slices)
  db.py                  pool and the idempotent schema
  copy.py                every published message, shared with the browser
  validate.py            field validation and the published limits
  errors.py              the one error shape
  seed.py                the seeded accounts, rolls and shooting logs
  domain/                exposure, density, frames, alignment, curve, rounding
  imaging/               png.py, tiff.py (file checks), scan.py (linear+previews)
static/
  app.css                the darkroom look
  js/                    ES modules: boot, api, format, exposure, strip, negative
  js/screens/            landing, auth, archive, rollform, roll, workspace, …
  js/components/         counters, entries, curve, override dialog
  fonts/                 bundled Host Grotesk (OFL-1.1)
```

## Rules that live in exactly one place

| Rule | Module |
|---|---|
| Rounding half away from zero | `server/domain/rounding.py` (and `format.js`) |
| Aperture table, shutters, stops, reciprocity | `server/domain/exposure.py`, handed to the browser through the page bootstrap and used by `static/js/exposure.js` |
| Linearisation, transfer detection, previews | `server/imaging/scan.py` |
| PNG and TIFF file checks | `server/imaging/png.py`, `server/imaging/tiff.py` |
| Calibration and gross density | `server/domain/density.py` |
| Detection, width flag, base plus fog, nudges | `server/domain/frames.py` |
| Matching, proposal, counters, states | `server/domain/alignment.py` |
| Curve, speed point, contrast index, zone, meter bias | `server/domain/curve.py` |
| Negative tint | `static/js/negative.js` |
| Published copy | `server/copy.py` (injected into the page as `copy`) |

## Working notes

- Densities are stored (frame `mean_density`, scan `base_fog`) so counters and
  the contact sheet stay readable while storage is down; every other figure is
  derived on read in `records.py`.
- `pixels.linear_values` always touches storage, so a loupe reading answers
  `503` during an outage even when the decode is cached.
- Pillow decodes only the formats it keeps every bit of (8-bit, or 16-bit
  greyscale); 16-bit multi-channel files go through `png.py` / `tiff.py`.
- The frontend is a vanilla ES-module SPA. The server still redirects
  signed-out page requests to `/signin?next=…` so deep links behave.
- Seeded accounts: `ines@edgeprint.test` / `safelight-ines-42`,
  `teo@edgeprint.test` / `safelight-teo-42`.

## Checks run so far

- `run.json` install and build from an empty `.venv`, then serve and seed.
- End-to-end API exercise: upload, calibrate (clear light and step wedge),
  detect, propose, align, override, pin, nudge, curve figures, meter bias.
- Crafted PNG/TIFF refusals: palette, 1/2/4-bit, CMYK, white-is-zero,
  predictor 3, PackBits, tiled, multi-page, IFD loops, bad CRCs, split IDAT,
  short and long image streams, oversized text chunks.
- Ownership and precedence: another account's ids in paths and bodies,
  cross-origin writes, body limits, wrong content types, source paths.
- Concurrency: simultaneous identical uploads, overlapping nudges, split
  nudges on one frame, simultaneous alignment saves, ten cut-off uploads.
- Browser (Chromium via Playwright): every journey, the keyboard dialog, the
  loupe, uploads with announcements and focus, expired-session drafts, the
  three viewports and the storage outage (a second instance pointed at a dead
  S3 endpoint on port 4174).

A bug worth remembering: answering a request without reading its body
desynchronises a keep-alive connection. `web.Handler._settle_body` drains or
closes, and every 401/404/409 upload path depends on it.
