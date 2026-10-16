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

  // Accentkleur goud (nieuw; past bij het gouden app-icoon). D.accents is dezelfde lijst als ACCENTS in sync.js
  // (accentKey, setAccent en de migratie kennen hem daardoor ook). Oudere apps kennen "gold" niet en tekenen rood.
  if (!D.accents.gold) D.accents.gold = '#F5B30B';
  // tekst/iconen óp een vlak in de accentkleur: wit, maar donker op een licht accent (wit op goud is onleesbaar)
  var ON_ACCENT = { gold: '#1A1400' };
  function setAccentVars(k) {
    var st = document.documentElement.style;
    st.setProperty('--accent', D.accents[k] || D.accents.red);
    st.setProperty('--on-accent', D.accents[k] && ON_ACCENT[k] ? ON_ACCENT[k] : '#fff');
  }

  function withTimeout(p, ms) { return Promise.race([p, new Promise(function (r) { setTimeout(function () { r(null); }, ms); })]); }
  function show(scr) {
    if (scr === current) return;
    if (current && current.destroy) { try { current.destroy(); } catch (e) { B.log('destroy', e); } }
    current = scr;
    U.clear(root);
    root.appendChild(scr.el);
    window.scrollTo(0, 0);
  }
  /*
   * Intro zoals in de apps (SplashView): covers uit je bibliotheek regenen naar beneden, het beeld wordt donker,
   * de letters van BINGR springen één voor één omhoog, een glanzende veeg en de rode streep eronder.
   * Daarna blijft de naam staan tot het volgende scherm klaar is (geen los laadrondje meer).
   */
  var PAL = [['#E50914', '#7A0008'], ['#2563EB', '#1E1B4B'], ['#10B981', '#064E3B'], ['#F59E0B', '#9A3412'], ['#A855F7', '#3B0764'], ['#EC4899', '#831843'], ['#14B8A6', '#0C4A6E'], ['#64748B', '#0F172A']];
  function seeded(seed) { var st = seed >>> 0; return function () { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; }; }
  function introSplash(animated) {
    var reduce = false; try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* stil */ }
    var anim = animated && !reduce;
    var kids = [];
    if (anim) {
      var posters = (B.store.get('splashPosters', []) || []).slice();
      for (var k = posters.length - 1; k > 0; k--) { var j = Math.floor(Math.random() * (k + 1)); var t = posters[k]; posters[k] = posters[j]; posters[j] = t; }
      var w = window.innerWidth || 1280, cols = w > 1100 ? 8 : w > 700 ? 6 : 5, per = 3, g = seeded(42), colW = 100 / cols;
      for (var c = 0; c < cols; c++) for (var row = 0; row < per; row++) {
        var i = c * per + row, pal = PAL[i % PAL.length], url = posters.length ? posters[i % posters.length] : null;
        var cw = colW * (0.82 + g() * 0.25);
        var x = colW * (c + 0.5) + (g() - 0.5) * colW * 0.3;
        var el = h('div.sp-cover', { style: 'left:' + x + 'vw;width:' + cw + 'vw;margin-left:' + (-cw / 2) + 'vw;'
          + 'background:linear-gradient(135deg,' + pal[0] + ',' + pal[1] + ');'
          + 'animation-delay:' + (0.12 + row * 0.32 + g() * 0.35).toFixed(2) + 's;animation-duration:' + (1.15 + g() * 0.55).toFixed(2) + 's;'
          + '--r0:' + ((g() - 0.5) * 16).toFixed(1) + 'deg;--r1:' + ((g() - 0.5) * 30).toFixed(1) + 'deg' }, url ? [U.img(url, 'sp-img')] : null);
        kids.push(el);
      }
      kids.push(h('div.sp-dim'));
    }
    var letters = 'BINGR'.split('').map(function (ch, n) { return h('span.sp-l', { style: 'animation-delay:' + (1.52 + n * 0.09).toFixed(2) + 's' }, ch); });
    kids.push(h('div.sp-word', [h('div.sp-letters', letters), h('div.sp-shine', 'BINGR'), h('div.sp-line')]));
    var scr = { el: h('div.splash.sp' + (anim ? '.sp-anim' : '.sp-static'), kids), isSplash: true };
    scr.done = new Promise(function (res) { setTimeout(res, anim ? 3000 : 0); });
    return scr;
  }
  // tussenscherm tijdens laden: houdt de intro staan als die nog in beeld is, anders de naam zonder animatie
  function splash() { return current && current.isSplash ? current : introSplash(false); }
  // covers voor de volgende intro bewaren (zoals SplashPosters in de apps)
  B.on('library', function () {
    try {
      var l = Lib.lib || {}, list = [];
      (l.movies || []).slice(0, 300).forEach(function (x) { if (x.poster) list.push(x.poster); });
      (l.series || []).slice(0, 200).forEach(function (x) { if (x.poster) list.push(x.poster); });
      for (var k = list.length - 1; k > 0; k--) { var j = Math.floor(Math.random() * (k + 1)); var t = list[k]; list[k] = list[j]; list[j] = t; }
      if (list.length) B.store.set('splashPosters', list.slice(0, 40));
    } catch (e) { /* stil */ }
  });

  app.applyAccent = function (key) {
    var k = key || D.accentKey(app.profile);
    // accentkleuren horen bij Lifetime: met Gratis blijft Bingr rood
    if (B.plan && !B.plan.has('themes')) k = 'red';
    setAccentVars(k);
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
    // pushmeldingen: service worker (alleen push) en een zender uit een herinnering (#/live?channel=…)
    if (B.push) B.push.init();
    B.setLanguage(D.shared('appLanguage', '') || '');
    setAccentVars(B.store.get('lastAccent', 'red'));
    root = document.getElementById('app');
    var intro = introSplash(true);
    show(intro);
    var introReady = intro.done;
    B.on('signedOut', function () { B.clearProxyToken(); toLogin(); });
    B.on('sessionInvalid', function () { A.revokedSignOut(); });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', function () { D.flush(); });
    document.addEventListener('keydown', globalKeys);
    Promise.all([withTimeout(loadBuild(), 2500), A.init(), introReady]).then(function (r) {
      if (r[1]) {
        afterLogin(false);
        A.refresh().then(function (res) { if (res === 'invalid') toLogin(); });
      } else toLogin();
    });
  }

  var onLogin = false;
  // geblokkeerd account (user_banned): na het uitloggen de melding op het inlogscherm
  function blockedNotice() {
    if (A.takeBlocked && A.takeBlocked()) U.modal({ title: L('Account'), text: A.bannedMessage(), buttons: [{ label: L('OK') }] });
  }
  function toLogin() {
    if (onLogin) { blockedNotice(); return; }
    onLogin = true;
    if (B.player.current) B.player.current.close(true);
    destroyMain();
    app.profile = null;
    try { sessionStorage.removeItem('bingr.web.profile'); } catch (e) { /* stil */ }
    show(S.login(function () { onLogin = false; afterLogin(true); }));
    blockedNotice();
  }

  function afterLogin(fresh) {
    D.checkAccountSwitch();
    B.plan.load();
    show(splash());
    var reg = (fresh || !A.isRegistered()) ? A.registerDevice() : Promise.resolve('ok');
    reg.then(function (r) {
      if (r && r.limit) { showLimit(r); return; }
      // token voor de proxy (http-servers, video en afbeeldingen via bingr's server); ververst zichzelf
      B.ensureProxyToken();
      B.plan.fetch();
      A.fetchConfig().then(function (ok) { if (ok) B.emit('config'); });
      var haveCache = D.profiles.length > 0;
      var sync = Promise.all([D.syncProfiles(), D.syncSources(), D.syncState()]).then(function (x) { D.migrateAccent(); return x; });
      return withTimeout(sync, haveCache ? 50 : 8000).then(showProfiles);
    });
    startHeartbeat();
    // pushmeldingen: opnieuw registreren als token, taal, build of account anders is (alleen als ze aan staan)
    if (B.push) B.push.sync();
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
      if (B.push && app.profile === p) B.push.tryPending();
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
  // ander abonnement (Gratis ↔ Lifetime): accentkleur en de open pagina bijwerken
  B.on('plan', function () { if (app.profile) { app.applyAccent(); if (B.plan.has('trakt')) B.trakt.refresh(false); } });

  app.signOut = function () {
    if (B.player.current) B.player.current.close();
    // eerst push afmelden (unregister) zolang de sessie er nog is, dan het apparaat en de sessie
    D.flush().then(function () { return B.push ? B.push.signOut() : null; }).then(function () { return A.signOut(); });
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
  /** Tabbladen aan/uit (settings.shared.hiddenTabs): de navigatie opnieuw opbouwen, op dezelfde pagina. */
  app.rebuildNav = function () { rebuild(); };
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
