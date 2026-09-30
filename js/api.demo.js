// Demo backend. Same three calls and same answers as the live database,
// but everything is kept in this browser's localStorage. Nothing leaves the device.
window.KlssfDemoApi = (function () {
  'use strict';
  var CFG = window.KLSSF_CONFIG.demo;
  var V = window.KlssfValidate;
  var KEY = 'tupai_klssf_demo_v1';
  var memory = null;   // used when localStorage is unavailable

  function fresh() {
    return { kssm: [], igcse: [], fails: [], state: 'open', kssmCap: CFG.kssmCap, igcseCap: CFG.igcseCap };
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
      state: s.state
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
      list.push({ name: d.name.trim(), email: d.email.trim(), phone: phoneNorm, created_at: new Date().toISOString() });
      save(s);
      return 'ok';
    })();
    return wait(700, result);
  }

  function adminList(passcode) {
    var s = load();
    var now = Date.now();
    var FIVE_MIN = 5 * 60 * 1000;
    s.fails = (s.fails || []).filter(function (t) { return now - t < FIVE_MIN; });
    var answer;
    if (s.fails.length >= 5) {
      var fifth = s.fails.slice().sort(function (a, b) { return b - a; })[4];
      answer = { ok: false, reason: 'locked', retry_seconds: Math.ceil((fifth + FIVE_MIN - now) / 1000) };
    } else if (passcode !== CFG.passcode) {
      s.fails.push(now);
      answer = s.fails.length >= 5
        ? { ok: false, reason: 'locked', retry_seconds: 300 }
        : { ok: false, reason: 'wrong', tries_left: 5 - s.fails.length };
    } else {
      s.fails = [];
      var newestFirst = function (a, b) { return a.created_at < b.created_at ? 1 : -1; };
      answer = {
        ok: true, kssm_cap: s.kssmCap, igcse_cap: s.igcseCap,
        kssm: s.kssm.slice().sort(newestFirst), igcse: s.igcse.slice().sort(newestFirst)
      };
    }
    save(s);
    return wait(400, answer);
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
    demo: { seed: seed, setState: setState, unlockStaff: unlockStaff, peek: peek, passcode: CFG.passcode }
  };
})();
