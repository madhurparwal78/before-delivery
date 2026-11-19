# Third-party notices

Hearthtile ships the packages below (the production dependency tree, `npm ls --omit=dev --all`). Each is used
under the licence named, all from the allowed set (MIT, Apache-2.0, ISC).

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @ioredis/commands | 1.10.0 | MIT | Copyright (c) 2022 Zihua Li |
| cluster-key-slot | 1.1.1 | Apache-2.0 | Copyright (c) 2018 Mike Diarmid (Salakar) <mike.diarmid@gmail.com> |
| debug | 4.4.3 | MIT | Copyright (c) 2014-2017 TJ Holowaychuk <tj@vision-media.ca> |
| denque | 2.1.0 | Apache-2.0 | Copyright 2018 Invertase Limited |
| ioredis | 5.11.1 | MIT | Copyright (c) 2015-2022 Zihua Li |
| ms | 2.1.3 | MIT | Copyright (c) 2020 Vercel, Inc. |
| pg | 8.23.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | Copyright Brian M. Carlson |
| pgpass | 1.0.5 | MIT | Copyright Hannes Hörl <hannes.hoerl+pgpass@snowreporter.com> |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| react | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-dom | 19.3.1 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| redis-errors | 1.2.0 | MIT | Copyright (c) 2017 Ruben Bridgewater |
| redis-parser | 3.0.0 | MIT | Copyright (c) 2015 NodeRedis |
| scheduler | 0.28.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| split2 | 4.2.0 | ISC | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> |
| standard-as-callback | 2.1.0 | MIT | Copyright (c) 2018 Zihua Li |
| three | 0.187.0 | MIT | Copyright © 2010-2026 three.js authors |
| ws | 8.22.2 | MIT | Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com> |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. |

## Build tools (not shipped)

typescript (Apache-2.0), vite (MIT), @vitejs/plugin-react (MIT) and the `@types/*` packages (MIT) compile the
application. Their output is the only thing that reaches the browser, together with the production packages above.

## Icons

The small interface icons are drawn inline as SVG paths taken from Lucide (ISC licence, Copyright (c) Lucide
Contributors; parts derived from Feather, MIT, Copyright (c) Cole Bemis). No icon package is installed.

## Fonts, images and models

No font files, pictures, audio or video are bundled: the type uses the platform's built-in serif and sans-serif
stacks, the drawings (lantern, mini room) are original SVG made for this app, and the seed GLB models are generated
by the app at first start (`server/glbmaker.ts`), so they are original and licence `original`.
