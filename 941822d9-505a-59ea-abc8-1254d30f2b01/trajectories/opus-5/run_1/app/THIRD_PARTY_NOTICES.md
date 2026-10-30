# Third-party notices

Credwell ships the packages below (the production dependency tree reported by
`npm ls --omit=dev --all --json`) and the two bundled font families. Everything else in
the repository — the HTTP server, the router, the Kill Bill client, the AWS SigV4
signing, the SMTP client, the PDF writer and the seal — is first-party TypeScript.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
| `pg` | 8.23.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-native` | optional peer of `pg`; not installed and not shipped | MIT |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.5 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `react` | 19.3.1 | MIT |
| `react-dom` | 19.3.1 | MIT |
| `scheduler` | 0.28.0 | MIT |
| `split2` | 4.2.0 | ISC |
| `xtend` | 4.0.2 | MIT |

## Bundled fonts

Both families are self-hosted from `public/fonts` and served by the app; no font is
fetched from a third-party origin.

| Font | Files | Licence |
|---|---|---|
| Newsreader (Production Type) | `newsreader-latin-400-normal.woff2`, `newsreader-latin-600-normal.woff2`, `newsreader-latin-700-normal.woff2` | OFL-1.1 |
| Public Sans (US Web Design System) | `public-sans-latin-400-normal.woff2`, `public-sans-latin-500-normal.woff2`, `public-sans-latin-600-normal.woff2`, `public-sans-latin-700-normal.woff2` | OFL-1.1 |

The woff2 files were taken from the `@fontsource/newsreader` and
`@fontsource/public-sans` packages (both OFL-1.1), which are development dependencies
only.

## Licence texts

- **MIT** — Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal in the
  Software without restriction, including without limitation the rights to use, copy,
  modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
  and to permit persons to whom the Software is furnished to do so, subject to the
  following conditions: the above copyright notice and this permission notice shall be
  included in all copies or substantial portions of the Software. THE SOFTWARE IS
  PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
- **ISC** — Permission to use, copy, modify, and/or distribute this software for any
  purpose with or without fee is hereby granted, provided that the above copyright
  notice and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS
  IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE.
- **SIL Open Font License 1.1 (OFL-1.1)** — The fonts may be used, studied, modified and
  redistributed freely, provided they are not sold on their own, that any derivative is
  renamed, and that this notice is kept with the fonts. THE FONT SOFTWARE IS PROVIDED
  "AS IS", WITHOUT WARRANTY OF ANY KIND.
