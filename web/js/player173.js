/*
 * Build 173 (versie 1.0.7): pure logica van de webspeler, zonder DOM of netwerk (getest in tools/test/player173_test.js).
 * Dezelfde regels als Shared/Player/Build173Player.swift en Shared/Account/Build173Sync.swift (Apple) en
 * features/Build173PlayerLogic.kt (Android):
 * - 2: "Vanaf het begin" / "Terug naar live" en de vraag bij een programma dat al bezig is (alleen met terugkijken);
 * - 3: volgorde van de Zappen-lijst en Vorige zender;
 * - 4: dubbeltikken (±10 s, vaker tikken telt op);
 * - 6: "Eindigt om" (met de afspeelsnelheid);
 * - 7: ondertitels even aan na kort terugspoelen;
 * - 9: slaaptimer;
 * - 0c: Trakt (welke fout blijvend is, wanneer de waarschuwing komt, nooit een ouder token uit het account) en
 *   OpenSubtitles (stil opnieuw inloggen, alleen uitloggen bij foute gegevens).
 * Tijden in ms, tenzij anders vermeld.
 */
(function () {
  'use strict';
  var B = window.B = window.B || {};
  var P = B.p173 = {};

  // MARK: 2. Vanaf het begin / Terug naar live

  /** Vanaf hoeveel seconden achterstand "Terug naar live" telt */
  P.BEHIND_THRESHOLD = 30;

  /** Knop "Vanaf het begin": terugkijken kan, het programma loopt al minstens een minuut en je zit niet al aan het begin. */
  P.canStartOver = function (hasCatchup, programStart, now, behindLiveSec) {
    if (!hasCatchup || programStart == null || programStart >= now) return false;
    var elapsed = (now - programStart) / 1000;
    return elapsed >= 60 && (behindLiveSec || 0) < elapsed - 30;
  };

  /** Vraag "Vanaf het begin" of "Live kijken": alleen met terugkijken, als het programma ≥ 2 min bezig is en nog ≥ 1 min duurt. */
  P.askStartOver = function (hasCatchup, programStart, programEnd, now) {
    if (!hasCatchup || programStart == null || programEnd == null || programStart >= programEnd) return false;
    return now - programStart >= 120000 && programEnd - now >= 60000;
  };

  /** "Terug naar live" bij terugkijken: het programma loopt nog (de stream is dan per definitie achter). */
  P.canGoLive = function (programEnd, now) { return programEnd != null && programEnd > now; };

  // MARK: 3. Zappen als lijst en Vorige zender

  /** Volgorde (indexen): favorieten, dan de huidige categorie, dan de rest; binnen elk deel de volgorde van de server. */
  P.zapOrder = function (groups, favorite, currentGroup) {
    var fav = [], same = [], rest = [];
    for (var i = 0; i < groups.length; i++) {
      if (favorite[i]) fav.push(i);
      else if (currentGroup != null && groups[i] === currentGroup) same.push(i);
      else rest.push(i);
    }
    return fav.concat(same, rest);
  };

  /** Onthoudt de vorige zender: één tik terug, en nog een tik weer terug. */
  P.PreviousChannel = function (current, previous) { this.current = current == null ? null : current; this.previous = previous == null ? null : previous; };
  P.PreviousChannel.prototype.tuned = function (id) {
    if (id == null || id === this.current) return this;
    this.previous = this.current;
    this.current = id;
    return this;
  };

  // MARK: 4. Dubbeltikken

  P.TAP_STEP = 10;
  P.TAP_WINDOW = 800;
  /** Twee tikken binnen deze tijd = een dubbeltik */
  P.DOUBLE_TAP_MS = 300;
  /** Dubbeltik = 10 s; elke volgende tik binnen TAP_WINDOW aan dezelfde kant telt 10 s op (20, 30 …). */
  P.DoubleTap = function () { this.forward = true; this.total = 0; this.lastAt = -1e15; };
  /** Geeft {total, delta}: de totale sprong (met teken) en wat er nu bij komt. */
  P.DoubleTap.prototype.tap = function (forward, at) {
    var d = forward ? P.TAP_STEP : -P.TAP_STEP;
    if (forward === this.forward && this.total !== 0 && at - this.lastAt <= P.TAP_WINDOW) this.total += d;
    else { this.forward = forward; this.total = d; }
    this.lastAt = at;
    return { total: this.total, delta: d };
  };
  P.DoubleTap.prototype.active = function (at) { return this.total !== 0 && at - this.lastAt <= P.TAP_WINDOW; };
  P.DoubleTap.prototype.reset = function () { this.total = 0; this.lastAt = -1e15; };
  /** Kant van een tik: links of rechts van het midden (x in px, breedte van het beeld). null = in het midden (35–65%). */
  P.tapSide = function (x, width) {
    if (!(width > 0)) return null;
    var f = x / width;
    return f < 0.35 ? 'back' : f > 0.65 ? 'fwd' : null;
  };

  // MARK: 6. Eindtijd

  /** "Eindigt om …": nu + resterende tijd gedeeld door de afspeelsnelheid. null zonder bekende resterende tijd. */
  P.endsAt = function (now, remainingMs, rate) {
    if (!(remainingMs > 0) || !isFinite(remainingMs)) return null;
    var r = rate > 0 ? rate : 1;
    return now + Math.round(remainingMs / r);
  };

  // MARK: 7. Ondertitels even aan na terugspoelen

  /** Kort terugspoelen (10–30 s) met ondertitels uit en een passend spoor: tijdelijk aan. jumpSec negatief = terug. */
  P.rewindSubtitles = function (jumpSec, subtitlesOn, hasTrack, enabled) {
    return !!enabled && !subtitlesOn && !!hasTrack && jumpSec <= -10 && jumpSec >= -30;
  };
  /** Weer voorbij het punt waar je terugspoelde, of daar ver vandaan gesprongen: ondertitels weer uit (seconden). */
  P.rewindSubtitlesDone = function (position, until, startedAt) { return position >= until || position < startedAt - 5; };

  var WORDS = {
    nl: ['dutch', 'nederlands', 'nld', 'dut'], en: ['english', 'engels', 'eng'], de: ['german', 'deutsch', 'duits', 'ger', 'deu'],
    fr: ['french', 'français', 'francais', 'frans', 'fre', 'fra'], es: ['spanish', 'español', 'espanol', 'spaans', 'spa'],
    it: ['italian', 'italiano', 'italiaans', 'ita'], pt: ['portuguese', 'português', 'portugues', 'por'],
    tr: ['turkish', 'türkçe', 'turkce', 'turks', 'tur'], pl: ['polish', 'polski', 'pools', 'pol'], ar: ['arabic', 'العربية', 'arabisch', 'ara'],
    zh: ['chinese', '中文', 'chinees', 'chi', 'zho']
  };
  P.languageWords = function (code) { return WORDS[code] || []; };
  /** Eerste spoor in een van de gewenste talen (volgorde van `wanted`). tracks = taalcode of naam per spoor. */
  P.subtitleTrack = function (tracks, wanted) {
    var want = (wanted || []).map(function (w) { return String(w || '').toLowerCase(); }).filter(Boolean);
    for (var a = 0; a < want.length; a++) {
      var w = want[a], w2 = w.slice(0, 2), words = P.languageWords(w2);
      for (var i = 0; i < tracks.length; i++) {
        var x = String(tracks[i] || '').toLowerCase();
        if (x === w || x === w2 || x.indexOf(w2 + '-') === 0 || x.indexOf(w2 + '_') === 0 || words.some(function (wd) { return x.indexOf(wd) >= 0; })) return i;
      }
    }
    return null;
  };

  // MARK: 9. Slaaptimer

  /** Keuzes in de speler: na deze aflevering (of dit programma), 30/60/90 minuten, uit. */
  P.SLEEP_CHOICES = ['end', 30, 60, 90, 'off'];
  /** Deadline (ms) bij een keuze in minuten; bij live 'end' = einde van het programma volgens de gids. */
  P.sleepDeadline = function (choice, now, programEnd) {
    if (typeof choice === 'number' && choice > 0) return now + choice * 60000;
    if (choice === 'end' && programEnd != null && programEnd > now) return programEnd;
    return null;
  };
  /** Moet de slaaptimer nu stoppen? titleEnded = de aflevering/film is afgelopen. */
  P.sleepDue = function (choice, deadline, now, titleEnded) {
    if (choice == null || choice === 'off') return false;
    if (choice === 'end' && deadline == null) return !!titleEnded;
    return deadline != null && now >= deadline;
  };
  /** Aftellen als "m:ss" of "u:mm:ss". */
  P.countdown = function (ms) {
    var s = Math.max(0, Math.floor((ms + 999) / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    return h > 0 ? h + ':' + two(m) + ':' + two(r) : m + ':' + two(r);
  };

  // MARK: A. Weergave van ondertitels

  P.SUB_SIZES = { small: 0.8, medium: 1, large: 1.3 };
  P.SUB_BACKGROUNDS = ['shadow', 'box'];
  P.subSize = function (v) { return P.SUB_SIZES[v] ? v : 'medium'; };
  P.subBackground = function (v) { return P.SUB_BACKGROUNDS.indexOf(v) >= 0 ? v : 'box'; };

  // MARK: 0c. Trakt

  P.TRAKT_TRANSIENT = 'transient';
  P.TRAKT_REAUTH = 'reauth';
  P.TRAKT_LOCKED = 'locked';
  P.TRAKT_WARN_AFTER = 24 * 3600000;

  /** Soort fout bij een aanroep (null/0 = netwerkfout). Een 401 komt hier pas als verversen ook niet hielp. */
  P.traktClassify = function (status) {
    if (status === 401 || status === 403) return P.TRAKT_REAUTH;
    if (status === 423) return P.TRAKT_LOCKED;
    return P.TRAKT_TRANSIENT;
  };
  /** Mislukte tokenverversing (status per poging, null = netwerkfout): alleen 400/401/403 bij alle pogingen = opnieuw inloggen. */
  P.traktRefreshFailure = function (statuses) {
    if (!statuses || !statuses.length) return P.TRAKT_TRANSIENT;
    for (var i = 0; i < statuses.length; i++) if ([400, 401, 403].indexOf(statuses[i]) < 0) return P.TRAKT_TRANSIENT;
    return P.TRAKT_REAUTH;
  };
  /** Rode waarschuwing alleen bij een blijvende fout, of een tijdelijke die al ≥ 24 uur aanhoudt. */
  P.traktShowWarning = function (kind, failingSince, now) {
    if (!kind) return false;
    if (kind === P.TRAKT_REAUTH || kind === P.TRAKT_LOCKED) return true;
    return failingSince != null && now - failingSince >= P.TRAKT_WARN_AFTER;
  };
  /** Nieuwe soort na een fout: een tijdelijke fout overschrijft geen blijvende. */
  P.traktNextFailure = function (cur, kind) { return !cur || kind !== P.TRAKT_TRANSIENT ? kind : cur; };
  /**
   * Trakt-token uit het account (`connections`) overnemen? Alleen als hier geen token is, het hetzelfde is, of dat van
   * het account minstens zo lang geldig is. Een ouder token zou een al gebruikt refresh-token terugzetten.
   * local/remote = {accessToken, expiresAt (ms)}.
   */
  P.traktAdoptRemote = function (local, remote) {
    if (!local || !local.accessToken || local.expiresAt == null) return true;
    if (!remote) return true;
    if (local.accessToken === remote.accessToken) return true;
    return remote.expiresAt >= local.expiresAt;
  };

  // MARK: 0c. OpenSubtitles

  /** Het token is ongeveer 24 uur geldig; na 23 uur vooraf stil vernieuwen. */
  P.OS_MAX_TOKEN_AGE = 23 * 3600000;
  /** Vóór een aanroep met het token eerst stil opnieuw inloggen? (loggedInAt in ms, null = onbekend) */
  P.osShouldRenew = function (loggedInAt, now, hasPassword) {
    if (!hasPassword) return false;
    if (loggedInAt == null) return true;
    return now - loggedInAt >= P.OS_MAX_TOKEN_AGE || now < loggedInAt - 300000;
  };
  /** Wat te doen met een antwoord (null = netwerkfout): 'keep', 'relogin' of 'expired'. Alleen een 401 op een aanroep met token. */
  P.osOnResponse = function (status, authenticated, hasPassword) {
    if (!authenticated || status !== 401) return 'keep';
    return hasPassword ? 'relogin' : 'expired';
  };
  /** Uitkomst van (stil) inloggen: 'ok', 'bad' (400/401: uitloggen met een melding) of 'transient' (403, 429, 5xx, netwerk). */
  P.osLoginResult = function (status) {
    if (status == null || status === 0) return 'transient';
    if (status >= 200 && status < 300) return 'ok';
    if (status === 400 || status === 401) return 'bad';
    return 'transient';
  };
})();
