# syntax=docker/dockerfile:1.19.0@sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6
FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b AS node
FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 TZ=UTC PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright DISABLE_UPDATES=1
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && \
    ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx && \
    node --version | grep -qx v22.14.0
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git build-essential bubblewrap util-linux passwd postgresql-client poppler-utils \
    libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 libx11-6 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 fonts-liberation && rm -rf /var/lib/apt/lists/*
RUN pip install harbor-rewardkit==0.2.3 pytest==8.4.1 httpx==0.28.1 pydantic==2.14.1 \
    playwright==1.49.1 pillow==12.0.0 && \
    python -m playwright install chromium && chmod -R a+rX /opt/playwright
RUN mkdir -p /opt/judge/bin && cd /opt/judge && \
    npm install --save-exact @openai/codex@0.163.0 @playwright/mcp@0.0.83 && \
    PLAYWRIGHT_BROWSERS_PATH=/opt/mcp-browsers node node_modules/playwright/cli.js install chromium && \
    chmod -R a+rX /opt/mcp-browsers && \
    test "$(node_modules/.bin/codex --version)" = 'codex-cli 0.163.0' && \
    node_modules/.bin/playwright-mcp --help > /tmp/mcp-help.txt && \
    for flag in --init-page --config --no-webmcp --save-session --block-service-workers; do \
      grep -q -- "$flag" /tmp/mcp-help.txt; done && rm /tmp/mcp-help.txt
RUN mkdir -p /opt/axe && cd /opt/axe && npm install --save-exact axe-core@4.14.0 && \
    test "$(sha256sum node_modules/axe-core/axe.min.js | cut -d' ' -f1)" = \
         20c09fe157a8a34a30e241aaa1fcdade657734f08ab379ecfbeb7d45cc46e878 && \
    chmod -R a+rX /opt/axe
COPY --from=golang:1.27.3-bookworm@sha256:d9b6a1beb9474adc2a1ce842573639b44b2a0dd49b6669f51d3821baf9ec37c9 /usr/local/go /usr/local/go
RUN sed -i 's/^GOTOOLCHAIN=.*/GOTOOLCHAIN=local/' /usr/local/go/go.env && \
    grep -qx 'GOTOOLCHAIN=local' /usr/local/go/go.env && echo 'GOFLAGS=-buildvcs=false' >> /usr/local/go/go.env && \
    ln -s /usr/local/go/bin/go /usr/local/go/bin/gofmt /usr/local/bin/ && \
    go version | grep -q ' go1.27.3 ' && test "$(go env GOROOT)" = /usr/local/go && \
    mkdir /tmp/gocheck && cd /tmp/gocheck && printf 'module check\n\ngo 1.27\n' > go.mod && \
    printf 'package main\n\nfunc main() {}\n' > main.go && HOME=/tmp/gocheck go build -o /tmp/gocheck/bin . && \
    /tmp/gocheck/bin && cd / && rm -rf /tmp/gocheck
RUN /usr/sbin/groupadd --gid 10001 app && \
    /usr/sbin/useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin app && \
    mkdir -p /app /logs/verifier
COPY test.sh /tests/test.sh
COPY grader /tests/grader
COPY grader/judge.py grader/instrument.js grader/instruction.md /opt/judge/
RUN printf '#!/bin/sh\nexec /usr/local/bin/python3 -B /opt/judge/judge.py codex "$@"\n' \
      > /opt/judge/bin/codex && chmod 755 /opt/judge/bin/codex /tests/test.sh && \
    node -e "if (typeof require('/opt/judge/instrument.js').default !== 'function') process.exit(1)" && \
    ! find /tests -name '__pycache__' -o -name '*.pyc' | grep -q . && \
    python -c "import rewardkit, pytest, httpx, playwright, pydantic, PIL" && \
    setpriv --version && bwrap --version
WORKDIR /tests
