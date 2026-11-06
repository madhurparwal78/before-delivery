# Third-party notices

## Shipped packages

The production dependency tree of this application, as reported by
`npm ls --omit=dev --all --json`. Each package ships under the licence noted.

- @aws-sdk/checksums 3.1002.0 — Apache-2.0
- @aws-sdk/client-s3 3.1160.0 — Apache-2.0
- @aws-sdk/core 3.979.0 — Apache-2.0
- @aws-sdk/credential-provider-env 3.972.79 — Apache-2.0
- @aws-sdk/credential-provider-http 3.972.81 — Apache-2.0
- @aws-sdk/credential-provider-ini 3.973.24 — Apache-2.0
- @aws-sdk/credential-provider-login 3.972.86 — Apache-2.0
- @aws-sdk/credential-provider-node 3.972.91 — Apache-2.0
- @aws-sdk/credential-provider-process 3.972.79 — Apache-2.0
- @aws-sdk/credential-provider-sso 3.973.23 — Apache-2.0
- @aws-sdk/credential-provider-web-identity 3.972.85 — Apache-2.0
- @aws-sdk/middleware-sdk-s3 3.972.84 — Apache-2.0
- @aws-sdk/nested-clients 3.997.53 — Apache-2.0
- @aws-sdk/signature-v4-multi-region 3.996.50 — Apache-2.0
- @aws-sdk/types 3.975.0 — Apache-2.0
- @noble/ciphers 1.3.0 — MIT
- @noble/hashes 1.8.0 — MIT
- @smithy/core 3.38.0 — Apache-2.0
- @smithy/credential-provider-imds 4.5.2 — Apache-2.0
- @smithy/fetch-http-handler 5.8.0 — Apache-2.0
- @smithy/node-http-handler 4.14.0 — Apache-2.0
- @smithy/types 4.19.0 — Apache-2.0
- @swc/helpers 0.5.23 — Apache-2.0
- @types/bcryptjs 2.4.6 — MIT
- @types/body-parser 1.19.6 — MIT
- @types/connect 3.4.38 — MIT
- @types/express 5.0.6 — MIT
- @types/express-serve-static-core 5.1.3 — MIT
- @types/http-errors 2.0.5 — MIT
- @types/node 26.6.6 — MIT
- @types/nodemailer 8.0.2 — MIT
- @types/pg 8.23.1 — MIT
- @types/qs 6.15.1 — MIT
- @types/range-parser 1.2.7 — MIT
- @types/send 1.2.1 — MIT
- @types/serve-static 2.2.0 — MIT
- accepts 1.3.8 — MIT
- array-flatten 1.1.1 — MIT
- base64-js 0.0.8 — MIT
- base64-js 1.5.1 — MIT
- bcryptjs 3.0.3 — BSD-3-Clause
- body-parser 1.20.9 — MIT
- brotli 1.3.3 — MIT
- bytes 3.1.2 — MIT
- clone 2.1.2 — MIT
- content-disposition 0.5.4 — MIT
- content-type 1.0.5 — MIT
- cookie 0.7.2 — MIT
- cookie-signature 1.0.7 — MIT
- debug 2.6.9 — MIT
- depd 2.0.0 — MIT
- destroy 1.2.0 — MIT
- dfa 1.2.0 — MIT
- encodeurl 2.0.1 — MIT
- escape-html 1.0.3 — MIT
- etag 1.8.1 — MIT
- express 4.22.3 — MIT
- fast-deep-equal 3.1.3 — MIT
- fflate 0.8.3 — MIT
- finalhandler 1.3.2 — MIT
- fontkit 2.0.4 — MIT
- forwarded 0.2.0 — MIT
- fresh 0.5.2 — MIT
- http-errors 2.0.1 — MIT
- iconv-lite 0.4.24 — MIT
- ipaddr.js 1.9.1 — MIT
- linebreak 1.1.0 — MIT
- merge-descriptors 1.0.3 — MIT
- methods 1.1.2 — MIT
- mime 1.6.0 — MIT
- mime-db 1.52.0 — MIT
- mime-types 2.1.35 — MIT
- ms 2.1.3 — MIT
- negotiator 0.6.3 — MIT
- nodemailer 6.10.1 — MIT-0
- on-finished 2.4.2 — MIT
- parseurl 1.3.3 — MIT
- path-to-regexp 0.1.13 — MIT
- pdfkit 0.20.2 — MIT
- pg 8.14.1 — MIT
- pg-cloudflare 1.4.1 — MIT
- pg-connection-string 2.14.1 — MIT
- pg-int8 1.0.1 — ISC
- pg-pool 3.14.0 — MIT
- pg-protocol 1.16.1 — MIT
- pg-types 2.2.0 — MIT
- pgpass 1.0.6 — MIT
- png-js 2.0.0 — MIT
- postgres-array 2.0.0 — MIT
- postgres-bytea 1.0.1 — MIT
- postgres-date 1.0.7 — MIT
- postgres-interval 1.2.0 — MIT
- proxy-addr 2.0.8 — MIT
- qs 6.16.2 — BSD-3-Clause
- range-parser 1.2.1 — MIT
- raw-body 2.5.3 — MIT
- restructure 3.0.2 — MIT
- safe-buffer 5.2.1 — MIT
- safer-buffer 2.1.2 — MIT
- send 0.19.2 — MIT
- serve-static 1.16.3 — MIT
- setprototypeof 1.2.0 — ISC
- statuses 2.0.2 — MIT
- tiny-inflate 1.0.3 — MIT
- tslib 2.8.1 — 0BSD
- type-is 1.6.18 — MIT
- typescript 5.9.3 — Apache-2.0
- unicode-properties 1.4.1 — MIT
- unicode-trie 2.0.0 — MIT
- unpipe 1.0.0 — MIT
- utils-merge 1.0.1 — MIT
- vary 1.1.2 — MIT
- xtend 4.0.2 — MIT

## Bundled fonts

- Newsreader (variable), served by the app for display text — SIL Open Font License 1.1 (see `src/server/fonts/licenses/Newsreader-OFL.txt`)
- Public Sans (variable), served by the app for text — SIL Open Font License 1.1 (see `src/server/fonts/licenses/PublicSans-OFL.txt`)

png-js 2.0.0 ships an MIT `LICENSE` file; its registry manifest omits the
`license` field, which `scripts/postinstall.mjs` records after install.
