/*
 * Build 179 (versie 1.0.8): pure logica van de webspeler, zonder DOM, opslag of netwerk (getest in
 * tools/test/build179_test.js met de gedeelde gevallen uit docs/build179_cases.json van iptv-ios-appletv).
 * Contract: docs/ACCOUNT.md van iptv-ios-appletv, sectie "Build 179". Zelf gebouwd vanaf de bestaande Bingr-code.
 * - 1: servers en tv-gids vanzelf verversen (termijn per apparaat, data besparen);
 * - 3: automatisch een andere speler proberen (hls.js / mpegts.js / eigen speler van de browser), onthouden per stream;
 * - 5: Zappen-lijst met categorieën en zoeken;
 * - 7: live scores en standen (ESPN), koppelen aan de wedstrijden uit de gids;
 * - 8: kaarten in de kleur van het team (met contrast);
 * - 9: beoordelingen (server-functie `ratings`);
 * - 10: intro en samenvatting overslaan (IntroDB);
 * - 11: "Voor jou" met duim omhoog/omlaag;
 * - 12: sorteren per categorie;
 * - 13: titels opruimen die de aanbieder verwijderd heeft;
 * - 16: WebDAV als bron (namen herkennen, PROPFIND lezen).
 */
(function (root) {
  'use strict';
  var B = root.B = root.B || {};
  var P = B.b179 = {};
  var HOUR = 3600000, DAY = 86400000;

  function own(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }
  function str(v) { return v == null ? '' : String(v); }
  function lower(v) { return str(v).toLowerCase(); }
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
  function time(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
    var t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }
  P.time = time;

  var EXTRA = { 'ß': 'ss', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ł': 'l', 'đ': 'd', 'ı': 'i', 'þ': 'th' };
  /** Kleine letters zonder accenten. */
  function fold(s) {
    s = str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    var out = '';
    for (var i = 0; i < s.length; i++) { var c = s[i]; out += own(EXTRA, c) ? EXTRA[c] : c; }
    return out;
  }
  P.fold = fold;

  /** norm (build 176 epgSearch): kleine letters, zonder accenten, alles wat geen letter of cijfer is wordt een spatie. */
  var NONWORD = (function () { try { return new RegExp('[^\\p{L}\\p{N}]+', 'gu'); } catch (e) { return /[^a-z0-9À-￿]+/g; } })();
  P.norm = function (s) { return fold(s).replace(NONWORD, ' ').replace(/\s+/g, ' ').trim(); };

  // MARK: 1. vanzelf verversen (per apparaat; contract: refresh)

  P.CATALOG = { '6h': 21600, daily: 86400, '3d': 259200, weekly: 604800, manual: null };
  P.CATALOG_ORDER = ['6h', 'daily', '3d', 'weekly', 'manual'];
  P.EPG = { '6h': 21600, '12h': 43200, daily: 86400 };
  P.EPG_ORDER = ['6h', '12h', 'daily'];
  P.catalogValue = function (v) { return own(P.CATALOG, v) ? v : 'daily'; };
  P.epgValue = function (v) { return own(P.EPG, v) ? v : '6h'; };
  /** due(i, last) = i != manual && (last == null || now - last >= i || last - now > 3600); tijden in seconden. */
  P.due = function (secs, last, now) {
    if (secs == null) return false;
    if (last == null) return true;
    return now - last >= secs || last - now > 3600;
  };
  /** 'full' | 'epg' | 'none' | 'blocked' (seconden; last* null = nooit). */
  P.refreshAction = function (catalog, epg, lastFull, lastEpg, now, saver, cellular) {
    var full = P.due(P.CATALOG[P.catalogValue(catalog)], lastFull, now);
    var le = lastEpg == null ? lastFull : (lastFull == null ? lastEpg : Math.max(lastEpg, lastFull));
    var g = P.due(P.EPG[P.epgValue(epg)], le, now);
    var out = full ? 'full' : (g ? 'epg' : 'none');
    if (out !== 'none' && saver && !cellular) return 'blocked';
    return out;
  };
  P.CHECK_MS = 15 * 60000;

  // MARK: 3. automatisch een andere speler (web: hls / mpegts / native)

  P.WEB_ENGINES = ['hls', 'mpegts', 'native'];
  P.MEMO_MAX = 500;
  P.MEMO_DAYS = 60;
  /** engineFirst: onthouden engine (als die in de volgorde staat), anders de eerste. */
  P.engineFirst = function (order, memo) { return memo != null && order.indexOf(memo) >= 0 ? memo : (order[0] || null); };
  /** engineSwitch (seconden): !switched && ((error && played < 10) || (!firstFrame && sinceStart >= 10) || (firstFrame && stalled >= 10 && played < 30)). */
  P.engineSwitch = function (error, firstFrame, sinceStart, stalled, played, switched) {
    if (switched) return false;
    return (!!error && played < 10) || (!firstFrame && sinceStart >= 10) || (!!firstFrame && stalled >= 10 && played < 30);
  };
  /** engineNext: de eerste in de volgorde die niet de huidige is; al gewisseld = null. */
  P.engineNext = function (order, current, switched) {
    if (switched) return null;
    for (var i = 0; i < order.length; i++) if (order[i] !== current) return order[i];
    return null;
  };
  /** engineMemo: gelukt = de engine die speelt; anders wissen (null). */
  P.engineMemo = function (memo, startedWith, switchedTo, ok) { void memo; return ok ? (switchedTo || startedWith) : null; };
  /** Sleutel: live "<server>|<stream-id>", film "<server>|movie:<id>", aflevering "<server>|episode:<id>". */
  P.memoKey = function (sid, item) {
    if (!item) return '';
    var s = lower(sid);
    if (item.channel && item.channel.id != null) return s + '|' + item.channel.id;
    if (item.type === 'movie') return s + '|movie:' + item.id;
    if (item.type === 'episode') return s + '|episode:' + item.id;
    return '';
  };
  /** Engine van een poging (stap van player.js: 'direct' = de eigen speler van de browser). */
  P.engineOf = function (how) { return how === 'direct' ? 'native' : how; };
  P.stepsFor = function (steps, engine) { var how = engine === 'native' ? 'direct' : engine; return (steps || []).filter(function (s) { return s && s.how === how; }); };
  /** Volgorde van de engines uit de pogingen van player.js (eerste voorkomen). */
  P.orderOf = function (steps) {
    var out = [];
    (steps || []).forEach(function (s) { var e = s && P.engineOf(s.how); if (e && P.WEB_ENGINES.indexOf(e) >= 0 && out.indexOf(e) < 0) out.push(e); });
    return out;
  };
  /** Pogingen met deze engine eerst (de rest in dezelfde volgorde). */
  P.startWith = function (steps, engine) {
    if (!engine) return steps;
    var how = engine === 'native' ? 'direct' : engine, first = [], rest = [];
    (steps || []).forEach(function (s) { (s && s.how === how ? first : rest).push(s); });
    return first.length ? first.concat(rest) : steps;
  };
  /** Geheugen {key: {e, at}} bijwerken (null = wissen); max. 500, ouder dan 60 dagen weg. now in ms. */
  P.memoPut = function (mem, key, engine, now) {
    var out = {};
    Object.keys(mem || {}).forEach(function (k) { var v = mem[k]; if (v && v.e && now - v.at < P.MEMO_DAYS * DAY) out[k] = v; });
    if (key) { if (engine) out[key] = { e: engine, at: now }; else delete out[key]; }
    var keys = Object.keys(out);
    if (keys.length > P.MEMO_MAX) keys.sort(function (a, b) { return out[b].at - out[a].at; }).slice(P.MEMO_MAX).forEach(function (k) { delete out[k]; });
    return out;
  };

  // MARK: 5. Zappen-lijst

  /** zapCategories: '*favorites' (als er favorieten zijn) en de categorieën in volgorde van eerste voorkomen. */
  P.zapCategories = function (groups, favs) {
    var out = [], seen = {};
    if ((favs || []).some(Boolean)) out.push('*favorites');
    (groups || []).forEach(function (g) { var k = str(g); if (k && !own(seen, k)) { seen[k] = 1; out.push(k); } });
    return out;
  };
  /** zapSearch: indexen van de zenders [{name, number}] die bij de zoekterm passen. */
  P.zapSearch = function (q, channels) {
    var t = str(q).trim(), all = (channels || []).map(function (c, i) { return i; });
    if (!t) return all;
    if (/^\d+$/.test(t)) {
      var byNum = all.filter(function (i) { var n = channels[i].number; return n != null && String(n) === String(parseInt(t, 10)); });
      if (byNum.length) return byNum;
      return all.filter(function (i) { return P.norm(channels[i].name).replace(/ /g, '').indexOf(t) >= 0; });
    }
    var words = P.norm(t).split(' ').filter(function (w) { return w.length >= 2 || /^\d+$/.test(w); });
    if (!words.length) return all;
    return all.filter(function (i) {
      var n = P.norm(channels[i].name);
      for (var j = 0; j < words.length; j++) if (n.indexOf(words[j]) < 0) return false;
      return true;
    });
  };

  // MARK: 7. live scores en standen (ESPN)

  P.SCORES_TTL = 60;
  P.SCORES_TTL_SAVER = 300;
  P.STANDINGS_TTL = 3600;
  P.LINK_SECS = 900;
  P.LEAGUES = {
    eredivisie: 'soccer/ned.1', kkd: 'soccer/ned.2', 'knvb-beker': 'soccer/ned.cup', 'champions-league': 'soccer/uefa.champions',
    'europa-league': 'soccer/uefa.europa', 'conference-league': 'soccer/uefa.europa.conf', 'premier-league': 'soccer/eng.1',
    laliga: 'soccer/esp.1', 'serie-a': 'soccer/ita.1', bundesliga: 'soccer/ger.1', 'ligue-1': 'soccer/fra.1',
    'jupiler-pro-league': 'soccer/bel.1', nba: 'basketball/nba', nfl: 'football/nfl', nhl: 'hockey/nhl'
  };
  /** ESPN-competitie van een competitie-id (build 172), of null (dan geen scores). */
  P.espnLeague = function (competitionId) { return own(P.LEAGUES, competitionId) ? P.LEAGUES[competitionId] : null; };
  P.scoreboardURL = function (league, ymd) {
    return 'https://site.api.espn.com/apis/site/v2/sports/' + league + '/scoreboard' + (ymd ? '?dates=' + ymd : '');
  };
  P.standingsURL = function (league) { return 'https://site.api.espn.com/apis/v2/sports/' + league + '/standings'; };
  P.ymd = function (ms) {
    var d = new Date(ms);
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate());
  };

  /** teamEq: teamKey gelijk, of de kortste (≥ 3) is het begin van de langste, of de kortste (≥ 5) staat in de langste. */
  P.teamEq = function (a, b, keyFn) {
    var x = keyFn(a), y = keyFn(b);
    if (!x || !y) return false;
    if (x === y) return true;
    var s = x.length <= y.length ? x : y, l = x.length <= y.length ? y : x;
    if (s.length >= 3 && l.indexOf(s) === 0) return true;
    return s.length >= 5 && l.indexOf(s) >= 0;
  };
  function anyEq(name, names, keyFn) {
    for (var i = 0; i < (names || []).length; i++) if (names[i] && P.teamEq(name, names[i], keyFn)) return true;
    return false;
  }
  /** espnLink: guide {home, away, start}, events [{id, home: [namen], away: [namen], start}] (seconden) → id of null. */
  P.espnLink = function (guide, events, keyFn) {
    var best = null, bestD = Infinity;
    (events || []).forEach(function (ev) {
      var d = Math.abs(ev.start - guide.start);
      if (d > P.LINK_SECS) return;
      var ok = (anyEq(guide.home, ev.home, keyFn) && anyEq(guide.away, ev.away, keyFn)) ||
        (anyEq(guide.home, ev.away, keyFn) && anyEq(guide.away, ev.home, keyFn));
      if (ok && d < bestD) { best = ev.id; bestD = d; }
    });
    return best;
  };
  /** scoreText: in "2–1 · 67'", post "2–1", anders null. */
  P.scoreText = function (state, home, away, clock) {
    if ((state !== 'in' && state !== 'post') || home == null || away == null) return null;
    var s = home + '–' + away;
    var c = str(clock).trim();
    return state === 'in' && c ? s + ' · ' + c : s;
  };

  function hex(c) {
    if (c == null) return null;
    var s = str(c).trim().replace(/^#/, '');
    return /^[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null;
  }
  P.hex = hex;
  function teamOf(c) {
    var t = (c && c.team) || {};
    var names = ['displayName', 'shortDisplayName', 'name', 'location', 'abbreviation'].map(function (f) { return t[f]; })
      .filter(function (v) { return typeof v === 'string' && v; });
    var sc = c && c.score;
    if (sc && typeof sc === 'object') sc = sc.displayValue != null ? sc.displayValue : sc.value;
    return { name: str(t.displayName || t.name || t.shortDisplayName), short: str(t.shortDisplayName || t.displayName), abbr: str(t.abbreviation),
      names: names, color: hex(t.color), alt: hex(t.alternateColor), logo: str(t.logo || (t.logos && t.logos[0] && t.logos[0].href)),
      score: sc == null || sc === '' ? null : str(sc) };
  }
  /** Scoreboard-JSON → [{id, league, start (s), state, clock, home, away}]. */
  P.parseScoreboard = function (json, league) {
    var out = [];
    ((json && json.events) || []).forEach(function (ev) {
      var comp = ev && ev.competitions && ev.competitions[0];
      if (!comp || !comp.competitors || comp.competitors.length < 2) return;
      var home = null, away = null;
      comp.competitors.forEach(function (c) { if (c.homeAway === 'home') home = c; else if (c.homeAway === 'away') away = c; });
      if (!home || !away) { home = comp.competitors[0]; away = comp.competitors[1]; }
      var status = ev.status || comp.status || {}, st = status.type || {};
      var start = Math.floor(time(ev.date || comp.date) / 1000);
      if (!start) return;
      out.push({ id: str(ev.id), league: league || '', start: start, state: str(st.state), clock: str(status.displayClock),
        home: teamOf(home), away: teamOf(away) });
    });
    return out;
  };
  /** Stand-tekst van een ESPN-wedstrijd. */
  P.eventScore = function (ev) { return ev ? P.scoreText(ev.state, ev.home.score, ev.away.score, ev.clock) : null; };
  /** Standen-JSON → [{name, rows: [{rank, team, logo, played, points}]}]. */
  P.parseStandings = function (json) {
    var groups = [];
    function stat(stats, names) {
      for (var i = 0; i < (stats || []).length; i++) {
        var s = stats[i];
        if (s && (names.indexOf(s.name) >= 0 || names.indexOf(s.type) >= 0)) return s.value != null ? s.value : num(s.displayValue);
      }
      return null;
    }
    function add(name, standings) {
      var entries = (standings && standings.entries) || [];
      if (!entries.length) return;
      var rows = entries.map(function (e, i) {
        var t = e.team || {}, st = e.stats || [];
        var rank = stat(st, ['rank', 'playoffSeed']);
        return { rank: rank != null ? rank : i + 1, team: str(t.displayName || t.name || t.shortDisplayName),
          logo: str(t.logos && t.logos[0] && t.logos[0].href), played: stat(st, ['gamesPlayed']), points: stat(st, ['points']),
          won: stat(st, ['wins']), lost: stat(st, ['losses']) };
      });
      rows.sort(function (a, b) { return a.rank - b.rank; });
      groups.push({ name: str(name), rows: rows });
    }
    if (json && json.standings) add(json.name || json.abbreviation, json.standings);
    ((json && json.children) || []).forEach(function (c) { add(c.name || c.abbreviation, c.standings); });
    return groups;
  };

  // MARK: 8. kaarten in de kleuren van het team

  function rgb(h) { return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function toHex(c) { return c.map(function (v) { var x = Math.max(0, Math.min(255, v)).toString(16); return x.length < 2 ? '0' + x : x; }).join(''); }
  P.luminance = function (h) {
    var l = rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  };
  /** Contrast met wit (WCAG 2.1): 1.05 / (L + 0.05). */
  P.contrastWhite = function (h) { var x = hex(h); return x ? 1.05 / (P.luminance(x) + 0.05) : 0; };
  P.contrast = function (h) { return Math.round(P.contrastWhite(h) * 100) / 100; };
  /** teamColor: de eerste kandidaat met contrast ≥ 4.5, anders de eerste donkerder (1 − 0.1·k), anders 000000; geen kandidaten = terugval. */
  P.teamColor = function (cands, fallback) {
    var valid = (cands || []).map(hex).filter(Boolean);
    for (var i = 0; i < valid.length; i++) if (P.contrastWhite(valid[i]) >= 4.5) return valid[i];
    if (valid.length) {
      var c = rgb(valid[0]);
      for (var k = 1; k <= 9; k++) {
        var f = 1 - 0.1 * k;
        var d = toHex(c.map(function (v) { return Math.round(v * f); }));
        if (P.contrastWhite(d) >= 4.5) return d;
      }
      return '000000';
    }
    return hex(fallback) || '000000';
  };
  /** Gemiddelde kleur van RGBA-pixels, alleen niet-transparante; null zonder pixels. */
  P.averageColor = function (data) {
    var r = 0, g = 0, b = 0, n = 0;
    for (var i = 0; i + 3 < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    return n ? toHex([Math.round(r / n), Math.round(g / n), Math.round(b / n)]) : null;
  };

  // MARK: 9. beoordelingen

  P.RATING_ORDER = ['imdb', 'tomatoes', 'tomatoesaudience', 'metacritic', 'letterboxd', 'trakt', 'tmdb'];
  /** Eén decimaal zoals printf (%.1f): exacte helften naar even. */
  function oneDecimal(v) {
    var x = v * 10, f = Math.floor(x);
    if (x - f === 0.5) return ((f % 2 === 0 ? f : f + 1) / 10).toFixed(1);
    return v.toFixed(1);
  }
  /** ratingText: imdb/tmdb/letterboxd één decimaal, tomatoes/tomatoesaudience/trakt %, metacritic geheel; anders null. */
  P.ratingText = function (source, value) {
    var v = num(value);
    if (v == null) return null;
    if (source === 'imdb' || source === 'tmdb' || source === 'letterboxd') return oneDecimal(v);
    if (source === 'tomatoes' || source === 'tomatoesaudience' || source === 'trakt') return Math.round(v) + '%';
    if (source === 'metacritic') return String(Math.round(v));
    return null;
  };
  P.RATINGS_DAYS = 7;

  // MARK: 10. IntroDB

  P.INTRO_DAYS = 30;
  P.INTRO_MISS_DAYS = 1;
  /** Antwoord van de functie `introdb` → {intro, recap, credits} (seconden) of null. */
  P.introSegments = function (r) {
    if (!r || r.ok !== true) return null;
    function seg(x, needEnd) {
      if (!x || typeof x !== 'object') return null;
      var s = num(x.start), e = num(x.end);
      if (s == null || s < 0) return null;
      if (needEnd && (e == null || e <= s + 1)) return null;
      return { start: s, end: e };
    }
    return { intro: seg(r.intro, true), recap: seg(r.recap, true), credits: seg(r.credits, false) };
  };

  // MARK: 11. Voor jou (profile.<id>.ratings)

  P.FORYOU_MAX = 30;
  P.THUMBS_MAX = 2000;
  P.THUMB_TOMB_DAYS = 90;
  /** forYou: {titles [{key, title, genres, cast, rating}], liked, disliked, watched, blocked, recLiked, recWatched} → keys. */
  P.forYou = function (o) {
    var liked = {}, disliked = {}, watched = {}, blocked = {};
    (o.liked || []).forEach(function (k) { liked[k] = 1; });
    (o.disliked || []).forEach(function (k) { disliked[k] = 1; });
    (o.watched || []).forEach(function (k) { watched[k] = 1; });
    (o.blocked || []).forEach(function (k) { blocked[k] = 1; });
    var genre = {}, cast = {};
    function add(m, k, v) { m[k] = (m[k] || 0) + v; }
    (o.titles || []).forEach(function (t) {
      var g = t.genres || [];
      if (liked[t.key]) {
        g.forEach(function (x) { add(genre, x, 2); });
        (t.cast || []).slice(0, 5).forEach(function (c) { add(cast, c, 1); });
      } else if (disliked[t.key]) g.forEach(function (x) { add(genre, x, -2); });
      else if (watched[t.key]) g.forEach(function (x) { add(genre, x, 1); });
    });
    var recL = o.recLiked || {}, recW = o.recWatched || {};
    var scored = [];
    (o.titles || []).forEach(function (t, i) {
      var k = t.key;
      if (liked[k] || disliked[k] || watched[k] || blocked[k]) return;
      var s = 0;
      (t.genres || []).forEach(function (x) { s += genre[x] || 0; });
      (t.cast || []).slice(0, 5).forEach(function (c) { s += cast[c] || 0; });
      s += 3 * (recL[k] || 0) + (recW[k] || 0);
      if (s > 0) scored.push({ k: k, s: s, r: num(t.rating) || 0, n: P.norm(t.title), i: i });
    });
    scored.sort(function (a, b) { return b.s - a.s || b.r - a.r || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0) || a.i - b.i; });
    return scored.slice(0, P.FORYOU_MAX).map(function (x) { return x.k; });
  };
  /** Sleutel van een titel: tmdb:movie:<id> / tmdb:tv:<id>, anders "<server>|movie:<id>" / "<server>|series:<id>". */
  P.thumbKey = function (type, tmdb, sid, id) {
    var t = num(tmdb);
    if (t && t > 0) return 'tmdb:' + (type === 'series' ? 'tv' : 'movie') + ':' + Math.round(t);
    return lower(sid) + '|' + (type === 'series' ? 'series' : 'movie') + ':' + id;
  };
  /** Twee lijsten [{key, value, at}] samenvoegen: per key de nieuwste at; tombstones (0) na 90 dagen weg; max. 2000. */
  P.mergeThumbs = function (a, b, now) {
    var m = {};
    (a || []).concat(b || []).forEach(function (r) {
      if (!r || !r.key || [1, -1, 0].indexOf(r.value) < 0) return;
      var cur = m[r.key];
      if (!cur || time(r.at) > time(cur.at)) m[r.key] = { key: r.key, value: r.value, at: r.at };
    });
    var out = Object.keys(m).map(function (k) { return m[k]; })
      .filter(function (r) { return r.value !== 0 || now == null || now - time(r.at) < P.THUMB_TOMB_DAYS * DAY; });
    if (out.length > P.THUMBS_MAX) {
      out.sort(function (x, y) { return (x.value === 0 ? 0 : 1) - (y.value === 0 ? 0 : 1) || time(x.at) - time(y.at); });
      out = out.slice(out.length - P.THUMBS_MAX);
    }
    return out;
  };

  // MARK: 12. sorteren per categorie (profile.<id>.categorySort)

  P.SORTS = ['server', 'name', 'year', 'added', 'rating'];
  P.sortValue = function (v) { return P.SORTS.indexOf(v) >= 0 ? v : 'server'; };
  P.sortKey = function (sid, kind, category) { return (sid === '*' ? '*' : lower(sid)) + '|' + kind + '|' + str(category); };
  var ARTICLES = ['the ', 'de ', 'het ', 'een ', 'a ', 'an '];
  P.sortName = function (n) {
    var s = P.norm(n);
    for (var i = 0; i < ARTICLES.length; i++) if (s.indexOf(ARTICLES[i]) === 0) return s.slice(ARTICLES[i].length);
    return s;
  };
  /** sort: indexen; ontbrekend of ≤ 0 achteraan, gelijk = volgorde van de server. items [{name, year, added, rating}]. */
  P.sortIndices = function (mode, items) {
    mode = P.sortValue(mode);
    var idx = (items || []).map(function (x, i) { return i; });
    if (mode === 'server') return idx;
    if (mode === 'name') {
      var names = items.map(function (x) { return P.sortName(x.name); });
      return idx.sort(function (a, b) {
        var x = names[a], y = names[b];
        if (!x !== !y) return x ? -1 : 1;
        return x < y ? -1 : x > y ? 1 : a - b;
      });
    }
    var vals = items.map(function (x) { var v = num(x[mode]); return v != null && v > 0 ? v : null; });
    return idx.sort(function (a, b) {
      var x = vals[a], y = vals[b];
      if ((x == null) !== (y == null)) return x == null ? 1 : -1;
      if (x != null && x !== y) return y - x;
      return a - b;
    });
  };
  /** sortMerge: per sleutel de nieuwste at (gelijk: a blijft). */
  P.sortMerge = function (a, b) {
    var out = {};
    Object.keys(a || {}).forEach(function (k) { if (a[k] && typeof a[k] === 'object') out[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) {
      var v = b[k];
      if (!v || typeof v !== 'object') return;
      if (!out[k] || time(v.at) > time(out[k].at)) out[k] = v;
    });
    return out;
  };

  // MARK: 13. opruimen

  /** cleanupAllowed: complete && new > 0 && !(old >= 100 && new < old · 0.5) (films + series). */
  P.cleanupAllowed = function (before, after, complete) { return !!complete && after > 0 && !(before >= 100 && after < before * 0.5); };
  /** cleanupAction: keep / remap / remove. */
  P.cleanupAction = function (onServer, elsewhere) { return onServer ? 'keep' : (elsewhere ? 'remap' : 'remove'); };

  // MARK: 16. WebDAV

  P.VIDEO_EXT = ['mkv', 'mp4', 'm4v', 'avi', 'mov', 'wmv', 'ts', 'm2ts', 'webm', 'mpg', 'mpeg', 'flv'];
  var QUALITY = ['2160p', '1080p', '1080i', '720p', '576p', '480p', '4k', 'uhd', 'fhd', 'hd', 'x264', 'x265', 'h264', 'h265', 'h 264', 'h 265',
    'hevc', 'avc', 'web-dl', 'webdl', 'web', 'webrip', 'bluray', 'blu-ray', 'brrip', 'bdrip', 'dvdrip', 'dvd', 'hdtv', 'hdr', 'hdr10',
    'dv', 'remux', 'proper', 'repack', '10bit', '8bit', 'aac', 'ac3', 'dts', 'ddp5', 'atmos', 'xvid', 'divx', 'extended', 'unrated', 'nl', 'subs'];
  var GENERIC = ['movie', 'film', 'video', 'feature', 'main'];
  var SEASON_DIR = /^(?:season|seizoen|staffel|saison)\s*(\d{1,3})$|^s(\d{1,3})$/i;
  function decode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  /** Opschonen: [..] weg, ./_ → spatie, haakjes weg, afkappen bij het eerste kwaliteitswoord. */
  function clean(s) {
    s = str(s).replace(/\[[^\]]*\]/g, ' ').replace(/[._]+/g, ' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    var words = s.split(' '), out = [];
    for (var i = 0; i < words.length; i++) {
      if (i > 0 && QUALITY.indexOf(words[i].toLowerCase()) >= 0) break;
      out.push(words[i]);
    }
    return out.join(' ').replace(/^[\s\-–]+|[\s\-–]+$/g, '').trim();
  }
  /** Laatste jaartal 1900–2099 dat niet vooraan staat: {title, year}. */
  function splitYear(s) {
    var words = s.split(' ');
    for (var i = words.length - 1; i >= 1; i--) {
      if (/^(19|20)\d\d$/.test(words[i])) return { title: words.slice(0, i).join(' ').replace(/[\s\-–]+$/, '').trim(), year: parseInt(words[i], 10) };
    }
    return { title: s, year: null };
  }
  function seriesName(dir) { return clean(str(dir).replace(/\(\s*(19|20)\d\d\s*\)/g, ' ')); }
  /** webdavParse: pad → {kind: movie/episode/other, title, year, season, episode}. */
  P.webdavParse = function (path) {
    var parts = decode(str(path)).split('/').filter(Boolean);
    if (!parts.length) return { kind: 'other' };
    var file = parts[parts.length - 1], dot = file.lastIndexOf('.');
    if (dot <= 0 || P.VIDEO_EXT.indexOf(file.slice(dot + 1).toLowerCase()) < 0) return { kind: 'other' };
    var stem = file.slice(0, dot), parent = parts.length > 1 ? parts[parts.length - 2] : '', grand = parts.length > 2 ? parts[parts.length - 3] : '';
    var sd = SEASON_DIR.exec(parent.trim());
    var m = /(^|[^a-z0-9])s(\d{1,3})[ ._-]?e(\d{1,4})(?![0-9])/i.exec(stem) || null, season = null, episode = null, prefix = null;
    if (m) { season = +m[2]; episode = +m[3]; prefix = stem.slice(0, m.index); }
    else {
      var x = /(^|[^0-9a-z])(\d{1,2})x(\d{2,3})(?![0-9])/i.exec(stem);
      if (x) { season = +x[2]; episode = +x[3]; prefix = stem.slice(0, x.index); }
      else if (sd) {
        var e = /^\s*(?:e|ep|episode|aflevering|afl)\s*\.?\s*(\d{1,4})(?![0-9])/i.exec(stem) || /^\s*(\d{1,4})(?![0-9])/.exec(stem);
        if (e) { season = +(sd[1] || sd[2]); episode = +e[1]; prefix = ''; }
      }
    }
    if (episode != null) {
      var title = clean(prefix);
      if (!title) title = sd ? seriesName(grand) : seriesName(parent);
      return { kind: 'episode', title: title, year: null, season: season, episode: episode };
    }
    var own1 = splitYear(clean(stem));
    var generic = GENERIC.indexOf(clean(stem).toLowerCase()) >= 0;
    if ((generic || own1.year == null) && parent) {
      var up = splitYear(clean(parent));
      if (up.year != null) return { kind: 'movie', title: up.title, year: up.year };
    }
    return { kind: 'movie', title: own1.title, year: own1.year };
  };
  /** PROPFIND-antwoord (multistatus XML) → [{href, dir, size, modified}], zonder de map zelf. */
  P.parsePropfind = function (xml, selfHref) {
    var out = [];
    var re = /<(?:[a-z0-9]+:)?response\b[\s\S]*?<\/(?:[a-z0-9]+:)?response>/gi, m;
    var self = selfHref ? decode(selfHref).replace(/\/+$/, '') : null;
    while ((m = re.exec(str(xml)))) {
      var r = m[0];
      var href = /<(?:[a-z0-9]+:)?href[^>]*>([\s\S]*?)<\/(?:[a-z0-9]+:)?href>/i.exec(r);
      if (!href) continue;
      var h = href[1].trim().replace(/&amp;/g, '&');
      var dir = /<(?:[a-z0-9]+:)?collection\b/i.test(r);
      var size = /<(?:[a-z0-9]+:)?getcontentlength[^>]*>(\d+)</i.exec(r);
      var mod = /<(?:[a-z0-9]+:)?getlastmodified[^>]*>([^<]+)</i.exec(r);
      var path = decode(h.replace(/^https?:\/\/[^\/]+/i, '')).replace(/\/+$/, '');
      if (self != null && path === self) continue;
      out.push({ href: h, dir: dir, size: size ? +size[1] : null, modified: mod ? time(mod[1].trim()) : 0 });
    }
    return out;
  };

  // MARK: X2. live stream: opnieuw verbinden en de reden van de laatste stop (zoals Stream179 op Apple, ba0a666)

  P.LIVE_DELAYS = [0.5, 1.5, 3, 5, 8];   // live met beeld gehad: snel, daarna rustiger
  P.COLD_DELAYS = [1.5, 3];               // live zonder ooit beeld
  P.VOD_DELAYS = [1.5];                   // films en series: één stille poging
  P.OUTAGE_MAX = 45;                      // één storing (alle pogingen samen) hooguit zo lang
  P.STABLE_SECONDS = 10;                  // zo lang stabiel beeld en de pogingen tellen weer vanaf nul
  /** Wachttijd (s) vóór poging `attempt` (0 = de eerste); null = opgeven (back-upbron of foutmelding). */
  P.retryDelay = function (attempt, live, hadPicture, outage) {
    if (outage != null && outage > P.OUTAGE_MAX) return null;
    var list = !live ? P.VOD_DELAYS : (hadPicture ? P.LIVE_DELAYS : P.COLD_DELAYS);
    return attempt >= 0 && attempt < list.length ? list[attempt] : null;
  };
  P.STOP_REASONS = ['serverClosed', 'error', 'timeout', 'gaveUp', 'limit', 'remotePause'];
  /** Waarom greep de speler in? null = geen storing. */
  P.stopReason = function (error, ended, live, stalledFor) {
    if (error) return 'error';
    if (ended && live) return 'serverClosed';
    if (live && stalledFor > 15) return 'timeout';
    return null;
  };
  /** Nieuwste eerst, hooguit `keep`. */
  P.pushStop = function (list, stop, keep) {
    var out = [stop].concat(Array.isArray(list) ? list : []);
    return out.slice(0, keep || 10);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
