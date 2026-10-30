# Kinora Video Studio

Kinora is an AI video studio for creators and small teams. The public site explains the studio, compares its credit
plans and takes enterprise and model-licensing enquiries. The signed-in studio lets a member write a prompt, choose a
model, a length (or an image count) and an aspect, and start a generation paid for in credits from the workspace's one
shared balance. The server draws every generation itself as a deterministic SVG from the words of the prompt and moves
it from Queued to Rendering to Ready on its own.

## Seeded accounts

Every seeded account uses the password `deku-demo-pw-2026` (benchmark fixture data).

| Email | Name | Role | Workspace |
|---|---|---|---|
| `owner@example.com` | Mara Quinn | Owner | Northlight Studio (Team plan, 13,664 credits) |
| `member@example.com` | Theo Park | Member | Northlight Studio (Team plan) |
| `creator@example.com` | Ines Duarte | Owner | Ines Duarte's workspace (Standard plan, 595 credits) |

Anyone can also sign up at `/signup` and gets a Free workspace with 125 credits and "My first project".

## Running it

`run.json` holds the three commands, run from this directory:

| Step | Command |
|---|---|
| install | `npm ci` |
| build | `npm run build` (Vite builds the browser app and its server renderer; `tsc` compiles the NestJS server) |
| serve | `node dist/node/server/main.js` (foreground, listens on `0.0.0.0`) |

On start the server creates its tables if they are missing and seeds the accounts above once; restarting changes
nothing. `GET /api/health` answers 200 once PostgreSQL answers.

## Environment

| Variable | Used for |
|---|---|
| `DATABASE_URL` (or `DB_URL`) | PostgreSQL, the only datastore |
| `SMTP_HOST`, `SMTP_PORT` | Mailpit over SMTP, no authentication (`SMTP_USER`/`SMTP_PASS` stay empty); mail is sent from `studio@example.com` |
| `APP_PUBLIC_PORT` | the port to listen on (default 4173) |
| `APP_PUBLIC_URL` | the public address written into invitation links (required) |

## Services it talks to

- **PostgreSQL**: workspaces, users (with the hashes of their live sign-in tokens), projects, generations, credit entries, invitations and enquiries. The
  balance is the sum of the workspace's credit entries; starts, cancels and joins lock the workspace row so a charge,
  a refund and a seat are each recorded exactly once.
- **Mailpit (SMTP)**: the team invitation and the two enquiry emails. If mail cannot be delivered the invitation or
  enquiry is still stored and the request still succeeds; the failure is written to the server log.

The server calls no other service. It logs one line per HTTP request (method, path, status, time) to standard output.
