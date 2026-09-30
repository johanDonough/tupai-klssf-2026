// Cap test against the REAL Google Sheet web app. For each syllabus it fires more
// simultaneous claims than there are accounts left and checks that exactly the
// remaining number are accepted. Lower the caps in the Settings tab first so only a
// few are left, and keep the total under "Max claims per minute".
//
//   SHEETS_URL=https://script.google.com/macros/s/.../exec node cap.mjs
//
// Writes test rows (names start with "TEST Cap"). Clear them with the Sheet menu "Go live".
const url = process.env.SHEETS_URL || '';
if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) { console.error('Set SHEETS_URL to the web app URL ending in /exec.'); process.exit(2); }

const get = async action => (await fetch(`${url}?action=${action}`, { redirect: 'follow' })).json();
const claim = (name, email, phone, syllabus) => fetch(url, {
  method: 'POST', redirect: 'follow',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ action: 'claim', name, email, phone, syllabus, consent: true }),
}).then(r => r.json()).then(r => r.result);
const tally = list => list.reduce((t, r) => ({ ...t, [r]: (t[r] || 0) + 1 }), {});
const sleep = ms => new Promise(r => setTimeout(r, ms));

let bad = 0;
const check = (name, cond, extra = '') => { console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : extra); if (!cond) bad++; };
const run = Date.now().toString().slice(-6);

const before = await get('status');
console.log('Before:', JSON.stringify(before));
if (before.state !== 'open') { console.error('Registration is not open.'); process.exit(2); }
const left = { KSSM: before.kssm_left, IGCSE: before.igcse_left };
if (left.KSSM + left.IGCSE > 12) { console.error('Too many accounts left for a quick test. Lower the caps in the Settings tab so 12 or fewer remain in total.'); process.exit(2); }

let n = 0;
for (const syl of ['KSSM', 'IGCSE']) {
  const extra = 3;
  const size = left[syl] + extra;
  const results = await Promise.all(Array.from({ length: size }, () => {
    n++;
    return claim(`TEST Cap ${syl} ${n}`, `test-cap-${run}-${n}@example.com`, `+60 1${run}${String(n).padStart(2, '0')}`, syl);
  }));
  const t = tally(results);
  console.log(`${syl}: ${left[syl]} left, ${size} simultaneous claims ->`, JSON.stringify(t));
  check(`${syl}: exactly ${left[syl]} accepted`, (t.ok || 0) === left[syl], JSON.stringify(t));
  check(`${syl}: the other ${extra} refused as full`, (t.full || 0) === extra, JSON.stringify(t));
}

await sleep(9000);   // let the 8-second status cache expire
const after = await get('status');
console.log('After:', JSON.stringify(after));
check('both counters at exactly 0', after.kssm_left === 0 && after.igcse_left === 0);

const late = await claim('TEST Cap Late', `test-cap-${run}-late@example.com`, `+60 1${run}99`, 'KSSM');
check('a later claim is still refused as full', late === 'full', late);

console.log(bad ? `\n${bad} check(s) FAILED` : '\nAll cap checks passed');
process.exit(bad ? 1 : 0);
