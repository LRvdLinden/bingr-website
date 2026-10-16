/*
 * Bingr web: pushmeldingen (Web Push met VAPID), volgens docs/PUSH.md van iptv-ios-appletv.
 * - Service worker web/sw.js (scope /web/) toont de melding en opent bij een tik de juiste pagina.
 * - Aanzetten alleen na een klik (Instellingen → Pushmeldingen): toestemming vragen, VAPID-sleutel via `push`
 *   {action:"vapid_key"}, PushManager.subscribe en dan `push` {action:"register", platform:"web", channel:"webpush"}.
 * - Uitzetten en uitloggen: `push` {action:"unregister"} en het abonnement in de browser opzeggen.
 * - Bij elke start (ingelogd) en na pushsubscriptionchange: opnieuw registreren als token, taal, build of account anders is.
 * - iPhone/iPad: alleen als web-app op het beginscherm (Safari heeft daarbuiten geen PushManager).
 * Stand per browser in localStorage (bingr.web.push = {on}, bingr.web.pushReg = handtekening van de laatste registratie).
 */
(function () {
  'use strict';
  var B = window.B;
  var A = B.account;
  var L = function () { return B.L.apply(null, arguments); };
  var P = B.push = {};

  var regP = null;      // service worker-registratie (één keer)
  var pending = null;   // zender uit een herinnering die nog geopend moet worden: {channel, profile}
  var busy = null;

  // MARK: omgeving

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  }
  function standalone() {
    try { if (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches) return true; } catch (e) { /* stil */ }
    return navigator.standalone === true;
  }
  /** Kan deze browser Web Push? */
  P.supported = function () {
    return !!(window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
  };
  /** iPhone/iPad in Safari (niet vanaf het beginscherm): eerst als web-app toevoegen. */
  P.needsHomeScreen = function () { return isIOS() && !standalone(); };
  P.permission = function () { try { return window.Notification ? Notification.permission : 'default'; } catch (e) { return 'default'; } };
  P.isOn = function () { return !!(B.store.get('push', {}) || {}).on && P.supported() && P.permission() === 'granted'; };
  function setOn(on) { B.store.set('push', { on: !!on }); if (!on) B.store.del('pushReg'); B.emit('push'); }

  // MARK: service worker

  /** Registreren vanuit de webspeler (web/index.html → sw.js, scope ./ = /web/). */
  P.registration = function () {
    if (!('serviceWorker' in navigator)) return Promise.reject(new Error('no sw'));
    if (!regP) {
      regP = navigator.serviceWorker.register('sw.js', { scope: './' }).then(function () {
        return navigator.serviceWorker.ready;
      });
      regP.catch(function (e) { B.log('service worker', e); regP = null; });
    }
    return regP;
  };

  // MARK: aanroepen van de functie push

  function call(body, signedIn) {
    var url = B.config.supabaseUrl + '/functions/v1/push';
    function go(token) {
      var h = { 'apikey': B.config.supabaseKey, 'Content-Type': 'application/json', 'Accept': 'application/json' };
      if (token) h.Authorization = 'Bearer ' + token;
      return B.http(url, { method: 'POST', headers: h, body: body, timeout: 20000 });
    }
    if (!signedIn) return go(null);
    return A.validAccessToken().then(function (t) {
      return go(t).then(function (r) {
        if (r.status !== 401) return r;
        return A.refresh().then(function (res) { if (res !== 'ok') return r; return A.validAccessToken().then(go); });
      });
    });
  }
  function okResp(r) { return r && r.status >= 200 && r.status < 300 && !(r.json && r.json.ok === false); }

  function b64urlToBytes(s) {
    var b = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var raw = atob(b), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  P.vapidKey = function () {
    return call({ action: 'vapid_key' }, false).then(function (r) {
      var k = r && r.json && (r.json.key || r.json.publicKey);
      if (!okResp(r) || !k) throw new Error('vapid_key');
      return String(k);
    });
  };

  /** Bestaand abonnement, of een nieuw (toestemming moet er al zijn). */
  function subscription(create) {
    return P.registration().then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub || !create) return sub;
        return P.vapidKey().then(function (k) {
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(k) });
        });
      });
    });
  }
  function signature(token) { return [A.userId() || '', A.deviceId(), token, B.lang, B.config.build || ''].join('|'); }

  function register(sub) {
    var token = JSON.stringify(sub.toJSON ? sub.toJSON() : sub);
    var sig = signature(token);
    var build = B.int(B.config.build) || 0;
    return call({
      action: 'register', device_id: A.deviceId(), platform: 'web', channel: 'webpush', token: token,
      lang: B.lang, app_version: B.config.version, app_build: build
    }, true).then(function (r) {
      if (!okResp(r)) throw new Error('register ' + (r && r.status));
      B.store.set('pushReg', sig);
      return true;
    });
  }
  function unregisterServer() {
    if (!A.isSignedIn()) return Promise.resolve(false);
    return call({ action: 'unregister', device_id: A.deviceId() }, true).then(okResp, function () { return false; });
  }
  function unsubscribeLocal() {
    if (!P.supported()) return Promise.resolve();
    return P.registration().then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (sub) { return sub ? sub.unsubscribe() : false; }).catch(B.noop);
  }

  function askPermission() {
    // oudere Safari: callback in plaats van een promise
    return new Promise(function (resolve) {
      try {
        var p = Notification.requestPermission(function (x) { resolve(x); });
        if (p && p.then) p.then(resolve, function () { resolve(P.permission()); });
      } catch (e) { resolve(P.permission()); }
    });
  }

  // MARK: aan / uit (alleen na een klik van de gebruiker)

  /** Aanzetten: 'on' | 'denied' | 'unsupported' | 'homescreen' | 'failed'. Moet vanuit een klik worden aangeroepen. */
  P.enable = function () {
    if (P.needsHomeScreen() && !P.supported()) return Promise.resolve('homescreen');
    if (!P.supported()) return Promise.resolve('unsupported');
    if (busy) return busy;
    // eerst de toestemming (de vraag moet direct uit de klik komen), daarna pas het netwerk
    busy = askPermission().then(function (perm) {
      if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'dismissed';
      return subscription(true).then(register).then(function () { setOn(true); return 'on'; }, function (e) {
        B.log('push aanzetten', e);
        return unsubscribeLocal().then(function () { setOn(false); return 'failed'; });
      });
    }).then(function (res) { busy = null; return res; }, function () { busy = null; return 'failed'; });
    return busy;
  };
  /** Uitzetten: afmelden bij de server en het abonnement in de browser opzeggen. */
  P.disable = function () {
    setOn(false);
    return Promise.all([unregisterServer(), unsubscribeLocal()]).then(function () { return true; });
  };
  /** Uitloggen (app.signOut): eerst afmelden zolang de sessie er nog is. */
  P.signOut = function () {
    if (!(B.store.get('push', {}) || {}).on) return unsubscribeLocal();
    // hooguit 4 s wachten: uitloggen mag niet blijven hangen op het netwerk
    return Promise.race([P.disable().catch(B.noop), new Promise(function (r) { setTimeout(r, 4000); })]);
  };

  /**
   * Na het inloggen, bij elke start en na pushsubscriptionchange of een taalwissel: staat push aan, dan het abonnement
   * controleren en opnieuw registreren als token, taal, build of account veranderd is. Toestemming ingetrokken = uit.
   */
  P.sync = function () {
    var st = B.store.get('push', {}) || {};
    if (!st.on || !A.isSignedIn()) return Promise.resolve(false);
    if (!P.supported() || P.permission() !== 'granted') {
      // toestemming ingetrokken (of andere browser-instelling): afmelden
      setOn(false);
      return unregisterServer();
    }
    return subscription(true).then(function (sub) {
      if (!sub) return false;
      var token = JSON.stringify(sub.toJSON ? sub.toJSON() : sub);
      if (B.store.get('pushReg', '') === signature(token)) return true;
      return register(sub);
    }).catch(function (e) { B.log('push sync', e); return false; });
  };

  // MARK: herinnering openen (tik op een melding met kind "reminder")

  function lower(s) { return String(s || '').toLowerCase(); }
  /** Zender uit een herinnering openen zodra er een profiel en een bibliotheek is. */
  P.tryPending = function () {
    if (!pending) return false;
    var app = B.app, Lib = B.lib, D = B.data;
    if (!app || !app.profile || !Lib || !Lib.lib || !Lib.lib.channels) return false;
    var want = pending;
    pending = null;
    // zoals in de apps: alleen bij een eigen herinnering, of als het actieve profiel geen leeftijdsgrens heeft
    var own = !want.profile || lower(want.profile) === lower(app.profile.id);
    if (!own && D.ageLimit(app.profile) != null) return false;
    var lib = Lib.lib;
    var hit = lib.byId && lib.byId[want.channel];
    var ch = hit && hit.type === 'channel' ? hit.item : null;
    if (!ch) {
      var id = lower(want.channel);
      for (var i = 0; i < lib.channels.length; i++) { if (lower(lib.channels[i].id) === id) { ch = lib.channels[i]; break; } }
    }
    B.ui.router.go('/live', true);
    if (ch && B.player && B.player.playChannel) { B.player.playChannel(ch, [ch]); return true; }
    return false;
  };
  function setPending(rem) {
    if (!rem || !rem.channel) return;
    pending = { channel: String(rem.channel), profile: String(rem.profile || '') };
    P.tryPending();
  }

  /** Bij het starten: link uit een melding (#/live?channel=…&profile=…) onthouden en uit de adresbalk halen. */
  P.init = function () {
    try {
      var r = B.ui.router.parse();
      if (r.parts[0] === 'live' && r.query.channel) {
        pending = { channel: r.query.channel, profile: r.query.profile || '' };
        history.replaceState(null, '', location.pathname + location.search + '#/live');
      }
    } catch (e) { /* stil */ }
    if (!P.supported()) return;
    // de service worker staat altijd klaar (geen cache, alleen push), zodat pushsubscriptionchange ook werkt
    P.registration().catch(B.noop);
    navigator.serviceWorker.addEventListener('message', function (e) {
      var m = e.data || {};
      if (m.type === 'bingr-push-open') setPending(m.reminder);
      else if (m.type === 'bingr-push-resubscribe') { B.store.del('pushReg'); P.sync(); }
    });
    // uitgelogd zonder app.signOut (sessie verlopen, apparaat elders verwijderd): de server ruimt op, hier opzeggen
    B.on('signedOut', function () {
      if ((B.store.get('push', {}) || {}).on) { setOn(false); unsubscribeLocal(); }
    });
    // andere taal: opnieuw registreren (de melding komt in de taal van het apparaat)
    var lastLang = B.lang;
    B.on('settings', function () { if (B.lang !== lastLang) { lastLang = B.lang; P.sync(); } });
  };

  // MARK: instellingen (rij "Pushmeldingen" met uitleg)

  /** Rij in Instellingen → App. render = de pagina opnieuw tekenen. */
  P.settingsRow = function (sec, row, render) {
    var on = P.isOn();
    var sub;
    if (P.needsHomeScreen() && !P.supported()) sub = L('On iPhone and iPad, notifications only work when Bingr is on your Home Screen: tap Share → Add to Home Screen, open Bingr from there and turn this on.');
    else if (!P.supported()) sub = L('This browser doesn’t support notifications.');
    else if (P.permission() === 'denied') sub = L('Notifications are blocked for bingr.online. Allow them in your browser’s site settings and try again.');
    else sub = L('Get notifications for messages from Bingr and for reminders you set in the Bingr app, also when this tab is closed.');
    return row(sec, L('Push notifications'), null, function () {
      if (on) { P.disable().then(render); render(); return; }
      P.enable().then(function (res) {
        if (res === 'on') B.ui.toast(L('Push notifications are on.'));
        else if (res === 'denied') B.ui.toast(L('Notifications are blocked for bingr.online. Allow them in your browser’s site settings and try again.'), 6000);
        else if (res === 'homescreen') B.ui.modal({ title: L('Push notifications'), text: L('On iPhone and iPad, notifications only work when Bingr is on your Home Screen: tap Share → Add to Home Screen, open Bingr from there and turn this on.'), buttons: [{ label: L('OK') }] });
        else if (res === 'unsupported') B.ui.toast(L('This browser doesn’t support notifications.'), 5000);
        else if (res === 'failed') B.ui.toast(L('Couldn’t turn on notifications. Please try again later.'), 5000);
        render();
      });
    }, { toggle: on, icon: 'bell', sub: sub });
  };
})();
