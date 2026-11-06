# Third-party notices

Hourline Launch Hub bundles the following third-party packages and assets.

## Production dependencies (from `npm ls --omit=dev --all`)

Direct dependencies:

| Package | Licence | Use |
|---|---|---|
| @aws-sdk/client-s3 | Apache-2.0 | MinIO (S3-compatible) client for look images and press ZIPs |
| @fastify/multipart | MIT | multipart uploads for line sheets and look images |
| @js-joda/core | BSD-3-Clause | Copenhagen and market time-zone rules, ISO weeks |
| @js-joda/timezone | BSD-3-Clause | IANA time-zone data for @js-joda/core |
| bcryptjs | BSD-3-Clause | member password hashing |
| fastify | MIT | HTTP server |
| pg | MIT | PostgreSQL client |
| sharp | Apache-2.0 | image decoding, orientation, metadata stripping |

Transitive dependencies (find-my-way, avvio, light-my-request, pino, ajv,
@fastify/busboy, @smithy/*, @aws-sdk/* and others) are each under the MIT,
Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD or ISC licence; the complete tree is
recorded in `package-lock.json`.

### Platform binaries

`sharp` loads one optional `@img/sharp-*` package for the host platform; those
native bindings are Apache-2.0. The libvips prebuilt binaries
(`@img/sharp-libvips-*`) carry libvips's own LGPL-3.0-or-later licence. They are
dynamically loaded by the bindings, unmodified, and are not redistributed as
part of this application's source.

## Bundled fonts

| Font | Licence | Use |
|---|---|---|
| Archivo (variable weight) | SIL Open Font License 1.1 | headings and drop names |
| Inter (variable weight) | SIL Open Font License 1.1 | body text |
| IBM Plex Mono (Regular, Medium) | SIL Open Font License 1.1 | times, counts, prices and UTC instants |

The fonts are served from `/assets` on this origin and are never loaded from
another origin.

## Icons

Status and night marks are inline SVG shapes drawn by this app's own code; no
third-party icon set is bundled. All garment and object illustrations, including
the seeded look images, are drawn by the app's own code from simple shapes in
the swatch colours; no photographs or copied image files are shipped.

## Email

Email is sent over plain SMTP through this app's own client code (no mail
library is bundled); every message goes through the configured Mailpit host.

