// Runs backend-sheets/Code.gs against a small fake of the Google Apps Script services
// and checks the rules. It never touches a real Sheet.
//   node test-code.mjs
// This proves the logic. It cannot prove how the real Sheets service behaves, so the
// live checks in SETUP.md still matter.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const src = fs.readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');

// ---------------------------------------------------------------- fake Apps Script

let clock = Date.parse('2026-10-02T02:00:00Z');   // Fri 2 Oct, 10:00 MYT
class FakeDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(clock); }
  static now() { return clock; }
}

function makeSheet(name) {
  const cells = [];   // cells[r][c], zero-based
  const get = (r, c) => (cells[r] && cells[r][c] !== undefined ? cells[r][c] : '');
  const sheet = {
    getName: () => name,
    getMaxRows: () => 1000,
    getLastRow() {
      for (let r = cells.length - 1; r >= 0; r--) if ((cells[r] || []).some(v => v !== '' && v !== undefined)) return r + 1;
      return 0;
    },
    setFrozenRows() {},
    getRange(row, col, nr = 1, nc = 1) {
      const range = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => get(row - 1 + i, col - 1 + j))),
        setValues(v) { v.forEach((rr, i) => rr.forEach((val, j) => { (cells[row - 1 + i] ||= [])[col - 1 + j] = val; })); return range; },
        setValue(val) { (cells[row - 1] ||= [])[col - 1] = val; return range; },
        setNumberFormat() { return range; },
        setFontWeight() { return range; },
        clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (cells[row - 1 + i]) cells[row - 1 + i][col - 1 + j] = ''; return range; },
      };
      return range;
    },
    _cells: cells,
  };
  return sheet;
}

const sheets = {};
const uiLog = [];
let promptAnswer = { button: 'OK', text: '' };
let alertAnswer = 'YES';
const ui = {
  ButtonSet: { OK_CANCEL: 1, YES_NO: 2 },
  Button: { OK: 'OK', YES: 'YES', NO: 'NO', CANCEL: 'CANCEL' },
  createMenu: () => { const m = { addItem: () => m, addSeparator: () => m, addToUi() {} }; return m; },
  alert: (...a) => { uiLog.push(a.join(' | ')); return alertAnswer; },
  prompt: () => ({ getSelectedButton: () => promptAnswer.button, getResponseText: () => promptAnswer.text }),
};
const book = {
  getId: () => 'sheet-id-123',
  getUrl: () => 'https://docs.google.com/spreadsheets/d/sheet-id-123',
  setSpreadsheetTimeZone() {},
  getSheetByName: n => sheets[n] || null,
  insertSheet: n => (sheets[n] = makeSheet(n)),
};
const propStore = {};
const props = {
  getProperty: k => (k in propStore ? propStore[k] : null),
  setProperty: (k, v) => { propStore[k] = String(v); },
  setProperties: o => { Object.entries(o).forEach(([k, v]) => { propStore[k] = String(v); }); },
  getProperties: () => ({ ...propStore }),
  deleteProperty: k => { delete propStore[k]; },
};
const cacheStore = {};
const cache = {
  get: k => (cacheStore[k] && cacheStore[k].until > clock ? cacheStore[k].v : null),
  put: (k, v, secs) => { cacheStore[k] = { v, until: clock + secs * 1000 }; },
  remove: k => { delete cacheStore[k]; },
};
const mails = [];
let lockHeld = false, lockFails = false;

const ctx = vm.createContext({
  Date: FakeDate, JSON, Math, String, Number, Object, Array, RegExp, parseInt, isNaN, console,
  SpreadsheetApp: { getActiveSpreadsheet: () => book, openById: () => book, getUi: () => ui, flush() {} },
  PropertiesService: { getScriptProperties: () => props },
  CacheService: { getScriptCache: () => cache },
  LockService: { getScriptLock: () => ({
    waitLock() { if (lockFails) throw new Error('lock timeout'); if (lockHeld) throw new Error('re-entrant lock'); lockHeld = true; },
    releaseLock() { lockHeld = false; },
  }) },
  MailApp: { sendEmail: (to, subject, body) => mails.push({ to, subject, body }) },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@tupai.ai' }) },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: text => ({ text, setMimeType(m) { this.mime = m; return this; } }),
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, str) => [...crypto.createHash('sha256').update(str, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
    getUuid: () => crypto.randomUUID(),
    formatDate(d, tz, fmt) {
      const p = {};
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
        .formatToParts(d).forEach(x => { p[x.type] = x.value; });
      const hh = p.hour === '24' ? '00' : p.hour;
      return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', hh).replace('mm', p.minute).replace('ss', p.second);
    },
  },
});
vm.runInContext(src, ctx);

// ---------------------------------------------------------------- helpers

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, extra); }
};
const get = action => JSON.parse(ctx.doGet({ parameter: { action } }).text);
const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
const status = () => { delete cacheStore.status; return get('status'); };
const claim = (name, email, phone, syllabus, consent = true) => post({ action: 'claim', name, email, phone, syllabus, consent }).result;
const setting = (key, value) => {
  const st = sheets.Settings._cells;
  const row = st.find(r => r && r[0] === key);
  row[1] = value;
  delete cacheStore.status;
};
const tick = ms => { clock += ms; };
const P = '+60 12-345 6789';

// ---------------------------------------------------------------- setup

ctx.setupSheet();
ok('setup creates the three tabs', !!sheets.KSSM && !!sheets.IGCSE && !!sheets.Settings);
ok('setup writes headers', sheets.KSSM._cells[0].join() === 'Registered (MYT),Name,Email,Phone,Timestamp (ISO)');
ok('setup fills the alert email with the owner', sheets.Settings._cells[6][1] === 'owner@tupai.ai', JSON.stringify(sheets.Settings._cells[6]));
ok('setup remembers the sheet id', propStore.SHEET_ID === 'sheet-id-123');
ctx.setupSheet();
ok('setup can be run twice without resetting settings', sheets.Settings._cells.length === 7);

let s = status();
ok('default: open on Fri 10:00 MYT, 100 / 100', s.state === 'open' && s.kssm_left === 100 && s.igcse_left === 100 && s.kssm_cap === 100, JSON.stringify(s));
ok('status exposes no settings internals', !('_opens' in s) && !('_closes' in s) && Object.keys(s).sort().join() === 'igcse_cap,igcse_left,kssm_cap,kssm_left,qr_version,state', Object.keys(s).join());

// ---------------------------------------------------------------- window

clock = Date.parse('2026-10-01T23:59:00Z');   // Fri 07:59 MYT
ok('Fri 07:59 MYT: before', status().state === 'before' && claim('Sample Parent', 'a@example.com', P, 'KSSM') === 'not_open');
clock = Date.parse('2026-10-02T00:00:00Z');   // Fri 08:00 MYT
ok('Fri 08:00 MYT: open', status().state === 'open');
clock = Date.parse('2026-10-04T15:59:59Z');   // Sun 23:59:59 MYT
ok('Sun 23:59:59 MYT: still open', status().state === 'open');
clock = Date.parse('2026-10-04T16:00:00Z');   // Mon 00:00 MYT
ok('Mon 00:00 MYT: closed', status().state === 'closed' && claim('Sample Parent', 'a@example.com', P, 'KSSM') === 'closed');
setting('Opens (MYT)', new Date('2026-10-04T15:00:00Z'));   // a real date cell instead of text
ok('a date cell in Settings is understood', status().state === 'closed');
setting('Opens (MYT)', '2026-10-02 08:00');
clock = Date.parse('2026-10-02T02:00:00Z');
{ const cached = get('status'); tick(3000); const again = get('status'); ok('status is cached briefly but state stays live', cached.kssm_left === again.kssm_left && again.state === 'open'); }

// ---------------------------------------------------------------- validation

ok('invalid: name too short', claim('A', 'a@example.com', P, 'KSSM') === 'invalid');
ok('invalid: name too long', claim('x'.repeat(101), 'a@example.com', P, 'KSSM') === 'invalid');
ok('invalid: name missing', claim(undefined, 'a@example.com', P, 'KSSM') === 'invalid');
ok('invalid: name that is only formula characters', claim('=+-@', 'a@example.com', P, 'KSSM') === 'invalid');
ok('invalid: email', claim('Sample Parent', 'a@example', P, 'KSSM') === 'invalid');
ok('invalid: email starting with =', claim('Sample Parent', '=a@example.com', P, 'KSSM') === 'invalid');
ok('invalid: email starting with +', claim('Sample Parent', '+a@example.com', P, 'KSSM') === 'invalid');
ok('invalid: syllabus', claim('Sample Parent', 'a@example.com', P, 'SPM') === 'invalid');
ok('invalid: consent false', claim('Sample Parent', 'a@example.com', P, 'KSSM', false) === 'invalid');
ok('invalid: consent as a string', claim('Sample Parent', 'a@example.com', P, 'KSSM', 'true') === 'invalid');
ok('invalid: MY number too short', claim('Sample Parent', 'a@example.com', '+60 12-345', 'KSSM') === 'invalid');
ok('invalid: MY landline', claim('Sample Parent', 'a@example.com', '+60 3-2345 6789', 'KSSM') === 'invalid');
ok('invalid: no space after code', claim('Sample Parent', 'a@example.com', '+60123456789', 'KSSM') === 'invalid');
ok('invalid: foreign too short', claim('Sample Parent', 'a@example.com', '+65 123', 'KSSM') === 'invalid');
ok('invalid: foreign too long', claim('Sample Parent', 'a@example.com', '+880 1234567890123', 'KSSM') === 'invalid');
ok('bad JSON body is refused', JSON.parse(ctx.doPost({ postData: { contents: '{not json' } }).text).error === 'bad_request');
ok('unknown action is refused', post({ action: 'dropTables' }).error === 'unknown_action');
s = status();
ok('invalid claims write nothing', s.kssm_left === 100 && s.igcse_left === 100);

// ---------------------------------------------------------------- claims and duplicates

ok('ok: MY mobile with leading 0', claim('  Sample   Parent 01 ', 'A@Example.com', '+60 012-345 6789', 'KSSM') === 'ok');
const r1 = sheets.KSSM._cells[1];
ok('row is stored trimmed, normalised, with MYT time', r1[0] === '2026-10-02 10:00:03' && r1[1] === 'Sample Parent 01' && r1[2] === 'A@Example.com' && r1[3] === '+60123456789' && r1[4] === '2026-10-02T02:00:03.000Z', JSON.stringify(r1));
tick(7000);
ok('duplicate: email, different case', claim('Other', 'a@example.COM', '+60 19-999 9999', 'KSSM') === 'duplicate');
ok('duplicate: phone, different format', claim('Other', 'b@example.com', '+60 123456789', 'KSSM') === 'duplicate');
ok('duplicate: email, other syllabus', claim('Other', 'a@example.com', '+60 19-999 9999', 'IGCSE') === 'duplicate');
ok('duplicate: phone, other syllabus', claim('Other', 'c@example.com', '+60 12 345 6789', 'IGCSE') === 'duplicate');
tick(7000); ok('ok: MY mobile, 10 digits', claim('Sample Parent 02', 'p2@example.com', '+60 11-2345 6789', 'IGCSE') === 'ok');
tick(7000); ok('ok: Singapore number', claim('Sample Parent 03', 'p3@example.com', '+65 9123 4567', 'IGCSE') === 'ok');
tick(7000); ok('ok: US number with punctuation', claim('Sample Parent 04', 'p4@example.com', '+1 (415) 555-2671', 'IGCSE') === 'ok');
tick(7000); ok('ok: UK number with leading 0', claim('Sample Parent 05', 'p5@example.com', '+44 07911 123456', 'IGCSE') === 'ok');
ok('duplicate: same UK number without the 0', claim('Sample Parent 06', 'p6@example.com', '+44 7911123456', 'KSSM') === 'duplicate');
tick(7000); ok('formula characters are stripped from a name', claim('=HYPERLINK("http://x","click")', 'h@example.com', '+60 12-000 0009', 'IGCSE') === 'ok' && sheets.IGCSE._cells[5][1] === 'HYPERLINK("http://x","click")', JSON.stringify(sheets.IGCSE._cells[5]));
ok('no stored cell starts with = + - or @ (except the phone +)', [...sheets.KSSM._cells.slice(1), ...sheets.IGCSE._cells.slice(1)].every(r => !/^[=\-@]/.test(r[1]) && !/^[=+\-@]/.test(r[2]) && /^\+\d+$/.test(r[3])));
s = status();
ok('counts: 99 KSSM, 95 IGCSE left', s.kssm_left === 99 && s.igcse_left === 95, JSON.stringify(s));

// a phone cell that Sheets turned into a number must still block a duplicate
sheets.KSSM._cells[1][3] = 60123456789;
tick(7000); ok('duplicate still caught if Sheets stored the phone as a number', claim('Other', 'z@example.com', '+60 12-345 6789', 'IGCSE') === 'duplicate');
sheets.KSSM._cells[1][3] = '+60123456789';

// ---------------------------------------------------------------- cap

setting('KSSM cap', '3');
tick(61000); ok('cap 3: 2nd claim ok', claim('K Two', 'k2@example.com', '+60 12-000 0002', 'KSSM') === 'ok');
tick(7000); ok('cap 3: 3rd claim ok', claim('K Three', 'k3@example.com', '+60 12-000 0003', 'KSSM') === 'ok');
tick(7000); ok('cap 3: 4th claim refused as full', claim('K Four', 'k4@example.com', '+60 12-000 0004', 'KSSM') === 'full');
s = status();
ok('cap: KSSM 0 left, IGCSE unaffected', s.kssm_left === 0 && s.igcse_left === 95, JSON.stringify(s));
ok('cap: refused person can still claim IGCSE', claim('K Four', 'k4@example.com', '+60 12-000 0004', 'IGCSE') === 'ok');
setting('KSSM cap', '2');
ok('left never goes negative', status().kssm_left === 0);
// deleting a junk row frees its slot
sheets.KSSM._cells.splice(3, 1);
setting('KSSM cap', '3');
ok('deleting a row in the Sheet frees the slot', status().kssm_left === 1);
setting('KSSM cap', '100');

// ---------------------------------------------------------------- speed limit and alert

tick(120000);
setting('Max claims per minute', '4');
const burst = [];
for (let i = 0; i < 8; i++) { tick(1000); burst.push(claim('Burst ' + i, `burst${i}@example.com`, `+60 12-111 00${10 + i}`, 'IGCSE')); }
ok('speed limit: first 4 in a minute accepted, the rest told busy', burst.join() === 'ok,ok,ok,ok,busy,busy,busy,busy', burst.join());
ok('speed limit: exactly one alert email, to the alert address', mails.length === 1 && mails[0].to === 'owner@tupai.ai' && /unusually fast/.test(mails[0].subject), JSON.stringify(mails.map(m => m.to)));
tick(61000);
ok('speed limit: claims resume after a minute', claim('After Burst', 'after@example.com', '+60 12-111 0099', 'IGCSE') === 'ok');
for (let i = 0; i < 6; i++) { tick(500); claim('Burst2 ' + i, `b2-${i}@example.com`, `+60 12-222 00${10 + i}`, 'IGCSE'); }
ok('speed limit: no second alert within 15 minutes', mails.length === 1);
tick(16 * 60000);
for (let i = 0; i < 6; i++) { tick(500); claim('Burst3 ' + i, `b3-${i}@example.com`, `+60 12-333 00${10 + i}`, 'IGCSE'); }
ok('speed limit: alerts again after 15 minutes', mails.length === 2);
setting('Max claims per minute', '0');
tick(61000);
const free = []; for (let i = 0; i < 6; i++) { tick(200); free.push(claim('Free ' + i, `free${i}@example.com`, `+60 12-444 00${10 + i}`, 'IGCSE')); }
ok('speed limit: 0 turns it off', free.every(r => r === 'ok'), free.join());
setting('Max claims per minute', '10');
lockFails = true;
ok('if the sheet lock cannot be taken the claim is told busy, not lost silently', claim('Lock Test', 'lock@example.com', '+60 12-555 0001', 'IGCSE') === 'busy');
lockFails = false;
ok('the lock is always released', lockHeld === false);

// ---------------------------------------------------------------- staff passcode

tick(10 * 60000);
let a = post({ action: 'admin', passcode: 'anything' });
ok('staff: no passcode set yet -> refused', a.ok === false && a.reason === 'wrong' && a.tries_left === 4, JSON.stringify(a));
ctx.unlockStaff();
promptAnswer = { button: 'OK', text: 'abc' }; ctx.setPasscode();
ok('setPasscode rejects a short passcode', !propStore.ADMIN_HASH);
promptAnswer = { button: 'CANCEL', text: 'TEST-PASS-123' }; ctx.setPasscode();
ok('setPasscode does nothing on Cancel', !propStore.ADMIN_HASH);
promptAnswer = { button: 'OK', text: 'TEST-PASS-123' }; ctx.setPasscode();
ok('passcode stored only as a salted hash', /^[0-9a-f]{64}$/.test(propStore.ADMIN_HASH) && !JSON.stringify(propStore).includes('TEST-PASS'));

a = post({ action: 'admin', passcode: 'TEST-PASS-123' });
ok('staff: correct passcode returns both lists', a.ok === true && a.kssm.length === 2 && a.igcse.length > 5 && a.kssm_cap === 100, JSON.stringify(a).slice(0, 160));
ok('staff: row has name, email, phone, created_at only', Object.keys(a.kssm[0]).sort().join() === 'created_at,email,name,phone', JSON.stringify(a.kssm[0]));
ok('staff: newest first', a.kssm[0].name === 'K Two' && a.kssm[1].name === 'Sample Parent 01', a.kssm.map(r => r.name).join());
ok('staff: passcode must be a string', post({ action: 'admin', passcode: { $ne: 1 } }).reason === 'wrong');
ctx.unlockStaff();
for (let i = 4; i >= 1; i--) {
  a = post({ action: 'admin', passcode: 'wrong' });
  ok(`staff: wrong passcode -> ${i} tries left`, a.reason === 'wrong' && a.tries_left === i, JSON.stringify(a));
}
a = post({ action: 'admin', passcode: 'wrong' });
ok('staff: 5th wrong try -> locked', a.reason === 'locked' && a.retry_seconds === 300, JSON.stringify(a));
tick(10000);
a = post({ action: 'admin', passcode: 'TEST-PASS-123' });
ok('staff: correct passcode while locked -> still locked', a.ok === false && a.reason === 'locked' && a.retry_seconds <= 300 && a.retry_seconds > 280, JSON.stringify(a));
a = post({ action: 'setQr', passcode: 'TEST-PASS-123', data_url: 'data:image/png;base64,AAAA' });
ok('staff: QR upload also refused while locked', a.ok === false && a.reason === 'locked');
tick(5 * 60000);
a = post({ action: 'admin', passcode: 'TEST-PASS-123' });
ok('staff: lock expires after 5 minutes', a.ok === true);
ok('staff: success clears the failed tries', !propStore.FAILS);

// ---------------------------------------------------------------- booth QR

ok('QR: none by default', get('qr').data_url === null && status().qr_version === '');
const big = 'data:image/png;base64,' + 'QUJD'.repeat(5000);   // 20 kB, spans several chunks
a = post({ action: 'setQr', passcode: 'nope', data_url: big });
ok('QR: upload needs the passcode', a.ok === false && a.reason === 'wrong' && get('qr').data_url === null);
ctx.unlockStaff();
ok('QR: rejects something that is not an image', post({ action: 'setQr', passcode: 'TEST-PASS-123', data_url: 'data:text/html;base64,PHNjcmlwdD4=' }).reason === 'bad_image');
ok('QR: rejects an SVG (could carry script)', post({ action: 'setQr', passcode: 'TEST-PASS-123', data_url: 'data:image/svg+xml;base64,PHN2Zz4=' }).reason === 'bad_image');
ok('QR: rejects an oversized image', post({ action: 'setQr', passcode: 'TEST-PASS-123', data_url: 'data:image/png;base64,' + 'A'.repeat(250000) }).reason === 'too_large');
a = post({ action: 'setQr', passcode: 'TEST-PASS-123', data_url: big });
ok('QR: upload accepted', a.ok === true && !!a.version);
ok('QR: stored in chunks and read back identical', Number(propStore.QR_COUNT) === 3 && get('qr').data_url === big && get('qr').version === a.version, propStore.QR_COUNT);
ok('QR: status carries the new version', status().qr_version === a.version);
tick(1000);
const small = 'data:image/jpeg;base64,/9j/AAAA';
const v2 = post({ action: 'setQr', passcode: 'TEST-PASS-123', data_url: small });
ok('QR: replacing leaves no old chunks behind', get('qr').data_url === small && Number(propStore.QR_COUNT) === 1 && !('QR_1' in propStore) && v2.version !== a.version);
ok('QR: remove needs the passcode', post({ action: 'clearQr', passcode: 'nope' }).ok === false && get('qr').data_url === small);
ctx.unlockStaff();
ok('QR: removed', post({ action: 'clearQr', passcode: 'TEST-PASS-123' }).ok === true && get('qr').data_url === null && status().qr_version === '');

// ---------------------------------------------------------------- menu actions

clock = Date.parse('2026-10-01T06:00:00Z');   // Thu 14:00 MYT, before the event
ok('Thursday: not open yet', status().state === 'before');
ctx.openForTesting();
ok('Testing menu opens registration now', status().state === 'open' && sheets.Settings._cells[3][1] === '2026-10-01 13:59', sheets.Settings._cells[3][1]);
alertAnswer = 'NO'; ctx.goLive();
ok('Go live does nothing if you answer No', sheets.KSSM._cells.length > 1 && status().state === 'open');
alertAnswer = 'YES'; ctx.goLive();
s = status();
ok('Go live: lists empty, caps 100, real window', s.kssm_left === 100 && s.igcse_left === 100 && s.state === 'before' && sheets.Settings._cells[3][1] === '2026-10-02 08:00' && sheets.Settings._cells[4][1] === '2026-10-05 00:00', JSON.stringify(s));
ok('Go live keeps the passcode', !!propStore.ADMIN_HASH);
clock = Date.parse('2026-10-02T00:00:01Z');
ok('after Go live, the first real claim on Friday lands in row 2', claim('First Real', 'first@example.com', P, 'KSSM') === 'ok' && sheets.KSSM._cells[1][1] === 'First Real');
ctx.testAlert();
ok('test alert email is sent', mails[mails.length - 1].subject === 'Tupai KLSSF: test alert');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
