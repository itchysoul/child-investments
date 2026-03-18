create table if not exists public.children (
  id text primary key,
  name text not null,
  slug text not null unique,
  accent_color text not null,
  avatar_emoji text not null
);

create table if not exists public.cd_lots (
  id text primary key,
  child_id text not null references public.children(id) on delete cascade,
  opened_on date not null,
  principal_cents integer not null,
  annual_rate_bps integer not null,
  lockup_months integer not null,
  withdrawn_principal_cents integer not null default 0,
  withdrawn_interest_cents integer not null default 0,
  note text not null default ''
);

create table if not exists public.transactions (
  id text primary key,
  child_id text not null references public.children(id) on delete cascade,
  effective_at date not null,
  transaction_type text not null check (transaction_type in ('deposit', 'withdraw', 'buy', 'sell', 'interest_adjustment', 'manual_adjustment')),
  asset_type text not null check (asset_type in ('cash', 'cd', 'bitcoin')),
  cash_cents_delta integer not null default 0,
  bitcoin_sats_delta bigint not null default 0,
  bitcoin_price_usd_cents integer,
  note text not null default '',
  cd_lot_id text references public.cd_lots(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.price_snapshots (
  id text primary key,
  asset_type text not null check (asset_type in ('bitcoin')),
  priced_at timestamptz not null,
  price_usd_cents integer not null,
  source text not null
);

create index if not exists transactions_child_effective_at_idx on public.transactions (child_id, effective_at);
create index if not exists cd_lots_child_opened_on_idx on public.cd_lots (child_id, opened_on);
create index if not exists price_snapshots_asset_priced_at_idx on public.price_snapshots (asset_type, priced_at);
