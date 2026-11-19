# Third-party notices

Fio Contado Desk ships the following packages and fonts. Each entry lists its licence.

## Fonts (bundled, all under the SIL Open Font License 1.1)

| Font | Version | Licence |
|---|---|---|
| Sora | variable (Google Fonts repository build) | SIL Open Font License 1.1 |
| Noto Sans | variable (Google Fonts repository build) | SIL Open Font License 1.1 |
| Noto Sans Arabic | variable (Google Fonts repository build) | SIL Open Font License 1.1 |

The fonts are bundled in `public/` and served by the app; nothing is loaded from another
origin at runtime. The OFL 1.1 permits bundling and redistribution under its terms.

## Runtime packages (production dependency tree, from `npm ls --omit=dev --all --json`)

| Package | Version | Licence |
|---|---|---|
| @aws-sdk/client-s3 and its transitive runtime dependencies | 3.x | Apache-2.0 (AWS SDK JS v3) |
| @fastify/cookie | 10.x | MIT |
| fastify | 5.x | MIT |
| date-fns | 3.x | MIT |
| date-fns-tz | 3.x | MIT |
| nodemailer | 6.x | MIT-0 (MIT Zero) |
| pg | 8.x | MIT |

The transitive dependencies of the packages above carry MIT, Apache-2.0, BSD-3-Clause,
ISC, MIT-0 and 0BSD (tslib) licences; the production tree was audited with
`npm ls --omit=dev --all --json` plus the installed package metadata, and no other licence
appears in it. Every one of these is a BSD-family, MIT, ISC, Apache-2.0 or MIT-0 licence.

## Build-time packages (development only, not shipped)

typescript, parcel, sass, @parcel/* plugins, @types/* declarations and a small number of
support packages carry MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause or ISC licences. They
are used only to produce the built app and are not part of the served output.
