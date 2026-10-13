/*
 * Bingr web: opstarten en levenscyclus. Sessie (gedeeld met bingr.online) → inloggen → apparaat registreren
 * (platform "browser") → "Wie kijkt er?" → app. Heartbeat bij starten, bij terugkeer naar het tabblad en elke 5 minuten.
 */
(function () {
  'use strict';
  var B = window.B;
  var U = B.ui, D = B.data, A = B.account, Lib = B.lib, S = B.screens;
  var h = U.h;
  var L = function () { return B.L.apply(null, arguments); };
  var app = B.app = { profile: null };
  var root = null, current = null, main = null;

  function withTimeout(p, ms) { return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(null); }, ms); })]); }
  function show(scr) {
    if (current && current.destroy) { try { current.destroy(); } catch (e) { B.log('destroy', e); } }
    current = scr;
    U.clear(root);
    root.appendChild(scr.el);
    window.scrollTo(0, 0);
  }
  function splash() { return { el: h('div.splash', [h('div.logo.big', 'BINGR'), U.spinner()]) }; }

  app.applyAccent = function (key) {
    var k = key || D.accentKey(app.profile);
    var c = D.accents[k] || D.accents.red;
    document.documentElement.style.setProperty('--accent', c);
    B.store.set('lastAccent', k);
  };
  app.startPage = function () {
    var s = String(D.shared('startScreen', 'home') || 'home').toLowerCase();
    var hidden = D.shared('hiddenTabs', []) || [];
    if (['home', 'live', 'movies', 'series'].indexOf(s) < 0 || hidden.indexOf(s) >= 0) s = 'home';
    return s;
  };

  /** Buildnummer uit de changelog van de site (zelfde bron als de rest van bingr.online). */
  function loadBuild() {
    return fetch('../assets/changelog.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
      var max = 0;
      // elk platform heeft zijn eigen build: de webspeler neemt de nieuwste build met een punt voor de website ('web')
      (Array.isArray(list) ? list : []).forEach(function (e) {
        var web = e && e.items && e.items.some(function (i) { return (i.platforms || []).indexOf('web') >= 0; });
        var b = B.int(e && e.build); if (web && b > max) max = b;
      });
      if (max) B.config.build = String(max);
    }).catch(B.noop);
  }

  // MARK: flow

  function start() {
    B.migrate();
    B.setLanguage(D.shared('appLanguage', '') || '');
    document.documentElement.style.setProperty('--accent', D.accents[B.store.get('lastAccent', 'red')] || D.accents.red);
    root = document.getElementById('app');
    show(splash());
    B.on('signedOut', function () { B.clearProxyToken(); toLogin(); });
    B.on('sessionInvalid', function () { A.revokedSignOut(); });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', function () { D.flush(); });
    document.addEventListener('keydown', globalKeys);
    Promise.all([withTimeout(loadBuild(), 2500), A.init()]).then(function (r) {
      if (r[1]) {
        afterLogin(false);
        A.refresh().then(function (res) { if (res === 'invalid') toLogin(); });
      } else toLogin();
    });
  }

  var onLogin = false;
  function toLogin() {
    if (onLogin) return;
    onLogin = true;
    if (B.player.current) B.player.current.close(true);
    destroyMain();
    app.profile = null;
    try { sessionStorage.removeItem('bingr.web.profile'); } catch (e) { /* stil */ }
    show(S.login(function () { onLogin = false; afterLogin(true); }));
  }

  function afterLogin(fresh) {
    D.checkAccountSwitch();
    show(splash());
    var reg = (fresh || !A.isRegistered()) ? A.registerDevice() : Promise.resolve('ok');
    reg.then(function (r) {
      if (r && r.limit) { showLimit(r); return; }
      // token voor de proxy (http-servers, video en afbeeldingen via bingr's server); ververst zichzelf
      B.ensureProxyToken();
      A.fetchConfig().then(function (ok) { if (ok) B.emit('config'); });
      var haveCache = D.profiles.length > 0;
      var sync = Promise.all([D.syncProfiles(), D.syncSources(), D.syncState()]).then(function (x) { D.migrateAccent(); return x; });
      return withTimeout(sync, haveCache ? 50 : 8000).then(showProfiles);
    });
    startHeartbeat();
  }
  function showLimit(info) {
    show(S.deviceLimit(info, function () {
      A.registerDevice().then(function (r) {
        if (r && r.limit) { showLimit(r); return; }
        afterLogin(false);
      });
    }, function () { app.signOut(); }));
  }

  function destroyMain() { if (main) { main = null; } }
  function showProfiles() {
    app.profile = null;
    destroyMain();
    // dezelfde sessie in dit tabblad (herladen, deeplink): hetzelfde profiel
    var keep = null;
    try { keep = sessionStorage.getItem('bingr.web.profile'); } catch (e) { keep = null; }
    var p = keep ? D.profileById(keep) : null;
    if (!p && D.profiles.length === 1 && !D.pinFor(D.profiles[0])) p = D.profiles[0];
    if (p) { pickProfile(p); return; }
    if (location.hash && location.hash !== '#/') history.replaceState(null, '', location.pathname + location.search);
    show(S.profiles(pickProfile));
    document.title = L("Who's watching?") + ' · Bingr';
    app.applyAccent(B.store.get('lastAccent', 'red'));
  }
  app.switchProfile = function () {
    if (B.player.current) B.player.current.close();
    B.ageRatings.stop();
    D.flush();
    try { sessionStorage.removeItem('bingr.web.profile'); } catch (e) { /* stil */ }
    showProfiles();
  };
  app.pickProfileWithPin = function (p) {
    var pin = D.pinFor(p);
    if (pin) U.askPIN(L('Enter PIN'), function (x) { return x === pin; }, function () { pickProfile(p); }, S.avatar(p, 'pinav'));
    else pickProfile(p);
  };

  function pickProfile(p) {
    if (B.player.current) B.player.current.close(true);
    D.flush();
    app.profile = p;
    B.store.set('lastProfile', p.id);
    try { sessionStorage.setItem('bingr.web.profile', p.id); } catch (e) { /* stil */ }
    app.applyAccent();
    D.loadProfileState(p.id);
    if (B.parental.isUnlocked()) B.parental.lock();
    var src = D.activeSource();
    main = S.main();
    show(main);
    main.start();
    Lib.select(src).then(function () {
      B.whenQuiet(function () { warmAges(); }, 2500);
    });
    D.syncState().then(function () { if (app.profile === p) { Lib.applyFilters(); B.trakt.refresh(false); } });
  }
  function warmAges() { if (app.profile && D.ageLimit(app.profile) != null) B.ageRatings.warm(Lib.raw); }
  var agePending = false;
  B.on('ageRatings', function () {
    if (!app.profile || D.ageLimit(app.profile) == null || agePending) return;
    agePending = true;
    B.whenQuiet(function () { agePending = false; Lib.applyFilters(); }, 1500);
  });
  B.on('config', function () { if (app.profile) { B.trakt.refresh(false); warmAges(); } });
  B.ageRatings.preload();

  app.signOut = function () {
    if (B.player.current) B.player.current.close();
    D.flush().then(function () { return A.signOut(); });
  };

  /** Taal wijzigen (settings.shared.appLanguage): de schermen opnieuw opbouwen. */
  app.setLanguage = function (v) {
    B.setLanguage(v);
    rebuild();
  };
  function rebuild() {
    if (B.player.current || onLogin) return;
    if (!app.profile) { if (current && current.el.classList.contains('profiles-screen')) showProfiles(); return; }
    main = S.main();
    show(main);
    main.start();
  }
  B.on('settings', function () {
    var before = B.lang;
    B.setLanguage(D.shared('appLanguage', '') || '');
    if (B.lang !== before) rebuild();
  });
  B.on('profiles', function () {
    if (app.profile && !D.profileById(app.profile.id)) showProfiles();
  });

  // MARK: heartbeat

  var hbTimer = null, checking = false, lastCheck = 0;
  function deviceCheck() {
    if (!A.isSignedIn() || checking || onLogin) return;
    checking = true; lastCheck = Date.now();
    var p = A.isRegistered() ? A.heartbeat() : A.registerDevice().then(function (r) { if (r && r.limit) { showLimit(r); return 'limit'; } return true; });
    p.then(function (alive) {
      if (alive === 'limit') return;
      if (alive === false) { U.toast(L('This browser was removed from your account.'), 5000); A.revokedSignOut(); return; }
      return Promise.all([D.syncProfiles(), D.syncSources(), D.syncState()]).then(function () {
        if (app.profile && !D.profileById(app.profile.id)) { showProfiles(); return; }
        if (app.profile) {
          var fresh = D.profileById(app.profile.id);
          var accentChanged = D.accentKey(fresh) !== D.accentKey(app.profile);
          app.profile = fresh;
          if (accentChanged) app.applyAccent();
          var src = D.activeSource();
          if (src && (!Lib.source || String(src.id).toLowerCase() !== String(Lib.source.id).toLowerCase())) Lib.select(src);
          else if (src) { Lib.source = src; Lib.applyFilters(); }
        }
      });
    }).catch(B.noop).then(function () { checking = false; });
  }
  function startHeartbeat() {
    clearInterval(hbTimer);
    hbTimer = setInterval(deviceCheck, 5 * 60000);
    setTimeout(deviceCheck, 4000);
  }
  function onVisibility() {
    if (document.hidden) { D.flush(); return; }
    if (Date.now() - lastCheck > 60000) deviceCheck();
    if (A.isSignedIn && A.isSignedIn()) B.ensureProxyToken();
  }

  /** Overal: "/" = zoeken, Esc sluit een venster. */
  function globalKeys(e) {
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (e.key === 'Escape' && U.dialogOpen() && !B.player.current) { e.preventDefault(); U.closeTopDialog(); return; }
    if (B.player.current || !app.profile || typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); U.router.go('/search'); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
