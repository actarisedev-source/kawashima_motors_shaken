create table if not exists public.line_scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  image_url text,
  target_label text not null default 'LINE連携済み全員',
  target_conditions jsonb not null default '{}'::jsonb,
  target_count integer not null default 0 check (target_count >= 0),
  scheduled_at timestamptz not null,
  status text not null default '予約中' check (
    status in ('予約中', '送信済み', '取消済み', '失敗')
  ),
  error_message text,
  processing_started_at timestamptz,
  sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists line_scheduled_messages_due_idx
  on public.line_scheduled_messages (status, scheduled_at)
  where status = '予約中';

alter table public.line_scheduled_messages enable row level security;

drop policy if exists "Allow service role full access to line_scheduled_messages"
  on public.line_scheduled_messages;

create policy "Allow service role full access to line_scheduled_messages"
  on public.line_scheduled_messages for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.claim_due_line_scheduled_messages(
  p_limit integer default 20
)
returns setof public.line_scheduled_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.line_scheduled_messages as scheduled
  set
    processing_started_at = now(),
    updated_at = now()
  where scheduled.id in (
    select candidate.id
    from public.line_scheduled_messages as candidate
    where candidate.status = '予約中'
      and candidate.scheduled_at <= now()
      and (
        candidate.processing_started_at is null
        or candidate.processing_started_at < now() - interval '15 minutes'
      )
    order by candidate.scheduled_at asc
    for update skip locked
    limit greatest(least(p_limit, 100), 1)
  )
  returning scheduled.*;
end;
$$;

revoke all on function public.claim_due_line_scheduled_messages(integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_line_scheduled_messages(integer)
  to service_role;
