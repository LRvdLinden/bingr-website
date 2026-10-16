/*
 * Build 111: teksten van de rijen Nieuw toegevoegd, Binnenkort op Bingr en Nieuw op Bingr (js/discover.js; namen build 112), gelijk aan
 * Shared/Resources/Translations.json van iptv-ios-appletv. Sleutel = Engels. Worden toegevoegd aan BINGR_STRINGS;
 * "Recently added" heet in het Nederlands voortaan "Nieuw toegevoegd" (overschrijft de oude tekst).
 */
(function () {
  'use strict';
  // build 112: de bronvermelding (TMDB, JustWatch) staat in Instellingen → Over in plaats van onder de rijen
  var K = ['Coming soon to Bingr', 'New on Bingr', 'Movie and series data: TMDB. This app uses the TMDB API but is not endorsed or certified by TMDB. Availability data: JustWatch.', 'Release date: %@'];
  var V = {
    nl: ['Binnenkort op Bingr', 'Nieuw op Bingr', 'Film- en seriegegevens: TMDB. Deze app gebruikt de TMDB-API maar wordt niet door TMDB ondersteund of gecertificeerd. Beschikbaarheidsgegevens: JustWatch.', 'Releasedatum: %@'],
    de: ['Demnächst auf Bingr', 'Neu auf Bingr', 'Film- und Seriendaten: TMDB. Diese App verwendet die TMDB-API, wird aber nicht von TMDB unterstützt oder zertifiziert. Verfügbarkeitsdaten: JustWatch.', 'Erscheinungsdatum: %@'],
    fr: ['Prochainement sur Bingr', 'Nouveau sur Bingr', 'Données des films et séries : TMDB. Cette application utilise l’API TMDB mais n’est ni approuvée ni certifiée par TMDB. Données de disponibilité : JustWatch.', 'Date de sortie : %@'],
    es: ['Próximamente en Bingr', 'Novedades en Bingr', 'Datos de películas y series: TMDB. Esta aplicación usa la API de TMDB, pero TMDB no la respalda ni la certifica. Datos de disponibilidad: JustWatch.', 'Fecha de estreno: %@'],
    it: ['Prossimamente su Bingr', 'Novità su Bingr', 'Dati di film e serie: TMDB. Questa app usa l’API di TMDB ma non è approvata né certificata da TMDB. Dati sulla disponibilità: JustWatch.', 'Data di uscita: %@'],
    pt: ['Brevemente no Bingr', 'Novidades no Bingr', 'Dados de filmes e séries: TMDB. Esta aplicação utiliza a API do TMDB, mas não é aprovada nem certificada pelo TMDB. Dados de disponibilidade: JustWatch.', 'Data de estreia: %@'],
    pl: ['Wkrótce w Bingr', 'Nowości w Bingr', 'Dane filmów i seriali: TMDB. Ta aplikacja korzysta z API TMDB, ale nie jest wspierana ani certyfikowana przez TMDB. Dane o dostępności: JustWatch.', 'Data premiery: %@'],
    tr: ['Yakında Bingr\'da', 'Bingr\'da yeni', 'Film ve dizi verileri: TMDB. Bu uygulama TMDB API\'sini kullanır ancak TMDB tarafından desteklenmez veya onaylanmaz. Yayın durumu verileri: JustWatch.', 'Çıkış tarihi: %@'],
    ar: ['قريبًا على Bingr', 'جديد على Bingr', 'بيانات الأفلام والمسلسلات: TMDB. يستخدم هذا التطبيق واجهة TMDB البرمجية لكنه غير معتمد أو مصدّق من TMDB. بيانات التوفر: JustWatch.', 'تاريخ الإصدار: %@'],
    'zh-Hans': ['即将登陆 Bingr', 'Bingr 新上线', '影视数据：TMDB。本应用使用 TMDB API，但未获得 TMDB 的认可或认证。片源信息：JustWatch。', '上映日期：%@']
  };
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  Object.keys(V).forEach(function (lang) {
    var tab = all[lang] = all[lang] || {};
    K.forEach(function (k, i) { if (V[lang][i] != null && !Object.prototype.hasOwnProperty.call(tab, k)) tab[k] = V[lang][i]; });
  });
  all.nl['Recently added'] = 'Nieuw toegevoegd';
})();
