# Third-party notices

Roam House Atelier bundles the packages below into its server (`dist/server.cjs`) and its browser app (`dist/public`).
Every package is installed from `package-lock.json` by `npm ci`; the production dependency tree is empty because the
application is bundled at build time. Every licence is one of MIT, MIT-0, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0,
0BSD, BlueOak-1.0.0 or OFL-1.1, except `caniuse-lite` (CC-BY-4.0, a build-time browser data table that ships nothing in the app).

## Font

| File | Family | Licence | Copyright | Source |
|---|---|---|---|---|
| `public/fonts/schibsted-grotesk-latin-wght-normal.woff2` | Schibsted Grotesk (variable, weights 400 to 900) | OFL-1.1 | Copyright 2023 The Schibsted-Grotesk Project Authors | https://github.com/schibsted/schibsted-grotesk, through `@fontsource-variable/schibsted-grotesk` |

The generated bag studies, the masthead drawings and every icon are drawn in code for this app (licence `original`).

## Packages

| Package | Version | Licence | Copyright |
|---|---|---|---|
| @aws-crypto/crc32 | 5.2.0 | Apache-2.0 | Copyright AWS Crypto Tools Team |
| @aws-crypto/crc32c | 5.2.0 | Apache-2.0 | Copyright AWS Crypto Tools Team |
| @aws-crypto/sha1-browser | 5.2.0 | Apache-2.0 | Copyright AWS Crypto Tools Team |
| @aws-crypto/sha256-browser | 5.2.0 | Apache-2.0 | Copyright AWS Crypto Tools Team |
| @aws-crypto/sha256-js | 5.2.0 | Apache-2.0 | Copyright AWS Crypto Tools Team |
| @aws-crypto/supports-web-crypto | 5.2.0 | Apache-2.0 | Copyright AWS Crypto Tools Team |
| @aws-crypto/util | 5.2.0 | Apache-2.0 | Copyright AWS Crypto Tools Team |
| @aws-sdk/client-s3 | 3.919.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/client-sesv2 | 3.1161.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/client-sso | 3.919.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/core | 3.916.0 | Apache-2.0 | Copyright AWS SDK for JavaScript Team |
| @aws-sdk/core | 3.979.1 | Apache-2.0 | Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/core | 3.979.1 | Apache-2.0 | Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-env | 3.916.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-env | 3.972.80 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-http | 3.916.0 | Apache-2.0 | Copyright AWS SDK for JavaScript Team |
| @aws-sdk/credential-provider-http | 3.972.82 | Apache-2.0 | Copyright AWS SDK for JavaScript Team |
| @aws-sdk/credential-provider-ini | 3.919.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-ini | 3.973.25 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-login | 3.972.87 | Apache-2.0 | Copyright AWS SDK for JavaScript Team |
| @aws-sdk/credential-provider-node | 3.919.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-node | 3.972.92 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-process | 3.916.0 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-process | 3.972.80 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-sso | 3.919.0 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-sso | 3.973.24 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-web-identity | 3.919.0 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/credential-provider-web-identity | 3.972.86 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-bucket-endpoint | 3.914.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-expect-continue | 3.917.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-flexible-checksums | 3.919.0 | Apache-2.0 | Copyright 2018-2022 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-host-header | 3.914.0 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-location-constraint | 3.914.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-logger | 3.914.0 | Apache-2.0 | Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-recursion-detection | 3.919.0 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-sdk-s3 | 3.916.0 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-ssec | 3.914.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/middleware-user-agent | 3.916.0 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/nested-clients | 3.919.0 | Apache-2.0 | Copyright AWS SDK for JavaScript Team |
| @aws-sdk/nested-clients | 3.997.54 | Apache-2.0 | Copyright AWS SDK for JavaScript Team |
| @aws-sdk/nested-clients | 3.997.54 | Apache-2.0 | Copyright AWS SDK for JavaScript Team |
| @aws-sdk/region-config-resolver | 3.914.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/signature-v4-multi-region | 3.916.0 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/signature-v4-multi-region | 3.996.51 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/signature-v4-multi-region | 3.996.51 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/token-providers | 3.1161.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/token-providers | 3.919.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/types | 3.914.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/types | 3.975.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/types | 3.975.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/util-arn-parser | 3.893.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/util-endpoints | 3.916.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/util-locate-window | 3.965.10 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/util-user-agent-browser | 3.914.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/util-user-agent-node | 3.916.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/xml-builder | 3.914.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/xml-builder | 3.972.42 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws-sdk/xml-builder | 3.972.42 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @aws/lambda-invoke-store | 0.1.1 | Apache-2.0 | Copyright Amazon Web Services |
| @aws/lambda-invoke-store | 0.3.0 | Apache-2.0 | Copyright Amazon Web Services |
| @aws/lambda-invoke-store | 0.3.0 | Apache-2.0 | Copyright Amazon Web Services |
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
| @esbuild/aix-ppc64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/aix-ppc64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/android-arm | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/android-arm | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/android-arm64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/android-arm64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/android-x64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/android-x64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/darwin-arm64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/darwin-arm64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/darwin-x64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/darwin-x64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/freebsd-arm64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/freebsd-arm64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/freebsd-x64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/freebsd-x64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/linux-arm | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/linux-arm | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/linux-arm64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/linux-arm64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/linux-ia32 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/linux-ia32 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/linux-loong64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/linux-loong64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/linux-mips64el | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/linux-mips64el | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/linux-ppc64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/linux-ppc64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/linux-riscv64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/linux-riscv64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/linux-s390x | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/linux-s390x | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/linux-x64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/linux-x64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/netbsd-arm64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/netbsd-arm64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/netbsd-x64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/netbsd-x64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/openbsd-arm64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/openbsd-arm64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/openbsd-x64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/openbsd-x64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/openharmony-arm64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/openharmony-arm64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/sunos-x64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/sunos-x64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/win32-arm64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/win32-arm64 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/win32-ia32 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/win32-ia32 | 0.28.2 | MIT | Copyright the package authors |
| @esbuild/win32-x64 | 0.25.12 | MIT | Copyright the package authors |
| @esbuild/win32-x64 | 0.28.2 | MIT | Copyright the package authors |
| @fontsource-variable/schibsted-grotesk | 5.2.8 | OFL-1.1 | Copyright 2023 The Schibsted-Grotesk Project Authors (https://github.com/schibsted/schibsted-grotesk) SchibstedGrotesk-Italic[wght].ttf: Copyright 2023 The Schi |
| @jridgewell/gen-mapping | 0.3.13 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/remapping | 2.3.5 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/resolve-uri | 3.1.2 | MIT | Copyright 2019 Justin Ridgewell <jridgewell@google.com> |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @jridgewell/trace-mapping | 0.3.31 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |
| @rolldown/pluginutils | 1.0.0-rc.3 | MIT | Copyright (c) 2024-present VoidZero Inc. & Contributors |
| @rollup/rollup-android-arm-eabi | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-android-arm64 | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-android-x64 | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-darwin-arm64 | 4.67.5 | MIT | Copyright Lukas Taegert-Atkinson |
| @rollup/rollup-darwin-x64 | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-freebsd-arm64 | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-freebsd-x64 | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-linux-arm-gnueabihf | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-linux-arm-musleabihf | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-linux-arm64-gnu | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-linux-arm64-musl | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-linux-loong64-gnu | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-linux-loong64-musl | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-linux-ppc64-gnu | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-linux-ppc64-musl | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-linux-riscv64-gnu | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-linux-riscv64-musl | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-linux-s390x-gnu | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-linux-x64-gnu | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-linux-x64-musl | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-openbsd-x64 | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-openharmony-arm64 | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-win32-arm64-msvc | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-win32-ia32-msvc | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-win32-x64-gnu | 4.67.5 | MIT | Copyright the package authors |
| @rollup/rollup-win32-x64-msvc | 4.67.5 | MIT | Copyright the package authors |
| @smithy/config-resolver | 4.7.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/core | 3.38.1 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/credential-provider-imds | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/eventstream-serde-browser | 4.5.2 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/eventstream-serde-config-resolver | 4.6.2 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/eventstream-serde-node | 4.5.2 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/fetch-http-handler | 5.8.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/hash-blob-browser | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/hash-node | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/hash-stream-node | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/invalid-dependency | 4.5.2 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/is-array-buffer | 2.2.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/is-array-buffer | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/md5-js | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/middleware-content-length | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/middleware-endpoint | 4.7.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/middleware-retry | 4.8.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/middleware-serde | 4.5.2 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/middleware-stack | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/node-config-provider | 4.6.2 | Apache-2.0 | Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/node-http-handler | 4.14.1 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/property-provider | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/protocol-http | 5.6.2 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/shared-ini-file-loader | 4.7.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/signature-v4 | 5.7.5 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/smithy-client | 4.15.2 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/types | 4.19.0 | Apache-2.0 | Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/url-parser | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-base64 | 4.6.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-body-length-browser | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-body-length-node | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-buffer-from | 2.2.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-config-provider | 4.5.2 | Apache-2.0 | Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-defaults-mode-browser | 4.6.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-defaults-mode-node | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-endpoints | 3.7.2 | Apache-2.0 | Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-middleware | 4.5.2 | Apache-2.0 | Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-retry | 4.6.2 | Apache-2.0 | Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-stream | 4.8.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-utf8 | 2.3.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-utf8 | 2.3.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-utf8 | 2.3.0 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-utf8 | 4.5.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/util-waiter | 4.6.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @smithy/uuid | 1.4.2 | Apache-2.0 | Copyright 2018-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| @types/babel__core | 7.20.5 | MIT | Copyright the package authors |
| @types/babel__generator | 7.27.0 | MIT | Copyright the package authors |
| @types/babel__template | 7.4.4 | MIT | Copyright the package authors |
| @types/babel__traverse | 7.28.0 | MIT | Copyright the package authors |
| @types/estree | 1.0.10 | MIT | Copyright the package authors |
| @types/node | 22.19.0 | MIT | Copyright the package authors |
| @types/nodemailer | 7.0.3 | MIT | Copyright the package authors |
| @types/pg | 8.15.6 | MIT | Copyright the package authors |
| @types/react | 19.2.2 | MIT | Copyright the package authors |
| @types/react-dom | 19.2.2 | MIT | Copyright the package authors |
| @vitejs/plugin-react | 5.2.0 | MIT | Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors |
| anynum | 1.0.1 | MIT | Copyright (c) 2026 Natural Intelligence |
| baseline-browser-mapping | 2.11.35 | Apache-2.0 | Copyright the package authors |
| bowser | 2.15.0 | MIT | Copyright 2015, Dustin Diaz (the "Original Author") |
| browserslist | 4.29.5 | MIT | Copyright 2014 Andrey Sitnik <andrey@sitnik.es> and other contributors |
| caniuse-lite | 1.0.30001820 | CC-BY-4.0 | Copyright Ben Briggs |
| convert-source-map | 2.0.0 | MIT | Copyright 2013 Thorsten Lorenz. |
| csstype | 3.2.3 | MIT | Copyright (c) 2017-2018 Fredrik Nicol |
| debug | 4.4.3 | MIT | Copyright (c) 2014-2017 TJ Holowaychuk <tj@vision-media.ca> |
| electron-to-chromium | 1.5.476 | ISC | Copyright 2018 Kilian Valkhof |
| esbuild | 0.25.12 | MIT | Copyright (c) 2020 Evan Wallace |
| esbuild | 0.28.2 | MIT | Copyright (c) 2020 Evan Wallace |
| escalade | 3.2.0 | MIT | Copyright Luke Edwards |
| fast-xml-parser | 5.2.5 | MIT | Copyright (c) 2017 Amit Kumar Gupta |
| fdir | 6.5.0 | MIT | Copyright 2023 Abdullah Atta |
| fsevents | 2.3.3 | MIT | Copyright the package authors |
| gensync | 1.0.0-beta.2 | MIT | Copyright 2018 Logan Smyth <loganfsmyth@gmail.com> |
| js-tokens | 4.0.0 | MIT | Copyright (c) 2014, 2015, 2016, 2017, 2018 Simon Lydell |
| jsesc | 3.1.0 | MIT | Copyright Mathias Bynens |
| json5 | 2.2.3 | MIT | Copyright (c) 2012-2018 Aseem Kishore, and [others]. |
| lru-cache | 5.1.1 | ISC | Copyright Isaac Z. Schlueter <i@izs.me> |
| meilisearch | 0.54.0 | MIT | Copyright (c) 2019-2025 Meili SAS |
| ms | 2.1.3 | MIT | Copyright (c) 2020 Vercel, Inc. |
| nanoid | 3.3.20 | MIT | Copyright 2017 Andrey Sitnik <andrey@sitnik.ru> |
| node-releases | 2.0.63 | MIT | Copyright (c) 2017 Sergey Rubanov (https://github.com/chicoxyzzy) |
| nodemailer | 7.0.10 | MIT-0 | Copyright (c) 2011-2023 Andris Reinman |
| pg | 8.16.3 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-cloudflare | 1.4.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-connection-string | 2.14.1 | MIT | Copyright (c) 2014 Iced Development |
| pg-int8 | 1.0.1 | ISC | Copyright © 2017, Charmander <~@charmander.me> |
| pg-pool | 3.14.0 | MIT | Copyright (c) 2017 Brian M. Carlson |
| pg-protocol | 1.16.1 | MIT | Copyright (c) 2010 - 2021 Brian Carlson |
| pg-types | 2.2.0 | MIT | Copyright Brian M. Carlson |
| pgpass | 1.0.5 | MIT | Copyright Hannes Hörl <hannes.hoerl+pgpass@snowreporter.com> |
| picocolors | 1.1.1 | ISC | Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov |
| picomatch | 4.0.7 | MIT | Copyright (c) 2017-present, Jon Schlinkert. |
| postcss | 8.5.32 | MIT | Copyright 2013 Andrey Sitnik <andrey@sitnik.es> |
| postgres-array | 2.0.0 | MIT | Copyright Ben Drucker |
| postgres-bytea | 1.0.1 | MIT | Copyright Ben Drucker |
| postgres-date | 1.0.7 | MIT | Copyright Ben Drucker |
| postgres-interval | 1.2.0 | MIT | Copyright Ben Drucker |
| react | 19.2.0 | MIT | Copyright the package authors |
| react-dom | 19.2.0 | MIT | Copyright the package authors |
| react-refresh | 0.18.0 | MIT | Copyright the package authors |
| rollup | 4.67.5 | MIT | Copyright (c) 2017 [these people](https://github.com/rollup/rollup/graphs/contributors) |
| scheduler | 0.27.0 | MIT | Copyright the package authors |
| semver | 6.3.2 | ISC | Copyright GitHub Inc. |
| source-map-js | 1.2.2 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors |
| split2 | 4.2.0 | ISC | Copyright (c) 2014-2018, Matteo Collina <hello@matteocollina.com> |
| strnum | 2.5.1 | MIT | Copyright (c) 2021 Natural Intelligence |
| tinyglobby | 0.2.17 | MIT | Copyright (c) 2024 Madeline Gurriarán |
| tslib | 2.9.1 | 0BSD | Copyright Microsoft Corp. |
| typescript | 5.9.3 | Apache-2.0 | Copyright Microsoft Corp. |
| undici-types | 6.21.0 | MIT | Copyright the package authors |
| update-browserslist-db | 1.3.4 | MIT | Copyright 2022 Andrey Sitnik <andrey@sitnik.es> and other contributors |
| vite | 7.3.7 | MIT | Copyright (c) 2019-present, VoidZero Inc. and Vite contributors |
| xtend | 4.0.2 | MIT | Copyright (c) 2012-2014 Raynos. |
| yallist | 3.1.1 | ISC | Copyright Isaac Z. Schlueter <i@izs.me> (http://blog.izs.me/) |

## SIL Open Font License 1.1 (Schibsted Grotesk)

```
Copyright 2023 The Schibsted-Grotesk Project Authors (https://github.com/schibsted/schibsted-grotesk) SchibstedGrotesk-Italic[wght].ttf: Copyright 2023 The Schibsted-Grotesk Project Authors (https://github.com/schibsted/schibsted-grotesk)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
