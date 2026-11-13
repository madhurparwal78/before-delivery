# Third-party notices

Squallglass by Bellwake Games. Original procedural artwork and application
source are original works. This file lists the shipped production packages and
bundled fonts with their licences.

## Shipped packages

The production dependency tree reported by `npm ls --omit=dev --all --json`:

| Package | Version | Licence |
| --- | --- | --- |
| aws4fetch | 1.0.20 | MIT |
| pg | 8.23.1 | MIT |
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
| xtend | 4.2.0 | MIT |

Development dependencies (TypeScript, esbuild, @types/node, @types/pg) are build
tools and are not shipped in the production bundle.

## Bundled fonts

| Font | Files | Licence |
| --- | --- | --- |
| Bricolage Grotesque | `public/assets/fonts/BricolageGrotesque-Regular.woff2`, `public/assets/fonts/BricolageGrotesque-Bold.woff2` | SIL Open Font License 1.1 (see `public/assets/fonts/BricolageGrotesque-OFL.txt`) |
| Atkinson Hyperlegible | `public/assets/fonts/AtkinsonHyperlegible-Regular.woff2`, `public/assets/fonts/AtkinsonHyperlegible-Bold.woff2` | SIL Open Font License 1.1 (see `public/assets/fonts/AtkinsonHyperlegible-OFL.txt`) |

Both font families are distributed by Google Fonts under the SIL Open Font
License, Version 1.1. The full licence texts are bundled alongside the fonts.

## Artwork and source

All harbour, lantern, creature and pier artwork is original procedural CSS/SVG
work created for this project. No third-party images, icon sets or WebGL assets
are used.
