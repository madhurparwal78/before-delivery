# Sollis Studio Folio

Folio is the commissioning site of Maren Sollis, an independent designer. A brand, marketing or product lead reads what each of the three services includes, weighs the evidence in past work, and sends a structured commission brief. The brief is stored, mailed to the studio with an acknowledgement to the sender, and can be downloaded as a one-page PDF to forward to a buying committee. Maren Sollis, the studio's clients and every person and business on the site are fictional.

## Run it

`run.json` holds the three commands:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (compiles the server and the browser code with `tsc`, copies the two Instrument font files from their npm packages) |
| serve | `npm run start` (foreground, binds `0.0.0.0` on `APP_PUBLIC_PORT`, default 4173) |

Node 22. On every start the server applies its schema idempotently and stores the starting content when the database is empty. While Postgres is unreachable it retries every 2 seconds and starts answering once it connects.

## Environment

| Variable | Used for | Service |
|---|---|---|
| `DATABASE_URL` | projects, statistics, content edition and every enquiry | Postgres |
| `SMTP_HOST`, `SMTP_PORT` | the two plain-text messages of each enquiry | Mailpit (SMTP) |
| `MAIL_FROM` | the From header of both messages | Mailpit |
| `STUDIO_EMAIL` | recipient of the studio copy, also shown on the site | Mailpit |
| `GOTENBERG_URL` | renders the brief PDF from HTML | Gotenberg |
| `GRADING_KEY` | header `X-Grading-Key` of the grading routes; without it they do not exist | n/a |
| `APP_PUBLIC_PORT` | listening port | n/a |

Nothing from this list is sent to the browser, apart from the studio email address, which the site prints as its contact address.

## Pages and routes

- `/` home, `/work/<slug>` case study (`?category=<id>` keeps a sequence), `/privacy`, `/briefs/<token>.pdf` brief PDF; anything else answers the not-found page.
- `POST /api/enquiries`, `GET /api/health`, and under `/api/grading`: `PUT` and `DELETE /content`, `GET /enquiries`.
- Content changes only through `PUT /api/grading/content`; `DELETE` restores the starting content and restarts references at `SOL-0001`.

## Layout of the source

- `src/shared`: the single published copy, the enquiry checks and the project sequence rule, used by server and browser.
- `src/server`: configuration, Postgres, content store and shape validation, enquiry rules, SMTP client, brief rendering, page markup, plates, HTTP.
- `src/client`: the router with Cover Carry, home behaviours, the enquiry form, the case-study showcase, the menu.
- `public/app.css`: the stylesheet. Fonts are served from `dist/public/fonts` after the build.
