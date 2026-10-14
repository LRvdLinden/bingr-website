/*
 * Teksten van de abonnementen (Gratis / Lifetime) in de webspeler. Sleutel = Engels; hier alleen Nederlands
 * (andere talen vallen terug op Engels). Worden toegevoegd aan BINGR_STRINGS (een sleutel die er al is, blijft staan).
 */
(function () {
  'use strict';
  var NL = {
    'Subscription': 'Abonnement',
    'Free': 'Gratis',
    'Lifetime': 'Lifetime',
    'Upgrade to Lifetime': 'Upgrade naar Lifetime',
    '%@ one-time': '%@ eenmalig',
    'Upgrade on bingr.online': 'Upgraden op bingr.online',
    'You upgrade on bingr.online, signed in with this account.': 'Upgraden doe je op bingr.online, ingelogd met dit account.',
    'Pay once, no subscription. Applies to your whole account, on all your devices.': 'Eén keer betalen, geen abonnement. Geldt voor je hele account, op al je apparaten.',
    'Available with Lifetime': 'Beschikbaar met Lifetime',
    'Screens at the same time': 'Schermen tegelijk',
    'Servers': 'Servers',
    'Unlimited': 'Onbeperkt',
    'Accent colors': 'Accentkleuren',
    '%d screens at once': '%d schermen tegelijk',
    '%d devices': '%d apparaten',
    '1 server': '1 server',
    '%d servers': '%d servers',
    'unlimited servers': 'onbeperkt servers',
    'You have Lifetime. Thanks for supporting Bingr!': 'Je hebt Lifetime. Bedankt dat je Bingr steunt!',
    'See how much you watch per day, per profile and per title.': 'Zie hoeveel je kijkt per dag, per profiel en per titel.',
    'See who on your account is watching right now, and what.': 'Zie wie er op je account nu kijkt, en wat.',
    'Sync what you watch with Trakt and check off what you’ve already seen.': 'Synchroniseer wat je kijkt met Trakt en vink af wat je al gezien hebt.',
    'With Free you can use %d server. Servers you already have keep working.': 'Met Gratis gebruik je %d server. Servers die je al hebt, blijven werken.',
    'With Free you can use %d servers. Servers you already have keep working.': 'Met Gratis gebruik je %d servers. Servers die je al hebt, blijven werken.',
    'Choose your own accent color for each profile. With Free, Bingr stays red.': 'Kies per profiel je eigen accentkleur. Met Gratis blijft Bingr rood.',
    'With Lifetime you can watch on %d screens at the same time.': 'Met Lifetime kijk je op %d schermen tegelijk.',
    'With Lifetime you can use Bingr on %d devices.': 'Met Lifetime gebruik je Bingr op %d apparaten.',
    'Free: up to %d screens at the same time. Lifetime: %d.': 'Gratis: maximaal %d schermen tegelijk. Lifetime: %d.',
    'Free: up to %d devices. Lifetime: %d.': 'Gratis: maximaal %d apparaten. Lifetime: %d.',
    'Statistics are part of Lifetime': 'Statistieken horen bij Lifetime',
    'Who’s watching now': 'Wie kijkt er nu',
    'Servers are added on bingr.online/account.': 'Servers voeg je toe op bingr.online/account.',
    'Red': 'Rood'
  };
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  all.nl = all.nl || {};
  Object.keys(NL).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(all.nl, k)) all.nl[k] = NL[k]; });
})();
