# Third party notices

Celmate ships the packages and typefaces below. Everything else in the product is
written for Celmate. Build-only tools (TypeScript, esbuild, type packages) are not
shipped to the running app and are not listed here.

## Shipped packages

The production dependency tree (`npm ls --omit=dev --all`):

| Package | Version | Licence |
|---|---|---|
| gifenc | 1.0.3 | MIT |
| omggif | 1.0.10 | MIT |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| pngjs | 7.0.0 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |

## Typefaces

Both families ship inside the app under `web/assets/fonts` and are served from the
app's own origin. They are built from the Roboto project, which carries no reserved
font name, and are renamed for this product.

| Typeface | Source | Licence |
|---|---|---|
| Stack Sans Headline | Roboto (Light 300), The Roboto Project Authors | SIL Open Font License 1.1 |
| Stack Sans Text | Roboto (Regular 400, Medium 500, Bold 700), The Roboto Project Authors | SIL Open Font License 1.1 |

The full licence text ships beside the font files at
`web/assets/fonts/LICENSE-stack-sans.txt`.
