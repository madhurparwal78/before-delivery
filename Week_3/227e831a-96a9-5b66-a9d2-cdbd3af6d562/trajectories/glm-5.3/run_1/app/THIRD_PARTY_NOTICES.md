# Third-party notices

Skinout ships the following npm packages, listed with their resolved versions
and licences, plus the bundled fonts. Every package uses one of the allowed
licences (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD); every
bundled font is under the SIL Open Font License 1.1.

## Shipped packages

The production dependency tree reported by `npm ls --omit=dev --all --json`.

- @aws-sdk/checksums@3.1002.2 — Apache-2.0
- @aws-sdk/client-s3@3.1163.0 — Apache-2.0
- @aws-sdk/core@3.980.0 — Apache-2.0
- @aws-sdk/credential-provider-env@3.972.81 — Apache-2.0
- @aws-sdk/credential-provider-http@3.972.83 — Apache-2.0
- @aws-sdk/credential-provider-ini@3.973.26 — Apache-2.0
- @aws-sdk/credential-provider-login@3.972.88 — Apache-2.0
- @aws-sdk/credential-provider-node@3.972.93 — Apache-2.0
- @aws-sdk/credential-provider-process@3.972.81 — Apache-2.0
- @aws-sdk/credential-provider-sso@3.973.25 — Apache-2.0
- @aws-sdk/credential-provider-web-identity@3.972.87 — Apache-2.0
- @aws-sdk/middleware-sdk-s3@3.972.86 — Apache-2.0
- @aws-sdk/nested-clients@3.998.0 — Apache-2.0
- @aws-sdk/signature-v4-multi-region@3.996.51 — Apache-2.0
- @aws-sdk/token-providers@3.1162.0 — Apache-2.0
- @aws-sdk/types@3.975.0 — Apache-2.0
- @aws-sdk/xml-builder@3.972.42 — Apache-2.0
- @aws/lambda-invoke-store@0.3.0 — Apache-2.0
- @fastify/ajv-compiler@4.0.7 — MIT
- @fastify/busboy@3.2.5 — MIT
- @fastify/deepmerge@3.2.4 — MIT
- @fastify/error@4.2.1 — MIT
- @fastify/fast-json-stringify-compiler@5.1.1 — MIT
- @fastify/forwarded@3.1.2 — MIT
- @fastify/merge-json-schemas@0.2.2 — MIT
- @fastify/multipart@10.1.7 — MIT
- @fastify/proxy-addr@5.1.2 — MIT
- @pinojs/redact@0.4.0 — MIT
- @smithy/core@3.39.0 — Apache-2.0
- @smithy/credential-provider-imds@4.5.2 — Apache-2.0
- @smithy/fetch-http-handler@5.8.1 — Apache-2.0
- @smithy/node-http-handler@4.14.2 — Apache-2.0
- @smithy/signature-v4@5.7.5 — Apache-2.0
- @smithy/types@4.20.0 — Apache-2.0
- abstract-logging@2.0.1 — MIT
- ajv-formats@3.0.1 — MIT
- ajv@8.20.0 — MIT
- atomic-sleep@1.0.0 — MIT
- avvio@9.3.1 — MIT
- bowser@2.15.0 — MIT
- cookie@2.0.1 — MIT
- dequal@2.0.3 — MIT
- fast-decode-uri-component@1.0.1 — MIT
- fast-deep-equal@3.1.3 — MIT
- fast-json-stringify@7.3.1 — MIT
- fast-querystring@1.1.2 — MIT
- fast-uri@3.1.9 — BSD-3-Clause
- fast-uri@4.2.3 — BSD-3-Clause
- fastify-plugin@6.0.1 — MIT
- fastify@5.12.8 — MIT
- fastq@1.20.3 — ISC
- find-my-way@9.10.0 — MIT
- ipaddr.js@2.5.0 — MIT
- json-schema-ref-resolver@3.0.1 — MIT
- json-schema-traverse@1.0.0 — MIT
- light-my-request@6.8.0 — BSD-3-Clause
- on-exit-leak-free@2.1.2 — MIT
- pg-cloudflare@1.4.1 — MIT
- pg-connection-string@2.14.1 — MIT
- pg-int8@1.0.1 — ISC
- pg-pool@3.14.0 — MIT
- pg-protocol@1.16.1 — MIT
- pg-types@2.2.0 — MIT
- pg@8.23.1 — MIT
- pgpass@1.0.5 — MIT
- pino-abstract-transport@3.0.0 — MIT
- pino-std-serializers@7.1.0 — MIT
- pino@10.4.0 — MIT
- postgres-array@2.0.0 — MIT
- postgres-bytea@1.0.1 — MIT
- postgres-date@1.0.7 — MIT
- postgres-interval@1.2.0 — MIT
- process-warning@5.1.1 — MIT
- quick-format-unescaped@4.0.4 — MIT
- real-require@1.0.0 — MIT
- require-from-string@2.0.2 — MIT
- ret@0.5.1 — MIT
- reusify@1.1.0 — MIT
- rfdc@1.4.1 — MIT
- safe-regex2@5.1.2 — MIT
- safe-stable-stringify@2.5.0 — MIT
- secure-json-parse@4.1.1 — BSD-3-Clause
- semver@7.8.6 — ISC
- set-cookie-parser@3.2.2 — MIT
- sonic-boom@4.2.1 — MIT
- split2@4.2.0 — ISC
- thread-stream@4.2.1 — MIT
- toad-cache@3.7.4 — MIT
- tslib@2.9.1 — 0BSD
- undici@7.30.2 — MIT
- xtend@4.0.2 — MIT

## Bundled fonts

Served by the app itself; nothing loads from a CDN or another origin.

- Space Grotesk (500, 700) — Om Nabib Rai, Digital Punch — SIL OFL 1.1
- IBM Plex Sans (400, 600) — IBM — SIL OFL 1.1
- IBM Plex Mono (400) — IBM — SIL OFL 1.1

The font binaries are distributed under the SIL Open Font License, Version 1.1,
and are bundled as `@fontsource/*` packages (MIT) in the build.
