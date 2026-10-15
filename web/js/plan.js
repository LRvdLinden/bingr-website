/*
 * Abonnement van het account (Gratis / Lifetime). De server bepaalt wat mag: device-auth `entitlements`
 * (ook als `entitlements` in de antwoorden van `config` en `heartbeat`) →
 *   {plan:'free'|'lifetime', limits:{streams, devices, servers:int|null},
 *    features:{stats, now_watching, trakt, multi_server, themes}, upgrade:{url, link, price, price_en}}
 * Per account bewaard (bingr.web.plan.<user-id>). Weet de browser nog niets en lukt het ophalen niet (netwerkfout,
 * oude backend), dan geldt Lifetime: niemand raakt iets kwijt door een storing. Zegt de server `feature_locked`,
 * dan gaat dat onderdeel wél op slot. Upgraden gebeurt op bingr.online/upgrade/ (nieuw tabblad).
 */
(function () {
  'use strict';
  var B = window.B;
  var A = B.account;
  var L = function () { return B.L.apply(null, arguments); };
  var P = B.plan = {};

  var UPGRADE_URL = 'https://bingr.online/upgrade/';
  var FEATURES = ['stats', 'now_watching', 'trakt', 'multi_server', 'themes'];
  P.FREE = { streams: 2, devices: 8, servers: 1 };
  P.LIFETIME = { streams: 6, devices: 15, servers: null };

  var cur = null;      // laatste antwoord van de server (genormaliseerd), of null
  var curUser = null;

  function key(uid) { return uid ? 'plan.' + uid : null; }
  function posInt(v, def) { var n = B.int(v); return n != null && n > 0 ? n : def; }

  /** Antwoord van de server → vaste vorm; null als het geen geldig abonnement is. */
  P.normalize = function (raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.entitlements && typeof raw.entitlements === 'object' && !raw.plan) raw = raw.entitlements;
    var plan = String(raw.plan || '').toLowerCase();
    if (plan !== 'free' && plan !== 'lifetime') return null;
    var base = plan === 'free' ? P.FREE : P.LIFETIME;
    var lim = raw.limits || {};
    var servers = B.has(lim, 'servers') ? (lim.servers == null ? null : posInt(lim.servers, base.servers)) : base.servers;
    var f = raw.features || {};
    var features = {};
    FEATURES.forEach(function (k) { features[k] = B.has(f, k) ? B.bool(f[k]) === true : plan === 'lifetime'; });
    var up = raw.upgrade || {};
    var url = typeof up.url === 'string' && /^https:\/\//i.test(up.url) ? up.url : UPGRADE_URL;
    return {
      plan: plan,
      limits: { streams: posInt(lim.streams, base.streams), devices: posInt(lim.devices, base.devices), servers: servers },
      features: features,
      upgrade: { url: url, link: up.link == null ? true : B.bool(up.link) === true,
        price: typeof up.price === 'string' && up.price ? up.price : '€ 4,99',
        price_en: typeof up.price_en === 'string' && up.price_en ? up.price_en : '€4.99' },
      at: Date.now()
    };
  };

  function fallback() {
    return { plan: 'lifetime', assumed: true, limits: B.copy(P.LIFETIME),
      features: { stats: true, now_watching: true, trakt: true, multi_server: true, themes: true },
      upgrade: { url: UPGRADE_URL, link: true, price: '€ 4,99', price_en: '€4.99' } };
  }

  /** Cache van het ingelogde account laden (bij inloggen, ander account). */
  P.load = function () {
    var uid = A.userId && A.userId();
    if (uid === curUser && cur) return;
    curUser = uid || null;
    cur = uid ? P.normalize(B.store.get(key(uid), null)) : null;
    if (cur) { var stored = B.store.get(key(uid), null); if (stored && stored.at) cur.at = stored.at; }
  };
  function same(a, b) {
    if (!a || !b) return a === b;
    return JSON.stringify([a.plan, a.limits, a.features, a.upgrade]) === JSON.stringify([b.plan, b.limits, b.features, b.upgrade]);
  }
  /** Nieuw antwoord van de server toepassen (entitlements, of het veld in config/heartbeat). true = geldig. */
  P.apply = function (raw) {
    var n = P.normalize(raw);
    if (!n) return false;
    P.load();
    var before = P.get();
    cur = n;
    var uid = A.userId && A.userId();
    if (uid) B.store.set(key(uid), n);
    if (!same(before, n) || before.assumed) B.emit('plan', n);
    return true;
  };
  /** device-auth `entitlements` ophalen; mislukt het, dan blijft de cache (of Lifetime) staan. */
  var fetching = null;
  P.fetch = function () {
    if (!A.isSignedIn || !A.isSignedIn()) return Promise.resolve(false);
    if (fetching) return fetching;
    fetching = A.authed({ action: 'entitlements', platform: 'web' }).then(function (r) {
      return !!(r && r.ok && r.json && P.apply(r.json));
    }, function () { return false; }).then(function (ok) { fetching = null; return ok; });
    return fetching;
  };

  /** Het abonnement zoals de speler het nu gebruikt (nooit null). */
  P.get = function () {
    P.load();
    return cur || fallback();
  };
  P.isFree = function () { return P.get().plan === 'free'; };
  P.isKnown = function () { return !P.get().assumed; };
  /** Mag dit onderdeel? stats, now_watching, trakt, multi_server, themes. */
  P.has = function (feature) { return P.get().features[feature] !== false; };
  P.limit = function (name) { return P.get().limits[name]; };
  /** Mag er nog een server bij? (bestaande servers blijven altijd bruikbaar) */
  P.canAddServer = function (count) {
    if (P.has('multi_server')) return true;
    var max = P.limit('servers');
    return max == null || count < max;
  };
  P.price = function () { var u = P.get().upgrade; return B.lang === 'nl' ? u.price : u.price_en; };

  /** 403 {error:'feature_locked', feature} van de server? */
  P.isLockedResponse = function (r) {
    if (!r || r.status !== 403) return false;
    var j = r.json || {};
    return r.errorCode === 'feature_locked' || j.error === 'feature_locked' || j.error_code === 'feature_locked';
  };
  /** De server zegt dat dit onderdeel op slot zit: onthouden (tot het volgende antwoord van entitlements) en ophalen. */
  P.markLocked = function (feature) {
    var p = B.copy(P.get());
    if (p.features[feature] === false) return;
    if (p.assumed) { p = B.assign(fallback(), { plan: 'free', limits: B.copy(P.FREE) }); FEATURES.forEach(function (k) { p.features[k] = false; }); }
    p.features[feature] = false;
    delete p.assumed;
    cur = p; cur.at = Date.now();
    var uid = A.userId && A.userId();
    if (uid) B.store.set(key(uid), cur);
    B.emit('plan', cur);
    P.fetch();
  };
  /** Limiet uit een fout (te veel streams/apparaten): {limit, plan} → het abonnement bijwerken als de server het noemt. */
  P.noteLimitError = function (info) {
    if (!info || !info.plan) return;
    var plan = String(info.plan).toLowerCase();
    var p = P.get();
    if ((plan === 'free' || plan === 'lifetime') && (p.assumed || p.plan !== plan)) P.fetch();
  };

  B.on('wipe', function () {
    B.store.keys('plan.').forEach(function (k) { B.store.del(k); });
    cur = null; curUser = null;
  });
  B.on('signedOut', function () { cur = null; curUser = null; });

  // MARK: UI (badge, upgradevenster, slotweergave)

  function U() { return B.ui; }

  /** Badge "Lifetime" met het Lifetime-icoon (los, of als waarde in een instellingenrij). */
  P.badge = function (cls) {
    var u = U();
    return u.h('span.plan-badge' + (cls ? '.' + cls : ''), { title: L('Available with Lifetime') }, [u.icon('lifetime', 'plan-badge-ic'), u.h('span', 'Lifetime')]);
  };

  function featureLine(reason) {
    var p = P.get();
    switch (reason) {
      case 'stats': return L('See how much you watch per day, per profile and per title.');
      case 'now_watching': return L('See who on your account is watching right now, and what.');
      case 'trakt': return L('Sync what you watch with Trakt and check off what you’ve already seen.');
      case 'servers': case 'multi_server': {
        var n = p.limits.servers || P.FREE.servers;
        return n === 1 ? L('With Free you can use %d server. Servers you already have keep working.', n) : L('With Free you can use %d servers. Servers you already have keep working.', n);
      }
      case 'themes': return L('Choose your own accent color for each profile. With Free, Bingr stays red.');
      case 'streams': return L('With Lifetime you can watch on %d screens at the same time.', P.LIFETIME.streams);
      case 'devices': return L('With Lifetime you can use Bingr on %d devices.', P.LIFETIME.devices);
      default: return null;
    }
  }

  /** Vergelijking Gratis ↔ Lifetime. */
  P.compareTable = function (highlight) {
    var u = U(), h = u.h, p = P.get();
    var free = p.plan === 'free' ? p.limits : P.FREE;
    var life = p.plan === 'lifetime' && !p.assumed ? p.limits : P.LIFETIME;
    function yes() { return h('span.plan-yes', [u.icon('check')]); }
    function no() { return h('span.plan-no', '–'); }
    function num(v) { return v == null ? L('Unlimited') : String(v); }
    var rows = [
      ['streams', L('Screens at the same time'), num(free.streams), num(life.streams)],
      ['devices', L('Devices'), num(free.devices), num(life.devices)],
      ['servers', L('Servers'), num(free.servers), num(life.servers)],
      ['stats', L('Statistics'), null, null],
      ['now_watching', L('Watching now'), null, null],
      ['trakt', 'Trakt', null, null],
      ['themes', L('Accent colors'), null, null]
    ];
    var hl = highlight === 'multi_server' ? 'servers' : highlight;
    var tbl = h('div.plan-cmp', { role: 'table' }, [
      h('div.plan-cmp-row.plan-cmp-head', { role: 'row' }, [h('span', { role: 'columnheader' }, ''),
        h('span', { role: 'columnheader' }, L('Free')), h('span.plan-cmp-life', { role: 'columnheader' }, 'Lifetime')])
    ]);
    rows.forEach(function (r) {
      tbl.appendChild(h('div.plan-cmp-row' + (r[0] === hl ? '.hl' : ''), { role: 'row' }, [
        h('span.plan-cmp-l', { role: 'rowheader' }, r[1]),
        h('span', { role: 'cell' }, r[2] != null ? [r[2]] : [no()]),
        h('span.plan-cmp-life', { role: 'cell' }, r[3] != null ? [r[3]] : [yes()])
      ]));
    });
    return tbl;
  };

  /** Knop/tekst om te upgraden (alleen een link als de server dat toestaat). */
  P.upgradeAction = function (onOpen) {
    var u = U(), up = P.get().upgrade;
    if (!up.link) return u.h('p.muted.small.plan-note', L('You upgrade on bingr.online, signed in with this account.'));
    return u.button(L('Upgrade on bingr.online'), function () {
      try { window.open(up.url, '_blank', 'noopener'); } catch (e) { /* stil */ }
      if (onOpen) onOpen();
    }, { primary: true, icon: 'link', cls: 'plan-cta' });
  };

  /** Upgradevenster; reason = het onderdeel waarom het opent (stats, now_watching, trakt, servers, themes, streams, devices). */
  P.sheet = function (reason) {
    var u = U(), h = u.h, p = P.get();
    var dlg = null;
    var body = h('div.plan-sheet');
    if (p.plan === 'lifetime' && !p.assumed) {
      body.appendChild(h('div.plan-hero', [h('div.plan-mark', [u.icon('lifetime')]), h('div', [h('div.plan-title', 'Bingr Lifetime'),
        h('div.muted.small', L('You have Lifetime. Thanks for supporting Bingr!'))])]));
      body.appendChild(P.compareTable(null));
      body.appendChild(h('div.dlg-buttons', [u.button(L('Close'), function () { dlg.close(); }, { primary: true })]));
      dlg = u.modal({ title: '', body: body, cls: 'plan-dlg' });
      return dlg;
    }
    body.appendChild(h('div.plan-hero', [h('div.plan-mark', [u.icon('lifetime')]), h('div', [
      h('div.plan-title', L('Upgrade to Lifetime')),
      h('div.plan-price', L('%@ one-time', P.price()))
    ])]));
    var line = featureLine(reason);
    if (line) body.appendChild(h('p.plan-why', line));
    body.appendChild(P.compareTable(reason));
    body.appendChild(h('p.muted.small.plan-note', L('Pay once, no subscription. Applies to your whole account, on all your devices.')));
    body.appendChild(h('div.dlg-buttons', [P.upgradeAction(function () { dlg.close(); }), u.button(L('Close'), function () { dlg.close(); })]));
    dlg = u.modal({ title: '', body: body, cls: 'plan-dlg' });
    return dlg;
  };

  /** Slotweergave voor een hele pagina (Statistieken). */
  P.lockedView = function (reason, title) {
    var u = U(), h = u.h;
    return h('div.plan-locked', [
      h('div.plan-lock-ic', [u.icon('lock')]),
      P.badge(),
      h('h2', title),
      h('p.muted', featureLine(reason) || ''),
      h('div.dlg-buttons.center', [u.button(L('Upgrade to Lifetime'), function () { P.sheet(reason); }, { primary: true, icon: 'lifetime' })])
    ]);
  };

  /** Waarde voor de rij Abonnement: "Gratis · 2 schermen tegelijk · 8 apparaten · 1 server". */
  P.summary = function () {
    var p = P.get(), l = p.limits;
    var srv = l.servers == null ? L('unlimited servers') : (l.servers === 1 ? L('1 server') : L('%d servers', l.servers));
    return [L('%d screens at once', l.streams), L('%d devices', l.devices), srv].join(' · ');
  };
  P.name = function () { return P.isFree() ? L('Free') : 'Lifetime'; };
})();
