-- GO LIVE. Run once in the Supabase SQL editor after all testing, before Fri 2 Oct 08:00 MYT.
-- Deletes every test claim, restores the caps and sets the real registration window.
-- Do NOT run this during or after the event: it deletes the claims.

begin;

delete from public.kssm_registrations;
delete from public.igcse_registrations;
delete from public.admin_attempts;

update public.event_config
   set kssm_cap  = 100,
       igcse_cap = 100,
       opens_at  = timestamptz '2026-10-02 08:00:00+08',   -- Fri 2 Oct, 8am MYT
       closes_at = timestamptz '2026-10-05 00:00:00+08';   -- midnight at the end of Sun 4 Oct, MYT

commit;

-- Check: counts 0 / 0 / 0, caps 100 / 100, window Fri 08:00 to Mon 00:00 MYT.
select (select count(*) from public.kssm_registrations)  as kssm_rows,
       (select count(*) from public.igcse_registrations) as igcse_rows,
       (select count(*) from public.admin_attempts)      as attempt_rows,
       kssm_cap, igcse_cap,
       opens_at  at time zone 'Asia/Kuala_Lumpur' as opens_myt,
       closes_at at time zone 'Asia/Kuala_Lumpur' as closes_myt
  from public.event_config;
