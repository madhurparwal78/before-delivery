-- Strongroom Ledger: Postgres is the only system of record.

create table if not exists accounts (
    id              text primary key,
    realm_user_id   text unique,
    email           text not null unique,
    name            text not null,
    kind            text not null check (kind in ('owner', 'contact')),
    created_at      timestamptz not null default now()
);

create table if not exists vaults (
    id                  text primary key,
    owner_account_id    text not null unique references accounts (id) on delete cascade,
    created_at          timestamptz not null default now()
);

create table if not exists holdings (
    id          text primary key,
    vault_id    text not null references vaults (id) on delete cascade,
    company     text not null,
    company_key text not null
                generated always as (lower(regexp_replace(btrim(company), '\s+', ' ', 'g'))) stored,
    data_kind   text not null,
    value       text not null,
    notes       text not null default '',
    version     integer not null default 1 check (version >= 1),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (vault_id, company_key, data_kind)
);

create index if not exists holdings_vault_idx on holdings (vault_id);

create table if not exists grading_rules (
    id                  text primary key,
    vault_id            text not null references vaults (id) on delete cascade,
    priority            integer not null check (priority between 1 and 999),
    data_kind           text not null,
    company_contains    text not null default '',
    level               text not null,
    version             integer not null default 1 check (version >= 1),
    created_at          timestamptz not null default now()
);

create index if not exists grading_rules_vault_idx on grading_rules (vault_id, priority);

create table if not exists breaches (
    id              text primary key,
    vault_id        text not null references vaults (id) on delete cascade,
    company         text not null,
    company_key     text not null
                    generated always as (lower(regexp_replace(btrim(company), '\s+', ' ', 'g'))) stored,
    announced_on    date not null,
    data_kinds      text[] not null check (cardinality(data_kinds) > 0),
    version         integer not null default 1 check (version >= 1),
    created_at      timestamptz not null default now()
);

create index if not exists breaches_vault_idx on breaches (vault_id, announced_on desc, created_at desc);

-- Done marks carry no history: a step id that leaves the vault's step list is pruned.
create table if not exists step_done (
    vault_id    text not null references vaults (id) on delete cascade,
    step_id     text not null,
    primary key (vault_id, step_id)
);

create table if not exists grants (
    id                  text primary key,
    vault_id            text not null references vaults (id) on delete cascade,
    contact_account_id  text not null references accounts (id) on delete cascade,
    contact_name        text not null,
    contact_email       text not null,
    duration            text not null check (duration in ('24h', '7d', '30d')),
    levels              text[] not null check (cardinality(levels) > 0),
    created_at          timestamptz not null default now(),
    ends_at             timestamptz not null,
    revoked_at          timestamptz
);

create index if not exists grants_vault_idx on grants (vault_id, created_at desc);

create table if not exists sessions (
    id              text primary key,
    account_id      text not null references accounts (id) on delete cascade,
    vault_id        text not null references vaults (id) on delete cascade,
    role            text not null check (role in ('owner', 'contact')),
    created_at      timestamptz not null default now(),
    last_seen_at    timestamptz not null default now()
);

create index if not exists sessions_account_idx on sessions (account_id);

create table if not exists pending_signins (
    id          text primary key,
    state       text not null unique,
    nonce       text not null,
    verifier    text not null,
    next_path   text,
    created_at  timestamptz not null default now(),
    consumed_at timestamptz
);

create table if not exists idempotency_keys (
    vault_id        text not null references vaults (id) on delete cascade,
    key             text not null,
    request_hash    text not null,
    response_status integer not null,
    response_body   jsonb not null,
    created_at      timestamptz not null default now(),
    primary key (vault_id, key)
);

-- Realm sign-outs that still have to be retried while the realm is unreachable.
create table if not exists pending_realm_logouts (
    realm_user_id   text primary key,
    created_at      timestamptz not null default now()
);

create table if not exists service_runs (
    name            text primary key,
    last_run_at     timestamptz not null
);
