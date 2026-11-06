# Kinora Video Studio

Kinora is an AI video studio for creators and small teams. This deployment includes the public
marketing site (home, product, pricing, team plan, enterprise, examples, use cases, workflows,
research, resources, privacy) and the signed-in studio where members write prompts, start
generations that cost credits, and watch them render to Ready.

## Seeded accounts

Every seeded account uses the same password: `deku-demo-pw-2026`

| Email | Name | Role | Workspace |
|---|---|---|---|
| owner@example.com | Mara Quinn | Owner | Northlight Studio (Team plan) |
| member@example.com | Theo Park | Member | Northlight Studio (Team plan) |
| creator@example.com | Ines Duarte | Owner | Ines Duarte's workspace (Standard plan) |

- `owner@example.com` / `deku-demo-pw-2026` — Mara Quinn, owner of Northlight Studio (Team plan, shared balance 13,664 credits)
- `member@example.com` / `deku-demo-pw-2026` — Theo Park, member of Northlight Studio
- `creator@example.com` / `deku-demo-pw-2026` — Ines Duarte, owner of her own Standard-plan workspace (595 credits)

## Running

- `npm install` then `npm run build` then `npm run serve` (see `run.json`).
- The server reads `APP_PUBLIC_PORT` (default 4173), `APP_PUBLIC_URL`, `DATABASE_URL`/`DB_URL`,
  `SMTP_HOST` and `SMTP_PORT` from the environment and listens on `0.0.0.0`.
- `GET /api/health` answers 200 once PostgreSQL is reachable.

## Email

Invitations and enterprise/licensing enquiries are sent over SMTP to Mailpit. The invitation
email contains the full join link; enquiries send one email to `sales@example.com` and one
acknowledgement to the enquirer.
