# Third-party notices

Mullion ships the packages in the first table (the production dependency tree, `npm ls --omit=dev --all`).
The second table lists the build tools used to compile the client and the server; none of them is
shipped or loaded at run time. Every package is licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, 0BSD or BlueOak-1.0.0.

Mullion loads no font, script, stylesheet, image or other file from another origin. Its only image file is
`favicon.svg` (`src/client/public/favicon.svg`, drawn for this app as vector code; licence: original);
its icons and drawings are inline SVG made for this app, and it uses the system font stacks.

## Shipped (production) packages

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @ioredis/commands | 1.11.0 | MIT | Copyright (c) 2022 Zihua Li |
| cluster-key-slot | 1.1.2 | Apache-2.0 | Copyright (c) 2018 Mike Diarmid (Salakar) <mike.diarmid@gmail.com> |
| debug | 4.4.3 | MIT | Copyright (c) 2014-2017 TJ Holowaychuk <tj@vision-media.ca> |
| denque | 2.1.0 | Apache-2.0 | Copyright 2018-present Invertase Limited |
| ioredis | 5.4.2 | MIT | Copyright (c) 2015-2022 Zihua Li |
| lodash.defaults | 4.2.0 | MIT | Copyright (c) John-David Dalton <john.david.dalton@gmail.com> (http://allyoucanleet.com/) |
| lodash.isarguments | 3.1.0 | MIT | Copyright (c) John-David Dalton <john.david.dalton@gmail.com> (http://allyoucanleet.com/) |
| ms | 2.1.3 | MIT | Copyright (c) 2020 Vercel, Inc. |
| pg | 8.13.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | Copyright (c) Brian M. Carlson |
| pgpass | 1.0.6 | MIT | Copyright (c) Hannes Hörl <hannes.hoerl+pgpass@snowreporter.com> |
| postgres-array | 2.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 1.0.1 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 1.0.7 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 1.2.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| redis-errors | 1.2.0 | MIT | Copyright (c) 2017 Ruben Bridgewater |
| redis-parser | 3.0.0 | MIT | Copyright (c) 2015 NodeRedis |
| standard-as-callback | 2.1.0 | MIT | Copyright (c) 2018 Zihua Li |
| ws | 8.18.0 | MIT | Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com> |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. |

## Build-time packages (not shipped)

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @babel/code-frame | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/compat-data | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/core | 7.29.13 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/generator | 7.29.13 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/helper-compilation-targets | 7.29.13 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/helper-globals | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/helper-module-imports | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/helper-module-transforms | 7.29.13 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/helper-plugin-utils | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/helper-string-parser | 7.29.13 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/helper-validator-identifier | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/helper-validator-option | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/helpers | 7.29.13 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/parser | 7.29.13 | MIT | Copyright (C) 2012-2014 by various contributors (see AUTHORS) |
| @babel/plugin-transform-react-jsx-self | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/plugin-transform-react-jsx-source | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/template | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/traverse | 7.29.13 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @babel/types | 7.29.11 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |
| @esbuild/aix-ppc64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/android-arm | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/android-arm64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/android-x64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/darwin-arm64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/darwin-x64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/freebsd-arm64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/freebsd-x64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-arm | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-arm64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-ia32 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-loong64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-mips64el | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-ppc64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-riscv64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-s390x | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/linux-x64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/netbsd-x64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/openbsd-arm64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/openbsd-x64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/sunos-x64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/win32-arm64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/win32-ia32 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @esbuild/win32-x64 | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| @jridgewell/gen-mapping | 0.3.13 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/remapping | 2.3.5 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/resolve-uri | 3.1.2 | MIT | Copyright 2019 Justin Ridgewell <jridgewell@google.com> |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/trace-mapping | 0.3.31 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @rollup/rollup-android-arm-eabi | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-android-arm64 | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-android-x64 | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-darwin-arm64 | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-darwin-x64 | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-freebsd-arm64 | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-freebsd-x64 | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-linux-arm-gnueabihf | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-linux-arm-musleabihf | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-linux-arm64-gnu | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-linux-arm64-musl | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-linux-loong64-gnu | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-linux-loong64-musl | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-linux-ppc64-gnu | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-linux-ppc64-musl | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-linux-riscv64-gnu | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-linux-riscv64-musl | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-linux-s390x-gnu | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-linux-x64-gnu | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-linux-x64-musl | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-openbsd-x64 | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-openharmony-arm64 | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-win32-arm64-msvc | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-win32-ia32-msvc | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-win32-x64-gnu | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @rollup/rollup-win32-x64-msvc | 4.67.5 | MIT | Copyright (c) 2017 Rollup contributors |
| @types/babel__core | 7.20.5 | MIT | Copyright (c) Microsoft Corporation. |
| @types/babel__generator | 7.27.0 | MIT | Copyright (c) Microsoft Corporation. |
| @types/babel__template | 7.4.4 | MIT | Copyright (c) Microsoft Corporation. |
| @types/babel__traverse | 7.28.0 | MIT | Copyright (c) Microsoft Corporation. |
| @types/estree | 1.0.10 | MIT | Copyright (c) Microsoft Corporation. |
| @types/node | 22.10.2 | MIT | Copyright (c) Microsoft Corporation. |
| @types/pg | 8.11.10 | MIT | Copyright (c) Microsoft Corporation. |
| @types/react | 19.0.2 | MIT | Copyright (c) Microsoft Corporation. |
| @types/react-dom | 19.0.2 | MIT | Copyright (c) Microsoft Corporation. |
| @types/ws | 8.5.13 | MIT | Copyright (c) Microsoft Corporation. |
| @vitejs/plugin-react | 4.3.4 | MIT | Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors |
| baseline-browser-mapping | 2.11.35 | Apache-2.0 | Copyright (c) the package authors |
| browserslist | 4.29.5 | MIT | Copyright 2014 Andrey Sitnik <andrey@sitnik.es> and other contributors |
| caniuse-lite | 1.0.30001823 | CC-BY-4.0 | Copyright (c) Ben Briggs |
| convert-source-map | 2.0.0 | MIT | Copyright 2013 Thorsten Lorenz. |
| csstype | 3.2.3 | MIT | Copyright (c) 2017-2018 Fredrik Nicol |
| electron-to-chromium | 1.5.478 | ISC | Copyright 2018 Kilian Valkhof |
| esbuild | 0.24.0 | MIT | Copyright (c) 2020 Evan Wallace |
| escalade | 3.2.0 | MIT | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) |
| fsevents | 2.3.3 | MIT | Copyright (c) the package authors |
| gensync | 1.0.0-beta.2 | MIT | Copyright 2018 Logan Smyth <loganfsmyth@gmail.com> |
| js-tokens | 4.0.0 | MIT | Copyright (c) 2014, 2015, 2016, 2017, 2018 Simon Lydell |
| jsesc | 3.1.0 | MIT | Copyright (c) Mathias Bynens |
| json5 | 2.2.3 | MIT | Copyright (c) 2012-2018 Aseem Kishore, and [others]. |
| lru-cache | 5.1.1 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| nanoid | 3.3.20 | MIT | Copyright 2017 Andrey Sitnik <andrey@sitnik.ru> |
| node-releases | 2.0.63 | MIT | Copyright (c) 2017 Sergey Rubanov (https://github.com/chicoxyzzy) |
| obuf | 1.1.2 | MIT | Copyright (c) Fedor Indutny <fedor@indutny.com> |
| pg-numeric | 1.0.2 | ISC | Copyright 2019 Charmander <~@charmander.me> |
| pg-types | 4.1.0 | MIT | Copyright (c) Brian M. Carlson |
| picocolors | 1.1.1 | ISC | Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov |
| postcss | 8.5.32 | MIT | Copyright 2013 Andrey Sitnik <andrey@sitnik.es> |
| postgres-array | 3.0.4 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-bytea | 3.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-date | 2.1.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-interval | 3.0.0 | MIT | Copyright (c) Ben Drucker <bvdrucker@gmail.com> (bendrucker.me) |
| postgres-range | 1.1.4 | MIT | Copyright (c) 2021 Abbas Mashayekh |
| react | 19.0.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-dom | 19.0.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-refresh | 0.14.2 | MIT | Copyright (c) Facebook, Inc. and its affiliates. |
| rollup | 4.67.5 | MIT | Copyright (c) 2017 [these people](https://github.com/rollup/rollup/graphs/contributors) |
| scheduler | 0.25.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| semver | 6.3.2 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| source-map-js | 1.2.2 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors |
| typescript | 5.7.2 | Apache-2.0 | Copyright (c) Microsoft Corp. |
| undici-types | 6.20.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |
| update-browserslist-db | 1.3.4 | MIT | Copyright 2022 Andrey Sitnik <andrey@sitnik.es> and other contributors |
| vite | 6.0.5 | MIT | Copyright (c) 2019-present, VoidZero Inc. and Vite contributors |
| yallist | 3.1.1 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
