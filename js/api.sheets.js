// Live backend: the Google Sheet, through the Apps Script web app in backend-sheets/Code.gs.
window.KlssfSheetsApi = (function () {
  'use strict';
  var CFG = window.KLSSF_CONFIG;

  function read(action) {
    return fetch(CFG.sheetsUrl + '?action=' + encodeURIComponent(action), { redirect: 'follow' })
      .then(parse);
  }
  // Sent as plain text so the browser makes one simple request. The body is still JSON.
  // The passcode travels in the body, never in the address.
  function send(body) {
    return fetch(CFG.sheetsUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }).then(parse);
  }
  function parse(res) {
    if (!res.ok) throw new Error('Sheet backend: HTTP ' + res.status);
    return res.json().then(function (data) {
      if (data && data.error) throw new Error('Sheet backend: ' + data.error);
      return data;
    });
  }

  return {
    // -> { kssm_cap, igcse_cap, kssm_left, igcse_left, state, qr_version }
    getStatus: function () { return read('status'); },

    // -> 'ok' | 'duplicate' | 'full' | 'not_open' | 'closed' | 'invalid' | 'busy'
    claim: function (d) {
      return send({ action: 'claim', name: d.name, email: d.email, phone: d.phone, syllabus: d.syllabus, consent: d.consent })
        .then(function (r) { return r.result; });
    },

    // -> { ok: true, kssm_cap, igcse_cap, kssm: [...], igcse: [...] } | { ok: false, reason, ... }
    adminList: function (passcode) { return send({ action: 'admin', passcode: passcode }); },

    // Booth QR image.
    getQr: function () { return read('qr'); },                                   // -> { version, data_url }
    setQr: function (passcode, dataUrl) { return send({ action: 'setQr', passcode: passcode, data_url: dataUrl }); },
    clearQr: function (passcode) { return send({ action: 'clearQr', passcode: passcode }); }
  };
})();
