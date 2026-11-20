/*
 * Build 181: Bingr Premium (scherm Kies je plan, upgradevenster, Abonnement beheren; web/js/premium.js).
 * Sleutel = Engels (terugval voor de andere talen); hier Nederlands. Niets overschrijven wat er al staat.
 */
(function () {
  'use strict';
  var NL = {
    'Premium monthly': 'Premium maandelijks',
    'Premium every 6 months': 'Premium halfjaarlijks',
    'Premium yearly': 'Premium jaarlijks',
    'Free trial until %@': 'Gratis proef tot %@',
    'Payment failed: update your payment method before %@': 'Betaling mislukt: werk je betaalmethode bij vóór %@',
    'Renews on %@': 'Verlengt op %@',
    'Ends on %@': 'Loopt af op %@',
    'Billing period': 'Betaalperiode',
    'Month': 'Maand',
    '6 months': 'Halfjaar',
    'Year': 'Jaar',
    'per month': 'per maand',
    'every 6 months': 'per 6 maanden',
    'per year': 'per jaar',
    'Most popular · save %d%%': 'Meest gekozen · %d%% voordeliger',
    'Save %d%%': '%d%% voordeliger',
    '%@ per month': '%@ per maand',
    '3 days free': '3 dagen gratis',
    'Try 3 days free': 'Probeer 3 dagen gratis',
    'Choose Premium': 'Kies Premium',
    'one-time': 'eenmalig',
    'Pay once, Premium forever.': 'Eén keer betalen, voor altijd Premium.',
    'Buy Lifetime': 'Koop Lifetime',
    'Prices incl. VAT. You pay on bingr.online, signed in with this account. Cancel any time.': 'Prijzen incl. btw. Je betaalt op bingr.online, ingelogd met dit account. Opzeggen kan altijd.',
    'Choose your plan': 'Kies je plan',
    'Start with 3 days free. Your servers, lists, profiles and settings are all here.': 'Begin met 3 dagen gratis. Je servers, lijsten, profielen en instellingen staan er allemaal.',
    'Your account is safe: your servers, lists, profiles and settings are all still here. Choose a plan to keep watching.': 'Je account is bewaard: je servers, lijsten, profielen en instellingen staan er nog allemaal. Kies een plan om verder te kijken.',
    'I already paid': 'Ik heb al betaald',
    'We don’t see Premium on this account yet. It can take a minute after paying.': 'We zien nog geen Premium op dit account. Na het betalen kan dat een minuutje duren.',
    'Manage subscription': 'Abonnement beheren',
    'Couldn’t open Manage subscription. Please try again.': 'Abonnement beheren lukte niet. Probeer het opnieuw.',
    'Your subscription runs through the App Store. Manage it on your iPhone, iPad or Mac.': 'Je abonnement loopt via de App Store. Beheer het op je iPhone, iPad of Mac.'
  };
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  all.nl = all.nl || {};
  Object.keys(NL).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(all.nl, k)) all.nl[k] = NL[k]; });
})();
