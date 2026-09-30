// Tupai KLSSF 2026 booth registration: screens and behaviour.
// Routes (hash based, so any static host works):
//   #/                     landing page (booth display, or phone)
//   #/register             claim form on the visitor's own phone (what the QR code opens)
//   #/register?booth=1     claim form on the booth device (returns to landing after success)
// Success, blocked and staff screens are shown in place and cannot be reached by address.
(function () {
  'use strict';

  var CFG = window.KLSSF_CONFIG;
  var T = window.COPY;
  var V = window.KlssfValidate;
  var COUNTRIES = window.KLSSF_COUNTRIES;
  var MODE = CFG.mode === 'sheets' || CFG.mode === 'supabase' ? CFG.mode : 'demo';
  var DEMO = MODE === 'demo';
  var api = MODE === 'sheets' ? window.KlssfSheetsApi
          : MODE === 'supabase' ? window.KlssfSupabaseApi
          : window.KlssfDemoApi;
  var LOGO = CFG.logo || 'assets/parent-app-logo.svg';

  var $app = document.getElementById('app');
  var $overlay = document.getElementById('overlay');
  var $demo = document.getElementById('demo');

  // ------------------------------------------------------------ helpers

  // Tabler Icons (outline), MIT licence.
  var ICONS = {
    x: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
    check: '<path d="M5 12l5 5l10 -10"/>',
    'circle-check': '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M9 12l2 2l4 -4"/>',
    loader: '<path d="M12 3a9 9 0 1 0 9 9"/>',
    heart: '<path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572"/>',
    clock: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 7v5l3 3"/>',
    'calendar-off': '<path d="M9 5h9a2 2 0 0 1 2 2v9m-.184 3.839a2 2 0 0 1 -1.816 1.161h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 1.158 -1.815"/><path d="M16 3v4"/><path d="M8 3v1"/><path d="M4 11h7m4 0h5"/><path d="M3 3l18 18"/>',
    'user-check': '<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4"/><path d="M15 19l2 2l4 -4"/>',
    logout: '<path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2"/><path d="M9 12h12l-3 -3"/><path d="M18 15l3 -3"/>',
    download: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/>',
    search: '<path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6 -6"/>',
    list: '<path d="M9 6l11 0"/><path d="M9 12l11 0"/><path d="M9 18l11 0"/><path d="M5 6l0 .01"/><path d="M5 12l0 .01"/><path d="M5 18l0 .01"/>',
    refresh: '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
    'chevron-down': '<path d="M6 9l6 6l6 -6"/>'
  };
  function icon(name, cls) {
    return '<svg class="icon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fill(str, map) {
    return str.replace(/\{(\w+)\}/g, function (m, k) { return map[k] == null ? m : map[k]; });
  }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ------------------------------------------------------------ state

  var view = null;            // landing | form | success | blocked | admin
  var status = null;          // last answer from getStatus()
  var form = emptyForm();
  var formBooth = false;
  var busy = false;
  var blockedKind = null;
  var staff = null;           // { passcode, data, tab, query }. Memory only.
  var paintedMode = null;
  var qr = { version: '', dataUrl: null };   // the uploaded booth QR image, if there is one
  var qrLoading = false;
  var qrCheck = null;                        // result of reading the last uploaded image
  var pollTimer = null, countTimer = null, toastTimer = null;
  var modalCleanup = null;

  function emptyForm() { return { name: '', email: '', cc: 0, phone: '', syl: null, consent: false }; }

  function setView(v) {
    view = v;
    document.body.setAttribute('data-view', v);
    window.scrollTo(0, 0);
  }
  function mode() {
    if (!status) return 'loading';
    if (status.state === 'before') return 'before';
    if (status.state === 'closed') return 'closed';
    if (status.kssm_left === 0 && status.igcse_left === 0) return 'all';
    return 'open';
  }
  function leftOf(syl) { return status ? (syl === 'KSSM' ? status.kssm_left : status.igcse_left) : null; }
  function capOf(syl) { return status ? (syl === 'KSSM' ? status.kssm_cap : status.igcse_cap) : 100; }

  // ------------------------------------------------------------ status polling

  function refreshStatus() {
    return api.getStatus().then(function (s) {
      if (s && typeof s.kssm_left === 'number') status = s;
      syncQr();
      onStatus();
      return status;
    }, function () {
      return status;   // keep the last numbers; the next cycle tries again
    });
  }
  // Staff can upload a QR image. Fetch it only when its version changes.
  function isImageUrl(u) { return typeof u === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(u); }
  function syncQr() {
    if (!api.getQr || !status || typeof status.qr_version !== 'string') return;
    if (status.qr_version === qr.version || qrLoading) return;
    if (status.qr_version === '') {
      qr = { version: '', dataUrl: null };
      if (view === 'landing') paintLanding();
      return;
    }
    qrLoading = true;
    api.getQr().then(function (r) {
      qrLoading = false;
      if (!r || !isImageUrl(r.data_url)) return;
      qr = { version: String(r.version || ''), dataUrl: r.data_url };
      if (view === 'landing') paintLanding();
    }, function () { qrLoading = false; });
  }

  function onStatus() {
    if (view === 'landing') paintLanding();
    else if (view === 'form') paintFormStatus();
    else if (view === 'blocked' && blockedKind !== 'already') {
      var m = mode();
      if (m === 'open') route();
      else if (m !== 'loading' && m !== blockedKind) showBlocked(m);
    }
  }
  function startPolling() {
    stopPolling();
    refreshStatus();
    pollTimer = setInterval(refreshStatus, Math.max(5, CFG.pollSeconds) * 1000);
  }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && pollTimer) refreshStatus();
  });

  // ------------------------------------------------------------ landing

  function counterHtml(syl) {
    return '<div class="counter" data-syl="' + syl + '">' +
      '<div class="counter__name">' + syl + '</div>' +
      '<div class="counter__num is-loading" data-num>–</div>' +
      '<div class="counter__label"><div class="counter__label-en">' + esc(T.landing.left.en) + '</div>' +
      '<div class="counter__label-bm">' + esc(T.landing.left.bm) + '</div></div>' +
      '<div class="bar"><div class="bar__fill" data-bar></div></div>' +
      '</div>';
  }
  function paintCounters(root) {
    ['KSSM', 'IGCSE'].forEach(function (syl) {
      var el = q('.counter[data-syl="' + syl + '"]', root);
      if (!el || !status) return;
      var left = leftOf(syl), cap = capOf(syl);
      var num = q('[data-num]', el);
      num.textContent = left;
      num.classList.remove('is-loading');
      num.classList.toggle('is-zero', left === 0);
      q('[data-bar]', el).style.width = (cap > 0 ? Math.min(100, Math.max(0, (cap - left) / cap * 100)) : 100) + '%';
    });
  }
  function noticeHtml(kind) {
    var ic = { before: 'clock', closed: 'calendar-off', all: 'heart' }[kind];
    return '<div class="notice">' + icon(ic) +
      '<div class="notice__en">' + esc(T.blocked[kind].en) + '</div>' +
      '<div class="notice__bm">' + esc(T.blocked[kind].bm) + '</div></div>';
  }
  function registerUrl() { return location.href.split('#')[0] + '#/register'; }
  function qrSvg(text) {
    var code = window.qrcode(0, 'M');
    code.addData(text);
    code.make();
    return code.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
  }

  // The uploaded image if staff have set one, otherwise a QR drawn by the page.
  function qrHtml() {
    return qr.dataUrl ? '<img src="' + qr.dataUrl + '" alt="">' : qrSvg(registerUrl());
  }

  function showLanding() {
    setView('landing');
    paintedMode = null;
    $app.innerHTML =
      '<main class="landing">' +
        '<div class="landing__top"><img class="logo" data-logo src="' + LOGO + '" alt="Tupai" draggable="false"></div>' +
        '<div class="landing__mid">' +
          '<div class="landing__left">' +
            '<div class="hero">' +
              '<div class="hero__titles"><h1 class="hero__en">' + esc(T.landing.headline.en) + '</h1>' +
              '<div class="hero__bm">' + esc(T.landing.headline.bm) + '</div></div>' +
              '<div class="hero__sub"><div class="hero__sub-en">' + esc(T.landing.subline.en) + '</div>' +
              '<div class="hero__sub-bm">' + esc(T.landing.subline.bm) + '</div></div>' +
            '</div>' +
            '<div class="counters">' + counterHtml('KSSM') + counterHtml('IGCSE') + '</div>' +
          '</div>' +
          '<div class="landing__right" data-action></div>' +
        '</div>' +
        '<div class="landing__foot">' + esc(T.landing.footer) + '</div>' +
      '</main>';
    bindLogo(q('[data-logo]', $app));
    paintLanding();
    startPolling();
  }
  function paintLanding() {
    paintCounters($app);
    var m = mode();
    var key = m + '|' + qr.version;
    if (key === paintedMode) return;
    paintedMode = key;
    var slot = q('[data-action]', $app);
    if (m === 'loading') { slot.innerHTML = ''; return; }
    if (m !== 'open') { slot.innerHTML = noticeHtml(m); return; }
    slot.innerHTML =
      '<div class="qr" role="img" aria-label="QR code to the registration form">' + qrHtml() + '</div>' +
      '<div class="scan"><div class="scan__en">' + esc(T.landing.scan.en) + '</div>' +
      '<div class="scan__bm">' + esc(T.landing.scan.bm) + '</div></div>' +
      '<a class="btn btn--primary btn--full btn--display" href="#/register?booth=1">' +
        '<span class="btn__en">' + esc(T.landing.register.en) + '</span>' +
        '<span class="btn__bm">' + esc(T.landing.register.bm) + '</span></a>';
  }

  // The hidden staff entry: double-click (or double-tap) the logo. No visible hint.
  function bindLogo(el) {
    var lastTap = 0;
    el.addEventListener('dblclick', function (e) { e.preventDefault(); openPass(); });
    el.addEventListener('touchend', function () {
      var now = Date.now();
      if (now - lastTap < 400) { lastTap = 0; openPass(); } else { lastTap = now; }
    }, { passive: true });
  }

  // ------------------------------------------------------------ form

  function labelHtml(pair) {
    return '<span class="field__label"><span class="field__en">' + esc(pair.en) + '</span>' +
      '<span class="field__bm">' + esc(pair.bm) + '</span></span>';
  }
  function submitInner(isBusy) {
    if (isBusy) {
      return icon('loader', 'spin') + '<span class="btn__stack"><span class="btn__en">' + esc(T.form.submitting.en) +
        '</span><span class="btn__bm">' + esc(T.form.submitting.bm) + '</span></span>';
    }
    return '<span class="btn__en">' + esc(T.form.submit.en) + '</span><span class="btn__bm">' + esc(T.form.submit.bm) + '</span>';
  }

  function showForm(booth) {
    formBooth = booth;
    var m = mode();
    if (m !== 'loading' && m !== 'open') { showBlocked(m); return; }
    setView('form');
    busy = false;
    var options = COUNTRIES.map(function (c, i) {
      return '<option value="' + i + '"' + (i === form.cc ? ' selected' : '') + '>' + esc(c[0]) + ' (+' + c[1] + ')</option>';
    }).join('');
    var sylBtn = function (syl) {
      return '<button type="button" class="syl" data-syl="' + syl + '" aria-pressed="' + (form.syl === syl) + '">' +
        '<span class="syl__top"><span class="syl__name">' + syl + '</span><span class="syl__dot"></span></span>' +
        '<span data-badge></span></button>';
    };
    $app.innerHTML =
      '<main class="page">' +
        '<div class="page__head">' +
          '<button type="button" class="iconbtn" data-close aria-label="Close">' + icon('x') + '</button>' +
          '<div class="page__titles"><h1 class="page__title-en">' + esc(T.form.title.en) + '</h1>' +
          '<div class="page__title-bm">' + esc(T.form.title.bm) + '</div></div>' +
        '</div>' +
        '<form class="fields" novalidate autocomplete="on">' +
          '<label class="field" data-field="name">' + labelHtml(T.form.name) +
            '<input class="input" name="name" autocomplete="name" maxlength="100" value="' + esc(form.name) + '">' +
            '<span class="err" data-err hidden></span></label>' +
          '<label class="field" data-field="email">' + labelHtml(T.form.email) +
            '<input class="input" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="254" value="' + esc(form.email) + '">' +
            '<span class="err" data-err hidden></span></label>' +
          '<div class="field" data-field="phone">' +
            '<label for="f-phone">' + labelHtml(T.form.phone) + '</label>' +
            '<span class="phone">' +
              '<span class="phone__cc"><span data-cc-label>+' + COUNTRIES[form.cc][1] + '</span>' + icon('chevron-down') +
                '<select name="cc" aria-label="' + esc(T.form.country) + '">' + options + '</select></span>' +
              '<input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="24" value="' + esc(form.phone) + '">' +
            '</span>' +
            '<span class="err" data-err hidden></span></div>' +
          '<div class="field" data-field="syl">' + labelHtml(T.form.syllabus) +
            '<div class="syls">' + sylBtn('KSSM') + sylBtn('IGCSE') + '</div>' +
            '<span class="err" data-err hidden></span></div>' +
          '<div class="consent" data-field="consent">' +
            '<div class="consent__row">' +
              '<button type="button" class="check" role="checkbox" aria-checked="' + form.consent + '" aria-labelledby="f-consent">' +
                '<span class="check__box">' + icon('check') + '</span></button>' +
              '<div class="consent__text" id="f-consent" data-consent-text>' +
                '<span class="consent__en">' + esc(T.form.consent.en) + '</span>' +
                '<span class="consent__bm">' + esc(T.form.consent.bm) + '</span></div>' +
            '</div>' +
            '<span class="err" data-err hidden></span>' +
            '<button type="button" class="link" data-privacy>' + esc(T.form.privacy.en) + ' · ' + esc(T.form.privacy.bm) + '</button>' +
          '</div>' +
          '<div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>' +
          '<div class="field" data-field="form"><span class="err" data-err hidden></span></div>' +
          '<button type="submit" class="btn btn--primary btn--full btn--tall" data-submit>' + submitInner(false) + '</button>' +
        '</form>' +
      '</main>';

    var root = q('.page', $app);
    var f = q('form', root);
    // Looked up by selector: a form's own .name property would shadow an input called "name".
    var inName = q('[name="name"]', f), inEmail = q('[name="email"]', f), inPhone = q('[name="phone"]', f), inCc = q('[name="cc"]', f);
    paintPhonePlaceholder();
    q('[data-close]', root).addEventListener('click', goHome);
    inName.addEventListener('input', function () { form.name = inName.value; clearError('name'); });
    inEmail.addEventListener('input', function () { form.email = inEmail.value; clearError('email'); });
    inPhone.addEventListener('input', function () {
      var clean = inPhone.value.replace(/[^\d\s()+-]/g, '');
      if (clean !== inPhone.value) inPhone.value = clean;
      form.phone = clean;
      clearError('phone');
    });
    inCc.addEventListener('change', function () {
      form.cc = Number(inCc.value);
      q('[data-cc-label]', root).textContent = '+' + COUNTRIES[form.cc][1];
      paintPhonePlaceholder();
      clearError('phone');
    });
    qa('.syl', root).forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        form.syl = b.getAttribute('data-syl');
        paintFormStatus();
        clearError('syl');
      });
    });
    var toggleConsent = function () {
      form.consent = !form.consent;
      q('.check', root).setAttribute('aria-checked', String(form.consent));
      clearError('consent');
    };
    q('.check', root).addEventListener('click', toggleConsent);
    q('[data-consent-text]', root).addEventListener('click', toggleConsent);
    q('[data-privacy]', root).addEventListener('click', openPrivacy);
    f.addEventListener('submit', function (e) { e.preventDefault(); submit(); });

    paintFormStatus();
    startPolling();
  }

  function paintPhonePlaceholder() {
    var input = q('#f-phone', $app);
    if (input) input.placeholder = COUNTRIES[form.cc][1] === '60' ? '12-345 6789' : '';
  }

  function paintFormStatus() {
    if (view !== 'form') return;
    var m = mode();
    if (m !== 'loading' && m !== 'open' && !busy) { showBlocked(m); return; }
    qa('.syl', $app).forEach(function (b) {
      var syl = b.getAttribute('data-syl');
      var left = leftOf(syl);
      var sold = left === 0;
      if (sold && form.syl === syl) form.syl = null;
      b.disabled = sold;
      b.setAttribute('aria-pressed', String(form.syl === syl));
      q('[data-badge]', b).innerHTML = left == null ? '' : sold
        ? '<span class="badge badge--neutral">' + esc(T.form.soldOut.en) + ' · ' + esc(T.form.soldOut.bm) + '</span>'
        : '<span class="badge badge--orange">' + left + ' ' + esc(T.form.left.en) + ' · ' + left + ' ' + esc(T.form.left.bm) + '</span>';
    });
  }

  function setError(key, pair) {
    var el = q('[data-field="' + key + '"]', $app);
    if (!el) return;
    var slot = q('[data-err]', el);
    el.classList.toggle('has-error', !!pair);
    slot.hidden = !pair;
    slot.innerHTML = pair
      ? '<span class="err__en">' + esc(pair.en) + '</span><span class="err__bm">' + esc(pair.bm) + '</span>'
      : '';
  }
  function clearError(key) { setError(key, null); setError('form', null); }

  function validateForm() {
    var e = {};
    var code = COUNTRIES[form.cc][1];
    if (!V.name(form.name)) e.name = T.errors.name;
    if (!V.email(form.email)) e.email = T.errors.email;
    if (!V.phone(code, form.phone)) e.phone = code === '60' ? T.errors.phoneMy : T.errors.phone;
    if (!form.syl || leftOf(form.syl) === 0) e.syl = T.errors.syllabus;
    if (!form.consent) e.consent = T.errors.consent;
    return e;
  }

  function setBusy(on) {
    busy = on;
    var btn = q('[data-submit]', $app);
    if (!btn) return;
    btn.disabled = false;
    btn.classList.toggle('btn--tall', !on);
    btn.classList.toggle('btn--busy', on);
    btn.setAttribute('aria-busy', String(on));
    btn.innerHTML = submitInner(on);
  }

  function submit() {
    if (busy) return;
    var errors = validateForm();
    ['name', 'email', 'phone', 'syl', 'consent'].forEach(function (k) { setError(k, errors[k] || null); });
    setError('form', null);
    var first = ['name', 'email', 'phone', 'syl', 'consent'].filter(function (k) { return errors[k]; })[0];
    if (first) {
      var target = q('[data-field="' + first + '"]', $app);
      var focusable = q('input, button', target);
      if (focusable) focusable.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setBusy(true);
    // Honeypot: a real visitor never fills this in. Pretend it worked, send nothing.
    if (q('input[name="website"]', $app).value) {
      setTimeout(function () { onClaim('ok'); }, 800);
      return;
    }
    var payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: '+' + COUNTRIES[form.cc][1] + ' ' + form.phone.trim(),
      syllabus: form.syl,
      consent: true
    };
    api.claim(payload).then(onClaim, function () { onClaim('error'); });
  }

  function onClaim(result) {
    if (view !== 'form') return;
    if (result === 'ok') {
      var booth = formBooth;
      form = emptyForm();
      busy = false;
      showSuccess(booth);
      return;
    }
    setBusy(false);
    if (result === 'duplicate') { showBlocked('already'); return; }
    if (result === 'not_open') { if (status) status.state = 'before'; showBlocked('before'); return; }
    if (result === 'closed') { if (status) status.state = 'closed'; showBlocked('closed'); return; }
    if (result === 'full') {
      var syl = form.syl;
      refreshStatus().then(function () {
        if (view !== 'form') return;
        // If the counts have not caught up yet, close that option ourselves.
        if (status && leftOf(syl) !== 0) { status[syl === 'KSSM' ? 'kssm_left' : 'igcse_left'] = 0; }
        paintFormStatus();
        if (view !== 'form') return;
        setError('syl', { en: fill(T.errors.full.en, { syl: syl }), bm: fill(T.errors.full.bm, { syl: syl }) });
      });
      return;
    }
    setError('form', result === 'busy' ? T.errors.busy : T.errors.generic);
  }

  function goHome() {
    form = emptyForm();
    if (location.hash === '' || location.hash === '#' || location.hash === '#/') route();
    else location.hash = '#/';
  }

  // ------------------------------------------------------------ success

  function showSuccess(booth) {
    setView('success');
    stopPolling();
    var n = Math.max(3, CFG.boothReturnSeconds);
    $app.innerHTML =
      '<main class="center"><div class="success">' + icon('circle-check') +
        '<div class="success__titles"><h1 class="success__en">' + esc(T.success.title.en) + '</h1>' +
        '<div class="success__bm">' + esc(T.success.title.bm) + '</div></div>' +
        '<div class="success__body"><div class="success__body-en">' + esc(T.success.body.en) + '</div>' +
        '<div class="success__body-bm">' + esc(T.success.body.bm) + '</div></div>' +
        (booth
          ? '<div class="success__next"><button type="button" class="btn btn--primary btn--full btn--tall" data-next>' +
            '<span class="btn__en">' + esc(T.success.next.en) + '</span><span class="btn__bm">' + esc(T.success.next.bm) + '</span></button>' +
            '<div class="success__count" data-count>' + esc(fill(T.success.returning, { n: n })) + '</div></div>'
          : '') +
      '</div></main>';
    if (!booth) return;
    q('[data-next]', $app).addEventListener('click', goHome);
    countTimer = setInterval(function () {
      n -= 1;
      if (n <= 0) { goHome(); return; }
      var el = q('[data-count]', $app);
      if (el) el.textContent = fill(T.success.returning, { n: n });
    }, 1000);
  }

  // ------------------------------------------------------------ blocked

  function showBlocked(kind) {
    setView('blocked');
    blockedKind = kind;
    var ic = { already: 'user-check', before: 'clock', closed: 'calendar-off', all: 'heart' }[kind];
    $app.innerHTML =
      '<main class="blocked">' +
        (kind === 'already'
          ? '<button type="button" class="iconbtn" data-back aria-label="Close">' + icon('x') + '</button>'
          : '<div class="blocked__logo"><img class="logo" src="' + LOGO + '" alt="Tupai" draggable="false"></div>') +
        '<div class="blocked__body">' + icon(ic) +
          '<div class="blocked__text"><h1 class="blocked__en">' + esc(T.blocked[kind].en) + '</h1>' +
          '<div class="blocked__bm">' + esc(T.blocked[kind].bm) + '</div></div>' +
          (kind === 'all' ? '<div class="counters">' + counterHtml('KSSM') + counterHtml('IGCSE') + '</div>' : '') +
        '</div>' +
      '</main>';
    if (kind === 'all') {
      paintCounters($app);
      qa('.bar__fill', $app).forEach(function (b) { b.style.width = '100%'; });
    }
    if (kind === 'already') {
      stopPolling();
      q('[data-back]', $app).addEventListener('click', function () { showForm(formBooth); });
    } else if (!pollTimer) {
      startPolling();   // so the page opens by itself when registration does
    }
  }

  // ------------------------------------------------------------ modals

  function openModal(html, focusSel) {
    closeModal();
    var opener = document.activeElement;
    $overlay.innerHTML = '<div class="scrim">' + html + '</div>';
    var scrim = q('.scrim', $overlay);
    var onKey = function (e) { if (e.key === 'Escape') closeModal(); };
    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) closeModal(); });
    qa('[data-dismiss]', scrim).forEach(function (b) { b.addEventListener('click', closeModal); });
    document.addEventListener('keydown', onKey);
    modalCleanup = function () {
      document.removeEventListener('keydown', onKey);
      if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
    };
    var target = focusSel ? q(focusSel, scrim) : q('[data-dismiss]', scrim);
    if (target) target.focus({ preventScroll: true });
    return scrim;
  }
  function closeModal() {
    if (!$overlay.firstChild) return;
    $overlay.innerHTML = '';
    if (modalCleanup) { var fn = modalCleanup; modalCleanup = null; fn(); }
  }
  function modalOpen() { return !!$overlay.firstChild; }

  function openPrivacy() {
    openModal(
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
        '<button type="button" class="iconbtn modal__close" data-dismiss aria-label="' + esc(T.privacy.close) + '">' + icon('x') + '</button>' +
        '<div><h2 class="modal__title" id="m-title">' + esc(T.privacy.title.en) + '</h2>' +
        '<div class="modal__title-bm">' + esc(T.privacy.title.bm) + '</div></div>' +
        '<p class="modal__text">' + esc(T.privacy.en) + '</p>' +
        '<p class="modal__text modal__text--bm">' + esc(T.privacy.bm) + '</p>' +
      '</div>');
  }

  function openPass() {
    if (modalOpen()) return;
    var scrim = openModal(
      '<div class="modal modal--pass" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
        '<button type="button" class="iconbtn modal__close" data-dismiss aria-label="Close">' + icon('x') + '</button>' +
        '<h2 class="modal__title" id="m-title">' + esc(T.admin.access) + '</h2>' +
        '<form class="field" data-pass novalidate>' +
          '<label class="field__en" for="m-code">' + esc(T.admin.passcode) + '</label>' +
          '<input class="input input--code" id="m-code" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64">' +
          '<span class="passmsg" data-msg hidden></span>' +
          '<button type="submit" class="btn btn--primary btn--full" data-enter style="margin-top:12px">' + esc(T.admin.enter) + '</button>' +
        '</form>' +
      '</div>', '#m-code');
    var f = q('[data-pass]', scrim), input = q('#m-code', scrim), msg = q('[data-msg]', scrim), btn = q('[data-enter]', scrim);
    var checking = false;
    var say = function (text) {
      msg.hidden = !text;
      msg.textContent = text || '';
      f.classList.toggle('has-error', !!text);
    };
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var code = input.value;
      if (checking || !code) return;
      checking = true;
      btn.disabled = true;
      btn.textContent = T.admin.checking;
      api.adminList(code).then(function (r) {
        if (!modalOpen()) return;
        checking = false;
        btn.textContent = T.admin.enter;
        if (r && r.ok) {
          staff = { passcode: code, data: r, tab: 'KSSM', query: '' };
          closeModal();
          showAdmin();
          return;
        }
        input.value = '';
        if (r && r.reason === 'locked') {
          var mins = Math.max(1, Math.ceil((r.retry_seconds || 300) / 60));
          input.disabled = true;
          say(fill(T.admin.locked, { m: mins, minutes: mins === 1 ? 'minute' : 'minutes' }));
          return;
        }
        btn.disabled = false;
        var n = r && typeof r.tries_left === 'number' ? r.tries_left : 0;
        say(fill(T.admin.wrong, { n: n, tries: n === 1 ? 'try' : 'tries' }));
        input.focus();
      }, function () {
        if (!modalOpen()) return;
        checking = false;
        btn.disabled = false;
        btn.textContent = T.admin.enter;
        say(T.admin.failed);
      });
    });
  }

  // ------------------------------------------------------------ staff list

  var fmtShown = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
  var fmtCsv = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  function shownTime(iso) {
    var p = {};
    fmtShown.formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return p.day + ' ' + p.month + ' ' + p.year + ', ' + p.hour + ':' + p.minute + ' ' + String(p.dayPeriod || '').toLowerCase().replace(/\./g, '');
  }
  function csvTime(iso) { return fmtCsv.format(new Date(iso)).replace(',', ''); }
  function shownPhone(p) {
    var m = /^\+60(1\d)(\d{3,4})(\d{4})$/.exec(p || '');
    return m ? '+60 ' + m[1] + '-' + m[2] + ' ' + m[3] : (p || '');
  }

  function showAdmin() {
    setView('admin');
    stopPolling();
    $app.innerHTML =
      '<div class="admin">' +
        '<header class="admin__head">' +
          '<button type="button" class="admin__home" data-logout aria-label="Back to landing page"><img class="logo" src="' + LOGO + '" alt="Tupai"></button>' +
          '<button type="button" class="btn btn--secondary" data-logout>' + icon('logout') + esc(T.admin.logout) + '</button>' +
        '</header>' +
        '<div class="admin__body">' +
          '<div class="kpis" data-kpis></div>' +
          (api.setQr ? '<section class="qrcard" data-qrcard></section>' : '') +
          '<div class="lists">' +
            '<div class="lists__bar">' +
              '<div class="tabs" role="tablist" data-tabs></div>' +
              '<div class="exports">' +
                '<button type="button" class="btn btn--secondary" data-export="KSSM">' + icon('download') + esc(T.admin.exportK) + '</button>' +
                '<button type="button" class="btn btn--secondary" data-export="IGCSE">' + icon('download') + esc(T.admin.exportI) + '</button>' +
                '<button type="button" class="btn btn--secondary" data-export="ALL">' + icon('download') + esc(T.admin.exportAll) + '</button>' +
              '</div>' +
            '</div>' +
            '<div class="tools">' +
              '<label class="search">' + icon('search') + '<input type="search" data-query placeholder="' + esc(T.admin.search) + '" aria-label="' + esc(T.admin.search) + '"></label>' +
              '<button type="button" class="btn btn--secondary" data-refresh>' + icon('refresh') + esc(T.admin.refresh) + '</button>' +
            '</div>' +
            '<div data-list></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    qa('[data-logout]', $app).forEach(function (b) { b.addEventListener('click', logout); });
    qa('[data-export]', $app).forEach(function (b) {
      b.addEventListener('click', function () { exportCsv(b.getAttribute('data-export')); });
    });
    q('[data-query]', $app).addEventListener('input', function (e) { staff.query = e.target.value; paintList(); });
    q('[data-refresh]', $app).addEventListener('click', refreshAdmin);
    paintAdmin();
    paintQrCard();
  }

  // ---- booth QR: staff upload the image that visitors scan

  function paintQrCard(note) {
    var card = q('[data-qrcard]', $app);
    if (!card) return;
    var link = registerUrl();
    var checkLine = '';
    if (qr.dataUrl && qrCheck) {
      checkLine = qrCheck.state === 'match' ? '<div class="qrcard__ok">' + esc(T.admin.qrMatch) + '</div>'
        : qrCheck.state === 'mismatch' ? '<div class="qrcard__warn">' + esc(fill(T.admin.qrMismatch, { url: qrCheck.url })) + '</div>'
        : '<div class="qrcard__hint">' + esc(T.admin.qrUnread) + '</div>';
    } else if (qr.dataUrl) {
      checkLine = '<div class="qrcard__hint">' + esc(T.admin.qrUnread) + '</div>';
    }
    card.innerHTML =
      '<div class="qrcard__preview">' + qrHtml() + '</div>' +
      '<div class="qrcard__body">' +
        '<div class="kpi__label">' + esc(T.admin.qrTitle.toUpperCase()) + '</div>' +
        '<div class="qrcard__state">' + esc(qr.dataUrl ? T.admin.qrCustom : T.admin.qrAuto) + '</div>' +
        checkLine +
        (note ? '<div class="qrcard__warn">' + esc(note) + '</div>' : '') +
        '<div class="qrcard__link"><span class="qrcard__hint">' + esc(T.admin.qrLinkLabel) + '</span>' +
          '<code>' + esc(link) + '</code></div>' +
        '<div class="qrcard__actions">' +
          '<button type="button" class="btn btn--secondary" data-qr-upload>' + esc(qr.dataUrl ? T.admin.qrReplace : T.admin.qrUpload) + '</button>' +
          (qr.dataUrl ? '<button type="button" class="btn btn--secondary" data-qr-remove>' + esc(T.admin.qrRemove) + '</button>' : '') +
          '<button type="button" class="btn btn--secondary" data-qr-copy>' + esc(T.admin.qrCopy) + '</button>' +
          '<input type="file" accept="image/*" data-qr-file hidden>' +
        '</div>' +
      '</div>';
    var file = q('[data-qr-file]', card);
    q('[data-qr-upload]', card).addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () { if (file.files && file.files[0]) uploadQr(file.files[0]); });
    var remove = q('[data-qr-remove]', card);
    if (remove) remove.addEventListener('click', removeQr);
    q('[data-qr-copy]', card).addEventListener('click', function () {
      var done = function () { toast(T.admin.qrCopied, 'check'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () {});
    });
  }
  function qrBusy(on) {
    qa('[data-qrcard] button', $app).forEach(function (b) { b.disabled = on; });
    var up = q('[data-qr-upload]', $app);
    if (up && on) up.textContent = T.admin.qrSaving;
  }

  // Redraw the chosen file as a PNG no larger than 720px, so it is small and cannot carry anything but pixels.
  function readImage(fileObj) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('bad')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('bad')); };
        img.onload = function () {
          var w = img.naturalWidth || img.width || 720, h = img.naturalHeight || img.height || 720;
          if (!w || !h) { reject(new Error('bad')); return; }
          var scale = Math.min(1, 720 / Math.max(w, h));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          var c = canvas.getContext('2d');
          c.fillStyle = '#fff';
          c.fillRect(0, 0, canvas.width, canvas.height);
          c.drawImage(img, 0, 0, canvas.width, canvas.height);
          var url = canvas.toDataURL('image/png');
          if (url.length > 230000) url = canvas.toDataURL('image/jpeg', 0.9);
          if (url.length > 230000) { reject(new Error('big')); return; }
          resolve({ url: url, canvas: canvas });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(fileObj);
    });
  }
  // Where the browser can read QR codes itself, check the image opens the form.
  function readQrLink(canvas) {
    if (!('BarcodeDetector' in window)) return Promise.resolve(null);
    try {
      return new window.BarcodeDetector({ formats: ['qr_code'] }).detect(canvas).then(function (found) {
        return found && found[0] ? String(found[0].rawValue || '') : null;
      }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function uploadQr(fileObj) {
    qrBusy(true);
    readImage(fileObj).then(function (img) {
      return readQrLink(img.canvas).then(function (found) {
        return api.setQr(staff.passcode, img.url).then(function (r) {
          if (view !== 'admin' || !staff) return;
          if (!r || !r.ok) { paintQrCard(r && r.reason === 'too_large' ? T.admin.qrTooBig : T.admin.qrFailed); return; }
          qr = { version: String(r.version || ''), dataUrl: img.url };
          qrCheck = found == null ? { state: 'unread' }
            : found.replace(/\/+$/, '') === registerUrl().replace(/\/+$/, '') ? { state: 'match' }
            : { state: 'mismatch', url: found.slice(0, 200) };
          if (status) status.qr_version = qr.version;
          paintQrCard();
          toast(T.admin.qrSaved, 'check');
        });
      });
    }).catch(function (err) {
      if (view !== 'admin') return;
      var msg = err && err.message === 'big' ? T.admin.qrTooBig : err && err.message === 'bad' ? T.admin.qrBad : T.admin.qrFailed;
      paintQrCard(msg);
    });
  }
  function removeQr() {
    qrBusy(true);
    api.clearQr(staff.passcode).then(function (r) {
      if (view !== 'admin' || !staff) return;
      if (!r || !r.ok) { paintQrCard(T.admin.qrFailed); return; }
      qr = { version: '', dataUrl: null };
      qrCheck = null;
      if (status) status.qr_version = '';
      paintQrCard();
      toast(T.admin.qrRemoved, 'check');
    }, function () { if (view === 'admin') paintQrCard(T.admin.qrFailed); });
  }
  function rowsOf(tab) { return staff.data[tab === 'KSSM' ? 'kssm' : 'igcse'] || []; }
  function paintAdmin() {
    var k = rowsOf('KSSM').length, i = rowsOf('IGCSE').length;
    var kc = staff.data.kssm_cap, ic = staff.data.igcse_cap;
    q('[data-kpis]', $app).innerHTML = [['KSSM', k, kc], ['IGCSE', i, ic], [T.admin.total, k + i, kc + ic]].map(function (x) {
      var pct = x[2] > 0 ? Math.min(100, x[1] / x[2] * 100) : 0;
      return '<div class="kpi"><div class="kpi__label">' + esc(x[0]) + '</div>' +
        '<div class="kpi__value"><span class="kpi__num">' + x[1] + '</span><span class="kpi__total">/ ' + x[2] + '</span></div>' +
        '<div class="bar"><div class="bar__fill" style="width:' + pct + '%"></div></div></div>';
    }).join('');
    q('[data-tabs]', $app).innerHTML = ['KSSM', 'IGCSE'].map(function (t) {
      return '<button type="button" class="tab" role="tab" data-tab="' + t + '" aria-selected="' + (staff.tab === t) + '">' + t +
        '<span class="tab__count">' + rowsOf(t).length + '</span></button>';
    }).join('');
    qa('[data-tab]', $app).forEach(function (b) {
      b.addEventListener('click', function () {
        staff.tab = b.getAttribute('data-tab');
        staff.query = '';
        q('[data-query]', $app).value = '';
        paintAdmin();
      });
    });
    paintList();
  }
  function paintList() {
    var all = rowsOf(staff.tab);
    var needle = staff.query.trim().toLowerCase();
    var rows = all.map(function (r, idx) { return { n: all.length - idx, r: r }; });
    if (needle) {
      rows = rows.filter(function (x) {
        var r = x.r;
        return (r.name + ' ' + r.email + ' ' + r.phone + ' ' + shownPhone(r.phone) + ' ' + String(r.phone).replace(/\D/g, '')).toLowerCase().indexOf(needle) >= 0;
      });
    }
    var slot = q('[data-list]', $app);
    if (!all.length) {
      slot.innerHTML = '<div class="empty">' + icon('list') + '<div class="empty__text">' + esc(fill(T.admin.empty, { tab: staff.tab })) + '</div></div>';
      return;
    }
    if (!rows.length) {
      slot.innerHTML = '<div class="nomatch">' + esc(fill(T.admin.noMatch, { q: staff.query.trim() })) + '</div>';
      return;
    }
    slot.innerHTML = '<div class="table"><div class="table__inner">' +
      '<div class="table__row table__row--head">' + T.admin.cols.map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') + '</div>' +
      rows.map(function (x) {
        var r = x.r;
        return '<div class="table__row"><span class="cell--n">' + x.n + '</span>' +
          '<span class="cell--name" title="' + esc(r.name) + '">' + esc(r.name) + '</span>' +
          '<span title="' + esc(r.email) + '">' + esc(r.email) + '</span>' +
          '<span class="cell--phone">' + esc(shownPhone(r.phone)) + '</span>' +
          '<span class="cell--time">' + esc(shownTime(r.created_at)) + '</span></div>';
      }).join('') + '</div></div>';
  }
  function refreshAdmin() {
    var btn = q('[data-refresh]', $app);
    btn.disabled = true;
    api.adminList(staff.passcode).then(function (r) {
      if (view !== 'admin' || !staff) return;
      btn.disabled = false;
      if (r && r.ok) { staff.data = r; paintAdmin(); toast(T.admin.refreshed, 'refresh'); }
      else logout();
    }, function () {
      if (view !== 'admin') return;
      btn.disabled = false;
      toast(T.admin.failed, 'refresh');
    });
  }
  function logout() {
    staff = null;
    goHome();
  }
  function toast(text, ic) {
    clearTimeout(toastTimer);
    var old = q('.toast'); if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = icon(ic || 'download') + esc(text);
    document.body.appendChild(el);
    toastTimer = setTimeout(function () { el.remove(); }, 2200);
  }

  // CSV: UTF-8 with BOM so Excel reads it correctly. A cell that starts with = + - or @
  // gets a leading apostrophe so Excel shows it as text and never runs it as a formula.
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function exportCsv(which) {
    var lines = [['Syllabus', 'Name', 'Email', 'Phone', 'Registered (MYT)']];
    (which === 'ALL' ? ['KSSM', 'IGCSE'] : [which]).forEach(function (tab) {
      rowsOf(tab).slice().reverse().forEach(function (r) {   // oldest first
        lines.push([tab, r.name, r.email, r.phone, csvTime(r.created_at)]);
      });
    });
    var text = '﻿' + lines.map(function (l) { return l.map(csvCell).join(','); }).join('\r\n') + '\r\n';
    var stamp = csvTime(new Date().toISOString()).replace(' ', '-').replace(':', '');
    var name = 'tupai-klssf-' + which.toLowerCase() + '-' + stamp + '.csv';
    var url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast(fill(T.admin.downloaded, { what: which === 'ALL' ? 'All claims CSV' : which + ' CSV' }));
  }

  // ------------------------------------------------------------ demo panel (demo mode only)

  function mountDemo() {
    if (!DEMO) return;
    document.body.classList.add('is-demo');
    var open = false;
    var d = api.demo;
    var paint = function () {
      var st = d.peek().state;
      var stateBtn = function (value, label) {
        return '<button type="button" class="demo__btn" data-state="' + value + '" aria-pressed="' + (st === value) + '">' + label + '</button>';
      };
      $demo.innerHTML = '<div class="demo">' +
        (open
          ? '<div class="demo__panel">' +
              '<div class="demo__title">DEMO MODE</div>' +
              '<div class="demo__note">Claims stay in this browser only. Staff passcode: <b>' + esc(d.passcode) + '</b> (double-click the logo).</div>' +
              '<div class="demo__group"><div class="demo__title">SAMPLE DATA</div>' +
                '<button type="button" class="demo__btn" data-seed="37,52">Mid-event: 63 KSSM, 48 IGCSE left</button>' +
                '<button type="button" class="demo__btn" data-seed="99,52">One KSSM account left</button>' +
                '<button type="button" class="demo__btn" data-seed="37,100">IGCSE all claimed</button>' +
                '<button type="button" class="demo__btn" data-seed="100,100">Everything claimed</button>' +
                '<button type="button" class="demo__btn" data-seed="0,0">Clear all claims</button>' +
              '</div>' +
              '<div class="demo__group"><div class="demo__title">REGISTRATION WINDOW</div>' +
                '<div class="demo__row">' + stateBtn('before', 'Before') + stateBtn('open', 'Open') + stateBtn('closed', 'Closed') + '</div>' +
              '</div>' +
              '<div class="demo__group"><button type="button" class="demo__btn" data-unlock>Unlock staff passcode</button></div>' +
            '</div>'
          : '') +
        '<button type="button" class="demo__pill" data-toggle aria-expanded="' + open + '">DEMO</button></div>';
      q('[data-toggle]', $demo).addEventListener('click', function () { open = !open; paint(); });
      var reload = function () { status = null; staff = null; paint(); route(); };
      qa('[data-seed]', $demo).forEach(function (b) {
        b.addEventListener('click', function () {
          var p = b.getAttribute('data-seed').split(',');
          d.seed(Number(p[0]), Number(p[1]));
          reload();
        });
      });
      qa('[data-state]', $demo).forEach(function (b) {
        b.addEventListener('click', function () { d.setState(b.getAttribute('data-state')); reload(); });
      });
      var unlock = q('[data-unlock]', $demo);
      if (unlock) unlock.addEventListener('click', function () { d.unlockStaff(); open = false; paint(); });
    };
    paint();
  }

  // ------------------------------------------------------------ router

  function parseHash() {
    var h = location.hash.replace(/^#/, '');
    var i = h.indexOf('?');
    return {
      path: (i < 0 ? h : h.slice(0, i)) || '/',
      booth: i >= 0 && /(^|&)booth=1(&|$)/.test(h.slice(i + 1))
    };
  }
  function route() {
    closeModal();
    clearInterval(countTimer); countTimer = null;
    staff = null;
    // Any navigation (including the browser's Back button) wipes the form, so the
    // next person on a shared booth device never sees the previous visitor's details.
    form = emptyForm();
    var r = parseHash();
    if (r.path === '/register') showForm(r.booth);
    else showLanding();
  }

  window.addEventListener('hashchange', route);
  mountDemo();
  route();
})();
