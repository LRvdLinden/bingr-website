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
      // build 179 (#3): live zonder proxy en er is nog een andere engine: na 10 s zonder beeld de volgende
      var quick = opts.live && !step.orig && B.b179 && step.otherNext;
      var done = false, timer = setTimeout(function () { fail(new Error('timeout')); }, quick ? 10000 : opts.live ? 20000 : (step.orig ? 45000 : 25000));
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
          // build 176: data besparen op een mobiel netwerk (variant ≤ SD en ≤ 1,5 Mbit/s)
          if (B.b176ui && B.b176ui.tuneHls) B.b176ui.tuneHls(hls, Hls);
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
    // build 179 (#3): de speler die bij deze stream werkte eerst; na vastlopen de andere speler eerst
    if (!plan.error && B.b179 && opts.first) plan.steps = B.b179.startWith(plan.steps, opts.first);
    this.order = B.b179 && !plan.error ? B.b179.orderOf(plan.steps) : [];
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
      step.otherNext = plan.steps.slice(i).some(function (st) { return st.how !== step.how; });
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
    var recapSeg = null;   // build 179 (#10): samenvatting ("Previously on…") uit IntroDB
    var marker = null, extCues = null, extOffset = 0, extTimer = null, scrobbled = false, stopSent = false, traktMarked = false;
    var failPos = 0; // plek bij de laatste fout (films/afleveringen), voor "Opnieuw"
    // build 179 (#3): automatisch een andere speler (één keer per stream)
    // build 179 (X2): live opnieuw verbinden met oplopende wachttijd (retryDelay), reden van de laatste stop in Diagnose
    var reconnecting = false, retryN = 0, outageAt = 0, stableTimer = null, everPicture = false;
    var engineSwitched = false, stallTimer = null, startedAt = 0, startedWith = null, playedSec = 0, lastTick = 0;
    var startGen = 0, limited = false, audioChosen = false, autoSubsDone = false, forceTry = false, subsStartedAt = 0, extTrack = null, subsRetry = null;
    var zapTimer = null, zapIndex = null;
    var seeking = null;
    // build 173: paneel onderin (Audio en ondertitels, Zappen, Afleveringen, Slaaptimer), Vorige zender, dubbeltikken,
    // ondertitels na terugspoelen en de slaaptimer (pure regels in player173.js)
    var P173 = B.p173;
    var panelKind = null, panelTimer = null;
    var prevCh = new P173.PreviousChannel(item.channel ? item.channel.id : null), chSeen = {};
    if (item.channel) chSeen[item.channel.id] = item.channel;
    var dtap = new P173.DoubleTap(), tapTimer = null, lastTap = null, tapFxTimer = null;
    var rwSubs = null;   // {until, startedAt, index}: ondertitels even aan na kort terugspoelen
    var sleep = { choice: null, deadline: null }, sleepStopped = false;
    // build 164: het live voorbeeld van de tv-gids geeft zijn lopende stream mee ({engine, video, url}): dezelfde
    // <video> en dezelfde hls.js/mpegts.js, zonder opnieuw te laden (alleen live, alleen bij de eerste start)
    var adopt = ctx.adopt && item.type === 'live' && ctx.adopt.engine && ctx.adopt.video ? ctx.adopt : null;
    ctx.adopt = null;

    var video = adopt ? adopt.video : h('video.pl-video', { playsinline: true, 'webkit-playsinline': true, preload: 'auto' });
    if (adopt) { video.className = 'pl-video'; video.muted = false; video.removeAttribute('aria-hidden'); }
    video.setAttribute('x-webkit-airplay', 'allow');
    // build 102: `video` is de <video> die nu speelt (tijdens casten castVideo); localVideo blijft de eigen speler
    var localVideo = video;
    // echt afgespeelde seconden (voor de regel engineSwitch: na 10 s/30 s spelen niet meer wisselen)
    localVideo.addEventListener('timeupdate', function () {
      var t = Date.now();
      if (lastTick && !localVideo.paused && t - lastTick < 2000) playedSec += (t - lastTick) / 1000;
      lastTick = t;
    });
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
    var bar = h('div.pl-bar', { role: 'slider', tabindex: '0', 'aria-label': L('Position'), 'aria-valuemin': '0' }, [h('div.pl-track', [buf, fill]), knob, hoverT]);
    var tCur = h('span.pl-time'), tDur = h('span.pl-time.right');
    var leftBtns = h('div.pl-btns'), rightBtns = h('div.pl-btns.right');
    // build 173 (#6): "Eindigt om …" naast de tijdbalk
    var endsEl = h('div.pl-ends', { 'aria-live': 'off' });
    var bottom = h('div.pl-bottom', [h('div.pl-prog', [tCur, bar, tDur]), h('div.pl-row', [leftBtns, endsEl, rightBtns])]);
    var center = h('div.pl-center');
    var skipBtn = U.button(L('Skip intro'), function () { skipIntro(); }, { cls: 'pl-skip' });
    skipBtn.style.display = 'none';
    var nextCard = h('div.pl-next'); nextCard.style.display = 'none';
    var zapBanner = h('div.pl-zap'); zapBanner.style.display = 'none';
    var errorBox = h('div.pl-error', { role: 'alert' }); errorBox.style.display = 'none';
    var tapPlay = U.button(L('Play'), function () { tapPlay.style.display = 'none'; if (engine) engine.play(); }, { primary: true, icon: 'play', cls: 'pl-tapplay' });
    tapPlay.style.display = 'none';
    // build 171 (#1): "Kijk je nog?" en het scherm Gepauzeerd (ook na "gestopt vanaf een ander apparaat")
    var stillBox = h('div.pl-still', { role: 'alertdialog', 'aria-modal': 'true' }); stillBox.style.display = 'none';
    // build 173: één paneel onderin, over de video; pauzeert niet (ook in volledig scherm zichtbaar: binnen de speler)
    var panel = h('div.pl-panel', { role: 'dialog', 'aria-modal': 'false' }); panel.style.display = 'none';
    var tapFx = h('div.pl-tapfx', { 'aria-hidden': 'true' });
    var root = h('div.player', { role: 'dialog', 'aria-label': L('Player') }, [video, castVideo, castUI, subtitle, tap, tapFx, spinner, top, center, bottom, skipBtn, nextCard, zapBanner, tapPlay, panel, errorBox, stillBox]);
    var screen = { el: root, item: function () { return item; } };

    function isLive() { return item.type === 'live'; }
    function isCatchup() { return item.type === 'catchup'; }

    // MARK: build 171: "Kijk je nog?"
    // Na 3 afleveringen achter elkaar (automatisch of met Volgende aflevering) zonder bediening, of na 2/3/4 uur zonder
    // bediening (instelling per apparaat). Geen antwoord in 60 s: pauzeren en stream_stop (plek in de limiet en de
    // verbinding bij de aanbieder komen vrij), daarna "Gepauzeerd"; Afspelen gaat verder op dezelfde plek (live: weer live).
    var X171 = B.b171, still = X171 ? new X171.StillWatching(Date.now()) : null;
    var stillAskedAt = 0, stillTimer = null, pausedOut = false, pausedAt = 0;
    function stillOn() { return B.data.local('stillWatching', true) !== false; }
    function stillHours() { return X171.hours(B.data.local('stillWatchingHours', X171.DEFAULT_HOURS)); }
    // bediening: later verwerkt, zodat een klik op Volgende aflevering eerst als aflevering telt (stil venster)
    function interacted() { if (still && !stillAskedAt) setTimeout(function () { still.interaction(Date.now()); }, 0); }
    ['keydown', 'pointerdown', 'wheel', 'touchstart'].forEach(function (ev) { root.addEventListener(ev, interacted, { capture: true, passive: true }); });
    function stillCheck() {
      if (!still || stillAskedAt || pausedOut || closed || limited || !engine || !engine.playing) return;
      if (still.shouldAsk(Date.now(), stillHours(), stillOn())) askStill();
    }
    function askStill() {
      stillAskedAt = Date.now();
      U.clear(stillBox);
      var left = h('span.pl-still-n', String(X171.ANSWER_SECONDS));
      var go = U.button(L('Continue watching'), function () { answerStill(); }, { primary: true, icon: 'play' });
      stillBox.appendChild(h('div.pl-still-card', [h('h2', L('Are you still watching?')), h('div.dlg-buttons', [go,
        U.button(L('Stop'), function () { hideStill(); close(); })]), h('p.muted.small', [L('Pausing in'), ' ', left, ' s'])]));
      stillBox.style.display = 'flex';
      root.classList.add('still');
      setTimeout(function () { try { go.focus({ preventScroll: true }); } catch (e) { /* stil */ } }, 30);
      clearInterval(stillTimer);
      stillTimer = setInterval(function () {
        if (closed) { clearInterval(stillTimer); return; }
        left.textContent = String(X171.secondsLeft(stillAskedAt, Date.now()));
        if (X171.timedOut(stillAskedAt, Date.now())) { clearInterval(stillTimer); pauseOut(null); }
      }, 1000);
    }
    function hideStill() { clearInterval(stillTimer); stillAskedAt = 0; stillBox.style.display = 'none'; root.classList.remove('still'); }
    function answerStill() { hideStill(); if (still) still.answered(Date.now()); }
    /**
     * Pauzeren en afmelden; by = naam van het apparaat dat stopte (gestopt op afstand) of null ("Kijk je nog?").
     * Build 173: o = {text, label, resume} voor de slaaptimer ("Slaaptimer: gestopt" met Verder kijken).
     */
    var resumeFn = null;
    function pauseOut(by, o) {
      o = o || {};
      hideStill();
      closePanel();
      pausedOut = true;
      resumeFn = o.resume || null;
      pausedAt = engine && !isLive() ? engine.time() : 0;
      clearInterval(countdownTimer);
      if (scrobbled && !stopSent) scrobble('stop');
      stopEngine(true);
      U.clear(stillBox);
      var play = U.button(o.label || L('Play'), function () { resumeOut(); }, { primary: true, icon: 'play' });
      var text = o.text || (by == null ? L('Paused: press Play to continue') : (by ? L('Stopped from %@', by) : L('Stopped from another device')));
      stillBox.appendChild(h('div.pl-still-card', [h('h2', text), h('div.dlg-buttons', [play, U.button(L('Close'), function () { close(); })])]));
      stillBox.style.display = 'flex';
      root.classList.add('still');
      setTimeout(function () { try { play.focus({ preventScroll: true }); } catch (e) { /* stil */ } }, 30);
    }
    function resumeOut() {
      stillBox.style.display = 'none';
      root.classList.remove('still');
      pausedOut = false;
      if (still) still.answered(Date.now());
      attempts = 0;
      var fn = resumeFn; resumeFn = null;
      if (fn) { fn(); return; }
      start(isLive() ? 0 : pausedAt);
    }

    // MARK: bediening tonen/verbergen

    function showControls() {
      root.classList.add('ui');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        if (panelKind) return;
        if (engine && engine.playing && !root.querySelector('.pl-bar.drag') && !root.matches(':hover .pl-bottom:hover')) root.classList.remove('ui');
      }, 3200);
    }
    root.addEventListener('mousemove', showControls);
    // build 173: stand van de bediening vóór deze aanraking (touchstart toont hem al; een tik verbergt hem dan niet meteen weer)
    var uiBeforeTouch = false;
    root.addEventListener('touchstart', function () { uiBeforeTouch = root.classList.contains('ui'); if (!uiBeforeTouch) { showControls(); } }, { passive: true });
    tap.addEventListener('click', function (e) {
      if (panelKind) { closePanel(); return; }
      if (U.isTouch()) { touchTap(e); return; }
      togglePlay();
    });
    tap.addEventListener('dblclick', function () { if (!U.isTouch()) toggleFullscreen(); });
    /**
     * Build 173 (#4): aanraakscherm: dubbeltik links = 10 s terug, rechts = 10 s vooruit; elke tik erachteraan aan
     * dezelfde kant telt 10 s op (20, 30 s) met een kleine animatie. Eén tik = bediening tonen/verbergen (iets later,
     * zodat een dubbeltik dat niet eerst doet). Niet bij live tv.
     */
    function touchTap(e) {
      var r = root.getBoundingClientRect(), now = Date.now();
      var side = isLive() ? null : P173.tapSide((e.clientX || 0) - r.left, r.width);
      if (side && dtap.active(now) && (side === 'fwd') === dtap.forward) { clearTimeout(tapTimer); lastTap = null; doubleTap(side, now); return; }
      if (side && lastTap && lastTap.side === side && now - lastTap.at <= P173.DOUBLE_TAP_MS) { clearTimeout(tapTimer); lastTap = null; doubleTap(side, now); return; }
      lastTap = { side: side, at: now };
      clearTimeout(tapTimer);
      var wasUI = uiBeforeTouch;
      tapTimer = setTimeout(function () { lastTap = null; if (wasUI) root.classList.remove('ui'); else showControls(); }, side ? P173.DOUBLE_TAP_MS : 0);
    }
    function doubleTap(side, now) {
      var r = dtap.tap(side === 'fwd', now);
      jump(r.delta, true);
      tapFx.className = 'pl-tapfx show ' + side;
      tapFx.textContent = (r.total > 0 ? '+' : '−') + Math.abs(r.total) + ' s';
      clearTimeout(tapFxTimer);
      tapFxTimer = setTimeout(function () { tapFx.className = 'pl-tapfx'; }, P173.TAP_WINDOW);
    }

    function iconBtn(icon, label, fn, cls) { return U.button('', fn, { icon: icon, cls: 'pl-ib' + (cls ? ' ' + cls : ''), title: label }); }
    var playBtn = iconBtn('pause', L('Play / pause') + ' (K)', function () { togglePlay(); }, 'pl-playbtn');
    var muteBtn = iconBtn('volume', L('Mute') + ' (M)', function () { video.muted = !video.muted; drawVolume(); });
    var vol = h('input.pl-vol', { type: 'range', min: '0', max: '1', step: '0.05', value: '1', 'aria-label': L('Volume') });
    vol.addEventListener('input', function () { interacted(); video.volume = parseFloat(vol.value); video.muted = video.volume === 0; drawVolume(); });
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
        // build 173: ↑/↓ = zender omhoog/omlaag; "Vorige zender" is nu de laatst bekeken zender (knop rechts, toets R)
        leftBtns.appendChild(iconBtn('chUp', L('Channel up') + ' (↑)', function () { zap(-1); }, 'pl-desk'));
        leftBtns.appendChild(iconBtn('chDown', L('Channel down') + ' (↓)', function () { zap(1); }, 'pl-desk'));
      }
      leftBtns.appendChild(h('div.pl-volbox', [muteBtn, vol]));
      if (item.type === 'episode' && nextEpisode()) rightBtns.appendChild(U.button(L('Next episode'), function () { playNext(); }, { icon: 'next', cls: 'pl-tb' }));
      // build 173 (#2): Vanaf het begin (live met terugkijken) en Terug naar live (terugkijken van een lopend programma)
      if (isLive() && item.channel) {
        var nn2 = Lib.nowNext(item.channel);
        if (nn2.now && P173.canStartOver(Lib.canCatchup(item.channel, nn2.now), nn2.now.start, Date.now(), 0)) {
          rightBtns.appendChild(U.button(L('From the start'), function () { startOver(nn2.now); }, { icon: 'replay', cls: 'pl-tb pl-startover', title: L('From the start') }));
        }
      }
      if (isCatchup() && item.channel && item.program && P173.canGoLive(item.program.end, Date.now())) {
        rightBtns.appendChild(U.button(L('Back to live'), function () { goLive(); }, { icon: 'tv', cls: 'pl-tb pl-golive', title: L('Back to live') }));
      }
      // build 173 (#5): Afleveringen in de speler
      if (item.type === 'episode' && (ctx.episodes || []).length > 1) rightBtns.appendChild(iconBtn('list', L('Episodes') + ' (E)', function () { togglePanel('episodes'); }, 'pl-epsbtn'));
      // build 173 (#3): Zappen als lijst en Vorige zender
      if ((isLive() || isCatchup()) && zapChannels().length > 1) rightBtns.appendChild(iconBtn('guide', L('Zap') + ' (Z)', function () { togglePanel('zap'); }, 'pl-zapbtn'));
      if (isLive() && previousChannel()) rightBtns.appendChild(iconBtn('history', L('Previous channel') + ' (R)', function () { goPrevious(); }, 'pl-prevbtn'));
      // build 173 (A): één knop voor audio en ondertitels
      rightBtns.appendChild(iconBtn('subs', L('Audio & subtitles') + ' (A)', function () { togglePanel('av'); }, 'pl-avbtn'));
      // build 173 (#9): slaaptimer
      rightBtns.appendChild(iconBtn('clock', L('Sleep timer'), function () { togglePanel('sleep'); }, 'pl-sleepbtn' + (sleep.choice ? ' on' : '')));
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
      drawEnds();
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

    /** Build 173 (#6): "Eindigt om" (met de afspeelsnelheid); live: einde van het programma volgens de gids. */
    function drawEnds() {
      var at = null;
      if (isLive()) { var nn0 = item.channel ? Lib.nowNext(item.channel) : {}; at = nn0.now ? nn0.now.end : null; }
      else if (engine) { var d0 = engine.duration(); at = d0 > 0 ? P173.endsAt(Date.now(), (d0 - engine.time()) * 1000, video.playbackRate || 1) : null; }
      var txt = at ? L('Ends at %@', B.fmtTime(at)) : '';
      if (endsEl.textContent !== txt) endsEl.textContent = txt;
    }
    function updateTime() {
      if (!engine) return;
      drawEnds();
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

    // doorspoelen met de muis of een vinger: klikken/tikken springt, slepen verschuift (build 169: ook met touch,
    // tijd boven de balk bij hover en tijdens het slepen, met het verschil ten opzichte van nu)
    function fracAt(e) { var r = bar.getBoundingClientRect(); return r.width > 0 ? B.clamp(((e.clientX != null ? e.clientX : 0) - r.left) / r.width, 0, 1) : 0; }
    function drawHover(f) {
      var s = f * engine.duration();
      hoverT.textContent = seeking != null ? B.fmtDur(s) + '  ' + B.fmtDelta(s, engine.time()) : B.fmtDur(s);
      hoverT.style.left = (f * 100) + '%';
    }
    function cancelDrag() { if (seeking == null && !bar.classList.contains('drag')) return; seeking = null; bar.classList.remove('drag'); updateTime(); }
    bar.addEventListener('pointerdown', function (e) {
      if (isLive() || !engine || !engine.duration()) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;   // alleen de linkerknop
      e.preventDefault();
      try { bar.focus({ preventScroll: true }); } catch (x) { /* stil */ }
      bar.classList.add('drag');
      try { bar.setPointerCapture(e.pointerId); } catch (x) { /* stil */ }
      var f = fracAt(e);
      seeking = f * engine.duration(); drawHover(f); updateTime(); showControls();
    });
    bar.addEventListener('pointermove', function (e) {
      if (isLive() || !engine || !engine.duration()) return;
      var f = fracAt(e);
      if (seeking != null) { seeking = f * engine.duration(); updateTime(); showControls(); }
      drawHover(f);
    });
    function endDrag() {
      if (seeking == null) return;
      bar.classList.remove('drag');
      engine.seek(seeking); seeking = null;
      if (extCues) renderExtSub();
      updateTime(); showControls();
    }
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', cancelDrag);
    // capture kwijt zonder pointerup (venster uit beeld e.d.): niet spoelen
    bar.addEventListener('lostpointercapture', cancelDrag);

    // MARK: afspelen

    function start(resumeAt) {
      var gen = ++startGen;
      failPos = 0;
      engineSwitched = false; clearTimeout(stallTimer); stallTimer = null;
      if (!reconnecting) { retryN = 0; outageAt = 0; everPicture = false; }
      reconnecting = false;
      limited = false; audioChosen = false; autoSubsDone = false; subsStartedAt = Date.now(); clearTimeout(subsRetry); subsRetry = null;
      errorBox.style.display = 'none'; tapPlay.style.display = 'none';
      spinner.style.display = 'flex';
      nextShown = false; nextDismissed = false; nextCard.style.display = 'none';
      clearInterval(countdownTimer);
      subtitle.textContent = '';
      marker = item.type === 'episode' && item.seriesID && isrc() ? D.introMarker(isrc().id, item.seriesID) : null;
      // build 179 (#10): tijden per aflevering uit IntroDB (functie introdb) gaan voor; anders de eigen markeringen
      recapSeg = null;
      if (item.type === 'episode' && B.b179ui && ctx.series && item.season != null && item.episode != null) {
        B.b179ui.seriesTmdb(ctx.series).then(function (id) { return id ? B.b179ui.introFor(id, item.season, item.episode) : null; }).then(function (seg) {
          if (!seg || closed || gen !== startGen) return;
          var m = B.assign({}, marker || {});
          if (seg.intro) { m.introStart = seg.intro.start; m.introEnd = seg.intro.end; }
          if (seg.credits && seg.credits.start > 60) m.creditsStart = seg.credits.start;
          marker = m;
          recapSeg = seg.recap || null;
        }, B.noop);
      }
      renderInfo();
      showControls();
      clearExtSubs();
      scrobbled = false; stopSent = false; traktMarked = false;
      streamStart().then(function (ok) { if (ok === false && gen === startGen) limited = true; }, B.noop);
      // limiet van de IPTV-provider (alleen Xtream) alvast ophalen; blokkeert niets
      B.providers.providerLimit.prime(isrc());
      if (B.xs) B.xs.notePlayed(item, ctx);
      var resolve = adopt ? Promise.resolve(adopt.url) : isCatchup() ? (item.streamURL ? Promise.resolve(item.streamURL) : Lib.catchupURL(item.channel, item.program).then(function (u) { item.streamURL = u; return u; }))
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
    function openURL(url, resumeAt, gen, sw) {
      // build 102: nieuwe stream (volgende aflevering, zappen, opnieuw) tijdens het casten via castVideo: eerst lokaal
      // starten; is de tv daarna nog verbonden, dan gaat de nieuwe stream meteen weer naar de tv (castResume)
      if (cast.el === castVideo) { cast.keep = cast.mode === 'swap'; leaveCast(); }
      setCastURL(null);
      if (engine) engine.stop();
      var events = {
        buffering: function (b) { if (engine === my) { spinner.style.display = b ? 'flex' : 'none'; watchStall(my, b); } },
        ended: function () { if (engine === my) onEnded(); },
        error: function (e) { if (engine === my) fail(e); },
        state: function () { if (engine === my) { drawPlay(); if (!engine.playing) showControls(); } },
        tracks: function () { if (engine !== my) return; if (!audioChosen) applyTrackPrefs(); if (subsStartedAt && Date.now() - subsStartedAt > 1500) autoSubtitles(); if (panelKind === 'av' && !osState) drawPanel(); },
        needsTap: function () { if (engine === my) { spinner.style.display = 'none'; tapPlay.style.display = ''; showControls(); } }
      };
      // build 164: stream van het live voorbeeld overnemen (zelfde URL en hij speelt al): geen nieuwe poging
      var took = adopt && adopt.url === url && adopt.engine.started && !adopt.engine.stopped ? adopt.engine : null;
      if (adopt && !took) { try { adopt.engine.stop(); } catch (e) { /* stil */ } }
      adopt = null;
      if (took) { took.ev = events; engine = took; }
      else engine = new Engine(events, video);
      var my = engine;
      var opening = took ? Promise.resolve() : vodHls(url).then(function (cands) {
        if (closed || engine !== my) return Promise.reject(new Error('stopped'));
        var first = sw ? sw.engine : (B.b179ui ? B.b179ui.engineFor(streamKey()) : null);
        if (!sw) startedWith = null;
        return my.open(url, { live: isLive(), start: resumeAt || 0, forceTry: forceTry, hls: cands, first: first,
          onReady: function () { if (engine === my) applyTrackPrefs(); } });
      });
      return opening.then(function () {
        if (took) { my.play(); events.state(); }
        if (closed || limited || engine !== my || (gen != null && gen !== startGen)) { if (engine === my && (closed || limited)) my.stop(); return; }
        attempts = 0;
        startedAt = Date.now(); playedSec = 0; lastTick = 0; everPicture = true;
        clearTimeout(stableTimer);
        stableTimer = setTimeout(function () { if (!closed && engine === my && engine.playing) { retryN = 0; outageAt = 0; } }, (B.b179 ? B.b179.STABLE_SECONDS : 10) * 1000);
        if (B.b179 && my.how) {
          var eng = B.b179.engineOf(my.how), first0 = (my.order || [])[0] || eng;
          if (!startedWith) startedWith = sw ? null : first0;
          // vóór het eerste beeld al naar een andere engine gegaan (de eerste kwam niet binnen 10 s): ook dat is de ene wissel
          var moved = !sw && eng !== first0;
          if (moved && !engineSwitched) { engineSwitched = true; U.toast(L('Tried another player'), 3000); }
          if (B.b179ui) B.b179ui.rememberEngine(streamKey(), B.b179.engineMemo(null, startedWith || eng, sw || moved ? eng : null, true));
        }
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

    // MARK: build 179 (#3): automatisch een andere speler

    function streamKey() { return B.b179 ? B.b179.memoKey(isrc() ? isrc().id : '', item) : ''; }
    /** Na het eerste beeld: 10 s aan één stuk bufferen (en minder dan 30 s gespeeld) = een andere engine. */
    function watchStall(my, waiting) {
      clearTimeout(stallTimer); stallTimer = null;
      if (!waiting || !B.b179 || engineSwitched || !my.started) return;
      var since = Date.now();
      stallTimer = setTimeout(function () {
        stallTimer = null;
        if (closed || engine !== my || (!video.paused && video.readyState >= 3)) return;
        if (B.b179.engineSwitch(false, true, (Date.now() - startedAt) / 1000, (Date.now() - since) / 1000, playedSec, engineSwitched)) switchEngine('stall');
      }, 10000);
    }
    /** Eén keer per stream: dezelfde stream met de volgende engine (hls ↔ mpegts ↔ native). Nooit een externe app. */
    function switchEngine(why) {
      if (!B.b179 || engineSwitched || closed || limited || !engine || !engine.started || !engine.how || cast.el === castVideo || item.offline) return false;
      if (why === 'error' && !B.b179.engineSwitch(true, true, (Date.now() - startedAt) / 1000, 0, playedSec, false)) return false;
      var next = B.b179.engineNext(engine.order || [], B.b179.engineOf(engine.how), false);
      if (!next) return false;
      engineSwitched = true;
      var at = !isLive() ? engine.time() : 0, g = startGen;
      B.log('andere speler proberen (' + why + '): ' + next);
      U.toast(L('Tried another player'), 3000);
      spinner.style.display = 'flex';
      var again = isCatchup() && item.streamURL ? Promise.resolve(item.streamURL) : (B.media.webStream(isrc(), item) ? Promise.resolve(B.media.webStream(isrc(), item)) : Lib.resolveURL(item, isLive()));
      again.then(function (u) { if (!closed && g === startGen) return openURL(u, at, g, { engine: next }); }).catch(function (e2) { if (g === startGen) fail(e2); });
      return true;
    }

    /** Reden van de stop bewaren voor Diagnose ("Laatste stop"). */
    function logStop(reason) {
      if (!B.b179) return;
      var u = (engine && engine.url) || item.streamURL || '';
      var fmt = (String(u).split('?')[0].match(/\.([a-z0-9]{2,5})$/i) || [])[1] || (/m3u8/i.test(u) ? 'm3u8' : '?');
      var st = { when: Date.now(), reason: reason, after: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0,
        engine: engine && engine.how ? B.b179.engineOf(engine.how) : '?', format: String(fmt).toLowerCase(), live: isLive() };
      B.store.set('diag.stops', B.b179.pushStop(B.store.get('diag.stops', []), st, 10));
      B.log('stream gestopt: ' + reason + ' na ' + st.after + ' s (' + st.engine + ', ' + st.format + ')');
    }
    /** Live opnieuw verbinden (verse link); false = opgeven. Altijd eerst de oude verbinding dicht. */
    function reconnectLive() {
      if (!B.b179 || closed || limited) return false;
      if (!outageAt) outageAt = Date.now();
      var d = B.b179.retryDelay(retryN, true, everPicture, (Date.now() - outageAt) / 1000);
      if (d == null) return false;
      retryN++;
      clearTimeout(stableTimer);
      if (engine) engine.stop();
      spinner.style.display = 'flex';
      var g = startGen;
      setTimeout(function () {
        if (closed || g !== startGen) return;
        reconnecting = true;
        start(0);
      }, d * 1000);
      return true;
    }

    // MARK: fouten

    function fail(e) {
      if (closed || limited) return;
      // bewust gestopt (sluiten, zappen, foutscherm): geen fout
      if (e && e.message === 'stopped') return;
      B.log('player error', e && e.message);
      spinner.style.display = 'none';
      if (e && e.insecure) { showError(e); return; }
      if (switchEngine('error')) return;
      // build 179 (X2): live na beeld: tot 5 pogingen met oplopende wachttijd (verse link), daarna back-upbron of fout
      if (isLive() && !isCatchup() && engine && engine.started) {
        logStop('error');
        if (reconnectLive()) return;
        logStop('gaveUp');
        attempts = 1;
      }
      // ook de andere engine lukte niet: het onthouden wissen (engineMemo)
      if (engineSwitched && B.b179ui) B.b179ui.rememberEngine(streamKey(), null);
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
    function jump(s, quiet) {
      if (!engine || isLive()) return;
      var d = engine.duration(), from = engine.time();
      var t = B.clamp(from + s, 0, d > 0 ? d - 2 : from + s);
      engine.seek(t);
      rewound(t - from, from, t);
      if (extCues) renderExtSub();
      updateTime();
      if (!quiet) { showControls(); flash(s > 0 ? '+' + s + ' s' : s + ' s'); }
    }

    // MARK: build 173 (#7): ondertitels even aan na kort terugspoelen

    function rewindOn() { return B.data.local('rewindSubtitles', true) !== false; }
    /** Spoor in de taal van de app of de gekozen ondertiteltaal (alleen sporen uit de stream). */
    function rewindTrack(tr) {
      var want = [];
      var pref = B.clang && B.clang.preferredSubtitle ? B.clang.preferredSubtitle() : '';
      if (pref) want.push(pref);
      want.push(String(B.lang || 'en').slice(0, 2));
      var i = P173.subtitleTrack(tr.text.map(function (x) { return x.lang || x.label || ''; }), want);
      return i == null ? null : tr.text[i].index;
    }
    function rewound(delta, from, to) {
      if (!engine || isLive()) return;
      if (rwSubs) { rwSubs.until = Math.max(rwSubs.until, from); rwSubs.startedAt = Math.min(rwSubs.startedAt, to); return; }
      var tr = engine.tracks();
      var on = tr.currentText != null || !!extCues;
      var idx = on ? null : rewindTrack(tr);
      if (!P173.rewindSubtitles(delta, on, idx != null, rewindOn())) return;
      rwSubs = { until: from, startedAt: to, index: idx };
      try { engine.selectText(idx); } catch (e) { rwSubs = null; }
    }
    function rewindCheck() {
      if (!rwSubs || !engine) return;
      var tr = engine.tracks();
      // zelf ondertitels gekozen in de tussentijd: niets meer terugzetten
      if (tr.currentText !== rwSubs.index || extCues) { rwSubs = null; return; }
      if (P173.rewindSubtitlesDone(engine.time(), rwSubs.until, rwSubs.startedAt)) { rwSubs = null; try { engine.selectText(null); } catch (e) { /* stil */ } }
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
    // MARK: build 173: paneel onderin (A: Audio en ondertitels, 3: Zappen, 5: Afleveringen, 9: Slaaptimer)

    function togglePanel(kind) { if (panelKind === kind) closePanel(); else openPanel(kind); }
    function openPanel(kind) {
      if (!engine && kind !== 'sleep') return;
      panelKind = kind;
      if (kind === 'zap') { zapCat = null; zapQuery = ''; }   // build 179: opent op de categorie van de zender die speelt
      root.classList.add('ui', 'panel-open');
      clearTimeout(hideTimer);
      panel.style.display = '';
      drawPanel();
      clearInterval(panelTimer);
      panelTimer = setInterval(function () { if (panelKind === 'sleep') drawSleepLeft(); }, 1000);
      setTimeout(function () {
        var f = null;
        ['.pl-opt.on:not([disabled])', '.pl-zapit.on', '.pl-ep.on', '.pl-opt:not([disabled])', '.pl-zapit', '.pl-ep', 'button'].some(function (q) { f = panel.querySelector(q); return !!f; });
        if (f) { try { f.focus({ preventScroll: false }); } catch (e) { /* stil */ } }
      }, 30);
    }
    function closePanel() {
      if (!panelKind) return;
      panelKind = null;
      clearInterval(panelTimer);
      panel.style.display = 'none';
      U.clear(panel);
      root.classList.remove('panel-open');
      showControls();
    }
    function drawPanel() {
      if (!panelKind) return;
      var y = (panel.querySelector('.pl-panel-body') || {}).scrollTop || 0;
      U.clear(panel);
      ({ av: avPanel, zap: zapPanel, episodes: episodesPanel, sleep: sleepPanel })[panelKind]();
      var body = panel.querySelector('.pl-panel-body');
      if (body && y) body.scrollTop = y;
    }
    function panelHead(title, extra) {
      panel.setAttribute('aria-label', title);
      return h('div.pl-panel-head', [h('h2', title), extra || null, U.button('', function () { closePanel(); }, { icon: 'close', cls: 'pl-ib pl-panel-x', title: L('Close') + ' (Esc)' })]);
    }
    function opt(label, sub, on, fn, cls) {
      var b = h('button.pl-opt' + (on ? '.on' : '') + (cls ? '.' + cls : ''), { type: 'button', 'aria-pressed': on ? 'true' : 'false' },
        [h('span.pl-opt-l', [h('span', label), sub ? h('span.pl-opt-sub', sub) : null]), on ? U.icon('check') : null]);
      if (fn) b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
      else b.disabled = !on;
      return b;
    }
    function seg(items, cur, fn) {
      var box = h('div.pl-seg', { role: 'group' });
      items.forEach(function (it) {
        var b = h('button.pl-chip' + (it[0] === cur ? '.on' : ''), { type: 'button', 'aria-pressed': it[0] === cur ? 'true' : 'false' }, it[1]);
        b.addEventListener('click', function (e) { e.stopPropagation(); fn(it[0]); });
        box.appendChild(b);
      });
      return box;
    }

    // A: audio, ondertitels (stream, OpenSubtitles) en de weergave in één paneel; het afspelen gaat door
    var osState = null;   // {busy, list, error}: zoekresultaten van OpenSubtitles in het paneel
    function avPanel() {
      if (osState) { osPanel(); return; }
      panel.appendChild(panelHead(L('Audio & subtitles')));
      var tr = engine ? engine.tracks() : { audio: [], text: [], currentAudio: null, currentText: null };
      var body = h('div.pl-panel-body.pl-cols');
      var ac = h('div.pl-col', [h('h3', L('Audio'))]);
      if (tr.audio.length > 1) {
        tr.audio.forEach(function (t) { ac.appendChild(opt(t.label, null, t.index === tr.currentAudio, function () { audioChosen = true; engine.selectAudio(t.index); drawPanel(); })); });
      } else {
        var lg = currentAudioLang();
        ac.appendChild(opt(lg ? B.clang.name(lg) : (tr.audio[0] ? tr.audio[0].label : L('Audio')), null, true, null));
        ac.appendChild(h('p.muted.small.pl-note', L('No alternative audio tracks')));
      }
      versions().slice(0, 6).forEach(function (v) { ac.appendChild(opt(L('Other language') + ': ' + v.label, null, false, function () { closePanel(); switchVersion(v); })); });
      var sc = h('div.pl-col', [h('h3', L('Subtitles'))]);
      var cur = extCues ? 'os' : (tr.currentText == null ? -1 : tr.currentText);
      function pickText(i) { autoSubsDone = true; rwSubs = null; clearExtSubs(); engine.selectText(i); drawPanel(); }
      sc.appendChild(opt(L('Off'), null, cur === -1, function () { pickText(null); }));
      tr.text.forEach(function (t) { sc.appendChild(opt(t.label, null, cur === t.index, function () { pickText(t.index); })); });
      if (extCues) sc.appendChild(opt('OpenSubtitles', extLabel || null, true, null));
      if (!isLive()) sc.appendChild(opt(L('Search OpenSubtitles…'), null, false, function () { osSearch(); }, 'pl-os'));
      if (extCues) {
        var val = h('span.pl-timing-v', (extOffset > 0 ? '+' : '') + extOffset + ' s');
        var tb = function (label, d) { return U.button(label, function () { extOffset = d == null ? 0 : Math.round((extOffset + d) * 10) / 10; renderExtSub(); buildExtTrack(); drawPanel(); }, { cls: 'pl-chip' }); };
        sc.appendChild(h('div.pl-timing', [h('div.muted.small', L('Subtitle timing')), h('div.pl-seg', [tb(L('Earlier'), -0.5), val, tb(L('Later'), 0.5), tb(L('In sync'), null)])]));
      }
      var dc = h('div.pl-col', [h('h3', L('Subtitle display'))]);
      dc.appendChild(h('div.muted.small', L('Subtitle size')));
      dc.appendChild(seg([['small', L('Small')], ['medium', L('Medium')], ['large', L('Large')]], P173.subSize(D.shared('subtitleSize', 'medium')), function (v) { D.setShared('subtitleSize', v); applySubStyle(); drawPanel(); }));
      dc.appendChild(h('div.muted.small', L('Subtitle background')));
      dc.appendChild(seg([['shadow', L('Shadow')], ['box', L('Dark box')]], P173.subBackground(D.local('subtitleBackground', 'box')), function (v) { D.setLocal('subtitleBackground', v); applySubStyle(); drawPanel(); }));
      body.appendChild(ac); body.appendChild(sc); body.appendChild(dc);
      panel.appendChild(body);
    }
    /** Weergave van ondertitels: grootte (settings.shared.subtitleSize, zoals de apps) en achtergrond (dit apparaat). */
    function applySubStyle() {
      var size = P173.subSize(D.shared('subtitleSize', 'medium')), bg = P173.subBackground(D.local('subtitleBackground', 'box'));
      subtitle.style.setProperty('--sub-scale', String(P173.SUB_SIZES[size]));
      root.classList.toggle('sub-small', size === 'small');
      root.classList.toggle('sub-large', size === 'large');
      root.classList.toggle('sub-shadow', bg === 'shadow');
    }
    var extLabel = null;
    function osSearch() {
      var OS = B.opensubtitles;
      if (!OS.ready()) { U.toast(L('Something went wrong. Please try again.')); return; }
      // build 157: OpenSubtitles hoort bij Lifetime (ondertitels uit de stream blijven gratis)
      if (!OS.allowed()) { closePanel(); B.plan.sheet('opensubtitles'); return; }
      if (!OS.isLoggedIn()) { osState = { error: L('Sign in to OpenSubtitles first (My Bingr).') }; drawPanel(); return; }
      var lang = OS.defaultLanguage(), my = item.id;
      var series = ctx.series || null;
      var imdb = item.imdbID || (item.type === 'episode' ? B.trakt.imdbFor(series || { title: item.title }, true) : B.trakt.imdbFor({ title: item.title, year: B.int(item.subtitle) }, false));
      osState = { busy: true, lang: lang };
      drawPanel();
      tmdbFor().then(function (tmdb) {
        return OS.search({ imdb: imdb, title: item.title, year: item.type === 'movie' ? B.int(item.subtitle) : null,
          season: item.type === 'episode' ? item.season : null, episode: item.type === 'episode' ? item.episode : null, tmdb: tmdb }, lang ? [lang] : []);
      }).then(function (list) {
        if (closed || item.id !== my || !osState) return;
        osState = list.length ? { list: list.slice(0, 30) } : { error: lang ? L('No subtitles found in %@.', B.clang.name(lang) || lang) : L('No subtitles found for this title.') };
        drawPanel();
      }, function (e) {
        if (closed || !osState) return;
        osState = { error: (e && e.message) || L('Something went wrong. Please try again.') };
        drawPanel();
      });
    }
    function osPanel() {
      var back = U.button('', function () { osState = null; drawPanel(); }, { icon: 'back', cls: 'pl-ib', title: L('Back') });
      panel.appendChild(panelHead('OpenSubtitles', back));
      var body = h('div.pl-panel-body');
      if (osState.busy) body.appendChild(h('div.pl-panel-wait', [U.spinner(), h('span.muted', L('Searching…'))]));
      else if (osState.error) body.appendChild(h('p.muted.pl-note', osState.error));
      else osState.list.forEach(function (x) {
        body.appendChild(opt(B.clang.name(x.language) || x.language, x.release + (x.hearingImpaired ? ' · SDH' : ''), false, function () {
          osState = { busy: true }; drawPanel();
          B.opensubtitles.download(x).then(function (cues) {
            if (closed) return;
            osState = null;
            if (!cues.length) { U.toast(L('No subtitles found for this title.')); drawPanel(); return; }
            rwSubs = null;
            showExtCues(cues);
            extLabel = B.clang.name(x.language) || x.language;
            autoSubsDone = true;
            drawPanel();
            U.toast(L('Subtitles: %@', extLabel));
          }, function (e) { osState = { error: (e && e.message) || L('Something went wrong. Please try again.') }; drawPanel(); });
        }));
      });
      panel.appendChild(body);
    }

    // 3: Zappen (wat er nu op de andere zenders is; favorieten en de huidige categorie eerst) en Vorige zender
    function zapChannels() {
      // build 179 (#5): alle zenders van de open server (zelfde filters: verborgen, kinderprofiel), anders de lijst van de speler
      var base = B.b179ui && B.b179ui.zapChannels ? B.b179ui.zapChannels(ctx.channels || [], item) : (ctx.channels || []);
      return base.filter(function (c) { return !(B.b171ui && B.b171ui.hides(c, 'channel')); });
    }
    function previousChannel() { return prevCh.previous != null ? chSeen[prevCh.previous] || null : null; }
    // build 179 (#5): tabs Alle / Favorieten / categorieën en zoeken (zapCategories, zapSearch); de keuze blijft staan
    // zolang de speler open is, en opent op de categorie van de zender die speelt
    var zapCat = null, zapQuery = '';
    function zapPanel() {
      var pc = previousChannel();
      var prevB = pc ? U.button(L('Previous channel'), function () { closePanel(); goPrevious(); }, { icon: 'history', cls: 'pl-chip', title: L('Previous channel') + ' (R): ' + B.chanName(pc.name) }) : null;
      panel.appendChild(panelHead(L('Zap'), prevB));
      var list = zapChannels(), now = Date.now();
      var curId = item.channel ? item.channel.id : null, curGroup = item.channel ? item.channel.group || '' : null;
      var favs = list.map(function (c) { return D.inSet('favorites', B.xs && B.xs.keyOf ? B.xs.keyOf(c) : c.id) || D.inSet('favorites', c.id); });
      var order = P173.zapOrder(list.map(function (c) { return c.group || ''; }), favs, curGroup);
      var P9 = B.b179;
      var tabs = P9 ? ['*all'].concat(P9.zapCategories(list.map(function (c) { return c.group || ''; }), favs)) : ['*all'];
      if (zapCat == null || tabs.indexOf(zapCat) < 0) zapCat = curGroup && tabs.indexOf(curGroup) >= 0 ? curGroup : '*all';
      var box = h('div.pl-panel-body.pl-zaplist', { role: 'list' });
      var locked = function (c) { try { return !!(B.b176ui && B.b176ui.isLocked && B.b176ui.isLocked(c, 'channel')); } catch (e) { return false; } };
      function fill() {
        U.clear(box);
        var pool = order.filter(function (i) {
          if (zapCat === '*favorites') return favs[i];
          if (zapCat !== '*all') return (list[i].group || '') === zapCat;
          return true;
        });
        var shown = pool;
        if (P9 && zapQuery.trim()) {
          var hits = P9.zapSearch(zapQuery, pool.map(function (i) { return { name: B.chanName(list[i].name), number: list[i].number }; }));
          shown = hits.map(function (k) { return pool[k]; });
        }
        if (!shown.length) { box.appendChild(h('p.muted.pl-zapnone', L('No channels found'))); return; }
        shown.slice(0, 500).forEach(function (i) {
          var c = list[i], nn = Lib.nowNext(c), on = c.id === curId;
          var prog = nn.now ? h('div.card-progress.inline', [h('div', { style: { width: (B.clamp((now - nn.now.start) / (nn.now.end - nn.now.start), 0, 1) * 100) + '%' } })]) : null;
          var b = h('button.pl-zapit' + (on ? '.on' : ''), { type: 'button', role: 'listitem', 'aria-current': on ? 'true' : null }, [
            h('div.pl-zaplogo', [U.img(c.logo, 'logo', B.chanName(c.name))]),
            h('div.pl-zaptxt', [h('div.pl-zapname', [c.number != null ? h('span.pl-zapnum', String(c.number)) : null, B.chanName(c.name),
              favs[i] ? U.icon('starFill', 'pl-zapfav') : null, locked(c) ? U.icon('lock', 'pl-zapfav') : null]),
              h('div.muted.small.pl-zapnow', nn.now ? B.showName(nn.now.title) : (c.group || '')), prog])]);
          b.addEventListener('click', function (e) { e.stopPropagation(); closePanel(); if (!on || isCatchup()) tuneTo(c); });
          box.appendChild(b);
        });
      }
      if (P9 && list.length > 1) {
        var search = h('input.input.pl-zapsearch', { type: 'search', placeholder: L('Search channels'), 'aria-label': L('Search channels') });
        search.value = zapQuery;
        search.addEventListener('input', function () { zapQuery = search.value; fill(); });
        search.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (search.value) { search.value = ''; zapQuery = ''; fill(); } else closePanel(); return; }
          if (e.key === 'ArrowDown') { var f = box.querySelector('button'); if (f) { e.preventDefault(); f.focus(); } }
          e.stopPropagation();
        });
        var bar = h('div.pl-zaptabs', { role: 'tablist', 'aria-label': L('Category') });
        tabs.forEach(function (t) {
          var label = t === '*all' ? L('All') : t === '*favorites' ? L('Favorites') : t;
          var tb = h('button.pl-zaptab' + (t === zapCat ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': t === zapCat ? 'true' : 'false' }, label);
          tb.addEventListener('click', function (e) {
            e.stopPropagation();
            zapCat = t;
            Array.prototype.forEach.call(bar.children, function (x) { x.classList.remove('on'); x.setAttribute('aria-selected', 'false'); });
            tb.classList.add('on'); tb.setAttribute('aria-selected', 'true');
            fill();
          });
          bar.appendChild(tb);
        });
        panel.appendChild(h('div.pl-zaptools', [search, bar]));
        setTimeout(function () { var o = bar.querySelector('.on'); if (o && o.scrollIntoView) o.scrollIntoView({ block: 'nearest', inline: 'center' }); }, 0);
      }
      fill();
      panel.appendChild(box);
      setTimeout(function () { var o = box.querySelector('.on'); if (o && o.scrollIntoView) o.scrollIntoView({ block: 'center' }); }, 0);
    }
    /** Naar een andere zender zonder de speler te verlaten (ook vanuit terugkijken). */
    // build 176: vergrendelde zender = eerst de pincode van het hoofdprofiel; Annuleren = blijven op de huidige zender
    function tuneTo(c) {
      if (!c) return;
      if (B.b176ui && B.b176ui.gateChannel) { B.b176ui.gateChannel(c, function () { tuneToNow(c); }, function () { clearTimeout(zapTimer); zapIndex = null; }); return; }
      tuneToNow(c);
    }
    function tuneToNow(c) {
      if (!c) return;
      var list = ctx.channels || [];
      for (var k = 0; k < list.length; k++) if (list[k] === c || list[k].id === c.id) { ctx.index = k; break; }
      clearTimeout(zapTimer); zapIndex = null;
      stopEngine(false);
      item = B.player.channelItem(c);
      chSeen[c.id] = c; prevCh.tuned(c.id);
      watchedSeconds = 0; recorded = false; attempts = 0; triedBackup = false;
      start(0);
    }
    function goPrevious() {
      var c = previousChannel();
      if (!c) return;
      U.clear(zapBanner);
      zapBanner.appendChild(h('div.pl-zap-num', c.number != null ? String(c.number) : ''));
      zapBanner.appendChild(h('div', [h('div.pl-zap-name', B.chanName(c.name)), h('div.muted', L('Previous channel'))]));
      zapBanner.style.display = 'flex';
      setTimeout(function () { zapBanner.style.display = 'none'; }, 2000);
      tuneTo(c);
    }
    // 2: Vanaf het begin (terugkijken van het lopende programma) en Terug naar live, in dezelfde speler
    function startOver(p) {
      if (!item.channel || !p) return;
      var ch = item.channel;
      closePanel();
      stopEngine(false);
      item = B.player.catchupItem(ch, p);
      watchedSeconds = 0; recorded = false; attempts = 0; triedBackup = false;
      start(0);
    }
    function goLive() {
      if (!item.channel) return;
      var ch = item.channel;
      closePanel();
      stopEngine(false);
      item = B.player.channelItem(ch);
      watchedSeconds = 0; recorded = false; attempts = 0; triedBackup = false;
      start(0);
    }

    // 5: Afleveringen (seizoenen en afleveringen met voortgang; kiezen speelt direct af, de speler blijft open)
    var epSeason = null;
    function episodesPanel() {
      var eps = ctx.episodes || [];
      var seasons = [];
      eps.forEach(function (e) { if (seasons.indexOf(e.season) < 0) seasons.push(e.season); });
      seasons.sort(function (a, b) { return a - b; });
      if (epSeason == null || seasons.indexOf(epSeason) < 0) epSeason = seasons.indexOf(item.season) >= 0 ? item.season : seasons[0];
      panel.appendChild(panelHead(L('Episodes'), ctx.series ? h('span.muted.pl-panel-sub', B.showName(ctx.series.title)) : null));
      if (seasons.length > 1) panel.appendChild(seg(seasons.map(function (n) { return [n, L('Season %d', n)]; }), epSeason, function (n) { epSeason = n; drawPanel(); }));
      var box = h('div.pl-panel-body.pl-eplist', { role: 'list' });
      eps.filter(function (e) { return e.season === epSeason; }).forEach(function (ep) {
        var on = ep.id === item.id, pr = D.progress(ep.id);
        var seen = ctx.series && D.episodeWatched ? D.episodeWatched(ctx.series, ep) : false;
        var b = h('button.pl-ep' + (on ? '.on' : ''), { type: 'button', role: 'listitem', 'aria-current': on ? 'true' : null }, [
          h('div.pl-ep-still', [U.img(ep.still || (ctx.series && ctx.series.poster) || null, 'still', ''), seen ? U.icon('checkCircleFill', 'pl-ep-seen') : null]),
          h('div.pl-ep-txt', [h('div.pl-ep-title', L('Episode %d', ep.number) + (ep.title ? ' · ' + B.showName(ep.title) : '')),
            ep.duration ? h('div.muted.small', ep.duration) : null,
            pr && pr.fraction > 0 ? h('div.card-progress.inline', [h('div', { style: { width: Math.round(B.clamp(pr.fraction, 0, 1) * 100) + '%' } })]) : null])]);
        b.addEventListener('click', function (e) { e.stopPropagation(); closePanel(); playEpisode(ep); });
        box.appendChild(b);
      });
      panel.appendChild(box);
      setTimeout(function () { var o = box.querySelector('.on'); if (o && o.scrollIntoView) o.scrollIntoView({ block: 'nearest' }); }, 0);
    }
    function playEpisode(ep) {
      if (!ep || ep.id === item.id) return;
      clearInterval(countdownTimer); nextCard.style.display = 'none';
      saveProgress(true);
      if (scrobbled) scrobble('stop');
      stopEngine(false);
      item = B.player.episodeItem(ep, ctx.series);
      watchedSeconds = 0; recorded = false; attempts = 0;
      var p = D.progress(ep.id);
      start(p && p.fraction < 0.95 ? p.position : 0);
    }

    // 9: Slaaptimer (na deze aflevering/dit programma, 30/60/90 minuten, uit); bij het einde pauzeren en stream_stop
    function sleepEndLabel() {
      if (item.type === 'episode') return L('After this episode');
      if (isCatchup() || (isLive() && item.channel && Lib.nowNext(item.channel).now)) return L('After this programme');
      return null;
    }
    function sleepPanel() {
      panel.appendChild(panelHead(L('Sleep timer')));
      var body = h('div.pl-panel-body');
      var left = h('p.pl-sleep-left', { 'aria-live': 'polite' });
      body.appendChild(left);
      P173.SLEEP_CHOICES.forEach(function (c) {
        var label = c === 'end' ? sleepEndLabel() : c === 'off' ? L('Off') : L('%d minutes', c);
        if (!label) return;
        var on = c === 'off' ? !sleep.choice : sleep.choice === c;
        body.appendChild(opt(label, null, on, function () { setSleep(c); }));
      });
      panel.appendChild(body);
      drawSleepLeft();
    }
    function setSleep(c) {
      if (c === 'off' || c == null) sleep = { choice: null, deadline: null };
      else {
        var pe = isLive() && item.channel ? (Lib.nowNext(item.channel).now || {}).end : null;
        sleep = { choice: c, deadline: P173.sleepDeadline(c, Date.now(), pe) };
      }
      var sb = rightBtns.querySelector('.pl-sleepbtn');
      if (sb) sb.classList.toggle('on', !!sleep.choice);
      drawPanel();
    }
    function sleepText() {
      if (!sleep.choice) return '';
      if (sleep.deadline != null) return L('Stops in %@', P173.countdown(sleep.deadline - Date.now()));
      return item.type === 'episode' ? L('Stops after this episode') : L('Stops after this programme');
    }
    function drawSleepLeft() {
      var el = panel.querySelector('.pl-sleep-left');
      if (el) el.textContent = sleepText();
      var sb = rightBtns.querySelector('.pl-sleepbtn');
      if (sb) sb.title = L('Sleep timer') + (sleep.choice ? ' · ' + sleepText() : '');
    }
    /** true = de slaaptimer stopt het afspelen nu (titleEnded: de aflevering/film/het programma is afgelopen). */
    function sleepCheck(titleEnded) {
      if (!sleep.choice || pausedOut || closed) return false;
      if (!P173.sleepDue(sleep.choice, sleep.deadline, Date.now(), titleEnded)) return false;
      var resumeNext = titleEnded && item.type === 'episode' && nextEpisode();
      sleep = { choice: null, deadline: null };
      closePanel();
      pauseOut(null, { text: L('Sleep timer: stopped'), label: L('Continue watching'), resume: resumeNext ? function () { playNext(); } : null });
      return true;
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
    function inRecap(t) { return !!recapSeg && t >= recapSeg.start && t < recapSeg.end - 1; }
    function skipIntro() {
      if (!engine) return;
      var t = engine.time();
      // build 179: in de samenvatting = naar het einde daarvan; anders naar het einde van de intro
      if (inRecap(t)) { engine.seek(recapSeg.end); skipBtn.style.display = 'none'; return; }
      if (marker) { engine.seek(marker.introEnd); skipBtn.style.display = 'none'; }
    }
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
      // build 176: automatisch volgende aflevering per profiel (uit = de knop blijft, maar telt niet af); Kijk je nog? gaat voor
      var X176 = B.b176, prof = B.app && B.app.profile;
      var auto = !X176 || X176.autoplayStarts(D.autoplayNext ? D.autoplayNext() : null, !!(prof && prof.kids),
        !!(still && stillOn() && still.shouldAsk(Date.now(), stillHours(), true)));
      var playB = U.button(L('Next episode'), function () { playNext(); }, { primary: true, icon: 'play' });
      var dismiss = U.button('', function () { nextDismissed = true; clearInterval(countdownTimer); nextCard.style.display = 'none'; }, { icon: 'close', cls: 'pl-ib pl-next-x', title: L('Close') });
      nextCard.appendChild(h('div.pl-next-still', [U.img(nx.still || item.artwork, 'still')]));
      nextCard.appendChild(h('div.pl-next-info', [h('div.muted.small', L('Next episode')), h('div.pl-next-title', 'S' + nx.season + ':E' + nx.number + ' ' + B.showName(nx.title)),
        auto ? h('div.muted.small', [L('Starts in'), ' ', count, ' s']) : null, h('div.pl-next-btns', [playB])]));
      nextCard.appendChild(dismiss);
      nextCard.style.display = 'flex';
      if (!auto) return;
      countdownTimer = setInterval(function () {
        if (engine && !engine.playing && !engine.v.ended) return;
        left--;
        count.textContent = String(left);
        // build 173: slaaptimer "Na deze aflevering": niet vanzelf door naar de volgende
        if (left <= 0) { clearInterval(countdownTimer); if (sleepCheck(true)) return; playNext(); }
      }, 1000);
    }
    function playNext() {
      var nx = nextEpisode();
      clearInterval(countdownTimer);
      if (!nx) { close(); return; }
      // build 171: automatisch of met Volgende aflevering gestart (telt voor "Kijk je nog?")
      if (still) still.autoEpisode(Date.now());
      saveProgress(true);
      if (scrobbled) scrobble('stop');
      stopEngine(false);
      item = B.player.episodeItem(nx, ctx.series);
      watchedSeconds = 0; recorded = false; attempts = 0;
      var p = D.progress(nx.id);
      start(p ? p.position : 0);
    }
    function onEnded() {
      // build 179 (X2): een live stream die de server afsluit (vaak na ±30 s of een minuut) = opnieuw verbinden, niet sluiten
      if (isLive() && !isCatchup()) { logStop('serverClosed'); if (reconnectLive()) return; logStop('gaveUp'); }
      saveProgress(true, true);
      if (!isLive() && !isCatchup() && engine && !stopSent) { stopSent = true; B.trakt.scrobble('stop', item, 1).catch(B.noop); }
      // build 173 (#9): slaaptimer "Na deze aflevering / dit programma"
      if (sleepCheck(true)) return;
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
        // build 167: 403 activation_required: niet afspelen, speler dicht en het scherm Activeer Lifetime
        if (r.activation) { limited = true; close(); if (B.lifetime) B.lifetime.required(); return false; }
        clearInterval(pingTimer);
        pingTimer = setInterval(function () {
          if (closed) { clearInterval(pingTimer); return; }
          A.streamPing(streamTitle()).then(function (alive) {
            // build 171: gestopt vanaf een ander apparaat: niet vanzelf opnieuw starten, maar het scherm Gepauzeerd
            if (alive === false && !closed && A.lastStop && A.lastStop.remote) { var by = A.lastStop.by; A.lastStop = null; clearInterval(pingTimer); pauseOut(by); return; }
            if (alive === false && !closed) A.streamStart(profile.id, profile.name, streamTitle(), isCatchup() ? 'live' : item.type, item.id, streamExtra()).then(function (r2) {
              if (r2.limit && !closed) { stopEngine(false); showLimit(r2); }
              else if (r2.activation && !closed) { close(); if (B.lifetime) B.lifetime.required(); }
            });
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
      // build 171 (#31): wie kijkt wat op welk apparaat, laatst actief, en per stream "Stoppen op dat apparaat";
      // daarna gaat het afspelen hier meteen verder (zonder opnieuw te tikken)
      var list = h('div.limit-list');
      r.streams.forEach(function (s) {
        var when = X171 && s.lastSeen ? X171.relTime(s.lastSeen, Date.now(), L) : '';
        var info = h('div.limit-info', [h('div', s.deviceName + (s.current ? ' · ' + L('This device') : '')),
          h('div.muted.small', [s.profileName, s.title].filter(Boolean).join(' · ')), when ? h('div.muted.small', L('Active %@', when)) : null]);
        var stopB = null;
        if (r.stopRemote && !s.current) {
          stopB = U.button(L('Stop on that device'), function () {
            stopB.disabled = true;
            A.streamStopOn(s.deviceId).then(function () { if (closed) return; errorBox.style.display = 'none'; limited = false; start(ctx.resume || 0); },
              function (e) { stopB.disabled = false; U.toast(e.message); });
          }, { cls: 'small' });
        }
        list.appendChild(h('div.limit-row', [B.screens.platformIcon(s.platform), info, stopB]));
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
        setTimeout(function () { zapBanner.style.display = 'none'; }, 2000);
        tuneTo(c);
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
      // build 173: paneel open: Esc sluit het, pijltjes lopen door de knoppen van het paneel (niet zappen of spoelen)
      if (panelKind) {
        if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); closePanel(); return; }
        if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
          var all = Array.prototype.filter.call(panel.querySelectorAll('button:not([disabled])'), function (x) { return x.getClientRects().length > 0; });
          if (all.length) {
            e.preventDefault();
            var i = all.indexOf(document.activeElement), dn = k === 'ArrowDown' || k === 'ArrowRight';
            var nx = all[i < 0 ? 0 : B.clamp(i + (dn ? 1 : -1), 0, all.length - 1)];
            try { nx.focus({ preventScroll: false }); } catch (x) { /* stil */ }
          }
          return;
        }
        if (t && panel.contains(t) && (k === ' ' || k === 'Enter')) return;
      }
      if (k === 'a' || k === 'A') { e.preventDefault(); togglePanel('av'); return; }
      if ((k === 'z' || k === 'Z') && (isLive() || isCatchup()) && zapChannels().length > 1) { e.preventDefault(); togglePanel('zap'); return; }
      if ((k === 'r' || k === 'R') && isLive() && previousChannel()) { e.preventDefault(); goPrevious(); return; }
      if ((k === 'e' || k === 'E') && item.type === 'episode' && (ctx.episodes || []).length > 1) { e.preventDefault(); togglePanel('episodes'); return; }
      if (k === ' ' || k === 'k' || k === 'K' || k === 'MediaPlayPause') {
        if (t && t.tagName === 'BUTTON' && k === ' ') return;
        e.preventDefault(); togglePlay(); return;
      }
      // build 169: toetsenbordfocus op de tijdbalk: Home = begin, End = eind (←/→ hieronder: 10 s)
      if ((k === 'Home' || k === 'End') && t === bar) {
        e.preventDefault();
        var to = !isLive() && engine ? B.scrubKey(k, engine.duration()) : null;
        if (to != null) { engine.seek(to); if (extCues) renderExtSub(); updateTime(); }
        showControls();
        return;
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
      stillCheck();
      // build 173: slaaptimer (minuten of einde van het live programma) en ondertitels na terugspoelen
      if (sleepCheck(false)) return;
      rewindCheck();
      updateTime();
      if (engine.playing) {
        watchedSeconds += 1;
        // build 164: stilstaand beeld voor de tv-gids (na 10 s en daarna elke 5 min)
        if (isLive() && item.channel && B.guideStills && watchedSeconds % 300 === 10) B.guideStills.grab(video, item.channel);
        recordHistory();
        saveProgress(false);
      }
      if (isLive() && Date.now() % 30000 < 1000) renderTitleOnly();
      if (!isLive()) {
        var t = engine.time(), d = engine.duration();
        var recap = inRecap(t), intro = recap || inIntro(t);
        if (intro) { var sl = recap ? L('Skip recap') : L('Skip intro'), sp = skipBtn.querySelector('span'); if (sp && sp.textContent !== sl) sp.textContent = sl; }
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
      clearInterval(tickTimer); clearInterval(pingTimer); clearInterval(countdownTimer); clearInterval(extTimer); clearInterval(stillTimer);
      clearTimeout(hideTimer); clearTimeout(zapTimer); clearTimeout(tapTimer); clearTimeout(tapFxTimer); clearInterval(panelTimer);
      if (scrobbled && !stopSent) scrobble('stop');
      if (isLive() && item.channel && B.guideStills && engine && engine.started && engine.v === localVideo) B.guideStills.grab(video, item.channel);
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
    applySubStyle();
    // build 164: vanuit het live voorbeeld (knop Volledig scherm): meteen volledig scherm, nog binnen de klik
    if (ctx.fullscreen) { ctx.fullscreen = false; toggleFullscreen(); }
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
  // build 164: het live voorbeeld in de tv-gids gebruikt dezelfde engine (zelfde formaten, proxy en terugval)
  B.player.Engine = Engine;
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
  /**
   * Build 173 (#2): een programma openen dat al bezig is (Sport, Nu live, herinnering): met terugkijken eerst de vraag
   * "Vanaf het begin" of "Live kijken"; zonder terugkijken (of net begonnen/bijna afgelopen) direct live.
   * opts: {program (anders wat er nu op de zender is), live: function (eigen manier om live te openen), beforeCatchup}.
   */
  B.player.playLive = function (ch, list, opts) {
    opts = opts || {};
    var P173 = B.p173, now = Date.now();
    var p = opts.program || Lib.nowNext(ch).now;
    var live = function () { if (opts.live) opts.live(); else B.player.playChannel(ch, list); };
    if (!p || !P173 || !P173.askStartOver(Lib.canCatchup(ch, p), p.start, p.end, now)) { live(); return null; }
    return U.modal({ title: L('This programme has already started'),
      text: B.showName(p.title) + ' · ' + B.fmtTime(p.start) + '–' + B.fmtTime(p.end) + ' · ' + B.chanName(ch.name),
      cls: 'pl-ask',
      buttons: [
        { label: L('From the start'), icon: 'replay', primary: true, fn: function () { if (opts.beforeCatchup) opts.beforeCatchup(); B.player.playCatchup(ch, p, list); } },
        { label: L('Watch live'), icon: 'play', primary: false, fn: live }
      ] });
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
