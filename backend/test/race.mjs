// Race test against the REAL database. Fires many claims at the same moment and
// checks that no more than the cap get through. Run it in test mode only
// (backend/test-mode.sql sets the KSSM cap to 3), then run go-live.sql to clear up.
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=... node race.mjs
//
// Needs Node 18 or newer. No dependencies.
const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_ANON_KEY || '';
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY.'); process.exit(2); }

const rpc = async (fn, body = {}) => {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
};
const direct = async (table) => {
  const res = await fetch(`${url}/rest/v1/${table}?select=*`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  return { status: res.status, body: (await res.text()).slice(0, 120) };
};

const before = await rpc('get_status');
console.log('Before:', before);
if (before.state !== 'open') { console.error('Registration is not open. Run backend/test-mode.sql first.'); process.exit(2); }

const N = 25;
const run = Date.now().toString().slice(-6);
const results = await Promise.all(Array.from({ length: N }, (_, i) => rpc('claim_account', {
  p_name: `Race Test ${i}`,
  p_email: `race-${run}-${i}@example.com`,
  p_phone: `+60 1${run}${String(i).padStart(2, '0')}`,
  p_syllabus: 'KSSM',
  p_consent: true,
})));
const tally = results.reduce((t, r) => ({ ...t, [r]: (t[r] || 0) + 1 }), {});
const after = await rpc('get_status');
console.log(`${N} simultaneous KSSM claims ->`, tally);
console.log('After:', after);

let bad = 0;
const check = (name, cond) => { console.log(cond ? 'PASS' : 'FAIL', name); if (!cond) bad++; };
check('no more claims accepted than were left', (tally.ok || 0) === Math.min(N, before.kssm_left));
check('the rest were refused as full', (tally.full || 0) === N - (tally.ok || 0));
check('KSSM left is exactly what remains', after.kssm_left === before.kssm_left - (tally.ok || 0));

for (const table of ['kssm_registrations', 'igcse_registrations', 'event_config', 'admin_config', 'admin_attempts']) {
  const r = await direct(table);
  check(`public key cannot read ${table} (HTTP ${r.status})`, r.status >= 400 || r.body.trim() === '[]');
}
const wrong = await rpc('admin_list', { p_passcode: 'definitely-not-the-passcode' });
check('wrong passcode returns no rows', wrong.ok === false && !wrong.kssm && !wrong.igcse);
console.log('Note: that was one failed passcode try from this IP (5 in 5 minutes locks the IP out).');

process.exit(bad ? 1 : 0);
