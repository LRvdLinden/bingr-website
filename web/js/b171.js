/*
 * Build 171 (versie 1.0.7): onderdelen van de webspeler rond de pure logica in b171logic.js.
 * - #15 zenders verbergen en #20 titels blokkeren per profiel (contextmenu, Instellingen > Profielen, de detailpagina);
 *   het filteren zelf zit in library.js (Live TV, gids, zoeken, zappen, rijen) en op de kaarten (screens.js).
 * - #1 de instelling "Vragen of je nog kijkt" (Instellingen > Afspelen; de vraag zelf zit in player.js).
 * - #37 de instelling "Crashrapporten delen" (Instellingen > Over > Privacy; het verzamelen zit in crash.js).
 * Kinderprofiel: wijzigen vanuit of in een kinderprofiel gaat achter de pincode van het hoofdprofiel (als die er is).
 */
(function () {
  'use strict';
  var B = window.B;
  var U = B.ui, D = B.data, Lib = B.lib, S = B.screens, A = B.account, X = B.b171;
  var h = U.h, R = U.router;
  var L = function () { return B.L.apply(null, arguments); };
  var UI = B.b171ui = {};
  var lower = function (s) { return String(s == null ? '' : s).toLowerCase(); };

  function prof() { return B.app && B.app.profile; }
  /** Server van een item: andere server (x._src), tegel uit catalogmeta (x._key), anders de actieve. */
  function sidOf(x) {
    if (x && x._key) { var bar = String(x._key).indexOf('|'); if (bar > 0) return String(x._key).slice(0, bar); }
    var s = (x && x._src) || Lib.source;
    return s ? s.id : '';
  }
  function itemOf(x) {
    if (x && x._key) { var k = String(x._key), bar = k.indexOf('|'); return bar > 0 ? k.slice(bar + 1) : String(x.id); }
    return String(x && x.id);
  }
  function keyFor(x, type) { return type === 'channel' ? X.channelKey(sidOf(x), itemOf(x)) : X.titleKey(sidOf(x), type, itemOf(x)); }
  function fieldFor(type) { return type === 'channel' ? 'hiddenChannels' : 'blockedTitles'; }

  /** Moet deze kaart weg voor het actieve profiel? */
  UI.hides = function (x, type) {
    if (!x || !D.inSet || (type !== 'channel' && type !== 'movie' && type !== 'series')) return false;
    if (x.external) return false;
    return D.inSet(fieldFor(type), keyFor(x, type));
  };

  /** Wijziging aan (de lijsten van) een kinderprofiel, of vanuit een kinderprofiel: eerst de pincode van het hoofdprofiel. */
  function guard(target, fn) {
    var p = prof(), main = D.mainProfile();
    var needs = !!((p && p.kids) || (target && target.kids));
    var pin = main ? D.pinFor(main) : null;
    if (!needs || !pin) { fn(); return; }
    U.askPIN(L('Enter PIN'), function (x) { return D.checkPin(main, x); }, fn, S.avatar(main, 'pinav'));
  }
  function setFor(p, field, key, on) {
    if (!p) return;
    if (D.toggleSetFor) D.toggleSetFor(p.id, field, key, on); else D.toggleSet(field, key, on);
    refilter();
  }
  var refTimer = 0;
  function refilter() {
    clearTimeout(refTimer);
    refTimer = setTimeout(function () {
      if (Lib.applyFilters && Lib.raw) Lib.applyFilters();
      // kaarten die al op het scherm staan meteen verbergen; de rest tekent opnieuw na het event 'library'
      B.emit('b171Hidden');
    }, 50);
  }
  // sync van een ander apparaat of profielwissel: opnieuw filteren (applyFilters doet niets als er niets veranderde)
  B.on('profileData', refilter);

  // MARK: contextmenu

  function kidsProfiles() { return (D.profiles || []).filter(function (p) { return p.kids; }); }
  function hideItems(x, type) {
    if (!x || x.external || (type !== 'channel' && type !== 'movie' && type !== 'series')) return [];
    var p = prof(), items = [], key = keyFor(x, type), field = fieldFor(type);
    var label = type === 'channel' ? L('Hide channel') : L('Hide for this profile');
    if (!D.inSet(field, key)) {
      items.push({ icon: 'eyeOff', label: label, fn: function () {
        guard(p, function () {
          setFor(p, field, key, true);
          U.toast(type === 'channel' ? L('Channel hidden for %@', p.name) : L('Hidden for %@', p.name));
        });
      } });
    }
    // vanuit het hoofdprofiel ook voor een kinderprofiel (achter de pincode)
    if (p && D.isMain(p)) {
      kidsProfiles().slice(0, 3).forEach(function (k) {
        if (D.setListFor && D.setListFor(k.id, field).some(function (x2) { return lower(x2) === lower(key); })) return;
        items.push({ icon: 'eyeOff', label: L('Hide for %@', k.name), fn: function () {
          guard(k, function () { setFor(k, field, key, true); U.toast(L('Hidden for %@', k.name)); });
        } });
      });
    }
    return items;
  }
  var baseMenu = S.cardMenu;
  if (baseMenu) {
    S.cardMenu = function (x, type, opts) {
      var items = baseMenu(x, type, opts) || [];
      var extra = hideItems(x, type);
      return extra.length ? items.concat(['sep'], extra) : items;
    };
  }
  UI.hideItems = hideItems;

  // MARK: detailpagina van een geblokkeerde titel (ook via een deeplink of zoeken)

  var baseTitle = S.pages && S.pages.title;
  if (baseTitle) {
    S.pages.title = function (r) {
      var type = r.parts[1] === 'series' ? 'series' : 'movie', id = r.parts[2] || '';
      var sid = r.query && r.query.s ? r.query.s : (Lib.source ? Lib.source.id : '');
      var key = X.titleKey(sid, type, id);
      if (!id || !D.inSet('blockedTitles', key)) return baseTitle(r);
      var p = prof();
      var el = h('div.page.detail', [h('div.state', [U.icon('eyeOff', 'state-ic'), h('h2', L('This title is hidden for this profile')),
        h('div.dlg-buttons', [
          U.button(L('Unblock'), function () { guard(p, function () { setFor(p, 'blockedTitles', key, false); R.go(location.hash.slice(1), true); }); }),
          U.button(L('Back'), function () { if (history.length > 1) history.back(); else R.go('/home', true); }, { primary: true })
        ])])]);
      return { el: el, title: L('Hidden') };
    };
  }

  // MARK: Instellingen

  /** Naam van een sleutel uit de lijsten (zender of titel), ook als hij verborgen is (ongefilterde bibliotheek). */
  function nameOf(key) {
    var p = X.parseKey(key);
    if (!p) return key;
    var raw = Lib.source && lower(Lib.source.id) === p.sid ? Lib.raw : null;
    if (raw) {
      var list = p.kind === 'movie' ? raw.movies : p.kind === 'series' ? raw.series : raw.channels;
      for (var i = 0; i < (list || []).length; i++) if (String(list[i].id) === p.item) return B.chanName ? (p.kind ? B.showName(list[i].title) : B.chanName(list[i].name)) : (list[i].title || list[i].name);
    }
    var m = B.xs && B.xs.meta ? B.xs.meta(p.sid + '|' + p.item) : null;
    if (m && (m.title || m.name)) return m.title || m.name;
    var src = D.sourceById ? D.sourceById(p.sid) : null;
    return p.item + (src ? ' (' + src.name + ')' : '');
  }
  function listSheet(target, field) {
    var isCh = field === 'hiddenChannels';
    var body = h('div.wn-sheet');
    var dlg = U.modal({ title: (isCh ? L('Hidden channels') : L('Blocked titles')) + (target && !D.isMain(target) ? ' · ' + target.name : ''), body: body, cls: 'wn-dlg', buttons: [{ label: L('Close') }] });
    function draw() {
      U.clear(body);
      var keys = (D.setListFor ? D.setListFor(target.id, field) : D.setList(field)).slice().sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b)); });
      if (!keys.length) { body.appendChild(h('p.muted', isCh ? L('No hidden channels. Hide a channel with a long press or right-click → Hide channel.') : L('No blocked titles. Hide a movie or series with a long press or right-click → Hide for this profile.'))); return; }
      var list = h('div.limit-list');
      keys.forEach(function (k) {
        var p = X.parseKey(k);
        var b = U.button(isCh ? L('Show again') : L('Unblock'), function () {
          guard(target, function () { setFor(target, field, k, false); setTimeout(draw, 80); });
        }, { cls: 'small' });
        list.appendChild(h('div.limit-row', [U.icon(isCh ? 'tv' : (p && p.kind === 'series' ? 'stack' : 'play')), h('div.limit-info', [h('div', nameOf(k)),
          p && p.kind ? h('div.muted.small', p.kind === 'series' ? L('Series') : L('Movie')) : null]), b]));
      });
      body.appendChild(list);
    }
    draw();
    return dlg;
  }

  UI.settings = function (tab, section, row, render, p, main) {
    if (tab === 'playback') {
      var sec = section(L('Are you still watching?'), L('After 3 episodes in a row without using the controls, or after a few hours of live TV or a movie without any input, Bingr asks if you are still watching. Without an answer it pauses after 60 seconds and frees the stream. Applies to this device.'));
      var on = D.local('stillWatching', true) !== false;
      row(sec, L('Ask if you are still watching'), null, function () { D.setLocal('stillWatching', !on); render(); }, { toggle: on });
      if (on) {
        var hrs = X.hours(D.local('stillWatchingHours', X.DEFAULT_HOURS));
        row(sec, L('Live TV and movies: ask after'), L('%d hours', hrs), function () {
          U.choose(L('Ask after'), X.HOUR_CHOICES.map(function (n) { return { value: n, label: L('%d hours', n) }; }), hrs, function (v) { D.setLocal('stillWatchingHours', X.hours(v)); render(); });
        }, { icon: 'clock' });
      }
    } else if (tab === 'profiles' && p) {
      var s2 = section(L('Hidden for this profile'), L('Hidden channels and blocked titles do not appear in Live TV, the guide, search, rows, Continue watching or My List of this profile.'));
      row(s2, L('Hidden channels'), String(D.setList('hiddenChannels').length), function () { listSheet(p, 'hiddenChannels'); }, { icon: 'tv' });
      row(s2, L('Blocked titles'), String(D.setList('blockedTitles').length), function () { listSheet(p, 'blockedTitles'); }, { icon: 'eyeOff' });
      if (main) {
        kidsProfiles().forEach(function (k) {
          if (p && lower(k.id) === lower(p.id)) return;
          var s3 = section(L('Kids profile: %@', k.name), D.pinFor(D.mainProfile()) ? L('Changes ask for the PIN of the main profile.') : null);
          row(s3, L('Hidden channels'), String(D.setListFor(k.id, 'hiddenChannels').length), function () { guard(k, function () { listSheet(k, 'hiddenChannels'); }); }, { icon: 'tv' });
          row(s3, L('Blocked titles'), String(D.setListFor(k.id, 'blockedTitles').length), function () { guard(k, function () { listSheet(k, 'blockedTitles'); }); }, { icon: 'eyeOff' });
        });
      }
    } else if (tab === 'about') {
      var s4 = section(L('Privacy'), L('If Bingr crashes or hits an error, it sends a short report to Bingr (no third party): app version, browser, the error and where in the code it happened. Web addresses, IP addresses, e-mail addresses and keys are removed first. Reports are deleted after 90 days.'));
      var cr = D.local('crashReports', true) !== false;
      row(s4, L('Share crash reports'), null, function () { D.setLocal('crashReports', !cr); if (cr && B.crash) B.crash.clear(); render(); }, { toggle: cr });
    }
  };
  void A;
})();
