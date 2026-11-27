/*
 * Build 191: tabbladen op de detailpagina. Sleutel = Engels (terugval); hier de andere talen.
 * Niets overschrijven wat er al staat.
 */
(function () {
  'use strict';
  var T = {
    "ar": {
      "More like this": "المزيد مثل هذا",
      "Trailers": "الإعلانات"
    },
    "de": {
      "More like this": "Mehr davon",
      "Trailers": "Trailer"
    },
    "es": {
      "More like this": "Más como esto",
      "Trailers": "Tráileres"
    },
    "fr": {
      "More like this": "Plus comme ça",
      "Trailers": "Bandes-annonces"
    },
    "it": {
      "More like this": "Altri simili",
      "Trailers": "Trailer"
    },
    "nl": {
      "More like this": "Meer zoals dit",
      "Trailers": "Trailers"
    },
    "pl": {
      "More like this": "Podobne",
      "Trailers": "Zwiastuny"
    },
    "pt": {
      "More like this": "Mais como este",
      "Trailers": "Trailers"
    },
    "tr": {
      "More like this": "Buna benzer",
      "Trailers": "Fragmanlar"
    },
    "zh-Hans": {
      "More like this": "更多类似内容",
      "Trailers": "预告片"
    }
  };
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  Object.keys(T).forEach(function (lang) {
    var tab = all[lang] = all[lang] || {};
    Object.keys(T[lang]).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(tab, k)) tab[k] = T[lang][k]; });
  });
})();
