# Wren Calendar — repository notes

One shared calendar for a 14-person consultancy across New York, London and
Auckland. Go 1.27 serves the API, the live connection and the built
TypeScript front end from one binary.

## Running it

```
go mod download && npm ci        # install
npm run build && go build -o bin/server .   # build
./bin/server                     # serve, on 0.0.0.0:4173
```

Every address and credential is read from the environment at start:
`DATABASE_URL`, `GOTENBERG_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`,
`S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, plus the
optional `TRASH_RETENTION_SECONDS`, `SHARE_LINK_TTL_SECONDS`, `CLOCK_START`
and `CLOCK_RATE`. Nothing is hard-coded and nothing reaches the browser.

`scripts/restart.sh` rebuilds and restarts for local checks.

## Where each rule lives

Each domain rule is decided in exactly one place:

| Rule | Place |
| --- | --- |
| Server clock | `internal/clock` |
| Zones, gaps, repeated hours, offsets | `internal/domain/zone.go` |
| Repeat rules and their generation | `internal/domain/rrule.go` |
| Occurrences, exceptions, zone warnings | `internal/domain/occurrence.go` |
| Access levels, guest switches | `internal/domain/access.go` |
| Published field lists | `internal/domain/project.go` |
| Working hours, clocks | `internal/domain/model.go` |
| Series edits, splits, trash transitions | `internal/api/events.go` |
| Replies, automatic declines | `internal/api/replies.go` |
| Proposal transitions | `internal/api/proposals.go` |
| Reminders | `internal/api/reminders.go` |
| Print transitions | `internal/api/prints.go` |
| Change log projection | `internal/api/changes.go` |
| Overlap lanes, midnight pieces, shown times | `web/src/layout.ts` |
| Three clocks ribbon | `web/src/clocks.ts` |

## Things worth remembering

- An occurrence's **shown** clock time is not always its instant read in its
  zone: a recorded zone rule shifts it. The front end reads a shown time from
  `start_local` when the event's zone is the viewer's own, and from
  `start_utc` otherwise — `displayWall` in `web/src/layout.ts`.
- `PutException` merges with `coalesce`, so passing `nil` keeps the value an
  exception already overrode. Restoring a deleted occurrence therefore uses
  `UndeleteException`, never `DeleteException`.
- The first save wins through one compare-and-set on the `events` row: every
  write path calls `UpdateEvent(event, fromVersion)` before touching
  exceptions, replies or splits.
- Personal settings and the one server-kept draft travel to other tabs as a
  `share.changed` message carrying `level: "settings"` or `level: "draft"`,
  because the published message types are a closed list.
- A drag that moved a block sets `data-dragged` so the click that follows does
  not also open the quick dialog.
- `GET /api/live` with no `after` starts from the head of the change log: a
  page has just read the whole state, so replaying the log would redraw the
  grid for every past change. A reconnect names its last `seq` and catches up.
- A pointer drag settles into the quick dialog; a keyboard move keeps the
  block focused with Three clocks beside it. `afterSave(..., "block")`.

## Checking it

```
scripts/verify.sh                # build, then every suite against fresh seed data
python3 scripts/check.py         # the brief's published examples and zone rules
python3 scripts/domain-check.py  # series edits, declines, proposals, trash, sharing
python3 scripts/service-check.py # printed week content and the iCalendar round trip
python3 scripts/outage-check.py  # Gotenberg and MinIO going away and coming back
python3 scripts/clock-check.py   # reminders, snooze and the trash purge on a rehearsal clock
node scripts/ui-check.mjs        # published screens, roles and names
node scripts/ui-journeys.mjs     # dragging, live changes, answers, zone rules, prints
node scripts/ui-layout.mjs       # lanes, midnight, the month count, the address, settings
```

`scripts/stop.sh` stops a server left running. `scripts/service-check.py` needs
`pdftotext` to read the printed week back.

The browser suites need Playwright's Chromium. They were run from
`/tmp/pw/node_modules/playwright`; install it there, or change the import at
the top of each script.

The suites change seed data as they go, so reset the database between them —
`scripts/verify.sh` does that by dropping and re-applying the schema, which
the server re-seeds on its next serve.
