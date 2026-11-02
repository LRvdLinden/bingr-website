/*
 * Build 161: kaart "Meer apps van de ontwikkelaar" onderaan in Instellingen (opent https://lrvdlinden.app).
 * Sleutel = Engels (terugval). "View (more apps)" is een eigen sleutel, want "View" bestaat al als "Bekijken".
 * Niets overschrijven wat er al staat.
 */
(function () {
  'use strict';
  var V = {
    "en": { "View (more apps)": "View" },
    "nl": { "Discover": "Ontdekken", "More apps from the developer": "Meer apps van de ontwikkelaar", "Apps for iPhone, iPad, Apple TV and Homey": "Apps voor iPhone, iPad, Apple TV en Homey", "View (more apps)": "Bekijk" },
    "de": { "Discover": "Entdecken", "More apps from the developer": "Weitere Apps des Entwicklers", "Apps for iPhone, iPad, Apple TV and Homey": "Apps für iPhone, iPad, Apple TV und Homey", "View (more apps)": "Ansehen" },
    "fr": { "Discover": "Découvrir", "More apps from the developer": "Plus d’apps du développeur", "Apps for iPhone, iPad, Apple TV and Homey": "Apps pour iPhone, iPad, Apple TV et Homey", "View (more apps)": "Voir" },
    "es": { "Discover": "Descubrir", "More apps from the developer": "Más apps del desarrollador", "Apps for iPhone, iPad, Apple TV and Homey": "Apps para iPhone, iPad, Apple TV y Homey", "View (more apps)": "Ver" },
    "it": { "Discover": "Scopri", "More apps from the developer": "Altre app dello sviluppatore", "Apps for iPhone, iPad, Apple TV and Homey": "App per iPhone, iPad, Apple TV e Homey", "View (more apps)": "Vedi" },
    "pt": { "Discover": "Descobrir", "More apps from the developer": "Mais apps do programador", "Apps for iPhone, iPad, Apple TV and Homey": "Apps para iPhone, iPad, Apple TV e Homey", "View (more apps)": "Ver" },
    "pl": { "Discover": "Odkrywaj", "More apps from the developer": "Więcej aplikacji od twórcy", "Apps for iPhone, iPad, Apple TV and Homey": "Aplikacje na iPhone’a, iPada, Apple TV i Homey", "View (more apps)": "Zobacz" },
    "tr": { "Discover": "Keşfet", "More apps from the developer": "Geliştiricinin diğer uygulamaları", "Apps for iPhone, iPad, Apple TV and Homey": "iPhone, iPad, Apple TV ve Homey için uygulamalar", "View (more apps)": "Göster" },
    "ar": { "Discover": "اكتشف", "More apps from the developer": "المزيد من تطبيقات المطوّر", "Apps for iPhone, iPad, Apple TV and Homey": "تطبيقات لـ iPhone وiPad وApple TV وHomey", "View (more apps)": "عرض" },
    "zh-Hans": { "Discover": "发现", "More apps from the developer": "开发者的更多 App", "Apps for iPhone, iPad, Apple TV and Homey": "适用于 iPhone、iPad、Apple TV 和 Homey 的 App", "View (more apps)": "查看" }
  };
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  Object.keys(V).forEach(function (lang) {
    var tab = all[lang] = all[lang] || {};
    Object.keys(V[lang]).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(tab, k)) tab[k] = V[lang][k]; });
  });
})();
