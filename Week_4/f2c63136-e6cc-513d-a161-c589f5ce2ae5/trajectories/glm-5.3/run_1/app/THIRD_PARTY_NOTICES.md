# Third-party notices

Ridgestack ships the following third-party packages and fonts. Package
versions are those of the production dependency tree
(`npm ls --omit=dev --all`); licences are declared in each package's
`package.json`.

## Packages

| Package | Version | Licence |
|---|---|---|
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pgpass | 1.0.5 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| split2 | 4.2.0 | ISC |
| xtend | 4.0.2 | MIT |

`pg-native` is an optional dependency of `pg` and is not installed; the app
uses the pure-JavaScript driver over TCP.

## Fonts

Bundled variable fonts, all SIL Open Font License 1.1 (OFL-1.1). The licence
text for each family ships alongside the font files in `public/fonts/`.

| Font | File | Licence file |
|---|---|---|
| Inter | `public/fonts/inter.woff2` | `public/fonts/inter-OFL.txt` |
| Inter Tight | `public/fonts/inter-tight.woff2` | `public/fonts/inter-tight-OFL.txt` |
| Martian Mono | `public/fonts/martian-mono.woff2` | `public/fonts/martian-mono-OFL.txt` |

## Development-only tools (not shipped)

TypeScript, esbuild, `@types/node`, `@types/pg` and tsx are devDependencies
used to build and are not part of the running service.
