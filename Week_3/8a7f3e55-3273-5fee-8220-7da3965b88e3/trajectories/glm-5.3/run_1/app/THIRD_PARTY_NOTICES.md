# Third-party notices

Relayline ships the following production dependencies (the dependency tree of
`npm ls --omit=dev --all --json`), each under one of the licences permitted for this
project, and the bundled web fonts.

## Production dependency tree

| Package | Version | Licence |
|---|---|---|
| @aws-sdk/checksums | 3.1002.5 | Apache-2.0 |
| @aws-sdk/client-s3 | 3.1166.0 | Apache-2.0 |
| @aws-sdk/core | 3.981.0 | Apache-2.0 |
| @aws-sdk/credential-provider-env | 3.972.84 | Apache-2.0 |
| @aws-sdk/credential-provider-http | 3.972.86 | Apache-2.0 |
| @aws-sdk/credential-provider-ini | 3.973.29 | Apache-2.0 |
| @aws-sdk/credential-provider-login | 3.972.91 | Apache-2.0 |
| @aws-sdk/credential-provider-node | 3.972.96 | Apache-2.0 |
| @aws-sdk/credential-provider-process | 3.972.84 | Apache-2.0 |
| @aws-sdk/credential-provider-sso | 3.973.28 | Apache-2.0 |
| @aws-sdk/credential-provider-web-identity | 3.972.90 | Apache-2.0 |
| @aws-sdk/middleware-sdk-s3 | 3.972.89 | Apache-2.0 |
| @aws-sdk/nested-clients | 3.998.3 | Apache-2.0 |
| @aws-sdk/signature-v4-multi-region | 3.996.52 | Apache-2.0 |
| @aws-sdk/token-providers | 3.1166.0 | Apache-2.0 |
| @aws-sdk/types | 3.975.1 | Apache-2.0 |
| @aws-sdk/xml-builder | 3.972.43 | Apache-2.0 |
| @aws/lambda-invoke-store | 0.3.0 | Apache-2.0 |
| @smithy/core | 3.40.0 | Apache-2.0 |
| @smithy/credential-provider-imds | 4.5.2 | Apache-2.0 |
| @smithy/fetch-http-handler | 5.8.1 | Apache-2.0 |
| @smithy/node-http-handler | 4.14.2 | Apache-2.0 |
| @smithy/signature-v4 | 5.7.5 | Apache-2.0 |
| @smithy/types | 4.20.0 | Apache-2.0 |
| bowser | 2.15.0 | MIT |
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
| tslib | 2.9.1 | 0BSD |
| xtend | 4.0.2 | MIT |

Email is delivered by Relayline's own minimal SMTP client (`src/server/mailer.ts`), so no
mail library is shipped.

## Bundled fonts

The web fonts below are served from this app's own origin only.

| Font | Files | Licence |
|---|---|---|
| Archivo | `Archivo-700-latin.woff2`, `Archivo-700-latin-ext.woff2` | OFL-1.1 |
| IBM Plex Mono | `IBMPlexMono-400-latin.woff2`, `IBMPlexMono-400-latin-ext.woff2`, `IBMPlexMono-500-latin.woff2`, `IBMPlexMono-500-latin-ext.woff2` | OFL-1.1 |
| IBM Plex Sans | `IBMPlexSans-400-latin.woff2`, `IBMPlexSans-400-latin-ext.woff2`, `IBMPlexSans-500-latin.woff2`, `IBMPlexSans-500-latin-ext.woff2`, `IBMPlexSans-600-latin.woff2`, `IBMPlexSans-600-latin-ext.woff2` | OFL-1.1 |

- Archivo: Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo), SIL Open Font License 1.1. Full text: `licenses/Archivo-LICENSE.txt`.
- IBM Plex: Copyright © 2017 IBM Corp. with Reserved Font Name "Plex", SIL Open Font License 1.1. Full text: `licenses/IBMPlex-LICENSE.txt`.

Build-time dependencies (TypeScript, esbuild and Node type definitions) are development
tools and are not shipped with the served application.
