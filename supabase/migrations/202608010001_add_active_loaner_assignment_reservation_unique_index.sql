begin;

create unique index loaner_assignments_active_reservation_unique_idx
  on public.loaner_assignments (reservation_id)
  where reservation_id is not null
    and status in ('scheduled', 'checked_out');

commit;
