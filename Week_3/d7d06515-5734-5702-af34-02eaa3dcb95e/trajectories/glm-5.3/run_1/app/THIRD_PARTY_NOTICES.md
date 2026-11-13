# Third-party notices

Corbel Draft ships the following packages, fonts and icon art. Each entry lists
the licence under which it is redistributed. The production dependency tree is
the output of `npm ls --omit=dev --all --json` for this app.

## Packages (production dependency tree)

| Package | Version | Licence |
|---|---|---|
| @types/node | 22.20.5 | MIT |
| undici-types | 6.21.0 | MIT |
| esbuild | 0.25.12 | MIT |
| @esbuild/linux-arm64 | 0.25.12 | MIT |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pg-int8 | 1.0.1 | MIT |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| xtend | 4.0.2 | MIT |
| pgpass | 1.0.5 | MIT |
| split2 | 4.2.0 | ISC |
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| scheduler | 0.28.0 | MIT |
| typescript | 5.9.3 | Apache-2.0 |

esbuild's optional platform packages (`@esbuild/*` for each operating system
and architecture) are all MIT-licensed and installed per platform; the table
lists the one resolved for this machine.

## Fonts

| Font | Files | Licence |
|---|---|---|
| Fira Sans | `firasans-regular.ttf`, `firasans-medium.ttf`, `firasans-bold.ttf`, `firasans-extrabold.ttf` | SIL Open Font License 1.1 (OFL-1.1) |

Fira Sans was designed by Carrois Type Design / Ralph du Carrois and Erik
Spiekermann, and is self-hosted with the app. The OFL 1.1 licence permits
bundling and redistribution; the licence text accompanies the font files under
`src/client/fonts/` and in the built output.

## Icons and art

All line art, word marks, device illustrations, wireframes and grip glyphs in
`src/client/brand/` and the in-app SVG icons are original works created for
Corbel Works and carry no third-party licence. The icon style follows the
Lucide line-icon conventions; no Lucide files are bundled.
