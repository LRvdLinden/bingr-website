/*
 * Build 164: pure logica van de tv-gids (zonder DOM), gelijk aan GuideLogic op Apple en Android:
 * dagbalk, NU-index, stand van een programma, het kiezen van een stilstaand beeld en de instelling
 * "Live voorbeeld in de gids". Unittests: node tools/test/guide_test.js
 */
(function (root) {
  'use strict';
  var B = root.B = root.B || {};
  var G = B.guideLogic = {};

  var DAY = 86400000;
  G.STILL_MAX_AGE = 30 * 60000;   // stilstaand beeld hooguit 30 min oud
  G.STILL_MAX = 200;              // hooguit 200 zenders, de oudste eerst weg
  G.FORWARD_DAYS = 7;             // t/m 7 dagen vooruit
  G.MAX_BACK_DAYS = 7;            // verder terug alleen met terugkijken (max. de terugkijkdagen, hooguit 7)

  /** Middernacht (lokale tijd) van de dag van `ms`, plus `offset` dagen (ook goed over zomer-/wintertijd). */
  G.dayStart = function (ms, offset) {
    var d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    if (offset) d.setDate(d.getDate() + offset);
    return d.getTime();
  };

  /**
   * Terugkijkdagen van de zenders in beeld: de grootste `catchupDays` (hooguit MAX_BACK_DAYS), 0 zonder terugkijken.
   */
  G.backDays = function (channels) {
    var n = 0;
    (channels || []).forEach(function (c) {
      var d = c && +c.catchupDays;
      if (d > n) n = d;
    });
    return Math.min(G.MAX_BACK_DAYS, Math.floor(n));
  };

  /**
   * Dagbalk: gisteren t/m 7 dagen vooruit; verder terug alleen met terugkijken (backDays > 1).
   * → [{offset, start, end}] met offset 0 = vandaag.
   */
  G.days = function (now, backDays, forward) {
    var back = Math.max(1, Math.floor(backDays || 0));
    var fwd = forward == null ? G.FORWARD_DAYS : forward;
    var out = [];
    for (var o = -back; o <= fwd; o++) out.push({ offset: o, start: G.dayStart(now, o), end: G.dayStart(now, o + 1) });
    return out;
  };

  G.DAY_SAMPLE = 50;              // build 166: zoveel zenders kijken we hooguit na voor de dagbalk

  /**
   * Build 166: steekproef voor de dagbalk: eerst `first` (bijv. de gekozen zender), dan de eerste zenders van de lijst,
   * zonder dubbele en hooguit `max` (standaard DAY_SAMPLE).
   */
  G.daySample = function (channels, first, max) {
    var m = max == null ? G.DAY_SAMPLE : max, out = [];
    if (first && m > 0) out.push(first);
    for (var i = 0; i < (channels || []).length && out.length < m; i++) if (channels[i] !== first) out.push(channels[i]);
    return out;
  };

  /**
   * Build 166: alleen dagen waarvoor er gids-info is. `hasGuide(ch, day)` = er staat minstens één programma op die dag.
   * Vandaag altijd; morgen en later alleen met programma's; gisteren en eerder alleen als een zender op die dag
   * programma's heeft én zo ver terugkijken heeft (`catchupDays`).
   */
  G.availableDays = function (days, channels, hasGuide) {
    var chs = channels || [];
    return (days || []).filter(function (d) {
      if (d.offset === 0) return true;
      return chs.some(function (c) {
        if (d.offset < 0 && !((+(c && c.catchupDays) || 0) >= -d.offset)) return false;
        return !!hasGuide(c, d);
      });
    });
  };

  /** Sleutel voor het label van een dag: 'yesterday' | 'today' | 'tomorrow' | null (dan de weekdag en datum). */
  G.dayKey = function (offset) { return offset === -1 ? 'yesterday' : offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : null; };

  /** Stand van een programma op `now`: 'past' | 'now' | 'next'. */
  G.state = function (p, now) { return p.end <= now ? 'past' : p.start <= now ? 'now' : 'next'; };

  /**
   * Index om naartoe te scrollen: het lopende programma, anders het eerstvolgende, anders het laatste (de hele lijst
   * ligt in het verleden), -1 bij een lege lijst. Lijst gesorteerd op start (binair zoeken).
   */
  G.nowIndex = function (progs, now) {
    if (!progs || !progs.length) return -1;
    var lo = 0, hi = progs.length - 1, at = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (progs[mid].start <= now) { at = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (at >= 0 && progs[at].end > now) return at;
    return at + 1 < progs.length ? at + 1 : progs.length - 1;
  };

  /** Voortgang 0…1 van het lopende programma. */
  G.progress = function (p, now) {
    if (!p || !(p.end > p.start)) return 0;
    return Math.max(0, Math.min(1, (now - p.start) / (p.end - p.start)));
  };
  /** Nog N minuten (naar boven afgerond, minstens 0). */
  G.minutesLeft = function (p, now) { return p ? Math.max(0, Math.ceil((p.end - now) / 60000)) : 0; };

  /**
   * TV-indeling: 2 eerdere programma's, het lopende (of eerstvolgende) en 4 latere.
   * → {before: [...], now: p|null, after: [...]}
   */
  G.window = function (progs, now, before, after) {
    var i = G.nowIndex(progs, now);
    if (i < 0) return { before: [], now: null, after: [] };
    var b = before == null ? 2 : before, a = after == null ? 4 : after;
    return { before: progs.slice(Math.max(0, i - b), i), now: progs[i], after: progs.slice(i + 1, i + 1 + a) };
  };

  // MARK: stilstaand beeld

  /** Bruikbaar stilstaand beeld uit de cache ({at, d}), of null als het er niet is of ouder dan 30 min. */
  G.pickStill = function (entry, now, maxAge) {
    if (!entry || !entry.d || !(entry.at > 0)) return null;
    var age = now - entry.at;
    if (age < 0 || age > (maxAge || G.STILL_MAX_AGE)) return null;
    return entry.d;
  };

  /** Sleutels die weg moeten om hooguit `max` zenders te houden (index = {sleutel: tijd}), de oudste eerst. */
  G.pruneStills = function (index, max) {
    var keys = Object.keys(index || {});
    var limit = max == null ? G.STILL_MAX : max;
    if (keys.length <= limit) return [];
    keys.sort(function (a, b) { return (index[a] || 0) - (index[b] || 0); });
    return keys.slice(0, keys.length - limit);
  };

  /** Sleutel van een zender voor het stilstaande beeld: server + zender-id (zenders van andere servers apart). */
  G.stillKey = function (sourceId, channelId) { return String(sourceId || '').toLowerCase() + '|' + String(channelId == null ? '' : channelId); };

  // MARK: instelling "Live voorbeeld in de gids"

  G.MODES = ['always', 'wifi', 'never'];
  /** Opgeslagen waarde → 'always' | 'wifi' | 'never' (standaard: alleen wifi). */
  G.normalizeMode = function (v) { return G.MODES.indexOf(v) >= 0 ? v : 'wifi'; };

  /**
   * Wat het live vak doet: 'auto' (start vanzelf), 'tap' (pas na een tik) of 'off' (alleen stilstaand beeld).
   * net = {cellular: bool} (mobiel netwerk bekend), tv = tv of computer aan wifi/kabel (Alleen wifi = aan).
   */
  G.previewMode = function (mode, net, tv) {
    var m = G.normalizeMode(mode);
    if (m === 'never') return 'off';
    if (m === 'always' || tv) return 'auto';
    return net && net.cellular ? 'tap' : 'auto';
  };

  /**
   * Build 165: Live TV opent altijd in de tv-gids (ook na een herstart of als je eerder de lijst had); de lijst alleen
   * met ?view=list, dat de knop Zenders/Tv-gids zet en dat alleen binnen Live TV meegaat (geen bewaarde voorkeur).
   */
  G.liveView = function (query) { return query && query.view === 'list' ? 'list' : 'guide'; };
  /** Link naar Live TV in een weergave ('guide' of 'list'), voor een categorie (leeg of '*' = alle zenders). */
  G.liveLink = function (group, view) {
    return '#/live' + (group ? '/' + encodeURIComponent(group) : '') + (view === 'list' ? '?view=list' : '');
  };

  /** Netwerk van de browser (Network Information API; onbekend = geen mobiel netwerk). */
  G.network = function (nav) {
    var c = nav && (nav.connection || nav.mozConnection || nav.webkitConnection);
    if (!c) return { cellular: false };
    return { cellular: c.type === 'cellular' || (!c.type && !!c.saveData) };
  };
})(typeof window !== 'undefined' ? window : globalThis);
