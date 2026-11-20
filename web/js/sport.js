/*
 * Build 172: tabblad Sport in de webspeler (#/sport). Wedstrijden uit de tv-gids van de open server (B.sportLogic,
 * gelijk aan de apps), een kaart "Nu live" met het live voorbeeld van de tv-gids (B.guidePreview: één tegelijk, zonder
 * geluid, telt als stream, instelling Live voorbeeld) en per dag de wedstrijden met een belletje. Het belletje is een
 * herinnering in de state-section `reminders` (docs/ACCOUNT.md "Build 172: Sport" in iptv-ios-appletv): de server stuurt
 * de pushmelding op het gekozen moment. Mijn teams en competities: sets `favoriteTeams`, `favoriteCompetitions` en
 * `sportMuted` in `profile.<id>`.
 */
(function () {
  'use strict';
  var B = window.B, U = B.ui, h = U.h, S = B.screens, D = B.data, A = B.account, Lib = B.lib;
  var L = function () { return B.L.apply(null, arguments); };
  var SL = B.sportLogic;
  var SP = B.sport = { groups: [], loading: false };
  var chans = {};          // listing-id → zender
  var lastKey = null, lastRun = 0, running = false;
  var LEAD_KEY = 'sport.lead';

  function lower(v) { return String(v == null ? '' : v).toLowerCase(); }
  SP.defaultLead = function () { return SL.lead(B.store.get(LEAD_KEY, SL.DEFAULT_LEAD)); };
  SP.setDefaultLead = function (m) { B.store.set(LEAD_KEY, SL.lead(m)); };

  SP.sportName = function (id) {
    return L({ football: 'Football', motorsport: 'F1/Motorsport', tennis: 'Tennis', darts: 'Darts', cycling: 'Cycling',
      basketball: 'Basketball', icehockey: 'Ice hockey', americanfootball: 'American football', combat: 'Combat sports',
      golf: 'Golf' }[id] || 'Other');
  };
  SP.leadName = function (m) { return m === 0 ? L('At the start') : m === 15 ? L('15 min before') : L('5 min before'); };
  SP.label = function (m) { return m.competition || SP.sportName(m.sport); };

  // MARK: zoeken (in stukjes, zodat een grote gids de pagina niet blokkeert)

  function isFav(ch) { try { return D.inSet('favorites', B.xs.keyOf(ch)); } catch (e) { return false; } }

  SP.refresh = function (force) {
    var lib = Lib.lib;
    if (!lib || !lib.channels) return Promise.resolve();
    var key = [Lib.source && Lib.source.id, lib.channels.length, lib.epg ? Object.keys(lib.epg).length : 0,
      D.setList('favorites').length, B.app.profile && B.app.profile.id].join('|');
    var now = Date.now();
    if (!force && key === lastKey && now - lastRun < 900000) return Promise.resolve();
    if (running) return Promise.resolve();
    running = true; lastKey = key; lastRun = now;
    if (!SP.groups.length) { SP.loading = true; B.emit('sport'); }
    var listings = [], map = {}, list = lib.channels, i = 0, until = now + SL.DAYS * 86400000;
    return new Promise(function (resolve) {
      function step() {
        var end = Math.min(list.length, i + 150);
        for (; i < end; i++) {
          var ch = list[i];
          if (!ch || ch.radio) continue;
          var fav = isFav(ch);
          if (!SL.isSportChannel(ch.name, ch.group || '', fav)) continue;
          Lib.programsBetween(ch, now, until).forEach(function (p) {
            var m = SL.classify({ title: p.title, description: p.description, channel: ch.name, category: ch.group || '', start: p.start, end: p.end });
            if (!m) return;
            var id = (Lib.source ? Lib.source.id : '') + '|' + ch.id + '|' + Math.floor(p.start / 1000);
            if (map[id]) return;
            map[id] = ch;
            listings.push({ id: id, channel: ch.name, favorite: fav, start: p.start, end: p.end, match: m });
          });
        }
        if (i < list.length) { setTimeout(step, 0); return; }
        chans = map;
        SP.groups = SL.dedupe(listings);
        SP.loading = false;
        running = false;
        applyAuto();
        B.emit('sport');
        resolve();
      }
      step();
    });
  };

  SP.channel = function (g) { return g.listings[0] ? chans[g.listings[0].id] : null; };
  SP.channelOf = function (l) { return chans[l.id] || null; };

  // MARK: belletjes (state-section `reminders`)

  function remList(d) { return (d && (d.items || d.reminders || d.list)) || []; }
  function myId(key) {
    var prof = B.app.profile;
    return prof && !D.isMain(prof) ? 'p:' + lower(prof.id) + ':' + key : key;
  }
  /** Sportherinnering van het actieve profiel voor deze wedstrijd (of null). */
  SP.reminder = function (g) {
    var id = myId(g.key), d = B.reminders && B.reminders.data();
    var out = null;
    remList(d).forEach(function (r) { if (r && r.id === id) out = r; });
    return out;
  };
  /** Aan (met lead) of uit; eerst de server lezen, dan de hele lijst terugzetten (zoals de herinneringen in de gids). */
  SP.setBell = function (g, on, lead, auto) {
    var prof = B.app.profile, ch = SP.channel(g);
    if (!prof || (on && !ch)) return Promise.resolve(null);
    var id = myId(g.key);
    return A.getState(['reminders']).then(function (all) {
      var sec = all && all.reminders && all.reminders.data;
      var d = B.copy(sec && typeof sec === 'object' ? sec : (B.reminders.data() || {})) || {};
      var list = remList(d).filter(function (r) {
        if (!r) return false;
        if (r.id === id) { if (!on) { d.removed = d.removed || {}; d.removed[id] = B.iso(); } return false; }
        return true;
      });
      if (on) {
        var src = (ch && ch._src) || Lib.source;
        var it = { id: id, playlistID: src ? src.id : '', channelID: String(ch.id), channelName: B.chanName(ch.name),
          title: g.match.title, start: new Date(g.start).toISOString(), leadMin: SL.lead(lead == null ? SP.defaultLead() : lead),
          matchKey: g.key };
        if (g.match.competition) it.competition = g.match.competition;
        if (auto) it.auto = true;
        if (!D.isMain(prof)) it.profileID = lower(prof.id);
        list.push(it);
        if (d.removed) delete d.removed[id];
      }
      delete d.reminders; delete d.list;
      d.items = list;
      d.updatedAt = B.iso();
      return A.putState('reminders', d).then(function (r) {
        if (r == null) return null;
        B.reminders.replace(d);
        // uitzetten dempt de wedstrijd (een automatisch belletje komt niet terug); aanzetten haalt hem eruit
        if (!auto) setMuted(g.key, !on);
        return on;
      });
    });
  };
  function setMuted(key, on) {
    var old = D.setList('sportMuted'), keep = SL.pruneMuted(old, Date.now());
    old.forEach(function (k) { if (keep.indexOf(k) < 0) D.toggleSet('sportMuted', k, false); });
    D.toggleSet('sportMuted', key, on);
  }

  /** Wedstrijden van favoriete teams en competities krijgen automatisch een belletje (eén per wedstrijd). */
  function applyAuto() {
    var teams = D.setList('favoriteTeams'), comps = D.setList('favoriteCompetitions');
    if ((!teams.length && !comps.length) || !B.app.profile || !B.reminders) return;
    var me = lower(B.app.profile.id);
    var existing = remList(B.reminders.data()).filter(function (r) { return r && r.matchKey && B.reminders.profileOf(r) === me; })
      .map(function (r) { return r.matchKey; });
    var keys = SL.autoReminders(SP.groups, { now: Date.now(), teams: teams, competitions: comps, muted: D.setList('sportMuted'), existing: existing });
    // na elkaar (elke keer de hele lijst lezen en terugzetten)
    keys.reduce(function (p, k) {
      var g = null;
      SP.groups.forEach(function (x) { if (x.key === k) g = x; });
      return g ? p.then(function () { return SP.setBell(g, true, SP.defaultLead(), true); }).catch(function () {}) : p;
    }, Promise.resolve());
  }

  SP.isFavoriteTeam = function (name) {
    var k = SL.teamKey(name);
    return D.setList('favoriteTeams').some(function (t) { return SL.teamKey(t) === k; });
  };
  SP.setFavoriteTeam = function (name, on) {
    var k = SL.teamKey(name);
    D.setList('favoriteTeams').forEach(function (t) { if (SL.teamKey(t) === k) D.toggleSet('favoriteTeams', t, false); });
    if (on) D.toggleSet('favoriteTeams', SL.cleanTeam(name), true);
    if (on) applyAuto();
    B.emit('sport');
  };
  SP.setFavoriteCompetition = function (id, on) {
    D.toggleSet('favoriteCompetitions', id, on);
    if (on) applyAuto();
    B.emit('sport');
  };

  function play(ch) {
    if (!ch) return;
    var list = Lib.lib.channels.filter(function (c) { return c.group === ch.group; });
    if (!list.length) list = [ch];
    // build 173: wedstrijd al bezig en terugkijken kan: eerst "Vanaf het begin" of "Live kijken"
    B.player.playLive(ch, list, { live: function () { B.guidePreview.openPlayer(ch, list); }, beforeCatchup: function () { B.guidePreview.stop(false); } });
  }

  // MARK: teamcirkel

  function hex(n) { return '#' + ('000000' + n.toString(16)).slice(-6); }
  function initials(name, big) {
    // build 179 (#8): kleur van het team (ESPN of logo), leesbaar met witte tekst; anders de vaste kleur
    var bg = B.sportScores ? '#' + B.sportScores.teamColor(name) : hex(SL.color(name));
    return h('span.sp-badge' + (big ? '.big' : ''), { style: { background: bg }, 'aria-hidden': 'true' }, SL.short(name));
  }

  // MARK: build 178: club- en competitielogo's (zoals Weekdot; regels in sportlogos.js)
  // Niets in de site: logo's live van maak-agenda.nl (competities, vlaggen), ESPN-teamlijsten en TheSportsDB (clubs) en
  // favicons via Google (kleine logo's). Indexen en "niet gevonden" in Cache Storage (bingr-sportlogos-v1, index 7 dagen,
  // niet gevonden 1 dag); afbeeldingen via de HTTP-cache van de browser (geladen adressen worden 7 dagen onthouden).
  // ESPN/TheSportsDB via fetch: weigert de browser het (CORS), dan blijft het bij vlaggen, competitielogo's en initialen.
  // Data besparen op mobiel: alleen logo's die al eerder geladen zijn. Zolang een logo laadt of ontbreekt: de initialen.
  var GL = B.sportLogos;
  var LOGO_CACHE = 'bingr-sportlogos-v1';
  var logoMem = {}, logoMiss = {}, idxMem = {}, crestMem = {}, inflight = {};

  function saver() { try { return !!(B.b176ui && B.b176ui.saver()); } catch (e) { return false; } }
  function cacheKey(name) { return location.origin + '/__sportlogos/' + name; }
  function cget(name, kind) {
    if (!window.caches) return Promise.resolve(null);
    return caches.open(LOGO_CACHE).then(function (c) { return c.match(cacheKey(name)); }).then(function (r) {
      return r ? r.json() : null;
    }).then(function (o) {
      if (!o || typeof o.t !== 'number') return null;
      return GL.usable(kind, (Date.now() - o.t) / 1000, saver()) ? o : null;
    }).catch(function () { return null; });
  }
  function cput(name, data) {
    if (!window.caches) return;
    caches.open(LOGO_CACHE).then(function (c) {
      return c.put(cacheKey(name), new Response(JSON.stringify({ t: Date.now(), d: data }), { headers: { 'Content-Type': 'application/json' } }));
    }).catch(function () {});
  }
  function once(key, work) {
    if (!inflight[key]) inflight[key] = work().then(function (v) { delete inflight[key]; return v; }, function () { delete inflight[key]; return null; });
    return inflight[key];
  }
  function getJSON(url) {
    var ctl = window.AbortController ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, 15000) : null;
    return fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (t) clearTimeout(t); return r.ok ? r.json() : null; })
      .catch(function () { if (t) clearTimeout(t); return null; });
  }
  function leagueIndex(league) {
    if (idxMem[league]) return Promise.resolve(idxMem[league]);
    var file = GL.cacheName('crests2', league, 'json'), miss = GL.cacheName('miss-crests2', league, '');
    return once('idx|' + league, function () {
      return cget(file, 'index').then(function (o) {
        if (o) return o.d || {};
        return cget(miss, 'miss').then(function (m) {
          if (m || saver()) return {};
          return getJSON(GL.espnTeamsURL(league)).then(function (j) {
            var idx = j ? GL.buildIndex(GL.espnTeams(j)) : {};
            if (Object.keys(idx).length) cput(file, idx); else cput(miss, 1);
            return idx;
          });
        });
      }).then(function (idx) { idxMem[league] = idx; return idx; });
    });
  }
  function searchCrest(name, sport, wanted) {
    var k = wanted[0], file = GL.cacheName('crest-search', k, 'json'), miss = GL.cacheName('miss-search', k, '');
    return once('search|' + k, function () {
      return cget(file, 'index').then(function (o) {
        if (o) return GL.match(wanted, o.d || {});
        return cget(miss, 'miss').then(function (m) {
          if (m || saver()) return null;
          return getJSON(GL.sportsDBSearchURL(name)).then(function (j) {
            var idx = j ? GL.buildIndex(GL.sportsDBTeams(j, sport)) : {};
            var found = GL.match(wanted, idx);
            if (found) cput(file, idx); else cput(miss, 1);
            return found;
          });
        });
      });
    });
  }
  function crest(name, sport, comp) {
    var leagues = GL.espnLeagues(sport, comp), key = name + '|' + sport + '|' + leagues.join(',');
    if (Object.prototype.hasOwnProperty.call(crestMem, key)) return Promise.resolve(crestMem[key]);
    var wanted = GL.keys(name);
    if (!wanted.length) return Promise.resolve(null);
    var i = 0;
    function next() {
      if (i >= leagues.length) return searchCrest(name, sport, wanted);
      return leagueIndex(leagues[i++]).then(function (idx) { return GL.match(wanted, idx) || next(); });
    }
    return next().then(function (u) { crestMem[key] = u || null; return u || null; });
  }
  /** art = {comp, small} of {team, sport, compId} → adressen in volgorde van voorkeur. */
  function logoURLs(art) {
    if (art.comp) return Promise.resolve(GL.competitionURLs(art.comp, !!art.small));
    var kind = GL.teamArt(art.team, art.sport || 'football', art.compId || '');
    if (kind.indexOf('flag:') === 0) return Promise.resolve([GL.flagURL(kind.slice(5))]);
    if (kind !== 'club') return Promise.resolve([]);
    return crest(art.team, art.sport || 'football', art.compId || '').then(function (u) { return u ? [u] : []; });
  }
  function seen(url) {
    var file = GL.cacheName('img', url, '');
    return cget(file, 'image').then(function (o) { return !!o; });
  }
  /** Probeert de adressen een voor een (img, geen fetch: werkt zonder CORS); fout = 1 dag niet opnieuw. */
  function loadInto(slot, urls, cls) {
    var i = 0;
    function next() {
      if (i >= urls.length) return;
      var u = urls[i++];
      if (logoMiss[u]) return next();
      var missFile = GL.cacheName('miss', u, '');
      (logoMem[u] ? Promise.resolve('ok') : cget(missFile, 'miss').then(function (m) {
        if (m) { logoMiss[u] = 1; return 'miss'; }
        if (!saver()) return 'ok';
        return seen(u).then(function (s) { return s ? 'ok' : 'skip'; });
      })).then(function (state) {
        if (state !== 'ok') return next();
        var img = new Image();
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.alt = '';
        img.className = cls;
        img.onload = function () {
          if (!img.naturalWidth || img.naturalWidth < 2) { img.onerror(); return; }
          if (!logoMem[u]) { logoMem[u] = 1; cput(GL.cacheName('img', u, ''), 1); }
          U.clear(slot);
          slot.appendChild(img);
          slot.classList.add('has-logo');
        };
        img.onerror = function () { logoMiss[u] = 1; cput(missFile, 1); next(); };
        img.src = u;
      });
    }
    next();
  }
  /** Logo-element: meteen de initialen (of leeg), het logo komt erin zodra het er is. */
  SP.logo = function (art, title, size, placeholder) {
    var slot = h('span.sp-logo', { 'aria-hidden': 'true', style: { width: size + 'px', height: size + 'px' } },
      placeholder === false ? [] : [initials(title, size >= 36)]);
    if (placeholder !== false) {
      var b = slot.firstChild;
      b.style.width = b.style.height = size + 'px';
      b.style.fontSize = Math.round(size * 0.36) + 'px';
    }
    logoURLs(art).then(function (urls) { if (urls.length) loadInto(slot, urls, 'sp-logo-img'); }, function () {});
    return slot;
  };
  SP.badge = function (name, big, match) {
    return SP.logo({ team: name, sport: match ? match.sport : 'football', compId: match ? match.competitionId : '' }, name, big ? 40 : 30);
  };
  SP.compLogo = function (m, size) {
    if (!m.competitionId) return null;
    return SP.logo({ comp: m.competitionId, small: size < 24 }, m.competition, size, false);
  };
  SP.logoNotice = function () {
    return h('p.muted.small.sp-logo-note', L('Logos and crests are trademarks of their respective owners and are shown for identification only.'));
  };

  // MARK: pagina

  function dayTitle(ms) {
    var d0 = new Date(); d0.setHours(0, 0, 0, 0);
    var off = Math.round((ms - d0.getTime()) / 86400000);
    if (off === 0) return L('Today');
    if (off === 1) return L('Tomorrow');
    var s = B.fmtDate(ms, { weekday: 'long', day: 'numeric', month: 'long' }, B.lang === 'nl' ? 'nl-NL' : B.locale());
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function dayStart(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function isLive(g, now) { return g.start <= now && now < g.end; }

  S.pages.sport = function () {
    var el = h('div.page.sport');
    var pg = { el: el, title: L('Sport') };
    var filter = 'all', offs = [], timer = null;

    function visible(now) {
      var teams = D.setList('favoriteTeams'), comps = D.setList('favoriteCompetitions');
      return SP.groups.filter(function (g) {
        if (g.end <= now) return false;
        if (filter === 'all') return true;
        if (filter === 'mine') return SL.isFavorite(g.match, teams, comps) || !!SP.reminder(g);
        return g.match.sport === filter;
      });
    }

    function render() {
      var now = Date.now();
      B.guidePreview.stop(true);
      U.clear(el);
      el.appendChild(h('div.page-head', [h('h1', L('Sport'))]));
      var present = {};
      SP.groups.forEach(function (g) { present[g.match.sport] = 1; });
      var chips = h('div.sp-chips', { role: 'toolbar', 'aria-label': L('Filter') });
      var SC = B.sportScores, tableTab = SC && SC.leagues(SP.groups).length ? [['standings', L('Standings')]] : [];
      [['all', L('All')], ['mine', L('My teams')]].concat(SL.SPORTS.filter(function (s) { return present[s]; }).map(function (s) { return [s, SP.sportName(s)]; })).concat(tableTab)
        .forEach(function (f) {
          var b = h('button.sp-chip' + (f[0] === filter ? '.on' : ''), { type: 'button', 'aria-pressed': f[0] === filter ? 'true' : 'false' }, f[1]);
          b.addEventListener('click', function () { filter = f[0]; render(); });
          chips.appendChild(b);
        });
      el.appendChild(chips);
      if (filter === 'standings') { standingsView(); return; }
      if (SP.loading && !SP.groups.length) { el.appendChild(h('p.muted.sp-empty', L('Looking for matches…'))); return; }
      if (!SP.groups.length) {
        el.appendChild(h('div.state', [U.icon('sport', 'state-ic'), h('p', L('No matches found')),
          h('p.muted.small', L('Matches come from the TV guide of your servers: sports channels and event categories.'))]));
        return;
      }
      var vis = visible(now);
      if (!vis.length) { el.appendChild(h('p.muted.sp-empty', L('No matches for this filter.'))); return; }
      var live = vis.filter(function (g) { return isLive(g, now); });
      if (live.length) {
        el.appendChild(h('div.sp-live-head', [h('span.sp-dot'), L('LIVE NOW')]));
        var row = h('div.sp-live-row');
        live.forEach(function (g, i) { row.appendChild(liveCard(g, now, i === 0)); });
        el.appendChild(row);
      }
      var days = {}, order = [];
      vis.forEach(function (g) {
        if (isLive(g, now)) return;
        var d = dayStart(g.start);
        if (!days[d]) { days[d] = []; order.push(d); }
        days[d].push(g);
      });
      order.forEach(function (d) {
        el.appendChild(h('h2.sp-day', dayTitle(d)));
        var list = h('div.sp-list');
        days[d].forEach(function (g) { list.appendChild(matchRow(g)); });
        el.appendChild(list);
      });
      espnSections(now);
      el.appendChild(SP.logoNotice());
    }

    // MARK: build 179 (#7): scores, Afgelopen, Niet in je gids en standen (ESPN, zie b179sport.js)
    function scoreEl(g) {
      var SC = B.sportScores, sc = SC ? SC.score(SC.eventFor(g)) : null;
      if (!sc || !sc.text) return null;
      return h('div.sp-score' + (sc.final ? '.final' : ''), [h('span', sc.text), sc.final ? h('span.muted.small', L('Full time')) : null]);
    }
    function compName(league) {
      var P9 = B.b179, out = league;
      SL.COMPETITIONS.forEach(function (c) { if (P9.espnLeague(c.id) === league) out = c.name; });
      return out;
    }
    function espnRow(ev, note) {
      var sc = B.b179.eventScore(ev);
      var when = ev.state === 'pre' ? B.fmtTime(ev.start * 1000) : '';
      return h('div.sp-row.sp-espn', [h('div.sp-row-main', [
        h('div.sp-time', [h('div.sp-hm', when || (ev.state === 'post' ? L('Full time') : L('LIVE'))), h('div.sp-ch.muted', compName(ev.league))]),
        h('div.sp-pair', [initials(ev.home.name, false), initials(ev.away.name, false)]),
        h('div.sp-txt', [h('div.muted.small.sp-comp', note || ''), h('div.sp-title', ev.home.short + ' - ' + ev.away.short + (sc ? '  ' + sc : ''))])])]);
    }
    function espnSections(now) {
      var SC = B.sportScores;
      if (!SC || filter !== 'all' && filter !== 'mine' && filter !== 'football') return;
      var extra = SC.notInGuide(SP.groups).filter(function (ev) { return ev.state !== 'post'; });
      var done = SC.events().filter(function (ev) { return ev.state === 'post' && now - ev.start * 1000 < 18 * 3600000; });
      if (extra.length) {
        el.appendChild(h('h2.sp-day', L('Not in your guide')));
        var l1 = h('div.sp-list');
        extra.forEach(function (ev) { l1.appendChild(espnRow(ev, L('Not in your guide'))); });
        el.appendChild(l1);
      }
      if (done.length) {
        el.appendChild(h('h2.sp-day', L('Full time')));
        var l2 = h('div.sp-list');
        done.sort(function (a, b) { return b.start - a.start; }).forEach(function (ev) { l2.appendChild(espnRow(ev)); });
        el.appendChild(l2);
      }
    }
    function standingsView() {
      var SC = B.sportScores, leagues = SC.leagues(SP.groups);
      var box = h('div.sp-tables');
      el.appendChild(box);
      leagues.forEach(function (lg) {
        var sec = h('section.sp-table', [h('h2.sp-day', compName(lg)), h('p.muted.small', L('Loading…'))]);
        box.appendChild(sec);
        SC.standings(lg).then(function (groups) {
          while (sec.childNodes.length > 1) sec.removeChild(sec.lastChild);
          if (!groups.length) { sec.appendChild(h('p.muted.small', L('Standings aren’t available right now.'))); return; }
          groups.forEach(function (gr) {
            if (groups.length > 1 && gr.name) sec.appendChild(h('div.sp-label', gr.name));
            var tb = h('table.sp-stand', [h('thead', [h('tr', [h('th', '#'), h('th', L('Team')), h('th', L('Played')), h('th', L('Points'))])])]);
            var body = h('tbody');
            gr.rows.forEach(function (r) {
              body.appendChild(h('tr', [h('td', String(r.rank)), h('td', [initials(r.team, false), h('span', r.team)]),
                h('td', r.played == null ? '' : String(r.played)), h('td', r.points == null ? (r.won == null ? '' : r.won + '-' + r.lost) : String(r.points))]));
            });
            tb.appendChild(body);
            sec.appendChild(tb);
          });
        });
      });
      if (!leagues.length) box.appendChild(h('p.muted', L('Standings aren’t available right now.')));
    }

    function liveCard(g, now, preview) {
      var ch = SP.channel(g);
      var media = h('div.sp-media', [ch ? U.img(ch.logo, 'logo', B.chanName(ch.name)) : null,
        h('span.sp-live-badge', L('LIVE')), ch ? h('span.sp-ch-badge', B.chanName(ch.name)) : null]);
      var title = h('div.sp-title-row', [g.match.kind === 'duel' ? SP.badge(g.match.home, false, g.match) : null, h('span.sp-title', g.match.title),
        g.match.kind === 'duel' ? SP.badge(g.match.away, false, g.match) : null]);
      var pctW = Math.round(B.clamp((now - g.start) / (g.end - g.start), 0, 1) * 100) + '%';
      var card = h('button.sp-live-card', { type: 'button', 'aria-label': L('LIVE') + ', ' + SP.label(g.match) + ', ' + g.match.title }, [media,
        h('div.sp-live-info', [h('div.muted.small.sp-comp', [SP.compLogo(g.match, 16), h('span', SP.label(g.match))]), title, scoreEl(g), h('div.card-progress.inline', [h('div', { style: { width: pctW } })])])]);
      // build 179 (#8): kaart in de kleuren van de teams (tekst blijft wit)
      if (B.sportScores && g.match.kind === 'duel') {
        card.classList.add('sp-tc');
        card.style.setProperty('--sp-c1', '#' + B.sportScores.teamColor(g.match.home));
        card.style.setProperty('--sp-c2', '#' + B.sportScores.teamColor(g.match.away));
      }
      card.addEventListener('click', function () { play(ch); });
      if (ch) {
        if (preview) setTimeout(function () { if (document.body.contains(media)) B.guidePreview.show(media, ch, false); }, 0);
        card.addEventListener('mouseenter', function () { B.guidePreview.show(media, ch, false); });
        card.addEventListener('focus', function () { B.guidePreview.show(media, ch, false); });
      }
      return card;
    }

    function matchRow(g) {
      var ch = SP.channel(g), on = !!SP.reminder(g);
      var open = h('button.sp-row-main', { type: 'button' }, [
        h('div.sp-time', [h('div.sp-hm', B.fmtTime(g.start)), h('div.sp-ch.muted', ch ? B.chanName(ch.name) : '')]),
        // build 178: logo's van beide teams (of van de competitie bij een evenement)
        g.match.kind === 'duel' ? h('div.sp-pair', [SP.logo({ team: g.match.home, sport: g.match.sport, compId: g.match.competitionId }, g.match.home, 26),
          SP.logo({ team: g.match.away, sport: g.match.sport, compId: g.match.competitionId }, g.match.away, 26)])
          : (g.match.competitionId ? h('div.sp-pair', [SP.compLogo(g.match, 30)]) : null),
        h('div.sp-txt', [h('div.muted.small.sp-comp', [g.match.kind === 'duel' ? SP.compLogo(g.match, 14) : null, h('span', SP.label(g.match))]),
          h('div.sp-title', g.match.title)])]);
      open.addEventListener('click', function () { sheet(g); });
      var bell = h('button.sp-bell' + (on ? '.on' : ''), { type: 'button', 'aria-label': on ? L('Turn off reminder') : L('Turn on reminder'),
        'aria-pressed': on ? 'true' : 'false' }, [U.icon('bell')]);
      bell.addEventListener('click', function () {
        bell.disabled = true;
        SP.setBell(g, !on).then(function (r) {
          bell.disabled = false;
          if (r == null) { U.toast(L('Something went wrong. Please try again.')); return; }
          render();
        }, function () { bell.disabled = false; U.toast(L('Something went wrong. Please try again.')); });
      });
      return h('div.sp-row', [open, bell]);
    }

    function sheet(g) {
      var now = Date.now(), live = isLive(g, now), ch = SP.channel(g), r = SP.reminder(g);
      var lead = r ? SL.lead(r.leadMin) : SP.defaultLead();
      var body = h('div.sp-sheet');
      var dlg = null;
      body.appendChild(h('div.muted.small', [SP.label(g.match), B.fmtDate(g.start, { weekday: 'short', day: 'numeric', month: 'short' }, B.lang === 'nl' ? 'nl-NL' : B.locale()),
        B.fmtTime(g.start), ch ? B.chanName(ch.name) : ''].filter(Boolean).join(' · ')));
      body.appendChild(h('div.sp-title-row.big', [g.match.kind === 'duel' ? SP.badge(g.match.home, true, g.match) : SP.compLogo(g.match, 36),
        h('span.sp-title', g.match.title), g.match.kind === 'duel' ? SP.badge(g.match.away, true, g.match) : null]));
      var sce = scoreEl(g);
      if (sce) body.appendChild(sce);
      if (live) {
        body.appendChild(U.button(L('Watch live'), function () { if (dlg) dlg.close(); play(ch); }, { primary: true, icon: 'play' }));
      } else {
        body.appendChild(h('div.sp-label', L('Notification')));
        var leads = h('div.sp-leads');
        SL.LEADS.forEach(function (m) {
          var b = h('button.sp-chip' + (m === lead ? '.on' : ''), { type: 'button', 'aria-pressed': m === lead ? 'true' : 'false' }, SP.leadName(m));
          b.addEventListener('click', function () {
            lead = m;
            Array.prototype.forEach.call(leads.children, function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
            b.classList.add('on'); b.setAttribute('aria-pressed', 'true');
            if (SP.reminder(g)) SP.setBell(g, true, m);
          });
          leads.appendChild(b);
        });
        body.appendChild(leads);
      }
      function toggle(label, get, set) {
        var cb = h('input', { type: 'checkbox' });
        cb.checked = get();
        cb.addEventListener('change', function () { set(cb.checked); });
        return h('label.sp-toggle', [h('span', label), cb]);
      }
      if (g.match.kind === 'duel') {
        [g.match.home, g.match.away].forEach(function (t) {
          body.appendChild(toggle(L('All matches of %@', t), function () { return SP.isFavoriteTeam(t); }, function (v) { SP.setFavoriteTeam(t, v); }));
        });
      }
      if (g.match.competitionId) {
        body.appendChild(toggle(L('All matches of %@', g.match.competition), function () { return D.inSet('favoriteCompetitions', g.match.competitionId); },
          function (v) { SP.setFavoriteCompetition(g.match.competitionId, v); }));
      }
      if (!live) {
        var has = !!r;
        var bb = U.button(has ? L('Turn off reminder') : L('Turn on reminder'), function () {
          bb.disabled = true;
          SP.setBell(g, !has, lead).then(function (x) {
            bb.disabled = false;
            if (x == null) { U.toast(L('Something went wrong. Please try again.')); return; }
            U.toast(x ? L('Reminder on') : L('Reminder removed'));
            if (dlg) dlg.close();
            render();
          }, function () { bb.disabled = false; U.toast(L('Something went wrong. Please try again.')); });
        }, { primary: !has, icon: 'bell' });
        body.appendChild(bb);
      }
      if (g.listings.length > 1) {
        body.appendChild(h('div.sp-label', L('Also on')));
        g.listings.slice(1, 7).forEach(function (l) {
          var c = SP.channelOf(l), canPlay = l.start <= now && now < l.end;
          var b = h('button.sp-also', { type: 'button' }, [h('span', B.chanName(l.channel)), h('span.muted', B.fmtTime(l.start))]);
          b.disabled = !canPlay;
          b.addEventListener('click', function () { if (dlg) dlg.close(); play(c); });
          body.appendChild(b);
        });
      }
      dlg = U.modal({ title: g.match.title, body: body, cls: 'sheet-dlg.sp-sheet-dlg' });
    }

    render();
    SP.refresh().then(function () { render(); if (B.sportScores) B.sportScores.refresh(SP.groups); });
    offs.push(B.on('sport', render));
    offs.push(B.on('sportScores', function () { if (filter !== 'standings') render(); }));
    offs.push(B.on('epg', function () { SP.refresh(true); }));
    offs.push(B.on('library', function () { SP.refresh(true); }));
    timer = setInterval(function () { SP.refresh(); if (B.sportScores) B.sportScores.refresh(SP.groups); if (filter !== 'standings') render(); }, 60000);
    pg.destroy = function () {
      clearInterval(timer);
      offs.forEach(function (off) { if (typeof off === 'function') off(); });
      B.guidePreview.stop(true);
    };
    return pg;
  };

  // MARK: instellingen (Algemeen → Sport)

  SP.settings = function (section, row, render) {
    var sec = section(L('Sport'), L('Matches of your teams and competitions get a reminder automatically.'));
    row(sec, L('Default notification for a match'), SP.leadName(SP.defaultLead()), function () {
      U.choose(L('Default notification for a match'), SL.LEADS.map(function (m) { return { value: m, label: SP.leadName(m) }; }), SP.defaultLead(), function (v) {
        SP.setDefaultLead(v); render();
      });
    }, { icon: 'bell' });
    var n = D.setList('favoriteTeams').length + D.setList('favoriteCompetitions').length;
    row(sec, L('My teams and competitions'), n ? String(n) : null, function () { favoritesSheet(render); }, { icon: 'sport' });
  };

  function favoritesSheet(after) {
    var body = h('div.sp-sheet');
    function draw() {
      U.clear(body);
      body.appendChild(h('div.sp-label', L('Teams')));
      var teams = D.setList('favoriteTeams').slice().sort();
      if (!teams.length) body.appendChild(h('p.muted.small', L('No favorite teams yet. Turn on “All matches of …” at a match.')));
      teams.forEach(function (t) {
        var rm = U.button('', function () { SP.setFavoriteTeam(t, false); draw(); }, { icon: 'minus', round: true, title: L('Remove') });
        body.appendChild(h('div.sp-fav', [SP.badge(t), h('span', t), rm]));
      });
      var inp = h('input.input', { type: 'text', placeholder: L('Team name'), 'aria-label': L('Team name'), maxlength: '60' });
      var add = U.button(L('Add'), function () {
        if (SL.cleanTeam(inp.value).length < 2) return;
        SP.setFavoriteTeam(inp.value, true); draw();
      });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') add.click(); });
      body.appendChild(h('div.sp-add', [inp, add]));
      body.appendChild(h('div.sp-label', L('Competitions')));
      SL.COMPETITIONS.forEach(function (c) {
        var cb = h('input', { type: 'checkbox' });
        cb.checked = D.inSet('favoriteCompetitions', c.id);
        cb.addEventListener('change', function () { SP.setFavoriteCompetition(c.id, cb.checked); });
        // build 178: klein logo (favicon van de officiële site, zoals Weekdot)
        body.appendChild(h('label.sp-toggle', [h('span.sp-comp', [SP.logo({ comp: c.id, small: true }, c.name, 22), h('span', c.name)]), cb]));
      });
      body.appendChild(SP.logoNotice());
    }
    draw();
    U.modal({ title: L('My teams and competitions'), body: body, cls: 'sheet-dlg.sp-sheet-dlg', onClose: function () { if (after) after(); } });
  }
})();
