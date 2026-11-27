/*
 * Build 176 (versie 1.0.8): onderdelen van de webspeler rond de pure logica in build176.js. Contract: docs/ACCOUNT.md
 * van iptv-ios-appletv, sectie "Build 176".
 * - Automatisch volgende aflevering per profiel (Instellingen > Afspelen; de aftelknop zelf zit in player.js).
 * - Vergrendelen met pincode (lockedChannels / lockedTitles): contextmenu, slotje op kaarten, pincode bij openen
 *   (speler, zappen, detailpagina), 4 uur open op dit apparaat, overzicht in Instellingen > Profielen.
 * - Nieuw en populair (#/new): Binnenkort, Nieuwe seizoenen en Populair (TMDB via de bestaande route), belletje =
 *   herinnering met kind "release" in de state-section `reminders`; "Nu beschikbaar" als de titel op je server staat.
 * - Zoeken in programmabeschrijvingen: index op de achtergrond (in stukjes), sectie "In de tv-gids" bij Zoeken en in de
 *   zoekfunctie van de tv-gids, met het gevonden woord gemarkeerd.
 * - Data besparen op een mobiel netwerk (hls.js-niveau, geen live voorbeeld, trailers of voorvertoning).
 * - Voorvertoning op een titel (hover of focus 2 s op een poster, en in de hero), helpcentrum, kleine animaties.
 */
(function () {
  'use strict';
  var B = window.B;
  var U = B.ui, D = B.data, Lib = B.lib, S = B.screens, A = B.account, P = B.b176, X171 = B.b171;
  var h = U.h, R = U.router;
  var L = function () { return B.L.apply(null, arguments); };
  var UI = B.b176ui = {};
  var lower = function (s) { return String(s == null ? '' : s).toLowerCase(); };

  function prof() { return B.app && B.app.profile; }

  // MARK: data besparen (per apparaat)

  UI.dataMode = function () { return P.normalizeDataMode(D.local('dataMode', 'auto')); };
  UI.saver = function () { var n = P.network(navigator); return P.isSaver(UI.dataMode(), n.net, n.constrained); };
  /** Live voorbeeld, trailers en voorvertoning vanzelf: niet bij data besparen. */
  UI.autoVideoOK = function () { return !UI.saver(); };
  var liveHls = [];
  function capHls(hls) {
    try {
      var lv = (hls.levels || []).map(function (l) { return { bandwidth: l.bitrate, height: l.height || null }; });
      var i = P.pickVariant(lv, UI.saver());
      if (i == null) { hls.autoLevelCapping = -1; return; }
      hls.autoLevelCapping = i;
      if (hls.currentLevel > i) hls.nextLevel = i;
    } catch (e) { /* stil */ }
  }
  UI.tuneHls = function (hls, Hls) {
    if (UI.saver()) { hls.config.startLevel = 0; }
    hls.on(Hls.Events.MANIFEST_PARSED, function () { capHls(hls); if (UI.saver()) { var i = hls.autoLevelCapping; if (i >= 0) hls.startLevel = i; } });
    hls.on(Hls.Events.DESTROYING, function () { liveHls = liveHls.filter(function (x) { return x !== hls; }); });
    liveHls.push(hls);
  };
  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && conn.addEventListener) conn.addEventListener('change', function () { liveHls.forEach(capHls); if (UI.saver()) stopPreview(); });

  // MARK: vergrendelen met pincode

  function sidOf(x) {
    if (x && x._key) { var bar = String(x._key).indexOf('|'); if (bar > 0) return String(x._key).slice(0, bar); }
    var s = (x && x._src) || Lib.source;
    return s ? s.id : '';
  }
  function itemOf(x) {
    if (x && x._key) { var k = String(x._key), bar = k.indexOf('|'); return bar > 0 ? k.slice(bar + 1) : String(x.id); }
    return String(x && x.id);
  }
  /** Sleutel in lockedChannels/lockedTitles (zelfde vorm als hiddenChannels/blockedTitles). */
  UI.lockKey = function (x, type) {
    if (!x) return null;
    return type === 'channel' ? X171.channelKey(sidOf(x), itemOf(x)) : X171.titleKey(sidOf(x), type, itemOf(x));
  };
  function fieldFor(type) { return type === 'channel' ? 'lockedChannels' : 'lockedTitles'; }
  function hasMainPin() { var m = D.mainProfile(); return !!(m && D.pinFor(m)); }
  function unlockedMap() { return P.pruneUnlocked(D.local('unlocked', {}) || {}, Date.now()); }
  function setUnlocked(key) { var m = unlockedMap(); m[lower(key)] = Date.now(); D.setLocal('unlocked', m); }
  UI.isLocked = function (x, type) {
    if (!x || x.external || !D.inSet || (type !== 'channel' && type !== 'movie' && type !== 'series')) return false;
    return D.inSet(fieldFor(type), UI.lockKey(x, type));
  };
  /** Moet openen nu de pincode vragen? */
  function asksKey(field, key) {
    if (!key || !D.inSet(field, key)) return false;
    var at = unlockedMap()[lower(key)];
    return P.lockAsks(true, hasMainPin(), at ? at / 1000 : null, Date.now() / 1000);
  }
  function askMainPin(onOK, onCancel) {
    var main = D.mainProfile();
    var done = false;
    var dlg = U.askPIN(L('Enter PIN'), function (v) { return D.checkPin(main, v); }, function () { done = true; onOK(); }, S.avatar(main, 'pinav'), { profile: main });
    if (onCancel && dlg && dlg.el) {
      var obs = new MutationObserver(function () { if (!document.body.contains(dlg.el)) { obs.disconnect(); if (!done) onCancel(); } });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }
  /** Openen met de pincode als dat moet (field + key); daarna 4 uur open op dit apparaat. */
  UI.gate = function (field, key, go, cancel) {
    if (!asksKey(field, key)) { go(); return; }
    askMainPin(function () { setUnlocked(key); go(); }, cancel);
  };
  UI.gateChannel = function (ch, go, cancel) { UI.gate('lockedChannels', UI.lockKey(ch, 'channel'), go, cancel); };
  /** Sleutel van een speler-item: zender (live/terugkijken), film, of de serie van een aflevering. */
  function itemLock(item) {
    if (!item) return null;
    var src = item._src || (item.channel && item.channel._src) || Lib.source, sid = src ? src.id : '';
    if (item.channel) return { field: 'lockedChannels', key: X171.channelKey(item.channel._key ? sidOf(item.channel) : sid, itemOf(item.channel)) };
    if (item.type === 'movie') return { field: 'lockedTitles', key: X171.titleKey(sid, 'movie', item.id) };
    if (item.type === 'episode' && item.seriesID != null) return { field: 'lockedTitles', key: X171.titleKey(sid, 'series', item.seriesID) };
    return null;
  }
  var baseOpen = B.player.open;
  B.player.open = function (item, ctx) {
    var lk = itemLock(item);
    // opnieuw openen vanuit de speler (Vanaf het begin, volgende aflevering) is al ontgrendeld
    if (!lk || B.player.current) return baseOpen.apply(this, arguments);
    var self = this, args = arguments, ret;
    UI.gate(lk.field, lk.key, function () { ret = baseOpen.apply(self, args); });
    return ret;
  };

  function setLock(p, field, key, on) {
    if (!p) return;
    if (D.toggleSetFor) D.toggleSetFor(p.id, field, key, on); else D.toggleSet(field, key, on);
    setTimeout(refreshMarks, 60);
  }
  function lockItems(x, type) {
    if (!x || x.external || (type !== 'channel' && type !== 'movie' && type !== 'series')) return [];
    var p = prof(), key = UI.lockKey(x, type), field = fieldFor(type);
    if (D.inSet(field, key)) {
      return [{ icon: 'unlock', label: L('Unlock'), fn: function () { askMainPin(function () { setLock(p, field, key, false); U.toast(L('Unlocked')); }); } }];
    }
    return [{ icon: 'lock', label: L('Lock with PIN'), fn: function () {
      if (!hasMainPin()) { U.toast(L('Set a PIN for the main profile first'), 4000); return; }
      setLock(p, field, key, true);
      U.toast(L('Locked with PIN'));
    } }];
  }
  var baseMenu = S.cardMenu;
  if (baseMenu) {
    S.cardMenu = function (x, type, opts) {
      var items = baseMenu(x, type, opts) || [];
      var extra = lockItems(x, type);
      return extra.length ? items.concat(['sep'], extra) : items;
    };
  }
  UI.lockItems = lockItems;

  // detailpagina van een vergrendelde titel (ook via een deeplink, zoeken of Verder kijken)
  var baseTitle = S.pages && S.pages.title;
  if (baseTitle) {
    S.pages.title = function (r) {
      var type = r.parts[1] === 'series' ? 'series' : 'movie', id = r.parts[2] || '';
      var sid = r.query && r.query.s ? r.query.s : (Lib.source ? Lib.source.id : '');
      var key = X171.titleKey(sid, type, id);
      if (!id || !asksKey('lockedTitles', key)) return baseTitle(r);
      function open() { askMainPin(function () { setUnlocked(key); R.go(location.hash.slice(1), true); }); }
      var el = h('div.page.detail', [h('div.state', [U.icon('lock', 'state-ic'), h('h2', L('Locked with PIN')), h('p.muted', L('Enter the PIN of the main profile to open this title.')),
        h('div.dlg-buttons', [
          U.button(L('Unlock'), open, { primary: true, icon: 'unlock' }),
          U.button(L('Back'), function () { if (history.length > 1) history.back(); else R.go('/home', true); })
        ])])]);
      setTimeout(open, 60);
      return { el: el, title: L('Locked with PIN') };
    };
  }

  // MARK: kaarten (slotje, voorvertoning)

  var hoverOK = !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches);
  UI.decorateCard = function (card, imgBox, x, type) {
    if (!card || !x) return;
    card.classList.add('b176-card');
    card._b176 = { x: x, type: type, box: imgBox };
    drawLockMark(card);
    if (type !== 'channel' && hoverOK && imgBox) {
      card.addEventListener('pointerenter', function () { schedulePreview(card); });
      card.addEventListener('pointerleave', function () { cancelPreview(card); });
      card.addEventListener('focus', function () { schedulePreview(card); });
      card.addEventListener('blur', function () { cancelPreview(card); });
    }
  };
  function drawLockMark(card) {
    var d = card._b176;
    if (!d || !d.box) return;
    var old = d.box.querySelector('.b176-lock');
    var on = UI.isLocked(d.x, d.type);
    if (on && !old) d.box.appendChild(h('span.b176-lock', { title: L('Locked with PIN'), 'aria-label': L('Locked with PIN') }, [U.icon('lock')]));
    else if (!on && old) old.remove();
  }
  function refreshMarks() { Array.prototype.forEach.call(document.querySelectorAll('.b176-card'), drawLockMark); }
  B.on('profileData', B.debounce(refreshMarks, 120));

  // MARK: voorvertoning op een titel (trailer zonder geluid, telt niet als stream)

  UI.previewSetting = function () { return D.local('posterPreview', true) !== false; };
  function reducedMotion() { try { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  function kidsBlocked(x, isShow) {
    var p = prof();
    if (!p || !p.kids) return false;
    var lim = D.ageLimit(p), ar = B.ageRatings && B.ageRatings.cached(x.rawTitle || x.title, x.year, isShow);
    return !(ar && ar.age != null && lim != null && ar.age <= lim);
  }
  function allowed(x, type) {
    return P.previewAllowed({ setting: UI.previewSetting(), saver: UI.saver(), locked: UI.isLocked(x, type), kidsBlocked: kidsBlocked(x, type === 'series'),
      reducedMotion: reducedMotion(), hidden: document.hidden, playing: !!B.player.current });
  }
  var YT = 'https://www.youtube-nocookie.com';
  var pv = null, pvTimer = null, pvCard = null;
  function stopPreview() {
    clearTimeout(pvTimer); pvTimer = null; pvCard = null;
    if (!pv) return;
    var p = pv; pv = null;
    clearInterval(p.ping); clearTimeout(p.giveUp);
    window.removeEventListener('message', p.onMsg);
    p.box.classList.remove('on');
    if (p.host) p.host.classList.remove('b176-pv-on');
    setTimeout(function () { p.box.remove(); }, 400);
  }
  UI.stopPreview = stopPreview;
  /** Trailer zonder geluid in host (een kaart of de hero); zichtbaar pas als YouTube meldt dat hij speelt. */
  function playIn(host, key, cls) {
    stopPreview();
    var src = YT + '/embed/' + encodeURIComponent(key) + '?autoplay=1&mute=1&controls=0&playsinline=1&loop=1&playlist=' + encodeURIComponent(key) +
      '&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&cc_load_policy=0&enablejsapi=1&origin=' + encodeURIComponent(location.origin) + '&hl=' + encodeURIComponent(B.lang);
    var frame = h('iframe.b176-pv-frame', { src: src, title: L('Trailer'), allow: 'autoplay; encrypted-media', tabindex: '-1', 'aria-hidden': 'true', referrerpolicy: 'strict-origin-when-cross-origin' });
    var box = h('div.b176-pv' + (cls ? '.' + cls : ''), [frame]);
    var p = pv = { box: box, host: host, ping: null, giveUp: null, onMsg: null };
    function post(o) { try { frame.contentWindow.postMessage(JSON.stringify(o), YT); } catch (e) { /* stil */ } }
    p.onMsg = function (ev) {
      if (ev.source !== frame.contentWindow || ev.origin !== YT || pv !== p) return;
      var d; try { d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch (e) { return; }
      if (!d) return;
      clearInterval(p.ping);
      if (d.event === 'onError') { stopPreview(); return; }
      var state = d.event === 'onStateChange' ? d.info : (d.event === 'infoDelivery' && d.info && typeof d.info.playerState === 'number' ? d.info.playerState : null);
      if (state === 1 && !box.classList.contains('on')) { clearTimeout(p.giveUp); box.classList.add('on'); host.classList.add('b176-pv-on'); }
    };
    window.addEventListener('message', p.onMsg);
    frame.addEventListener('load', function () { var n = 0; p.ping = setInterval(function () { if (++n > 40) clearInterval(p.ping); post({ event: 'listening', id: 1, channel: 'widget' }); }, 250); });
    p.giveUp = setTimeout(function () { if (pv === p && !box.classList.contains('on')) stopPreview(); }, 12000);
    host.appendChild(box);
  }
  function schedulePreview(card) {
    var d = card._b176;
    if (!d || pvCard === card) return;
    stopPreview();
    if (!allowed(d.x, d.type) || !B.ageRatings || !B.ageRatings.trailer) return;
    pvCard = card;
    pvTimer = setTimeout(function () {
      if (pvCard !== card || !card.isConnected || !allowed(d.x, d.type)) return;
      B.ageRatings.trailer(d.x, d.type === 'series', null).then(function (t) {
        if (!t || !t.key || pvCard !== card || !card.isConnected) return;
        pvCard = card;
        playIn(d.box, t.key, 'card');
        pvCard = card;
      });
    }, P.PREVIEW_DELAY);
  }
  function cancelPreview(card) { if (pvCard === card || (pv && pv.host === (card._b176 && card._b176.box))) stopPreview(); }
  /** Home: voorvertoning in de hero (computer: achter de titel; telefoon/tablet: in de grote kaart). */
  UI.heroPreview = function (heroEl, hf) {
    stopPreview();
    if (!heroEl || !hf || !hf.item || !B.ageRatings || !B.ageRatings.trailer) return;
    var x = hf.item, type = hf.type;
    if (!allowed(x, type)) return;
    var token = {};
    heroEl._b176 = token;
    pvTimer = setTimeout(function () {
      if (heroEl._b176 !== token || !heroEl.isConnected || !allowed(x, type)) return;
      B.ageRatings.trailer(x, type === 'series', null).then(function (t) {
        if (!t || !t.key || heroEl._b176 !== token || !heroEl.isConnected || B.player.current) return;
        var host = U.isPhone() ? heroEl.querySelector('.hero-card') : heroEl.querySelector('.hero-bg');
        if (host) playIn(host, t.key, 'hero');
      });
    }, P.PREVIEW_DELAY);
  };
  B.on('playerOpened', stopPreview);
  window.addEventListener('hashchange', stopPreview);
  document.addEventListener('visibilitychange', function () { if (document.hidden) stopPreview(); });

  // MARK: zoeken in programmabeschrijvingen

  var idxCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  /** Index van de programma's van deze zenders (nu t/m 7 dagen): [{ch, p, nt, nd, chKey}], in stukjes gebouwd. */
  function guideIndex(channels) {
    var now = Date.now(), epg = Lib.raw && Lib.raw.epg;
    var c = idxCache && idxCache.get(channels);
    if (c && c.epg === epg && now - c.at < 30 * 60000) return c.p;
    var entries = [], w = P.guideWindow(now);
    var tid = B.task ? B.task.begin('guide_index') : null;
    var p = B.chunked(channels, function (ch) {
      var list = Lib.programsBetween(ch, w.from, w.to), k = UI.lockKey(ch, 'channel');
      for (var i = 0; i < list.length; i++) {
        var pr = list[i];
        entries.push({ ch: ch, p: pr, chKey: k, nt: P.norm(pr.title), nd: pr.description ? P.norm(pr.description) : '' });
      }
    }).then(function () { if (B.task) B.task.end(tid); return entries; }, function (e) { if (B.task) B.task.end(tid); if (idxCache) idxCache.delete(channels); throw e; });
    if (idxCache) idxCache.set(channels, { epg: epg, at: now, p: p });
    return p;
  }
  B.on('epg', function () { idxCache = typeof WeakMap === 'function' ? new WeakMap() : null; });
  /** Zoeken in titel en beschrijving: Promise<[{ch, p, m, words}]> (max. 100; titel eerst, dan starttijd). */
  UI.guideSearch = function (channels, q, from, to) {
    var words = P.words(q);
    if (!words.length || !channels || !channels.length) return Promise.resolve([]);
    return guideIndex(channels).then(function (entries) {
      var hits = [], now = Date.now();
      from = from || now; to = to || P.guideWindow(now).to;
      return B.chunked(entries, function (e) {
        if (e.p.end <= from || e.p.start >= to) return;
        var m = P.matchNorm(e.nt, e.nd, words);
        if (m) hits.push({ ch: e.ch, p: e.p, m: m, chKey: e.chKey, words: words });
      }).then(function () { return P.finishHits(hits, P.GUIDE_MAX); });
    });
  };
  /** Tekst met <mark> om de gevonden woorden. */
  UI.marked = function (text, words, tag) {
    var el = h(tag || 'span');
    P.highlight(text, words).forEach(function (s) { el.appendChild(s.hit ? h('mark.b176-hit', s.t) : document.createTextNode(s.t)); });
    return el;
  };
  UI.descSnippet = function (desc, words, at) {
    var sn = P.snippet(desc, at, 150);
    var el = UI.marked(sn.text, words, 'div');
    el.className = 'muted small b176-desc';
    return el;
  };
  var lastGuide = null;
  /** Sectie "In de tv-gids" voor de zoekpagina (vult zichzelf op de achtergrond), of null zonder zoekwoorden. */
  UI.searchGuide = function (q, alive) {
    var words = P.words(q);
    if (!words.length || !Lib.lib || !(Lib.lib.channels || []).length) return null;
    var box = h('section.b176-guide-hits');
    var channels = Lib.lib.channels;
    function fill(hits) {
      if (!alive()) return;
      U.clear(box);
      if (!hits.length) return;
      var parent = box.parentNode;
      if (parent) { var none = parent.querySelector('.search-none'); if (none) none.remove(); }
      box.appendChild(h('h2.row-title.grid-title', L('In the TV guide')));
      var list = h('div.b176-gh-list');
      var now = Date.now();
      hits.forEach(function (x) {
        var live = x.p.start <= now && x.p.end > now;
        var b = h('button.b176-gh' + (live ? '.live' : ''), { type: 'button' }, [
          h('div.b176-gh-logo', [U.img(x.ch.logo, 'logo', B.chanName(x.ch.name))]),
          h('div.b176-gh-t', [UI.marked(B.showName(x.p.title || ''), x.words, 'div'),
            h('div.muted.small', B.chanName(x.ch.name) + ' · ' + (live ? L('Now') : U.fmtDate(x.p.start) + ' ') + ' ' + B.fmtTime(x.p.start) + '–' + B.fmtTime(x.p.end)),
            x.m.field === 'description' ? UI.descSnippet(x.p.description, x.words, x.m.at) : null]),
          UI.isLocked(x.ch, 'channel') ? U.icon('lock', 'b176-gh-lock') : null
        ]);
        b.addEventListener('click', function () { if (S.programSheet) S.programSheet(x.ch, x.p, channels); });
        list.appendChild(b);
      });
      box.appendChild(list);
    }
    if (lastGuide && lastGuide.q === q && lastGuide.ch === channels && Date.now() - lastGuide.at < 60000) { var keep = lastGuide.hits; setTimeout(function () { fill(keep); }, 0); return box; }
    UI.guideSearch(channels, q).then(function (hits) { lastGuide = { q: q, ch: channels, hits: hits, at: Date.now() }; fill(hits); }, B.noop);
    return box;
  };

  // MARK: Binnenkort / Nieuw en populair (#/new)

  var RM = B.reminders;
  function remList(d) { return (d && (d.items || d.reminders || d.list)) || []; }
  function releaseIdFor(t) {
    var p = prof();
    return P.releaseID(t.isShow ? 'tv' : 'movie', t.id, t.season, p && !D.isMain(p) ? p.id : null);
  }
  UI.hasRelease = function (t) {
    var id = releaseIdFor(t), d = RM && RM.data();
    return remList(d).some(function (r) { return r && r.id === id; });
  };
  /** Belletje aan/uit: eerst de server lezen, dan de hele lijst terugzetten (zoals de gids en Sport). */
  UI.toggleRelease = function (t) {
    var p = prof();
    if (!p || !RM || !t.date) return Promise.resolve(null);
    var on = !UI.hasRelease(t), id = releaseIdFor(t);
    return A.getState(['reminders']).then(function (all) {
      var sec = all && all.reminders && all.reminders.data;
      var d = B.copy(sec && typeof sec === 'object' ? sec : (RM.data() || {})) || {};
      var list = remList(d).filter(function (r) {
        if (!r) return false;
        if (r.id === id) { if (!on) { d.removed = d.removed || {}; d.removed[id] = B.iso(); } return false; }
        return true;
      });
      if (on) {
        var main = D.mainProfile(), src = Lib.source;
        var it = P.releaseReminder({ mediaType: t.isShow ? 'tv' : 'movie', tmdb: t.id, season: t.season, profileID: !D.isMain(p) ? p.id : null,
          date: t.date, title: t.title, at: B.iso(), playlistID: src ? src.id : null });
        if (!D.isMain(p)) it.profileID = lower(p.id);
        void main;
        list.push(it);
        if (d.removed) delete d.removed[id];
      }
      delete d.reminders; delete d.list;
      d.items = list;
      d.updatedAt = B.iso();
      return A.putState('reminders', d).then(function (r) {
        if (r == null) return null;
        RM.replace(d);
        return on;
      });
    });
  };
  function bellButton(t, small) {
    var on = UI.hasRelease(t);
    var b = U.button(small ? '' : (on ? L('Reminder on') : L('Remind me')), function () {
      UI.toggleRelease(t).then(function (r) {
        if (r == null) { U.toast(L('Something went wrong. Please try again.')); return; }
        U.toast(r ? L('We’ll remind you on %@', dateText(t.date, true)) : L('Reminder removed'));
        var nb = bellButton(t, small);
        if (b.parentNode) b.parentNode.replaceChild(nb, b);
        if (r) UI.pop(nb);
      });
    }, { icon: 'bell', cls: (small ? 'icon-only b176-bell' : 'b176-bell') + (on ? ' on' : ''), title: on ? L('Reminder on') : L('Remind me') });
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    return b;
  }
  /** Knop op de TMDB-detailpagina: belletje (nog niet uit), of niets. */
  UI.releaseButton = function (t) {
    if (!t || !t.date || !P.releaseUpcoming(t.date, Date.now())) return null;
    return bellButton({ id: t.id, isShow: t.isShow, title: t.title, date: t.date, season: t.season || null });
  };
  function dateText(d, long) {
    try { return B.fmtDate(new Date(d + 'T12:00:00'), long ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' }).replace(/\.$/, ''); } catch (e) { return d; }
  }
  var X = B.discover, AR = B.ageRatings;
  function tmdbLang() { return X && X.tmdbLang ? X.tmdbLang() : 'en-US'; }
  function todayStr(off) {
    var d = new Date(Date.now() + (off || 0) * 86400000), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function fromTMDB(i, isShow) {
    var t = (isShow ? i.name : i.title) || i.title || i.name;
    if (!t || !i.poster_path || i.adult) return null;
    var o = isShow ? i.original_name : i.original_title;
    return { id: i.id, isShow: isShow, title: t, original: o && o !== t ? o : null, date: (isShow ? i.first_air_date : i.release_date) || null,
      poster: i.poster_path, backdrop: i.backdrop_path || null, overview: i.overview || null, kind: 'upcoming' };
  }
  var NP = { at: 0, key: '', p: null };
  /** {soon, seasons, popular} (6 uur in het geheugen per taal en profiel). */
  function loadNew() {
    var p = prof(), kids = !!(p && p.kids), key = B.lang + '|' + (p ? p.id : '') + '|' + (X ? X.region() : '');
    if (NP.p && NP.key === key && Date.now() - NP.at < 6 * 3600000) return NP.p;
    var today = todayStr(0), lang = tmdbLang();
    var soon = kids && X ? X.load('upcoming', true).then(function (list) { return list.filter(function (t) { return !t.isShow; }); })
      : AR.tmdb('/movie/upcoming', [['language', lang], ['region', X ? X.region() : 'NL'], ['page', '1']]).then(function (r) {
        return ((r && r.results) || []).map(function (i) { return fromTMDB(i, false); }).filter(function (t) { return t && (t.date || '') > today; })
          .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      }, function () { return []; });
    var popular = kids ? Promise.resolve([]) : AR.tmdb('/trending/all/week', [['language', lang]]).then(function (r) {
      return ((r && r.results) || []).filter(function (i) { return i.media_type === 'movie' || i.media_type === 'tv'; })
        .map(function (i) { var t = fromTMDB(i, i.media_type === 'tv'); if (t) t.kind = 'popular'; return t; }).filter(Boolean);
    }, function () { return []; });
    NP.key = key; NP.at = Date.now();
    NP.p = Promise.all([soon, newSeasons(), popular]).then(function (r) {
      var all = r[0].concat(r[1], r[2]);
      if (X && X.remember) X.remember(all.filter(function (t) { return !t.season; }));
      return { soon: r[0], seasons: r[1], popular: r[2] };
    }, function () { NP.p = null; return { soon: [], seasons: [], popular: [] }; });
    return NP.p;
  }
  /** Series uit Mijn lijst en Verder kijken met een nieuw seizoen in de komende 60 dagen. */
  function newSeasons() {
    var lib = Lib.lib, out = [], seen = {};
    if (!lib || !lib.series) return Promise.resolve([]);
    var cands = [];
    lib.series.forEach(function (s) { if (cands.length < 30 && S.inMyList && S.inMyList(s) && !seen[s.id]) { seen[s.id] = 1; cands.push(s); } });
    var byTitle = {};
    lib.series.forEach(function (s) { if (!byTitle[s.title]) byTitle[s.title] = s; });
    D.progressList().forEach(function (pe) { var s = byTitle[pe.e.title]; if (s && !seen[s.id] && cands.length < 30) { seen[s.id] = 1; cands.push(s); } });
    var today = todayStr(0), max = todayStr(P.NEW_SEASON_DAYS), lang = tmdbLang();
    return Promise.all(cands.map(function (s) {
      return AR.lookup(s, true).then(function (r) {
        if (!r || r.found === false || r.id == null) return null;
        return AR.tmdb('/tv/' + r.id, [['language', lang]]).then(function (f) {
          if (!f) return null;
          var nx = f.next_episode_to_air, season = null, date = null;
          if (nx && nx.air_date && nx.air_date > today && nx.air_date <= max && nx.episode_number === 1) { season = nx.season_number; date = nx.air_date; }
          (f.seasons || []).forEach(function (se) { if (!date && se.air_date && se.air_date > today && se.air_date <= max && se.season_number > 0) { season = se.season_number; date = se.air_date; } });
          if (!date) return null;
          return { id: r.id, isShow: true, title: (f.name || s.title), date: date, season: season, poster: f.poster_path || null, overview: f.overview || null, kind: 'season', local: s };
        });
      }).catch(function () { return null; });
    })).then(function (list) { list.forEach(function (t) { if (t) out.push(t); }); return out.sort(function (a, b) { return a.date < b.date ? -1 : 1; }); });
  }
  function libraryHit(t) {
    if (t.local) return t.local;
    return B.details && B.details.match ? B.details.match({ title: t.title, original: t.original, year: t.date ? B.int(t.date.slice(0, 4)) : null, isShow: t.isShow }) : null;
  }
  function newCard(t) {
    var type = t.isShow ? 'series' : 'movie';
    var hit = t.kind !== 'season' ? libraryHit(t) : null;
    var href = hit ? S.titleLink(type, hit) : '#/title/' + type + '/' + (X ? X.externalID(t.id, t.isShow) : '');
    var upcoming = t.date && P.releaseUpcoming(t.date, Date.now());
    var badge = hit ? h('span.card-badge.b176-now', L('Available now'))
      : (t.date && t.kind !== 'popular' ? h('span.card-badge', t.season ? L('Season %d', t.season) + ' · ' + dateText(t.date) : dateText(t.date)) : null);
    var img = h('div.card-img', [U.img(t.poster ? 'https://image.tmdb.org/t/p/w342' + t.poster : null, 'poster', t.title), badge]);
    var card = h('div.b176-new-card', [h('a.card', { href: href, 'aria-label': t.title }, [img, h('div.card-title', t.title)]),
      !hit && upcoming ? bellButton(t, true) : null]);
    return card;
  }
  S.pages['new'] = function () {
    var el = h('div.page.b176-new', [h('div.page-head', [h('h1', L('New & Popular'))])]);
    var body = h('div', [h('div.state', [U.spinner()])]);
    el.appendChild(body);
    var pg = { el: el, title: L('New & Popular') }, alive = true;
    pg.destroy = function () { alive = false; };
    function draw(r) {
      if (!alive) return;
      U.clear(body);
      var any = false;
      [['soon', L('Coming soon')], ['seasons', L('New seasons')], ['popular', L('Popular')]].forEach(function (s) {
        var list = r[s[0]] || [];
        if (!list.length) return;
        any = true;
        body.appendChild(h('h2.row-title.grid-title', s[1]));
        body.appendChild(U.grid(list.slice(0, 40), newCard, 'posters'));
      });
      if (!any) body.appendChild(h('div.state', [U.icon('sparkle', 'state-ic'), h('p.muted', AR.hasKey() ? L('Nothing new right now.') : L('Add a server to see what’s coming.'))]));
    }
    if (!AR || !AR.hasKey()) draw({});
    else loadNew().then(draw, function () { draw({}); });
    var off = B.on('reminders', function () { if (!alive) { off(); return; } if (NP.p) NP.p.then(draw); });
    var destroy = pg.destroy;
    pg.destroy = function () { destroy(); off(); };
    return pg;
  };
  if (S.navOwner) S.navOwner['new'] = 'new';

  // MARK: kleine animaties (belletje, vinkje Gezien, slot, bladwijzer)

  UI.pop = function (el) {
    if (!el || reducedMotion()) return;
    var ic = el.querySelector ? (el.querySelector('.ic') || el) : el;
    ic.classList.remove('b176-anim');
    void ic.getBoundingClientRect();
    ic.classList.add('b176-anim');
    setTimeout(function () { ic.classList.remove('b176-anim'); }, 700);
  };
  var ANIM = /\bic-(bell|checkCircle|checkCircleFill|lock|unlock|bookmark|heart|starFill|star)\b/;
  // knoppen tekenen zich na een klik vaak opnieuw: na de klik de knop op dezelfde plek opzoeken en zijn icoon animeren
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button') : null;
    var ic = b && b.querySelector('svg.ic');
    if (!ic || !ANIM.test(ic.getAttribute('class') || '')) return;
    var x = e.clientX, y = e.clientY;
    if (!x && !y) { var rc = b.getBoundingClientRect(); x = rc.left + rc.width / 2; y = rc.top + rc.height / 2; }
    setTimeout(function () {
      var at = document.elementFromPoint(x, y), nb = at && at.closest ? at.closest('button') : null;
      var target = nb || (b.isConnected ? b : null);
      if (target) UI.pop(target);
    }, 30);
  }, true);

  // MARK: Instellingen

  var TABS = S.settingsTabs;
  if (TABS && !TABS.some(function (t) { return t[0] === 'help'; })) {
    var at = -1;
    TABS.forEach(function (t, i) { if (t[0] === 'support') at = i; });
    TABS.splice(at >= 0 ? at : TABS.length, 0, ['help', 'Help centre', 'help']);
    TABS.forEach(function (t) { if (t[0] === 'support') t[2] = 'mail'; });
  }
  function openHelp() {
    var url = P.helpURL(B.lang);
    var w = null;
    try { w = window.open(url, 'bingr-help', U.isPhone() ? 'noopener' : 'noopener,popup,width=980,height=820'); } catch (e) { w = null; }
    if (!w && !B.isWindowsApp) { try { window.open(url, '_blank', 'noopener'); } catch (e2) { /* stil */ } }
  }
  UI.openHelp = openHelp;
  function lockName(key) {
    var p = X171.parseKey(key);
    if (!p) return key;
    var raw = Lib.source && lower(Lib.source.id) === p.sid ? Lib.raw : null;
    if (raw) {
      var list = p.kind === 'movie' ? raw.movies : p.kind === 'series' ? raw.series : raw.channels;
      for (var i = 0; i < (list || []).length; i++) if (String(list[i].id) === p.item) return p.kind ? B.showName(list[i].title) : B.chanName(list[i].name);
    }
    var m = B.xs && B.xs.meta ? B.xs.meta(p.sid + '|' + p.item) : null;
    if (m && (m.title || m.name)) return m.title || m.name;
    var src = D.sourceById ? D.sourceById(p.sid) : null;
    return p.item + (src ? ' (' + src.name + ')' : '');
  }
  function lockedSheet(target) {
    var body = h('div.wn-sheet');
    U.modal({ title: L('Locked') + (target && !D.isMain(target) ? ' · ' + target.name : ''), body: body, cls: 'wn-dlg', buttons: [{ label: L('Close') }] });
    function draw() {
      U.clear(body);
      var keys = [];
      ['lockedChannels', 'lockedTitles'].forEach(function (f) { D.setListFor(target.id, f).forEach(function (k) { keys.push({ f: f, k: k }); }); });
      keys.sort(function (a, b) { return lockName(a.k).localeCompare(lockName(b.k)); });
      if (!keys.length) { body.appendChild(h('p.muted', L('Nothing is locked. Lock a channel, movie or series with a long press or right-click → Lock with PIN.'))); return; }
      var list = h('div.limit-list');
      keys.forEach(function (e) {
        var p = X171.parseKey(e.k);
        var b = U.button(L('Unlock'), function () { askMainPin(function () { setLock(target, e.f, e.k, false); setTimeout(draw, 80); }); }, { cls: 'small' });
        list.appendChild(h('div.limit-row', [U.icon(e.f === 'lockedChannels' ? 'tv' : (p && p.kind === 'series' ? 'stack' : 'play')), h('div.limit-info', [h('div', lockName(e.k)),
          h('div.muted.small', e.f === 'lockedChannels' ? L('Channel') : (p && p.kind === 'series' ? L('Series') : L('Movie')))]), b]));
      });
      body.appendChild(list);
    }
    draw();
  }
  function lockedCount(p) { return D.setListFor(p.id, 'lockedChannels').length + D.setListFor(p.id, 'lockedTitles').length; }

  UI.settings = function (tab, section, row, render, p, main, list) {
    if (tab === 'playback') {
      var sec = section(L('Episodes'));
      var v = D.autoplayNext ? D.autoplayNext() : null, on = P.autoplayStarts(v, !!(p && p.kids), false);
      row(sec, L('Play next episode automatically'), null, function () { D.setAutoplayNext(!on); render(); },
        { toggle: on, icon: 'next', sub: L('For this profile. When off, the Next episode button stays but doesn’t count down.') });
      var sec2 = section(L('Data and previews'), L('Data saver: lowest quality up to 1.5 Mbit/s, no live preview, no trailers or previews playing by themselves. Applies to this device; on Wi-Fi nothing changes.'));
      var dm = UI.dataMode(), labels = { auto: L('Automatic'), saver: L('Data saver'), max: L('Highest quality') };
      row(sec2, L('On cellular'), labels[dm], function () {
        U.choose(L('On cellular'), P.DATA_MODES.map(function (k) { return { value: k, label: labels[k] }; }), dm, function (nv) {
          D.setLocal('dataMode', P.normalizeDataMode(nv)); liveHls.forEach(capHls); if (UI.saver()) stopPreview(); render();
        });
      }, { icon: 'chart' });
      var pvOn = UI.previewSetting();
      row(sec2, L('Previews'), null, function () { D.setLocal('posterPreview', !pvOn); if (pvOn) stopPreview(); render(); },
        { toggle: pvOn, icon: 'trailer', sub: L('Hover over or focus a poster for 2 seconds to play the trailer without sound. Not with data saver on cellular.') });
    } else if (tab === 'profiles' && p) {
      var s2 = section(L('Locked with PIN'), hasMainPin() ? L('Locked channels and titles stay visible with a lock. Opening them asks for the PIN of the main profile; after that they stay open for 4 hours on this device.')
        : L('Set a PIN for the main profile first'));
      row(s2, L('Locked'), String(lockedCount(p)), function () { lockedSheet(p); }, { icon: 'lock' });
      if (main) {
        (D.profiles || []).filter(function (k) { return k.kids && lower(k.id) !== lower(p.id); }).forEach(function (k) {
          row(s2, L('Locked') + ' · ' + k.name, String(lockedCount(k)), function () { lockedSheet(k); }, { icon: 'lock' });
        });
      }
    } else if (tab === 'help') {
      var s3 = section(L('Help centre'), L('Articles about signing in, linking your TV, your playlist, profiles, installing and watching in your browser. Opens support.bingr.online in a new window.'));
      row(s3, L('Open the help centre'), null, openHelp, { icon: 'help' });
      row(s3, L('Contact support'), null, function () { location.hash = '#/support'; }, { icon: 'mail' });
    }
    void list;
    return null;
  };
})();
