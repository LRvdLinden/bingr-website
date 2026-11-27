/*
 * Build 171 (versie 1.0.7): Kijk je nog?, zenders verbergen, titels blokkeren, categorieën vastpinnen, betere limietschermen
 * en crashrapporten (web/js/b171.js, b171logic.js, crash.js, player.js, categories.js, screens.js).
 * Sleutel = Engels (terugval voor de andere talen); hier Nederlands. Niets overschrijven wat er al staat.
 */
(function () {
  'use strict';
  var NL = {
    'Are you still watching?': 'Kijk je nog?',
    'Continue watching': 'Verder kijken',
    'Stop': 'Stoppen',
    'Pausing in': 'Pauzeren over',
    'Paused: press Play to continue': 'Gepauzeerd: druk op Afspelen om verder te gaan',
    'Stopped from %@': 'Gestopt vanaf %@',
    'Stopped from another device': 'Gestopt vanaf een ander apparaat',
    'Ask if you are still watching': 'Vragen of je nog kijkt',
    'Live TV and movies: ask after': 'Live en films: vragen na',
    'Ask after': 'Vragen na',
    '%d hours': '%d uur',
    'After 3 episodes in a row without using the controls, or after a few hours of live TV or a movie without any input, Bingr asks if you are still watching. Without an answer it pauses after 30 seconds and frees the stream. Applies to this device.': 'Na 3 afleveringen achter elkaar zonder bediening, of na een paar uur live of film zonder enige bediening, vraagt Bingr of je nog kijkt. Zonder antwoord pauzeert hij na 30 seconden en komt de stream vrij. Geldt voor dit apparaat.',
    'Hide channel': 'Zender verbergen',
    'Hide for this profile': 'Verbergen voor dit profiel',
    'Hide for %@': 'Verbergen voor %@',
    'Hidden for %@': 'Verborgen voor %@',
    'Channel hidden for %@': 'Zender verborgen voor %@',
    'Hidden': 'Verborgen',
    'Hidden for this profile': 'Verborgen voor dit profiel',
    'Hidden channels': 'Verborgen zenders',
    'Blocked titles': 'Geblokkeerde titels',
    'Show again': 'Weer tonen',
    'Unblock': 'Deblokkeren',
    'This title is hidden for this profile': 'Deze titel is verborgen voor dit profiel',
    'Hidden channels and blocked titles do not appear in Live TV, the guide, search, rows, Continue watching or My List of this profile.': 'Verborgen zenders en geblokkeerde titels staan niet in Live TV, de tv-gids, zoeken, de rijen, Verder kijken en Mijn lijst van dit profiel.',
    'No hidden channels. Hide a channel with a long press or right-click → Hide channel.': 'Geen verborgen zenders. Verberg een zender door hem lang in te drukken of met rechtsklikken → Zender verbergen.',
    'No blocked titles. Hide a movie or series with a long press or right-click → Hide for this profile.': 'Geen geblokkeerde titels. Verberg een film of serie door hem lang in te drukken of met rechtsklikken → Verbergen voor dit profiel.',
    'Kids profile: %@': 'Kinderprofiel: %@',
    'Changes ask for the PIN of the main profile.': 'Wijzigen vraagt de pincode van het hoofdprofiel.',
    'Movie': 'Film',
    'Favorite categories': 'Favoriete categorieën',
    'Pin category': 'Categorie vastpinnen',
    'Unpin category': 'Niet meer vastpinnen',
    'Category pinned': 'Categorie vastgepind',
    'Category unpinned': 'Categorie niet meer vastgepind',
    'Pinned': 'Vastgepind',
    'Hide category': 'Categorie verbergen',
    '%@ is hidden. Show it again in Settings → Show categories.': '%@ is verborgen. Zet hem weer aan in Instellingen → Categorieën tonen.',
    'Filter': 'Filter',
    'Stop on that device': 'Stoppen op dat apparaat',
    'Active %@': 'Laatst actief %@',
    'Watching now': 'Kijkt nu',
    'Sign out %@': '%@ afmelden',
    'Sign out: not used since %@': 'Afmelden: niet gebruikt sinds %@',
    'just now': 'zojuist',
    '1 minute ago': '1 minuut geleden',
    '%d minutes ago': '%d minuten geleden',
    '1 hour ago': '1 uur geleden',
    '%d hours ago': '%d uur geleden',
    '1 day ago': '1 dag geleden',
    '%d days ago': '%d dagen geleden',
    '%d months ago': '%d maanden geleden',
    'unknown': 'onbekend',
    'Share crash reports': 'Crashrapporten delen',
    'If Bingr crashes or hits an error, it sends a short report to Bingr (no third party): app version, browser, the error and where in the code it happened. Web addresses, IP addresses, e-mail addresses and keys are removed first. Reports are deleted after 90 days.': 'Loopt Bingr vast of gaat er iets mis, dan stuurt hij een kort rapport naar Bingr (geen derde partij): de appversie, de browser, de fout en waar in de code die zat. Webadressen, IP-adressen, e-mailadressen en sleutels gaan er eerst uit. Rapporten worden na 90 dagen verwijderd.'
  };
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  all.nl = all.nl || {};
  Object.keys(NL).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(all.nl, k)) all.nl[k] = NL[k]; });
})();
