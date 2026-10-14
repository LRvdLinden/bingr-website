/*
 * Bingr web: diagnose van de speler (build 83). Waarom speelt een film, aflevering of zender niet in de browser?
 * - B.playdiag.probe(url): eerste 64 KB via de proxy (actie "probe"): HTTP-status, content-type, grootte, Range,
 *   doorverwijzingen (alleen hosts) en de eerste bytes;
 * - herkent het formaat aan de eerste bytes (EBML = MKV/WebM, ftyp = MP4, #EXTM3U = HLS, 0x47 = MPEG-TS, HTML) en
 *   leest de codecs (MKV: Tracks/CodecID; MP4: moov/stsd; TS: PMT; HLS: CODECS), en vraagt de browser of hij ze kent
 *   (canPlayType en MediaSource/ManagedMediaSource.isTypeSupported);
 * - maakt er een concrete melding van, en een "Details"-lijst (met ?debug=1 meteen open) met de pogingen in volgorde.
 * Gebruikersnaam en wachtwoord komen nooit in beeld: padsegmenten en query-waarden worden gemaskeerd.
 */
(function () {
  'use strict';
  var B = window.B;
  var L = function () { return B.L.apply(null, arguments); };
  var PD = B.playdiag = {};

  PD.debug = /[?&#]debug=1\b/.test(location.search + location.hash);

  // MARK: maskeren

  var KEEP = /^(movie|movies|series|live|hls|timeshift|vod|play|stream|streams|streaming|video|videos|media|get\.php|player_api\.php|xmltv\.php|index\.m3u8|playlist\.m3u8|mono\.m3u8|master\.m3u8|functions|v1|web-proxy)$/i;
  var KEEPQ = /^(action|extension|output|type|container|format)$/i;
  /** URL zonder inloggegevens: host en bekende woorden blijven, de rest wordt •••; de laatste naam blijft (id.ext). */
  PD.mask = function (u) {
    u = String(u || '');
    if (!u) return '';
    var x;
    try { x = new URL(u, location.href); } catch (e) { return '…'; }
    if (B.isProxied && B.isProxied(u)) {
      var inner = x.searchParams.get('u');
      if (inner) { try { return PD.mask(decodeB64url(inner)) + '  [proxy]'; } catch (e2) { return '[proxy]'; } }
    }
    var segs = x.pathname.split('/');
    var last = segs.length - 1;
    var path = segs.map(function (s, i) {
      if (!s) return s;
      if (i === last) return s.length > 32 && !/\.[a-z0-9]{2,5}$/i.test(s) ? '•••' : s;
      return KEEP.test(s) ? s : '•••';
    }).join('/');
    var q = '';
    if (x.search) {
      q = '?' + x.search.slice(1).split('&').map(function (kv) {
        var k = kv.split('=')[0];
        return KEEPQ.test(k) ? kv : k + '=•••';
      }).join('&');
    }
    return x.protocol + '//' + x.host + path + q;
  };
  function decodeB64url(s) {
    var t = s.replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(t + '==='.slice((t.length + 3) % 4));
    try { return decodeURIComponent(escape(bin)); } catch (e) { return bin; }
  }

  // MARK: browser

  PD.browser = function () {
    var ua = navigator.userAgent, m;
    var iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
    var name = 'Other', ver = '';
    if ((m = /Edg(?:A|iOS)?\/(\d+)/.exec(ua))) { name = 'Edge'; ver = m[1]; }
    else if ((m = /(?:OPR|Opera)\/(\d+)/.exec(ua))) { name = 'Opera'; ver = m[1]; }
    else if ((m = /SamsungBrowser\/(\d+)/.exec(ua))) { name = 'Samsung Internet'; ver = m[1]; }
    else if ((m = /(?:Firefox|FxiOS)\/(\d+)/.exec(ua))) { name = 'Firefox'; ver = m[1]; }
    else if ((m = /(?:Chrome|CriOS)\/(\d+)/.exec(ua))) { name = 'Chrome'; ver = m[1]; }
    else if ((m = /Version\/(\d+(?:\.\d+)?).*Safari/.exec(ua))) { name = 'Safari'; ver = m[1]; }
    var os = iOS ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
    var osv = iOS && (m = /OS (\d+)[_.](\d+)/.exec(ua)) ? m[1] + '.' + m[2] : '';
    var mse = window.ManagedMediaSource ? 'ManagedMediaSource' : window.MediaSource ? 'MediaSource' : 'none';
    var webkit = iOS || name === 'Safari';
    return { name: name, version: ver, os: os, osVersion: osv, iOS: iOS, webkit: webkit, mse: mse,
      label: name + (ver ? ' ' + ver : '') + (os ? ' · ' + os + (osv ? ' ' + osv : '') : '') + (iOS && name !== 'Safari' ? ' (WebKit)' : '') };
  };

  // MARK: formaat en codecs

  var CODECS = {
    h264: { kind: 'video', label: 'H.264/AVC', mime: 'video/mp4; codecs="avc1.640028"' },
    hevc: { kind: 'video', label: 'HEVC/H.265', mime: 'video/mp4; codecs="hvc1.1.6.L120.90"' },
    av1: { kind: 'video', label: 'AV1', mime: 'video/mp4; codecs="av01.0.08M.08"' },
    vp9: { kind: 'video', label: 'VP9', mime: 'video/webm; codecs="vp9"' },
    vp8: { kind: 'video', label: 'VP8', mime: 'video/webm; codecs="vp8"' },
    mpeg2: { kind: 'video', label: 'MPEG-2', mime: 'video/mp4; codecs="mp4v.61"' },
    mpeg4: { kind: 'video', label: 'MPEG-4/DivX/Xvid', mime: 'video/mp4; codecs="mp4v.20.9"' },
    vc1: { kind: 'video', label: 'VC-1', mime: 'video/mp4; codecs="vc-1"' },
    aac: { kind: 'audio', label: 'AAC', mime: 'audio/mp4; codecs="mp4a.40.2"' },
    mp3: { kind: 'audio', label: 'MP3', mime: 'audio/mpeg' },
    mp2: { kind: 'audio', label: 'MP2', mime: 'audio/mp4; codecs="mp4a.6B"' },
    ac3: { kind: 'audio', label: 'AC3/Dolby Digital', mime: 'audio/mp4; codecs="ac-3"' },
    eac3: { kind: 'audio', label: 'E-AC3/Dolby Digital Plus', mime: 'audio/mp4; codecs="ec-3"' },
    dts: { kind: 'audio', label: 'DTS', mime: 'audio/mp4; codecs="dtsc"' },
    truehd: { kind: 'audio', label: 'Dolby TrueHD', mime: 'audio/mp4; codecs="mlpa"' },
    opus: { kind: 'audio', label: 'Opus', mime: 'audio/webm; codecs="opus"' },
    vorbis: { kind: 'audio', label: 'Vorbis', mime: 'audio/webm; codecs="vorbis"' },
    flac: { kind: 'audio', label: 'FLAC', mime: 'audio/mp4; codecs="flac"' },
    pcm: { kind: 'audio', label: 'PCM', mime: 'audio/wav' }
  };
  PD.CODECS = CODECS;
  function mkvCodec(id) {
    id = String(id || '');
    if (/^V_MPEG4\/ISO\/AVC/.test(id)) return 'h264';
    if (/^V_MPEGH\/ISO\/HEVC/.test(id)) return 'hevc';
    if (id === 'V_AV1') return 'av1';
    if (id === 'V_VP9') return 'vp9';
    if (id === 'V_VP8') return 'vp8';
    if (/^V_MPEG2/.test(id) || id === 'V_MPEG1') return 'mpeg2';
    if (/^V_MPEG4\/ISO\/(ASP|SP|AP)/.test(id) || /^V_MS\/VFW/.test(id)) return 'mpeg4';
    if (/^A_AAC/.test(id)) return 'aac';
    if (id === 'A_MPEG/L3') return 'mp3';
    if (id === 'A_MPEG/L2') return 'mp2';
    if (id === 'A_AC3' || id === 'A_AC3/BSID9' || id === 'A_AC3/BSID10') return 'ac3';
    if (id === 'A_EAC3') return 'eac3';
    if (/^A_DTS/.test(id)) return 'dts';
    if (id === 'A_TRUEHD' || id === 'A_MLP') return 'truehd';
    if (id === 'A_OPUS') return 'opus';
    if (id === 'A_VORBIS') return 'vorbis';
    if (id === 'A_FLAC') return 'flac';
    if (/^A_PCM/.test(id)) return 'pcm';
    return null;
  }

  /** Handtekening van de eerste bytes. */
  PD.sniff = function (b, ctype) {
    ctype = String(ctype || '').toLowerCase();
    if (!b || !b.length) return { sig: '', container: '' };
    var head = '';
    for (var i = 0; i < Math.min(b.length, 512); i++) head += String.fromCharCode(b[i]);
    var txt = head.replace(/^﻿|^ï»¿/, '').replace(/^\s+/, '');
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { sig: 'EBML', container: /webm/.test(head) ? 'WebM' : 'MKV' };
    if (b.length >= 8 && head.slice(4, 8) === 'ftyp') return { sig: 'ftyp', container: /^(qt  )/.test(head.slice(8, 12)) ? 'MOV' : 'MP4' };
    if (b.length >= 8 && /^(moov|mdat|free|skip|wide)$/.test(head.slice(4, 8))) return { sig: head.slice(4, 8), container: 'MP4' };
    if (txt.indexOf('#EXTM3U') === 0) return { sig: '#EXTM3U', container: /#EXT-X-/.test(txt + latin(b, 512, 4096)) ? 'HLS' : 'M3U' };
    if (b[0] === 0x47 && (b.length < 189 || b[188] === 0x47)) return { sig: 'TS (0x47)', container: 'MPEG-TS' };
    if (head.slice(0, 4) === 'RIFF' && head.slice(8, 11) === 'AVI') return { sig: 'RIFF', container: 'AVI' };
    if (head.slice(0, 3) === 'FLV') return { sig: 'FLV', container: 'FLV' };
    if (b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75) return { sig: 'ASF', container: 'WMV' };
    if (/^(<!doctype|<html|<head|<body|<\?xml|<)/i.test(txt) || /html/.test(ctype)) return { sig: 'HTML', container: 'HTML' };
    if (/^[{[]/.test(txt) || /json/.test(ctype)) return { sig: 'JSON', container: 'JSON' };
    if (head.slice(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { sig: 'MPEG audio', container: 'MP3' };
    return { sig: hex(b, 8), container: '' };
  };
  function latin(b, from, to) { var s = ''; for (var i = from; i < Math.min(b.length, to); i++) s += String.fromCharCode(b[i]); return s; }
  function hex(b, n) { var s = []; for (var i = 0; i < Math.min(b.length, n); i++) s.push((b[i] < 16 ? '0' : '') + b[i].toString(16)); return s.join(' '); }

  // EBML (Matroska/WebM): Segment → Tracks → TrackEntry → CodecID/TrackType/Language/Video/Audio
  function vint(b, p, keepMarker) {
    var first = b[p];
    if (first === undefined) return null;
    var len = 1, mask = 0x80;
    while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
    if (len > 8 || p + len > b.length) return null;
    var v = keepMarker ? first : first & (mask - 1), allOnes = (first & (mask - 1)) === mask - 1;
    for (var i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) allOnes = false; }
    return { v: v, len: len, unknown: !keepMarker && allOnes };
  }
  function parseMKV(b) {
    var out = { tracks: [], docType: '' };
    var MASTER = { 0x18538067: 1, 0x1654ae6b: 1, 0xae: 1, 0xe0: 1, 0xe1: 1, 0x1a45dfa3: 1 };
    var cur = null;
    function walk(p, end, depth) {
      while (p < end && p < b.length) {
        var id = vint(b, p, true); if (!id) return false;
        var sz = vint(b, p + id.len, false); if (!sz) return false;
        var data = p + id.len + sz.len;
        var stop = sz.unknown ? b.length : Math.min(b.length, data + sz.v);
        if (id.v === 0x1f43b675) return true; // Cluster: de sporen komen daarvoor
        if (MASTER[id.v]) {
          if (id.v === 0xae) { cur = { type: 0, codecId: '', lang: '' }; out.tracks.push(cur); }
          if (walk(data, stop, depth + 1)) return true;
        } else if (!sz.unknown && data + sz.v <= b.length) {
          var str = function () { var s = ''; for (var i = data; i < data + sz.v; i++) { if (!b[i]) break; s += String.fromCharCode(b[i]); } return s; };
          var uint = function () { var n = 0; for (var i = data; i < data + sz.v; i++) n = n * 256 + b[i]; return n; };
          if (id.v === 0x4282) out.docType = str();
          else if (cur && id.v === 0x86) cur.codecId = str();
          else if (cur && id.v === 0x83) cur.type = uint();
          else if (cur && (id.v === 0x22b59c || id.v === 0x22b59d)) cur.lang = cur.lang || str();
          else if (cur && id.v === 0xb0) cur.width = uint();
          else if (cur && id.v === 0xba) cur.height = uint();
          else if (cur && id.v === 0x9f) cur.channels = uint();
        } else if (sz.unknown) return false;
        p = stop;
      }
      return false;
    }
    walk(0, b.length, 0);
    out.tracks = out.tracks.filter(function (t) { return t.codecId; }).map(function (t) {
      var c = mkvCodec(t.codecId);
      return { kind: t.type === 1 ? 'video' : t.type === 2 ? 'audio' : t.type === 0x11 ? 'text' : (c ? CODECS[c].kind : 'other'), codec: c, raw: t.codecId,
        lang: t.lang || '', width: t.width || null, height: t.height || null, channels: t.channels || null };
    });
    return out;
  }
  // MP4: moov → trak → mdia → hdlr (soort) en minf → stbl → stsd (eerste sample entry = codec)
  var FOURCC = { avc1: 'h264', avc3: 'h264', hvc1: 'hevc', hev1: 'hevc', dvh1: 'hevc', dvhe: 'hevc', av01: 'av1', vp09: 'vp9', mp4v: 'mpeg4',
    mp4a: 'aac', 'ac-3': 'ac3', 'ec-3': 'eac3', dtsc: 'dts', dtsh: 'dts', dtsl: 'dts', dtse: 'dts', Opus: 'opus', fLaC: 'flac', '.mp3': 'mp3', mlpa: 'truehd' };
  function parseMP4(b) {
    var out = { tracks: [], moov: false };
    function u32(p) { return ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]; }
    function type(p) { return String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]); }
    function boxes(p, end, fn) {
      while (p + 8 <= end) {
        var size = u32(p), t = type(p + 4), hdr = 8;
        if (size === 1) { size = u32(p + 12) + u32(p + 8) * 4294967296; hdr = 16; }
        else if (size === 0) size = end - p;
        if (size < hdr) return;
        fn(t, p + hdr, Math.min(end, p + size), p + size > b.length);
        p += size;
      }
    }
    boxes(0, b.length, function (t, s, e) {
      if (t !== 'moov') return;
      out.moov = true;
      boxes(s, e, function (t2, s2, e2) {
        if (t2 !== 'trak') return;
        var tr = { kind: 'other', codec: null, raw: '' };
        boxes(s2, e2, function (t3, s3, e3) {
          if (t3 !== 'mdia') return;
          boxes(s3, e3, function (t4, s4, e4) {
            if (t4 === 'hdlr' && s4 + 12 <= b.length) { var hd = type(s4 + 8); tr.kind = hd === 'vide' ? 'video' : hd === 'soun' ? 'audio' : /subt|text|sbtl/.test(hd) ? 'text' : 'other'; }
            if (t4 !== 'minf') return;
            boxes(s4, e4, function (t5, s5, e5) {
              if (t5 !== 'stbl') return;
              boxes(s5, e5, function (t6, s6) {
                if (t6 === 'stsd' && s6 + 16 <= b.length) { tr.raw = type(s6 + 12); tr.codec = FOURCC[tr.raw] || null; }
              });
            });
          });
        });
        if (tr.raw) out.tracks.push(tr);
      });
    });
    return out;
  }
  // MPEG-TS: PAT → PMT → stream_type
  var TSTYPE = { 0x1b: 'h264', 0x24: 'hevc', 0x02: 'mpeg2', 0x01: 'mpeg2', 0x10: 'mpeg4', 0x0f: 'aac', 0x11: 'aac', 0x03: 'mp3', 0x04: 'mp2', 0x81: 'ac3', 0x87: 'eac3', 0x82: 'dts', 0x85: 'dts', 0x8a: 'dts' };
  function parseTS(b) {
    var out = { tracks: [] }, pmt = -1;
    for (var p = 0; p + 188 <= b.length; p += 188) {
      if (b[p] !== 0x47) break;
      var pid = ((b[p + 1] & 0x1f) << 8) | b[p + 2], pusi = b[p + 1] & 0x40, afc = (b[p + 3] >> 4) & 3;
      if (!pusi) continue;
      var q = p + 4 + (afc & 2 ? 1 + b[p + 4] : 0);
      q += 1 + b[q]; // pointer_field
      if (pid === 0 && pmt < 0) { pmt = ((b[q + 10] & 0x1f) << 8) | b[q + 11]; continue; }
      if (pid === pmt && b[q] === 0x02) {
        var secLen = ((b[q + 1] & 0x0f) << 8) | b[q + 2], end = Math.min(q + 3 + secLen - 4, p + 188);
        var r = q + 12 + (((b[q + 10] & 0x0f) << 8) | b[q + 11]);
        while (r + 5 <= end) {
          var st = b[r], esLen = ((b[r + 3] & 0x0f) << 8) | b[r + 4], c = TSTYPE[st] || null;
          if (st === 0x06) { // privé: AC3/E-AC3/DTS staan in een descriptor
            for (var d = r + 5; d + 2 <= r + 5 + esLen; d += 2 + b[d + 1]) { if (b[d] === 0x6a) c = 'ac3'; else if (b[d] === 0x7a) c = 'eac3'; else if (b[d] === 0x7b) c = 'dts'; }
          }
          out.tracks.push({ kind: c ? CODECS[c].kind : (st === 0x06 ? 'other' : 'other'), codec: c, raw: '0x' + st.toString(16) });
          r += 5 + esLen;
        }
        break;
      }
    }
    return out;
  }
  // HLS: master (STREAM-INF met CODECS) of mediaplaylist (eerste segment)
  PD.parseHls = function (text) {
    text = String(text || '');
    var lines = text.split(/\r?\n/), out = { master: /#EXT-X-STREAM-INF/.test(text), codecs: '', first: '', segments: 0, vod: /#EXT-X-ENDLIST|#EXT-X-PLAYLIST-TYPE:VOD/.test(text) };
    var m = /CODECS="([^"]+)"/.exec(text);
    if (m) out.codecs = m[1];
    lines.forEach(function (l) { l = l.trim(); if (l && l[0] !== '#') { out.segments++; if (!out.first) out.first = l; } });
    return out;
  };
  function hlsCodecs(list) {
    return String(list || '').split(',').map(function (c) {
      c = c.trim();
      var k = /^avc[13]/.test(c) ? 'h264' : /^(hvc1|hev1|dvh)/.test(c) ? 'hevc' : /^av01/.test(c) ? 'av1' : /^vp09/.test(c) ? 'vp9' : /^mp4a\.40/.test(c) ? 'aac' :
        /^mp4a\.6[9b]/i.test(c) ? 'mp3' : c === 'ac-3' ? 'ac3' : c === 'ec-3' ? 'eac3' : /^dts/.test(c) ? 'dts' : c === 'opus' ? 'opus' : null;
      return c ? { kind: k ? CODECS[k].kind : 'other', codec: k, raw: c } : null;
    }).filter(Boolean);
  }

  /** Codecs uit de eerste bytes (MKV, MP4, TS, HLS). {container, tracks, note} */
  PD.codecs = function (b, sniff) {
    var c = sniff.container, out = { container: c, tracks: [], note: '' };
    try {
      if (c === 'MKV' || c === 'WebM') { var mk = parseMKV(b); out.tracks = mk.tracks; if (!mk.tracks.length) out.note = 'tracks not in first bytes'; }
      else if (c === 'MP4' || c === 'MOV') { var mp = parseMP4(b); out.tracks = mp.tracks; if (!mp.moov) out.note = 'moov (index) not at the start of the file'; }
      else if (c === 'MPEG-TS') out.tracks = parseTS(b).tracks;
      else if (c === 'HLS') { var hp = PD.parseHls(latin(b, 0, b.length)); out.tracks = hlsCodecs(hp.codecs); out.hls = hp; }
    } catch (e) { out.note = 'parse error'; }
    return out;
  };

  /** Kent de browser deze codec? native = <video> (canPlayType), mse = MediaSource/ManagedMediaSource. */
  var probeVideo = null;
  PD.support = function (codec) {
    var c = CODECS[codec];
    if (!c) return { native: false, mse: false, known: false };
    probeVideo = probeVideo || document.createElement('video');
    var native = false, mse = false;
    try { native = !!probeVideo.canPlayType(c.mime); } catch (e) { native = false; }
    var MS = window.ManagedMediaSource || window.MediaSource;
    try { mse = !!(MS && MS.isTypeSupported && MS.isTypeSupported(c.mime)); } catch (e2) { mse = false; }
    return { native: native, mse: mse, known: true, ok: native || mse };
  };

  // MARK: probe via de proxy

  function b64bytes(s) {
    var bin = atob(s || ''), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hostOf(u) { var m = /^https?:\/\/([^\/?#]+)/i.exec(String(u || '')); return m ? m[1].toLowerCase().replace(/^[^@]*@/, '') : ''; }
  /**
   * Eerste 64 KB van url via de proxy. → {status, contentType, size, rangeHonored, redirects, ms, bytes, sniff, error}
   * Een oudere proxy (zonder "probe") geeft het bereik zelf terug; dat werkt ook (range gaat mee als begrenzing).
   */
  PD.probe = function (url, timeout) {
    var A = B.account, t0 = Date.now();
    if (!A || !A.validAccessToken) return Promise.resolve({ error: 'not_signed_in', ms: 0 });
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, timeout || 15000);
    function done(r) { clearTimeout(timer); r.ms = r.ms || (Date.now() - t0); if (r.bytes) { r.sniff = PD.sniff(r.bytes, r.contentType); } return r; }
    return A.validAccessToken().then(function (jwt) {
      return fetch(B.config.supabaseUrl + '/functions/v1/web-proxy', {
        method: 'POST', signal: ctl ? ctl.signal : undefined,
        headers: { 'Authorization': 'Bearer ' + jwt, 'apikey': B.config.supabaseKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'probe', url: url, range: 'bytes=0-65535' })
      });
    }).then(function (res) {
      var ct = (res.headers.get('content-type') || '').toLowerCase();
      if (/application\/json/.test(ct) && !res.headers.get('x-final-url')) {
        return res.json().then(function (j) {
          if (j && j.probe) {
            if (j.error) return done({ error: j.error, ms: j.ms });
            return done({ status: j.status, contentType: j.contentType || '', size: j.size, rangeHonored: !!j.rangeHonored, redirects: j.redirects || [],
              finalProtocol: j.finalProtocol || '', ms: j.ms, bytes: b64bytes(j.head) });
          }
          return done({ error: (j && j.error) || ('proxy_' + res.status), proxyStatus: res.status });
        });
      }
      // oudere proxy: het antwoord van de server zelf
      return res.arrayBuffer().then(function (buf) {
        var fin = res.headers.get('x-final-url') || '';
        return done({ status: res.status, contentType: res.headers.get('content-type') || '', size: null, rangeHonored: res.status === 206,
          redirects: fin && hostOf(fin) !== hostOf(url) ? [hostOf(fin)] : [], bytes: new Uint8Array(buf.slice(0, 65536)) });
      });
    }).catch(function (e) {
      return done({ error: ctl && ctl.signal.aborted ? 'timeout' : 'network', detail: e && e.message });
    });
  };

  /** Is het antwoord van een probe een echte HLS-afspeellijst (en geen film die toevallig .m3u8 heet)? */
  PD.isHls = function (p) {
    if (!p || p.error || !(p.status >= 200 && p.status < 300) || !p.sniff || p.sniff.container !== 'HLS') return false;
    var hp = PD.parseHls(latin(p.bytes, 0, p.bytes.length));
    p.hls = hp;
    if (!hp.segments) return false;
    // een "afspeellijst" met het hele bestand als enige segment (.mkv/.avi) helpt de browser niet
    return !/\.(mkv|avi|wmv|flv)(\?|$)/i.test(hp.first);
  };

  /** Volledige diagnose van een film/aflevering: probe + codecs + ondersteuning. */
  PD.inspect = function (url) {
    if (!/^https?:/i.test(String(url || ''))) return Promise.resolve(null);
    return PD.probe(url, 15000).then(function (p) {
      if (p.bytes && p.sniff) {
        p.media = PD.codecs(p.bytes, p.sniff);
        p.media.tracks.forEach(function (t) { if (t.codec) t.support = PD.support(t.codec); });
      }
      return p;
    });
  };

  // MARK: melding

  function codecList(tracks, kind) {
    return tracks.filter(function (t) { return t.kind === kind && t.codec; }).map(function (t) { return CODECS[t.codec].label; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ');
  }
  function err(msg, extra) { var e = new Error(msg); e.specific = true; for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) e[k] = extra[k]; return e; }

  /**
   * Concrete melding uit de diagnose. rep = {probe, browser, attempts, hlsTried, lastError}. Geeft een Error met
   * .server / .unsupported / .codec / .conn, of null (dan de algemene melding).
   */
  PD.explain = function (rep) {
    var p = rep.probe, br = rep.browser || PD.browser(), last = String((rep.lastError && rep.lastError.message) || '');
    if (!p) return null;
    if (!p.error) {
      var s = p.status;
      if (s === 404 || s === 410) return err(L('The server can’t find this video (error %d). Try again later or watch in the app.', s), { server: s });
      if (s === 458 || s === 509 || s === 429 || (s === 403 && rep.connHint)) return err(L('The server refused because too many streams are open on your IPTV subscription (error %d). Stop playback on other devices, wait a minute and try again.', s), { server: s, conn: true });
      if (s === 401 || s === 403) return err(L('The server refused this video (error %d). Check your subscription, or watch in the app.', s), { server: s });
      if (s >= 400) return err(L('The server isn’t responding to this video right now (error %d). Try again later.', s), { server: s });
      var sn = p.sniff || {}, md = p.media || { tracks: [] };
      if (sn.container === 'HTML' || sn.container === 'JSON' || (!sn.container && /html|json|text\/plain/i.test(p.contentType))) {
        return err(L('The server sent a page instead of a video. Your subscription may have expired, or the server is busy. Try again later or watch in the app.'), { server: s });
      }
      var bad = md.tracks.filter(function (t) { return (t.kind === 'video' || t.kind === 'audio') && t.support && !t.support.ok; });
      var vids = codecList(md.tracks, 'video'), auds = codecList(md.tracks, 'audio');
      var inside = [vids, auds].filter(Boolean).join(' + ');
      var noHls = rep.hlsFound ? ' ' + L('The HLS version from this server didn’t play either.') : rep.hlsTried ? ' ' + L('This server doesn’t offer an HLS version of it either.') : '';
      if ((sn.container === 'MKV') && br.webkit) {
        var good = md.tracks.length && !md.tracks.some(function (t) { return (t.kind === 'video' && t.codec !== 'h264' && t.codec !== 'vp9' && t.codec !== 'av1') || (t.kind === 'audio' && ['aac', 'mp3', 'opus'].indexOf(t.codec) < 0); });
        var tail = good && !br.iOS ? ' ' + L('Chrome, Edge or Firefox on a computer can play this file.') : '';
        return err(L('Safari (and every browser on iPhone and iPad) can’t open MKV files, whatever is inside.') + (inside ? ' ' + L('Inside: %@.', inside) : '') + noHls + ' ' + L('Watch in the Bingr app.') + tail,
          { unsupported: 'mkv', codec: true });
      }
      if (/^(AVI|FLV|WMV)$/.test(sn.container)) return err(L('This format (%@) doesn’t play in the browser. Watch in the app.', sn.container) + noHls, { unsupported: sn.container.toLowerCase(), codec: true });
      if (bad.length) {
        var bv = codecList(bad, 'video'), ba = codecList(bad, 'audio');
        var what = bv && ba ? L('the picture (%@) and the sound (%@)', bv, ba) : bv ? L('the picture (%@)', bv) : L('the sound (%@)', ba);
        return err(L('%@ can’t play %@ of this video (%@).', br.name === 'Other' ? L('Your browser') : br.name, what, sn.container || '?') + noHls + ' ' + L('Watch in the Bingr app.'),
          { unsupported: (sn.container || '').toLowerCase() || 'codec', codec: true });
      }
      if (sn.container === 'MP4' && md.note && /moov/.test(md.note) && !p.rangeHonored && p.size && p.size > 512 * 1024 * 1024) {
        return err(L('This server doesn’t let the browser jump within the file, and the file’s index is at the end. Watch in the Bingr app.'), { server: s, codec: true });
      }
      if (/MEDIA_ERR_2|timeout|hls_(frag|manifest|level)LoadError|hls_.*TimeOut/i.test(last)) {
        return err(L('The connection to the server broke off while loading this video. Many IPTV subscriptions allow one stream at a time: stop playback on other devices (also in the Bingr app) and try again.'), { server: s || 0, conn: true });
      }
      if (/MEDIA_ERR_[34]/.test(last) && sn.container) {
        return err(L('Your browser can’t play the picture or sound of this video (%@). This is often HEVC (H.265) video or AC3/DTS audio. Watch in the Bingr app.', sn.container), { unsupported: sn.container.toLowerCase(), codec: true });
      }
      return null;
    }
    if (p.error === 'timeout') return err(L('The server took too long to answer. It may be busy; try again later.'), { server: 0, conn: true });
    if (p.error === 'host_not_allowed') return err(L('This address isn’t one of your own servers, so Bingr’s server won’t fetch it.'), { server: 403 });
    return null;
  };

  // MARK: details

  function sigLabel(p) {
    if (!p) return '';
    if (p.error) return p.error;
    var parts = ['HTTP ' + p.status], okStatus = p.status >= 200 && p.status < 300;
    if (p.contentType) parts.push(p.contentType.split(';')[0]);
    if (p.sniff && p.sniff.sig) parts.push(p.sniff.sig + (p.sniff.container && p.sniff.container !== p.sniff.sig ? ' = ' + p.sniff.container : ''));
    if (p.size) parts.push(p.size >= 1048576 ? Math.round(p.size / 1048576) + ' MB' : Math.round(p.size / 1024) + ' KB');
    if (okStatus && p.rangeHonored === false) parts.push('no Range');
    if (p.redirects && p.redirects.length) parts.push('→ ' + p.redirects.join(' → '));
    parts.push(p.ms + ' ms');
    return parts.join(' · ');
  }
  PD.sigLabel = sigLabel;

  /** Platte tekst van het rapport (voor kopiëren naar support; zonder inloggegevens). */
  PD.text = function (rep) {
    var out = [];
    var br = rep.browser || PD.browser();
    out.push('Bingr web' + (B.config.build ? ' build ' + B.config.build : '') + ' · ' + br.label + ' · MSE: ' + br.mse);
    if (rep.title) out.push(rep.title);
    if (rep.url) out.push('URL: ' + PD.mask(rep.url));
    (rep.attempts || []).forEach(function (a, i) {
      out.push((i + 1) + '. ' + a.how + (a.via ? ' (' + a.via + ')' : '') + ' — ' + (a.ok ? 'OK' : (a.err || 'fail')) + (a.ms != null ? ' · ' + a.ms + ' ms' : ''));
      if (a.url) out.push('   ' + a.url);
      if (a.media) out.push('   MediaError ' + a.media.code + (a.media.message ? ': ' + a.media.message : ''));
      if (a.probe) out.push('   ' + sigLabel(a.probe));
    });
    var p = rep.probe;
    if (p) {
      out.push('File: ' + sigLabel(p));
      var md = p.media;
      if (md) {
        md.tracks.forEach(function (t) {
          out.push('   ' + t.kind + ': ' + (t.codec ? CODECS[t.codec].label : '?') + ' [' + t.raw + ']' + (t.lang ? ' ' + t.lang : '') +
            (t.width ? ' ' + t.width + 'x' + t.height : '') + (t.support ? ' — ' + (t.support.ok ? 'supported' : 'NOT supported') + ' (video: ' + (t.support.native ? 'yes' : 'no') + ', MSE: ' + (t.support.mse ? 'yes' : 'no') + ')' : ''));
        });
        if (md.note) out.push('   ' + md.note);
      }
    }
    return out.join('\n');
  };

  /** Uitklapbare details onder de foutmelding. */
  PD.panel = function (rep) {
    var h = B.ui.h, U = B.ui;
    var pre = h('pre.pl-diag-text', PD.text(rep));
    var copy = U.button(L('Copy'), function () {
      try { navigator.clipboard.writeText(pre.textContent).then(function () { U.toast(L('Copied')); }, B.noop); } catch (e) { /* stil */ }
    }, { cls: 'pl-diag-copy' });
    var box = h('div.pl-diag', [pre, copy]);
    box.style.display = PD.debug ? '' : 'none';
    var btn = U.button(L('Details'), function () {
      var open = box.style.display === 'none';
      box.style.display = open ? '' : 'none';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }, { cls: 'pl-diag-btn' });
    btn.setAttribute('aria-expanded', PD.debug ? 'true' : 'false');
    return { button: btn, box: box };
  };
})();
