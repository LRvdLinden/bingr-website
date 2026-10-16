/*
 * Build 111: teksten van de rijen Nieuw toegevoegd, Binnenkort en Nieuw op streamingdiensten (js/discover.js), gelijk aan
 * Shared/Resources/Translations.json van iptv-ios-appletv. Sleutel = Engels. Worden toegevoegd aan BINGR_STRINGS;
 * "Recently added" heet in het Nederlands voortaan "Nieuw toegevoegd" (overschrijft de oude tekst).
 */
(function () {
  'use strict';
  var K = ['Coming soon', 'New on streaming', 'Data: TMDB', 'Data: TMDB · via JustWatch', 'Release date: %@'];
  var V = {
    nl: ['Binnenkort', 'Nieuw op streamingdiensten', 'Gegevens: TMDB', 'Gegevens: TMDB · via JustWatch', 'Releasedatum: %@'],
    de: ['Demnächst', 'Neu bei Streamingdiensten', 'Daten: TMDB', 'Daten: TMDB · über JustWatch', 'Erscheinungsdatum: %@'],
    fr: ['Prochainement', 'Nouveau en streaming', 'Données : TMDB', 'Données : TMDB · via JustWatch', 'Date de sortie : %@'],
    es: ['Próximamente', 'Novedades en streaming', 'Datos: TMDB', 'Datos: TMDB · a través de JustWatch', 'Fecha de estreno: %@'],
    it: ['Prossimamente', 'Novità in streaming', 'Dati: TMDB', 'Dati: TMDB · tramite JustWatch', 'Data di uscita: %@'],
    pt: ['Brevemente', 'Novidades no streaming', 'Dados: TMDB', 'Dados: TMDB · via JustWatch', 'Data de estreia: %@'],
    pl: ['Wkrótce', 'Nowości w serwisach streamingowych', 'Dane: TMDB', 'Dane: TMDB · przez JustWatch', 'Data premiery: %@'],
    tr: ['Yakında', 'Dijital platformlarda yeni', 'Veriler: TMDB', 'Veriler: TMDB · JustWatch aracılığıyla', 'Çıkış tarihi: %@'],
    ar: ['قريبًا', 'جديد على منصات البث', 'البيانات: TMDB', 'البيانات: TMDB · عبر JustWatch', 'تاريخ الإصدار: %@'],
    'zh-Hans': ['即将上映', '流媒体新上线', '数据：TMDB', '数据：TMDB · 来自 JustWatch', '上映日期：%@']
  };
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  Object.keys(V).forEach(function (lang) {
    var tab = all[lang] = all[lang] || {};
    K.forEach(function (k, i) { if (V[lang][i] != null && !Object.prototype.hasOwnProperty.call(tab, k)) tab[k] = V[lang][i]; });
  });
  all.nl['Recently added'] = 'Nieuw toegevoegd';
})();
