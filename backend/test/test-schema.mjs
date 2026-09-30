// Runs backend/schema.sql against an in-process Postgres (PGlite) and checks the rules.
// Usage, from backend/test:  npm install  &&  node test-schema.mjs
// It does not touch any real database.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';

const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const db = new PGlite({ extensions: { pgcrypto } });

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra); }
};
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => Object.values((await q(sql, params))[0])[0];
const denied = async (sql) => {
  try { await db.exec(sql); return false; }
  catch (e) { return /permission denied/i.test(e.message); }
};

// Supabase provides these roles; PGlite does not.
await db.exec(`create role anon nologin; create role authenticated nologin;`);
await db.exec(schema);
await db.exec(schema);
ok('schema can be re-run', true);
await db.exec(`grant usage on schema public to anon; grant usage on schema extensions to anon;`);

const claim = (n, e, p, s, c = true) => one(`select public.claim_account($1,$2,$3,$4,$5)`, [n, e, p, s, c]);
const status = () => one(`select public.get_status()`);
const admin = (p) => one(`select public.admin_list($1)`, [p]);
const P = '+60 12-345 6789';

// ---- the public key cannot touch the tables
await db.exec(`set role anon`);
ok('anon cannot select kssm', await denied(`select * from public.kssm_registrations`));
ok('anon cannot select igcse', await denied(`select * from public.igcse_registrations`));
ok('anon cannot insert kssm', await denied(`insert into public.kssm_registrations(name,email,phone,email_norm,phone_norm,consent) values('a','a','a','a','a',true)`));
ok('anon cannot read event_config', await denied(`select * from public.event_config`));
ok('anon cannot update event_config', await denied(`update public.event_config set kssm_cap=999`));
ok('anon cannot read admin_config', await denied(`select * from public.admin_config`));
ok('anon cannot read admin_attempts', await denied(`select * from public.admin_attempts`));
ok('anon cannot delete admin_attempts', await denied(`delete from public.admin_attempts`));
ok('anon cannot set passcode', await denied(`select public.set_admin_passcode('hackhack')`));

// ---- default config
await db.exec(`reset role`);
const cfg = (await q(`select to_char(opens_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD HH24:MI') o,
                             to_char(closes_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD HH24:MI') c,
                             kssm_cap, igcse_cap from public.event_config`))[0];
ok('default window and caps', cfg.o === '2026-10-02 08:00' && cfg.c === '2026-10-05 00:00' && cfg.kssm_cap === 100 && cfg.igcse_cap === 100, JSON.stringify(cfg));

// ---- time window
await db.exec(`update public.event_config set opens_at = now() + interval '1 hour', closes_at = now() + interval '2 hours'; set role anon`);
ok('before opening: status', (await status()).state === 'before');
ok('before opening: claim refused', await claim('Sample Parent', 'a@example.com', P, 'KSSM') === 'not_open');
await db.exec(`reset role; update public.event_config set opens_at = now() - interval '2 hours', closes_at = now() - interval '1 hour'; set role anon`);
ok('after closing: status', (await status()).state === 'closed');
ok('after closing: claim refused', await claim('Sample Parent', 'a@example.com', P, 'KSSM') === 'closed');
await db.exec(`reset role; update public.event_config set opens_at = now() - interval '1 hour', closes_at = now() + interval '1 hour'; set role anon`);
let s = await status();
ok('open: 100 / 100 left', s.state === 'open' && s.kssm_left === 100 && s.igcse_left === 100, JSON.stringify(s));

// ---- validation
ok('invalid: name too short', await claim('A', 'a@example.com', P, 'KSSM') === 'invalid');
ok('invalid: name too long', await claim('x'.repeat(101), 'a@example.com', P, 'KSSM') === 'invalid');
ok('invalid: null name', await claim(null, 'a@example.com', P, 'KSSM') === 'invalid');
ok('invalid: email', await claim('Sample Parent', 'a@example', P, 'KSSM') === 'invalid');
ok('invalid: syllabus', await claim('Sample Parent', 'a@example.com', P, 'SPM') === 'invalid');
ok('invalid: null syllabus', await claim('Sample Parent', 'a@example.com', P, null) === 'invalid');
ok('invalid: consent false', await claim('Sample Parent', 'a@example.com', P, 'KSSM', false) === 'invalid');
ok('invalid: consent null', await claim('Sample Parent', 'a@example.com', P, 'KSSM', null) === 'invalid');
ok('invalid: MY number too short', await claim('Sample Parent', 'a@example.com', '+60 12-345', 'KSSM') === 'invalid');
ok('invalid: MY landline', await claim('Sample Parent', 'a@example.com', '+60 3-2345 6789', 'KSSM') === 'invalid');
ok('invalid: no space after code', await claim('Sample Parent', 'a@example.com', '+60123456789', 'KSSM') === 'invalid');
ok('invalid: foreign too short', await claim('Sample Parent', 'a@example.com', '+65 123', 'KSSM') === 'invalid');
ok('invalid: foreign too long', await claim('Sample Parent', 'a@example.com', '+880 1234567890123', 'KSSM') === 'invalid');
ok('invalid: empty phone', await claim('Sample Parent', 'a@example.com', '', 'KSSM') === 'invalid');
s = await status();
ok('invalid claims insert nothing', s.kssm_left === 100 && s.igcse_left === 100);

// ---- accepted claims and duplicates
ok('ok: MY mobile, 9 digits, leading 0', await claim('  Sample Parent 01 ', 'A@Example.com', '+60 012-345 6789', 'KSSM') === 'ok');
ok('duplicate: email, different case', await claim('Other', 'a@example.COM', '+60 19-999 9999', 'KSSM') === 'duplicate');
ok('duplicate: phone, different format', await claim('Other', 'b@example.com', '+60 123456789', 'KSSM') === 'duplicate');
ok('duplicate: email, other syllabus', await claim('Other', 'a@example.com', '+60 19-999 9999', 'IGCSE') === 'duplicate');
ok('duplicate: phone, other syllabus', await claim('Other', 'c@example.com', '+60 12 345 6789', 'IGCSE') === 'duplicate');
ok('ok: MY mobile, 10 digits', await claim('Sample Parent 02', 'p2@example.com', '+60 11-2345 6789', 'IGCSE') === 'ok');
ok('ok: Singapore number', await claim('Sample Parent 03', 'p3@example.com', '+65 9123 4567', 'IGCSE') === 'ok');
ok('ok: US number with punctuation', await claim('Sample Parent 04', 'p4@example.com', '+1 (415) 555-2671', 'IGCSE') === 'ok');
ok('ok: UK number with leading 0', await claim('Sample Parent 05', 'p5@example.com', '+44 07911 123456', 'IGCSE') === 'ok');
ok('duplicate: same UK number without the 0', await claim('Sample Parent 06', 'p6@example.com', '+44 7911123456', 'KSSM') === 'duplicate');
s = await status();
ok('counts: 99 KSSM, 96 IGCSE left', s.kssm_left === 99 && s.igcse_left === 96, JSON.stringify(s));

await db.exec(`reset role`);
const row = (await q(`select name,email,email_norm,phone_norm,consent from public.kssm_registrations`))[0];
ok('stored trimmed and normalised', row.name === 'Sample Parent 01' && row.email === 'A@Example.com' && row.email_norm === 'a@example.com' && row.phone_norm === '+60123456789' && row.consent === true, JSON.stringify(row));
const uk = await one(`select phone_norm from public.igcse_registrations where email_norm='p5@example.com'`);
ok('UK number normalised', uk === '+447911123456', uk);

// ---- cap
await db.exec(`update public.event_config set kssm_cap = 3; set role anon`);
ok('cap 3: 2nd claim ok', await claim('K Two', 'k2@example.com', '+60 12-000 0002', 'KSSM') === 'ok');
ok('cap 3: 3rd claim ok', await claim('K Three', 'k3@example.com', '+60 12-000 0003', 'KSSM') === 'ok');
ok('cap 3: 4th claim refused as full', await claim('K Four', 'k4@example.com', '+60 12-000 0004', 'KSSM') === 'full');
s = await status();
ok('cap: KSSM 0 left, IGCSE unaffected', s.kssm_left === 0 && s.igcse_left === 96, JSON.stringify(s));
ok('cap: refused person can still claim IGCSE', await claim('K Four', 'k4@example.com', '+60 12-000 0004', 'IGCSE') === 'ok');
await db.exec(`reset role; update public.event_config set kssm_cap = 2; set role anon`);
s = await status();
ok('left never goes negative', s.kssm_left === 0, JSON.stringify(s));

// ---- staff list and lockout
let a = await admin('anything');
ok('admin: no passcode set yet -> refused', a.ok === false && a.reason === 'wrong' && a.tries_left === 4, JSON.stringify(a));
await db.exec(`reset role; delete from public.admin_attempts;`);
let threw = false;
try { await db.exec(`select public.set_admin_passcode('abc')`); } catch (e) { threw = true; }
ok('set_admin_passcode rejects a short passcode', threw);
await db.exec(`select public.set_admin_passcode('TEST-PASS-123')`);
const h = await one(`select passcode_hash from public.admin_config`);
ok('passcode stored as a bcrypt hash only', /^\$2[aby]\$10\$/.test(h) && !h.includes('TEST-PASS'), h.slice(0, 10));

await db.exec(`set role anon`);
a = await admin('TEST-PASS-123');
ok('admin: correct passcode returns both lists', a.ok === true && a.kssm.length === 3 && a.igcse.length === 5 && a.kssm_cap === 2, JSON.stringify(a).slice(0, 200));
ok('admin: row has name, email, phone, created_at only', Object.keys(a.kssm[0]).sort().join() === 'created_at,email,name,phone' && a.kssm[0].phone.startsWith('+60'), JSON.stringify(a.kssm[0]));
ok('admin: newest first', a.kssm[0].name === 'K Three' && a.kssm[2].name === 'Sample Parent 01', a.kssm.map(r => r.name).join());
for (let i = 4; i >= 1; i--) {
  a = await admin('wrong');
  ok(`admin: wrong passcode -> ${i} tries left`, a.reason === 'wrong' && a.tries_left === i, JSON.stringify(a));
}
a = await admin('wrong');
ok('admin: 5th wrong try -> locked', a.reason === 'locked' && a.retry_seconds === 300, JSON.stringify(a));
a = await admin('TEST-PASS-123');
ok('admin: correct passcode while locked -> still locked', a.ok === false && a.reason === 'locked' && a.retry_seconds > 290 && a.retry_seconds <= 300, JSON.stringify(a));

await db.exec(`select set_config('request.headers', '{"x-forwarded-for":"1.2.3.4, 10.0.0.1"}', false)`);
a = await admin('TEST-PASS-123');
ok('admin: a different IP is not locked', a.ok === true);
a = await admin('nope');
ok('admin: different IP has its own count', a.reason === 'wrong' && a.tries_left === 4, JSON.stringify(a));
await db.exec(`reset role`);
const ips = await q(`select ip, count(*)::int n from public.admin_attempts group by ip order by ip`);
ok('attempts recorded per IP, first hop only', JSON.stringify(ips) === JSON.stringify([{ ip: '1.2.3.4', n: 1 }, { ip: 'unknown', n: 5 }]), JSON.stringify(ips));

await db.exec(`update public.admin_attempts set attempted_at = attempted_at - interval '6 minutes' where ip='unknown'; select set_config('request.headers','',false); set role anon`);
a = await admin('TEST-PASS-123');
ok('admin: lock expires after 5 minutes', a.ok === true, JSON.stringify(a).slice(0, 80));
await db.exec(`reset role`);
ok('admin: success clears that IP\'s failed tries', (await one(`select count(*)::int from public.admin_attempts where ip='unknown'`)) === 0);

// ---- privileges
const priv = await q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') anon
                        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public'
                         and p.proname in ('get_status','claim_account','admin_list','set_admin_passcode')
                       order by 1`);
ok('anon may run only the three public functions', JSON.stringify(priv) === JSON.stringify([
  { proname: 'admin_list', anon: true }, { proname: 'claim_account', anon: true },
  { proname: 'get_status', anon: true }, { proname: 'set_admin_passcode', anon: false }]), JSON.stringify(priv));
const rls = await q(`select relname, relrowsecurity from pg_class
                      where relname in ('kssm_registrations','igcse_registrations','event_config','admin_config','admin_attempts')`);
ok('RLS on for all five tables', rls.length === 5 && rls.every(r => r.relrowsecurity), JSON.stringify(rls));
ok('no RLS policies exist', (await one(`select count(*)::int from pg_policies where schemaname='public'`)) === 0);

// ---- test-mode.sql and go-live.sql
await db.exec(fs.readFileSync(new URL('../test-mode.sql', import.meta.url), 'utf8'));
await db.exec(`set role anon`);
s = await status();
ok('test-mode.sql: open now, KSSM cap 3', s.state === 'open' && s.kssm_cap === 3 && s.igcse_cap === 100, JSON.stringify(s));
await db.exec(`reset role`);
await db.exec(fs.readFileSync(new URL('../go-live.sql', import.meta.url), 'utf8'));
const live = (await q(`select (select count(*)::int from public.kssm_registrations) k,
                              (select count(*)::int from public.igcse_registrations) i,
                              (select count(*)::int from public.admin_attempts) a,
                              kssm_cap, igcse_cap,
                              to_char(opens_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD HH24:MI') o,
                              to_char(closes_at at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD HH24:MI') c
                         from public.event_config`))[0];
ok('go-live.sql: rows cleared, caps 100, real window',
  live.k === 0 && live.i === 0 && live.a === 0 && live.kssm_cap === 100 && live.igcse_cap === 100 &&
  live.o === '2026-10-02 08:00' && live.c === '2026-10-05 00:00', JSON.stringify(live));
ok('go-live.sql keeps the staff passcode', (await one(`select count(*)::int from public.admin_config`)) === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
