create table if not exists players (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Người chơi',
  key_hash    text not null,
  created_at  timestamptz not null default now()
);

create table if not exists saves (
  player_id   uuid primary key references players(id) on delete cascade,
  data        jsonb not null,
  version     integer not null default 1,
  updated_at  timestamptz not null default now()
);

create table if not exists events (
  id          bigserial primary key,
  player_id   uuid not null references players(id) on delete cascade,
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists events_player_time_idx on events (player_id, created_at desc);