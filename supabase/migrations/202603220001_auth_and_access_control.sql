create table if not exists child_investments.user_access (
  email text primary key,
  user_id uuid unique,
  role text not null check (role in ('admin', 'writer')),
  status text not null check (status in ('pending', 'approved')),
  requested_at timestamptz not null default timezone('utc', now()),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  constraint user_access_email_lowercase check (email = lower(email))
);

revoke all on child_investments.children from anon, authenticated;
revoke all on child_investments.cd_lots from anon, authenticated;
revoke all on child_investments.transactions from anon, authenticated;
revoke all on child_investments.price_snapshots from anon, authenticated;
revoke all on child_investments.user_access from anon, authenticated;

grant select on child_investments.children to anon, authenticated;
grant select on child_investments.cd_lots to anon, authenticated;
grant select on child_investments.transactions to anon, authenticated;
grant select on child_investments.price_snapshots to anon, authenticated;
grant select on child_investments.user_access to authenticated;
grant insert, update, delete on child_investments.cd_lots to authenticated;
grant insert, update, delete on child_investments.transactions to authenticated;
grant insert, update, delete on child_investments.price_snapshots to authenticated;
grant all on child_investments.user_access to service_role;

create or replace function child_investments.current_user_email()
returns text
language sql
stable
as $$
  select nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
$$;

create or replace function child_investments.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth, child_investments
as $$
  select exists (
    select 1
    from child_investments.user_access
    where email = child_investments.current_user_email()
      and status = 'approved'
      and role = 'admin'
  );
$$;

create or replace function child_investments.can_write()
returns boolean
language sql
stable
security definer
set search_path = public, auth, child_investments
as $$
  select exists (
    select 1
    from child_investments.user_access
    where email = child_investments.current_user_email()
      and status = 'approved'
      and role in ('admin', 'writer')
  );
$$;

create or replace function child_investments.ensure_current_user_access()
returns void
language plpgsql
security definer
set search_path = public, auth, child_investments
as $$
declare
  current_email text := child_investments.current_user_email();
  has_admin boolean;
begin
  if auth.uid() is null or current_email is null then
    return;
  end if;

  select exists (
    select 1
    from child_investments.user_access
    where status = 'approved'
      and role = 'admin'
  ) into has_admin;

  if not has_admin then
    insert into child_investments.user_access (email, user_id, role, status, requested_at, approved_at, approved_by)
    values (current_email, auth.uid(), 'admin', 'approved', timezone('utc', now()), timezone('utc', now()), auth.uid())
    on conflict (email) do update
      set user_id = excluded.user_id,
          role = 'admin',
          status = 'approved',
          approved_at = timezone('utc', now()),
          approved_by = auth.uid();
    return;
  end if;

  update child_investments.user_access
  set user_id = auth.uid()
  where email = current_email
    and (user_id is distinct from auth.uid());
end;
$$;

create or replace function child_investments.request_writer_access()
returns void
language plpgsql
security definer
set search_path = public, auth, child_investments
as $$
declare
  current_email text := child_investments.current_user_email();
begin
  if auth.uid() is null or current_email is null then
    raise exception 'You must sign in before requesting write access.';
  end if;

  insert into child_investments.user_access (email, user_id, role, status, requested_at)
  values (current_email, auth.uid(), 'writer', 'pending', timezone('utc', now()))
  on conflict (email) do update
    set user_id = excluded.user_id,
        role = case
          when child_investments.user_access.status = 'approved' then child_investments.user_access.role
          else 'writer'
        end,
        status = case
          when child_investments.user_access.status = 'approved' then child_investments.user_access.status
          else 'pending'
        end,
        requested_at = case
          when child_investments.user_access.status = 'approved' then child_investments.user_access.requested_at
          else timezone('utc', now())
        end;
end;
$$;

create or replace function child_investments.approve_user_access(target_email text, next_role text default 'writer')
returns void
language plpgsql
security definer
set search_path = public, auth, child_investments
as $$
declare
  normalized_email text := lower(target_email);
  matched_user_id uuid;
begin
  if not child_investments.is_admin() then
    raise exception 'Only admins can approve writer access.';
  end if;

  if next_role not in ('admin', 'writer') then
    raise exception 'Unsupported role: %', next_role;
  end if;

  select id
  into matched_user_id
  from auth.users
  where lower(email) = normalized_email
  order by created_at desc
  limit 1;

  insert into child_investments.user_access (email, user_id, role, status, requested_at, approved_at, approved_by)
  values (
    normalized_email,
    matched_user_id,
    next_role,
    'approved',
    timezone('utc', now()),
    timezone('utc', now()),
    auth.uid()
  )
  on conflict (email) do update
    set user_id = coalesce(excluded.user_id, child_investments.user_access.user_id),
        role = excluded.role,
        status = 'approved',
        approved_at = timezone('utc', now()),
        approved_by = auth.uid();
end;
$$;

grant execute on function child_investments.ensure_current_user_access() to authenticated;
grant execute on function child_investments.request_writer_access() to authenticated;
grant execute on function child_investments.approve_user_access(text, text) to authenticated;
grant execute on function child_investments.current_user_email() to anon, authenticated;
grant execute on function child_investments.is_admin() to anon, authenticated;
grant execute on function child_investments.can_write() to anon, authenticated;

alter table child_investments.children enable row level security;
alter table child_investments.cd_lots enable row level security;
alter table child_investments.transactions enable row level security;
alter table child_investments.price_snapshots enable row level security;
alter table child_investments.user_access enable row level security;

drop policy if exists child_investments_children_public_read on child_investments.children;
create policy child_investments_children_public_read
  on child_investments.children
  for select
  to anon, authenticated
  using (true);

drop policy if exists child_investments_cd_lots_public_read on child_investments.cd_lots;
create policy child_investments_cd_lots_public_read
  on child_investments.cd_lots
  for select
  to anon, authenticated
  using (true);

drop policy if exists child_investments_cd_lots_writer_write on child_investments.cd_lots;
create policy child_investments_cd_lots_writer_write
  on child_investments.cd_lots
  for all
  to authenticated
  using (child_investments.can_write())
  with check (child_investments.can_write());

drop policy if exists child_investments_transactions_public_read on child_investments.transactions;
create policy child_investments_transactions_public_read
  on child_investments.transactions
  for select
  to anon, authenticated
  using (true);

drop policy if exists child_investments_transactions_writer_write on child_investments.transactions;
create policy child_investments_transactions_writer_write
  on child_investments.transactions
  for all
  to authenticated
  using (child_investments.can_write())
  with check (child_investments.can_write());

drop policy if exists child_investments_price_snapshots_public_read on child_investments.price_snapshots;
create policy child_investments_price_snapshots_public_read
  on child_investments.price_snapshots
  for select
  to anon, authenticated
  using (true);

drop policy if exists child_investments_price_snapshots_writer_write on child_investments.price_snapshots;
create policy child_investments_price_snapshots_writer_write
  on child_investments.price_snapshots
  for all
  to authenticated
  using (child_investments.can_write())
  with check (child_investments.can_write());

drop policy if exists child_investments_user_access_self_or_admin_read on child_investments.user_access;
create policy child_investments_user_access_self_or_admin_read
  on child_investments.user_access
  for select
  to authenticated
  using (
    child_investments.is_admin()
    or email = child_investments.current_user_email()
  );

create or replace function child_investments.enforce_price_snapshot_rate_limit()
returns trigger
language plpgsql
set search_path = public, auth, child_investments
as $$
begin
  if new.source = 'coinbase_midpoint'
    and auth.role() <> 'service_role'
    and exists (
      select 1
      from child_investments.price_snapshots
      where source = 'coinbase_midpoint'
        and id <> new.id
        and priced_at >= timezone('utc', now()) - interval '5 minutes'
    ) then
    raise exception 'Bitcoin price refresh is rate limited. Please wait a few minutes.';
  end if;

  return new;
end;
$$;

drop trigger if exists child_investments_price_snapshot_rate_limit on child_investments.price_snapshots;
create trigger child_investments_price_snapshot_rate_limit
before insert or update on child_investments.price_snapshots
for each row
execute function child_investments.enforce_price_snapshot_rate_limit();
