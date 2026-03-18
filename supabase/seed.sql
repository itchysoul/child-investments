insert into public.children (id, name, slug, accent_color, avatar_emoji)
values
  ('72dc6c0e-e75a-4e2c-9d5f-1aa1eb2eb001', 'Finn', 'finn', '#4f46e5', '🚀'),
  ('72dc6c0e-e75a-4e2c-9d5f-1aa1eb2eb002', 'Lucy', 'lucy', '#db2777', '🌸'),
  ('72dc6c0e-e75a-4e2c-9d5f-1aa1eb2eb003', 'Charlie', 'charlie', '#ea580c', '🌞'),
  ('72dc6c0e-e75a-4e2c-9d5f-1aa1eb2eb004', 'Annie', 'annie', '#0f766e', '🦋')
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  accent_color = excluded.accent_color,
  avatar_emoji = excluded.avatar_emoji;

insert into public.transactions (
  id,
  child_id,
  effective_at,
  transaction_type,
  asset_type,
  cash_cents_delta,
  bitcoin_sats_delta,
  bitcoin_price_usd_cents,
  note,
  cd_lot_id,
  metadata
)
values
  ('91d8ebf0-a7b8-4a68-b27e-1f8de2de0001', '72dc6c0e-e75a-4e2c-9d5f-1aa1eb2eb001', '2026-03-09', 'deposit', 'cash', 4000, 0, null, 'Work on Charlie''s Room', null, '{}'::jsonb),
  ('91d8ebf0-a7b8-4a68-b27e-1f8de2de0002', '72dc6c0e-e75a-4e2c-9d5f-1aa1eb2eb002', '2026-03-09', 'deposit', 'cash', 2400, 0, null, 'Work on Charlie''s Room', null, '{}'::jsonb),
  ('91d8ebf0-a7b8-4a68-b27e-1f8de2de0003', '72dc6c0e-e75a-4e2c-9d5f-1aa1eb2eb001', '2026-03-09', 'deposit', 'cash', 20000, 0, null, 'Diamond League!', null, '{}'::jsonb),
  ('91d8ebf0-a7b8-4a68-b27e-1f8de2de0004', '72dc6c0e-e75a-4e2c-9d5f-1aa1eb2eb003', '2026-03-09', 'deposit', 'cash', 1000, 0, null, 'Init Account', null, '{}'::jsonb),
  ('91d8ebf0-a7b8-4a68-b27e-1f8de2de0005', '72dc6c0e-e75a-4e2c-9d5f-1aa1eb2eb004', '2026-03-09', 'deposit', 'cash', 1000, 0, null, 'Init Account', null, '{}'::jsonb),
  ('91d8ebf0-a7b8-4a68-b27e-1f8de2de0006', '72dc6c0e-e75a-4e2c-9d5f-1aa1eb2eb001', '2026-03-09', 'deposit', 'cash', 18200, 0, null, 'Cash', null, '{}'::jsonb),
  ('91d8ebf0-a7b8-4a68-b27e-1f8de2de0007', '72dc6c0e-e75a-4e2c-9d5f-1aa1eb2eb001', '2026-03-09', 'buy', 'bitcoin', -10000, 144571, 6917030, 'First BTC!', null, '{"priced_from_midpoint": true}'::jsonb),
  ('91d8ebf0-a7b8-4a68-b27e-1f8de2de0008', '72dc6c0e-e75a-4e2c-9d5f-1aa1eb2eb002', '2026-03-11', 'buy', 'bitcoin', -2400, 34267, 7003823, 'first bitcoin purchase!', null, '{"priced_from_midpoint": true}'::jsonb)
on conflict (id) do update set
  child_id = excluded.child_id,
  effective_at = excluded.effective_at,
  transaction_type = excluded.transaction_type,
  asset_type = excluded.asset_type,
  cash_cents_delta = excluded.cash_cents_delta,
  bitcoin_sats_delta = excluded.bitcoin_sats_delta,
  bitcoin_price_usd_cents = excluded.bitcoin_price_usd_cents,
  note = excluded.note,
  cd_lot_id = excluded.cd_lot_id,
  metadata = excluded.metadata;

insert into public.price_snapshots (id, asset_type, priced_at, price_usd_cents, source)
values
  ('7fb2bd22-88d0-4f77-8d92-4ee8b99f0001', 'bitcoin', '2026-03-09T12:00:00.000Z', 6917030, 'spreadsheet_midpoint')
on conflict (id) do update set
  asset_type = excluded.asset_type,
  priced_at = excluded.priced_at,
  price_usd_cents = excluded.price_usd_cents,
  source = excluded.source;
