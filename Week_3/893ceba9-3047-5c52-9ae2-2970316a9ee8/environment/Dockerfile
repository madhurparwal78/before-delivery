FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 TZ=UTC \
    PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    PATH=/opt/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git build-essential python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv
COPY --from=golang:1.27.3-bookworm@sha256:d9b6a1beb9474adc2a1ce842573639b44b2a0dd49b6669f51d3821baf9ec37c9 /usr/local/go /usr/local/go
RUN sed -i 's/^GOTOOLCHAIN=.*/GOTOOLCHAIN=local/' /usr/local/go/go.env && \
    grep -qx 'GOTOOLCHAIN=local' /usr/local/go/go.env && echo 'GOFLAGS=-buildvcs=false' >> /usr/local/go/go.env && \
    ln -s /usr/local/go/bin/go /usr/local/go/bin/gofmt /usr/local/bin/ && \
    go version | grep -q ' go1.27.3 ' && test "$(go env GOROOT)" = /usr/local/go && \
    mkdir /tmp/gocheck && cd /tmp/gocheck && printf 'module check\n\ngo 1.27\n' > go.mod && \
    printf 'package main\n\nfunc main() {}\n' > main.go && HOME=/tmp/gocheck go build -o /tmp/gocheck/bin . && \
    /tmp/gocheck/bin && cd / && rm -rf /tmp/gocheck
WORKDIR /app
EXPOSE 4173
