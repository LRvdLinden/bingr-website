/*
 * Bingr web: service worker voor pushmeldingen (Web Push met VAPID, contract docs/PUSH.md van iptv-ios-appletv).
 * Scope /web/. Doet push, notificationclick en pushsubscriptionchange, en (build 179) alleen voor de route __dav/ een
 * fetch-handler: video van een WebDAV-bron met de inlog als Authorization-kop (een <video> kan die zelf niet sturen).
 * Verder geen fetch-afhandeling en geen cache, zodat de webspeler gewoon via het netwerk laadt en de ?v=-aanpak in
 * web/index.html blijft werken.
 * Geen scripts van derden.
 */
'use strict';

var ORIGIN = self.location.origin;
var WEB = new URL('./', self.location.href).href; // https://bingr.online/web/
var ICON = new URL('../apple-touch-icon.png', self.location.href).href;
var BADGE = new URL('badge.png', self.location.href).href;

// nieuwe versie meteen actief (er is niets te cachen, dus niets om op te wachten)
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

/** Payload van de server: {title, body, data:{kind, url, deeplink, msg_id}}; ook lenig voor {notification:{…}} of los. */
function parse(event) {
  var j = null;
  try { j = event.data ? event.data.json() : null; } catch (e) {
    try { j = { body: event.data ? event.data.text() : '' }; } catch (x) { j = null; }
  }
  j = j || {};
  var n = j.notification || j.aps && j.aps.alert || {};
  var data = (j.data && typeof j.data === 'object') ? j.data : {};
  var out = {};
  Object.keys(data).forEach(function (k) { out[k] = data[k]; });
  ['kind', 'url', 'deeplink', 'msg_id'].forEach(function (k) { if (out[k] == null && j[k] != null) out[k] = j[k]; });
  return {
    title: String(j.title || n.title || 'Bingr'),
    body: String(j.body != null ? j.body : (n.body || '')),
    data: out
  };
}

self.addEventListener('push', function (event) {
  var p = parse(event);
  var opts = { body: p.body, icon: ICON, badge: BADGE, data: p.data, lang: p.data.lang || undefined };
  // zelfde msg_id twee keer = één melding (de tweede vervangt de eerste stil)
  if (p.data.msg_id != null && p.data.msg_id !== '') opts.tag = String(p.data.msg_id);
  event.waitUntil(self.registration.showNotification(p.title, opts));
});

/** Query van een bingr://-deeplink (bingr://live?channel=…&profile=…). */
function deeplinkQuery(d) {
  var q = {};
  var s = String(d || '');
  var i = s.indexOf('?');
  if (i < 0) return q;
  s.slice(i + 1).split('#')[0].split('&').forEach(function (kv) {
    if (!kv) return;
    var parts = kv.split('=');
    try { q[decodeURIComponent(parts[0])] = decodeURIComponent((parts.slice(1).join('=') || '').replace(/\+/g, ' ')); } catch (e) { /* stil */ }
  });
  return q;
}
function safeHttps(u) {
  if (u == null || u === '') return null;
  try { var x = new URL(String(u), WEB); return x.protocol === 'https:' || x.origin === ORIGIN ? x.href : null; } catch (e) { return null; }
}

/**
 * Build 176: titel-link uit build 120 (bingr://title?type=<movie|tv>&id=<tmdb-id>&q=<titel>), o.a. de herinnering op de
 * releasedatum (Binnenkort): query voor de route #/titel van de webspeler (titlelink.js), of null.
 */
function titleQuery(deeplink, q) {
  if (!/^bingr:\/\/title(?:[/?#]|$)/i.test(String(deeplink || ''))) return null;
  var type = q.type === 'tv' || q.type === 'series' ? 'tv' : q.type === 'movie' ? 'movie' : null;
  var id = /^[1-9]\d{0,9}$/.test(q.id || '') ? q.id : '';
  var t = String(q.q || '').slice(0, 200), y = /^\d{4}$/.test(q.y || '') ? q.y : '';
  if (!type || (!id && !t)) return null;
  return 'type=' + type + (id ? '&id=' + id : '') + (t ? '&q=' + encodeURIComponent(t) : '') + (y ? '&y=' + y : '');
}

/** Waar een tik naartoe gaat: {url, reminder?, support?, title?}. */
function target(data) {
  data = data || {};
  var kind = String(data.kind || '');
  var q = deeplinkQuery(data.deeplink);
  // build 176: titel-link (ook bij kind "release" of "reminder"): de detailpagina via #/titel
  var tq = titleQuery(data.deeplink, q);
  if (tq) return { url: WEB + '#/titel?' + tq, title: tq };
  if (kind === 'release') {
    // changelog van precies die build, gefilterd op de webspeler
    var b = q.b || q.build || data.build;
    if (b) return { url: ORIGIN + '/changelog/?p=web#build-' + encodeURIComponent(String(b)) };
    return { url: safeHttps(data.url) || ORIGIN + '/changelog/?p=web' };
  }
  if (kind === 'reminder') {
    var ch = q.channel || data.channel || '';
    var prof = q.profile || data.profile || '';
    if (ch) {
      return { url: WEB + '#/live?channel=' + encodeURIComponent(ch) + (prof ? '&profile=' + encodeURIComponent(prof) : ''),
        reminder: { channel: String(ch), profile: String(prof) } };
    }
    return { url: WEB };
  }
  if (kind === 'support_reply') {
    // build 146: antwoord van support → data.url (https://bingr.online/web/#/support/ticket?n=<nummer>); zonder bruikbare
    // url het ticket in de webspeler (nummer uit data.ticket of de deeplink bingr://support/ticket?n=…)
    var n = String(data.ticket || q.n || '').replace(/[^0-9]/g, '');
    var u = safeHttps(data.url);
    if (!u || u.indexOf(WEB) !== 0) u = WEB + '#/support' + (n ? '/ticket?n=' + n : '');
    return { url: u, support: { n: n } };
  }
  // admin (en alles onbekends): de link van het beheer, anders de webspeler
  return { url: safeHttps(data.url) || WEB };
}

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var t = target(event.notification.data);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    var web = list.filter(function (c) { return c.url.indexOf(WEB) === 0; });
    // herinnering en de webspeler zelf: een open tabblad van /web gebruiken (zender openen via een bericht)
    if (t.url.indexOf(WEB) === 0 && web.length) {
      var c = web[0];
      if (t.reminder) c.postMessage({ type: 'bingr-push-open', reminder: t.reminder });
      if (t.support) c.postMessage({ type: 'bingr-push-open', support: t.support });
      if (t.title) c.postMessage({ type: 'bingr-push-open', title: t.title });
      return c.focus ? c.focus() : c;
    }
    // zelfde pagina al open (bijv. de changelog): die naar voren halen
    for (var i = 0; i < list.length; i++) {
      if (list[i].url === t.url && list[i].focus) return list[i].focus();
    }
    return self.clients.openWindow ? self.clients.openWindow(t.url) : null;
  }));
});

/**
 * Abonnement vernieuwd of verlopen (browser): opnieuw abonneren met dezelfde VAPID-sleutel en de webspeler laten
 * weten dat hij opnieuw moet registreren. De service worker heeft geen sessie; de pagina registreert bij `push`
 * (meteen als er een tabblad open is, anders bij de volgende start: die vergelijkt de token met de geregistreerde).
 */
self.addEventListener('pushsubscriptionchange', function (event) {
  var old = event.oldSubscription;
  var key = old && old.options && old.options.applicationServerKey;
  var p = (event.newSubscription ? Promise.resolve(event.newSubscription)
    : key ? self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : Promise.resolve(null))
    .catch(function () { return null; })
    .then(function () { return self.clients.matchAll({ type: 'window', includeUncontrolled: true }); })
    .then(function (list) {
      list.forEach(function (c) { if (c.url.indexOf(WEB) === 0) c.postMessage({ type: 'bingr-push-resubscribe' }); });
    });
  event.waitUntil(p);
});

// MARK: build 179: WebDAV-video met inlog (route __dav/<base64url van het adres>)
// De pagina stuurt {type: 'bingr-dav', base, auth} (alleen in het geheugen van deze worker, nooit bewaard of gelogd).
var DAV = {};
self.addEventListener('message', function (event) {
  var d = event.data;
  if (!d || d.type !== 'bingr-dav' || typeof d.base !== 'string' || typeof d.auth !== 'string') return;
  if (event.source && event.source.url && event.source.url.indexOf(ORIGIN) !== 0) return;
  if (!/^https?:\/\//i.test(d.base) || !/^Basic [A-Za-z0-9+\/=]+$/.test(d.auth)) return;
  DAV[d.base] = d.auth;
});
function davTarget(url) {
  var i = url.indexOf(WEB + '__dav/');
  if (i !== 0) return null;
  var b = url.slice((WEB + '__dav/').length).split(/[?#]/)[0].replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  try { return decodeURIComponent(escape(atob(b))); } catch (e) { return null; }
}
self.addEventListener('fetch', function (event) {
  var target = davTarget(event.request.url);
  if (target == null) return;   // al het andere: gewoon het netwerk, zonder deze worker
  var auth = null;
  Object.keys(DAV).forEach(function (b) { if (target.indexOf(b) === 0) auth = DAV[b]; });
  if (!auth) { event.respondWith(new Response('', { status: 401 })); return; }
  var h = { Authorization: auth };
  var range = event.request.headers.get('Range');
  if (range) h.Range = range;
  event.respondWith(fetch(target, { headers: h, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }));
});
