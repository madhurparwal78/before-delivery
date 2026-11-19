import { q } from './db.js';

export async function applySchema(): Promise<void> {
  await q(`
    create table if not exists business_clock (
      id int primary key,
      started_at timestamptz not null,
      offset_ms bigint not null default 0,
      real_at timestamptz not null
    );
    create table if not exists users (
      id bigserial primary key,
      email text not null unique,
      name text not null,
      password_hash text not null,
      confirm_code text,
      confirmed boolean not null default false,
      number_format text not null default 'en-US',
      time_zone text not null default 'UTC',
      created_at timestamptz not null
    );
    create table if not exists sessions (
      token text primary key,
      user_id bigint not null references users(id),
      created_at timestamptz not null
    );
    create table if not exists projects (
      id bigserial primary key,
      name text not null,
      owner_id bigint not null references users(id),
      created_at timestamptz not null
    );
    create table if not exists memberships (
      id bigserial primary key,
      project_id bigint not null references projects(id),
      user_id bigint not null references users(id),
      role text not null,
      joined_at timestamptz not null,
      unique (project_id, user_id)
    );
    create table if not exists invites (
      id bigserial primary key,
      project_id bigint not null references projects(id),
      email text not null,
      role text not null,
      token text not null unique,
      state text not null default 'pending',
      expires_at timestamptz,
      created_at timestamptz not null
    );
    create table if not exists palettes (
      id bigserial primary key,
      sprite_id bigint not null default 0,
      seq_at_creation int not null default 0
    );
    create table if not exists swatches (
      palette_id bigint not null references palettes(id),
      index int not null,
      color text not null,
      version int not null default 1,
      last_version int not null default 1,
      edited_by bigint references users(id),
      primary key (palette_id, index)
    );
    create table if not exists sprites (
      id bigserial primary key,
      project_id bigint not null references projects(id),
      palette_id bigint not null references palettes(id),
      name text not null,
      width int not null,
      height int not null,
      seq int not null default 0,
      created_at timestamptz not null
    );
    create table if not exists layers (
      id bigserial primary key,
      sprite_id bigint not null references sprites(id),
      name text not null,
      opacity int not null default 100,
      blend text not null default 'normal',
      visible boolean not null default true,
      locked_by bigint references users(id),
      position int not null
    );
    create unique index if not exists layers_sprite_position on layers(sprite_id, position);
    create table if not exists frames (
      id bigserial primary key,
      sprite_id bigint not null references sprites(id),
      position int not null,
      duration_ms int not null
    );
    create unique index if not exists frames_sprite_position on frames(sprite_id, position);
    create table if not exists cels (
      frame_id bigint not null references frames(id),
      layer_id bigint not null references layers(id),
      rows jsonb not null,
      link_frame_id bigint references frames(id),
      primary key (frame_id, layer_id)
    );
    create index if not exists cels_by_frame on cels(frame_id);
    create table if not exists tags (
      id bigserial primary key,
      sprite_id bigint not null references sprites(id),
      name text not null,
      from_frame int not null,
      to_frame int not null,
      direction text not null,
      repeat int not null default 0
    );
    create table if not exists tilesets (
      id bigserial primary key,
      sprite_id bigint not null references sprites(id),
      name text not null,
      tile_size int not null,
      edge_table jsonb not null
    );
    create table if not exists tiles (
      tileset_id bigint not null references tilesets(id),
      num int not null,
      rows jsonb not null,
      primary key (tileset_id, num)
    );
    create table if not exists tilemaps (
      id bigserial primary key,
      sprite_id bigint not null references sprites(id),
      tileset_id bigint not null references tilesets(id),
      name text not null,
      width int not null,
      height int not null
    );
    create table if not exists tilemap_cells (
      tilemap_id bigint not null references tilemaps(id),
      x int not null,
      y int not null,
      tile int not null default 0,
      flip_h boolean not null default false,
      flip_v boolean not null default false,
      primary key (tilemap_id, x, y)
    );
    create table if not exists sprite_events (
      sprite_id bigint not null,
      seq int not null,
      type text not null,
      by bigint references users(id),
      at timestamptz not null,
      data jsonb not null,
      primary key (sprite_id, seq)
    );
    create table if not exists stroke_dedup (
      sprite_id bigint not null,
      client_stroke_id text not null,
      user_id bigint not null,
      response jsonb not null,
      primary key (sprite_id, client_stroke_id, user_id)
    );
    create table if not exists undo_stack (
      user_id bigint not null,
      sprite_id bigint not null,
      idx int not null,
      action jsonb not null,
      created_at timestamptz not null
    );
    create index if not exists undo_by_user on undo_stack(user_id, sprite_id, idx);
    create table if not exists comments (
      id bigserial primary key,
      sprite_id bigint not null references sprites(id),
      author_id bigint not null references users(id),
      frame int not null,
      x int not null,
      y int not null,
      text text not null,
      state text not null default 'open',
      idempotency_key text,
      created_at timestamptz not null
    );
    create unique index if not exists comments_idem on comments(sprite_id, idempotency_key) where idempotency_key is not null;
    create table if not exists comment_mentions (
      comment_id bigint not null references comments(id),
      member_id bigint not null references users(id),
      state text not null default 'pending',
      primary key (comment_id, member_id)
    );
    create table if not exists snapshots (
      id bigserial primary key,
      sprite_id bigint not null references sprites(id),
      name text not null,
      seq int not null,
      state jsonb not null,
      at timestamptz not null
    );
    create unique index if not exists snapshot_names on snapshots(sprite_id, name);
    create table if not exists drafts (
      user_id bigint not null,
      key text not null,
      text text not null default '',
      version int not null default 0,
      primary key (user_id, key)
    );
    create table if not exists share_links (
      id bigserial primary key,
      sprite_id bigint not null references sprites(id),
      label text not null,
      token text not null unique,
      state text not null default 'active',
      expires_at timestamptz,
      ended_notice_sent boolean not null default false,
      created_at timestamptz not null
    );
    create table if not exists imports (
      id bigserial primary key,
      project_id bigint not null references projects(id),
      sprite_id bigint not null references sprites(id),
      file_name text not null,
      object_key text not null,
      created_at timestamptz not null
    );
    create table if not exists export_jobs (
      id bigserial primary key,
      project_id bigint not null references projects(id),
      sprite_id bigint,
      kind text not null,
      label text,
      scale int not null,
      frame int,
      padding int not null default 0,
      extrude int not null default 0,
      state text not null default 'queued',
      done int not null default 0,
      total int not null default 0,
      seq int not null,
      owner_id bigint not null references users(id),
      files jsonb not null default '[]',
      claimed_at timestamptz,
      created_at timestamptz not null
    );
    create table if not exists exports (
      id bigserial primary key,
      project_id bigint not null references projects(id),
      job_id bigint not null references export_jobs(id),
      label text,
      seq int not null,
      files jsonb not null default '[]'
    );
    create table if not exists mail_outbox (
      id bigserial primary key,
      to_email text not null,
      subject text not null,
      body text not null,
      sent boolean not null default false,
      created_at timestamptz not null
    );
    create table if not exists activity (
      id bigserial primary key,
      project_id bigint not null,
      sprite_id bigint,
      kind text not null,
      by bigint not null,
      sentence text not null,
      at timestamptz not null,
      event_key text
    );
    create table if not exists activity_seq (
      id int primary key,
      n bigint not null default 0
    );
    insert into activity_seq (id, n) values (1, 0) on conflict do nothing;
  `);
}
