/*
 * Build 181: Bingr Premium in de webspeler (docs/ACCOUNT.md in iptv-ios-appletv, "Build 181: Bingr Premium" §9–10).
 * Alles komt uit entitlements.premium (B.plan): {enabled, active, source, plan, status, expires_at, trial_until, will_renew,
 * required, trial_eligible, legacy_offer, manage, prices}. Ontbreekt het (oudere server) of is enabled false, dan
 * verandert er niets en blijft web/js/lifetime.js zoals het was.
 *  - Kies je plan (schermvullend, via lifetime.js): bij access 'activate' met premium.enabled. Maand / Halfjaar / Jaar en
 *    Lifetime; afrekenen op bingr.online/upgrade/?plan=… (nieuw tabblad), daarna "Ik heb al betaald" (billing refresh).
 *  - Instellingen > Abonnement: plan, verlengt op / loopt af op, en Abonnement beheren (Stripe Customer Portal).
 *  - screen(): wat de apps tonen (gedeelde testgevallen docs/build181_cases.json, groep client; tools/test/premium_test.js).
 * De Windows-app is deze webspeler: daar geldt hetzelfde.
 */
(function () {
  'use strict';
  var B = window.B;
  var PM = B.premium = {};
  var L = function () { return B.L.apply(null, arguments); };
  var PLANS = ['month', 'half', 'year'];
  var MONTHS = { month: 1, half: 6, year: 12 };
  var DEF = { month: 499, half: 1999, year: 2999, lifetime: 4999 };
  var UPGRADE = 'https://bingr.online/upgrade/';
  var SOURCES = ['legacy', 'admin', 'lifetime', 'stripe', 'apple'];
  var STATUSES = ['incomplete', 'trialing', 'active', 'past_due', 'grace', 'canceled', 'expired', 'revoked', 'lifetime'];

  function str(v) { return typeof v === 'string' && v ? v : null; }
  function tme(v) { var s = str(v); return s && isFinite(Date.parse(s)) ? s : null; }
  function cents(v, d) { return typeof v === 'number' && isFinite(v) && v > 0 ? Math.round(v) : d; }

  /** entitlements.premium → vaste vorm, of null (oudere server). */
  PM.normalize = function (raw) {
    if (!raw || typeof raw !== 'object') return null;
    var pr = raw.prices && typeof raw.prices === 'object' ? raw.prices : {};
    return {
      enabled: raw.enabled === true, active: raw.active === true,
      source: SOURCES.indexOf(raw.source) >= 0 ? raw.source : null,
      plan: ['month', 'half', 'year', 'lifetime'].indexOf(raw.plan) >= 0 ? raw.plan : null,
      status: STATUSES.indexOf(raw.status) >= 0 ? raw.status : null,
      expires_at: tme(raw.expires_at), trial_until: tme(raw.trial_until), will_renew: raw.will_renew === true,
      required: raw.required === true, trial_eligible: raw.trial_eligible === true, legacy_offer: raw.legacy_offer === true,
      manage: raw.manage === 'apple' || raw.manage === 'stripe' ? raw.manage : null, test: raw.test === true,
      prices: { month: cents(pr.month, DEF.month), half: cents(pr.half, DEF.half), year: cents(pr.year, DEF.year), lifetime: cents(pr.lifetime, DEF.lifetime) }
    };
  };

  /** Pure logica (gedeelde gevallen, groep client): {blocked, paywall: legacy|trial|plans|null, trial_badge, manage}. */
  PM.screen = function (ent, now, offline) {
    var p = ent && ent.premium, activate = !!ent && ent.access === 'activate';
    if (!p || !p.enabled) return { blocked: activate, paywall: activate ? 'legacy' : null, trial_badge: false, manage: (p && p.manage) || null };
    var exp = p.expires_at ? Date.parse(p.expires_at) : NaN;
    var lapsed = !!offline && p.active === true && p.status !== 'lifetime' && !p.will_renew && isFinite(exp) && exp <= (now == null ? Date.now() : now);
    var blocked = activate || lapsed;
    return { blocked: blocked, paywall: blocked ? (p.trial_eligible ? 'trial' : 'plans') : null, trial_badge: blocked && p.trial_eligible === true, manage: p.manage || null };
  };

  /** Is dit een abonnement (geen Lifetime)? */
  PM.isSubscription = function (p) { return !!(p && p.active && (p.source === 'stripe' || p.source === 'apple')); };
  PM.planName = function (plan) {
    return { month: L('Premium monthly'), half: L('Premium every 6 months'), year: L('Premium yearly'), lifetime: 'Lifetime' }[plan] || 'Premium';
  };
  function locale() { var l = B.lang || 'en'; return l === 'nl' ? 'nl-NL' : l === 'en' ? 'en-GB' : l; }
  PM.euro = function (c) {
    try { return new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR' }).format(c / 100); }
    catch (e) { return '€' + (c / 100).toFixed(2); }
  };
  function day(v) {
    try { return new Date(v).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' }); }
    catch (e) { return String(v).slice(0, 10); }
  }
  /** "Verlengt op …", "Loopt af op …", "Gratis proef tot …", of "" */
  PM.statusLine = function (p) {
    if (!p) return '';
    if (p.status === 'trialing' && p.trial_until) return L('Free trial until %@', day(p.trial_until));
    if ((p.status === 'past_due' || p.status === 'grace') && p.expires_at) return L('Payment failed: update your payment method before %@', day(p.expires_at));
    if (p.expires_at && PM.isSubscription(p)) return p.will_renew ? L('Renews on %@', day(p.expires_at)) : L('Ends on %@', day(p.expires_at));
    return '';
  };
  PM.savings = function (pr, plan) {
    if (!MONTHS[plan] || plan === 'month') return 0;
    var full = pr.month * MONTHS[plan];
    return full > 0 ? Math.max(0, Math.round((1 - pr[plan] / full) * 100)) : 0;
  };
  // build 193: platform windows vanuit de Windows-app, zodat /upgrade/ de aankoop bij het juiste platform telt
  PM.upgradeUrl = function (plan) { return UPGRADE + '?plan=' + encodeURIComponent(plan) + '&from=app&platform=' + (B.isWindowsApp ? 'windows' : 'web'); };

  function open(url) { try { window.open(url, '_blank', 'noopener'); } catch (e) { /* stil */ } }
  function billing(body) { return B.account && B.account.authed ? B.account.authed(body, '/functions/v1/billing') : Promise.resolve(null); }

  /** Abonnement beheren: de Stripe Customer Portal in een nieuw tabblad. Terug: true als hij opende. */
  PM.manage = function () {
    // het tabblad meteen openen (anders blokkeert de browser de pop-up na het wachten), daarna de link erin zetten
    var w = null;
    try { w = window.open('', '_blank'); } catch (e) { w = null; }
    return billing({ action: 'portal', lang: B.lang === 'nl' ? 'nl' : 'en', return_url: 'https://bingr.online/web/' }).then(function (r) {
      var url = r && r.ok && r.json && r.json.url;
      if (typeof url === 'string' && url.indexOf('https://billing.stripe.com/') === 0) {
        if (w) { try { w.opener = null; } catch (e) { /* stil */ } w.location.href = url; } else open(url);
        return true;
      }
      if (w) try { w.close(); } catch (e) { /* stil */ }
      return false;
    });
  };
  /** Na terugkeer van het afrekenen: Stripe opnieuw laten ophalen en de entitlements toepassen. */
  PM.refresh = function () {
    return billing({ action: 'refresh', platform: 'web' }).then(function (r) {
      if (r && r.ok && r.json && r.json.entitlements) { B.plan.apply(r.json.entitlements); return true; }
      return B.plan.fetch();
    });
  };

  /**
   * Plannenblok (schakelaar + kaart Premium + kaart Lifetime) voor het scherm Kies je plan en het upgradevenster.
   * Knoppen openen bingr.online/upgrade/?plan=… (daar log je in en reken je af via Stripe).
   */
  PM.offer = function (p, onOpen) {
    var u = B.ui, h = u.h, pr = (p && p.prices) || DEF, period = 'year';
    var trial = !!(p && p.trial_eligible);
    var root = h('div.pm-offer');
    function draw() {
      root.innerHTML = '';
      var tabs = h('div.pm-toggle', { role: 'radiogroup', 'aria-label': L('Billing period') });
      PLANS.forEach(function (k) {
        var s = PM.savings(pr, k);
        var b = h('button.pm-tab' + (k === period ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': String(k === period), tabindex: k === period ? '0' : '-1' },
          [h('span', { month: L('Month'), half: L('6 months'), year: L('Year') }[k]), s ? h('span.pm-save', '−' + s + '%') : null]);
        b.addEventListener('click', function () { period = k; draw(); var f = root.querySelector('.pm-tab.on'); if (f) f.focus(); });
        b.addEventListener('keydown', function (e) {
          var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!d) return;
          e.preventDefault(); period = PLANS[(PLANS.indexOf(k) + d + 3) % 3]; draw();
          var f = root.querySelector('.pm-tab.on'); if (f) f.focus();
        });
        tabs.appendChild(b);
      });
      var per = { month: L('per month'), half: L('every 6 months'), year: L('per year') }[period];
      var save = PM.savings(pr, period);
      var prem = h('div.pm-card.pm-prem' + (period === 'year' ? '.hl' : ''), [
        period === 'year' ? h('span.pm-tag', L('Most popular · save %d%%', save)) : save ? h('span.pm-tag.dim', L('Save %d%%', save)) : null,
        h('div.pm-name', 'Premium'),
        h('div.pm-price', [h('b', PM.euro(pr[period])), h('span', per)]),
        period !== 'month' ? h('div.pm-eq', L('%@ per month', PM.euro(Math.round(pr[period] / MONTHS[period])))) : null,
        trial ? h('div.pm-trial', L('3 days free')) : null,
        u.button(trial ? L('Try 3 days free') : L('Choose Premium'), function () { open(PM.upgradeUrl(period)); if (onOpen) onOpen(); }, { primary: true, icon: 'link', cls: 'pm-cta' })
      ]);
      var life = h('div.pm-card', [
        h('div.pm-name', 'Lifetime'),
        h('div.pm-price', [h('b', PM.euro(pr.lifetime)), h('span', L('one-time'))]),
        h('div.pm-eq', L('Pay once, Premium forever.')),
        u.button(L('Buy Lifetime'), function () { open(PM.upgradeUrl('lifetime')); if (onOpen) onOpen(); }, { icon: 'link', cls: 'pm-cta' })
      ]);
      root.appendChild(tabs);
      root.appendChild(h('div.pm-cards', [prem, life]));
      root.appendChild(h('p.muted.small.pm-fine', L('Prices incl. VAT. You pay on bingr.online, signed in with this account. Cancel any time.')));
    }
    draw();
    return root;
  };

  /** Inhoud van het scherm Kies je plan (in de overlay van lifetime.js). helpers = {statusEl, links}. */
  PM.drawPaywall = function (p, helpers) {
    var u = B.ui, h = u.h;
    var box = h('div.lt-box.pm-box', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lt-title' });
    box.appendChild(h('div.lt-mark', [u.icon('lifetime')]));
    box.appendChild(h('h1.lt-title', { id: 'lt-title' }, L('Choose your plan')));
    box.appendChild(h('p.lt-text', p.premium.trial_eligible ? L('Start with 3 days free. Your servers, lists, profiles and settings are all here.')
      : L('Your account is safe: your servers, lists, profiles and settings are all still here. Choose a plan to keep watching.')));
    box.appendChild(PM.offer(p.premium));
    var status = helpers.statusEl;
    var check = u.button(L('I already paid'), function () {
      check.disabled = true;
      status.textContent = L('Checking…');
      PM.refresh().then(function () {
        check.disabled = false;
        status.textContent = B.plan.get().access === 'activate' ? L('We don’t see Premium on this account yet. It can take a minute after paying.') : '';
        if (B.lifetime) B.lifetime.check();
      });
    }, { cls: 'lt-check' });
    box.appendChild(h('div.lt-buttons', [check]));
    box.appendChild(status);
    box.appendChild(helpers.links);
    return box;
  };

  /** Blok voor het upgradevenster en Instellingen: huidig abonnement met Abonnement beheren. */
  PM.statusBlock = function (p) {
    var u = B.ui, h = u.h;
    var err = h('p.muted.small', { 'aria-live': 'polite' });
    var manage = p.manage === 'stripe' ? u.button(L('Manage subscription'), function () {
      PM.manage().then(function (ok) { err.textContent = ok ? '' : L('Couldn’t open Manage subscription. Please try again.'); });
    }, { icon: 'link', cls: 'small' }) : null;
    return h('div.pm-status', [
      h('div.plan-title', 'Bingr ' + PM.planName(p.plan)),
      h('div.muted.small', PM.statusLine(p)),
      p.manage === 'apple' ? h('p.muted.small', L('Your subscription runs through the App Store. Manage it on your iPhone, iPad or Mac.')) : null,
      manage ? h('div.pm-manage', [manage]) : null, err
    ]);
  };
})();
