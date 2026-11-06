/*
 * Build 167: Bingr wordt alleen Lifetime (scherm Activeer Lifetime, aankondiging, kortingscode; web/js/lifetime.js).
 * Sleutel = Engels (terugval voor de andere talen); hier Nederlands. Niets overschrijven wat er al staat.
 */
(function () {
  'use strict';
  var NL = {
    'Activate Lifetime': 'Activeer Lifetime',
    'Bingr is now Lifetime only.': 'Bingr is nu alleen Lifetime.',
    'Your account is safe: your servers, lists, profiles and settings are all still here. Activate Lifetime to keep watching.': 'Je account is bewaard: je servers, lijsten, profielen en instellingen staan er nog allemaal. Activeer Lifetime om verder te kijken.',
    'Your account is safe: your servers, lists, profiles and settings are all still here.': 'Je account is bewaard: je servers, lijsten, profielen en instellingen staan er nog allemaal.',
    'Your account isn’t activated yet': 'Je account is nog niet geactiveerd',
    'Buy Lifetime': 'Koop Lifetime',
    'I already bought Lifetime': 'Ik heb Lifetime al gekocht',
    'Checking…': 'Even controleren…',
    'We don’t see Lifetime on this account yet. It can take a minute after paying.': 'We zien nog geen Lifetime op dit account. Na het betalen kan dat een minuutje duren.',
    'Delete account': 'Account verwijderen',
    'Delete account opens My Bingr on bingr.online.': 'Account verwijderen opent Mijn Bingr op bingr.online.',
    'Your discount code': 'Jouw kortingscode',
    '%d%% off, valid until %@': '%d%% korting, geldig tot %@',
    'Valid until %@': 'Geldig tot %@',
    'Bingr is going Lifetime on %@': 'Bingr wordt Lifetime op %@',
    'After that, Bingr only works with Lifetime. Your data stays safe.': 'Daarna werkt Bingr alleen nog met Lifetime. Je gegevens blijven bewaard.',
    'Free (until %@)': 'Gratis (tot %@)',
    'New to Bingr? Start with Lifetime': 'Nieuw bij Bingr? Begin met Lifetime',
    'Buy Lifetime first, then create your account. Pay once, keep it forever.': 'Koop eerst Lifetime en maak daarna je account. Eén keer betalen, voor altijd.',
    'Already have an account? Sign in below.': 'Heb je al een account? Log hieronder in.'
  };
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  all.nl = all.nl || {};
  Object.keys(NL).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(all.nl, k)) all.nl[k] = NL[k]; });
})();
