# Third-party notices

Everything this site serves at runtime comes from inside `/app`. No asset,
font, script or style is fetched from another host.

## Media

### Star-trail photograph

- **Work:** *International Space Station star trails — JSC2012E039800*
- **Author:** NASA / Don Pettit, Expedition 30/31 crew, International Space
  Station (2012)
- **Source:** <https://commons.wikimedia.org/wiki/File:International_Space_Station_star_trails_-_JSC2012E039800.jpg>,
  originally published on the
  [NASA JSC Flickr account](https://www.flickr.com/photos/nasa_jsc_photo/7197237418)
- **Licence:** Public domain. Works created by NASA are not subject to
  copyright protection in the United States
  (<https://www.nasa.gov/nasa-brand-center/images-and-media/>).
- **Shipped as:** `assets/star-trails-960.jpg`, `assets/star-trails-1920.jpg`
  (downscaled copies of the original, otherwise unaltered)

## Fonts

### Inter

- **Work:** Inter (variable)
- **Author:** The Inter Project Authors, copyright (c) 2016
- **Source:** <https://github.com/rsms/inter>
- **Licence:** SIL Open Font License, Version 1.1
  (<https://github.com/rsms/inter/blob/master/LICENSE.txt>)
- **Shipped as:** `assets/InterVariable.woff2`

The page falls back to the system sans-serif where Inter cannot be used.

## Shipped packages

The production dependency tree, as listed by
`npm ls --omit=dev --all --json`:

| Package | Version | Licence | Source |
|---|---|---|---|
| `pg` | 8.13.1 | MIT | <https://github.com/brianc/node-postgres> |
| `pg-cloudflare` | 1.4.1 | MIT | <https://github.com/brianc/node-postgres> |
| `pg-connection-string` | 2.14.1 | MIT | <https://github.com/brianc/node-postgres> |
| `pg-int8` | 1.0.1 | ISC | <https://github.com/charmander/pg-int8> |
| `pg-native` | 3.9.1 | MIT | <https://github.com/brianc/node-postgres> |
| `pg-pool` | 3.14.0 | MIT | <https://github.com/brianc/node-postgres> |
| `pg-protocol` | 1.16.1 | MIT | <https://github.com/brianc/node-postgres> |
| `pg-types` | 2.2.0 | MIT | <https://github.com/brianc/node-pg-types> |
| `pgpass` | 1.0.6 | MIT | <https://github.com/hoegaarden/pgpass> |
| `postgres-array` | 2.0.0 | MIT | <https://github.com/bendrucker/postgres-array> |
| `postgres-bytea` | 1.0.1 | MIT | <https://github.com/bendrucker/postgres-bytea> |
| `postgres-date` | 1.0.7 | MIT | <https://github.com/bendrucker/postgres-date> |
| `postgres-interval` | 1.2.0 | MIT | <https://github.com/bendrucker/postgres-interval> |
| `xtend` | 4.0.2 | MIT | <https://github.com/Raynos/xtend> |

`pg-native` is an optional native binding of `pg`. It is MIT licensed and
`npm ci` does not install it, because it is not in `package-lock.json`.

## Build-only packages

These are development dependencies. They are not served, bundled into the
front end, or loaded at runtime.

| Package | Licence |
|---|---|
| `esbuild` | MIT |
| `typescript` | Apache-2.0 |
| `@types/node` | MIT |
| `@types/pg` | MIT |
