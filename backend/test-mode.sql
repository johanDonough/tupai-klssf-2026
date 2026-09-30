-- TEST MODE. Run in the Supabase SQL editor while testing, before the event.
-- Opens registration now and drops the KSSM cap to 3 so "full" is easy to reach.
-- Run go-live.sql afterwards. It undoes all of this and clears the test claims.

update public.event_config
   set opens_at  = now() - interval '1 minute',
       closes_at = timestamptz '2026-10-05 00:00:00+08',
       kssm_cap  = 3,
       igcse_cap = 100;

select kssm_cap, igcse_cap,
       opens_at  at time zone 'Asia/Kuala_Lumpur' as opens_myt,
       closes_at at time zone 'Asia/Kuala_Lumpur' as closes_myt
  from public.event_config;
