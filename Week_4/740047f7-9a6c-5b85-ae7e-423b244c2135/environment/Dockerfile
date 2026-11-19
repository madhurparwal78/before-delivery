FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b

ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 TZ=UTC \
    PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    PATH=/opt/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git build-essential python3 python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv
COPY --from=rust:1.99.1-slim-bookworm@sha256:24707e70a4f1e23d9a7b25202ec43126d28a52294b96aad5c670df1fd1f1d400 /usr/local/rustup/toolchains /usr/local/rust/toolchains
RUN test "$(ls /usr/local/rust/toolchains | wc -l)" = 1 && \
    for tool in cargo rustc rustdoc; do ln -s /usr/local/rust/toolchains/*/bin/$tool /usr/local/bin/$tool; done && \
    cargo --version | grep -q '^cargo 1.99.1 ' && rustc --version | grep -q '^rustc 1.99.1 ' && \
    mkdir /tmp/rustcheck && printf 'fn main() {}\n' > /tmp/rustcheck/main.rs && \
    rustc -o /tmp/rustcheck/bin /tmp/rustcheck/main.rs && /tmp/rustcheck/bin && rm -rf /tmp/rustcheck
WORKDIR /app
EXPOSE 4173
