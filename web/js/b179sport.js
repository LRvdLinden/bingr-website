/*
 * Build 179 (#7, #8): live scores, standen en teamkleuren in Sport (sport.js). Bron: de openbare JSON van ESPN
 * (site.api.espn.com, geen sleutel), rechtstreeks vanuit de browser. Weigert de browser het (CORS) of faalt het, dan
 * blijft Sport zoals het was: zonder scores, met de vaste kleuren (geen eigen proxy, zie het contract).
 * Cache in het geheugen: scores 60 s (data besparen 300 s), standen 1 uur. Regels in build179.js.
 */
(function () {
  'use strict';
  var B = window.B, P = B.b179, SL = B.sportLogic;
  var SC = B.sportScores = {};
  var boards = {};    // league → {at, events, fail}
  var tables = {};    // league → {at, groups, fail}
  var inflight = {}, off = 0;
  var logoColors = {};

  function saver() { try { return !!(B.b176ui && B.b176ui.saver()); } catch (e) { return false; } }
  function getJSON(url) {
    var ctl = window.AbortController ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, 12000) : null;
    return fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (t) clearTimeout(t); if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .catch(function (e) { if (t) clearTimeout(t); throw e; });
  }

  /** ESPN-competities voor deze wedstrijden (en gevolgde competities). */
  SC.leagues = function (groups) {
    var out = [];
    function add(id) { var l = P.espnLeague(id); if (l && out.indexOf(l) < 0) out.push(l); }
    (groups || []).forEach(function (g) { add(g.match.competitionId); });
    try { B.data.setList('favoriteCompetitions').forEach(add); } catch (e) { /* stil */ }
    return out;
  };
  /** Scores ophalen voor de competities (vandaag); fouten stil. */
  SC.refresh = function (groups) {
    if (Date.now() < off) return Promise.resolve(false);
    var ttl = (saver() ? P.SCORES_TTL_SAVER : P.SCORES_TTL) * 1000, now = Date.now(), day = P.ymd(now);
    var jobs = SC.leagues(groups).filter(function (l) { var b = boards[l]; return !b || (b.day !== day) || now - b.at >= (b.fail ? 600000 : ttl); });
    if (!jobs.length) return Promise.resolve(false);
    return Promise.all(jobs.map(function (l) {
      if (inflight['s' + l]) return inflight['s' + l];
      var p = getJSON(P.scoreboardURL(l, day)).then(function (j) {
        boards[l] = { at: Date.now(), day: day, events: P.parseScoreboard(j, l) };
        return true;
      }, function (e) {
        // TypeError = de browser liet het niet toe (CORS/netwerk): een tijd niet meer proberen
        boards[l] = { at: Date.now(), day: day, events: (boards[l] && boards[l].events) || [], fail: true };
        if (e && e.name === 'TypeError') off = Date.now() + 15 * 60000;
        B.log('scores ' + l + ': niet beschikbaar', e && e.message);
        return false;
      });
      inflight['s' + l] = p.then(function (v) { delete inflight['s' + l]; return v; });
      return inflight['s' + l];
    })).then(function (r) {
      var any = r.some(Boolean);
      if (any) B.emit('sportScores');
      return any;
    });
  };
  SC.available = function () { return Object.keys(boards).some(function (l) { return !boards[l].fail; }); };
  function allEvents() {
    var out = [];
    Object.keys(boards).forEach(function (l) { out = out.concat(boards[l].events || []); });
    return out;
  }
  SC.events = allEvents;
  /** ESPN-wedstrijd bij een groep uit de gids (espnLink), of null. */
  SC.eventFor = function (g) {
    if (!g || g.match.kind !== 'duel') return null;
    var evs = allEvents();
    if (!evs.length) return null;
    var id = P.espnLink({ home: g.match.home, away: g.match.away, start: Math.floor(g.start / 1000) },
      evs.map(function (e) { return { id: e.league + '|' + e.id, home: e.home.names, away: e.away.names, start: e.start }; }), SL.teamKey);
    if (!id) return null;
    for (var i = 0; i < evs.length; i++) if (evs[i].league + '|' + evs[i].id === id) return evs[i];
    return null;
  };
  /** Stand ("2–1 · 67'") en of hij afgelopen is. */
  SC.score = function (ev) { return ev ? { text: P.eventScore(ev), final: ev.state === 'post', live: ev.state === 'in' } : null; };
  /** ESPN-wedstrijden van vandaag die niet aan de gids gekoppeld zijn (alleen gevolgde competities/teams). */
  SC.notInGuide = function (groups) {
    var linked = {};
    (groups || []).forEach(function (g) { var ev = SC.eventFor(g); if (ev) linked[ev.league + '|' + ev.id] = 1; });
    var comps = [], teams = [];
    try { comps = B.data.setList('favoriteCompetitions').map(P.espnLeague).filter(Boolean); teams = B.data.setList('favoriteTeams'); } catch (e) { /* stil */ }
    return allEvents().filter(function (ev) {
      if (linked[ev.league + '|' + ev.id]) return false;
      if (comps.indexOf(ev.league) >= 0) return true;
      return teams.some(function (t) { return [ev.home, ev.away].some(function (x) { return x.names.some(function (n) { return P.teamEq(t, n, SL.teamKey); }); }); });
    }).sort(function (a, b) { return a.start - b.start; });
  };

  // MARK: standen

  SC.standings = function (league) {
    var t = tables[league];
    if (t && Date.now() - t.at < (t.fail ? 600000 : P.STANDINGS_TTL * 1000)) return Promise.resolve(t.groups || []);
    if (saver() && t) return Promise.resolve(t.groups || []);
    if (Date.now() < off) return Promise.resolve([]);
    if (!inflight['t' + league]) {
      inflight['t' + league] = getJSON(P.standingsURL(league)).then(function (j) {
        var g = P.parseStandings(j);
        tables[league] = { at: Date.now(), groups: g };
        return g;
      }, function (e) {
        tables[league] = { at: Date.now(), groups: (t && t.groups) || [], fail: true };
        if (e && e.name === 'TypeError') off = Date.now() + 15 * 60000;
        return tables[league].groups;
      }).then(function (g) { delete inflight['t' + league]; return g; });
    }
    return inflight['t' + league];
  };

  // MARK: 8. teamkleuren

  /** ESPN-team (uit de scores) met deze naam. */
  function espnTeam(name) {
    var evs = allEvents();
    for (var i = 0; i < evs.length; i++) {
      var sides = [evs[i].home, evs[i].away];
      for (var j = 0; j < 2; j++) if (sides[j].names.some(function (n) { return P.teamEq(name, n, SL.teamKey); })) return sides[j];
    }
    return null;
  }
  function logoAverage(url) {
    if (!url || Object.prototype.hasOwnProperty.call(logoColors, url)) return;
    logoColors[url] = null;
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = function () {
      try {
        var c = document.createElement('canvas'); c.width = c.height = 24;
        var x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 24);
        logoColors[url] = P.averageColor(x.getImageData(0, 0, 24, 24).data);
        if (logoColors[url]) B.emit('sportScores');
      } catch (e) { /* CORS: geen logokleur */ }
    };
    img.src = url;
  }
  /** Kleur (hex zonder #) voor de kaart van een team: teamColor met de vaste kleur van build 172 als terugval. */
  SC.teamColor = function (name) {
    var t = espnTeam(name), fallback = ('000000' + SL.color(name).toString(16)).slice(-6);
    var cands = [];
    if (t) {
      cands = [t.color, t.alt];
      if (t.logo && !saver()) { logoAverage(t.logo); cands.push(logoColors[t.logo] || null); }
    }
    return P.teamColor(cands, fallback);
  };
})();
