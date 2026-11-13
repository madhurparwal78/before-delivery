# Third-party notices

Kinfold ships the following npm packages, fonts and icon sets. The production
dependency tree is the output of `npm ls --omit=dev --all --json` at build time.

## Direct production dependencies

| Package | Version | Licence |
|---|---|---|
| @aws-sdk/client-s3 | 3.700.0 | Apache-2.0 |
| @types/node | 22.10.2 | MIT |
| fastify | 5.2.0 | MIT |
| pg | 8.13.1 | MIT |
| redis | 5.0.0 | MIT |
| typescript | 5.7.2 | Apache-2.0 |

## Dev-only build tools (not shipped at runtime)

| Package | Version | Licence |
|---|---|---|
| @types/pg | 8.11.10 | MIT |
| esbuild | 0.24.2 | MIT |
| rollup | 4.68.1 | MIT |
| vite | 6.0.7 | MIT |

## Fonts

| Font | Version | Licence |
|---|---|---|
| Literata (Regular 400, SemiBold 600) | Google Fonts release | SIL Open Font License 1.1 |
| Atkinson Hyperlegible (Regular 400, Bold 700) | Google Fonts release | SIL Open Font License 1.1 |

Both typefaces are bundled locally under `/vendor/fonts` and served from the app's
own origin. Their licence texts ship alongside the font files as
`OFL-Literata.txt` and `OFL-Atkinson.txt`.

## Icons

| Icon set | Licence |
|---|---|
| Inline SVG glyphs drawn for Kinfold (lock, close) | MIT (this repository) |

## Transitive production dependency tree

| Package | Licence |
|---|---|
| @aws-crypto/crc32 | Apache-2.0 |
| @aws-crypto/crc32c | Apache-2.0 |
| @aws-crypto/sha1-browser | Apache-2.0 |
| @aws-crypto/sha256-browser | Apache-2.0 |
| @aws-crypto/sha256-js | Apache-2.0 |
| @aws-crypto/supports-web-crypto | Apache-2.0 |
| @aws-crypto/util | Apache-2.0 |
| @aws-sdk/client-s3 | Apache-2.0 |
| @aws-sdk/client-sso | Apache-2.0 |
| @aws-sdk/client-sso-oidc | Apache-2.0 |
| @aws-sdk/client-sts | Apache-2.0 |
| @aws-sdk/core | Apache-2.0 |
| @aws-sdk/credential-provider-env | Apache-2.0 |
| @aws-sdk/credential-provider-http | Apache-2.0 |
| @aws-sdk/credential-provider-ini | Apache-2.0 |
| @aws-sdk/credential-provider-node | Apache-2.0 |
| @aws-sdk/credential-provider-process | Apache-2.0 |
| @aws-sdk/credential-provider-sso | Apache-2.0 |
| @aws-sdk/credential-provider-web-identity | Apache-2.0 |
| @aws-sdk/middleware-bucket-endpoint | Apache-2.0 |
| @aws-sdk/middleware-expect-continue | Apache-2.0 |
| @aws-sdk/middleware-flexible-checksums | Apache-2.0 |
| @aws-sdk/middleware-host-header | Apache-2.0 |
| @aws-sdk/middleware-location-constraint | Apache-2.0 |
| @aws-sdk/middleware-logger | Apache-2.0 |
| @aws-sdk/middleware-recursion-detection | Apache-2.0 |
| @aws-sdk/middleware-sdk-s3 | Apache-2.0 |
| @aws-sdk/middleware-ssec | Apache-2.0 |
| @aws-sdk/middleware-user-agent | Apache-2.0 |
| @aws-sdk/region-config-resolver | Apache-2.0 |
| @aws-sdk/signature-v4-multi-region | Apache-2.0 |
| @aws-sdk/token-providers | Apache-2.0 |
| @aws-sdk/types | Apache-2.0 |
| @aws-sdk/util-arn-parser | Apache-2.0 |
| @aws-sdk/util-endpoints | Apache-2.0 |
| @aws-sdk/util-locate-window | Apache-2.0 |
| @aws-sdk/util-user-agent-browser | Apache-2.0 |
| @aws-sdk/util-user-agent-node | Apache-2.0 |
| @aws-sdk/xml-builder | Apache-2.0 |
| @fastify/ajv-compiler | MIT |
| @fastify/deepmerge | MIT |
| @fastify/error | MIT |
| @fastify/fast-json-stringify-compiler | MIT |
| @fastify/merge-json-schemas | MIT |
| @pinojs/redact | MIT |
| @redis/bloom | MIT |
| @redis/client | MIT |
| @redis/json | MIT |
| @redis/search | MIT |
| @redis/time-series | MIT |
| @smithy/abort-controller | Apache-2.0 |
| @smithy/chunked-blob-reader | Apache-2.0 |
| @smithy/chunked-blob-reader-native | Apache-2.0 |
| @smithy/config-resolver | Apache-2.0 |
| @smithy/core | Apache-2.0 |
| @smithy/credential-provider-imds | Apache-2.0 |
| @smithy/eventstream-codec | Apache-2.0 |
| @smithy/eventstream-serde-browser | Apache-2.0 |
| @smithy/eventstream-serde-config-resolver | Apache-2.0 |
| @smithy/eventstream-serde-node | Apache-2.0 |
| @smithy/eventstream-serde-universal | Apache-2.0 |
| @smithy/fetch-http-handler | Apache-2.0 |
| @smithy/hash-blob-browser | Apache-2.0 |
| @smithy/hash-node | Apache-2.0 |
| @smithy/hash-stream-node | Apache-2.0 |
| @smithy/invalid-dependency | Apache-2.0 |
| @smithy/is-array-buffer | Apache-2.0 |
| @smithy/md5-js | Apache-2.0 |
| @smithy/middleware-content-length | Apache-2.0 |
| @smithy/middleware-endpoint | Apache-2.0 |
| @smithy/middleware-retry | Apache-2.0 |
| @smithy/middleware-serde | Apache-2.0 |
| @smithy/middleware-stack | Apache-2.0 |
| @smithy/node-config-provider | Apache-2.0 |
| @smithy/node-http-handler | Apache-2.0 |
| @smithy/property-provider | Apache-2.0 |
| @smithy/protocol-http | Apache-2.0 |
| @smithy/querystring-builder | Apache-2.0 |
| @smithy/querystring-parser | Apache-2.0 |
| @smithy/service-error-classification | Apache-2.0 |
| @smithy/shared-ini-file-loader | Apache-2.0 |
| @smithy/signature-v4 | Apache-2.0 |
| @smithy/smithy-client | Apache-2.0 |
| @smithy/types | Apache-2.0 |
| @smithy/url-parser | Apache-2.0 |
| @smithy/util-base64 | Apache-2.0 |
| @smithy/util-body-length-browser | Apache-2.0 |
| @smithy/util-body-length-node | Apache-2.0 |
| @smithy/util-buffer-from | Apache-2.0 |
| @smithy/util-config-provider | Apache-2.0 |
| @smithy/util-defaults-mode-browser | Apache-2.0 |
| @smithy/util-defaults-mode-node | Apache-2.0 |
| @smithy/util-endpoints | Apache-2.0 |
| @smithy/util-hex-encoding | Apache-2.0 |
| @smithy/util-middleware | Apache-2.0 |
| @smithy/util-retry | Apache-2.0 |
| @smithy/util-stream | Apache-2.0 |
| @smithy/util-uri-escape | Apache-2.0 |
| @smithy/util-utf8 | Apache-2.0 |
| @smithy/util-waiter | Apache-2.0 |
| @types/node | MIT |
| abstract-logging | MIT |
| ajv | MIT |
| ajv-formats | MIT |
| atomic-sleep | MIT |
| avvio | MIT |
| aws-crt | Apache-2.0 |
| bowser | MIT |
| cluster-key-slot | Apache-2.0 |
| cookie | MIT |
| dequal | MIT |
| fast-decode-uri-component | MIT |
| fast-deep-equal | MIT |
| fast-json-stringify | MIT |
| fast-querystring | MIT |
| fast-uri | BSD-3-Clause |
| fast-xml-parser | MIT |
| fastify | MIT |
| fastq | ISC |
| find-my-way | MIT |
| forwarded | MIT |
| ipaddr.js | MIT |
| json-schema-ref-resolver | MIT |
| json-schema-traverse | MIT |
| light-my-request | BSD-3-Clause |
| on-exit-leak-free | MIT |
| pg | MIT |
| pg-cloudflare | MIT |
| pg-connection-string | MIT |
| pg-int8 | ISC |
| pg-native | MIT |
| pg-pool | MIT |
| pg-protocol | MIT |
| pg-types | MIT |
| pgpass | MIT |
| pino | MIT |
| pino-abstract-transport | MIT |
| pino-std-serializers | MIT |
| postgres-array | MIT |
| postgres-bytea | MIT |
| postgres-date | MIT |
| postgres-interval | MIT |
| process-warning | MIT |
| proxy-addr | MIT |
| quick-format-unescaped | MIT |
| real-require | MIT |
| redis | MIT |
| require-from-string | MIT |
| ret | MIT |
| reusify | MIT |
| rfdc | MIT |
| safe-regex2 | MIT |
| safe-stable-stringify | MIT |
| secure-json-parse | BSD-3-Clause |
| semver | ISC |
| set-cookie-parser | MIT |
| sonic-boom | MIT |
| split2 | ISC |
| strnum | MIT |
| thread-stream | MIT |
| toad-cache | MIT |
| tslib | 0BSD |
| typescript | Apache-2.0 |
| undici-types | MIT |
| uuid | MIT |
| xtend | MIT |
