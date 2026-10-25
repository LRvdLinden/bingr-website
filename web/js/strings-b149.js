/*
 * Build 149: teksten van de webspeler voor de rij "Ontdek categorieën" op Home. Sleutel = Engels (terugval).
 * Niets overschrijven wat er al staat.
 */
(function () {
  'use strict';
  var V = {"nl": {"Discover categories": "Ontdek categorieën"}, "de": {"Discover categories": "Kategorien entdecken"}, "fr": {"Discover categories": "Découvrir les catégories"}, "es": {"Discover categories": "Descubre categorías"}, "it": {"Discover categories": "Scopri le categorie"}, "pt": {"Discover categories": "Descobrir categorias"}, "pl": {"Discover categories": "Odkryj kategorie"}, "tr": {"Discover categories": "Kategorileri keşfet"}, "ar": {"Discover categories": "اكتشف الفئات"}, "zh-Hans": {"Discover categories": "发现分类"}};
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  Object.keys(V).forEach(function (lang) {
    var tab = all[lang] = all[lang] || {};
    Object.keys(V[lang]).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(tab, k)) tab[k] = V[lang][k]; });
  });
})();
