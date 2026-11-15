/*
 * Build 171 (#37): eigen crashrapporten van de webspeler, zonder derde partij (docs/ACCOUNT.md in iptv-ios-appletv, "Build 171").
 * window.onerror en unhandledrejection, ontdubbeld op handtekening en max. 10 per sessie (B.b171.Session). Alles wordt eerst
 * opgeschoond (B.b171.scrub: URL's -> <url>, IP-adressen, e-mailadressen, tokens) en lokaal in een wachtrij gezet; versturen
 * met device-auth `crash_report` (ingelogd, anders alleen met de publishable key). 400 = weggooien; 404, 429, 503 en
 * unknown_action (oudere server) = bewaren en later opnieuw, max. 7 dagen. Instelling "Crashrapporten delen" (standaard aan,
 * per apparaat): uit = niets verzamelen en de wachtrij weg.
 */
(function () {
  'use strict';
  var B = window.B, X = B.b171;
  if (!X) return;
  var C = B.crash = {};
  var KEY = 'crashQueue', session = new X.Session(), sending = false, timer = 0;

  function enabled() {
    try { return B.store.get('local.crashReports', true) !== false; } catch (e) { return false; }
  }
  function info() {
    var a = B.account && B.account.agent ? B.account.agent() : {};
    var build = parseInt(B.config && B.config.build, 10);
    return {
      platform: B.isWindowsApp ? 'windows' : 'web',
      app_version: B.config ? B.config.version + (B.config.build ? ' (' + B.config.build + ')' : '') : '',
      build: isFinite(build) ? build : undefined,
      os_version: a.osVersion || '', device_model: [a.browser, a.os].filter(Boolean).join(' / ')
    };
  }
  function queue() { var q = null; try { q = B.store.get(KEY, []); } catch (e) { q = []; } return Array.isArray(q) ? q : []; }
  function save(q) { try { B.store.set(KEY, q); } catch (e) { /* vol: dan niet bewaren */ } }
  C.clear = function () { try { B.store.del(KEY); } catch (e) { /* stil */ } };

  /** Fout vastleggen (ook voor andere modules: B.crash.capture(e)). */
  C.capture = function (kind, err, fallbackMessage) {
    try {
      if (!enabled()) return;
      var name = (err && err.name) || 'Error', msg = (err && err.message) || fallbackMessage || String(err || '');
      var stack = (err && err.stack) || '';
      var r = X.report(kind || 'error', name, msg, stack, B.assign({ at: Date.now() }, info()));
      // eigen fouten van extensies of andere scripts (geen bestand van ons in de stack) niet melden
      if (stack && !/\/web\/js\/|\/assets\/js\//.test(stack)) return;
      if (!session.accept(r.signature)) return;
      save(X.enqueue(queue(), r, Date.now()));
      soon(4000);
    } catch (e) { /* een fout in het melden mag nooit iets breken */ }
  };
  window.addEventListener('error', function (ev) {
    if (!ev || (!ev.error && !ev.message)) return; // laadfouten van <img>/<video> (geen scriptfout)
    if (ev.message === 'Script error.' && !ev.error) return; // fout uit een ander domein: zonder details
    C.capture('error', ev.error || { name: 'Error', message: ev.message, stack: (ev.filename || '') + ':' + (ev.lineno || 0) }, ev.message);
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    if (!r || !(r instanceof Error)) return; // afgewezen beloftes zonder Error (bv. "cancelled") zijn geen crash
    if (/cancel|abort|timeout|offline/i.test(r.message || '')) return;
    C.capture('error', r);
  });

  function soon(ms) { clearTimeout(timer); timer = setTimeout(C.flush, ms || 2000); }
  function post(body) {
    var A = B.account;
    if (A && A.isSignedIn && A.isSignedIn() && A.authed) return A.authed(body);
    return B.http(B.config.supabaseUrl + '/functions/v1/device-auth', {
      method: 'POST', headers: { apikey: B.config.supabaseKey, 'Content-Type': 'application/json' }, body: body, timeout: 15000
    }).then(function (r) { r.ok = r.status >= 200 && r.status < 300; return r; }, function () { return null; });
  }
  /** Wachtrij versturen (bij het starten, na een nieuwe fout, na inloggen). Eén tegelijk; stopt bij de eerste storing. */
  C.flush = function () {
    if (sending || !enabled()) return Promise.resolve();
    var q = X.prune(queue(), Date.now());
    if (!q.length) { save(q); return Promise.resolve(); }
    sending = true;
    var dev = B.account && B.account.deviceId ? B.account.deviceId() : '';
    function next() {
      var r = q[0];
      if (!r) return Promise.resolve();
      return post(B.assign({ action: 'crash_report', device_id: dev }, r)).then(function (res) {
        var status = res ? res.status : 0, err = res && res.json && res.json.error;
        if (res && res.ok) { q.shift(); save(q); return next(); }
        if (status === 400 && err === 'bad_report') { q.shift(); save(q); return next(); }
        return null; // 401/404/429/503/unknown_action/offline: bewaren, later opnieuw
      });
    }
    return next().then(function () { sending = false; }, function () { sending = false; });
  };
  setTimeout(C.flush, 15000);
  if (B.on) B.on('signedIn', function () { soon(5000); });
})();
