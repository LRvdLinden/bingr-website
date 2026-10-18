/*
 * Teksten van de abonnementen (Gratis / Lifetime) in de webspeler. Sleutel = Engels; hier alleen Nederlands
 * (andere talen vallen terug op Engels). Worden toegevoegd aan BINGR_STRINGS (een sleutel die er al is, blijft staan).
 */
(function () {
  'use strict';
  var NL = {
    'Subscription': 'Abonnement',
    'Make main profile': 'Maak hoofdprofiel',
    '%@ becomes the main profile: managing profiles and servers, Trakt and the settings move there. You become a regular profile.': '%@ wordt het hoofdprofiel: profielen en servers beheren, Trakt en de instellingen gaan daarheen. Jij wordt een gewoon profiel.',
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
    'up to %d screens at once': 'tot %d schermen tegelijk',
    'up to %d': 'tot %d',
    'With Lifetime you can watch on up to %d screens at the same time.': 'Met Lifetime kijk je op tot %d schermen tegelijk.',
    'How many you can watch at once also depends on your IPTV provider.': 'Hoeveel je tegelijk kunt kijken, hangt ook af van je IPTV-aanbieder.',
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
    'Free: 1 screen at a time. Lifetime: %d.': 'Gratis: 1 scherm tegelijk. Lifetime: %d.',
    '1 screen at once': '1 scherm tegelijk',
    'Your account can be used on 1 screen at a time.': 'Je account kan op 1 scherm tegelijk worden gebruikt.',
    // limiet van de IPTV-provider (Xtream), los van Bingr
    'Your IPTV subscription allows 1 connection at a time and it is in use. This is a limit of your provider, not of Bingr.': 'Je IPTV-abonnement staat maximaal 1 verbinding tegelijk toe en die is in gebruik. Dit is een limiet van je provider, niet van Bingr.',
    'Your IPTV subscription allows up to %d connections at the same time and they are all in use. This is a limit of your provider, not of Bingr.': 'Je IPTV-abonnement staat maximaal %d verbindingen tegelijk toe en die zijn allemaal in gebruik. Dit is een limiet van je provider, niet van Bingr.',
    'How many streams you can watch at once also depends on your IPTV provider: Bingr allows as many as your Bingr plan, but your provider decides how many connections your subscription has there.': 'Hoeveel streams je tegelijk kunt kijken, hangt ook af van je IPTV-aanbieder: Bingr laat er zoveel toe als je abonnement bij Bingr, maar je aanbieder bepaalt hoeveel verbindingen jouw abonnement daar heeft.',
    'Stop the stream on your other device, or wait a moment: your provider sometimes only releases a connection you just closed after a minute.': 'Stop de stream op je andere apparaat, of wacht even: een net gesloten verbinding wordt soms pas na een minuut vrijgegeven door je provider.',
    'Statistics are part of Lifetime': 'Statistieken horen bij Lifetime',
    'Who’s watching now': 'Wie kijkt er nu',
    'Servers are added on bingr.online/account.': 'Servers voeg je toe op bingr.online/account.',
    'Red': 'Rood'
  };
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  all.nl = all.nl || {};
  Object.keys(NL).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(all.nl, k)) all.nl[k] = NL[k]; });
})();
