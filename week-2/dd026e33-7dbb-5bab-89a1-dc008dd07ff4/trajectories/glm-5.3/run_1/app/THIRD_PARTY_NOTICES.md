# Third-party notices

Lacquer ships the following third-party packages and fonts. The package list
is the production dependency tree from `npm ls --omit=dev --all --json`; the
fonts ship as WOFF2 files bundled with the browser assets.

## Packages

| Package | Licence |
| --- | --- |
| @aws-sdk/checksums | Apache-2.0 |
| @aws-sdk/client-s3 | Apache-2.0 |
| @aws-sdk/core | Apache-2.0 |
| @aws-sdk/credential-provider-env | Apache-2.0 |
| @aws-sdk/credential-provider-http | Apache-2.0 |
| @aws-sdk/credential-provider-ini | Apache-2.0 |
| @aws-sdk/credential-provider-login | Apache-2.0 |
| @aws-sdk/credential-provider-node | Apache-2.0 |
| @aws-sdk/credential-provider-process | Apache-2.0 |
| @aws-sdk/credential-provider-sso | Apache-2.0 |
| @aws-sdk/credential-provider-web-identity | Apache-2.0 |
| @aws-sdk/middleware-sdk-s3 | Apache-2.0 |
| @aws-sdk/nested-clients | Apache-2.0 |
| @aws-sdk/signature-v4-multi-region | Apache-2.0 |
| @aws-sdk/token-providers | Apache-2.0 |
| @aws-sdk/types | Apache-2.0 |
| @aws-sdk/xml-builder | Apache-2.0 |
| @aws/lambda-invoke-store | Apache-2.0 |
| @smithy/core | Apache-2.0 |
| @smithy/credential-provider-imds | Apache-2.0 |
| @smithy/fetch-http-handler | Apache-2.0 |
| @smithy/node-http-handler | Apache-2.0 |
| @smithy/signature-v4 | Apache-2.0 |
| @smithy/types | Apache-2.0 |
| bowser | MIT |
| pg | MIT |
| pg-cloudflare | MIT |
| pg-connection-string | MIT |
| pg-int8 | ISC |
| pg-pool | MIT |
| pg-protocol | MIT |
| pg-types | MIT |
| pgpass | MIT |
| postgres-array | MIT |
| postgres-bytea | MIT |
| postgres-date | MIT |
| postgres-interval | MIT |
| split2 | ISC |
| tslib | 0BSD |
| xtend | MIT |

`pg-native` appears in `npm ls --all` output as an optional peer of `pg` and
is not installed; upstream it is MIT-licensed.

## Fonts

| Font | Files | Licence |
| --- | --- | --- |
| Archivo (variable, width axis) | `archivo-wdth.woff2` from @fontsource-variable/archivo | OFL-1.1 |
| IBM Plex Sans | `plex-sans-400.woff2`, `plex-sans-600.woff2` from @fontsource/ibm-plex-sans | OFL-1.1 |
| IBM Plex Mono | `plex-mono-400.woff2`, `plex-mono-600.woff2` from @fontsource/ibm-plex-mono | OFL-1.1 |
