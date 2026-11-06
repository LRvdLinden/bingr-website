/*
 * Build 167: Bingr wordt alleen Lifetime (docs/ACCOUNT.md in iptv-ios-appletv, "Build 167: alleen Lifetime").
 * Alles komt uit de entitlements van de server (B.plan): `access` ('full' | 'activate') en `lifetime_only`
 * ({enabled, announced, cutover_at, code, code_valid_until, discount_pct, trial_until}; alleen als enabled true is).
 * Ontbreekt dat (oudere server, of enabled false), dan verandert er niets.
 *  - access 'activate': schermvullend "Activeer Lifetime" (koop via /upgrade/?code=, opnieuw controleren, Support,
 *    account verwijderen op Mijn Bingr, uitloggen). Ook bij 403 activation_required van stream_start.
 *  - vóór cutover_at, aangekondigd, Gratis: een aankondigingskaart met de code, de geldigheid en de knop.
 * De web-app (en dus Windows) mag de code tonen; de Apple-apps niet.
 */
(function () {
  'use strict';
  var B = window.B;
  var L = function () { return B.L.apply(null, arguments); };
  var LT = B.lifetime = {};
  var TZ = 'Europe/Amsterdam';
  var SUPPORT_URL = 'https://support.bingr.online';
  var ACCOUNT_URL = '../account/';

  function date(v) {
    if (!v) return null;
    var d = v instanceof Date ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * Pure logica (getest in tools/test/lifetime_test.js): plan = B.plan.get() → wat de speler moet tonen.
   * {enabled, announced, phase: 'off'|'before'|'after', activate, announce, cutover, code, codeValidUntil, discountPct}
   */
  LT.info = function (p, now) {
    now = date(now) || new Date();
    var lo = (p && p.lifetime_only) || null;
    var out = { enabled: !!(lo && lo.enabled), announced: !!(lo && lo.announced === true), phase: 'off', activate: !!(p && p.access === 'activate'), announce: false,
      cutover: null, code: null, codeValidUntil: null, discountPct: null };
    if (!out.enabled) return out;
    var cut = date(lo.cutover_at);
    out.cutover = cut;
    out.phase = cut && now.getTime() >= cut.getTime() ? 'after' : 'before';
    var free = p.plan === 'free';
    var until = date(lo.code_valid_until);
    if (free && lo.code && (!until || now.getTime() < until.getTime())) { out.code = lo.code; out.codeValidUntil = until; }
    out.discountPct = lo.discount_pct != null ? lo.discount_pct : null;
    out.announce = free && !out.activate && out.announced && out.phase === 'before' && !!cut;
    return out;
  };

  /** /upgrade/ met ?code= als er een eigen code is (upgrade.url van de server, anders bingr.online/upgrade/). */
  LT.upgradeUrl = function (p, now) {
    p = p || B.plan.get();
    var url = (p.upgrade && p.upgrade.url) || 'https://bingr.online/upgrade/';
    var i = LT.info(p, now);
    if (!i.code) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'code=' + encodeURIComponent(i.code);
  };

  function locale() {
    var l = B.lang || 'en';
    return l === 'nl' ? 'nl-NL' : l === 'en' ? 'en-GB' : l;
  }
  /** Datum zoals "7 december 2026" (Europe/Amsterdam, de tijdzone van cutover_at). */
  LT.fmtDate = function (d) {
    d = date(d);
    if (!d) return '';
    try { return d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }); }
    catch (e) { return d.toISOString().slice(0, 10); }
  };

  /** Naam van Gratis in de vergelijking: "Gratis (tot 7 december 2026)" vóór de overgang, anders "Gratis". */
  LT.freeLabel = function (p, now) {
    var i = LT.info(p || B.plan.get(), now);
    if (i.phase === 'before' && i.cutover && i.announced) return L('Free (until %@)', LT.fmtDate(i.cutover));
    return L('Free');
  };

  function open(url) { try { window.open(url, '_blank', 'noopener'); } catch (e) { /* stil */ } }
  function U() { return B.ui; }

  /** De eigen code als blok: code groot, met korting en geldigheid (alleen als de server een geldige code gaf). */
  function codeBlock(i) {
    var u = U(), h = u.h;
    if (!i.code) return null;
    var sub = i.discountPct != null && i.codeValidUntil ? L('%d%% off, valid until %@', i.discountPct, LT.fmtDate(i.codeValidUntil))
      : i.codeValidUntil ? L('Valid until %@', LT.fmtDate(i.codeValidUntil)) : null;
    return h('div.lt-code', [h('div.lt-code-k', L('Your discount code')), h('div.lt-code-v', i.code), sub ? h('div.lt-code-s', sub) : null]);
  }

  /** In het upgradevenster (Gratis, vóór de overgang): de aankondiging en de eigen code; anders null. */
  LT.sheetNote = function () {
    var p = B.plan.get(), i = LT.info(p);
    if (!i.announce) return null;
    var h = U().h;
    return h('div.lt-sheet', [h('p.lt-sheet-t', L('Bingr is going Lifetime on %@', LT.fmtDate(i.cutover))), codeBlock(i)]);
  };

  /** Knop Koop Lifetime (alleen als de server een link toestaat: upgrade.link). */
  function buyButton(p, cls) {
    var u = U();
    if (!(p.upgrade && p.upgrade.link)) return null;
    return u.button(L('Buy Lifetime'), function () { open(LT.upgradeUrl(p)); }, { primary: true, icon: 'link', cls: cls || null });
  }

  // MARK: Activeer Lifetime (schermvullend)

  var overlay = null;
  function keyGuard(e) {
    // achter het scherm geen sneltoetsen van de app ("/" = zoeken); Tab en Enter blijven in het scherm werken
    if (!overlay) return;
    var t = e.target;
    if (overlay.contains(t)) return;
    if (e.key === '/' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
  }
  function drawActivate() {
    var u = U(), h = u.h, p = B.plan.get(), i = LT.info(p);
    var box = h('div.lt-box', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lt-title' });
    box.appendChild(h('div.lt-mark', [u.icon('lifetime')]));
    var buy = buyButton(p, 'lt-buy');
    if (buy) {
      box.appendChild(h('h1.lt-title', { id: 'lt-title' }, L('Activate Lifetime')));
      box.appendChild(h('p.lt-lead', L('Bingr is now Lifetime only.')));
      box.appendChild(h('p.lt-text', L('Your account is safe: your servers, lists, profiles and settings are all still here. Activate Lifetime to keep watching.')));
      var cb = codeBlock(i);
      if (cb) box.appendChild(cb);
    } else {
      // geen link naar de betaalpagina toegestaan voor dit platform: alleen de melding
      box.appendChild(h('h1.lt-title', { id: 'lt-title' }, L('Your account isn’t activated yet')));
      box.appendChild(h('p.lt-text', L('Your account is safe: your servers, lists, profiles and settings are all still here.')));
    }
    var status = h('p.lt-status.muted.small', { 'aria-live': 'polite' });
    var check = u.button(L('I already bought Lifetime'), function () {
      check.disabled = true;
      status.textContent = L('Checking…');
      B.plan.fetch().then(function () {
        check.disabled = false;
        if (B.plan.get().access === 'activate') status.textContent = L('We don’t see Lifetime on this account yet. It can take a minute after paying.');
        else status.textContent = '';
        LT.check();
      });
    }, { cls: 'lt-check' });
    var btns = h('div.lt-buttons', [buy, check]);
    box.appendChild(btns);
    box.appendChild(status);
    box.appendChild(h('div.lt-links', [
      u.button(L('Support'), function () { open(SUPPORT_URL); }, { cls: 'small', icon: 'help' }),
      u.button(L('Delete account'), function () { open(ACCOUNT_URL); }, { cls: 'small', icon: 'trash' }),
      // uitloggen sluit het scherm via 'signedOut' (met een kinderprofiel eerst de rekensom, die boven dit scherm staat)
      u.button(L('Sign out'), function () { if (B.app && B.app.signOut) B.app.signOut(); }, { cls: 'small' })
    ]));
    box.appendChild(h('p.lt-note.muted.small', L('Delete account opens My Bingr on bingr.online.')));
    return h('div.lt-activate', [box]);
  }
  function showActivate() {
    if (B.player && B.player.current) { try { B.player.current.close(true); } catch (e) { /* stil */ } }
    // open vensters van de app dicht (alles wat daarna opent, zoals de rekensom bij uitloggen, staat boven dit scherm)
    if (!overlay) { var n = 0; while (U().closeTopDialog() && n++ < 20) { /* volgende */ } }
    hideAnnounce();
    var el = drawActivate();
    if (overlay && overlay.parentNode) overlay.parentNode.replaceChild(el, overlay);
    else { document.body.appendChild(el); document.addEventListener('keydown', keyGuard, true); }
    overlay = el;
    document.documentElement.classList.add('lt-locked');
    var f = el.querySelector('.btn.primary, .btn');
    if (f) setTimeout(function () { try { f.focus({ preventScroll: true }); } catch (e) { /* stil */ } }, 30);
  }
  function hide() {
    if (!overlay) return;
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    document.removeEventListener('keydown', keyGuard, true);
    document.documentElement.classList.remove('lt-locked');
  }
  LT.isLocked = function () { return !!overlay; };

  // MARK: welkomstscherm na cutover_at (nog niet ingelogd; AANVULLING 1: eerst betalen, dan het account)

  var GUEST_URL = 'https://bingr.online/upgrade/?guest=1';
  /**
   * Pure logica: publieke billing `config` → true als het welkomstscherm Koop Lifetime moet tonen.
   * lifetime_only {enabled, cutover_at, after_cutover, trial_days}: after_cutover van de server gaat voor, anders de klok.
   */
  LT.publicAfter = function (cfg, now) {
    var lo = cfg && typeof cfg === 'object' && cfg.lifetime_only && typeof cfg.lifetime_only === 'object' ? cfg.lifetime_only : null;
    if (!lo || B.bool(lo.enabled) !== true) return false;
    if (lo.after_cutover === true) return true;
    if (lo.after_cutover === false) return false;
    var cut = date(lo.cutover_at);
    return !!cut && (date(now) || new Date()).getTime() >= cut.getTime();
  };
  /** Publieke billing `config` (zonder inloggen). Lukt het niet, dan null: het welkomstscherm blijft zoals het was. */
  LT.publicConfig = function () {
    var c = B.config || {};
    if (!c.supabaseUrl || typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(c.supabaseUrl + '/functions/v1/billing/config', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: c.supabaseKey }, body: '{}' })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  };
  /**
   * Op het inlogscherm (S.login): na cutover_at bovenaan "Koop Lifetime" (bingr.online/upgrade/?guest=1: eerst betalen,
   * daarna het account maken) en de uitleg dat je met een bestaand account hieronder inlogt. Anders niets.
   */
  LT.loginOffer = function (shell, before) {
    LT.publicConfig().then(function (cfg) {
      if (!LT.publicAfter(cfg) || !shell || !before || before.parentNode !== shell) return;
      var u = U(), h = u.h;
      var box = h('div.lt-offer', [
        h('div.lt-offer-t', [u.icon('lifetime', 'lt-card-ic'), h('span', L('New to Bingr? Start with Lifetime'))]),
        h('p.lt-offer-p', L('Buy Lifetime first, then create your account. Pay once, keep it forever.')),
        h('div.lt-offer-b', [u.button(L('Buy Lifetime'), function () { open(GUEST_URL); }, { primary: true, icon: 'link' })]),
        h('p.lt-offer-s.muted.small', L('Already have an account? Sign in below.'))
      ]);
      shell.insertBefore(box, before);
    });
  };

  // MARK: aankondiging (vóór cutover_at, Gratis)

  var card = null;
  function dismissKey() { var uid = B.account && B.account.userId && B.account.userId(); return uid ? 'lt.dismissed.' + uid : null; }
  function dismissedToday() {
    var k = dismissKey();
    return !!(k && B.store.get(k, null) === new Date().toISOString().slice(0, 10));
  }
  function hideAnnounce() { if (card && card.parentNode) card.parentNode.removeChild(card); card = null; }
  function showAnnounce(i) {
    var u = U(), h = u.h, p = B.plan.get();
    var closeBtn = u.button('', function () {
      var k = dismissKey();
      if (k) B.store.set(k, new Date().toISOString().slice(0, 10));
      hideAnnounce();
    }, { cls: 'lt-x', icon: 'close', title: L('Close') });
    var buy = buyButton(p, 'small');
    var el = h('aside.lt-card', { role: 'status', 'aria-live': 'polite' }, [
      closeBtn,
      h('div.lt-card-t', [u.icon('lifetime', 'lt-card-ic'), h('span', L('Bingr is going Lifetime on %@', LT.fmtDate(i.cutover)))]),
      h('p.lt-card-p', L('After that, Bingr only works with Lifetime. Your data stays safe.')),
      codeBlock(i),
      buy ? h('div.lt-card-b', [buy]) : null
    ]);
    if (card && card.parentNode) card.parentNode.replaceChild(el, card); else document.body.appendChild(el);
    card = el;
  }

  /** Opnieuw bepalen wat er moet staan (na inloggen, na elk nieuw antwoord van entitlements). */
  LT.check = function () {
    var signed = B.account && B.account.isSignedIn && B.account.isSignedIn();
    if (!signed) { hide(); hideAnnounce(); return; }
    var p = B.plan.get(), i = LT.info(p);
    if (i.activate) { showActivate(); return; }
    hide();
    if (i.announce && !dismissedToday()) showAnnounce(i); else hideAnnounce();
  };

  /** stream_start gaf 403 activation_required: meteen het scherm (ook als de cache nog 'full' zei) en opnieuw ophalen. */
  LT.required = function () {
    if (B.plan.markActivation) B.plan.markActivation();
    LT.check();
  };

  B.on('plan', function () { LT.check(); });
  B.on('signedOut', function () { hide(); hideAnnounce(); });
  B.on('wipe', function () { hide(); hideAnnounce(); });
})();
