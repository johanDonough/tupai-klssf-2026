// Live backend: the three database functions in backend/schema.sql, called over
// Supabase's REST endpoint. No SDK needed.
window.KlssfSupabaseApi = (function () {
  'use strict';
  var CFG = window.KLSSF_CONFIG;

  function rpc(fn, body) {
    var base = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
    return fetch(base + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': CFG.supabaseAnonKey,
        'Authorization': 'Bearer ' + CFG.supabaseAnonKey
      },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      if (!res.ok) throw new Error(fn + ' failed: ' + res.status);
      return res.json();
    });
  }

  return {
    // -> { kssm_cap, igcse_cap, kssm_left, igcse_left, state: 'before' | 'open' | 'closed' }
    getStatus: function () { return rpc('get_status'); },

    // -> 'ok' | 'duplicate' | 'full' | 'not_open' | 'closed' | 'invalid'
    claim: function (d) {
      return rpc('claim_account', {
        p_name: d.name, p_email: d.email, p_phone: d.phone, p_syllabus: d.syllabus, p_consent: d.consent
      });
    },

    // -> { ok: true, kssm_cap, igcse_cap, kssm: [...], igcse: [...] }
    //  | { ok: false, reason: 'wrong', tries_left } | { ok: false, reason: 'locked', retry_seconds }
    adminList: function (passcode) { return rpc('admin_list', { p_passcode: passcode }); }
  };
})();
