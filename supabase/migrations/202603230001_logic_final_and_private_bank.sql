create or replace function child_investments.bank_can_read()
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

grant execute on function child_investments.bank_can_read() to authenticated;

revoke select on child_investments.children from anon;
revoke select on child_investments.cd_lots from anon;
revoke select on child_investments.transactions from anon;
revoke select on child_investments.price_snapshots from anon;

drop policy if exists child_investments_children_public_read on child_investments.children;
create policy child_investments_children_approved_read
  on child_investments.children
  for select
  to authenticated
  using (child_investments.bank_can_read());

drop policy if exists child_investments_cd_lots_public_read on child_investments.cd_lots;
create policy child_investments_cd_lots_approved_read
  on child_investments.cd_lots
  for select
  to authenticated
  using (child_investments.bank_can_read());

drop policy if exists child_investments_transactions_public_read on child_investments.transactions;
create policy child_investments_transactions_approved_read
  on child_investments.transactions
  for select
  to authenticated
  using (child_investments.bank_can_read());

drop policy if exists child_investments_price_snapshots_public_read on child_investments.price_snapshots;
create policy child_investments_price_snapshots_approved_read
  on child_investments.price_snapshots
  for select
  to authenticated
  using (child_investments.bank_can_read());

create table if not exists child_investments.logic_final_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  score integer not null default 0,
  current_streak integer not null default 0,
  best_streak integer not null default 0,
  total_correct integer not null default 0,
  total_attempts integer not null default 0,
  mastered_terms integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint logic_final_profiles_email_lowercase check (email = lower(email))
);

create table if not exists child_investments.logic_final_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  term_id text not null,
  interval_step integer not null default 0,
  ease_factor numeric(4,2) not null default 2.30,
  next_due_at timestamptz not null default timezone('utc', now()),
  consecutive_correct integer not null default 0,
  consecutive_wrong integer not null default 0,
  total_correct integer not null default 0,
  total_wrong integer not null default 0,
  mastery_level integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, term_id)
);

create index if not exists logic_final_progress_next_due_idx
  on child_investments.logic_final_progress (user_id, next_due_at);

revoke all on child_investments.logic_final_profiles from anon, authenticated;
revoke all on child_investments.logic_final_progress from anon, authenticated;

grant select, insert, update on child_investments.logic_final_profiles to authenticated;
grant select, insert, update, delete on child_investments.logic_final_progress to authenticated;
grant all on child_investments.logic_final_profiles to service_role;
grant all on child_investments.logic_final_progress to service_role;

alter table child_investments.logic_final_profiles enable row level security;
alter table child_investments.logic_final_progress enable row level security;

drop policy if exists logic_final_profiles_authenticated_read on child_investments.logic_final_profiles;
create policy logic_final_profiles_authenticated_read
  on child_investments.logic_final_profiles
  for select
  to authenticated
  using (true);

drop policy if exists logic_final_profiles_self_insert on child_investments.logic_final_profiles;
create policy logic_final_profiles_self_insert
  on child_investments.logic_final_profiles
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and email = child_investments.current_user_email()
  );

drop policy if exists logic_final_profiles_self_update on child_investments.logic_final_profiles;
create policy logic_final_profiles_self_update
  on child_investments.logic_final_profiles
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists logic_final_progress_self_select on child_investments.logic_final_progress;
create policy logic_final_progress_self_select
  on child_investments.logic_final_progress
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists logic_final_progress_self_insert on child_investments.logic_final_progress;
create policy logic_final_progress_self_insert
  on child_investments.logic_final_progress
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists logic_final_progress_self_update on child_investments.logic_final_progress;
create policy logic_final_progress_self_update
  on child_investments.logic_final_progress
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists logic_final_progress_self_delete on child_investments.logic_final_progress;
create policy logic_final_progress_self_delete
  on child_investments.logic_final_progress
  for delete
  to authenticated
  using (user_id = auth.uid());

create or replace function child_investments.ensure_logic_final_profile()
returns void
language plpgsql
security definer
set search_path = public, auth, child_investments
as $$
declare
  current_email text := child_investments.current_user_email();
  suggested_name text;
begin
  if auth.uid() is null or current_email is null then
    return;
  end if;

  suggested_name := initcap(replace(replace(replace(split_part(current_email, '@', 1), '.', ' '), '_', ' '), '-', ' '));

  insert into child_investments.logic_final_profiles (user_id, email, display_name)
  values (auth.uid(), current_email, suggested_name)
  on conflict (user_id) do update
    set email = excluded.email,
        display_name = case
          when child_investments.logic_final_profiles.display_name = '' then excluded.display_name
          else child_investments.logic_final_profiles.display_name
        end,
        updated_at = timezone('utc', now());
end;
$$;

grant execute on function child_investments.ensure_logic_final_profile() to authenticated;
