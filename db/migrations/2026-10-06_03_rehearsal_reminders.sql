-- Rehearsal reminders (src/lib/reminders.ts): the setting to switch them off
-- on the Notifications page, and their kind in the log that stops a reminder
-- going twice. Safe to re-run.

begin;

alter table notification_prefs add column if not exists rehearsals boolean not null default true;

alter table notification_log drop constraint if exists notification_log_kind_check;
alter table notification_log add constraint notification_log_kind_check
  check (kind in ('due', 'morning', 'habit', 'rehearsal'));

commit;
