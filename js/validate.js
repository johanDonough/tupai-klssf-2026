// The same rules as claim_account() in backend/schema.sql. Keep the two in step.
// The database is the authority. This copy is for fast feedback and for demo mode.
window.KlssfValidate = (function () {
  'use strict';

  function name(v) {
    var t = String(v || '').trim();
    return t.length >= 2 && t.length <= 100;
  }

  function email(v) {
    var t = String(v || '').trim();
    return t.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t);
  }

  // code: country calling code digits, e.g. "60". national: whatever the visitor typed.
  // Returns the normalised number ("+60123456789") or null if it is not acceptable.
  function phone(code, national) {
    var cc = String(code || '').replace(/\D/g, '');
    var nn = String(national || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!/^[1-9][0-9]{0,3}$/.test(cc)) return null;
    if (cc === '60') {
      if (!/^1[0-9]{8,9}$/.test(nn)) return null;   // Malaysian mobile
    } else if (!/^[0-9]{6,12}$/.test(nn) || (cc + nn).length > 15) {
      return null;
    }
    return '+' + cc + nn;
  }

  // Splits the "+<code> <number>" string sent to the API, as the database does.
  function phoneFromWire(wire) {
    var t = String(wire || '').trim();
    var i = t.indexOf(' ');
    if (i < 0) return null;
    return phone(t.slice(0, i), t.slice(i + 1));
  }

  return { name: name, email: email, phone: phone, phoneFromWire: phoneFromWire };
})();
