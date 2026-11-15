/*
 * Build 178: sport-logo's (vermelding onderaan het sportoverzicht, tekst van Weekdot). Sleutel = Engels (terugval); hier de
 * andere talen van de apps (zelfde teksten als Translations.json van Apple en Android). Niets overschrijven wat er al staat.
 */
(function () {
  'use strict';
  var T = {
    "ar": {
      "Logos and crests are trademarks of their respective owners and are shown for identification only.": "الشعارات علامات تجارية لمالكيها وتُعرض لأغراض التعريف فقط."
    },
    "de": {
      "Logos and crests are trademarks of their respective owners and are shown for identification only.": "Logos und Wappen sind Marken ihrer jeweiligen Inhaber und werden nur zur Identifizierung angezeigt."
    },
    "es": {
      "Logos and crests are trademarks of their respective owners and are shown for identification only.": "Los logotipos y escudos son marcas comerciales de sus respectivos propietarios y se muestran solo a efectos de identificación."
    },
    "fr": {
      "Logos and crests are trademarks of their respective owners and are shown for identification only.": "Les logos et écussons sont des marques de leurs propriétaires respectifs et ne sont affichés qu’à des fins d’identification."
    },
    "it": {
      "Logos and crests are trademarks of their respective owners and are shown for identification only.": "Loghi e stemmi sono marchi dei rispettivi proprietari e sono mostrati solo a scopo identificativo."
    },
    "nl": {
      "Logos and crests are trademarks of their respective owners and are shown for identification only.": "Logo's en clubwapens zijn handelsmerken van hun respectieve eigenaren en worden alleen ter herkenning getoond."
    },
    "pl": {
      "Logos and crests are trademarks of their respective owners and are shown for identification only.": "Logo i herby są znakami towarowymi ich właścicieli i są pokazywane wyłącznie w celach identyfikacyjnych."
    },
    "pt": {
      "Logos and crests are trademarks of their respective owners and are shown for identification only.": "Os logótipos e emblemas são marcas comerciais dos respetivos proprietários e são apresentados apenas para identificação."
    },
    "tr": {
      "Logos and crests are trademarks of their respective owners and are shown for identification only.": "Logolar ve armalar ilgili sahiplerinin ticari markalarıdır ve yalnızca tanımlama amacıyla gösterilir."
    },
    "zh-Hans": {
      "Logos and crests are trademarks of their respective owners and are shown for identification only.": "标志和队徽是其各自所有者的商标，仅用于识别目的。"
    }
  };
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  Object.keys(T).forEach(function (lang) {
    var tab = all[lang] = all[lang] || {};
    Object.keys(T[lang]).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(tab, k)) tab[k] = T[lang][k]; });
  });
})();
