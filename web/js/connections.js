/*
 * Koppelingen: Trakt en OpenSubtitles, gedeeld via state-section `connections` (build 44):
 *   {trakt: {accessToken, refreshToken, expiresAt, username} | null,
 *    opensubtitles: {token, username, baseURL} | null, updatedAt}
 * Het geheel met de nieuwste updatedAt wint. Trakt-refresh-tokens zijn eenmalig: vóór het verversen eerst de
 * server lezen; na het verversen meteen uploaden (= StateSync.kt / Trakt.kt / OpenSubtitles.kt op Android).
 * Trakt hoort bij het hoofdprofiel: andere profielen scrobblen niet naar dat account.
 */
(function () {
  'use strict';
  var B = window.B;
  var A = B.account;
  var L = function () { return B.L.apply(null, arguments); };
  var C = B.connections = {};

  // MARK: lokale kopie en samenvoegen

  var local = B.store.get('connections', null);   // {data, at}
  function save() { B.store.set('connections', local); }
  function at(v) { return B.parseISO(v) || 0; }
  C.data = function () { return (local && local.data) || {}; };
  C.trakt = function () { var t = C.data().trakt; return t && t.accessToken && t.refreshToken ? t : null; };
  C.opensubtitles = function () { var o = C.data().opensubtitles; return o && o.token ? o : null; };

  /** Lokale wijziging: tijd = nu, meteen uploaden (refresh-tokens zijn eenmalig). */
  function changed(mut) {
    var d = B.copy(C.data()) || {};
    mut(d);
    var now = B.iso();
    d.updatedAt = now;
    local = { data: d, at: Date.parse(now) };
    save();
    B.emit('connections');
    return upload();
  }
  function upload() {
    if (!local) return Promise.resolve(false);
    return A.putState('connections', local.data).then(function (r) { return r != null; }).catch(function () { return false; });
  }
  /** Section van de server toepassen (bij elke sync). */
  function merge(sec) {
    var data = sec && sec.data;
    if (!data || typeof data !== 'object') {
      if (local && (C.trakt() || C.opensubtitles())) upload();
      return;
    }
    var srvAt = at(data.updatedAt) || at(sec.updatedAt);
    var locAt = local ? local.at || 0 : 0;
    if (!local || srvAt > locAt) {
      var before = JSON.stringify(C.data());
      local = { data: data, at: srvAt };
      save();
      if (before !== JSON.stringify(data)) { B.emit('connections'); Trakt.onTokens(); }
    } else if (locAt > srvAt) upload();
  }
  B.on('state', function (all) { if (all && B.has(all, 'connections')) merge(all.connections); else if (all && local) merge(null); });
  B.on('wipe', function () { local = null; B.store.del('connections'); B.store.del('trakt.cache'); B.idb.del('trakt.cache.v1'); B.idb.del('trakt.cache.v2'); B.store.del('trakt.notFound'); Trakt.reset(); });
  C.sync = function () { return A.getState(['connections']).then(function (all) { if (all) merge(all.connections || null); }); };

  // MARK: SHA-256 (PKCE voor Trakt; crypto.subtle bestaat niet altijd op de tv)

  function sha256(ascii) {
    function rr(v, n) { return (v >>> n) | (v << (32 - n)); }
    var K = [], H = [], i, j, prime = 2, n = 0;
    function frac(x) { return ((x - Math.floor(x)) * 4294967296) | 0; }
    while (n < 64) {
      var isP = true;
      for (j = 2; j * j <= prime; j++) if (prime % j === 0) { isP = false; break; }
      if (isP) { if (n < 8) H[n] = frac(Math.pow(prime, 1 / 2)); K[n++] = frac(Math.pow(prime, 1 / 3)); }
      prime++;
    }
    var bytes = [];
    for (i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i) & 0xff);
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
    var w = new Array(64);
    for (i = 0; i < bytes.length; i += 64) {
      for (j = 0; j < 16; j++) w[j] = (bytes[i + j * 4] << 24) | (bytes[i + j * 4 + 1] << 16) | (bytes[i + j * 4 + 2] << 8) | bytes[i + j * 4 + 3];
      for (j = 16; j < 64; j++) {
        var s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
        var s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (j = 0; j < 64; j++) {
        var t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[j] + w[j]) | 0;
        var t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = [];
    for (i = 0; i < 8; i++) for (j = 3; j >= 0; j--) out.push((H[i] >>> (j * 8)) & 0xff);
    return out;
  }
  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  C._sha256 = sha256; C._b64url = b64url;

  // MARK: Trakt

  var BASE = 'https://api.trakt.tv';
  var OAUTH_HOSTS = ['https://api.trakt.tv', 'https://auth.trakt.tv'];
  var REDIRECTS = ['https://github.com/LRvdLinden/iptv-ios-appletv', 'urn:ietf:wg:oauth:2.0:oob'];
  var Trakt = B.trakt = {};
  var WK = B.wk;
  /*
   * Build 154 (contract docs/ACCOUNT.md, Build 154 "Trakt"): Trakt-gezien staat in het geheugen als dezelfde
   * inhoudssleutels als "gezien" in het profiel (w:m:/w:e:/w:s:, uit tmdb, imdb en titel + jaar van het Trakt-antwoord);
   * items zonder IMDb-id vallen niet meer weg. Niet in het account. Bewaard in IndexedDB (trakt.cache.v2); de oude
   * IMDb-cache (trakt.cache.v1 / localStorage trakt.cache) wordt gewist.
   *   {keys: [sleutel], aired: {show-vorm: aired_episodes}, counts: {show-vorm: aantal gezien}, ids: {zoek-sleutel: {tmdb, imdb}},
   *    activity, v: 2}
   */
  function emptyCache() { return { keys: [], aired: {}, counts: {}, ids: {}, activity: null, v: 2 }; }
  var cacheT = emptyCache(), cacheGen = 0, tset = Object.create(null), anyT = false;
  B.store.del('trakt.cache');
  B.idb.del('trakt.cache.v1');
  B.idb.get('trakt.cache.v2').then(function (c) {
    // alleen als er intussen niets nieuws is opgehaald of gewist
    if (!c || typeof c !== 'object' || c.v !== 2 || cacheGen) return;
    cacheT = { keys: c.keys || [], aired: c.aired || {}, counts: c.counts || {}, ids: c.ids || {}, activity: c.activity || null, v: 2 };
    loadCache();
    // kaarten die al getekend zijn (vóór de cache er was) alsnog afvinken
    B.emit('trakt');
  }, B.noop);
  function loadCache() {
    tset = Object.create(null);
    (cacheT.keys || []).forEach(function (k) { tset[k] = 1; });
    anyT = cacheT.keys.length > 0;
  }
  var cacheTimer = null;
  function saveCache() {
    cacheGen++;
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(function () { B.idb.set('trakt.cache.v2', cacheT); }, 1500);
  }
  function hasT(k) { return tset[k] === 1; }
  function addKeys(keys) { keys.forEach(function (k) { if (!tset[k]) { tset[k] = 1; cacheT.keys.push(k); } }); anyT = true; }
  function delKeys(keys) {
    var gone = false;
    keys.forEach(function (k) { if (tset[k]) { delete tset[k]; gone = true; } });
    if (gone) cacheT.keys = cacheT.keys.filter(function (k) { return tset[k] === 1; });
  }
  Trakt.reset = function () { cacheGen++; cacheT = emptyCache(); loadCache(); Q.clear(); };
  Trakt._cache = function () { return cacheT; };

  Trakt.clientID = function () { return A.serverKey('traktClientID') || ''; };
  Trakt.ready = function () { return !!Trakt.clientID(); };
  /** Alleen het hoofdprofiel (of het enige profiel) gebruikt Trakt. */
  Trakt.allowed = function () {
    var p = B.app && B.app.profile;
    return !!p && (B.data.isMain(p) || B.data.profiles.length <= 1);
  };
  // Trakt hoort bij Lifetime: met Gratis geen sync en geen scrobbles (de koppeling zelf blijft bewaard)
  Trakt.isLoggedIn = function () { return !!C.trakt() && Trakt.allowed() && (!B.plan || B.plan.has('trakt')); };

  Trakt.username = function () { var t = C.trakt(); return t ? t.username || '' : ''; };
  Trakt.scrobbleEnabled = function () { return B.bool(B.data.shared('traktScrobble', true)) !== false; };
  Trakt.lastScrobble = null;

  function apiHeaders(token) {
    var h = { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': Trakt.clientID() };
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }
  function oauthBody(extra) {
    var o = B.assign({}, extra, { client_id: Trakt.clientID() });
    var sec = A.serverKey('traktClientSecret');
    if (sec) o.client_secret = sec;
    return o;
  }
  var oauthBase = B.store.get('trakt.oauthHost', BASE) || BASE;
  function oauthPost(path, body, host) {
    return B.http((host || oauthBase) + path, { method: 'POST', headers: apiHeaders(null), body: body, timeout: 20000 });
  }
  function parseTokens(j) {
    if (!j || !j.access_token || !j.refresh_token) return null;
    var created = B.num(j.created_at) || Math.floor(Date.now() / 1000);
    var exp = B.num(j.expires_in) || 0;
    return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: B.iso((created + exp) * 1000) };
  }

  var verifier = '';
  function randomVerifier() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~', out = '';
    var b = new Uint8Array(64);
    window.crypto.getRandomValues(b);
    for (var i = 0; i < 64; i++) out += chars.charAt(b[i] % chars.length);
    return out;
  }
  /** Koppelcode aanvragen (trakt.tv/activate): {deviceCode, userCode, url, expiresIn, interval}. */
  Trakt.startLogin = function () {
    verifier = randomVerifier();
    var body = { client_id: Trakt.clientID(), code_challenge: b64url(sha256(verifier)), code_challenge_method: 'S256' };
    var i = 0, lastErr = null;
    function next() {
      if (i >= OAUTH_HOSTS.length) throw lastErr || new Error(L('Something went wrong. Please try again.'));
      var host = OAUTH_HOSTS[i++];
      return oauthPost('/oauth/device/code', body, host).then(function (r) {
        var j = r.json || {};
        if (r.status >= 200 && r.status < 300 && j.device_code && j.user_code) {
          oauthBase = host; B.store.set('trakt.oauthHost', host);
          return { deviceCode: j.device_code, userCode: j.user_code, url: j.verification_url || 'https://trakt.tv/activate',
            expiresIn: B.int(j.expires_in) || 600, interval: Math.max(5, B.int(j.interval) || 5) };
        }
        lastErr = new Error('Trakt (' + r.status + ')');
        return next();
      }, function (e) {
        // een netwerk-/CORS-fout in de browser: Trakt staat (nog) niet open voor bingr.online
        lastErr = e && e.cors ? new Error(L('Trakt can’t be reached from the browser right now. Try again later, or sign in to Trakt in the Bingr app.')) : e;
        return next();
      });
    }
    return next();
  };
  /** Pollen tot de code bevestigd is; daarna tokens in `connections` en meteen uploaden. cancel() via het object. */
  Trakt.finishLogin = function (code) {
    var cancelled = false, interval = code.interval;
    var deadline = Date.now() + code.expiresIn * 1000;
    var p = new Promise(function (resolve, reject) {
      function poll() {
        if (cancelled) return;
        if (Date.now() > deadline) { reject(new Error(L('The code has expired. Please try again.'))); return; }
        oauthPost('/oauth/device/token', oauthBody({ code: code.deviceCode, code_verifier: verifier })).then(function (r) {
          if (cancelled) return;
          if (r.status === 200) {
            var t = parseTokens(r.json);
            if (!t) { reject(new Error(L('Something went wrong. Please try again.'))); return; }
            B.http(BASE + '/users/settings', { headers: apiHeaders(t.accessToken), timeout: 15000 }).then(function (u) {
              t.username = (u.json && u.json.user && u.json.user.username) || null;
            }, B.noop).then(function () {
              return changed(function (d) { d.trakt = t; });
            }).then(function () { Trakt.refresh(true); resolve(t); });
            return;
          }
          if (r.status === 429) interval += 1;
          else if ([404, 409, 410, 418].indexOf(r.status) >= 0) { reject(new Error(L('Trakt refused the connection (%d).', r.status))); return; }
          setTimeout(poll, interval * 1000);
        }, function () { if (!cancelled) setTimeout(poll, interval * 1000); });
      }
      setTimeout(poll, interval * 1000);
    });
    p.cancel = function () { cancelled = true; };
    return p;
  };
  Trakt.logout = function () {
    var t = C.trakt();
    if (t) oauthPost('/oauth/revoke', oauthBody({ token: t.accessToken })).catch(B.noop);
    Trakt.reset(); saveCache();
    return changed(function (d) { d.trakt = null; });
  };
  Trakt.onTokens = function () { if (Trakt.isLoggedIn()) { Trakt.refresh(false); Q.soon(500); } };

  // MARK: token (build 154): verversen pas bij < 1 uur geldig of na een 401; één tegelijk; nooit trakt: null bij een fout

  var REFRESH_MARGIN = 3600000;
  var refreshing = null, lastFail = null;
  Trakt.refreshCount = 0;
  /** Verse tokens van een ander apparaat (connections opnieuw gelezen)? Dan die gebruiken. */
  function newerThan(cur) {
    var n = C.trakt();
    return n && n.accessToken !== cur.accessToken && at(n.expiresAt) > Date.now() + 60000 ? n : null;
  }
  /**
   * Token verversen (single-flight). force = na een 401 (ook als het token nog geldig lijkt). Mislukt het: eerst
   * `connections` opnieuw lezen en een nieuwer token overnemen; anders het oude token houden. De koppeling blijft staan.
   */
  function refreshToken(force) {
    if (refreshing) return refreshing;
    var before = C.trakt();
    if (!before) return Promise.reject(new Error(L('Not signed in to Trakt.')));
    refreshing = C.sync().catch(B.noop).then(function () {
      var cur = C.trakt();
      if (!cur) throw new Error(L('Not signed in to Trakt.'));
      // een ander apparaat ververste al (nieuw token in het account)
      if (cur.accessToken !== before.accessToken && at(cur.expiresAt) - Date.now() > REFRESH_MARGIN) return cur.accessToken;
      if (!force && at(cur.expiresAt) - Date.now() > REFRESH_MARGIN) return cur.accessToken;
      // net mislukt met dezelfde refresh-token: niet bij elk verzoek opnieuw (hooguit eens per 5 minuten)
      if (lastFail && lastFail.rt === cur.refreshToken && Date.now() - lastFail.at < 300000) return cur.accessToken;
      var i = 0;
      function next() {
        if (i >= REDIRECTS.length) return failed();
        var red = REDIRECTS[i++];
        Trakt.refreshCount++;
        return oauthPost('/oauth/token', oauthBody({ refresh_token: cur.refreshToken, redirect_uri: red, grant_type: 'refresh_token' })).then(function (r) {
          var n = r.status === 200 ? parseTokens(r.json) : null;
          if (n) {
            n.username = cur.username || null;
            return changed(function (d) { d.trakt = n; }).then(function () { Q.soon(1000); return n.accessToken; });
          }
          if (r.status === 400 || r.status === 401) return next();
          return failed();
        }, failed);
      }
      function failed() {
        // nooit `trakt: null` (dat doet alleen een bewuste uitlog): opnieuw lezen, een nieuwer token overnemen
        return C.sync().catch(B.noop).then(function () {
          var n = newerThan(cur);
          if (n) return n.accessToken;
          Trakt.lastError = 'token_refresh_failed'; lastFail = { at: Date.now(), rt: cur.refreshToken };
          return cur.accessToken;
        });
      }
      return next();
    });
    var p = refreshing;
    p.then(function () { refreshing = null; }, function () { refreshing = null; });
    return p;
  }
  Trakt._refreshToken = refreshToken;
  /** Geldig access-token: het huidige als het nog meer dan 1 uur geldig is, anders eerst verversen. */
  function validToken() {
    var t = C.trakt();
    if (!t) return Promise.reject(new Error(L('Not signed in to Trakt.')));
    if (at(t.expiresAt) - Date.now() > REFRESH_MARGIN) return Promise.resolve(t.accessToken);
    return refreshToken(false);
  }
  /** Verzoek met token; bij een 401 één keer verversen en opnieuw. Geeft het ruwe antwoord {status, json, headers}. */
  function call(method, path, body, params) {
    var u = params && params.length ? B.query(BASE + path, params) : BASE + path;
    function once(token) {
      var o = { method: method, headers: apiHeaders(token), timeout: method === 'GET' ? 30000 : 20000 };
      if (body != null) o.body = body;
      return B.http(u, o);
    }
    return validToken().then(function (token) {
      return once(token).then(function (r) {
        if (r.status !== 401) return r;
        return refreshToken(true).then(function (t2) { return t2 && t2 !== token ? once(t2) : r; });
      });
    });
  }
  function get(path, params, auth) {
    if (auth === false) {
      var u = params && params.length ? B.query(BASE + path, params) : BASE + path;
      return B.http(u, { headers: apiHeaders(null), timeout: 30000 }).then(function (r) {
        if (r.status < 200 || r.status >= 300) throw new Error('Trakt ' + r.status);
        return r.json;
      });
    }
    return call('GET', path, null, params).then(function (r) {
      if (r.status < 200 || r.status >= 300) throw new Error('Trakt ' + r.status);
      return r.json;
    });
  }
  function post(path, body) { return call('POST', path, body); }
  Trakt._get = get;
  Trakt._call = call;

  // MARK: koppelen (build 154): inhoudssleutels, ids naar Trakt, zoeken alleen met de juiste titel en het juiste jaar

  function idsOf(x) {
    var o = {}, t = WK.tmdbOf(x), i = WK.imdbOf(x);
    if (t) o.tmdb = parseInt(t, 10);
    if (i) o.imdb = i;
    return o;
  }
  function hasIds(o) { return !!(o && (o.tmdb || o.imdb)); }
  function searchKey(title, year, show) { return (show ? 's' : 'm') + '|' + WK.norm(title) + '|' + (year || 0); }
  function rememberIds(title, year, show, ids) {
    if (!title || !hasIds(ids)) return;
    cacheT.ids[searchKey(title, year, show)] = ids;
  }
  function knownIds(title, year, show) {
    if (!title) return null;
    var y = year || 0, ix = cacheT.ids || {}, l = y ? [y, y - 1, y + 1] : [0];
    for (var i = 0; i < l.length; i++) { var h = ix[searchKey(title, l[i], show)]; if (hasIds(h)) return h; }
    return null;
  }
  /** IMDb-id van een titel (ondertitels zoeken): eigen id, anders uit Trakt-gezien of een eerdere zoektreffer. */
  Trakt.imdbFor = function (x, show) {
    if (!x) return null;
    if (x.imdbID) return x.imdbID;
    var h = knownIds(x.rawTitle || x.title, WK.yearOf(x), show);
    return (h && h.imdb) || null;
  };
  /**
   * Zoektreffer alleen als de titel (norm) en het jaar (±1) kloppen. Zonder jaar: alleen als er precies één treffer
   * met die titel is. list = antwoord van /search/movie|show.
   */
  function pickHit(list, title, year, show) {
    var n = WK.norm(title), y = year || 0, same = [];
    (list || []).forEach(function (h) {
      var m = h && (show ? h.show : h.movie);
      if (!m || !m.ids || WK.norm(m.title) !== n) return;
      same.push(m);
    });
    if (y) {
      for (var i = 0; i < same.length; i++) { var my = B.int(same[i].year); if (my && Math.abs(my - y) <= 1) return same[i]; }
      return null;
    }
    return same.length === 1 ? same[0] : null;
  }
  Trakt._pickHit = pickHit;
  /** ids {tmdb, imdb} van een item: eigen ids, anders een eerdere treffer, anders zoeken bij Trakt (zonder login). */
  function resolveIds(x, show) {
    var own = idsOf(x);
    if (hasIds(own)) return Promise.resolve(own);
    var title = x.rawTitle || x.title, year = WK.yearOf(x) || 0;
    var known = knownIds(title, year, show);
    if (known) return Promise.resolve(known);
    var q = WK.norm(title) ? B.parseTitle(title).title : '';
    if (!q) return Promise.resolve(null);
    var params = [['query', q], ['limit', '10']];
    if (year) params.push(['years', (year - 1) + '-' + (year + 1)]);
    return get('/search/' + (show ? 'show' : 'movie'), params, false).then(function (list) {
      var m = pickHit(list, title, year, show);
      if (!m) return null;
      var ids = {};
      if (m.ids.tmdb != null) ids.tmdb = m.ids.tmdb;
      if (m.ids.imdb) ids.imdb = m.ids.imdb;
      if (m.ids.trakt != null) ids.trakt = m.ids.trakt;
      if (!hasIds(ids) && !ids.trakt) return null;
      rememberIds(title, year, show, ids); saveCache();
      return ids;
    }, function () { return null; });
  }
  Trakt._resolveIds = resolveIds;

  // MARK: gezien op Trakt (in het geheugen, als inhoudssleutels)

  function showOf(s) { return s ? { title: s.rawTitle || s.title, year: s.year, tmdb: WK.tmdbOf(s), imdb: WK.imdbOf(s) } : null; }
  Trakt.isMovieWatched = function (m) { return !!m && anyT && Trakt.isLoggedIn() && !!WK.movieHit(hasT, m); };
  Trakt.isEpisodeWatched = function (series, season, ep) { return !!series && anyT && Trakt.isLoggedIn() && !!WK.episodeHit(hasT, series, season, ep); };
  Trakt.isSeriesWatched = function (series) { return !!series && anyT && Trakt.isLoggedIn() && !!WK.showHit(hasT, series); };
  function formsOf(series) { return WK.lookupKeys(WK.showForms(series).map(function (f) { return 'w:s:' + f; })).map(function (k) { return k.slice(4); }); }
  Trakt.watchedCount = function (series) {
    if (!series || !anyT || !Trakt.isLoggedIn()) return 0;
    var best = 0;
    formsOf(series).forEach(function (f) { var n = cacheT.counts[f] || 0; if (n > best) best = n; });
    return best;
  };
  /** Uitgezonden afleveringen volgens Trakt (aired_episodes), of 0 als onbekend. */
  Trakt.airedFor = function (series) {
    if (!series || !Trakt.isLoggedIn()) return 0;
    var f = formsOf(series);
    for (var i = 0; i < f.length; i++) if (cacheT.aired[f[i]] > 0) return cacheT.aired[f[i]];
    return 0;
  };
  /** Antwoord van /sync/watched/movies en /sync/watched/shows?extended=full → cache (alle sleutels opnieuw). */
  function buildCache(movies, shows) {
    var c = emptyCache();
    c.ids = cacheT.ids || {};
    var seen = Object.create(null);
    function add(k) { if (!seen[k]) { seen[k] = 1; c.keys.push(k); } }
    if (!Array.isArray(movies)) movies = [];
    if (!Array.isArray(shows)) shows = [];
    movies.forEach(function (x) {
      var mv = x && x.movie;
      if (!mv || !mv.ids) return;
      var m = { title: mv.title, year: mv.year, tmdb: mv.ids.tmdb, imdb: mv.ids.imdb };
      WK.movieKeys(m).forEach(add);
      var ids = idsOf(m);
      if (hasIds(ids)) c.ids[searchKey(mv.title, mv.year, false)] = ids;
    });
    shows.forEach(function (x) {
      var sh = x && x.show;
      if (!sh || !sh.ids) return;
      var s = { title: sh.title, year: sh.year, tmdb: sh.ids.tmdb, imdb: sh.ids.imdb };
      var forms = WK.showForms(s), n = 0;
      if (!forms.length) return;
      var ids = idsOf(s);
      if (hasIds(ids)) c.ids[searchKey(sh.title, sh.year, true)] = ids;
      (x.seasons || []).forEach(function (se) {
        (se.episodes || []).forEach(function (e) {
          if (se.number == null || e.number == null) return;
          if (se.number > 0) n++;
          WK.episodeKeys(s, se.number, e.number).forEach(add);
        });
      });
      var aired = B.int(sh.aired_episodes) || 0;
      forms.forEach(function (f) { c.counts[f] = n; if (aired > 0) c.aired[f] = aired; });
      if (aired > 0 && n >= aired) WK.showKeys(s).forEach(add);
    });
    return c;
  }
  Trakt._buildCache = buildCache;

  var syncing = false;
  Trakt.isSyncing = function () { return syncing; };
  /** Laatste geslaagde synchronisatie (ms) in deze browser. */
  Trakt.lastSync = function () { return B.store.get('trakt.lastSync', 0) || 0; };
  Trakt.lastError = null;
  /** Gezien ophalen: altijd eerst /sync/last_activities; de lijsten alleen als daar iets nieuws staat (of force). */
  Trakt.refresh = function (force) {
    if (!Trakt.isLoggedIn() || syncing) return Promise.resolve();
    syncing = true;
    B.emit('traktStatus');
    return get('/sync/last_activities').then(function (act) {
      var all = act && act.all;
      if (!force && all && all === cacheT.activity && cacheT.keys.length) return;
      return Promise.all([get('/sync/watched/movies'), get('/sync/watched/shows', [['extended', 'full']])]).then(function (r) {
        var c = buildCache(r[0], r[1]);
        c.activity = all || null;
        // wat nog in de wachtrij staat, is bij Trakt nog niet verwerkt: in het geheugen laten zoals het lokaal is
        cacheGen++; cacheT = c; loadCache(); Q.overlay();
        saveCache();
        B.emit('trakt');
      });
    }).then(function () { Trakt.lastError = null; B.store.set('trakt.lastSync', Date.now()); },
      function (e) { Trakt.lastError = (e && e.message) || 'Trakt'; B.log('trakt', e && e.message); })
      .then(function () { syncing = false; B.emit('traktStatus'); });
  };

  // MARK: wachtrij (build 154): gezien en niet-gezien blijvend op het apparaat, met backoff en Retry-After

  /*
   * Item in de wachtrij: {id, op: 'add'|'remove', kind: 'movie'|'episodes', item: {title, year, tmdb, imdb}, eps:
   * [{season, number}], at (watched_at, ms), tries, next (ms), hold (van de speler: wacht op de scrobble-stop), key}.
   * localStorage `trakt.queue` (klein; geen tokens). Opnieuw proberen bij de start, terug op de voorgrond, na een
   * verversing en elke 15 minuten. Wat Trakt als not_found teruggeeft, komt in de diagnose (Trakt.notFound) en valt eruit.
   */
  var QKEY = 'trakt.queue', MAX_Q = 500;
  var Q = Trakt.queue = {};
  var qList = (function () { var l = B.store.get(QKEY, null); return Array.isArray(l) ? l.filter(function (e) { return e && e.op && e.item; }) : []; })();
  var qBusy = null, qTimer = 0, qSeq = Date.now();
  var pendingStops = 0;
  Trakt.notFound = B.store.get('trakt.notFound', []) || [];
  function qSave() { if (qList.length > MAX_Q) qList = qList.slice(qList.length - MAX_Q); B.store.set(QKEY, qList); }
  Q.list = function () { return qList.slice(); };
  Q.clear = function () { qList = []; B.store.del(QKEY); };
  Q.reload = function () { var l = B.store.get(QKEY, null); qList = Array.isArray(l) ? l : []; };
  function itemKey(item) {
    var y = WK.yearOf(item) || 0;
    return (item.type === 'episode' ? 'e|' : 'm|') + (WK.tmdbOf(item) || WK.imdbOf(item) || WK.norm(item.title) + '|' + y) +
      (item.type === 'episode' ? '|' + item.season + '-' + item.episode : '');
  }
  function entryKeys(e) {
    if (e.kind === 'movie') return WK.movieKeys(e.item);
    var out = [];
    (e.eps || []).forEach(function (x) { out = out.concat(WK.episodeKeys(e.item, x.season, x.number)); });
    return out;
  }
  /** Lokaal (in het geheugen) zoals de wachtrij het wil, ook na een nieuwe lijst van Trakt. */
  Q.overlay = function () {
    qList.forEach(function (e) { var k = entryKeys(e); if (e.op === 'add') addKeys(k); else delKeys(k); });
  };
  function enqueue(e) {
    e.id = ++qSeq; e.tries = 0; e.next = 0;
    // dezelfde actie voor hetzelfde item staat er al: die vervangen (geen dubbele plays)
    qList = qList.filter(function (x) { return !(x.key === e.key && x.kind === e.kind && JSON.stringify(x.eps || null) === JSON.stringify(e.eps || null)); });
    qList.push(e);
    qSave();
    var k = entryKeys(e);
    if (e.op === 'add') addKeys(k); else delKeys(k);
    saveCache();
    B.emit('trakt');
    Q.soon(e.hold ? 4000 : 1500);
    return e;
  }
  /**
   * Gezien (on) of niet-gezien via de wachtrij. item = movieItem/episodeItem van de speler ({type, title, year, tmdb,
   * imdbID, season, episode}); hold = vanaf de speler (de scrobble-stop telt bij Trakt al als gezien vanaf 80%).
   */
  Trakt.queueWatched = function (item, on, when, hold) {
    if (!Trakt.isLoggedIn() || !item || (item.type !== 'movie' && item.type !== 'episode')) return null;
    if (on && !Trakt.scrobbleEnabled() && hold) return null;
    var isEp = item.type === 'episode';
    if (isEp && (item.season == null || item.episode == null)) return null;
    var base = { title: item.title, year: item.year || B.int(item.subtitle) || null, tmdb: WK.tmdbOf(item), imdb: WK.imdbOf(item) };
    return enqueue({ op: on ? 'add' : 'remove', kind: isEp ? 'episodes' : 'movie', item: base, eps: isEp ? [{ season: item.season, number: item.episode }] : null,
      at: when || Date.now(), hold: !!hold, key: itemKey(item) });
  };
  Q.soon = function (ms) {
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { qTimer = 0; Q.flush(); }, ms == null ? 1500 : ms);
  };
  function retryAfter(r) {
    var v = null;
    try { v = r.headers && (r.headers.getResponseHeader ? r.headers.getResponseHeader('Retry-After') : (r.headers.get ? r.headers.get('Retry-After') : null)); } catch (e) { v = null; }
    var n = B.num(v);
    return n != null && n >= 0 ? n * 1000 : null;
  }
  function backoff(e, ms) {
    e.tries = (e.tries || 0) + 1;
    e.next = Date.now() + (ms != null ? ms : Math.min(3600000, 30000 * Math.pow(2, Math.min(e.tries - 1, 7))));
  }
  function noteNotFound(e) {
    var t = e.item.title + (e.item.year ? ' (' + e.item.year + ')' : '') + (e.kind === 'episodes' ? ' ' + (e.eps || []).map(function (x) { return 'S' + x.season + 'E' + x.number; }).join(',') : '');
    Trakt.notFound = [{ at: B.iso(), title: t, op: e.op }].concat(Trakt.notFound).slice(0, 20);
    B.store.set('trakt.notFound', Trakt.notFound);
    Trakt.lastScrobble = L('Not found on Trakt: %@', e.item.title);
  }
  /** Body voor /sync/history(/remove) met ids (tmdb/imdb, of trakt uit een zoektreffer) en watched_at. */
  function historyBody(e, ids) {
    var w = B.iso(e.at || Date.now());
    if (e.kind === 'movie') {
      var mv = { ids: ids };
      if (e.op === 'add') mv.watched_at = w;
      return { movies: [mv] };
    }
    var by = {};
    (e.eps || []).forEach(function (x) {
      var ep = { number: x.number };
      if (e.op === 'add') ep.watched_at = w;
      (by[x.season] = by[x.season] || []).push(ep);
    });
    return { shows: [{ ids: ids, seasons: Object.keys(by).map(function (n) { return { number: B.int(n), episodes: by[n] }; }) }] };
  }
  /** Wat Trakt niet kende (not_found): een niet-leeg lijstje = niet gelukt. */
  function notFoundIn(j) {
    var nf = j && j.not_found;
    if (!nf || typeof nf !== 'object') return false;
    return ['movies', 'shows', 'seasons', 'episodes', 'people'].some(function (k) { return Array.isArray(nf[k]) && nf[k].length > 0; });
  }
  function sendEntry(e) {
    return resolveIds(e.item, e.kind !== 'movie').then(function (ids) {
      if (!ids) { noteNotFound(e); return 'drop'; }
      e.item.tmdb = e.item.tmdb || (ids.tmdb != null ? String(ids.tmdb) : null);
      e.item.imdb = e.item.imdb || ids.imdb || null;
      return post(e.op === 'add' ? '/sync/history' : '/sync/history/remove', historyBody(e, ids)).then(function (r) {
        if (r.status === 429) { backoff(e, retryAfter(r) || 60000); return 'retry'; }
        if (r.status === 401 || r.status === 403 || r.status >= 500 || r.status === 0) { backoff(e); return 'retry'; }
        if (r.status < 200 || r.status >= 300) { noteNotFound(e); return 'drop'; }
        if (notFoundIn(r.json)) { noteNotFound(e); return 'drop'; }
        return 'ok';
      });
    }).catch(function () { backoff(e); return 'retry'; });
  }
  /** Wachtrij versturen (één tegelijk). Vasthouden zolang de speler open is of een scrobble-stop onderweg is. */
  Q.flush = function () {
    if (qBusy) return qBusy;
    if (!Trakt.isLoggedIn() || !qList.length) return Promise.resolve(0);
    var playing = !!(B.player && B.player.current) || pendingStops > 0;
    var sent = 0, any = false;
    qBusy = (function next() {
      var now = Date.now();
      var e = qList.filter(function (x) { return (x.next || 0) <= now && !(x.hold && playing); })[0];
      if (!e) return Promise.resolve();
      return sendEntry(e).then(function (res) {
        if (res === 'ok' || res === 'drop') { qList = qList.filter(function (x) { return x.id !== e.id; }); if (res === 'ok') sent++; }
        any = true;
        qSave();
        return next();
      }, function () { backoff(e); qSave(); });
    })().catch(B.noop).then(function () {
      qBusy = null;
      if (any) B.emit('traktStatus');
      // eerstvolgende poging plannen (backoff), anders de 15-minutenronde
      var wait = qList.map(function (x) { return (x.next || 0) - Date.now(); }).filter(function (d) { return d > 0; }).sort(function (a, b) { return a - b; })[0];
      if (wait != null && wait < 15 * 60000) Q.soon(wait + 500);
      if (sent) setTimeout(function () { Trakt.refresh(true); }, 3000);
      return sent;
    });
    return qBusy;
  };
  /** Na een geslaagde scrobble-stop vanaf 80% telt Trakt het zelf: het vastgehouden "gezien" van de speler valt weg. */
  function dropHeld(key) {
    var n = qList.length;
    qList = qList.filter(function (x) { return !(x.hold && x.op === 'add' && x.key === key); });
    if (qList.length !== n) qSave();
  }

  /**
   * Scrobble start/pause/stop (progress 0…1). Ids (tmdb/imdb) van het item, anders een zoektreffer met de juiste titel
   * en het juiste jaar. Bij een stop vanaf 80% telt Trakt het als gezien; wat Bingr zelf als gezien markeert, gaat via
   * de wachtrij (Trakt.queueWatched). Live en terugkijken worden niet gescrobbled.
   */
  Trakt.scrobble = function (action, item, progress) {
    if (!Trakt.isLoggedIn() || !Trakt.scrobbleEnabled() || !item || (item.type !== 'movie' && item.type !== 'episode')) return Promise.resolve('skipped');
    var isEp = item.type === 'episode' && item.season != null && item.episode != null;
    if (item.type === 'episode' && !isEp) return Promise.resolve('skipped');
    var stop = action === 'stop';
    if (stop) pendingStops++;
    return resolveIds(item, isEp).then(function (ids) {
      if (!ids) { Trakt.lastScrobble = L('Not found on Trakt: %@', item.title); return 'notfound'; }
      var body = { progress: B.clamp(progress * 100, 0, 100), app_version: '1.0.3' };
      if (isEp) { body.show = { ids: ids }; body.episode = { season: item.season, number: item.episode }; }
      else body.movie = { ids: ids };
      return post('/scrobble/' + action, body).then(function (r) {
        if (r.status === 409) return 'ok'; // al gescrobbled (zelfde item, net nog)
        if (r.status < 200 || r.status >= 300) return 'failed';
        var counted = stop && progress >= 0.8 && r.json && r.json.action === 'scrobble';
        if (counted || (stop && progress >= 0.8 && !r.json)) {
          dropHeld(itemKey(item));
          addKeys(isEp ? WK.episodeKeys({ title: item.title, year: item.year, tmdb: ids.tmdb, imdb: ids.imdb }, item.season, item.episode)
            : WK.movieKeys({ title: item.title, year: item.year, tmdb: ids.tmdb, imdb: ids.imdb }));
          saveCache(); B.emit('trakt');
          Trakt.lastScrobble = L('Marked as watched on Trakt: %@', item.title);
        }
        return 'ok';
      }, function () { return 'failed'; });
    }).catch(function () { return 'failed'; }).then(function (res) {
      if (stop) {
        pendingStops = Math.max(0, pendingStops - 1);
        // 3 seconden na een stop ophalen; vastgehouden "gezien" (als de stop niet meetelde) daarna versturen
        setTimeout(function () { Trakt.refresh(false); }, 3000);
        Q.soon(4000);
      }
      return res;
    });
  };

  /** Handmatig (on)gezien bij Trakt (zoals TraktSync.setWatched op iOS), via de wachtrij. */
  Trakt.setWatched = function (item, on) {
    if (!Trakt.isLoggedIn() || !item) return Promise.resolve(false);
    return Promise.resolve(!!Trakt.queueWatched(item, on, Date.now(), false));
  };
  /** Hele seizoen in één keer (episodes: [{season, number}]), via de wachtrij. */
  Trakt.setEpisodesWatched = function (series, episodes, on) {
    if (!Trakt.isLoggedIn() || !series || !episodes.length) return Promise.resolve(false);
    var s = showOf(series), eps = episodes.filter(function (e) { return e.season != null && e.number != null; }).map(function (e) { return { season: e.season, number: e.number }; });
    if (!eps.length) return Promise.resolve(false);
    enqueue({ op: on ? 'add' : 'remove', kind: 'episodes', item: s, eps: eps, at: Date.now(), hold: false,
      key: 'e|' + (s.tmdb || s.imdb || WK.norm(s.title) + '|' + (WK.yearOf(s) || 0)) + '|' + eps.map(function (e) { return e.season + '-' + e.number; }).join(',') });
    return Promise.resolve(true);
  };
  /** Mijn lijst van het hoofdprofiel volgt de Trakt-watchlist (zoals setWatchlist op iOS). */
  Trakt.setWatchlist = function (x, isShow, on) {
    if (!Trakt.isLoggedIn() || !x) return Promise.resolve(false);
    return resolveIds(x, isShow).then(function (ids) {
      if (!ids) return false;
      var body = {}; body[isShow ? 'shows' : 'movies'] = [{ ids: ids }];
      return post(on ? '/sync/watchlist' : '/sync/watchlist/remove', body).then(function (r) { return r.status >= 200 && r.status < 300; }, function () { return false; });
    }).catch(function () { return false; });
  };

  // MARK: ophalen en versturen: bij de start, terug op de voorgrond, elke 15 minuten (niet tijdens afspelen)

  var ROUND = 15 * 60000;
  function round() {
    if (!Trakt.isLoggedIn()) return;
    Q.flush();
    if (!(B.player && B.player.current)) Trakt.refresh(false);
  }
  setInterval(function () { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') round(); }, ROUND);
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') setTimeout(round, 1000); });
  }
  B.on('playerClosed', function () { Q.soon(5000); });
  setTimeout(function () { if (Trakt.isLoggedIn()) Q.flush(); }, 8000);
  /** Diagnose: wachtrij en hoe vaak Trakt iets niet kende (not_found); geen tokens en geen titels (die staan alleen lokaal). */
  Trakt.diag = function () {
    if (!C.trakt()) return undefined;
    return { queue: qList.length, held: qList.filter(function (x) { return x.hold; }).length, notFound: Trakt.notFound.length,
      lastNotFound: Trakt.notFound[0] ? Trakt.notFound[0].at : undefined, lastError: Trakt.lastError || undefined,
      lastSync: Trakt.lastSync() ? B.iso(Trakt.lastSync()) : undefined, watchedKeys: cacheT.keys.length };
  };
  /** Persoonlijke aanbevelingen (voor "Voor jou"): [{title, year, imdb}]; leeg bij een fout. */
  var recCache = {};
  Trakt.recommendations = function (shows) {
    if (!Trakt.isLoggedIn()) return Promise.resolve([]);
    var k = shows ? 's' : 'm', c = recCache[k];
    if (c && Date.now() - c.at < 3600000) return Promise.resolve(c.list);
    return get('/recommendations/' + (shows ? 'shows' : 'movies'), [['limit', '40'], ['ignore_collected', 'true']]).then(function (list) {
      var out = (list || []).map(function (m) { return m && m.title ? { title: m.title, year: m.year || null, imdb: (m.ids && m.ids.imdb) || null } : null; }).filter(Boolean);
      out.forEach(function (m) { if (m.imdb) rememberIds(m.title, m.year, shows, { imdb: m.imdb }); });
      recCache[k] = { at: Date.now(), list: out };
      return out;
    }, function () { return []; });
  };

  // MARK: OpenSubtitles (REST v1, eigen account; API-sleutel van de server)

  var OS_HOST = 'api.opensubtitles.com';
  var OS = B.opensubtitles = {};
  OS.apiKey = function () { return A.serverKey('openSubtitlesAPIKey') || ''; };
  OS.ready = function () { return !!OS.apiKey(); };
  OS.isLoggedIn = function () { return !!C.opensubtitles(); };
  OS.username = function () { var o = C.opensubtitles(); return o ? o.username || '' : ''; };
  OS.languages = [['nl', 'Nederlands'], ['en', 'English'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'], ['it', 'Italiano'],
    ['pt', 'Português'], ['tr', 'Türkçe'], ['ar', 'العربية'], ['pl', 'Polski'], ['zh', '简体中文']];
  /** Standaardtaal: prefs.subtitleLanguage van het profiel, anders settings.shared.openSubtitlesLanguage, anders de ondertiteltaal, anders de app-taal. */
  OS.defaultLanguage = function () {
    var D = B.data;
    var pv = D.profilePref ? D.profilePref('subtitleLanguage') : null;
    // build 91: ISO 639-1 (oud "pt-PT" / "zh-CN" → "pt" / "zh"); "" = alle talen
    function iso(x) { x = String(x || ''); return /^(pt|zh)[-_]/i.test(x) ? x.slice(0, 2).toLowerCase() : x; }
    if (pv != null && pv !== 'off') return iso(pv);
    var v = D.shared('openSubtitlesLanguage', null);
    if (v != null) return iso(v);
    // build 91: de ondertiteltaal van dit profiel (prefs.streamSubtitleLanguage, anders shared), anders de app-taal
    var t = B.clang && B.clang.preferredSubtitle ? String(B.clang.preferredSubtitle() || '') : String(D.shared('subtitleLanguage', '') || '');
    return t.length === 2 ? t : String(B.lang || 'en').slice(0, 2);
  };
  function apiCodes(c) { c = String(c || '').toLowerCase(); if (c === 'pt' || c === 'pt-pt') return ['pt-br', 'pt-pt']; if (c === 'zh' || c === 'zh-cn') return ['zh-cn', 'zh-tw']; return c ? [c] : []; }
  /**
   * Build 91: elke aanroep gaat via de proxy (web-proxy, actie "os"): de OpenSubtitles-API stuurt geen CORS-headers,
   * dus de browser kan hem niet zelf aanroepen. De proxy zet de API-sleutel en de user-agent. Een 401 van
   * OpenSubtitles bij een aanroep met sessie: één keer opnieuw inloggen als er een wachtwoord bewaard is, anders
   * (alleen bij /download en /infos/user) uitloggen. Een 401 van de proxy zelf (Bingr-sessie) laat OpenSubtitles staan.
   */
  function osRequest(path, method, params, body, host, retried) {
    var o = C.opensubtitles();
    var h = String(host || (o && o.baseURL) || OS_HOST).replace(/^https?:\/\//, '').replace(/\/+$/, '');
    var req = { action: 'os', path: path, method: method || 'GET', query: params || {}, host: h };
    if (body) req.body = body;
    if (o && o.token && path !== '/login') req.token = o.token;
    return B.proxyPost(req).then(function (r) {
      var proxyErr = r.json && typeof r.json.error === 'string' && !r.json.message;
      if (r.status === 401 && o && path !== '/login' && !proxyErr) {
        if (o.password && !retried) {
          return OS.login(o.username, o.password).then(function () { return osRequest(path, method, params, body, null, true); });
        }
        if (path === '/download' || path === '/infos/user') changed(function (d) { d.opensubtitles = null; });
        throw new Error(L('Sign in to OpenSubtitles first (My Bingr).'));
      }
      if (proxyErr && r.status === 429) throw new Error(L('Something went wrong. Please try again.'));
      if (r.status < 200 || r.status >= 300) throw new Error((r.json && r.json.message) || ('OpenSubtitles ' + r.status));
      return r.json || {};
    });
  }
  OS.login = function (user, pass) {
    return osRequest('/login', 'POST', null, { username: user, password: pass }, OS_HOST).then(function (j) {
      if (!j.token) throw new Error(L('Incorrect email or password.'));
      var old = C.opensubtitles();
      var keep = old && old.password && old.username === user ? { password: old.password } : {};
      return changed(function (d) { d.opensubtitles = Object.assign({ token: j.token, username: user, baseURL: j.base_url || OS_HOST }, keep); });
    });
  };
  OS.logout = function () {
    osRequest('/logout', 'DELETE').catch(B.noop);
    return changed(function (d) { d.opensubtitles = null; });
  };
  /** Zoeken op IMDb-id (afleveringen: parent_imdb_id + seizoen/aflevering) of anders op titel. */
  OS.search = function (opts, languages) {
    var q = {};
    var langs = [];
    (languages || []).forEach(function (l) { apiCodes(l).forEach(function (c) { if (langs.indexOf(c) < 0) langs.push(c); }); });
    langs.sort();
    if (langs.length) q.languages = langs.join(',');
    var numeric = B.int(String(opts.imdb || '').replace('tt', ''));
    var isEp = opts.season != null && opts.episode != null;
    if (numeric && numeric > 0) {
      if (isEp) { q.parent_imdb_id = String(numeric); q.season_number = String(opts.season); q.episode_number = String(opts.episode); }
      else q.imdb_id = String(numeric);
    } else if (B.int(opts.tmdb) > 0) {
      // build 91: geen IMDb-id → TMDB-id (contract: IMDb, anders TMDB, anders titel)
      if (isEp) { q.parent_tmdb_id = String(B.int(opts.tmdb)); q.season_number = String(opts.season); q.episode_number = String(opts.episode); }
      else q.tmdb_id = String(B.int(opts.tmdb));
    } else if (opts.title) {
      var p = B.parseTitle(opts.title);
      q.query = p.title.toLowerCase();
      if (isEp) { q.type = 'episode'; q.season_number = String(opts.season); q.episode_number = String(opts.episode); }
      else { q.type = 'movie'; if (opts.year || p.year) q.year = String(opts.year || p.year); }
    } else return Promise.resolve([]);
    return osRequest('/subtitles', 'GET', q).then(function (j) {
      var subs = (j.data || []).map(function (i) {
        var a = i.attributes || {}, f = (a.files || [])[0];
        if (!f || f.file_id == null) return null;
        return { id: f.file_id, language: a.language || '?', release: a.release || f.file_name || 'Subtitle', downloads: B.int(a.download_count) || 0,
          hearingImpaired: !!a.hearing_impaired, trusted: !!a.from_trusted };
      }).filter(Boolean);
      var order = (languages || []).map(function (l) { return String(l).toLowerCase().slice(0, 2); });
      function rank(s) { var r = order.indexOf(String(s.language).toLowerCase().slice(0, 2)); return r < 0 ? 99 : r; }
      return subs.sort(function (a, b) { return rank(a) - rank(b) || (b.trusted ? 1 : 0) - (a.trusted ? 1 : 0) || b.downloads - a.downloads; });
    });
  };
  /** Downloaden → tekst (UTF-8, anders Windows-1252) → cues [{start, end, text}] in seconden. */
  OS.download = function (sub) {
    if (!OS.isLoggedIn()) return Promise.reject(new Error(L('Sign in to OpenSubtitles first (My Bingr).')));
    // build 91: eerder gedownloade ondertitels uit de eigen opslag (elke download telt mee voor het dagquotum)
    var ck = 'os.cues.' + sub.id;
    return B.idb.get(ck).then(function (c) { return c && c.length ? c : null; }, function () { return null; }).then(function (c) {
      if (c) return c;
      return downloadNow(sub).then(function (cues) { if (cues.length) B.idb.set(ck, cues); return cues; });
    });
  };
  function downloadNow(sub) {
    return osRequest('/download', 'POST', null, { file_id: sub.id, sub_format: 'srt' }).then(function (j) {
      if (!j.link) throw new Error(L('Something went wrong. Please try again.'));
      return B.proxyPost({ action: 'osfile', url: j.link }, { binary: true, timeout: 30000 });
    }).then(function (r) {
      if (r.status < 200 || r.status >= 300 || !r.buffer) throw new Error(L('Something went wrong. Please try again.'));
      return B.subs.parse(B.subs.decode(r.buffer));
    });
  }

  // MARK: ondertitels lezen (SRT en WebVTT) voor de eigen weergave in de speler

  var Sub = B.subs = {};
  Sub.decode = function (buf) {
    var u8 = new Uint8Array(buf);
    if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe && window.TextDecoder) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff && window.TextDecoder) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    if (window.TextDecoder) {
      try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) {
        try { return new TextDecoder('windows-1252').decode(u8); } catch (e2) { /* verder */ }
      }
    }
    var s = '';
    for (var i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, Array.prototype.slice.call(u8, i, i + 8192));
    try { return decodeURIComponent(escape(s)); } catch (e3) { return s; }
  };
  function ts(t) {
    var m = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/.exec(t);
    if (!m) return null;
    return (parseInt(m[1] || '0', 10) * 3600) + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt((m[4] + '00').slice(0, 3), 10) / 1000;
  }
  Sub.parse = function (text) {
    var out = [];
    var blocks = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
    blocks.forEach(function (b) {
      var lines = b.split('\n').filter(function (l) { return l.trim() !== ''; });
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('-->') >= 0) {
          var parts = lines[i].split('-->');
          var s = ts(parts[0]), e = ts(parts[1]);
          if (s == null || e == null) return;
          var txt = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '');
          if (txt.trim()) out.push({ start: s, end: e, text: txt });
          return;
        }
      }
    });
    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  };
  /** Cue op tijdstip t (binair zoeken). */
  Sub.at = function (cues, t) {
    var lo = 0, hi = cues.length - 1, ans = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (cues[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    var lines = [];
    for (var i = ans; i >= 0 && i > ans - 4; i--) if (cues[i].start <= t && t < cues[i].end) lines.unshift(cues[i].text);
    return lines.join('\n');
  };
})();
