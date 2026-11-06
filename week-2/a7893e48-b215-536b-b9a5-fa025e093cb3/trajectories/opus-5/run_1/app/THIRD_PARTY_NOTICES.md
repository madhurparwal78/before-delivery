# Third party notices

Hearthshift ships the packages, fonts and icons listed below. Everything the
browser loads is served from the app's own origin.

## Shipped npm packages

These are the production dependency tree reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
|---|---|---|
| pg | 8.16.3 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |

Build-time only tools (TypeScript, esbuild, @types/node, @types/pg) are not shipped
to the browser or to the server runtime bundle.

## Bundled fonts

Font files live in `web/fonts` and are served from the app's own origin.

| Font | Files | Licence |
|---|---|---|
| Archivo (Omnibus-Type) | `archivo-latin-700-normal.woff2`, `archivo-latin-800-normal.woff2` | OFL-1.1 (`web/fonts/Archivo-OFL.txt`) |
| Public Sans (US GSA / Public Sans Project Authors) | `public-sans-latin-400-normal.woff2`, `public-sans-latin-600-normal.woff2` | OFL-1.1 (`web/fonts/PublicSans-OFL.txt`) |
| JetBrains Mono (JetBrains s.r.o.) | `jetbrains-mono-latin-400-normal.woff2`, `jetbrains-mono-latin-500-normal.woff2` | OFL-1.1 (`web/fonts/JetBrainsMono-OFL.txt`) |

The woff2 subsets were taken from the `@fontsource/archivo`,
`@fontsource/public-sans` and `@fontsource/jetbrains-mono` 5.x packages.

## Bundled icons

| Icon set | Usage | Licence |
|---|---|---|
| Lucide | `chevron-left`, `chevron-right`, `flame`, `clock` path data inlined in `src/client/ui/icons.ts` | ISC |

Lucide is © 2022 Lucide Contributors, ISC licensed; it derives from Feather
(© 2013-2022 Cole Bemis, MIT).
