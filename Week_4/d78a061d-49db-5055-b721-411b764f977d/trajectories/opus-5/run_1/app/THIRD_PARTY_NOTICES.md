# Third-party notices

Linewright ships the production dependency tree below, taken from
`npm ls --omit=dev --all --json`, together with the fonts and icons listed under
bundled assets. Every entry uses one of the licences allowed by the brief.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
| `@fontsource/fredoka` | 5.3.0 | OFL-1.1 |
| `@fontsource/noto-sans-jp` | 5.3.1 | OFL-1.1 |
| `@fontsource/nunito` | 5.3.0 | OFL-1.1 |
| `gltf-validator` | 2.0.0-dev.3.10 | Apache-2.0 |
| `lucide-static` | 1.66.0 | ISC |
| `pg` | 8.23.1 | MIT |
| `pg-cloudflare` | 1.4.1 | MIT |
| `pg-connection-string` | 2.14.1 | MIT |
| `pg-int8` | 1.0.1 | ISC |
| `pg-pool` | 3.14.0 | MIT |
| `pg-protocol` | 1.16.1 | MIT |
| `pg-types` | 2.2.0 | MIT |
| `pgpass` | 1.0.5 | MIT |
| `postgres-array` | 2.0.0 | MIT |
| `postgres-bytea` | 1.0.1 | MIT |
| `postgres-date` | 1.0.7 | MIT |
| `postgres-interval` | 1.2.0 | MIT |
| `split2` | 4.2.0 | ISC |
| `three` | 0.187.0 | MIT |
| `ws` | 8.22.1 | MIT |
| `xtend` | 4.0.2 | MIT |

## Bundled fonts, icons and 3D assets

| Asset | Source package | Licence |
| --- | --- | --- |
| Fredoka (headings, tab labels, stat numerals) | `@fontsource/fredoka` | OFL-1.1 |
| Nunito (body text and controls) | `@fontsource/nunito` | OFL-1.1 |
| Noto Sans JP (Japanese text) | `@fontsource/noto-sans-jp` | OFL-1.1 |
| Lucide line icons (one consistent set) | `lucide-static` | ISC |

Every 3D asset in the product — the stick-figure hero and its parts, the drawn
weapons, the level props and the model thumbnails — is generated in code from
the geometry in `src/client/scene` and `src/server/models`. No model, texture
or image file is bundled.

The glTF acceptance rules run the Khronos glTF-Validator through the
`gltf-validator` package, pinned at version 2.0.0-dev.3.10 (Apache-2.0).
