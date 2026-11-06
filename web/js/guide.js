/*
 * Build 164: tv-gids in NL-Ziet-stijl (#/guide), vanuit Live TV (knop Tv-gids).
 *   - Breed (iPad, Mac, web, Windows): titel, dagpillen en zoeken; groot live voorbeeld van de gekozen zender met
 *     "nu", tijden, "nog N min", "daarna", voortgang, Kijk live en Vanaf het begin; daaronder zenderkolommen
 *     (horizontaal scrollen, lazy) met NU als blok in de accentkleur. Kolomkop = zender kiezen, programma = programmablad.
 *   - Smal (telefoon): live vak 16:9 bovenaan (tik = volledig scherm met dezelfde stream), het programma van nu, links
 *     een strook met zenderlogo's, rechts de dagregel en de programmalijst (scrolt naar NU). Dag via het kalendericoon.
 * Live voorbeeld (B.guidePreview): hooguit één tegelijk, zonder geluid en ondertitels, via stream_start met kind
 * "preview" (telt mee voor de streamlimiet, niet voor de statistieken); niet voor Verder kijken, Trakt of de
 * geschiedenis (de speler wordt niet gebruikt). Lukt het niet, dan stil het stilstaande beeld (B.guideStills) of het logo.
 * Herinneringen (B.reminders): state-section `reminders` volgens docs/ACCOUNT.md ("Herinneringen per profiel").
 * Pure logica in guidelogic.js.
 */
(function () {
  'use strict';
  var B = window.B;
  var U = B.ui, D = B.data, A = B.account, Lib = B.lib, S = B.screens, G = B.guideLogic;
  var h = U.h, R = U.router;
  var L = function () { return B.L.apply(null, arguments); };

  function srcOf(ch) { return (ch && ch._src) || Lib.source; }
  function chKey(ch) { var s = srcOf(ch); return G.stillKey(s ? s.id : '', ch.id); }
  function pct(p, now) { return (G.progress(p, now || Date.now()) * 100) + '%'; }

  // MARK: instelling "Live voorbeeld in de gids" (per browser)

  B.guideSetting = {
    get: function () { return G.normalizeMode(D.local('guidePreview', 'wifi')); },
    set: function (v) { D.setLocal('guidePreview', G.normalizeMode(v)); },
    /** 'auto' | 'tap' | 'off' voor dit apparaat nu. */
    mode: function () { return G.previewMode(B.guideSetting.get(), G.network(navigator), false); },
    label: function (v) { return { always: L('Always'), wifi: L('Wi-Fi only'), never: L('Never') }[G.normalizeMode(v)]; }
  };

  // MARK: stilstaande beelden (IndexedDB, hooguit 200 zenders, 30 min)

  var ST = B.guideStills = {};
  var stIndex = B.store.get('guideStills', null) || {};   // {sleutel: tijd}
  var stMem = {};                                          // {sleutel: {at, d}}
  function saveIndex() { try { B.store.set('guideStills', stIndex); } catch (e) { /* stil */ } }
  /** Momentopname (jpg, ±320 breed) van een spelende <video>; lukt het niet (geen beeld, cross-origin), dan niets. */
  ST.grab = function (video, ch) {
    try {
      if (!video || !ch || !video.videoWidth || video.readyState < 2) return;
      var w = 320, hh = Math.max(1, Math.round(w * video.videoHeight / video.videoWidth));
      var c = document.createElement('canvas');
      c.width = w; c.height = hh;
      c.getContext('2d').drawImage(video, 0, 0, w, hh);
      var d = c.toDataURL('image/jpeg', 0.7);
      if (!d || d.length < 200) return;
      var k = chKey(ch), at = Date.now();
      stMem[k] = { at: at, d: d };
      stIndex[k] = at;
      B.idb.set('gstill:' + k, { at: at, d: d });
      G.pruneStills(stIndex).forEach(function (old) { delete stIndex[old]; delete stMem[old]; B.idb.del('gstill:' + old); });
      saveIndex();
      B.emit('guideStill', k);
    } catch (e) { /* tainted canvas of geen frame: overslaan */ }
  };
  /** Bruikbaar beeld (data-URL) of null; meteen uit het geheugen, anders uit IndexedDB. */
  ST.get = function (ch) {
    var k = chKey(ch), now = Date.now();
    if (!stIndex[k] || now - stIndex[k] > G.STILL_MAX_AGE) return Promise.resolve(null);
    if (stMem[k]) return Promise.resolve(G.pickStill(stMem[k], now));
    return B.idb.get('gstill:' + k).then(function (e) { if (e) stMem[k] = e; return G.pickStill(e, Date.now()); }, function () { return null; });
  };
  B.on('wipe', function () { stIndex = {}; stMem = {}; B.store.del('guideStills'); });

  // MARK: live voorbeeld (één tegelijk)

  var PV = B.guidePreview = { ch: null };
  var pv = { gen: 0, engine: null, video: null, url: null, holder: null, timer: null, ping: null, grab: null, leased: false, handing: false, muted: true };
  function clearTimers() { clearTimeout(pv.timer); clearInterval(pv.ping); clearInterval(pv.grab); pv.timer = pv.ping = pv.grab = null; }
  function setHolder(cls, on) { if (pv.holder) pv.holder.classList.toggle(cls, !!on); }
  /** Stoppen; sendStop = ook de stream afmelden (niet als de speler open is: die heeft dan de stream). */
  PV.stop = function (sendStop) {
    pv.gen++;
    clearTimers();
    if (pv.engine) { try { pv.engine.stop(); } catch (e) { /* stil */ } }
    if (pv.video && pv.video.parentNode) pv.video.parentNode.removeChild(pv.video);
    if (pv.holder) ['playing', 'buffering', 'tap'].forEach(function (c) { pv.holder.classList.remove(c); });
    if (pv.leased && sendStop && !B.player.current) A.streamStop();
    pv.leased = false;
    pv.engine = pv.video = pv.url = null;
    PV.ch = null;
  };
  PV.playing = function (ch) { return !!(pv.engine && pv.engine.started && PV.ch === ch); };
  PV.setMuted = function (m) { pv.muted = !!m; if (pv.video) pv.video.muted = pv.muted; };
  PV.muted = function () { return pv.muted; };
  /**
   * Zender in het vak `holder` laten spelen (na ±1 s). user = na een tik (ook op mobiel netwerk).
   * Speelt die zender al: alleen het beeld verplaatsen.
   */
  PV.show = function (holder, ch, user) {
    if (!holder || !ch) return;
    if (PV.ch === ch && pv.engine) {
      pv.holder = holder;
      if (pv.video && pv.video.parentNode !== holder) holder.appendChild(pv.video);
      setHolder('playing', pv.engine.started);
      return;
    }
    var keepLease = pv.leased;
    PV.stop(false);
    pv.leased = keepLease;
    pv.holder = holder;
    PV.ch = ch;
    var mode = B.guideSetting.mode();
    if (mode === 'off' || B.player.current || document.hidden) { if (pv.leased) { pv.leased = false; A.streamStop(); } return; }
    if (mode === 'tap' && !user) { setHolder('tap', true); if (pv.leased) { pv.leased = false; A.streamStop(); } return; }
    var gen = pv.gen;
    pv.timer = setTimeout(function () { begin(ch, gen); }, user ? 50 : 900);
  };
  function fail(gen) {
    if (gen !== pv.gen) return;
    var ch = PV.ch, holder = pv.holder;
    PV.stop(true);
    pv.holder = holder; PV.ch = ch;
  }
  function begin(ch, gen) {
    if (gen !== pv.gen || B.player.current) return;
    var prof = B.app.profile;
    if (!prof) return;
    var video = pv.video = h('video.gd-pv-video', { playsinline: true, 'webkit-playsinline': true, muted: true, preload: 'auto', 'aria-hidden': 'true', tabindex: '-1' });
    video.muted = pv.muted; video.defaultMuted = true;
    video.setAttribute('muted', '');
    if (pv.holder) pv.holder.appendChild(video);
    setHolder('buffering', true);
    var title = B.chanName(ch.name);
    A.streamStart(prof.id, prof.name, title, 'preview', ch.id).then(function (r) {
      if (gen !== pv.gen) return;
      if (!r || !r.ok) { fail(gen); if (r && r.activation && B.lifetime) B.lifetime.required(); return; }
      pv.leased = true;
      pv.ping = setInterval(function () {
        if (gen !== pv.gen) return;
        A.streamPing().then(function (alive) {
          if (alive === false && gen === pv.gen) A.streamStart(prof.id, prof.name, title, 'preview', ch.id).then(function (r2) { if (r2 && r2.limit) fail(gen); });
        });
      }, 30000);
    }, function () { fail(gen); });
    var item = B.player.channelItem(ch), src = srcOf(ch);
    var web = B.media && B.media.webStream ? B.media.webStream(src, item) : null;
    (web ? Promise.resolve(web) : Lib.resolveURL(item, true)).then(function (url) {
      if (gen !== pv.gen) return;
      if (!url) throw new Error('no_url');
      pv.url = url;
      var my = pv.engine = new B.player.Engine({
        buffering: function (b) { if (pv.engine === my) setHolder('buffering', b); },
        ended: function () { if (pv.engine === my) fail(gen); },
        error: function () { if (pv.engine === my) fail(gen); },
        state: B.noop, tracks: B.noop,
        needsTap: function () { if (pv.engine === my) { setHolder('buffering', false); setHolder('tap', true); } }
      }, video);
      return my.open(url, { live: true, start: 0 }).then(function () {
        if (gen !== pv.gen || pv.engine !== my) return;
        try { if (my.hls) { my.hls.subtitleDisplay = false; my.hls.subtitleTrack = -1; } } catch (e) { /* stil */ }
        video.muted = pv.muted;
        setHolder('buffering', false); setHolder('playing', true);
        setTimeout(function () { if (gen === pv.gen) ST.grab(video, ch); }, 4000);
        pv.grab = setInterval(function () { if (gen === pv.gen && !document.hidden) ST.grab(video, ch); }, 120000);
      });
    }).catch(function () { fail(gen); });
  }
  /** De lopende stream aan de speler geven ({engine, video, url}) of null; het voorbeeld laat hem los zonder te stoppen. */
  PV.handoff = function (ch) {
    if (!pv.engine || !pv.engine.started || PV.ch !== ch) return null;
    var out = { engine: pv.engine, video: pv.video, url: pv.url };
    ST.grab(pv.video, ch);
    clearTimers();
    pv.gen++;
    pv.engine = pv.video = pv.url = null;
    pv.leased = false; // de speler meldt de stream zelf aan (zelfde apparaat: hij neemt hem over)
    if (pv.holder) ['playing', 'buffering', 'tap'].forEach(function (c) { pv.holder.classList.remove(c); });
    PV.ch = null;
    return out;
  };
  /** Gewone speler met dezelfde stream (als die al speelt), anders gewoon starten. */
  PV.openPlayer = function (ch, list, fullscreen) {
    var adopt = PV.handoff(ch);
    if (!adopt) PV.stop(false);
    pv.handing = true;
    list = list || [ch];
    var idx = 0;
    for (var i = 0; i < list.length; i++) if (list[i].id === ch.id) { idx = i; break; }
    try { B.player.open(B.player.channelItem(ch), { channels: list, index: idx, adopt: adopt, fullscreen: !!fullscreen }); }
    finally { pv.handing = false; }
  };
  B.on('playerOpened', function () { if (!pv.handing) PV.stop(false); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && (pv.engine || pv.timer)) { var hl = pv.holder; PV.stop(true); pv.holder = hl; } });
  window.addEventListener('pagehide', function () { if (pv.leased && !B.player.current) A.streamStopBeacon(); });

  // MARK: herinneringen (state-section `reminders`, gedeeld met de apps)

  var RM = B.reminders = {};
  var remData = B.store.get('reminders', null);   // laatste section-data
  function remList(d) { return (d && (d.items || d.reminders || d.list)) || []; }
  function lower(v) { return String(v == null ? '' : v).toLowerCase(); }
  function remProfile(r) {
    if (r.profileID) return lower(r.profileID);
    var m = /^p:([^:]+):/.exec(String(r.id || ''));
    if (m) return lower(m[1]);
    var main = D.mainProfile();
    return main ? lower(main.id) : '';
  }
  function remId(ch, p) {
    var base = ch.id + '-' + Math.floor(p.start / 1000);
    var prof = B.app.profile;
    return prof && !D.isMain(prof) ? 'p:' + lower(prof.id) + ':' + base : base;
  }
  /** Herinnering van het actieve profiel voor dit programma? */
  RM.has = function (ch, p) {
    var prof = B.app.profile;
    if (!prof || !remData) return false;
    var id = remId(ch, p), me = lower(prof.id), st = Math.floor(p.start / 1000);
    return remList(remData).some(function (r) {
      if (!r || remProfile(r) !== me) return false;
      if (r.id === id) return true;
      return String(r.channelID) === String(ch.id) && Math.floor((B.parseISO(r.start) || 0) / 1000) === st;
    });
  };
  /** Aan/uit: eerst de server lezen, dan de hele lijst terugzetten (nieuwste wint, zoals op Android). */
  RM.toggle = function (ch, p) {
    var prof = B.app.profile, src = srcOf(ch);
    if (!prof) return Promise.resolve(null);
    var on = !RM.has(ch, p), id = remId(ch, p), me = lower(prof.id), st = Math.floor(p.start / 1000);
    return A.getState(['reminders']).then(function (all) {
      var sec = all && all.reminders && all.reminders.data;
      var d = B.copy(sec && typeof sec === 'object' ? sec : (remData || {})) || {};
      var list = remList(d).filter(function (r) {
        if (!r) return false;
        var same = r.id === id || (remProfile(r) === me && String(r.channelID) === String(ch.id) && Math.floor((B.parseISO(r.start) || 0) / 1000) === st);
        if (same && !on) { d.removed = d.removed || {}; d.removed[r.id] = B.iso(); }
        return !same;
      });
      if (on) {
        var it = { id: id, playlistID: src ? src.id : '', channelID: String(ch.id), channelName: B.chanName(ch.name), title: B.showName(p.title || ''), start: new Date(p.start).toISOString() };
        if (!D.isMain(prof)) it.profileID = me;
        list.push(it);
        if (d.removed) delete d.removed[id];
      }
      delete d.reminders; delete d.list;
      d.items = list;
      d.updatedAt = B.iso();
      return A.putState('reminders', d).then(function (r) {
        if (r == null) return null;
        remData = d; B.store.set('reminders', d); B.emit('reminders');
        return on;
      });
    });
  };
  B.on('state', function (all) {
    if (!all || !B.has(all, 'reminders')) return;
    var d = all.reminders && all.reminders.data;
    if (d && typeof d === 'object') { remData = d; B.store.set('reminders', d); B.emit('reminders'); }
  });
  B.on('wipe', function () { remData = null; B.store.del('reminders'); });

  // MARK: programmablad (kijken, terugkijken, herinnering)

  S.programSheet = function (ch, p, list) {
    var now = Date.now(), state = G.state(p, now), cu = Lib.canCatchup(ch, p);
    var body = h('div.gd-sheet');
    body.appendChild(h('div.gd-sh-head', [h('div.gd-logo', [U.img(ch.logo, 'logo', B.chanName(ch.name))]),
      h('div', [h('div.gd-sh-ch', B.chanName(ch.name)), h('div.muted.small', dayText(p.start) + ' · ' + B.fmtTime(p.start) + ' – ' + B.fmtTime(p.end))])]));
    if (state === 'now') body.appendChild(h('div.card-progress.inline', [h('div', { style: { width: pct(p, now) } })]));
    if (p.description) body.appendChild(h('p.gd-sh-desc', p.description));
    var btns = h('div.gd-sh-btns');
    var dlg = null;
    function done(fn) { return function () { if (dlg) dlg.close(); fn(); }; }
    if (state === 'now') {
      btns.appendChild(U.button(L('Watch live'), done(function () { PV.openPlayer(ch, list); }), { primary: true, icon: 'play' }));
      if (cu) btns.appendChild(U.button(L('From the start'), done(function () { PV.stop(false); B.player.playCatchup(ch, p, list); }), { icon: 'replay' }));
    } else if (state === 'past' && cu) {
      btns.appendChild(U.button(L('Watch from the start'), done(function () { PV.stop(false); B.player.playCatchup(ch, p, list); }), { primary: true, icon: 'replay' }));
    } else if (state === 'next') {
      var on = RM.has(ch, p);
      var rb = U.button(on ? L('Remove reminder') : L('Remind me'), function () {
        rb.disabled = true;
        RM.toggle(ch, p).then(function (r) {
          rb.disabled = false;
          if (r == null) { U.toast(L('Something went wrong. Please try again.')); return; }
          U.toast(r ? L('Reminder set') : L('Reminder removed'));
          if (dlg) dlg.close();
        }, function () { rb.disabled = false; U.toast(L('Something went wrong. Please try again.')); });
      }, { primary: true, icon: 'bell' });
      btns.appendChild(rb);
    }
    body.appendChild(btns);
    dlg = U.modal({ title: B.showName(p.title || ''), body: body, cls: 'sheet-dlg.gd-sheet-dlg' });
    return dlg;
  };

  function dayText(ms) {
    var off = Math.round((G.dayStart(ms) - G.dayStart(Date.now())) / 86400000);
    var k = G.dayKey(off);
    if (k) return L(k === 'yesterday' ? 'Yesterday' : k === 'today' ? 'Today' : 'Tomorrow');
    return B.fmtDate(ms, { weekday: 'short', day: 'numeric', month: 'short' }, B.lang === 'nl' ? 'nl-NL' : B.locale());
  }
  function dayLong(ms) {
    return B.fmtDate(ms, { weekday: 'long', day: 'numeric', month: 'long' }, B.lang === 'nl' ? 'nl-NL' : B.locale());
  }

  // MARK: zenders (zelfde keuzes als Live TV)

  function groups() {
    var out = [];
    if (B.xs.listTiles('favorites', 'channel').length) out.push({ key: '★', label: L('Favorites') });
    if (B.xs.listTiles('recentChannels', 'channel').length) out.push({ key: '⟲', label: L('Recent') });
    out.push({ key: '*', label: L('All channels') });
    D.collectionsFor(B.app.profile.id).forEach(function (c) { if (S.collectionChannels(c).length) out.push({ key: 'collection:' + c.id, label: c.name }); });
    Lib.lib.channelGroups.forEach(function (g) { out.push({ key: g, label: g }); });
    return out;
  }
  function channelsFor(key) {
    if (key === '★') return B.xs.listTiles('favorites', 'channel').map(function (x) { return x.item; });
    if (key === '⟲') return B.xs.listTiles('recentChannels', 'channel').map(function (x) { return x.item; });
    if (!key || key === '*') return Lib.lib.channels;
    if (key.indexOf('collection:') === 0) { var c = D.collectionById(B.app.profile.id, key.slice(11)); return c ? S.collectionChannels(c) : []; }
    return Lib.byGroup('channel')[key] || [];
  }

  /** Logo op een donker vlak met een dunne rand; geen logo = de opgeschoonde zendernaam. */
  function logoBox(ch, cls) { return h('div.gd-logo' + (cls ? '.' + cls : ''), [U.img(ch.logo, 'logo', B.chanName(ch.name))]); }

  // MARK: pagina

  S.navOwner.guide = 'live';
  S.pages.guide = function (r) {
    var el = h('div.page.guide');
    var pg = { el: el, title: L('TV guide') };
    var group = r.parts[1] || B.store.get('liveGroup', null) || '*';
    var channels = [], sel = null, dayOff = 0, days = [];
    var phone = U.isPhone();
    var heroEl = null, mediaEl = null, colsEl = null, railEl = null, listEl = null, dayLine = null, nowStrip = null, pillsEl = null;
    var cols = [], colIO = null, colsShown = 0;
    var offs = [];

    function day() { for (var i = 0; i < days.length; i++) if (days[i].offset === dayOff) return days[i]; return days[0]; }
    function progsOf(ch) { var d = day(); return Lib.programsBetween(ch, d.start, d.end); }
    function selKey() { return 'guideChannel.' + lower(B.app.profile.id); }

    function render() {
      PV.stop(true);
      if (colIO) { colIO.disconnect(); colIO = null; }
      U.clear(el);
      phone = U.isPhone();
      el.classList.toggle('phone', phone);
      if (!Lib.lib || !Lib.lib.channels.length) {
        el.appendChild(h('div.page-head', [h('h1', L('TV guide'))]));
        el.appendChild((S.stateBox && S.stateBox()) || h('div.state', [U.icon('tv', 'state-ic'), h('p.muted', L('No channels'))]));
        return;
      }
      var gl = groups();
      if (!gl.some(function (g) { return g.key === group; })) group = '*';
      channels = channelsFor(group);
      if (!channels.length) { group = '*'; channels = channelsFor('*'); }
      var want = B.store.get(selKey(), null);
      sel = null;
      if (want) for (var i = 0; i < channels.length; i++) if (chKey(channels[i]) === want) { sel = channels[i]; break; }
      if (!sel) sel = channels[0];
      // build 166: alleen dagen met gids-info (steekproef: de gekozen zender en de eerste 50); vandaag altijd
      var sample = G.daySample(channels, sel);
      days = G.availableDays(G.days(Date.now(), G.backDays(sample)), sample, function (c, d) { return Lib.programsBetween(c, d.start, d.end).length > 0; });
      if (!days.some(function (d) { return d.offset === dayOff; })) dayOff = 0;
      var sl = h('select.lv-select.gd-group', { 'aria-label': L('Categories') });
      gl.forEach(function (g) { var o = h('option', { value: g.key }, g.label); if (g.key === group) o.selected = true; sl.appendChild(o); });
      sl.addEventListener('change', function () { group = sl.value; B.store.set('liveGroup', group); render(); });
      var searchBtn = U.button('', openSearch, { icon: 'search', cls: 'icon-only gd-ib', title: L('Search the TV guide') });
      // build 165: de knop wisselt naar de lijst (alleen zolang je in Live TV bent; Live TV opent altijd in de gids)
      var toList = function () { R.go(G.liveLink(group, 'list').slice(1)); };
      var listBtn = U.button(L('Channels'), toList, { icon: 'list', cls: 'gd-listbtn' });
      if (phone) {
        var dayBtn = U.button('', chooseDay, { icon: 'guide', cls: 'icon-only gd-ib', title: L('Choose a day') });
        el.appendChild(h('div.gd-top', [h('h1', L('TV guide')), h('div.gd-top-r', [sl, searchBtn, dayBtn, U.button('', toList, { icon: 'list', cls: 'icon-only gd-ib', title: L('Channels') })])]));
        buildPhone();
      } else {
        pillsEl = h('div.gd-days', { role: 'tablist', 'aria-label': L('Choose a day') });
        drawPills();
        el.appendChild(h('div.gd-top', [h('h1', L('TV guide')), pillsEl, h('div.gd-top-r', [sl, searchBtn, listBtn])]));
        buildWide();
      }
    }

    // MARK: dagen
    function drawPills() {
      if (!pillsEl) return;
      U.clear(pillsEl);
      days.forEach(function (d) {
        var b = h('button.gd-day' + (d.offset === dayOff ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': d.offset === dayOff ? 'true' : 'false' }, dayText(d.start + 3600000));
        b.addEventListener('click', function () { setDay(d.offset); });
        pillsEl.appendChild(b);
      });
      var on = pillsEl.querySelector('.on');
      if (on) setTimeout(function () { try { on.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) { /* stil */ } }, 0);
    }
    function setDay(o) {
      dayOff = o;
      drawPills();
      if (phone) { drawDayLine(); drawList(true); } else drawCols(true);
    }
    function chooseDay() {
      U.choose(L('Choose a day'), days.map(function (d) { return { value: d.offset, label: dayText(d.start + 3600000), sub: dayLong(d.start + 3600000) }; }), dayOff, function (v) { setDay(+v); });
    }

    // MARK: live vak (beide indelingen)
    function mediaBox(cls) {
      var box = h('div.gd-pv' + (cls ? '.' + cls : ''));
      var still = h('div.gd-pv-still');
      var tapB = h('button.gd-pv-tap', { type: 'button' }, [U.icon('play'), h('span', L('Tap to watch live'))]);
      tapB.addEventListener('click', function (e) { e.stopPropagation(); PV.show(box, sel, true); });
      var badge = h('div.gd-pv-badge', [h('div.gd-logo.tiny', [U.img(sel.logo, 'logo', B.chanName(sel.name))]), h('span.gd-live', L('LIVE'))]);
      var chip = h('span.gd-pv-chip', L('Live picture · muted'));
      var muteB = U.button('', function () { PV.setMuted(!PV.muted()); drawMute(); }, { icon: 'mute', cls: 'gd-pv-btn gd-pv-mute' });
      var fullB = U.button('', function () { PV.openPlayer(sel, channels, true); }, { icon: 'full', cls: 'gd-pv-btn gd-pv-full', title: L('Full screen') });
      function drawMute() {
        U.clear(muteB); muteB.appendChild(U.icon(PV.muted() ? 'mute' : 'volume'));
        var t = PV.muted() ? L('Sound on') : L('Sound off');
        muteB.title = t; muteB.setAttribute('aria-label', t);
        chip.style.display = PV.muted() ? '' : 'none';
      }
      drawMute();
      box.appendChild(still);
      box.appendChild(h('div.gd-pv-spin', [U.spinner()]));
      box.appendChild(badge); box.appendChild(chip); box.appendChild(tapB);
      box.appendChild(h('div.gd-pv-btns', [muteB, fullB]));
      box.setAttribute('role', 'button');
      box.setAttribute('tabindex', '0');
      box.setAttribute('aria-label', L('Watch %@', B.chanName(sel.name)));
      box.addEventListener('click', function () { if (box.classList.contains('tap')) { PV.show(box, sel, true); return; } PV.openPlayer(sel, channels, phone); });
      box.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); PV.openPlayer(sel, channels, true); } });
      box._still = still;
      return box;
    }
    function drawStill(box, ch) {
      var still = box._still;
      U.clear(still);
      still.appendChild(h('div.gd-pv-logo', [logoBox(ch, 'big')]));
      ST.get(ch).then(function (d) {
        if (!d || box._ch !== ch) return;
        U.clear(still);
        still.appendChild(h('img.gd-pv-img', { src: d, alt: '' }));
      });
    }
    function startPreview() {
      if (!mediaEl || !sel) return;
      mediaEl._ch = sel;
      drawStill(mediaEl, sel);
      PV.show(mediaEl, sel, false);
    }
    function pick(ch) {
      if (sel === ch) return;
      sel = ch;
      B.store.set(selKey(), chKey(ch));
      if (phone) { rebuildPhoneTop(); drawRailSel(); drawList(true); }
      else { drawHero(); drawColSel(); }
    }

    // MARK: breed (iPad, Mac, web)
    function buildWide() {
      heroEl = h('section.gd-hero');
      el.appendChild(heroEl);
      colsEl = h('div.gd-cols', { role: 'list' });
      el.appendChild(colsEl);
      drawHero();
      drawCols(true);
    }
    function drawHero() {
      if (!heroEl) return;
      U.clear(heroEl);
      mediaEl = mediaBox();
      var info = h('div.gd-hero-info');
      heroEl.appendChild(mediaEl);
      heroEl.appendChild(info);
      fillHeroInfo(info);
      heroEl._info = info;
      startPreview();
    }
    function fillHeroInfo(info) {
      U.clear(info);
      var now = Date.now(), nn = Lib.nowNext(sel);
      info.appendChild(h('div.gd-hero-ch', L('%@ · now', B.chanName(sel.name))));
      if (nn.now) {
        info.appendChild(h('div.gd-hero-title', B.showName(nn.now.title)));
        var meta = B.fmtTime(nn.now.start) + ' – ' + B.fmtTime(nn.now.end) + ' · ' + L('%d min left', G.minutesLeft(nn.now, now)) + (nn.next ? ' · ' + L('Next: %@', B.showName(nn.next.title)) : '');
        info.appendChild(h('div.gd-hero-meta', meta));
        info.appendChild(h('div.card-progress.inline.gd-hero-prog', [h('div', { style: { width: pct(nn.now, now) } })]));
      } else info.appendChild(h('div.gd-hero-title', L('No TV guide for this channel')));
      var btns = h('div.gd-hero-btns', [U.button(L('Watch live'), function () { PV.openPlayer(sel, channels, false); }, { primary: true, icon: 'play' })]);
      if (nn.now && Lib.canCatchup(sel, nn.now)) {
        var p0 = nn.now;
        btns.appendChild(U.button(L('From the start'), function () { PV.stop(false); B.player.playCatchup(sel, p0, channels); }, { icon: 'replay' }));
      }
      info.appendChild(btns);
    }
    function drawCols(reset) {
      if (!colsEl) return;
      var x = colsEl.scrollLeft;
      if (colIO) { colIO.disconnect(); colIO = null; }
      U.clear(colsEl);
      cols = []; colsShown = 0;
      var sentinel = h('div.gd-col-more');
      colsEl.appendChild(sentinel);
      function more() {
        var end = Math.min(channels.length, colsShown + 12);
        for (; colsShown < end; colsShown++) { var c = column(channels[colsShown]); cols.push(c); colsEl.insertBefore(c, sentinel); }
        if (colsShown >= channels.length && colIO) { colIO.disconnect(); sentinel.remove(); }
      }
      more();
      // de gekozen zender staat verder: tot daar opbouwen
      var si = channels.indexOf(sel);
      while (si >= colsShown && colsShown < channels.length) more();
      if (colsShown < channels.length && window.IntersectionObserver) {
        colIO = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) more(); }, { root: colsEl, rootMargin: '0px 900px 0px 0px' });
        colIO.observe(sentinel);
      } else while (colsShown < channels.length) more();
      if (!reset) colsEl.scrollLeft = x;
      else {
        var on = colsEl.querySelector('.gd-col.on');
        if (on && si > 2) colsEl.scrollLeft = Math.max(0, on.offsetLeft - colsEl.offsetLeft - 40);
      }
    }
    function column(ch) {
      var col = h('div.gd-col' + (ch === sel ? '.on' : ''), { role: 'listitem' });
      var head = h('button.gd-col-head', { type: 'button', 'aria-label': B.chanName(ch.name), 'aria-pressed': ch === sel ? 'true' : 'false' }, [logoBox(ch), h('span.gd-col-name', B.chanName(ch.name))]);
      head.addEventListener('click', function () { pick(ch); });
      var body = h('div.gd-col-list');
      col.appendChild(head); col.appendChild(body);
      col._ch = ch; col._body = body;
      fillRows(body, ch, true);
      return col;
    }
    function drawColSel() {
      cols.forEach(function (c) {
        var on = c._ch === sel;
        c.classList.toggle('on', on);
        var hd = c.querySelector('.gd-col-head');
        if (hd) hd.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    /** Programmaregels (tijd links, titel rechts; NU in de accentkleur; voorbij gedimd met terugkijk-icoon; bel). */
    function fillRows(box, ch, scroll) {
      var y = box.scrollTop;
      U.clear(box);
      var progs = progsOf(ch), now = Date.now();
      if (!progs.length) { box.appendChild(h('div.gd-empty.muted.small', L('No TV guide for this channel'))); return; }
      var cur = null;
      progs.forEach(function (p) {
        var st = G.state(p, now);
        var row = h('button.gd-row.' + st, { type: 'button' }, [
          h('span.gd-t', st === 'now' ? L('Now').toUpperCase() : B.fmtTime(p.start)),
          h('span.gd-ti', B.showName(p.title || '')),
          st === 'past' && Lib.canCatchup(ch, p) ? U.icon('replay', 'gd-ic') : null,
          st === 'next' && RM.has(ch, p) ? U.icon('bell', 'gd-ic') : null
        ]);
        if (st === 'now') row.setAttribute('aria-current', 'true');
        row.setAttribute('aria-label', B.fmtTime(p.start) + ' ' + B.showName(p.title || '') + (st === 'past' && Lib.canCatchup(ch, p) ? ', ' + L('Watch from the start') : '') + (st === 'next' && RM.has(ch, p) ? ', ' + L('Reminder set') : ''));
        row.addEventListener('click', function () { S.programSheet(ch, p, channels); });
        if (st === 'now' || (!cur && st === 'next')) cur = cur || row;
        box.appendChild(row);
      });
      if (scroll && dayOff === 0 && cur) setTimeout(function () { box.scrollTop = Math.max(0, cur.offsetTop - box.offsetTop - (phone ? 54 : 44)); }, 0);
      else if (!scroll) box.scrollTop = y;
    }

    // MARK: smal (telefoon)
    var phTop = null;
    function buildPhone() {
      phTop = h('div.gd-ph-top');
      el.appendChild(phTop);
      var cols2 = h('div.gd-ph-cols');
      railEl = h('div.gd-rail', { role: 'listbox', 'aria-label': L('Channels') });
      var right = h('div.gd-ph-right');
      dayLine = h('div.gd-dayline');
      listEl = h('div.gd-ph-list');
      right.appendChild(dayLine); right.appendChild(listEl);
      cols2.appendChild(railEl); cols2.appendChild(right);
      el.appendChild(cols2);
      rebuildPhoneTop();
      drawRail();
      drawDayLine();
      drawList(true);
    }
    function rebuildPhoneTop() {
      if (!phTop) return;
      U.clear(phTop);
      mediaEl = mediaBox('phone');
      nowStrip = h('div.gd-now');
      phTop.appendChild(mediaEl);
      phTop.appendChild(nowStrip);
      drawNowStrip();
      startPreview();
    }
    function drawNowStrip() {
      if (!nowStrip) return;
      U.clear(nowStrip);
      var now = Date.now(), nn = Lib.nowNext(sel);
      nowStrip.appendChild(h('div.gd-now-title', nn.now ? B.showName(nn.now.title) : B.chanName(sel.name)));
      if (nn.now) nowStrip.appendChild(h('div.gd-now-row', [h('span.muted.small', B.fmtTime(nn.now.start) + ' – ' + B.fmtTime(nn.now.end)), h('div.card-progress.inline', [h('div', { style: { width: pct(nn.now, now) } })])]));
    }
    var railGrid = null;
    function drawRail() {
      if (railGrid && railGrid.destroy) railGrid.destroy();
      U.clear(railEl);
      railGrid = U.grid(channels, function (ch) {
        var b = h('button.gd-rail-it' + (ch === sel ? '.on' : ''), { type: 'button', role: 'option', 'aria-selected': ch === sel ? 'true' : 'false', 'aria-label': B.chanName(ch.name) }, [logoBox(ch, 'rail')]);
        b._ch = ch;
        b.addEventListener('click', function () { pick(ch); });
        return b;
      }, 'gd-rail-grid', Math.max(40, channels.indexOf(sel) + 10));
      railEl.appendChild(railGrid);
      setTimeout(function () { var on = railEl.querySelector('.on'); if (on) railEl.scrollTop = Math.max(0, on.offsetTop - railEl.offsetTop - 64); }, 0);
    }
    function drawRailSel() {
      if (!railEl) return;
      Array.prototype.forEach.call(railEl.querySelectorAll('.gd-rail-it'), function (b) { var on = b._ch === sel; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    }
    function drawDayLine() {
      if (!dayLine) return;
      var d = day();
      dayLine.textContent = dayText(d.start + 3600000) + ' · ' + dayLong(d.start + 3600000);
    }
    function drawList(scroll) { if (listEl && sel) fillRows(listEl, sel, scroll); }

    // MARK: zoeken (programma's van de zenders in beeld, gisteren t/m 7 dagen)
    function openSearch() {
      var input = h('input.gd-q', { type: 'search', placeholder: L('Search the TV guide'), 'aria-label': L('Search the TV guide'), autocomplete: 'off' });
      var res = h('div.gd-results');
      var body = h('div.gd-search', [input, res]);
      var dlg = U.modal({ title: L('Search the TV guide'), body: body, cls: 'sheet-dlg.gd-search-dlg' });
      var run = B.debounce(function () {
        var q = B.fold(input.value.trim());
        U.clear(res);
        if (q.length < 2) return;
        var from = days[0].start, to = days[days.length - 1].end, hits = [];
        for (var i = 0; i < channels.length && hits.length < 80; i++) {
          var ch = channels[i], list = Lib.programsBetween(ch, from, to);
          for (var j = 0; j < list.length && hits.length < 80; j++) if (B.fold(list[j].title || '').indexOf(q) >= 0) hits.push([ch, list[j]]);
        }
        hits.sort(function (a, b) { return a[1].start - b[1].start; });
        if (!hits.length) { res.appendChild(h('p.muted', L('No programmes found'))); return; }
        var now = Date.now();
        hits.forEach(function (x) {
          var st = G.state(x[1], now);
          var b = h('button.gd-hit.' + st, { type: 'button' }, [logoBox(x[0], 'tiny'), h('div.gd-hit-t', [h('div', B.showName(x[1].title || '')),
            h('div.muted.small', B.chanName(x[0].name) + ' · ' + dayText(x[1].start) + ' ' + B.fmtTime(x[1].start))])]);
          b.addEventListener('click', function () { dlg.close(); S.programSheet(x[0], x[1], channels); });
          res.appendChild(b);
        });
      }, 220);
      input.addEventListener('input', run);
      setTimeout(function () { input.focus(); }, 40);
    }

    // MARK: bijwerken
    function minute() {
      if (document.hidden || B.player.current) return;
      if (phone) { drawNowStrip(); drawList(false); }
      else {
        if (heroEl && heroEl._info) fillHeroInfo(heroEl._info);
        cols.forEach(function (c) { fillRows(c._body, c._ch, false); });
      }
    }
    var tick = setInterval(minute, 60000);
    offs.push(B.on('reminders', function () { minute(); }));
    offs.push(B.on('playerClosed', function () { setTimeout(function () { if (!B.player.current && el.isConnected) { minute(); startPreview(); } }, 1500); }));
    function onVis() { if (!document.hidden && el.isConnected && !B.player.current && !PV.ch) startPreview(); }
    document.addEventListener('visibilitychange', onVis);
    var wasPhone = U.isPhone();
    var onResize = B.debounce(function () { if (U.isPhone() !== wasPhone) { wasPhone = U.isPhone(); render(); } }, 250);
    window.addEventListener('resize', onResize);

    pg.refresh = render;
    pg.onLoading = function () { if (el.querySelector('.state')) render(); };
    pg.onEpg = function () { minute(); };
    pg.onData = function () { if (group === '★' || group === '⟲') { var fresh = channelsFor(group); if (fresh.length !== channels.length) render(); } };
    pg.onCollections = function () { render(); };
    pg.destroy = function () {
      clearInterval(tick);
      offs.forEach(function (f) { if (typeof f === 'function') f(); });
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onResize);
      if (colIO) colIO.disconnect();
      if (railGrid && railGrid.destroy) railGrid.destroy();
      PV.stop(true);
    };
    render();
    return pg;
  };
})();
