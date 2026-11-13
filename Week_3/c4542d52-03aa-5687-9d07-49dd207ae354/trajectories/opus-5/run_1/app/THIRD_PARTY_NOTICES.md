# Third party notices

Holdfast Register ships the packages and assets below. Everything the browser loads is
served by the app itself from its own origin.

## Shipped packages

The production dependency tree, as reported by `npm ls --omit=dev --all --json`.

| Package | Version | Licence |
| --- | --- | --- |
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
| ws | 8.22.1 | MIT |
| xtend | 4.0.2 | MIT |

`bufferutil`, `pg-native` and `utf-8-validate` are optional peers of `pg` and `ws`; they are
not installed and not shipped.

## Typefaces

| Typeface | Files | Licence |
| --- | --- | --- |
| Funnel Display | `public/fonts/funnel-display-latin.woff2` | SIL Open Font License 1.1 (OFL-1.1) |
| Funnel Sans | `public/fonts/funnel-sans-latin.woff2` | SIL Open Font License 1.1 (OFL-1.1) |

Both are by Dalton Maag, published through Google Fonts.

## Photographs

All four photographs are released under the Creative Commons CC0 1.0 Universal public
domain dedication (CC0-1.0) and are shown in greyscale.

| File | Source |
| --- | --- |
| `public/photos/robot-arms.jpg` | "Lexington Medical, Inc. Manufacturing Robot Arm", Wikimedia Commons, CC0-1.0 |
| `public/photos/workbench.jpg` | "THE SHOP", Flickr user 52904639@N08, https://www.flickr.com/photos/52904639@N08/17630933414, CC0-1.0 |
| `public/photos/hands-at-a-desk.jpg` | "Writing in Notebook at Desk", Flickr user 132795455@N08, https://www.flickr.com/photos/132795455@N08/18692128651, CC0-1.0 |
| `public/photos/machine-shop.jpg` | "electronics_funny_connector_ammo_001", Flickr user 96541566@N06, https://www.flickr.com/photos/96541566@N06/51675562014, CC0-1.0 |

## Icons

Lucide line icons (ISC licence) are the icon set this app draws on. No icon files are
currently bundled: every control in the register is set in type.

## Build tooling (not shipped)

TypeScript (Apache-2.0) and Vite (MIT) are development dependencies used to type check and
bundle the app. They are not part of the production dependency tree.
