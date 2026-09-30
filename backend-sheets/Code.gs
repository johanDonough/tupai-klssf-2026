/**
 * Tupai KLSSF 2026 booth registration: Google Sheet backend.
 *
 * Lives inside the Google Sheet (Extensions > Apps Script) and is deployed as a web app.
 * The page calls it for four things: the counts, a claim, the staff list, and the booth QR image.
 * The Sheet itself is never shared publicly. Only this script reads and writes it.
 *
 * First-time setup is in backend-sheets/SETUP.md.
 */

var TZ = 'Asia/Kuala_Lumpur';
var TAB = { KSSM: 'KSSM', IGCSE: 'IGCSE', SETTINGS: 'Settings' };
var HEAD = ['Registered (MYT)', 'Name', 'Email', 'Phone', 'Timestamp (ms)'];
var COL = { WHEN: 1, NAME: 2, EMAIL: 3, PHONE: 4, TS: 5 };

var S = {
  KSSM_CAP: 'KSSM cap',
  IGCSE_CAP: 'IGCSE cap',
  OPENS: 'Opens (MYT)',
  CLOSES: 'Closes (MYT)',
  RATE: 'Max claims per minute',
  ALERT: 'Alert email'
};
var REAL_OPENS = '2026-10-02 08:00';    // Fri 2 Oct, 8am
var REAL_CLOSES = '2026-10-05 00:00';   // midnight at the end of Sun 4 Oct

var LOCK_TRIES = 5;                     // wrong passcodes before the staff view locks
var LOCK_MS = 5 * 60 * 1000;
var ALERT_GAP_MS = 15 * 60 * 1000;      // at most one alert email per 15 minutes
var QR_CHUNK = 8000;                    // script properties hold about 9 KB each
var QR_MAX = 240000;                    // largest QR image accepted, as a data URL

// ------------------------------------------------------------------ web app

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'status';
  try {
    if (action === 'status') return json_(getStatus_());
    if (action === 'qr') return json_(getQr_());
    return json_({ error: 'unknown_action' });
  } catch (err) {
    return json_({ error: 'server_error' });
  }
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents || '{}'); } catch (err) { return json_({ error: 'bad_request' }); }
  try {
    if (body.action === 'claim') return json_({ result: claim_(body) });
    if (body.action === 'admin') return json_(adminList_(body.passcode));
    if (body.action === 'setQr') return json_(setQr_(body.passcode, body.data_url));
    if (body.action === 'clearQr') return json_(clearQr_(body.passcode));
    return json_({ error: 'unknown_action' });
  } catch (err) {
    return json_({ error: 'server_error' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------------ sheet access

function book_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
}

function settings_() {
  var sh = book_().getSheetByName(TAB.SETTINGS);
  var rows = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).getValues();
  var map = {};
  rows.forEach(function (r) { if (r[0]) map[String(r[0]).trim()] = r[1]; });
  return {
    kssmCap: toInt_(map[S.KSSM_CAP], 100),
    igcseCap: toInt_(map[S.IGCSE_CAP], 100),
    opens: toTime_(map[S.OPENS], REAL_OPENS),
    closes: toTime_(map[S.CLOSES], REAL_CLOSES),
    rate: toInt_(map[S.RATE], 10),
    alert: String(map[S.ALERT] || '').trim()
  };
}

function toInt_(v, fallback) {
  var n = parseInt(v, 10);
  return isNaN(n) || n < 0 ? fallback : n;
}

// Accepts the text "yyyy-MM-dd HH:mm" (read as Malaysia time) or a real date cell.
function toTime_(v, fallback) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getTime();
  var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(String(v || '').trim());
  if (!m) m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(fallback);
  var hh = ('0' + m[4]).slice(-2);
  return new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' + hh + ':' + m[5] + ':00+08:00').getTime();
}

// The timestamp column holds milliseconds since 1970 as a plain number, because a number is
// the one thing Sheets cannot reinterpret. Column A is the readable copy for people.
// Older rows, or cells Sheets has turned into dates, are still read as best they can be.
function toMs_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? 0 : v.getTime();
  var n = Number(v);
  if (isFinite(n) && n > 1e12) return n;
  var p = Date.parse(String(v));
  return isNaN(p) ? 0 : p;
}

// Every claim in one tab: [{ name, email, phone, ms, iso }], in sheet order (oldest first).
function rows_(tabName) {
  var sh = book_().getSheetByName(tabName);
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEAD.length).getValues()
    .filter(function (r) { return String(r[COL.EMAIL - 1]).trim() !== ''; })
    .map(function (r) {
      var ms = toMs_(r[COL.TS - 1]);
      return {
        name: String(r[COL.NAME - 1]),
        email: String(r[COL.EMAIL - 1]),
        phone: normPhoneCell_(r[COL.PHONE - 1]),
        ms: ms,
        iso: ms ? new Date(ms).toISOString() : ''
      };
    });
}

// The phone column is text like "+60123456789". If Sheets ever turns it into a number, this still reads it.
function normPhoneCell_(v) {
  var digits = String(v).replace(/\D/g, '');
  return digits ? '+' + digits : '';
}

// ------------------------------------------------------------------ status

function getStatus_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('status');
  if (hit) {
    var cached = JSON.parse(hit);
    cached.state = stateOf_(cached._opens, cached._closes);
    delete cached._opens; delete cached._closes;
    return cached;
  }
  var cfg = settings_();
  var k = rows_(TAB.KSSM).length, i = rows_(TAB.IGCSE).length;
  var out = {
    kssm_cap: cfg.kssmCap,
    igcse_cap: cfg.igcseCap,
    kssm_left: Math.max(cfg.kssmCap - k, 0),
    igcse_left: Math.max(cfg.igcseCap - i, 0),
    qr_version: PropertiesService.getScriptProperties().getProperty('QR_VERSION') || '',
    _opens: cfg.opens,
    _closes: cfg.closes
  };
  cache.put('status', JSON.stringify(out), 8);
  out.state = stateOf_(cfg.opens, cfg.closes);
  delete out._opens; delete out._closes;
  return out;
}

function stateOf_(opens, closes) {
  var now = Date.now();
  return now < opens ? 'before' : now >= closes ? 'closed' : 'open';
}

// ------------------------------------------------------------------ claim

// Returns: ok | duplicate | full | not_open | closed | invalid | busy
function claim_(d) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return 'busy'; }
  try {
    var cfg = settings_();
    var now = Date.now();
    if (now < cfg.opens) return 'not_open';
    if (now >= cfg.closes) return 'closed';

    var clean = validate_(d);
    if (!clean) return 'invalid';

    var kssm = rows_(TAB.KSSM), igcse = rows_(TAB.IGCSE), all = kssm.concat(igcse);

    // Speed limit. No booth signs up this many people in a minute, so treat it as a script.
    var recent = all.filter(function (r) { return r.ms > 0 && now - r.ms < 60000; }).length;
    if (cfg.rate > 0 && recent >= cfg.rate) {
      alert_(cfg, recent);
      return 'busy';
    }

    var taken = all.some(function (r) {
      return r.email.toLowerCase() === clean.emailNorm || r.phone === clean.phoneNorm;
    });
    if (taken) return 'duplicate';

    var list = clean.syllabus === 'KSSM' ? kssm : igcse;
    var cap = clean.syllabus === 'KSSM' ? cfg.kssmCap : cfg.igcseCap;
    if (list.length >= cap) return 'full';

    var sh = book_().getSheetByName(clean.syllabus === 'KSSM' ? TAB.KSSM : TAB.IGCSE);
    var stamp = new Date(now);
    var row = sh.getLastRow() + 1;
    sh.getRange(row, 1, 1, HEAD.length)
      .setNumberFormat('@')   // plain text, so nothing a visitor types is ever read as a formula
      .setValues([[
        Utilities.formatDate(stamp, TZ, 'yyyy-MM-dd HH:mm:ss'),
        clean.name, clean.email, clean.phoneNorm, String(now)
      ]]);
    SpreadsheetApp.flush();
    CacheService.getScriptCache().remove('status');
    return 'ok';
  } finally {
    lock.releaseLock();
  }
}

// Same rules as js/validate.js in the page. Returns null if anything is wrong.
function validate_(d) {
  if (!d || d.consent !== true) return null;
  if (d.syllabus !== 'KSSM' && d.syllabus !== 'IGCSE') return null;

  // A name or email can never begin with = + - or @, which is what a spreadsheet formula needs.
  var name = String(d.name || '').replace(/^[\s=+\-@]+/, '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 100) return null;

  var email = String(d.email || '').trim();
  if (email.length > 254 || !/^[A-Za-z0-9][^@\s]*@[^@\s]+\.[^@\s]+$/.test(email)) return null;

  var phone = String(d.phone || '').trim();
  var sp = phone.indexOf(' ');
  if (sp < 0) return null;
  var cc = phone.slice(0, sp).replace(/\D/g, '');
  var nn = phone.slice(sp + 1).replace(/\D/g, '').replace(/^0+/, '');
  if (!/^[1-9][0-9]{0,3}$/.test(cc)) return null;
  if (cc === '60') {
    if (!/^1[0-9]{8,9}$/.test(nn)) return null;            // Malaysian mobile
  } else if (!/^[0-9]{6,12}$/.test(nn) || (cc + nn).length > 15) {
    return null;
  }
  return {
    name: name, email: email, emailNorm: email.toLowerCase(),
    phoneNorm: '+' + cc + nn, syllabus: d.syllabus
  };
}

function alert_(cfg, recent) {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty('LAST_ALERT') || 0);
  if (Date.now() - last < ALERT_GAP_MS) return;
  props.setProperty('LAST_ALERT', String(Date.now()));
  if (!cfg.alert) return;
  try {
    MailApp.sendEmail(cfg.alert,
      'Tupai KLSSF: claims are coming in unusually fast',
      recent + ' claims arrived in the last minute, which is more than the limit of ' + cfg.rate + '.\n\n' +
      'New claims are being asked to try again shortly. Real visitors can carry on in a minute.\n\n' +
      'If the newest rows look fake, delete those rows in the KSSM and IGCSE tabs. ' +
      'That frees the slots straight away.\n\n' + book_().getUrl());
  } catch (err) { /* an alert must never block a claim */ }
}

// ------------------------------------------------------------------ staff

function hash_(salt, passcode) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + passcode, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

// Returns null if the passcode is right, or the { ok:false, ... } answer to send back.
// Apps Script cannot see the caller's IP, so the lockout is shared by everyone.
function checkPasscode_(passcode) {
  var props = PropertiesService.getScriptProperties();
  var now = Date.now();
  var fails = JSON.parse(props.getProperty('FAILS') || '[]').filter(function (t) { return now - t < LOCK_MS; });
  if (fails.length >= LOCK_TRIES) {
    var fifth = fails.slice().sort(function (a, b) { return b - a; })[LOCK_TRIES - 1];
    return { ok: false, reason: 'locked', retry_seconds: Math.ceil((fifth + LOCK_MS - now) / 1000) };
  }
  var salt = props.getProperty('ADMIN_SALT'), want = props.getProperty('ADMIN_HASH');
  var right = !!salt && !!want && typeof passcode === 'string' && hash_(salt, passcode) === want;
  if (!right) {
    fails.push(now);
    props.setProperty('FAILS', JSON.stringify(fails));
    return fails.length >= LOCK_TRIES
      ? { ok: false, reason: 'locked', retry_seconds: LOCK_MS / 1000 }
      : { ok: false, reason: 'wrong', tries_left: LOCK_TRIES - fails.length };
  }
  props.deleteProperty('FAILS');
  return null;
}

function withPasscode_(passcode, fn) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return { ok: false, reason: 'busy' }; }
  try {
    var refused = checkPasscode_(passcode);
    return refused || fn();
  } finally {
    lock.releaseLock();
  }
}

function adminList_(passcode) {
  return withPasscode_(passcode, function () {
    var cfg = settings_();
    var shape = function (r) { return { name: r.name, email: r.email, phone: r.phone, created_at: r.iso }; };
    return {
      ok: true,
      kssm_cap: cfg.kssmCap,
      igcse_cap: cfg.igcseCap,
      kssm: rows_(TAB.KSSM).map(shape).reverse(),     // newest first
      igcse: rows_(TAB.IGCSE).map(shape).reverse()
    };
  });
}

// ------------------------------------------------------------------ booth QR image

function getQr_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var n = Number(props.QR_COUNT || 0);
  if (!n) return { version: '', data_url: null };
  var parts = [];
  for (var i = 0; i < n; i++) parts.push(props['QR_' + i] || '');
  return { version: props.QR_VERSION || '', data_url: parts.join('') };
}

function wipeQr_(props) {
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) { if (/^QR_/.test(k)) props.deleteProperty(k); });
}

function setQr_(passcode, dataUrl) {
  return withPasscode_(passcode, function () {
    var url = String(dataUrl || '');
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(url)) return { ok: false, reason: 'bad_image' };
    if (url.length > QR_MAX) return { ok: false, reason: 'too_large' };
    var props = PropertiesService.getScriptProperties();
    wipeQr_(props);
    var batch = {}, n = 0;
    for (var i = 0; i < url.length; i += QR_CHUNK) { batch['QR_' + n] = url.slice(i, i + QR_CHUNK); n++; }
    batch.QR_COUNT = String(n);
    batch.QR_VERSION = String(Date.now());
    props.setProperties(batch);
    CacheService.getScriptCache().remove('status');
    return { ok: true, version: batch.QR_VERSION };
  });
}

function clearQr_(passcode) {
  return withPasscode_(passcode, function () {
    wipeQr_(PropertiesService.getScriptProperties());
    CacheService.getScriptCache().remove('status');
    return { ok: true, version: '' };
  });
}

// ------------------------------------------------------------------ menu (run from the Sheet)

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Tupai KLSSF')
    .addItem('1. Set up this sheet', 'setupSheet')
    .addItem('2. Set staff passcode', 'setPasscode')
    .addSeparator()
    .addItem('Testing: open registration now', 'openForTesting')
    .addItem('Go live: clear test claims and set real times', 'goLive')
    .addSeparator()
    .addItem('Send a test alert email', 'testAlert')
    .addItem('Unlock the staff view', 'unlockStaff')
    .addToUi();
}

function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());

  [TAB.KSSM, TAB.IGCSE].forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
    sh.getRange(2, 1, sh.getMaxRows() - 1, HEAD.length).setNumberFormat('@');
    sh.setFrozenRows(1);
  });

  var st = ss.getSheetByName(TAB.SETTINGS) || ss.insertSheet(TAB.SETTINGS);
  if (st.getLastRow() < 2) {
    var owner = '';
    try { owner = Session.getEffectiveUser().getEmail(); } catch (err) { /* leave blank */ }
    st.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'What it does']]).setFontWeight('bold');
    st.getRange(2, 2, 6, 1).setNumberFormat('@');
    st.getRange(2, 1, 6, 3).setValues([
      [S.KSSM_CAP, '100', 'Most KSSM claims accepted.'],
      [S.IGCSE_CAP, '100', 'Most IGCSE claims accepted.'],
      [S.OPENS, REAL_OPENS, 'Claims are refused before this. Malaysia time, written as yyyy-MM-dd HH:mm.'],
      [S.CLOSES, REAL_CLOSES, 'Claims are refused from this time on. 2026-10-05 00:00 is midnight at the end of Sunday 4 Oct.'],
      [S.RATE, '10', 'More claims than this in one minute are asked to try again, and an alert email is sent. 0 turns the limit off.'],
      [S.ALERT, owner, 'Who gets the alert email.']
    ]);
    st.setFrozenRows(1);
  }
  CacheService.getScriptCache().remove('status');
  SpreadsheetApp.getUi().alert('Sheet is set up.\n\nNext: Tupai KLSSF > 2. Set staff passcode.');
}

function setPasscode() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Staff passcode', 'Type the passcode staff will use on the page (at least 6 characters).', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var code = res.getResponseText();
  if (!code || code.length < 6) { ui.alert('Not saved. The passcode needs at least 6 characters.'); return; }
  var salt = Utilities.getUuid();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_SALT', salt);
  props.setProperty('ADMIN_HASH', hash_(salt, code));
  props.deleteProperty('FAILS');
  ui.alert('Passcode saved. Only a scrambled copy is stored, so it cannot be read back from here.');
}

function setSetting_(key, value) {
  var st = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB.SETTINGS);
  var keys = st.getRange(2, 1, Math.max(st.getLastRow() - 1, 1), 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() === key) {
      st.getRange(i + 2, 2).setNumberFormat('@').setValue(String(value));
      return;
    }
  }
}

function openForTesting() {
  var nowMyt = Utilities.formatDate(new Date(Date.now() - 60000), TZ, 'yyyy-MM-dd HH:mm');
  setSetting_(S.OPENS, nowMyt);
  CacheService.getScriptCache().remove('status');
  SpreadsheetApp.getUi().alert('Registration is open for testing from now.\n\nRun "Go live" before the event to clear the test claims and restore the real opening time.');
}

function goLive() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert('Go live',
    'This DELETES every claim in the KSSM and IGCSE tabs, sets both caps to 100, and sets registration to open ' +
    'Fri 2 Oct 08:00 and close at midnight at the end of Sun 4 Oct.\n\nNever run this during or after the event.\n\nContinue?',
    ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [TAB.KSSM, TAB.IGCSE].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, HEAD.length).clearContent();
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
  });
  setSetting_(S.KSSM_CAP, 100);
  setSetting_(S.IGCSE_CAP, 100);
  setSetting_(S.OPENS, REAL_OPENS);
  setSetting_(S.CLOSES, REAL_CLOSES);
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('FAILS');
  props.deleteProperty('LAST_ALERT');
  CacheService.getScriptCache().remove('status');
  ui.alert('Ready. Both lists are empty, caps are 100, and registration opens Fri 2 Oct 08:00.');
}

function testAlert() {
  var cfg = settings_();
  if (!cfg.alert) { SpreadsheetApp.getUi().alert('No alert email is set in the Settings tab.'); return; }
  MailApp.sendEmail(cfg.alert, 'Tupai KLSSF: test alert', 'This is a test. Alert emails from the booth registration page will arrive at this address.');
  SpreadsheetApp.getUi().alert('Test email sent to ' + cfg.alert + '.');
}

function unlockStaff() {
  PropertiesService.getScriptProperties().deleteProperty('FAILS');
  SpreadsheetApp.getUi().alert('The staff view is unlocked.');
}
