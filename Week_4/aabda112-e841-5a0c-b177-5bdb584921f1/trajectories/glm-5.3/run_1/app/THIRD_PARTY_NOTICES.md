# Third-party notices

Every package shipped in the production dependency tree of this app, plus the
bundled fonts, with version and licence.

## Packages

| Package | Version | Licence |
|---|---|---|
| @swc/helpers | 0.5.24 | Apache-2.0 |
| accepts | 1.3.8 | MIT |
| array-flatten | 1.1.1 | MIT |
| base64-js | 1.5.1 | MIT |
| body-parser | 1.20.9 | MIT |
| brotli | 1.3.3 | MIT |
| browserify-zlib | 0.2.0 | MIT |
| bytes | 3.1.2 | MIT |
| clone | 2.1.2 | MIT |
| content-disposition | 0.5.4 | MIT |
| content-type | 1.0.5 | MIT |
| cookie | 0.7.2 | MIT |
| cookie-signature | 1.0.7 | MIT |
| crypto-js | 4.2.0 | MIT |
| debug | 2.6.9 | MIT |
| depd | 2.0.0 | MIT |
| destroy | 1.2.0 | MIT |
| dfa | 1.2.0 | MIT |
| encodeurl | 2.0.3 | MIT |
| escape-html | 1.0.3 | MIT |
| etag | 1.8.1 | MIT |
| express | 4.22.3 | MIT |
| fast-deep-equal | 3.1.3 | MIT |
| finalhandler | 1.3.2 | MIT |
| fontkit | 2.0.4 | MIT |
| forwarded | 0.2.0 | MIT |
| fresh | 0.5.2 | MIT |
| http-errors | 2.0.1 | MIT |
| iconv-lite | 0.4.24 | MIT |
| ipaddr.js | 1.9.1 | MIT |
| jpeg-exif | 1.1.4 | MIT |
| linebreak | 1.1.0 | MIT |
| merge-descriptors | 1.0.3 | MIT |
| methods | 1.1.2 | MIT |
| mime | 1.6.0 | MIT |
| mime-db | 1.52.0 | MIT |
| mime-types | 2.1.35 | MIT |
| ms | 2.0.0 | MIT |
| negotiator | 0.6.3 | MIT |
| on-finished | 2.4.2 | MIT |
| pako | 1.0.11 | (MIT AND Zlib) |
| parseurl | 1.3.3 | MIT |
| path-to-regexp | 0.1.13 | MIT |
| pdfkit | 0.17.1 | MIT |
| pg | 8.23.1 | MIT |
| pg-cloudflare | 1.4.1 | MIT |
| pg-connection-string | 2.14.1 | MIT |
| pg-int8 | 1.0.1 | ISC |
| pg-pool | 3.14.0 | MIT |
| pg-protocol | 1.16.1 | MIT |
| pg-types | 2.2.0 | MIT |
| pgpass | 1.0.5 | MIT |
| png-js | 1.1.0 | MIT (LICENSE file in the package; npm metadata omits the field) |
| postgres-array | 2.0.0 | MIT |
| postgres-bytea | 1.0.1 | MIT |
| postgres-date | 1.0.7 | MIT |
| postgres-interval | 1.2.0 | MIT |
| proxy-addr | 2.0.8 | MIT |
| qs | 6.16.2 | BSD-3-Clause |
| range-parser | 1.2.1 | MIT |
| raw-body | 2.5.3 | MIT |
| restructure | 3.0.2 | MIT |
| safe-buffer | 5.2.1 | MIT |
| safer-buffer | 2.1.2 | MIT |
| send | 0.19.2 | MIT |
| serve-static | 1.16.3 | MIT |
| setprototypeof | 1.2.0 | ISC |
| split2 | 4.2.0 | ISC |
| statuses | 2.0.2 | MIT |
| tiny-inflate | 1.0.3 | MIT |
| type-is | 1.6.18 | MIT |
| unicode-properties | 1.4.1 | MIT |
| unicode-trie | 2.0.0 | MIT |
| unpipe | 1.0.0 | MIT |
| utils-merge | 1.0.1 | MIT |
| vary | 1.1.2 | MIT |
| xtend | 4.0.2 | MIT |

## Notes

- `pg-native` appears in the npm dependency listing as an *optional* dependency of
  `pg` but is not installed and not shipped with this app.
- `png-js` (a transitive dependency of `pdfkit`) is MIT licensed; the licence
  text is included in the package as `LICENSE`.

## Fonts

| Font | Version | Licence |
|---|---|---|
| Plus Jakarta Sans | 3.002 (static TTF) | SIL Open Font License 1.1 |
| DM Sans | 1.100 (static TTF) | SIL Open Font License 1.1 |

Font licence texts are bundled in `fonts/PlusJakartaSans-OFL.txt` and
`fonts/DMSans-LICENSE.txt`.
