# Lowlamp Field Log

A night-first observing log for one backyard deep-sky observer working toward observing-program certificates.
At the eyepiece, often with no signal, the observer logs each object (UT time, seeing, transparency, optics,
description) and sketches it on an eyepiece circle that tracks the true field and the north/east marks for the
optical train in use. At the home desk the observer tidies notes, checks what a program packet still lacks,
renders the packet as a PDF and emails it to the program's volunteer coordinator.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (type-checks, then bundles the server to `dist/server.mjs` and the browser app to `dist/public/`) |
| serve | `npm run start` (`node dist/server.mjs`, in the foreground on `0.0.0.0:$APP_PUBLIC_PORT`, default 4173) |

Node.js 22 is required. The app applies its schema and seed data (catalogue, programs, two demo observers) idempotently
at every start. `GET /api/health` answers `503 {"status":"starting"}` until Postgres is reachable, then `200 {"status":"ok"}`.

## Environment

| Variable | Service / use |
|---|---|
| `DATABASE_URL` | Postgres: every record, including sign-in attempt counts and locks |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | MinIO: stroke files, sketch images, packet PDFs |
| `GOTENBERG_URL` | Gotenberg: renders each packet to a US Letter PDF |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | Mailpit (SMTP): the packet message; `MAIL_FROM` defaults to `Lowlamp Field Log <packets@lowlamp.test>` |
| `SIGNIN_LOCK_SECONDS` | optional: the rolling failure window and the lock length (default 900) |
| `SIGNIN_SESSION_SECONDS` | optional: the sign-in session lifetime (default 2,592,000) |
| `APP_PUBLIC_PORT` | the port to bind (default 4173) |

Nothing is read from the browser; no credential reaches it. The renderer, storage and the mail server may be down at start:
the app boots and each feature recovers on the next action.

## What it does

- Sign up and in (email compared trimmed and lowercased; five wrong sign-ins lock an email).
- Kit: telescopes (aperture in mm or in), eyepieces, Barlows and sites.
- Session screen: eyepiece circle with compass, Sketch tools, live optics readout, the Field swap when optics change,
  keyboard (arrows, 1-5, Enter, brackets, Ctrl/Cmd+Z), touch and stylus sketching, double-star measuring.
- Works offline: the device holds the whole account; every write goes through an ordered, replay-safe sync journal that
  is sent when signal returns, shared by all tabs of one browser.
- Object history, programs with rule editions and progress, packets (check, reorder, render, send) with a paper preview.

## Stack

TypeScript throughout; Node `http` + `pg` on the server, Preact in the browser, Sora served from the app.
