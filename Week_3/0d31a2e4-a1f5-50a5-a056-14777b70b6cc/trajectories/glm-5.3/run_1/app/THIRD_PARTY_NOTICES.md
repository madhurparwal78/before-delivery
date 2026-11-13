# Third-party notices

Pratfall Cup ships the following open-source packages and fonts. Package
versions are the exact versions installed from the lockfile; licences are
taken from each package's manifest.

## Shipped packages

These are the packages listed under `dependencies` in `package.json`, together
with every package they depend on in turn as installed. All are served from
the single app process.

| Package | Version | Licence |
|---|---|---|
| pg | 8.23.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pg-int8 | 1.0.1 | ISC |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| xtend | 4.0.2 | MIT |
| pgpass | 1.0.5 | MIT |
| split2 | 4.2.0 | ISC |
| pg-cloudflare | 1.4.1 | MIT |
| ws | 8.22.0 | MIT |

`pg-cloudflare` is an optional dependency of `pg` that is only imported inside
Cloudflare Workers; it is installed by npm but never loaded by this app.
`ws` lists the optional acceleration packages `bufferutil` and
`utf-8-validate`; neither is installed.

Build and test tooling lives in `devDependencies` (TypeScript, Vite, React,
three, ws type definitions and their transitive dependencies). After the
build, `npm prune --omit=dev` leaves an app that serves the same pages, since
React and three are bundled into the built browser assets at build time.

## Shipped fonts

All fonts ship under the SIL Open Font License 1.1. Licence texts are stored
next to the font files.

| Family | File | Licence |
|---|---|---|
| Bricolage Grotesque | assets/fonts/BricolageGrotesque.ttf | OFL-1.1 |
| Atkinson Hyperlegible | assets/fonts/AtkinsonHyperlegible-Regular.ttf, assets/fonts/AtkinsonHyperlegible-Bold.ttf | OFL-1.1 |
| Atkinson Hyperlegible Mono | assets/fonts/AtkinsonHyperlegibleMono-Regular.ttf, assets/fonts/AtkinsonHyperlegibleMono-Bold.ttf | OFL-1.1 |

Atkinson Hyperlegible Mono is a rebuild of Atkinson Hyperlegible (OFL-1.1)
with the digits' advance widths equalised so numerals are tabular; the family
name was changed as the OFL requires. Its source family is used for every
number in the product's interface.
