alter table public.line_automation_settings
  drop constraint if exists line_automation_settings_type_check;

alter table public.line_automation_settings
  add constraint line_automation_settings_type_check check (
    automation_type in (
      'shaken_60_days',
      'shaken_30_days',
      'reservation_previous_day',
      'reservation_completion'
    )
  );

insert into public.line_automation_settings (
  automation_type,
  enabled,
  title,
  body,
  send_time
)
values (
  'reservation_completion',
  true,
  '予約完了通知',
  E'ご予約ありがとうございます。\n\n川島モータースです。\n\n以下の内容でご予約を受け付けました。\n\n━━━━━━━━━━━━━━\n\nご予約日時\n{{reservation_datetime}}\n\n車種\n{{vehicle_name}}\n\nナンバー\n{{plate_number}}\n\n━━━━━━━━━━━━━━\n\n内容を確認後、担当者よりご連絡いたします。\n\nご予約の変更・キャンセルをご希望の場合は、お電話にてご連絡ください。\n\n電話番号\n0268-81-2002\n\n営業時間\n8:00〜18:00\n不定休\n\n川島モータース',
  '00:00'
)
on conflict (automation_type) do update
set title = excluded.title,
    updated_at = now();

create unique index if not exists line_message_logs_reservation_completion_success_unique_idx
  on public.line_message_logs (customer_id, reservation_id)
  where automation_type = 'reservation_completion'
    and status = '成功';
