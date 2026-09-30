// Demo backend. Same calls and same answers as the live backends, but everything
// is kept in this browser's localStorage. Nothing leaves the device.
window.KlssfDemoApi = (function () {
  'use strict';
  var CFG = window.KLSSF_CONFIG.demo;
  var V = window.KlssfValidate;
  var KEY = 'tupai_klssf_demo_v1';
  var FIVE_MIN = 5 * 60 * 1000;
  var memory = null;   // used when localStorage is unavailable

  function fresh() {
    return { kssm: [], igcse: [], fails: [], state: 'open', kssmCap: CFG.kssmCap, igcseCap: CFG.igcseCap, qr: null };
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.kssm) && Array.isArray(s.igcse)) return s;
    } catch (e) { /* fall through */ }
    return memory || fresh();
  }
  function save(s) {
    memory = s;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* keep in memory */ }
  }
  function wait(ms, value) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(value); }, ms); });
  }
  function statusOf(s) {
    return {
      kssm_cap: s.kssmCap,
      igcse_cap: s.igcseCap,
      kssm_left: Math.max(s.kssmCap - s.kssm.length, 0),
      igcse_left: Math.max(s.igcseCap - s.igcse.length, 0),
      state: s.state,
      qr_version: s.qr ? s.qr.version : ''
    };
  }

  function getStatus() { return wait(150, statusOf(load())); }

  function claim(d) {
    var s = load();
    var result = (function () {
      if (s.state === 'before') return 'not_open';
      if (s.state === 'closed') return 'closed';
      if (!V.name(d.name) || !V.email(d.email)) return 'invalid';
      if (d.syllabus !== 'KSSM' && d.syllabus !== 'IGCSE') return 'invalid';
      if (d.consent !== true) return 'invalid';
      var phoneNorm = V.phoneFromWire(d.phone);
      if (!phoneNorm) return 'invalid';
      var emailNorm = d.email.trim().toLowerCase();
      var taken = s.kssm.concat(s.igcse).some(function (r) {
        return r.email.toLowerCase() === emailNorm || r.phone === phoneNorm;
      });
      if (taken) return 'duplicate';
      var list = d.syllabus === 'KSSM' ? s.kssm : s.igcse;
      var cap = d.syllabus === 'KSSM' ? s.kssmCap : s.igcseCap;
      if (list.length >= cap) return 'full';
      list.push({ name: V.cleanName(d.name), email: d.email.trim(), phone: phoneNorm, created_at: new Date().toISOString() });
      save(s);
      return 'ok';
    })();
    return wait(700, result);
  }

  // Returns null if the passcode is right, or the refusal to send back. Saves the failed-try count.
  function refuse(s, passcode) {
    var now = Date.now();
    s.fails = (s.fails || []).filter(function (t) { return now - t < FIVE_MIN; });
    if (s.fails.length >= 5) {
      var fifth = s.fails.slice().sort(function (a, b) { return b - a; })[4];
      return { ok: false, reason: 'locked', retry_seconds: Math.ceil((fifth + FIVE_MIN - now) / 1000) };
    }
    if (passcode !== CFG.passcode) {
      s.fails.push(now);
      save(s);
      return s.fails.length >= 5
        ? { ok: false, reason: 'locked', retry_seconds: 300 }
        : { ok: false, reason: 'wrong', tries_left: 5 - s.fails.length };
    }
    s.fails = [];
    return null;
  }

  function adminList(passcode) {
    var s = load();
    var no = refuse(s, passcode);
    if (no) return wait(400, no);
    save(s);
    var newestFirst = function (a, b) { return a.created_at < b.created_at ? 1 : -1; };
    return wait(400, {
      ok: true, kssm_cap: s.kssmCap, igcse_cap: s.igcseCap,
      kssm: s.kssm.slice().sort(newestFirst), igcse: s.igcse.slice().sort(newestFirst)
    });
  }

  function getQr() {
    var s = load();
    return wait(150, s.qr ? { version: s.qr.version, data_url: s.qr.data_url } : { version: '', data_url: null });
  }
  function setQr(passcode, dataUrl) {
    var s = load();
    var no = refuse(s, passcode);
    if (no) return wait(300, no);
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(String(dataUrl || ''))) return wait(300, { ok: false, reason: 'bad_image' });
    if (dataUrl.length > 240000) return wait(300, { ok: false, reason: 'too_large' });
    s.qr = { version: String(Date.now()), data_url: dataUrl };
    save(s);
    return wait(500, { ok: true, version: s.qr.version });
  }
  function clearQr(passcode) {
    var s = load();
    var no = refuse(s, passcode);
    if (no) return wait(300, no);
    s.qr = null;
    save(s);
    return wait(300, { ok: true, version: '' });
  }

  // ---- helpers for the demo panel only (not part of the live API)

  function sample(n, minutesAgo) {
    var p = String(n).padStart(2, '0');
    return {
      name: 'Sample Parent ' + p,
      email: 'sample' + p + '@example.com',
      phone: '+6012000' + String(n).padStart(4, '0'),
      created_at: new Date(Date.now() - minutesAgo * 60000).toISOString()
    };
  }
  function seed(kssmCount, igcseCount) {
    var s = load();
    s.kssm = []; s.igcse = []; s.fails = [];
    var n = 0, i;
    for (i = 0; i < kssmCount; i++) { n++; s.kssm.push(sample(n, (kssmCount - i) * 17 + 5)); }
    for (i = 0; i < igcseCount; i++) { n++; s.igcse.push(sample(n, (igcseCount - i) * 13 + 3)); }
    save(s);
  }
  function setState(state) { var s = load(); s.state = state; save(s); }
  function unlockStaff() { var s = load(); s.fails = []; save(s); }
  function peek() { return statusOf(load()); }

  return {
    getStatus: getStatus, claim: claim, adminList: adminList,
    getQr: getQr, setQr: setQr, clearQr: clearQr,
    demo: { seed: seed, setState: setState, unlockStaff: unlockStaff, peek: peek, passcode: CFG.passcode }
  };
})();
