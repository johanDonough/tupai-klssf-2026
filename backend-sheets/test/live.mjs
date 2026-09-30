// Live test against the REAL Google Sheet web app. It writes test rows (names start with
// "TEST") and will trip the speed limit once, which sends one alert email.
// Run it only while testing, then use the Sheet menu "Go live" to clear the rows.
//
//   SHEETS_URL=https://script.google.com/macros/s/.../exec node live.mjs
//
// Needs Node 18 or newer. It never sends the staff passcode.
const url = process.env.SHEETS_URL || '';
if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) { console.error('Set SHEETS_URL to the web app URL ending in /exec.'); process.exit(2); }

const get = async action => (await fetch(`${url}?action=${action}`, { redirect: 'follow' })).json();
const post = async body => (await fetch(url, {
  method: 'POST', redirect: 'follow',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})).json();
const okTimes = [];   // when each accepted claim was answered
const claim = (name, email, phone, syllabus, consent = true) =>
  post({ action: 'claim', name, email, phone, syllabus, consent }).then(r => { if (r.result === 'ok') okTimes.push(Date.now()); return r.result; });
const tally = list => list.reduce((t, r) => ({ ...t, [r]: (t[r] || 0) + 1 }), {});
const sleep = ms => new Promise(r => setTimeout(r, ms));

let bad = 0;
const check = (name, cond, extra = '') => { console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : extra); if (!cond) bad++; };

const run = Date.now().toString().slice(-6);
const mail = i => `test-${run}-${i}@example.com`;
const phone = i => `+60 1${run}${String(i).padStart(2, '0')}`;

const before = await get('status');
console.log('Before:', JSON.stringify(before));
if (before.state !== 'open') { console.error('Registration is not open. Use the Sheet menu: Testing: open registration now.'); process.exit(2); }
check('status has the expected fields only', Object.keys(before).sort().join() === 'igcse_cap,igcse_left,kssm_cap,kssm_left,qr_version,state', Object.keys(before).join());

let accepted = 0;

// 1. Refusals that must not write anything
check('invalid: short name', await claim('A', mail(90), phone(90), 'KSSM') === 'invalid');
check('invalid: bad email', await claim('TEST Invalid', 'nope@nope', phone(90), 'KSSM') === 'invalid');
check('invalid: email starting with =', await claim('TEST Invalid', '=cmd@example.com', phone(90), 'KSSM') === 'invalid');
check('invalid: consent missing', await claim('TEST Invalid', mail(90), phone(90), 'KSSM', false) === 'invalid');
check('invalid: Malaysian landline', await claim('TEST Invalid', mail(90), '+60 3-2345 6789', 'KSSM') === 'invalid');
check('invalid: unknown syllabus', await claim('TEST Invalid', mail(90), phone(90), 'SPM') === 'invalid');
check('bad JSON is refused', (await post('{not json')).error === 'bad_request');
check('unknown action is refused', (await post({ action: 'dropEverything' })).error === 'unknown_action');
check('unknown GET action is refused', (await get('listAll')).error === 'unknown_action');

// 2. The lock: six identical claims at the same moment, only one may win
const same = await Promise.all(Array.from({ length: 6 }, () => claim('TEST Same Person', mail(1), phone(1), 'IGCSE')));
const sameT = tally(same);
console.log('6 identical simultaneous claims ->', JSON.stringify(sameT));
check('exactly one identical claim accepted', sameT.ok === 1 && sameT.duplicate === 5, JSON.stringify(sameT));
accepted += sameT.ok || 0;

// 3. A name that tries to be a spreadsheet formula, and a foreign number
const f = await claim('=HYPERLINK("http://example.com","TEST Formula")', mail(2), '+65 8' + run + '2', 'IGCSE');
check('formula-style name is accepted with the = stripped (check the row in the Sheet)', f === 'ok', f);
if (f === 'ok') accepted++;
check('same foreign number, different spacing, is a duplicate', await claim('TEST Dup', mail(3), '+65 8 ' + run + ' 2', 'KSSM') === 'duplicate');

// 4. Six different people at the same moment: all should get through
const six = await Promise.all(Array.from({ length: 6 }, (_, i) => claim(`TEST Together ${i}`, mail(10 + i), phone(10 + i), i % 2 ? 'KSSM' : 'IGCSE')));
const sixT = tally(six);
console.log('6 different simultaneous claims ->', JSON.stringify(sixT));
accepted += sixT.ok || 0;
check('six different simultaneous claims all accepted', sixT.ok === 6, JSON.stringify(sixT));

// 5. Keep claiming one after another until the speed limit answers "busy".
// One at a time, so a "busy" here is the speed limit and not a queue timeout.
const seq = [];
for (let i = 0; i < 8; i++) {
  const r = await claim(`TEST Queue ${i}`, mail(30 + i), phone(30 + i), i % 2 ? 'KSSM' : 'IGCSE');
  seq.push(r);
  if (r === 'ok') accepted++;
}
console.log('8 more, one after another ->', seq.join(', '));
check('speed limit: only ok or busy answers', seq.every(r => r === 'ok' || r === 'busy'), seq.join());
check('speed limit: it refused some (an alert email should arrive)', seq.includes('busy'), seq.join());
// The limit is a rolling minute. What must never happen is 11 accepted inside one minute.
okTimes.sort((a, b) => a - b);
let worst = 0;
for (let i = 0; i < okTimes.length; i++) {
  let n = 0;
  for (let j = i; j < okTimes.length && okTimes[j] - okTimes[i] < 55000; j++) n++;
  worst = Math.max(worst, n);
}
console.log(`Accepted ${accepted} over ${Math.round((okTimes[okTimes.length - 1] - okTimes[0]) / 1000)}s; most in any one minute: ${worst}`);
check('speed limit: never more than 10 accepted inside one minute', worst <= 10, 'worst ' + worst);

await sleep(9000);   // let the 8-second status cache expire
const after = await get('status');
console.log('After:', JSON.stringify(after));
const delta = (before.kssm_left + before.igcse_left) - (after.kssm_left + after.igcse_left);
check(`counters dropped by exactly the ${accepted} accepted claims`, delta === accepted, 'dropped ' + delta);

// 6. Staff list without the passcode
if (process.env.SKIP_STAFF) {
  console.log(bad ? `${bad} check(s) FAILED` : 'All live checks passed (staff checks skipped)');
  process.exit(bad ? 1 : 0);
}
const wrong = await post({ action: 'admin', passcode: 'not-the-passcode-' + run });
check('wrong passcode returns no rows', wrong.ok === false && !wrong.kssm && !wrong.igcse, JSON.stringify(wrong).slice(0, 120));
const noQr = await post({ action: 'setQr', passcode: 'not-the-passcode-' + run, data_url: 'data:image/png;base64,AAAA' });
check('QR upload refused without the passcode', noQr.ok === false, JSON.stringify(noQr).slice(0, 120));
console.log('Note: that used 2 of the 5 wrong-passcode tries. They expire in 5 minutes.');

console.log(bad ? `\n${bad} check(s) FAILED` : '\nAll live checks passed');
process.exit(bad ? 1 : 0);
