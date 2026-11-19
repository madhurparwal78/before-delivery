# Third-party notices

Earshot ships third-party packages and assets listed below. Each entry carries its
licence. No other third-party code or assets are shipped.

## npm production dependencies

The full production dependency tree (`npm ls --omit=dev --all --json`) of
`earshot@1.0.0`, including transitive dependencies:

| Package | Version | Licence |
|---|---|---|
| @aws-sdk/checksums | 3.1002.5 | Apache-2.0 |
| @aws-sdk/client-s3 | 3.1168.0 | Apache-2.0 |
| @aws-sdk/core | 3.981.0 | Apache-2.0 |
| @aws-sdk/credential-provider-env | 3.972.84 | Apache-2.0 |
| @aws-sdk/credential-provider-http | 3.972.86 | Apache-2.0 |
| @aws-sdk/credential-provider-ini | 3.973.30 | Apache-2.0 |
| @aws-sdk/credential-provider-login | 3.972.92 | Apache-2.0 |
| @aws-sdk/credential-provider-node | 3.972.97 | Apache-2.0 |
| @aws-sdk/credential-provider-process | 3.972.84 | Apache-2.0 |
| @aws-sdk/credential-provider-sso | 3.973.28 | Apache-2.0 |
| @aws-sdk/credential-provider-web-identity | 3.972.84 | Apache-2.0 |
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
| bowser | 2.15.0 | Apache-2.0 |
| nodemailer | 6.10.1 | MIT-0 |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-native (optional, not installed) | — | MIT |
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

Dev dependencies (TypeScript and @types packages) are used at build time only and
are not shipped in the served application.

## Fonts

Fonts are served by the application itself; no third-party CDN is used at runtime.

| Font | File | Licence |
|---|---|---|
| Bricolage Grotesque | frontend/assets/fonts/bricolage-latin.woff2 | SIL Open Font License 1.1 |
| Inter | frontend/assets/fonts/inter-latin.woff2 | SIL Open Font License 1.1 |
| JetBrains Mono | frontend/assets/fonts/jetbrains-mono-latin.woff2 | SIL Open Font License 1.1 |

## Icons

| Asset | Licence |
|---|---|
| Lucide static SVGs (frontend/assets/icons/*.svg) | ISC |
