# Third-party notices

Gavelhouse, the online saleroom of Harrow & Gilt Auctioneers, ships the
packages and font families listed below. Shipped packages are the Go modules
the program imports and the front end's production dependency tree, plus the
two font families served from the app itself.

## Go modules

| Package | Version | Licence |
|---|---|---|
| github.com/gorilla/websocket | v1.5.3 | BSD-2-Clause |
| github.com/jackc/pgpassfile | v1.0.0 | MIT |
| github.com/jackc/pgservicefile | v0.0.0-20240606120523-5a60cdf6a761 | MIT |
| github.com/jackc/pgx/v5 | v5.12.0 | MIT |
| github.com/jackc/puddle/v2 | v2.2.3 | MIT |
| golang.org/x/sync | v0.22.0 | BSD-3-Clause |
| golang.org/x/text | v0.41.0 | BSD-3-Clause |

## Front-end production dependencies

The browser front end is written in TypeScript and bundled into one script
and one stylesheet at build time. Its production dependency tree is empty:

```
$ npm ls --omit=dev --all --json --prefix web
{
  "version": "1.0.0",
  "name": "gavelhouse-web"
}
```

TypeScript and esbuild are development dependencies used only by
`npm run build`; neither is shipped.

## Fonts

| Family | Files | Licence |
|---|---|---|
| Anton | `web/public/fonts/anton.ttf` | OFL-1.1 |
| Work Sans | `web/public/fonts/worksans.ttf` | OFL-1.1 |

The SIL Open Font Licence 1.1 text for each family travels with it:

- `web/public/fonts/Anton-OFL.txt`
- `web/public/fonts/WorkSans-OFL.txt`

Anton is copyright 2020 The Anton Project Authors. Work Sans is copyright
2019 The Work Sans Project Authors.
