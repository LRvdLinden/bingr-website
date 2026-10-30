/*
 * Bingr web: speler. HTML5-video met hls.js (HLS, met de backend-proxy als de server geen CORS stuurt), native HLS in
 * Safari/iOS, MP4/WebM direct, MPEG-TS live via mpegts.js (Xtream: eerst de .m3u8-variant, zoals de Chromecast-fix op
 * Android). Streams van http-servers (en https-servers zonder CORS) gaan via de GET-vorm van de proxy
 * (…/web-proxy?u=…&t=…); die herschrijft HLS-afspeellijsten, zodat ook segmenten via de proxy lopen. Verder zoals de andere apps: hervatten, voortgang, audio- en ondertitelsporen, automatische ondertitels,
 * intro overslaan, volgende aflevering met aftellen, stream_start/ping/stop (max. 6), beeld-in-beeld en volledig scherm.
 * Build 83: films en afleveringen van Xtream-servers eerst als HLS (…/<id>.m3u8, als de server dat levert; in Safari
 * altijd, elders bij MKV/AVI e.d.), elke poging komt in een logboek, en bij een fout zegt de diagnose (playdiag.js)
 * precies wat er mis is, met een knop "Details".
 * Build 102: casten naar AirPlay en Chromecast met de W3C Remote Playback API (zie "MARK: casten").
 */
(function () {
  'use strict';
  var B = window.B;
  var U = B.ui, D = B.data, A = B.account, Lib = B.lib;
  var h = U.h;
  var L = function () { return B.L.apply(null, arguments); };

  // security M3: zelf gehost (zelfde versies als voorheen van de CDN, uit het npm-pakket), zodat de CSP script-src 'self' kan zijn
  var HLS_SRC = ['js/lib/hls-1.5.17.min.js'];
  var MPEGTS_SRC = ['js/lib/mpegts-1.7.3.js'];
  function loadLib(list, test) {
    if (test()) return Promise.resolve();
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.reject(new Error('lib'));
      return B.loadScript(list[i++]).then(function () { if (!test()) throw new Error('lib'); }, next);
    }
    return next();
  }
  B.loadHls = function () { return loadLib(HLS_SRC, function () { return !!window.Hls; }); };
  function loadMpegts() { return loadLib(MPEGTS_SRC, function () { return !!window.mpegts; }); }

  function isAppleNative(v) {
    var ua = navigator.userAgent;
    var iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
    var safari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
    return !!v.canPlayType('application/vnd.apple.mpegurl') && (iOS || safari);
  }
  function extOf(url) { var m = /\.([a-z0-9]{2,5})$/i.exec(String(url).split(/[?#]/)[0]); return m ? m[1].toLowerCase() : ''; }
  /** Safari (macOS, iOS, iPadOS; ook andere browsers op iOS, die de engine van Safari gebruiken). */
  function isSafariEngine() {
    var ua = navigator.userAgent;
    var iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
    return iOS || /^((?!chrome|chromium|android|crios|fxios|edg|opr).)*safari/i.test(ua);
  }
  B.isSafariEngine = isSafariEngine;
  // nooit in een browser (geen enkele browser kent deze containers)
  var UNSUPPORTED = { avi: 1, wmv: 1, flv: 1, divx: 1, xvid: 1, rmvb: 1, '3gp': 1 };
  // MKV: Chrome, Edge en nieuwere Firefox spelen het met H.264/VP9/AV1 en AAC/Opus/MP3; Safari nooit
  var MATROSKA = { mkv: 1 };

  function unsupportedError(ext) { var e = new Error(L('This format (%@) doesn’t play in the browser. Watch in the app.', ext.toUpperCase())); e.unsupported = ext; return e; }
  function safariMkvError(ext) {
    var e = new Error(L('Safari can’t play %@ files. Watch in the Bingr app, or use Chrome, Edge or Firefox.', ext.toUpperCase()));
    e.unsupported = ext;
    return e;
  }
  function isBackendURL(url) { return String(url || '').indexOf(B.config.supabaseUrl) === 0; }

  /**
   * Volgorde van pogingen voor een URL: [{how: 'hls'|'mpegts'|'direct', url, proxy?}]. Films en afleveringen (niet
   * live) van een https-server krijgen daarna dezelfde poging via de proxy: Xtream-servers sturen /movie/ en /series/
   * vaak door naar een http-adres (dat blokkeert de browser op een https-pagina) of naar een host zonder geldig
   * certificaat; de proxy volgt die doorverwijzing zelf.
   */
  function basePlan(url, live, forceTry) {
    var ext = extOf(url);
    if (UNSUPPORTED[ext] && !forceTry) return { error: unsupportedError(ext) };
    if (MATROSKA[ext] && !forceTry && isSafariEngine()) return { error: safariMkvError(ext) };
    var variant = /\.ts$/i.test(String(url).split('?')[0]) && /\/(live|timeshift)\//i.test(url) ? url.replace(/\.ts(\?|$)/i, '.m3u8$1') : null;
    var plan;
    if (ext === 'm3u8' || ext === 'm3u') plan = { steps: [{ how: 'hls', url: url }] };
    else if (/^(mp4|m4v|webm|mov|ogv|ogg|mp3|aac|m4a|mkv)$/.test(ext) || UNSUPPORTED[ext]) plan = { steps: [{ how: 'direct', url: url }] };
    else if (ext === 'ts' || ext === 'mpegts') {
      var s = [];
      if (variant) s.push({ how: 'hls', url: variant });
      s.push({ how: 'mpegts', url: url });
      if (!variant) s.push({ how: 'hls', url: url });
      plan = { steps: s };
    }
    // geen extensie (veel IPTV-livestreams, Plex/Jellyfin-transcode met query)
    else if (/m3u8/i.test(url)) plan = { steps: [{ how: 'hls', url: url }] };
    else plan = { steps: live ? [{ how: 'hls', url: url }, { how: 'mpegts', url: url }, { how: 'direct', url: url }] : [{ how: 'direct', url: url }, { how: 'hls', url: url }] };
    if (!live && /^https:/i.test(url) && !B.isProxied(url) && !isBackendURL(url)) {
      var extra = [];
      plan.steps.forEach(function (st) { if (st.how === 'direct') extra.push({ how: 'direct', url: st.url, proxy: true }); });
      plan.steps = plan.steps.concat(extra);
    }
    return plan;
  }
  /**
   * Met HLS-varianten (build 83, films/afleveringen van Xtream): in Safari altijd eerst HLS (Safari kent geen MKV en
   * speelt AC3/E-AC3 en HEVC wel in HLS), elders eerst bij een formaat dat de browser niet kent (MKV, AVI, …) en anders
   * als laatste poging. Een HLS-stap met probe:true wordt eerst gecontroleerd (#EXTM3U met segmenten).
   */
  B.playPlan = function (url, live, forceTry, hlsCands) {
    var base = basePlan(url, live, forceTry);
    if (live || !hlsCands || !hlsCands.length) return base;
    var ext = extOf(url), safari = isSafariEngine();
    var native = /^(mp4|m4v|mov)$/.test(ext) || (!safari && ext === 'webm');
    var probes = hlsCands.map(function (c) { return { how: 'hls', probe: true, url: c.url, kind: c.kind }; });
    var rest = base.error ? [{ how: 'fail', error: base.error }] : base.steps;
    return { steps: safari || !native ? probes.concat(rest) : rest.concat(probes) };
  };

  /** Per server en vorm (movie/series/hls): levert hij HLS voor films/afleveringen? (alleen deze sessie) */
  var vodHlsMemo = {};
  function hostOf(u) { var m = /^https?:\/\/(?:[^@\/]*@)?([^\/?#]+)/i.exec(String(u || '')); return m ? m[1].toLowerCase() : ''; }

  /** MediaError als Error, met code en de tekst van de browser (Chrome: DEMUXER_ERROR_…, Firefox: …). */
  function mediaErr(v) {
    var me = v && v.error, e = new Error('MEDIA_ERR_' + ((me && me.code) || 0));
    e.media = { code: (me && me.code) || 0, message: (me && me.message) || '' };
    return e;
  }

  // MARK: hls.js-lader met de proxy als terugval (geen CORS)

  function makeLoader(Hls) {
    var Base = Hls.DefaultConfig.loader;
    function stats0() {
      var t = performance.now();
      return { aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0,
        loading: { start: t, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 } };
    }
    function ProxyLoader(config) { this.config = config; this.inner = null; this._stats = stats0(); this.context = null; this.callbacks = null; this.done = false; }
    Object.defineProperty(ProxyLoader.prototype, 'stats', { get: function () { return this.inner ? this.inner.stats : this._stats; } });
    ProxyLoader.prototype.destroy = function () { this.done = true; if (this.inner) { this.inner.destroy(); this.inner = null; } this.callbacks = null; };
    ProxyLoader.prototype.abort = function () {
      this.done = true;
      if (this.inner) this.inner.abort();
      else { this._stats.aborted = true; var cb = this.callbacks; if (cb && cb.onAbort) cb.onAbort(this._stats, this.context, null); }
    };
    ProxyLoader.prototype.getResponseHeader = function (n) { return this.inner && this.inner.getResponseHeader ? this.inner.getResponseHeader(n) : null; };
    ProxyLoader.prototype.getCacheAge = function () { return this.inner && this.inner.getCacheAge ? this.inner.getCacheAge() : null; };
    ProxyLoader.prototype.load = function (context, config, callbacks) {
      var self = this;
      this.context = context; this.callbacks = callbacks; this.done = false;
      var url = context.url;
      if (B.isInsecure(url) || B.needsProxy(url)) { this.viaProxy(context, config, callbacks); return; }
      // eerste poging zonder eigen herhalingen: bij een CORS-fout meteen via de proxy
      var cfg = B.assign({}, config);
      if (config.loadPolicy) cfg.loadPolicy = B.assign({}, config.loadPolicy, { errorRetry: null });
      this.inner = new Base(this.config);
      this.inner.load(context, cfg, {
        onSuccess: callbacks.onSuccess, onProgress: callbacks.onProgress, onAbort: callbacks.onAbort, onTimeout: callbacks.onTimeout,
        onError: function (err, ctx, nd, st) {
          if (err && err.code === 0 && !self.done && /^https:/i.test(url) && !B.isProxied(url)) {
            if (self.inner) { self.inner.destroy(); self.inner = null; }
            self.viaProxy(context, config, callbacks);
            return;
          }
          callbacks.onError(err, ctx, nd, st);
        }
      });
    };
    ProxyLoader.prototype.viaProxy = function (context, config, callbacks) {
      var self = this;
      var st = this._stats = stats0();
      var range = null;
      if (context.rangeEnd) range = 'bytes=' + (context.rangeStart || 0) + '-' + (context.rangeEnd - 1);
      else if (context.rangeStart) range = 'bytes=' + context.rangeStart + '-';
      var binary = context.responseType === 'arraybuffer';
      B.proxyFetch(context.url, { binary: binary, range: range, timeout: Math.max(20000, (config && config.timeout) || 0) }).then(function (r) {
        if (self.done) return;
        var t = performance.now();
        st.loading.first = st.loading.end = t;
        var data = binary ? r.buffer : r.text;
        st.loaded = st.total = binary ? (data ? data.byteLength : 0) : (data || '').length;
        if (r.status >= 200 && r.status < 300) {
          B.markProxy(context.url);
          callbacks.onSuccess({ url: context.url, data: data, code: r.status }, st, context, null);
        } else callbacks.onError({ code: r.status, text: 'proxy ' + r.status }, context, null, st);
      }, function () {
        if (self.done) return;
        callbacks.onError({ code: 0, text: 'proxy' }, context, null, st);
      });
    };
    return ProxyLoader;
  }

  // MARK: engine (één <video>)

  function Engine(ev, video) {
    this.ev = ev; this.v = video; this.hls = null; this.ts = null; this.how = null; this.started = false;
    var self = this;
    // build 148: haperingen tijdens het afspelen (playback_stall) voor de diagnose: na het eerste beeld, niet bij zelf spoelen
    var stallAt = 0, firstPlay = 0, seekAt = 0;
    video.addEventListener('seeking', function () { seekAt = Date.now(); });
    video.onwaiting = function () {
      self.ev.buffering(true);
      if (firstPlay && !stallAt && !video.seeking && Date.now() - seekAt > 1500) stallAt = Date.now();
    };
    video.onplaying = function () {
      self.ev.buffering(false); self.ev.state();
      if (!firstPlay) firstPlay = Date.now();
      else if (stallAt && B.diag && B.diag.stall) B.diag.stall(Date.now() - stallAt, stallAt - firstPlay, self.how || '');
      stallAt = 0;
    };
    video.addEventListener('emptied', function () { firstPlay = 0; stallAt = 0; });
    video.onpause = function () { self.ev.state(); };
    video.onplay = function () { self.ev.state(); };
    video.onended = function () { self.ev.ended(); };
    video.onerror = function () { if (self.started) { var e = mediaErr(video); self.note(e, true); self.ev.error(e); } };
    this.trace = []; this.hlsTried = false; this.url = null;
    // build 97: generatie; stop() en elke nieuwe open() verhogen hem, zodat een lopende poging (bibliotheek laden,
    // proxytoken) na een async stap niets meer aan de gedeelde <video> hangt
    this.gen = 0; this._fail = null;
  }
  Engine.prototype.reset = function () {
    if (this.hls) { try { this.hls.destroy(); } catch (e) { /* stil */ } this.hls = null; }
    if (this.ts) { try { this.ts.pause(); this.ts.unload(); this.ts.detachMediaElement(); this.ts.destroy(); } catch (e) { /* stil */ } this.ts = null; }
    var v = this.v;
    try { v.pause(); } catch (e) { /* stil */ }
    v.removeAttribute('src');
    try { v.load(); } catch (e) { /* stil */ }
    this.started = false;
  };
  Engine.prototype.stop = function () {
    // build 97: lopende poging echt afbreken (timer, listeners) en latere async stappen ongeldig maken
    this.stopped = true; this.gen++;
    var f = this._fail; this._fail = null;
    if (f) { try { f(new Error('stopped')); } catch (e) { /* stil */ } }
    this.reset();
  };
  /** Fout na het starten in het logboek (bij de laatste poging). */
  Engine.prototype.note = function (e, after) {
    var last = this.trace[this.trace.length - 1];
    if (!last) return;
    last.err = (after ? 'after start: ' : '') + (e && e.message);
    if (e && e.media) last.media = e.media;
  };
  /** Eén poging; resolve zodra er beeld is (canplay), reject bij een fout of na 25 s. */
  Engine.prototype.attempt = function (step, opts) {
    var self = this, v = this.v;
    this.reset();
    this.how = step.how;
    var gen = this.gen;
    return new Promise(function (resolve, reject) {
      // via de proxy komt een film in stukken van 8 MB: wat meer tijd voor het eerste beeld
      var done = false, timer = setTimeout(function () { fail(new Error('timeout')); }, opts.live ? 20000 : (step.orig ? 45000 : 25000));
      var onErr = null, once = null;
      // build 97: alle listeners van deze poging weg, bij succes, fout én stop
      function cleanup() {
        clearTimeout(timer);
        v.removeEventListener('canplay', ok); v.removeEventListener('loadeddata', ok);
        if (onErr) v.removeEventListener('error', onErr);
        if (once) v.removeEventListener('loadedmetadata', once);
        if (self._fail === fail) self._fail = null;
      }
      function ok() {
        if (done) return; done = true; cleanup();
        resolve();
      }
      function fail(e) {
        if (done) return; done = true; cleanup();
        reject(e || new Error('fail'));
      }
      /** build 97: na een async stap: is deze poging nog de actuele? Zo nee: afbreken zonder iets aan de <video> te hangen. */
      function stale() {
        if (done) return true;
        if (self.stopped || self.gen !== gen) { fail(new Error('stopped')); return true; }
        return false;
      }
      self._fail = fail;
      v.addEventListener('canplay', ok); v.addEventListener('loadeddata', ok);
      onErr = function () { if (!self.started) fail(mediaErr(v)); };
      v.addEventListener('error', onErr);
      if (step.how === 'direct' || (step.how === 'hls' && isAppleNative(v))) {
        v.src = step.url;
        if (opts.start > 5 && !opts.live) {
          once = function () { v.removeEventListener('loadedmetadata', once); once = null; try { v.currentTime = opts.start; } catch (e) { /* stil */ } };
          v.addEventListener('loadedmetadata', once);
        }
        v.load();
        return;
      }
      if (step.how === 'hls') {
        B.loadHls().then(function () {
          if (stale()) return;
          var Hls = window.Hls;
          if (!Hls.isSupported()) { if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = step.url; v.load(); return; } fail(new Error('no_mse')); return; }
          var hls = self.hls = new Hls({
            loader: makeLoader(Hls), enableWorker: true, backBufferLength: 60, maxBufferLength: 30,
            startPosition: opts.start > 5 && !opts.live ? opts.start : -1, renderTextTracksNatively: true,
            manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 3
          });
          var recovered = 0;
          hls.on(Hls.Events.ERROR, function (evt, data) {
            if (!data || !data.fatal) return;
            var code = data.response && data.response.code;
            if (self.hls !== hls) return; // build 97: oude instantie
            if (!self.started) { fail(new Error('hls_' + data.details + (code ? ' (HTTP ' + code + ')' : ''))); return; }
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recovered < 2) { recovered++; hls.recoverMediaError(); return; }
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && recovered < 2) { recovered++; hls.startLoad(); return; }
            var he = new Error('hls_' + data.details + (code ? ' (HTTP ' + code + ')' : ''));
            self.note(he, true);
            self.ev.error(he);
          });
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function () { self.ev.tracks(); });
          hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, function () { self.ev.tracks(); });
          hls.subtitleDisplay = false;
          hls.loadSource(step.url);
          hls.attachMedia(v);
        }, function () { fail(new Error('hls_lib')); });
        return;
      }
      if (step.how === 'mpegts') {
        loadMpegts().then(function () {
          if (stale()) return;
          var M = window.mpegts;
          if (!M.getFeatureList().mseLivePlayback) { fail(new Error('no_mse')); return; }
          var p = self.ts = M.createPlayer({ type: 'mpegts', isLive: !!opts.live, url: step.url },
            { enableWorker: false, lazyLoad: false, liveBufferLatencyChasing: true, autoCleanupSourceBuffer: true });
          p.on(M.Events.ERROR, function (type, detail) {
            if (self.ts !== p) return; // build 97: oude instantie
            var me = new Error('mpegts ' + (type || '') + (detail ? ' ' + detail : ''));
            if (!self.started) fail(me); else { self.note(me, true); self.ev.error(me); }
          });
          p.attachMediaElement(v);
          p.load();
        }, function () { fail(new Error('mpegts_lib')); });
      }
    });
  };
  Engine.prototype.open = function (url, opts) {
    var self = this;
    var PD = B.playdiag;
    // build 97: eigen generatie per open(); een oudere keten die na stop()+open() terugkomt, stopt zichzelf
    var gen = ++this.gen;
    function alive() { return !self.stopped && self.gen === gen; }
    this.url = url; this.trace = []; this.hlsTried = false; this.hlsFound = false;
    var plan = B.playPlan(url, opts.live, opts.forceTry, opts.hls);
    if (plan.error) { this.trace.push({ how: 'format', ok: false, err: plan.error.message, url: PD.mask(url) }); return Promise.reject(plan.error); }
    var hlsFound = false;
    var i = 0, lastErr = null;
    var proxied = plan.steps.some(function (st) { return B.mustProxy(st.url); });
    if (proxied) {
      // via de proxy: een doorlopende .ts-stream loopt tegen de tijdslimiet van de proxy aan; als er een HLS-variant
      // is (Xtream live/terugkijken), alleen die
      var hasHls = plan.steps.some(function (st) { return st.how === 'hls'; });
      if (hasHls) plan.steps = plan.steps.filter(function (st) { return st.how !== 'mpegts' || !/\/(live|timeshift)\//i.test(st.url); });
    }
    function next() {
      if (!alive()) return Promise.reject(new Error('stopped'));
      if (i >= plan.steps.length) return Promise.reject(lastErr || new Error('fail'));
      var step = plan.steps[i++];
      if (step.how === 'fail') {
        self.trace.push({ how: 'format', ok: false, err: step.error.message, url: PD.mask(url) });
        lastErr = step.error;
        return next();
      }
      if (step.probe) return probeHls(step);
      if (step.proxy || B.mustProxy(step.url)) {
        return B.ensureProxyToken().then(function () {
          if (!alive()) return Promise.reject(new Error('stopped')); // build 97
          var pu = B.proxyGetURL(step.url);
          if (!pu) { lastErr = lastErr || new Error('proxy_token'); return next(); }
          return run({ how: step.how, url: pu, orig: step.url, vodHls: step.vodHls });
        });
      }
      return run(step);
    }
    /**
     * HLS-variant van een film/aflevering: eerst via de proxy kijken of de server echt een afspeellijst geeft
     * (kort, 7 s). Zo ja: Safari speelt hem zelf (eerst direct bij https, anders/daarna via de proxy, die afspeellijst
     * en segmenten herschrijft); hls.js valt zelf terug op de proxy. Zo nee: door naar de volgende poging.
     */
    function probeHls(step) {
      if (hlsFound || !alive()) return next();
      var memoKey = hostOf(step.url) + '|' + step.kind;
      if (vodHlsMemo[memoKey] === false) return next();
      self.hlsTried = true;
      return PD.probe(step.url, 7000).then(function (p) {
        if (!alive()) return Promise.reject(new Error('stopped'));
        var ok = PD.isHls(p);
        // deze sessie onthouden: geeft de server 4xx op deze vorm, dan niet bij elke titel opnieuw vragen
        if (ok) vodHlsMemo[memoKey] = true;
        else if (!p.error && p.status >= 400 && p.status < 500 && vodHlsMemo[memoKey] !== true) vodHlsMemo[memoKey] = false;
        self.trace.push({ how: 'hls-check (' + step.kind + ')', via: 'proxy', url: PD.mask(step.url), ok: ok, err: ok ? null : (p.error || 'no HLS'), probe: p, ms: p.ms });
        B.log('HLS-variant ' + step.kind + ': ' + (ok ? 'ja' : 'nee'), PD.sigLabel(p));
        if (!ok) {
          // de server even laten opruimen (IPTV-abonnementen tellen verbindingen)
          var wait = p.bytes && p.bytes.length && !p.error ? 600 : 0;
          return new Promise(function (r) { setTimeout(r, wait); }).then(next);
        }
        hlsFound = self.hlsFound = true;
        var subs = [];
        var insecureInside = p.finalProtocol === 'http' || /^http:/i.test((p.hls && p.hls.first) || '');
        if (isAppleNative(self.v)) {
          if (!B.mustProxy(step.url) && !insecureInside) subs.push({ how: 'hls', url: step.url, vodHls: true });
          subs.push({ how: 'hls', url: step.url, proxy: true, vodHls: true });
        } else subs.push({ how: 'hls', url: step.url, vodHls: true, proxy: insecureInside && !B.mustProxy(step.url) });
        plan.steps.splice.apply(plan.steps, [i, 0].concat(subs));
        return next();
      });
    }
    function run(step) {
      B.log('afspelen via ' + step.how + (step.orig ? ' (proxy)' : ''), PD.mask(step.orig || step.url));
      self.lastStep = step;
      var rec = { how: step.how + (step.vodHls ? ' (VOD)' : ''), via: step.orig ? 'proxy' : 'direct', url: PD.mask(step.orig || step.url), ok: false };
      var t0 = Date.now();
      self.trace.push(rec);
      if (!alive()) return Promise.reject(new Error('stopped'));
      return self.attempt(step, opts).then(function () {
        if (!alive()) return Promise.reject(new Error('stopped')); // build 97
        rec.ok = true; rec.ms = Date.now() - t0;
        self.started = true;
        if (opts.onReady) { try { opts.onReady(); } catch (e) { B.log('onReady', e); } }
        var p = self.v.play();
        return p && p.then ? p.then(null, function (e) { if (e && e.name === 'NotAllowedError') self.ev.needsTap(); }) : null;
      }, function (e) {
        rec.ms = Date.now() - t0; rec.err = e && e.message; if (e && e.media) rec.media = e.media;
        if (!alive()) return Promise.reject(new Error('stopped')); // build 97
        lastErr = e; return next();
      });
    }
    this.stopped = false;
    return next();
  };
  Engine.prototype.play = function () { var p = this.v.play(); if (p && p.catch) p.catch(B.noop); };
  Engine.prototype.pause = function () { this.v.pause(); };
  Object.defineProperty(Engine.prototype, 'playing', { get: function () { return !this.v.paused && !this.v.ended; } });
  Engine.prototype.time = function () { return this.v.currentTime || 0; };
  Engine.prototype.duration = function () { var d = this.v.duration; return isFinite(d) ? d : 0; };
  Engine.prototype.seek = function (s) { try { this.v.currentTime = Math.max(0, s); } catch (e) { /* stil */ } };
  Engine.prototype.tracks = function () {
    var out = { audio: [], text: [] };
    var hls = this.hls;
    if (hls) {
      (hls.audioTracks || []).forEach(function (t, i) { out.audio.push({ index: i, lang: t.lang || '', label: B.clang.name(t.lang) || t.name || (L('Audio') + ' ' + (i + 1)) }); });
      out.currentAudio = hls.audioTrack;
      (hls.subtitleTracks || []).forEach(function (t, i) { out.text.push({ index: i, lang: t.lang || '', label: (B.clang.name(t.lang) || t.name || (L('Subtitles') + ' ' + (i + 1))) + (t.forced ? ' (forced)' : '') }); });
      out.currentText = hls.subtitleTrack >= 0 && hls.subtitleDisplay ? hls.subtitleTrack : null;
      return out;
    }
    var v = this.v;
    var at = v.audioTracks;
    if (at) for (var i = 0; i < at.length; i++) { out.audio.push({ index: i, lang: at[i].language, label: B.clang.name(at[i].language) || at[i].label || (L('Audio') + ' ' + (i + 1)) }); if (at[i].enabled) out.currentAudio = i; }
    var tt = v.textTracks;
    if (tt) for (var j = 0; j < tt.length; j++) {
      if (tt[j].kind === 'metadata') continue;
      out.text.push({ index: j, lang: tt[j].language, label: B.clang.name(tt[j].language) || tt[j].label || (L('Subtitles') + ' ' + (j + 1)) });
      if (tt[j].mode === 'showing') out.currentText = j;
    }
    return out;
  };
  Engine.prototype.selectAudio = function (i) {
    if (this.hls) { this.hls.audioTrack = i; return; }
    var at = this.v.audioTracks; if (at) for (var k = 0; k < at.length; k++) at[k].enabled = k === i;
  };
  Engine.prototype.selectText = function (i) {
    if (this.hls) {
      if (i == null) { this.hls.subtitleDisplay = false; this.hls.subtitleTrack = -1; }
      else { this.hls.subtitleTrack = i; this.hls.subtitleDisplay = true; }
      return;
    }
    var tt = this.v.textTracks; if (tt) for (var k = 0; k < tt.length; k++) if (tt[k].kind !== 'metadata') tt[k].mode = k === i ? 'showing' : 'disabled';
  };

  // MARK: spelerscherm

  B.player = { current: null };

  /**
   * B.player.open(item, ctx)
   * item: {type: 'live'|'movie'|'episode'|'catchup', id, title, subtitle, streamURL, stalkerCmd, artwork, seriesID, season, episode, channel}
   * ctx: {channels, index, episodes, series, resume}
   */
  B.player.open = function (item, ctx) {
    ctx = ctx || {};
    // build 97: opnieuw openen vanuit de speler (bv. "Vanaf het begin" bij live): de bestaande geschiedenisregel van
    // de speler vervangen in plaats van een tweede toe te voegen (anders een dode Terug-stap)
    var reopened = !!B.player.current;
    // build 128: server van dit item (andere server: item._src; afspelen via die server zonder te wisselen)
    function isrc() { return (item && (item._src || (item.channel && item.channel._src))) || Lib.source; }
    if (B.player.current) B.player.current.close(true);
    var profile = B.app.profile;
    var engine = null;
    var closed = false, hideTimer = null, tickTimer = null, pingTimer = null;
    var watchedSeconds = 0, recorded = false, lastSave = 0, attempts = 0, triedBackup = false;
    var nextShown = false, nextDismissed = false, countdownTimer = null;
    var marker = null, extCues = null, extOffset = 0, extTimer = null, scrobbled = false, stopSent = false, traktMarked = false;
    var failPos = 0; // plek bij de laatste fout (films/afleveringen), voor "Opnieuw"
    var startGen = 0, limited = false, audioChosen = false, autoSubsDone = false, forceTry = false, subsStartedAt = 0, extTrack = null, subsRetry = null;
    var zapTimer = null, zapIndex = null;
    var seeking = null;

    var video = h('video.pl-video', { playsinline: true, 'webkit-playsinline': true, preload: 'auto' });
    video.setAttribute('x-webkit-airplay', 'allow');
    // build 102: `video` is de <video> die nu speelt (tijdens casten castVideo); localVideo blijft de eigen speler
    var localVideo = video;
    var castVideo = h('video.pl-castvid', { preload: 'none', playsinline: true, 'webkit-playsinline': true, 'aria-hidden': 'true', tabindex: '-1' });
    castVideo.setAttribute('x-webkit-airplay', 'allow');
    var castText = h('div.pl-cast-t'), castHint = h('div.pl-cast-h');
    var castUI = h('div.pl-cast', { 'aria-live': 'polite' }, [U.icon(isSafariEngine() ? 'airplay' : 'cast', 'pl-cast-ic'), castText, castHint]);
    castUI.style.display = 'none';
    var subtitle = h('div.pl-sub');
    var spinner = h('div.pl-spin', [U.spinner()]);
    var tap = h('div.pl-tap');
    var title = h('div.pl-title'), sub = h('div.pl-subtitle'), epg = h('div.pl-epg');
    var backBtn = U.button('', function () { close(); }, { icon: 'back', cls: 'pl-ib', title: L('Back') + ' (Esc)' });
    var top = h('div.pl-top', [backBtn, h('div.pl-titles', [title, sub, epg])]);
    var fill = h('div.pl-fill'), buf = h('div.pl-buf'), knob = h('div.pl-knob'), hoverT = h('div.pl-hover');
    var bar = h('div.pl-bar', { role: 'slider', tabindex: '0', 'aria-label': L('Position') }, [h('div.pl-track', [buf, fill]), knob, hoverT]);
    var tCur = h('span.pl-time'), tDur = h('span.pl-time.right');
    var leftBtns = h('div.pl-btns'), rightBtns = h('div.pl-btns.right');
    var bottom = h('div.pl-bottom', [h('div.pl-prog', [tCur, bar, tDur]), h('div.pl-row', [leftBtns, rightBtns])]);
    var center = h('div.pl-center');
    var skipBtn = U.button(L('Skip intro'), function () { skipIntro(); }, { cls: 'pl-skip' });
    skipBtn.style.display = 'none';
    var nextCard = h('div.pl-next'); nextCard.style.display = 'none';
    var zapBanner = h('div.pl-zap'); zapBanner.style.display = 'none';
    var errorBox = h('div.pl-error', { role: 'alert' }); errorBox.style.display = 'none';
    var tapPlay = U.button(L('Play'), function () { tapPlay.style.display = 'none'; if (engine) engine.play(); }, { primary: true, icon: 'play', cls: 'pl-tapplay' });
    tapPlay.style.display = 'none';
    var root = h('div.player', { role: 'dialog', 'aria-label': L('Player') }, [video, castVideo, castUI, subtitle, tap, spinner, top, center, bottom, skipBtn, nextCard, zapBanner, tapPlay, errorBox]);
    var screen = { el: root, item: function () { return item; } };

    function isLive() { return item.type === 'live'; }
    function isCatchup() { return item.type === 'catchup'; }

    // MARK: bediening tonen/verbergen

    function showControls() {
      root.classList.add('ui');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        if (engine && engine.playing && !root.querySelector('.pl-bar.drag') && !root.matches(':hover .pl-bottom:hover')) root.classList.remove('ui');
      }, 3200);
    }
    root.addEventListener('mousemove', showControls);
    root.addEventListener('touchstart', function () { if (!root.classList.contains('ui')) { showControls(); } }, { passive: true });
    tap.addEventListener('click', function () {
      if (U.isTouch()) { if (root.classList.contains('ui')) root.classList.remove('ui'); else showControls(); return; }
      togglePlay();
    });
    tap.addEventListener('dblclick', function () { toggleFullscreen(); });

    function iconBtn(icon, label, fn, cls) { return U.button('', fn, { icon: icon, cls: 'pl-ib' + (cls ? ' ' + cls : ''), title: label }); }
    var playBtn = iconBtn('pause', L('Play / pause') + ' (K)', function () { togglePlay(); }, 'pl-playbtn');
    var muteBtn = iconBtn('volume', L('Mute') + ' (M)', function () { video.muted = !video.muted; drawVolume(); });
    var vol = h('input.pl-vol', { type: 'range', min: '0', max: '1', step: '0.05', value: '1', 'aria-label': L('Volume') });
    vol.addEventListener('input', function () { video.volume = parseFloat(vol.value); video.muted = video.volume === 0; drawVolume(); });
    var pipBtn = iconBtn('pip', L('Picture in Picture'), function () { togglePip(); });
    var fsBtn = iconBtn('full', L('Full screen') + ' (F)', function () { toggleFullscreen(); });
    var castBtn = iconBtn(isSafariEngine() ? 'airplay' : 'cast', isSafariEngine() ? L('AirPlay') : L('Cast'), function () { castClick(); }, 'pl-castbtn');
    castBtn.style.display = 'none';
    function drawVolume() {
      U.clear(muteBtn); muteBtn.appendChild(U.icon(video.muted || video.volume === 0 ? 'mute' : 'volume'));
      vol.value = video.muted ? 0 : video.volume;
      try { B.store.set('volume', { v: video.volume, m: video.muted }); } catch (e) { /* stil */ }
    }
    var savedVol = B.store.get('volume', null);
    if (savedVol) { video.volume = B.clamp(savedVol.v, 0, 1); video.muted = !!savedVol.m; }
    function drawPlay() {
      var p = engine && engine.playing;
      U.clear(playBtn); playBtn.appendChild(U.icon(p ? 'pause' : 'play'));
      root.classList.toggle('paused', !p);
      var big = center.querySelector('.pl-bigplay');
      if (big) { U.clear(big); big.appendChild(U.icon(p ? 'pause' : 'play')); }
      if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = p ? 'playing' : 'paused'; } catch (e) { /* stil */ } }
    }

    function renderInfo() {
      title.textContent = isLive() && item.channel ? ((item.channel.number ? item.channel.number + '  ' : '') + B.chanName(item.channel.name)) : B.showName(item.title);
      if (isCatchup()) title.textContent = '⟲ ' + B.showName(item.title);
      sub.textContent = B.showName(item.subtitle || '');
      U.clear(epg);
      if ((isLive() || isCatchup()) && item.channel) {
        var nn = Lib.nowNext(item.channel);
        if (isLive() && nn.now) epg.appendChild(h('div', [h('b', L('Now') + '  '), B.fmtTime(nn.now.start) + '–' + B.fmtTime(nn.now.end) + '  ' + B.showName(nn.now.title)]));
        if (isLive() && nn.next) epg.appendChild(h('div.muted', [h('b', L('Next') + '  '), B.fmtTime(nn.next.start) + '  ' + B.showName(nn.next.title)]));
      }
      U.clear(leftBtns); U.clear(rightBtns); U.clear(center);
      leftBtns.appendChild(playBtn);
      if (!isLive()) {
        leftBtns.appendChild(iconBtn('back10', L('10 seconds back') + ' (←)', function () { jump(-10); }, 'pl-desk'));
        leftBtns.appendChild(iconBtn('fwd10', L('10 seconds forward') + ' (→)', function () { jump(10); }, 'pl-desk'));
      } else if ((ctx.channels || []).length > 1) {
        leftBtns.appendChild(iconBtn('chUp', L('Previous channel') + ' (↑)', function () { zap(-1); }, 'pl-desk'));
        leftBtns.appendChild(iconBtn('chDown', L('Next channel') + ' (↓)', function () { zap(1); }, 'pl-desk'));
      }
      leftBtns.appendChild(h('div.pl-volbox', [muteBtn, vol]));
      if (item.type === 'episode' && nextEpisode()) rightBtns.appendChild(U.button(L('Next episode'), function () { playNext(); }, { icon: 'next', cls: 'pl-tb' }));
      if (isLive() && item.channel) {
        var nn2 = Lib.nowNext(item.channel);
        if (nn2.now && Lib.canCatchup(item.channel, nn2.now)) rightBtns.appendChild(iconBtn('replay', L('From the start'), function () { B.player.playCatchup(item.channel, nn2.now, ctx.channels); }));
      }
      rightBtns.appendChild(iconBtn('audio', L('Audio'), chooseAudio));
      rightBtns.appendChild(iconBtn('subs', L('Subtitles'), chooseText));
      if (castSupported) rightBtns.appendChild(castBtn);
      if (document.pictureInPictureEnabled || video.webkitSupportsPresentationMode) rightBtns.appendChild(pipBtn);
      rightBtns.appendChild(fsBtn);
      // aanraakscherm: grote knoppen in het midden
      if (!isLive()) center.appendChild(U.button('', function () { jump(-10); }, { icon: 'back10', cls: 'pl-cb', title: L('10 seconds back') }));
      else if ((ctx.channels || []).length > 1) center.appendChild(U.button('', function () { zap(-1); }, { icon: 'chUp', cls: 'pl-cb', title: L('Previous channel') }));
      var big = U.button('', function () { togglePlay(); }, { icon: 'pause', cls: 'pl-cb pl-bigplay', title: L('Play / pause') });
      center.appendChild(big);
      if (!isLive()) center.appendChild(U.button('', function () { jump(10); }, { icon: 'fwd10', cls: 'pl-cb', title: L('10 seconds forward') }));
      else if ((ctx.channels || []).length > 1) center.appendChild(U.button('', function () { zap(1); }, { icon: 'chDown', cls: 'pl-cb', title: L('Next channel') }));
      bar.classList.toggle('live', isLive());
      drawPlay(); drawVolume(); drawCast();
      mediaSession();
    }
    function mediaSession() {
      if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
      try {
        var aw = item.artwork ? String(item.artwork) : '';
        if (B.isInsecure(aw)) aw = B.proxyGetURL(aw) || '';
        var art = aw ? [{ src: aw, sizes: '512x512' }] : [];
        navigator.mediaSession.metadata = new MediaMetadata({ title: isLive() && item.channel ? B.chanName(item.channel.name) : B.showName(item.title), artist: B.showName(item.subtitle) || 'Bingr', album: 'Bingr', artwork: art });
        var ms = navigator.mediaSession;
        ms.setActionHandler('play', function () { if (engine) engine.play(); });
        ms.setActionHandler('pause', function () { if (engine) engine.pause(); });
        ms.setActionHandler('seekbackward', isLive() ? null : function () { jump(-10); });
        ms.setActionHandler('seekforward', isLive() ? null : function () { jump(10); });
        ms.setActionHandler('nexttrack', item.type === 'episode' && nextEpisode() ? function () { playNext(); } : (isLive() ? function () { zap(1); } : null));
        ms.setActionHandler('previoustrack', isLive() ? function () { zap(-1); } : null);
      } catch (e) { /* niet ondersteund */ }
    }

    function updateTime() {
      if (!engine) return;
      if (isLive()) {
        var nn = item.channel ? Lib.nowNext(item.channel) : {};
        if (nn.now) {
          fill.style.width = (B.clamp((Date.now() - nn.now.start) / (nn.now.end - nn.now.start), 0, 1) * 100) + '%';
          tCur.textContent = B.fmtTime(nn.now.start); tDur.textContent = B.fmtTime(nn.now.end);
        } else { fill.style.width = '100%'; tCur.textContent = 'LIVE'; tDur.textContent = ''; }
        knob.style.display = 'none'; buf.style.width = '0';
        return;
      }
      knob.style.display = '';
      var t = seeking != null ? seeking : engine.time(), d = engine.duration();
      var f = d > 0 ? B.clamp(t / d, 0, 1) : 0;
      fill.style.width = (f * 100) + '%';
      knob.style.left = (f * 100) + '%';
      try { var b = video.buffered; if (b.length && d > 0) buf.style.width = (B.clamp(b.end(b.length - 1) / d, 0, 1) * 100) + '%'; } catch (e) { /* stil */ }
      tCur.textContent = B.fmtDur(t);
      tDur.textContent = d > 0 ? '-' + B.fmtDur(Math.max(0, d - t)) : '';
      bar.setAttribute('aria-valuenow', String(Math.round(t)));
      bar.setAttribute('aria-valuemax', String(Math.round(d)));
      bar.setAttribute('aria-valuetext', B.fmtDur(t));
    }

    // doorspoelen met de muis of een vinger
    function fracAt(e) { var r = bar.getBoundingClientRect(); return B.clamp(((e.clientX != null ? e.clientX : 0) - r.left) / r.width, 0, 1); }
    bar.addEventListener('pointerdown', function (e) {
      if (isLive() || !engine || !engine.duration()) return;
      e.preventDefault();
      bar.classList.add('drag');
      try { bar.setPointerCapture(e.pointerId); } catch (x) { /* stil */ }
      seeking = fracAt(e) * engine.duration(); updateTime(); showControls();
    });
    bar.addEventListener('pointermove', function (e) {
      if (isLive() || !engine || !engine.duration()) return;
      var f = fracAt(e);
      hoverT.textContent = B.fmtDur(f * engine.duration());
      hoverT.style.left = (f * 100) + '%';
      if (seeking != null) { seeking = f * engine.duration(); updateTime(); }
    });
    function endDrag() {
      if (seeking == null) return;
      bar.classList.remove('drag');
      engine.seek(seeking); seeking = null;
      if (extCues) renderExtSub();
      updateTime(); showControls();
    }
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', function () { seeking = null; bar.classList.remove('drag'); });

    // MARK: afspelen

    function start(resumeAt) {
      var gen = ++startGen;
      failPos = 0;
      limited = false; audioChosen = false; autoSubsDone = false; subsStartedAt = Date.now(); clearTimeout(subsRetry); subsRetry = null;
      errorBox.style.display = 'none'; tapPlay.style.display = 'none';
      spinner.style.display = 'flex';
      nextShown = false; nextDismissed = false; nextCard.style.display = 'none';
      clearInterval(countdownTimer);
      subtitle.textContent = '';
      marker = item.type === 'episode' && item.seriesID && isrc() ? D.introMarker(isrc().id, item.seriesID) : null;
      renderInfo();
      showControls();
      clearExtSubs();
      scrobbled = false; stopSent = false; traktMarked = false;
      streamStart().then(function (ok) { if (ok === false && gen === startGen) limited = true; }, B.noop);
      // limiet van de IPTV-provider (alleen Xtream) alvast ophalen; blokkeert niets
      B.providers.providerLimit.prime(isrc());
      if (B.xs) B.xs.notePlayed(item, ctx);
      var resolve = isCatchup() ? (item.streamURL ? Promise.resolve(item.streamURL) : Lib.catchupURL(item.channel, item.program).then(function (u) { item.streamURL = u; return u; }))
        : (B.media.webStream(isrc(), item) ? Promise.resolve(B.media.webStream(isrc(), item)) : Lib.resolveURL(item, isLive()));
      resolve.then(function (url) {
        if (closed || gen !== startGen || limited) return;
        if (!url) throw new Error('no_url');
        return openURL(url, resumeAt, gen);
      }).catch(function (e) { if (gen === startGen) fail(e); });
      if (isLive() && item.channel && isrc()) {
        D.pushRecentChannel(isrc().id, item.channel.id);
        B.store.set('lastChannel.' + String(profile.id).toLowerCase(), { sourceId: isrc().id, channelId: item.channel.id });
      }
    }
    function openURL(url, resumeAt, gen) {
      // build 102: nieuwe stream (volgende aflevering, zappen, opnieuw) tijdens het casten via castVideo: eerst lokaal
      // starten; is de tv daarna nog verbonden, dan gaat de nieuwe stream meteen weer naar de tv (castResume)
      if (cast.el === castVideo) { cast.keep = cast.mode === 'swap'; leaveCast(); }
      setCastURL(null);
      if (engine) engine.stop();
      var events = {
        buffering: function (b) { if (engine === my) spinner.style.display = b ? 'flex' : 'none'; },
        ended: function () { if (engine === my) onEnded(); },
        error: function (e) { if (engine === my) fail(e); },
        state: function () { if (engine === my) { drawPlay(); if (!engine.playing) showControls(); } },
        tracks: function () { if (engine !== my) return; if (!audioChosen) applyTrackPrefs(); if (subsStartedAt && Date.now() - subsStartedAt > 1500) autoSubtitles(); },
        needsTap: function () { if (engine === my) { spinner.style.display = 'none'; tapPlay.style.display = ''; showControls(); } }
      };
      engine = new Engine(events, video);
      var my = engine;
      return vodHls(url).then(function (cands) {
        if (closed || engine !== my) return Promise.reject(new Error('stopped'));
        return my.open(url, { live: isLive(), start: resumeAt || 0, forceTry: forceTry, hls: cands, onReady: function () { if (engine === my) applyTrackPrefs(); } });
      }).then(function () {
        if (closed || limited || engine !== my || (gen != null && gen !== startGen)) { if (engine === my && (closed || limited)) my.stop(); return; }
        attempts = 0;
        spinner.style.display = 'none';
        prepareCast();
        renderInfo();
        showControls();
        castResume();
        setTimeout(function () {
          if (closed || engine !== my) return;
          if (!audioChosen) applyTrackPrefs();
          if (!scrobbled) { scrobbled = true; scrobble('start'); }
          autoSubtitles();
        }, 1500);
        setTimeout(function () { if (!closed && engine === my && !audioChosen) applyTrackPrefs(); }, 5000);
        if (!isLive()) setTimeout(function () { if (!closed && engine === my) mediaHint(my); }, 6000);
      }, function (e) {
        // build 97: een afgebroken (gestopte of vervangen) poging is geen fout voor de gebruiker
        if (closed || engine !== my || (e && e.message === 'stopped')) return;
        throw e;
      });
    }

    /**
     * HLS-varianten van deze film/aflevering (build 83): alleen Xtream-adressen (/movie/ of /series/), en niet als de
     * server zegt dat hij geen m3u8 levert (allowed_output_formats). De serverinfo wacht hooguit 4 s.
     */
    function vodHls(url) {
      if (isLive() || isCatchup() || !B.providers.vodHlsCandidates(url).length) return Promise.resolve(null);
      var src = isrc();
      var info = src && src.kind === 'Xtream Codes' && B.normalizedServer(src.serverURL) && String(url).indexOf(B.normalizedServer(src.serverURL)) === 0
        ? new B.providers.Xtream(src, D.secret(src, 'password')).serverInfo() : Promise.resolve(null);
      var capped = Promise.race([info, new Promise(function (r) { setTimeout(function () { r(null); }, 4000); })]);
      return capped.then(function (inf) {
        if (inf) B.log('server: uitvoer ' + (inf.formats || []).join(',') + ', verbindingen ' + inf.activeConnections + '/' + inf.maxConnections);
        return B.providers.vodHlsCandidates(url, inf);
      }, function () { return B.providers.vodHlsCandidates(url, null); });
    }

    /**
     * Beeld zonder geluid of geluid zonder beeld (MKV/MP4 met AC3/DTS-audio of HEVC-video in een browser die dat niet
     * kent): de browser speelt dan stil verder; een korte melding zegt waarom.
     */
    function mediaHint(my) {
      var v = video;
      if (!my.playing || v.currentTime < 2) return;
      var noPicture = v.videoWidth === 0 && (typeof v.webkitVideoDecodedByteCount !== 'number' || v.webkitVideoDecodedByteCount === 0);
      var noSound = (typeof v.webkitAudioDecodedByteCount === 'number' && v.webkitAudioDecodedByteCount === 0 && v.webkitVideoDecodedByteCount > 0) ||
        v.mozHasAudio === false;
      if (noPicture) U.toast(L('No picture? The video in this file (often HEVC/H.265) can’t be played by your browser. Watch in the Bingr app.'), 7000);
      else if (noSound) U.toast(L('No sound? The audio in this file (often AC3 or DTS) can’t be played by your browser. Watch in the Bingr app.'), 7000);
    }

    // MARK: casten (build 102)

    /*
     * build 102: AirPlay en Chromecast zonder Google's Cast-SDK of andere scripts van derden (privacy): de W3C Remote
     * Playback API (video.remote: watchAvailability/prompt/connect/disconnect; Safari = AirPlay, Chrome/Edge =
     * Chromecast), met Safari's oude webkitShowPlaybackTargetPicker + webkitcurrentplaybacktargetiswireless als terugval.
     * Een tv speelt alleen een gewone URL (src=), geen MSE (hls.js/mpegts.js). Daarom staat de directe URL van de
     * huidige stream steeds klaar op een tweede, onzichtbare <video> (castVideo, preload none: geen verbinding met de
     * server zolang er niet gecast wordt). prompt() moet synchroon in de klik, en Chrome kent de beschikbaarheid per bron
     * en wisselt een bron async: prompt() vlak na src= op de MSE-<video> zou op de oude bron weigeren. Bij 'connect' gaat
     * hls.js/mpegts.js weg en speelt castVideo op de tv (bediening, voortgang en Trakt lopen via engine = castVideo);
     * bij 'disconnect' lokaal verder vanaf de positie van de tv. Annuleren verandert niets (lokaal speelde gewoon door).
     * Speelt de speler al een gewone URL (Safari's eigen HLS, MP4), dan cast hij zelf ('self'), zonder wissel.
     * URL voor de tv: https zoals hij is; http (of iets dat al via de proxy liep) via de GET-vorm van de proxy (https,
     * CORS * voor de ontvanger, token 6 uur). MPEG-TS live: liever de HLS-variant (Xtream …/id.m3u8).
     * Grenzen: geen DRM (komt bij IPTV niet voor). MPEG-TS zonder HLS-variant speelt de standaard-ontvanger van
     * Chromecast niet betrouwbaar: een fout of geen beeld binnen 30 s → melding "Casten is niet mogelijk" en lokaal
     * verder. De API geeft geen apparaatnaam, dus "je tv".
     */
    function hasRemote(el) { return !!(el && el.remote && typeof el.remote.prompt === 'function'); }
    var castSupported = hasRemote(localVideo) || typeof localVideo.webkitShowPlaybackTargetPicker === 'function';
    // mode: null | 'connecting' | 'self' (speler cast zelf) | 'swap' (castVideo cast, lokaal gestopt)
    var cast = { avail: {}, url: null, src: null, orig: null, mode: null, el: null, pos: 0, ok: false, keep: false, watchdog: null, ids: [] };

    function watchCast(el, key) {
      try { el.disableRemotePlayback = false; } catch (e) { /* stil */ }
      if (hasRemote(el)) {
        var r = el.remote;
        r.addEventListener('connecting', function () { onRemote(el, 'connecting'); });
        r.addEventListener('connect', function () { onRemote(el, 'connect'); });
        r.addEventListener('disconnect', function () { onRemote(el, 'disconnect'); });
        if (typeof r.watchAvailability !== 'function') { cast.avail[key] = true; return; }
        var p;
        try { p = r.watchAvailability(function (a) { cast.avail[key] = !!a; drawCast(); }); } catch (e) { p = Promise.reject(e); }
        p.then(function (id) { cast.ids.push({ r: r, id: id }); }, function (e) {
          B.log('casten: watchAvailability', e && e.name);
          // Chrome op Android e.d. kan niet doorlopend zoeken; prompt() werkt dan wel: knop tonen
          if (e && e.name === 'NotSupportedError') { cast.avail[key] = true; drawCast(); }
        });
        return;
      }
      el.addEventListener('webkitplaybacktargetavailabilitychanged', function (ev) { cast.avail[key] = ev.availability === 'available'; drawCast(); });
      el.addEventListener('webkitcurrentplaybacktargetiswireless', function () { onRemote(el, el.webkitCurrentPlaybackTargetIsWireless ? 'connect' : 'disconnect'); });
    }
    if (castSupported) { watchCast(localVideo, 'main'); watchCast(castVideo, 'cast'); }

    /** Speelt de eigen <video> een gewone URL (geen MSE)? Dan kan hij zelf casten. */
    function mainPlain() {
      var e = engine;
      if (!e || !e.started || e.v !== localVideo || e.hls || e.ts) return false;
      var s = localVideo.currentSrc || localVideo.getAttribute('src') || '';
      return !!s && !/^(blob|data|mediasource):/i.test(s);
    }
    /** Welke URL kan de tv zelf ophalen? {url (zonder proxy), how, proxy} of null. */
    function castSource(e) {
      var st = e && e.lastStep;
      if (!st) return null;
      var raw = String(st.orig || st.url || ''), how = st.how;
      if (!/^https?:/i.test(raw)) return null;
      if (how === 'mpegts') {
        // liever HLS: de standaard-ontvanger van Chromecast speelt los MPEG-TS niet betrouwbaar (en via de proxy loopt
        // een doorlopende .ts tegen de tijdslimiet aan). Niet als HLS hier al mislukte.
        var hlsFailed = (e.trace || []).some(function (r) { return /^hls/.test(r.how) && !r.ok; });
        var alt = null;
        if (/\/(live|timeshift)\//i.test(raw) && /\.ts$/i.test(raw.split('?')[0])) alt = raw.replace(/\.ts(\?|$)/i, '.m3u8$1');
        else if (!isLive()) { var c = B.providers.vodHlsCandidates(raw); if (c.length) alt = c[0].url; }
        if (alt && !hlsFailed) { raw = alt; how = 'hls'; }
      }
      // Chromecast haalt HLS met MSE op (CORS nodig): servers zonder CORS ook via de proxy; AirPlay heeft dat niet nodig
      var proxy = !!st.orig || B.mustProxy(raw) || (!isSafariEngine() && how === 'hls' && B.needsProxy(raw));
      return { url: raw, how: how, proxy: proxy };
    }
    /** Na elke start: de URL voor de tv klaarzetten op castVideo (zo kan prompt() meteen in de klik). */
    function prepareCast() {
      if (!castSupported || !engine || !engine.started || engine.v !== localVideo) return;
      var src = cast.src = castSource(engine), my = engine;
      cast.orig = engine.url;
      // speelt de speler al een gewone URL, dan cast hij zelf: castVideo leeg (geen tweede castbaar element)
      if (!src || mainPlain()) { setCastURL(null); return; }
      if (!src.proxy) { setCastURL(src.url); return; }
      setCastURL(B.proxyGetURL(src.url));
      B.ensureProxyToken().then(function () { if (!closed && engine === my && cast.src === src) setCastURL(B.proxyGetURL(src.url)); }, B.noop);
    }
    function setCastURL(u) {
      cast.url = u || null;
      if (cast.el !== castVideo) { // castVideo verbindt of cast: niet wisselen
        if (!u) { if (castVideo.hasAttribute('src')) { castVideo.removeAttribute('src'); try { castVideo.load(); } catch (e) { /* stil */ } } }
        else if (castVideo.getAttribute('src') !== u) castVideo.src = u;
      }
      drawCast();
    }
    function drawCast() {
      if (!castSupported) return;
      var on = cast.mode === 'self' || cast.mode === 'swap';
      var ready = !!engine && engine.started && engine.v === localVideo && (mainPlain() || !!cast.url);
      castBtn.style.display = cast.mode || ((cast.avail.main || cast.avail.cast) && ready) ? '' : 'none';
      castBtn.classList.toggle('on', on);
      castBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      root.classList.toggle('casting', !!cast.mode);
      castUI.style.display = cast.mode ? 'flex' : 'none';
      castText.textContent = cast.mode === 'connecting' ? L('Connecting to your TV…') : L('Playing on your TV');
      castHint.textContent = on ? L('Use the controls here to pause, seek or change the volume.') : '';
    }
    /** Klik op de castknop: alles synchroon, zodat prompt() binnen de klik valt. */
    function castClick() {
      showControls();
      // al verbonden of bezig: de keuzelijst van de browser opnieuw (daar stopt de gebruiker het casten)
      if (cast.el) { promptOn(cast.el, true); return; }
      if (!engine || !engine.started || engine.v !== localVideo) return;
      var el = mainPlain() ? localVideo : (cast.url ? castVideo : null);
      if (!el) { U.toast(L('Casting isn’t possible for this stream.')); return; }
      cast.pos = isLive() ? 0 : engine.time();
      if (el === castVideo) {
        if (castVideo.getAttribute('src') !== cast.url) castVideo.src = cast.url;
        if (!isLive()) { try { castVideo.currentTime = cast.pos; } catch (e) { /* stil */ } }
      }
      promptOn(el, false);
    }
    function promptOn(el, again) {
      if (hasRemote(el)) {
        var p;
        try { el.disableRemotePlayback = false; p = el.remote.prompt(); } catch (e) { p = Promise.reject(e); }
        Promise.resolve(p).then(B.noop, function (e) {
          var n = e && e.name;
          B.log('casten: prompt', n, e && e.message);
          if (again || n === 'NotAllowedError' || n === 'AbortError') return; // zelf gesloten: lokaal speelt gewoon door
          U.toast(n === 'NotFoundError' ? L('No TV found. Make sure your TV and this device are on the same network.') : L('Casting isn’t possible for this stream.'), 5000);
        });
        return;
      }
      if (typeof el.webkitShowPlaybackTargetPicker === 'function') { try { el.webkitShowPlaybackTargetPicker(); } catch (e) { /* stil */ } }
    }
    function onRemote(el, kind) {
      if (closed) return;
      B.log('casten: ' + kind + (el === castVideo ? ' (stream)' : ' (speler)'));
      if (kind === 'connecting') {
        if (!cast.mode) { cast.el = el; cast.mode = 'connecting'; drawCast(); }
        return;
      }
      if (kind === 'connect') { castConnected(el); return; }
      if (el !== cast.el) return;
      if (cast.mode === 'swap') { resumeLocal(); return; }
      cast.mode = null; cast.el = null; drawCast(); // 'self': de browser speelt zelf lokaal verder
    }
    function castConnected(el) {
      if ((cast.mode === 'self' || cast.mode === 'swap') && cast.el === el) return;
      clearTimeout(cast.watchdog);
      cast.el = el;
      if (el === localVideo) { cast.mode = 'self'; drawCast(); return; }
      var old = engine;
      if (!castVideo.getAttribute('src') || !cast.orig) {
        cast.mode = null; cast.el = null; drawCast();
        U.toast(L('Casting isn’t possible for this stream.'));
        return;
      }
      var pos = !isLive() && old && old.started && old.v === localVideo ? old.time() : cast.pos;
      // van MSE naar de gewone URL: hls.js/mpegts.js netjes weg, castVideo speelt op de tv
      if (old && old.v === localVideo) { saveProgress(true); old.stop(); }
      cast.mode = 'swap'; cast.pos = pos; cast.ok = false;
      video = castVideo;
      var my = engine = new Engine({
        buffering: function (b) { if (engine === my) spinner.style.display = b ? 'flex' : 'none'; },
        ended: function () { if (engine === my) onEnded(); },
        error: function (e) { if (engine === my) castFailed(e); },
        state: function () { if (engine !== my) return; if (my.playing) { cast.ok = true; clearTimeout(cast.watchdog); } drawPlay(); showControls(); },
        tracks: B.noop,
        needsTap: function () { if (engine === my) { spinner.style.display = 'none'; tapPlay.style.display = ''; showControls(); } }
      }, castVideo);
      my.url = cast.orig; my.started = true; my.stopped = false;
      my.lastStep = { how: cast.src ? cast.src.how : 'direct', url: castVideo.getAttribute('src'), cast: true };
      my.trace = old && old.trace ? old.trace : [];
      castVideo.volume = localVideo.volume; castVideo.muted = localVideo.muted;
      if (pos > 1 && !isLive()) {
        try { castVideo.currentTime = pos; } catch (e) { /* stil */ }
        var once = function () { castVideo.removeEventListener('loadedmetadata', once); if (engine === my && Math.abs(castVideo.currentTime - pos) > 3) my.seek(pos); };
        castVideo.addEventListener('loadedmetadata', once);
      }
      // geen beeld op de tv binnen 30 s (bv. los MPEG-TS op Chromecast): lokaal verder
      cast.watchdog = setTimeout(function () { if (engine === my && !cast.ok && tapPlay.style.display === 'none') castFailed(new Error('cast_timeout')); }, 30000);
      spinner.style.display = 'flex';
      var p = castVideo.play();
      if (p && p.then) p.then(null, function (e) { if (e && e.name === 'NotAllowedError') my.ev.needsTap(); });
      drawCast(); drawPlay(); showControls();
    }
    /** Weg uit het casten via castVideo (zonder lokaal opnieuw te starten). */
    function leaveCast() {
      clearTimeout(cast.watchdog);
      if (engine && engine.v === castVideo) {
        localVideo.volume = castVideo.volume; localVideo.muted = castVideo.muted;
        engine.stop();
      }
      video = localVideo;
      tapPlay.style.display = 'none';
      cast.mode = null; cast.el = null; cast.ok = false;
      drawCast();
    }
    /** Tv losgekoppeld of mislukt: lokaal verder vanaf de positie van de tv. */
    function resumeLocal() {
      var ce = engine, pos = cast.pos;
      if (ce && ce.v === castVideo) { if (!isLive()) pos = ce.time() || pos; saveProgress(true); }
      cast.keep = false;
      leaveCast();
      if (closed || !cast.orig) return;
      spinner.style.display = 'flex';
      var g = startGen;
      openURL(cast.orig, pos, g).catch(function (e) { if (!closed && g === startGen) fail(e); });
    }
    function castFailed(e) {
      if (closed || cast.mode !== 'swap') return;
      B.log('casten mislukt', e && e.message);
      U.toast(L('Casting isn’t possible for this stream.'), 6000);
      resumeLocal();
    }
    /** Nieuwe stream tijdens het casten (volgende aflevering, zappen): is de tv nog verbonden, dan meteen weer daarheen. */
    function castResume() {
      if (!cast.keep) return;
      cast.keep = false;
      var connected = hasRemote(castVideo) ? castVideo.remote.state === 'connected' : !!castVideo.webkitCurrentPlaybackTargetIsWireless;
      if (connected && cast.url && !cast.mode) castConnected(castVideo);
    }

    // MARK: taal

    function contentLang() {
      if (item.type === 'movie') { var hit = Lib.lib && Lib.lib.byId ? Lib.lib.byId[item.id] : null; return B.clang.forItem(hit ? hit.item : item, false); }
      if (item.type === 'episode' && ctx.series) return B.clang.forItem(ctx.series, true);
      return null;
    }
    function applyTrackPrefs() {
      if (!engine || audioChosen) return;
      var pref = B.clang.preferredAudio();
      if (!pref) return;
      var tr = engine.tracks();
      if (tr.audio.length < 2) return;
      for (var i = 0; i < tr.audio.length; i++) {
        if (B.clang.norm(tr.audio[i].lang) === pref) {
          if (tr.audio[i].index !== tr.currentAudio) { engine.selectAudio(tr.audio[i].index); B.log('audio → ' + pref); }
          audioChosen = true;
          return;
        }
      }
    }
    function currentAudioLang() {
      var tr = engine ? engine.tracks() : { audio: [] };
      var cur = null;
      tr.audio.forEach(function (t) { if (t.index === tr.currentAudio) cur = t; });
      if (!cur && tr.audio.length === 1) cur = tr.audio[0];
      var lg = cur ? B.clang.norm(cur.lang) : '';
      if (lg) return lg;
      var cl = contentLang();
      return cl && !cl.m ? (cl.a || '') : '';
    }
    /** Automatische ondertitels (off | whenNeeded | always): eerst een spoor in de stream, anders OpenSubtitles. */
    function autoSubtitles() {
      if (autoSubsDone || !engine || isLive() || isCatchup() || extCues) return;
      var tr0 = engine.tracks();
      // build 91: ondertitelsporen komen bij HLS en Safari soms later binnen: tot 8 s na de start opnieuw proberen
      // (via het tracks-event en de controle na 5 s) voordat OpenSubtitles aan de beurt is
      if (!tr0.text.length && Date.now() - subsStartedAt < 8000) {
        if (!subsRetry) { var g = startGen; subsRetry = setTimeout(function () { subsRetry = null; if (g === startGen) autoSubtitles(); }, 3000); }
        return;
      }
      autoSubsDone = true;
      var mode = B.clang.autoSubtitles();
      var want = B.clang.preferredSubtitle();
      // build 91: een zelf gekozen ondertiteltaal (niet "zoals de app") zet altijd een spoor in die taal uit de stream
      // aan als dat er is, ook als automatische ondertitels uit staan; het oude "off" zet ondertitels uit (zoals Android)
      var rawSub = B.clang.streamSubtitleSetting ? B.clang.streamSubtitleSetting() : '';
      if (rawSub === 'off') { try { engine.selectText(null); } catch (e) { /* stil */ } }
      else if (rawSub) {
        var pick = tr0.text.filter(function (t) { return B.clang.norm(t.lang) === want; })[0];
        if (pick) { if (tr0.currentText !== pick.index) engine.selectText(pick.index); return; }
      }
      if (mode === 'off') return;
      var audio = currentAudioLang();
      var cl = contentLang();
      if (mode === 'whenNeeded' && (!audio || audio === want)) return;
      if (cl && cl.s === want) return;
      var tr = engine.tracks();
      if (tr.currentText != null) { var on = null; tr.text.forEach(function (t) { if (t.index === tr.currentText) on = t; }); if (on && B.clang.norm(on.lang) === want) return; }
      for (var i = 0; i < tr.text.length; i++) {
        if (B.clang.norm(tr.text[i].lang) === want) {
          engine.selectText(tr.text[i].index);
          U.toast(L('Subtitles turned on automatically: %@', B.clang.name(want)), 4000);
          return;
        }
      }
      var OS = B.opensubtitles;
      if (!OS.ready() || !OS.isLoggedIn()) return;
      var my = engine, id = item.id;
      var series = ctx.series || null;
      var imdb = item.imdbID || (item.type === 'episode' ? B.trakt.imdbFor(series || { title: item.title }, true) : B.trakt.imdbFor({ title: item.title, year: B.int(item.subtitle) }, false));
      tmdbFor().then(function (tmdb) {
        if (closed || engine !== my || item.id !== id || extCues) return [];
        return OS.search({ imdb: imdb, title: item.title, year: item.type === 'movie' ? B.int(item.subtitle) : null,
          season: item.type === 'episode' ? item.season : null, episode: item.type === 'episode' ? item.episode : null, tmdb: tmdb }, [want]);
      }).then(function (list) {
        list = list.filter(function (x) { return B.clang.norm(x.language) === want; });
        if (!list.length || closed || engine !== my || item.id !== id || extCues) return null;
        return OS.download(list[0]).then(function (cues) {
          if (!cues.length || closed || engine !== my || item.id !== id || extCues) return;
          showExtCues(cues);
          U.toast(L('Subtitles turned on automatically: %@', B.clang.name(want)), 4000);
        });
      }).catch(function (e) { B.log('auto-ondertitels', e && e.message); });
    }
    /**
     * TMDB-id van de film of serie voor OpenSubtitles (build 91): uit de cache van leeftijden/trailers; build 97:
     * anders het TMDB-id dat de Xtream-server meegeeft (get_vod_info tmdb_id / get_series_info tmdb), hooguit 4 s.
     * Geeft altijd een Promise (id of null).
     */
    function tmdbFor() {
      var isShow = item.type === 'episode';
      var x = isShow ? ctx.series : (Lib.lib && Lib.lib.byId && Lib.lib.byId[item.id] ? Lib.lib.byId[item.id].item : null);
      if (!x) return Promise.resolve(null);
      var r = B.ageRatings.cached(x.rawTitle || x.title, x.year, isShow);
      if (r && r.found !== false && r.id != null) return Promise.resolve(r.id);
      var pick = function (info) { var v = info && B.int(isShow ? (info.tmdb || info.tmdb_id) : (info.tmdb_id || info.tmdb)); return v > 0 ? v : null; };
      var ask = isShow ? (x.id != null ? Lib.episodes(x).then(function (res) { return res && res.info; }) : Promise.resolve(null)) : Lib.movieInfo(x);
      var cap = new Promise(function (res) { setTimeout(function () { res(null); }, 4000); });
      return Promise.race([ask, cap]).then(pick, function () { return null; });
    }
    function showExtCues(cues) {
      try { engine.selectText(null); } catch (e) { /* stil */ }
      extCues = cues; extOffset = 0;
      buildExtTrack();
      clearInterval(extTimer);
      extTimer = setInterval(renderExtSub, 250);
      renderExtSub();
    }
    function renderExtSub() {
      if (!extCues || !engine) return;
      var t = B.subs.at(extCues, engine.time() - extOffset);
      var html = B.esc(t).replace(/\n/g, '<br>');
      if (subtitle._last !== html) { subtitle._last = html; subtitle.innerHTML = html ? '<span>' + html + '</span>' : ''; }
    }
    /**
     * Build 91: ook als echt tekstspoor, voor het volledige scherm van Safari op de iPhone (webkitEnterFullscreen
     * verbergt de eigen weergave). Normaal "hidden"; "showing" alleen in dat volledige scherm.
     */
    function buildExtTrack() {
      if (!video.addTextTrack || !window.VTTCue) return;
      try {
        if (!extTrack) {
          extTrack = video.addTextTrack('subtitles', 'OpenSubtitles', '');
          video.addEventListener('webkitbeginfullscreen', function () { if (extTrack && extCues) extTrack.mode = 'showing'; });
          video.addEventListener('webkitendfullscreen', function () { if (extTrack) extTrack.mode = 'hidden'; });
        }
        var old = extTrack.cues ? Array.prototype.slice.call(extTrack.cues) : [];
        old.forEach(function (c) { try { extTrack.removeCue(c); } catch (e) { /* stil */ } });
        (extCues || []).forEach(function (c) {
          var s = c.start + extOffset, e = c.end + extOffset;
          if (e > 0) extTrack.addCue(new VTTCue(Math.max(0, s), e, c.text));
        });
        extTrack.mode = video.webkitDisplayingFullscreen && extCues ? 'showing' : 'hidden';
      } catch (e) { /* stil */ }
    }
    function clearExtSubs() {
      clearInterval(extTimer); extTimer = null;
      if (extTrack) { try { extTrack.mode = 'disabled'; } catch (e) { /* stil */ } var t = extTrack; Array.prototype.slice.call(t.cues || []).forEach(function (c) { try { t.removeCue(c); } catch (e) { /* stil */ } }); }
      if (extCues) { extCues = null; subtitle.innerHTML = ''; subtitle._last = ''; }
    }

    // MARK: fouten

    function fail(e) {
      if (closed || limited) return;
      // bewust gestopt (sluiten, zappen, foutscherm): geen fout
      if (e && e.message === 'stopped') return;
      B.log('player error', e && e.message);
      spinner.style.display = 'none';
      if (e && e.insecure) { showError(e); return; }
      if (attempts < 1 && engine && engine.started) {
        attempts++;
        var at = engine && !isLive() ? engine.time() : 0;
        var g = startGen;
        setTimeout(function () {
          if (closed || g !== startGen) return;
          var again = isCatchup() && item.streamURL ? Promise.resolve(item.streamURL) : (B.media.webStream(isrc(), item) ? Promise.resolve(B.media.webStream(isrc(), item)) : Lib.resolveURL(item, isLive()));
          again.then(function (u) { if (!closed && g === startGen) return openURL(u, at, g); }).catch(function (e2) { showError(e2); });
        }, 1500);
        return;
      }
      if (isLive() && item.channel && !triedBackup) {
        triedBackup = true;
        Lib.backupChannels(item.channel).then(function (hits) {
          if (!hits.length || closed) { showError(e); return; }
          U.toast(L('Trying another source…'));
          Lib.resolveBackup(hits[0]).then(function (u) { attempts = 1; return openURL(u, 0, startGen); }).catch(function (e3) { showError(e3); });
        });
        return;
      }
      // uitzoeken waarom (build 83): eerste bytes van het bestand via de proxy, formaat, codecs, wat de browser kent
      var PD = B.playdiag, g2 = startGen;
      var rep = { browser: PD.browser(), attempts: engine ? engine.trace.slice() : [], lastError: e, hlsTried: !!(engine && engine.hlsTried), hlsFound: !!(engine && engine.hlsFound),
        url: engine ? engine.url : null, title: item.title + (item.subtitle ? ' · ' + item.subtitle : '') };
      // de mislukte stream meteen echt stoppen (hls.js/mpegts weg, verbinding met de provider dicht), niet pas na de
      // diagnose; de plek eerst onthouden voor "Opnieuw"
      if (engine && !isLive() && engine.time() > 0) failPos = engine.time();
      if (engine) engine.stop();
      // limiet van de IPTV-provider expliciet controleren (Xtream: max_connections / active_cons); los van Bingr
      var provider = B.providers.providerLimit.failureMessage(isrc());
      spinner.style.display = 'flex';
      if (!isLive() && !isCatchup() && rep.url && !/^(stopped)$/.test(String(e && e.message))) {
        Promise.all([PD.inspect(rep.url), provider]).then(function (res) {
          if (closed || g2 !== startGen) return;
          spinner.style.display = 'none';
          rep.probe = res[0];
          rep.connHint = !!res[1];
          var d = PD.explain(rep);
          B.log('diagnose', PD.text(rep));
          // provider vol en de server weigert (401/403/458/509/429) of de stream start niet: melding van de provider
          if (res[1] && (!d || d.conn || d.server === 401 || d.server === 403)) { showError(providerError(res[1]), rep); return; }
          showError(d || e, rep);
        });
        return;
      }
      provider.then(function (m) {
        if (closed || g2 !== startGen) return;
        showError(m ? providerError(m) : e, rep);
      });
    }
    /** Fout "limiet van je IPTV-provider bereikt" (specifiek: geen algemene tekst eronder). */
    function providerError(m) { var pe = new Error(m); pe.specific = true; pe.conn = true; pe.tip = B.providers.providerLimit.tip(); return pe; }
    function showError(e, rep) {
      if (closed) return;
      // plek onthouden vóór het stoppen (daarna staat de video op 0), zodat "Opnieuw" daar verder gaat
      if (engine && !isLive() && engine.time() > 0) failPos = engine.time();
      if (engine) engine.stop();
      spinner.style.display = 'none';
      U.clear(errorBox);
      var insecure = e && e.insecure, unsup = e && e.unsupported, server = e && (e.server || e.specific);
      errorBox.appendChild(U.icon(insecure ? 'lock' : 'warn', 'pl-err-ic'));
      errorBox.appendChild(h('h2', insecure ? L('Not available in the browser') : unsup ? L('Not available in the browser') : L("Can't play this")));
      var msg = insecure || unsup || server ? e.message : (isLive() ? L('This channel is not available right now.') : L('This title could not be loaded.'));
      errorBox.appendChild(h('p', msg));
      // providerlimiet: tip eronder (andere apparaat stoppen, of even wachten tot de provider de verbinding vrijgeeft)
      if (e && e.conn && e.tip) errorBox.appendChild(h('p.muted.small', e.tip));
      if (!insecure && !unsup && !server) errorBox.appendChild(h('p.muted.small', L('Some servers block playback in the browser. If it works in the app, watch it there.')));
      var row = h('div.dlg-buttons');
      // "Toch proberen" alleen als er nog niets geprobeerd is (formaat vooraf afgewezen), niet na een codecfout
      if (unsup && !e.codec) row.appendChild(U.button(L('Try anyway'), function () { forceTry = true; attempts = 0; start(ctx.resume || 0); }, { primary: true }));
      else if (unsup) row.appendChild(U.button(L('Try again'), function () { attempts = 0; start(ctx.resume || 0); }));
      else if (!insecure) row.appendChild(U.button(L('Try again'), function () { attempts = 0; triedBackup = false; start(!isLive() ? (failPos || ctx.resume || 0) : 0); }, { primary: true }));
      if (isLive() && item.channel && !insecure) row.appendChild(U.button(L('Other source'), chooseBackup, { icon: 'layers' }));
      row.appendChild(U.button(L('Close'), function () { close(); }));
      errorBox.appendChild(row);
      // build 83: wat er geprobeerd is en wat de server stuurde (zonder inloggegevens); ?debug=1 = meteen open
      if (!rep && engine) rep = { browser: B.playdiag.browser(), attempts: engine.trace.slice(), url: engine.url, lastError: e };
      if (rep) {
        var dp = B.playdiag.panel(rep);
        row.appendChild(dp.button);
        errorBox.appendChild(dp.box);
      }
      errorBox.style.display = 'flex';
      root.classList.add('ui');
      var f = row.querySelector('.btn'); if (f) f.focus();
    }
    function chooseBackup() {
      if (!item.channel) return;
      Lib.backupChannels(item.channel).then(function (hits) {
        if (!hits.length) { U.toast(L('No other source found for this channel.')); return; }
        U.choose(L('Other source'), hits.map(function (x, i) { return { value: i, label: x.source.name + ' · ' + x.name, sub: null }; }), null, function (i) {
          spinner.style.display = 'flex';
          errorBox.style.display = 'none';
          Lib.resolveBackup(hits[i]).then(function (u) { attempts = 1; return openURL(u, 0, startGen); }).catch(function (e) { showError(e); });
        });
      });
    }

    function togglePlay() {
      if (!engine) return;
      tapPlay.style.display = 'none';
      if (engine.playing) { engine.pause(); scrobble('pause'); } else { engine.play(); scrobble('start'); }
      showControls();
    }
    function jump(s) {
      if (!engine || isLive()) return;
      var d = engine.duration();
      var t = B.clamp(engine.time() + s, 0, d > 0 ? d - 2 : engine.time() + s);
      engine.seek(t);
      if (extCues) renderExtSub();
      updateTime();
      showControls();
      flash(s > 0 ? '+' + s + ' s' : s + ' s');
    }
    var flashEl = h('div.pl-flash');
    root.appendChild(flashEl);
    var flashT = null;
    function flash(t) { flashEl.textContent = t; flashEl.classList.add('show'); clearTimeout(flashT); flashT = setTimeout(function () { flashEl.classList.remove('show'); }, 700); }

    // MARK: sporen

    function versions() {
      if (item.type === 'movie') { var hit = Lib.lib && Lib.lib.byId ? Lib.lib.byId[item.id] : null; return hit ? B.clang.versions(hit.item, 'movie') : []; }
      if (item.type === 'episode' && ctx.series) return B.clang.versions(ctx.series, 'series');
      return [];
    }
    function chooseAudio() {
      if (!engine) return;
      var tr = engine.tracks();
      var vs = versions();
      if (tr.audio.length > 1) {
        var opts = tr.audio.map(function (t) { return { value: t.index, label: t.label }; });
        vs.slice(0, 6).forEach(function (v, i) { opts.push({ value: 'v' + i, label: L('Other language') + ': ' + v.label }); });
        U.choose(L('Audio'), opts, tr.currentAudio, function (v) {
          if (typeof v === 'string') { switchVersion(vs[B.int(v.slice(1))]); return; }
          audioChosen = true;
          engine.selectAudio(v);
        });
        return;
      }
      var lg = currentAudioLang();
      var name = lg ? B.clang.name(lg) : (tr.audio[0] ? tr.audio[0].label : L('Audio'));
      var buttons = vs.slice(0, 4).map(function (v) { return { label: v.label, icon: 'globe', fn: function () { switchVersion(v); }, primary: false }; });
      buttons.push({ label: L('Close'), primary: false });
      U.modal({ title: L('Audio') + ': ' + name, text: L('This stream has one audio language') + (vs.length ? '. ' + L('Watch another language version from the same moment:') : '.'), buttons: buttons });
    }
    function switchVersion(v) {
      if (!v || !engine) return;
      var pos = isLive() ? 0 : engine.time();
      var target = v.item;
      U.toast(L('Switching to %@…', v.label));
      if (item.type === 'movie') {
        saveProgress(true); if (scrobbled) scrobble('stop'); stopEngine(false);
        item = B.player.movieItem(target);
        watchedSeconds = 0; recorded = false; attempts = 0;
        start(pos);
        return;
      }
      var season = item.season, epn = item.episode;
      Lib.episodes(target).then(function (r) {
        var eps = (r && r.episodes) || [];
        var hit = null;
        eps.forEach(function (e) { if (e.season === season && e.number === epn) hit = e; });
        if (!hit || closed) { U.toast(L('No other language version found.')); return; }
        saveProgress(true); if (scrobbled) scrobble('stop'); stopEngine(false);
        ctx.series = target; ctx.episodes = eps;
        item = B.player.episodeItem(hit, target);
        watchedSeconds = 0; recorded = false; attempts = 0;
        start(pos);
      }, function () { U.toast(L('Something went wrong. Please try again.')); });
    }
    function chooseText() {
      if (!engine) return;
      var tr = engine.tracks();
      var opts = [{ value: -1, label: L('Off') }].concat(tr.text.map(function (t) { return { value: t.index, label: t.label }; }));
      if (!isLive()) opts.push({ value: -2, label: 'OpenSubtitles…' });
      if (extCues) opts.push({ value: -3, label: L('Subtitle timing') + ' (' + (extOffset > 0 ? '+' : '') + extOffset + ' s)' });
      var cur = extCues ? -2 : (tr.currentText == null ? -1 : tr.currentText);
      U.choose(L('Subtitles'), opts, cur, function (v) {
        if (v === -2) { openSubtitles(); return; }
        if (v === -3) { chooseOffset(); return; }
        autoSubsDone = true;
        clearExtSubs();
        engine.selectText(v < 0 ? null : v);
      });
    }
    function chooseOffset() {
      var o = [];
      for (var x = -10; x <= 10; x += 0.5) o.push({ value: x, label: (x > 0 ? '+' : '') + x + ' s' });
      U.choose(L('Subtitle timing'), o, extOffset, function (v) { extOffset = v; renderExtSub(); buildExtTrack(); });
    }
    function openSubtitles() {
      var OS = B.opensubtitles;
      if (!OS.ready()) { U.toast(L('Something went wrong. Please try again.')); return; }
      if (!OS.isLoggedIn()) { U.toast(L('Sign in to OpenSubtitles first (My Bingr).'), 5000); return; }
      var lang = OS.defaultLanguage();
      var series = ctx.series || null;
      var imdb = item.imdbID || (item.type === 'episode' ? B.trakt.imdbFor(series || { title: item.title }, true) : B.trakt.imdbFor({ title: item.title, year: B.int(item.subtitle) }, false));
      U.toast(L('Searching…'));
      tmdbFor().then(function (tmdb) {
        return OS.search({ imdb: imdb, title: item.title, year: item.type === 'movie' ? B.int(item.subtitle) : null,
          season: item.type === 'episode' ? item.season : null, episode: item.type === 'episode' ? item.episode : null, tmdb: tmdb }, lang ? [lang] : []);
      }).then(function (list) {
        if (closed) return;
        if (!list.length) { U.toast(lang ? L('No subtitles found in %@.', B.clang.name(lang) || lang) : L('No subtitles found for this title.')); return; }
        U.choose('OpenSubtitles', list.slice(0, 30).map(function (x, i) {
          return { value: i, label: (B.clang.name(x.language) || x.language), sub: x.release + (x.hearingImpaired ? ' · SDH' : '') };
        }), null, function (i) {
          U.toast(L('Loading…'));
          OS.download(list[i]).then(function (cues) {
            if (closed) return;
            if (!cues.length) { U.toast(L('No subtitles found for this title.')); return; }
            showExtCues(cues);
            U.toast(L('Subtitles: %@', B.clang.name(list[i].language) || list[i].language));
          }, function (e) { U.toast(e.message || L('Something went wrong. Please try again.')); });
        });
      }, function (e) { U.toast(e.message || L('Something went wrong. Please try again.')); });
    }

    // MARK: Trakt

    function scrobble(action) {
      if (!engine || isLive() || isCatchup()) return;
      if (action === 'stop') { if (stopSent) return; stopSent = true; }
      var d = engine.duration(), t = engine.time();
      var prog = d > 0 ? t / d : 0;
      if (action === 'start' && prog <= 0) prog = 0.001;
      B.trakt.scrobble(action, item, prog).then(function (r) {
        if (action === 'stop' && r === 'ok' && prog >= 0.8 && B.trakt.lastScrobble) U.toast(B.trakt.lastScrobble);
      }, B.noop);
    }

    // MARK: intro en volgende aflevering

    function inIntro(t) {
      if (!marker || marker.introEnd == null) return false;
      var s = marker.introStart || 0;
      return marker.introEnd > s + 1 && t >= s && t < marker.introEnd - 1;
    }
    function skipIntro() { if (engine && marker) { engine.seek(marker.introEnd); skipBtn.style.display = 'none'; } }
    function nextEpisode() {
      var eps = ctx.episodes || [];
      for (var i = 0; i < eps.length; i++) if (eps[i].id === item.id) return eps[i + 1] || null;
      return null;
    }
    function showNextCard() {
      var nx = nextEpisode();
      if (!nx || nextShown || nextDismissed) return;
      nextShown = true;
      var left = 10;
      U.clear(nextCard);
      var count = h('span.pl-count', String(left));
      var playB = U.button(L('Next episode'), function () { playNext(); }, { primary: true, icon: 'play' });
      var dismiss = U.button('', function () { nextDismissed = true; clearInterval(countdownTimer); nextCard.style.display = 'none'; }, { icon: 'close', cls: 'pl-ib pl-next-x', title: L('Close') });
      nextCard.appendChild(h('div.pl-next-still', [U.img(nx.still || item.artwork, 'still')]));
      nextCard.appendChild(h('div.pl-next-info', [h('div.muted.small', L('Next episode')), h('div.pl-next-title', 'S' + nx.season + ':E' + nx.number + ' ' + B.showName(nx.title)),
        h('div.muted.small', [L('Starts in'), ' ', count, ' s']), h('div.pl-next-btns', [playB])]));
      nextCard.appendChild(dismiss);
      nextCard.style.display = 'flex';
      countdownTimer = setInterval(function () {
        if (engine && !engine.playing && !engine.v.ended) return;
        left--;
        count.textContent = String(left);
        if (left <= 0) { clearInterval(countdownTimer); playNext(); }
      }, 1000);
    }
    function playNext() {
      var nx = nextEpisode();
      clearInterval(countdownTimer);
      if (!nx) { close(); return; }
      saveProgress(true);
      if (scrobbled) scrobble('stop');
      stopEngine(false);
      item = B.player.episodeItem(nx, ctx.series);
      watchedSeconds = 0; recorded = false; attempts = 0;
      var p = D.progress(nx.id);
      start(p ? p.position : 0);
    }
    function onEnded() {
      saveProgress(true, true);
      if (!isLive() && !isCatchup() && engine && !stopSent) { stopSent = true; B.trakt.scrobble('stop', item, 1).catch(B.noop); }
      if (item.type === 'episode' && nextEpisode()) { nextDismissed = false; nextShown = false; showNextCard(); return; }
      close();
    }

    // MARK: voortgang en geschiedenis

    function saveProgress(force, ended) {
      if (!engine || isLive() || isCatchup() || !engine.started) return;
      var now = Date.now();
      if (!force && now - lastSave < 10000) return;
      lastSave = now;
      var d = engine.duration(), t = engine.time();
      if (d <= 60) return;
      var pos = ended ? 1 : t / d;
      var left = d - t;
      var inCredits = marker && marker.creditsStart != null && marker.creditsStart > 60 && t >= marker.creditsStart;
      if (pos >= 0.85 || (d > 600 && left < 180 && pos > 0.7) || inCredits) {
        D.clearProgress(item.id);
        // build 154: id- en inhoudssleutels; dezelfde grens gaat via de wachtrij naar Trakt (één keer per keer kijken)
        D.markPlayedWatched(item, ctx);
        if (!traktMarked) { traktMarked = true; B.trakt.queueWatched(item, true, Date.now(), true); }
      } else if (pos > 0.02) {
        D.setProgress(item.id, { fraction: pos, position: t, title: item.title, artwork: item.artwork || null, playlistID: isrc() ? isrc().id : null });
      }
    }
    function recordHistory() {
      if (recorded || watchedSeconds < 60 || isCatchup()) return;
      recorded = true;
      D.addHistory({
        itemID: item.channel ? item.channel.id : item.id, playlistID: isrc() ? isrc().id : null, title: item.title,
        subtitle: item.subtitle || null, artwork: item.artwork || null, type: item.type, channelID: item.channel ? item.channel.id : null, date: Date.now()
      });
    }

    // MARK: tegelijk kijken

    function streamTitle() {
      if (isLive() && item.channel) { var nn = Lib.nowNext(item.channel); return B.chanName(item.channel.name) + (nn.now ? ' · ' + nn.now.title : ''); }
      if (isCatchup()) return item.subtitle + ' · ' + item.title;
      return item.subtitle ? item.title + ' · ' + item.subtitle : item.title;
    }
    // build 68: bij een aflevering de serie meesturen (statistieken: series en afleveringen tellen)
    function streamExtra() {
      if (item.type !== 'episode') return null;
      return { series_id: item.seriesID || (ctx.series && ctx.series.id) || null, series_title: (ctx.series && ctx.series.title) || item.title || null };
    }
    function streamStart() {
      return A.streamStart(profile.id, profile.name, streamTitle(), isCatchup() ? 'live' : item.type, item.id, streamExtra()).then(function (r) {
        if (closed) return true;
        if (r.limit) { showLimit(r); return false; }
        clearInterval(pingTimer);
        pingTimer = setInterval(function () {
          if (closed) { clearInterval(pingTimer); return; }
          A.streamPing(streamTitle()).then(function (alive) {
            if (alive === false && !closed) A.streamStart(profile.id, profile.name, streamTitle(), isCatchup() ? 'live' : item.type, item.id, streamExtra()).then(function (r2) { if (r2.limit && !closed) { stopEngine(false); showLimit(r2); } });
          });
        }, 30000);
        return true;
      });
    }
    function showLimit(r) {
      if (closed) return;
      limited = true;
      spinner.style.display = 'none';
      if (engine) engine.stop();
      U.clear(errorBox);
      errorBox.appendChild(U.icon('users', 'pl-err-ic'));
      errorBox.appendChild(h('h2', L('Too many people are watching')));
      errorBox.appendChild(h('p', r.limit === 1 ? L('Your account can be used on 1 screen at a time.')
        : L('Your account can be used on up to %d screens at the same time.', r.limit)));
      var list = h('div.limit-list');
      r.streams.forEach(function (s) {
        list.appendChild(h('div.limit-row', [B.screens.platformIcon(s.platform), h('div', [h('div', s.deviceName + ' · ' + s.profileName), h('div.muted.small', s.title)])]));
      });
      errorBox.appendChild(list);
      var up = B.screens.limitUpsell('streams', r);
      if (up) errorBox.appendChild(up);
      var row = h('div.dlg-buttons');
      row.appendChild(U.button(L('Try again'), function () { errorBox.style.display = 'none'; start(ctx.resume || 0); }, { primary: true }));
      row.appendChild(U.button(L('Close'), function () { close(); }));
      errorBox.appendChild(row);
      errorBox.style.display = 'flex';
    }

    // MARK: zappen (live)

    function zap(delta) {
      var list = ctx.channels || [];
      if (list.length < 2) return;
      var base = zapIndex == null ? (ctx.index || 0) : zapIndex;
      zapIndex = (base + delta + list.length) % list.length;
      var ch = list[zapIndex];
      var nn = Lib.nowNext(ch);
      U.clear(zapBanner);
      zapBanner.appendChild(h('div.pl-zap-num', ch.number != null ? String(ch.number) : ''));
      zapBanner.appendChild(h('div', [h('div.pl-zap-name', B.chanName(ch.name)), h('div.muted', nn.now ? B.showName(nn.now.title) : '')]));
      zapBanner.style.display = 'flex';
      clearTimeout(zapTimer);
      zapTimer = setTimeout(function () {
        var c = ctx.channels[zapIndex];
        ctx.index = zapIndex; zapIndex = null;
        setTimeout(function () { zapBanner.style.display = 'none'; }, 2000);
        stopEngine(false);
        item = B.player.channelItem(c);
        watchedSeconds = 0; recorded = false; attempts = 0; triedBackup = false;
        start(0);
      }, 600);
    }

    // MARK: volledig scherm en beeld-in-beeld

    function isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
    function toggleFullscreen() {
      try {
        if (isFull()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
        if (root.requestFullscreen) root.requestFullscreen().catch(B.noop);
        else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
        else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      } catch (e) { /* niet ondersteund */ }
    }
    function onFsChange() { U.clear(fsBtn); fsBtn.appendChild(U.icon(isFull() ? 'fullExit' : 'full')); }
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    function togglePip() {
      try {
        if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(B.noop); return; }
        if (video.requestPictureInPicture) { video.requestPictureInPicture().catch(function () { U.toast(L('Picture in Picture is not available for this stream.')); }); return; }
        if (video.webkitSetPresentationMode) video.webkitSetPresentationMode(video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
      } catch (e) { /* niet ondersteund */ }
    }

    // MARK: toetsen

    function onKey(e) {
      if (closed || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' && t.type !== 'range') || (t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'))) return;
      if (U.dialogOpen()) { if (e.key === 'Escape') { e.preventDefault(); U.closeTopDialog(); } return; }
      var k = e.key;
      if (k === ' ' || k === 'k' || k === 'K' || k === 'MediaPlayPause') {
        if (t && t.tagName === 'BUTTON' && k === ' ') return;
        e.preventDefault(); togglePlay(); return;
      }
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        if (t && t.classList && t.classList.contains('pl-vol')) return;
        e.preventDefault();
        if (!isLive()) jump((k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 30 : 10)); else showControls();
        return;
      }
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        // build 97: op de volumeschuif verandert ↑/↓ het volume, niet de zender
        var onVol = t && t.classList && t.classList.contains('pl-vol');
        if (!onVol && isLive() && (ctx.channels || []).length > 1) { zap(k === 'ArrowUp' ? -1 : 1); return; }
        video.volume = B.clamp(video.volume + (k === 'ArrowUp' ? 0.1 : -0.1), 0, 1); video.muted = false; drawVolume();
        flash(Math.round(video.volume * 100) + '%');
        return;
      }
      if (k === 'f' || k === 'F') { e.preventDefault(); toggleFullscreen(); return; }
      if (k === 'm' || k === 'M') { e.preventDefault(); video.muted = !video.muted; drawVolume(); flash(video.muted ? L('Muted') : Math.round(video.volume * 100) + '%'); return; }
      if (k === 'n' || k === 'N') { if (item.type === 'episode' && nextEpisode()) { e.preventDefault(); playNext(); } return; }
      if (k === 'p' || k === 'P') { e.preventDefault(); togglePip(); return; }
      if (k === 'Escape' || k === 'Backspace') {
        e.preventDefault();
        if (nextCard.style.display !== 'none') { nextDismissed = true; clearInterval(countdownTimer); nextCard.style.display = 'none'; return; }
        close();
      }
    }
    document.addEventListener('keydown', onKey);

    // MARK: klok

    function tick() {
      if (!engine || closed) return;
      updateTime();
      if (engine.playing) {
        watchedSeconds += 1;
        recordHistory();
        saveProgress(false);
      }
      if (isLive() && Date.now() % 30000 < 1000) renderTitleOnly();
      if (!isLive()) {
        var t = engine.time(), d = engine.duration();
        var intro = inIntro(t);
        if (intro && skipBtn.style.display === 'none') skipBtn.style.display = '';
        else if (!intro && skipBtn.style.display !== 'none') skipBtn.style.display = 'none';
        if (item.type === 'episode' && d > 120) {
          var credits = marker && marker.creditsStart != null ? marker.creditsStart : d - 25;
          if (t >= credits && !nextShown) showNextCard();
        }
      }
    }
    function renderTitleOnly() {
      if (!item.channel) return;
      var nn = Lib.nowNext(item.channel);
      U.clear(epg);
      if (nn.now) epg.appendChild(h('div', [h('b', L('Now') + '  '), B.fmtTime(nn.now.start) + '–' + B.fmtTime(nn.now.end) + '  ' + B.showName(nn.now.title)]));
      if (nn.next) epg.appendChild(h('div.muted', [h('b', L('Next') + '  '), B.fmtTime(nn.next.start) + '  ' + B.showName(nn.next.title)]));
    }

    function stopEngine(sendStop) {
      saveProgress(true);
      if (engine) engine.stop();
      if (sendStop) { clearInterval(pingTimer); A.streamStop(); }
    }
    function onPop() { if (!closed) close(true); }
    function onHide() { saveProgress(true); if (scrobbled && !stopSent) scrobble('stop'); A.streamStopBeacon(); D.flush(); }
    // build 154: app/tab naar de achtergrond = scrobble-stop met de huidige positie; terug en het speelt nog = weer start
    function onVis() {
      if (closed || !engine || isLive() || isCatchup()) return;
      if (document.visibilityState === 'hidden') { if (scrobbled && !stopSent) scrobble('stop'); }
      else if (scrobbled && stopSent && engine.playing) { stopSent = false; scrobble('start'); }
    }
    // terug uit de back-forward-cache: de stream was afgemeld (pagehide), meteen weer aanmelden (niet pas na een ping)
    function onShow(ev) { if (ev && ev.persisted && !closed && !limited) streamStart(); }
    function close(fromPop) {
      if (closed) return;
      closed = true;
      clearInterval(tickTimer); clearInterval(pingTimer); clearInterval(countdownTimer); clearInterval(extTimer);
      clearTimeout(hideTimer); clearTimeout(zapTimer);
      if (scrobbled && !stopSent) scrobble('stop');
      stopEngine(true);
      // build 102: casten opruimen (zoeken naar tv's stoppen, castVideo leeg)
      clearTimeout(cast.watchdog);
      cast.ids.forEach(function (w) { try { var p = w.r.cancelWatchAvailability(w.id); if (p && p.catch) p.catch(B.noop); } catch (e) { /* stil */ } });
      castVideo.removeAttribute('src'); try { castVideo.load(); } catch (e) { /* stil */ }
      try { if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(B.noop); } catch (e) { /* stil */ }
      try { if (isFull()) (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) { /* stil */ }
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pageshow', onShow);
      document.documentElement.classList.remove('playing');
      if ('mediaSession' in navigator) { try { navigator.mediaSession.metadata = null; } catch (e) { /* stil */ } }
      root.remove();
      D.flush();
      if (B.player.current === screen) B.player.current = null;
      if (fromPop !== true && history.state && history.state.bingrPlayer) history.back();
      if (ctx.onClose) ctx.onClose();
      B.emit('playerClosed');
    }
    screen.close = close;

    document.documentElement.classList.add('playing');
    B.player.current = screen;
    B.emit('playerOpened');
    document.body.appendChild(root);
    if (reopened && history.state && history.state.bingrPlayer) history.replaceState({ bingrPlayer: true }, '', location.href);
    else history.pushState({ bingrPlayer: true }, '', location.href);
    window.addEventListener('popstate', onPop);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', onShow);
    tickTimer = setInterval(tick, 1000);
    start(ctx.resume || 0);
    setTimeout(function () { try { playBtn.focus({ preventScroll: true }); } catch (e) { /* stil */ } }, 50);
    return screen;
  };

  // MARK: items maken

  function channelItem(ch) {
    return { type: 'live', id: ch.id, title: ch.name, subtitle: ch.group, streamURL: ch.streamURL, stalkerCmd: ch.stalkerCmd || null, artwork: ch.logo || null, channel: ch, _src: ch._src || null };
  }
  function episodeItem(ep, series) {
    return {
      type: 'episode', id: ep.id, title: series ? series.title : ep.title, subtitle: 'S' + ep.season + ':E' + ep.number + ' · ' + ep.title,
      streamURL: ep.streamURL, artwork: (series && series.poster) || ep.still || null, seriesID: ep.seriesID, season: ep.season, episode: ep.number,
      imdbID: (series && series.imdbID) || null, tmdb: (series && series.tmdb) || null, stremio: ep.stremio || null, year: series ? series.year : null,
      _src: ep._src || (series && series._src) || null
    };
  }
  function movieItem(m) {
    return { type: 'movie', id: m.id, title: m.title, subtitle: m.year ? String(m.year) : '', streamURL: m.streamURL, stalkerCmd: m.stalkerCmd || null,
      artwork: m.poster || null, imdbID: m.imdbID || null, tmdb: m.tmdb || null, stremio: m.stremio || null, year: m.year || null, _src: m._src || null };
  }
  function catchupItem(ch, p) {
    return { type: 'catchup', id: ch.id + '-cu-' + Math.floor(p.start / 1000), title: p.title || ch.name, subtitle: ch.name, streamURL: null,
      artwork: ch.logo || null, channel: ch, program: p, _src: ch._src || null };
  }
  B.player.channelItem = channelItem;
  B.player.episodeItem = episodeItem;
  B.player.movieItem = movieItem;
  B.player.catchupItem = catchupItem;
  B.player.playCatchup = function (ch, p, list) { return B.player.open(catchupItem(ch, p), { channels: list || null }); };
  B.player.playChannel = function (ch, list) {
    list = list || [ch];
    var idx = 0;
    for (var i = 0; i < list.length; i++) if (list[i].id === ch.id) { idx = i; break; }
    return B.player.open(channelItem(ch), { channels: list, index: idx });
  };
  /** Film of aflevering; vraagt eerst "Hervatten" als er voortgang is. */
  B.player.playVOD = function (item, ctx) {
    ctx = ctx || {};
    var p = D.progress(item.id);
    if (p && p.position > 30 && p.fraction < 0.95 && ctx.resume == null) {
      U.modal({
        title: B.showName(item.title), text: B.showName(item.subtitle || ''),
        buttons: [
          { label: L('Resume') + ' (' + B.fmtDur(p.position) + ')', icon: 'play', primary: true, fn: function () { ctx.resume = p.position; B.player.open(item, ctx); } },
          { label: L('Watch from the beginning'), icon: 'replay', fn: function () { ctx.resume = 0; B.player.open(item, ctx); } }
        ]
      });
      return;
    }
    B.player.open(item, ctx);
  };
})();
