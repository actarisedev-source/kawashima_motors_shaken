-- Prevent duplicate active reservations for the same one-hour slot.
-- Run this in Supabase SQL Editor after confirming existing duplicate slots do not exist.
create unique index if not exists reservations_reserved_at_active_unique
on public.reservations (reserved_at)
where status <> 'キャンセル';
