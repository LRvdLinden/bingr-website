/*
 * Bingr web: service worker voor pushmeldingen (Web Push met VAPID, contract docs/PUSH.md van iptv-ios-appletv).
 * Scope /web/. Doet alleen push, notificationclick en pushsubscriptionchange: geen fetch-handler en geen cache,
 * zodat de webspeler gewoon via het netwerk laadt en de ?v=-aanpak in web/index.html blijft werken.
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

/** Waar een tik naartoe gaat: {url, reminder?}. */
function target(data) {
  data = data || {};
  var kind = String(data.kind || '');
  var q = deeplinkQuery(data.deeplink);
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
