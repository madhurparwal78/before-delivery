# Third party notices

Gatecut ships the packages and fonts named below. Every licence here is one of
MIT, MIT-0, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or OFL-1.1.

## Fonts

| Font | Version | Licence |
| --- | --- | --- |
| Work Sans (`src/client/assets/fonts/work-sans-latin.woff2`, `work-sans-latin-ext.woff2`) | v24 (Google Fonts) | OFL-1.1 |
| Sometype Mono (`src/client/assets/fonts/sometype-mono-latin.woff2`, `sometype-mono-latin-ext.woff2`) | v4 (Google Fonts) | OFL-1.1 |

Both fonts are served by the app itself. No font, icon or style request goes to another origin.

## Icons

Gatecut ships no icon set. The few marks it draws (the playhead, pins, keyframe
diamonds, waveform strips and layer boxes) are drawn by the app's own CSS and
inline SVG, and never stand alone without a text label.

## Shipped packages

The production dependency tree (`npm ls --omit=dev --all --json`):

| Package | Version | Licence |
| --- | --- | --- |
| @ioredis/commands | 1.10.0 | MIT |
| amqplib | 0.10.9 | MIT |
| buffer-more-ints | 1.0.0 | MIT |
| bufferutil | 4.x (optional, not installed) | MIT |
| cluster-key-slot | 1.1.1 | Apache-2.0 |
| debug | 4.4.3 | MIT |
| denque | 2.1.0 | Apache-2.0 |
| ioredis | 5.11.1 | MIT |
| ms | 2.1.3 | MIT |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-native | 3.x (optional, not installed) | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| querystringify | 2.2.0 | MIT |
| redis-errors | 1.2.0 | MIT |
| redis-parser | 3.0.0 | MIT |
| requires-port | 1.0.0 | MIT |
| split2 | 4.2.0 | ISC |
| standard-as-callback | 2.1.0 | MIT |
| url-parse | 1.5.10 | MIT |
| utf-8-validate | 6.x (optional, not installed) | MIT |
| ws | 8.22.1 | MIT |
| xtend | 4.0.2 | MIT |

`bufferutil`, `utf-8-validate` (optional native helpers for `ws`) and `pg-native`
(an optional native helper for `pg`) are declared as optional by their parents
and are not installed; Gatecut never requires them.

## Build-only tools

These are development dependencies and are not shipped: `esbuild` (MIT),
`typescript` (Apache-2.0), `@types/node`, `@types/pg`, `@types/ws`,
`@types/amqplib` (all MIT).

## Direct Postgres, MinIO, Valkey, RabbitMQ and SMTP access

The S3 request signing (Signature Version 4) and the SMTP client are written in
this repository (`src/server/services/storage.ts`, `src/server/services/smtp.ts`)
and bring no further packages.
