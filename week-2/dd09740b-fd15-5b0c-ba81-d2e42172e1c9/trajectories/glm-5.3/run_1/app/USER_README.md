# Northpier Studio — inquiry desk

The public site and new-business desk of Northpier Studio, a small design and
technology studio in Stockholm. Visitors browse eight case studies, send a
project inquiry from `/start` and follow it on a private status page. Two
studio accounts work the inquiry queue in `/studio`.

## Studio accounts

All seeded accounts use the password `deku-demo-pw-2026`.

| Name | Email | Role |
|---|---|---|
| Sana Holm | `sana@example.com` | `lead` |
| Ole Berg | `ole@example.com` | `associate` |

The lead can do everything: work the queue, start reviews, book and reschedule
intro calls, add notes, and also mark inquiries won, decline them and reopen a
declined inquiry. The associate reviews inquiries, books and reschedules intro
calls and keeps notes, but cannot close a deal.

## Fixture status links

Each seeded inquiry's status token is `seed-` followed by the reference in
lowercase without its hyphen, followed by `-status-link`. For example, the
fixture status link of `NP-Q7LD4V` is:

```
/inquiry/seed-npq7ld4v-status-link
```

## Running

`run.json` holds the `install`, `build` and `serve` commands. The app serves
on the port in `APP_PUBLIC_PORT` (default 4173), stores everything in
PostgreSQL at `DATABASE_URL` and sends every email over SMTP to Mailpit at
`SMTP_HOST`:`SMTP_PORT`. The schema and the seed are applied automatically on
every start; the seed runs only into an empty database.
