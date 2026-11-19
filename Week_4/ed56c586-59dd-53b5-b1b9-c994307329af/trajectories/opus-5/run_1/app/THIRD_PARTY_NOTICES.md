# Third-party notices

## Shipped packages

The production dependency tree of this site is empty. `npm ls --omit=dev --all --json`
reports no dependencies, so no third-party package code is shipped to the server or
to the browser. The server (HTTP, SMTP and the AWS Signature Version 4 requests to
the object store) and the browser bundle are written for this site and use only the
Node.js standard library and the browser's own platform features.

```
$ npm ls --omit=dev --all --json
{
  "version": "1.0.0",
  "name": "ottoline-rask-selected-builds"
}
```

### Build-time only (not shipped)

These are development dependencies. They produce the build output and are not part
of the shipped tree, but they are listed here for completeness.

| Package | Licence |
|---|---|
| esbuild | MIT |
| typescript | Apache-2.0 |
| @types/node | MIT |

## Fonts

Three font families are shipped from `public/fonts` and served by the app itself.
Each file is licensed under the SIL Open Font License, Version 1.1.

| Family | Files | Copyright | Licence |
|---|---|---|---|
| Fraunces | `fraunces-variable-latin.woff2` | Copyright 2020 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces) | SIL Open Font License 1.1 |
| IBM Plex Sans | `ibm-plex-sans-400-latin.woff2`, `ibm-plex-sans-500-latin.woff2`, `ibm-plex-sans-600-latin.woff2` | Copyright 2017 IBM Corp. (https://github.com/IBM/plex) | SIL Open Font License 1.1 |
| IBM Plex Mono | `ibm-plex-mono-400-latin.woff2`, `ibm-plex-mono-500-latin.woff2` | Copyright 2017 IBM Corp. (https://github.com/IBM/plex) | SIL Open Font License 1.1 |

The full licence text is available at <https://scripts.sil.org/OFL>.

## Artwork

Every image on the site is original and made for it: the hero sculpture, the service
visuals and the 42 project covers and preview frames are drawn procedurally by this
app's own code (`src/server/artwork.ts`, `src/server/render/art.ts`).
