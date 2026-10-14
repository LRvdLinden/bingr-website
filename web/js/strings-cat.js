/*
 * Teksten van Categorieën in de webspeler (genres uit TMDB en de categorieën van je server). Sleutel = Engels.
 * Worden toegevoegd aan BINGR_STRINGS (een sleutel die er al is, blijft staan).
 */
(function () {
  'use strict';
  var K = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror',
    'Music', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western', 'Reality',
    'Categories', 'Genres', 'From your server', 'Explore your movies and series by genre.', 'Popular', 'Newest', 'A–Z', 'Rating', 'Sort',
    '%d titles', '1 title', 'Filling in genres…', 'No titles in this category yet.', 'Category not found', 'All categories',
    'Genres appear here as soon as the details of your movies and series are loaded.'];
  // per taal in dezelfde volgorde als K
  var V = {
    nl: ['Actie', 'Avontuur', 'Animatie', 'Komedie', 'Misdaad', 'Documentaire', 'Drama', 'Familie', 'Fantasy', 'Geschiedenis', 'Horror',
      'Muziek', 'Mysterie', 'Romantiek', 'Sci-Fi', 'Thriller', 'Oorlog', 'Western', 'Reality',
      'Categorieën', 'Genres', 'Van je server', 'Ontdek je films en series per genre.', 'Populair', 'Nieuwste', 'A–Z', 'Beoordeling', 'Sorteren',
      '%d titels', '1 titel', 'Bezig met aanvullen…', 'Nog geen titels in deze categorie.', 'Categorie niet gevonden', 'Alle categorieën',
      'Genres verschijnen hier zodra de gegevens van je films en series geladen zijn.'],
    de: ['Action', 'Abenteuer', 'Animation', 'Komödie', 'Krimi', 'Dokumentation', 'Drama', 'Familie', 'Fantasy', 'Historie', 'Horror',
      'Musik', 'Mystery', 'Romantik', 'Sci-Fi', 'Thriller', 'Krieg', 'Western', 'Reality',
      'Kategorien', 'Genres', 'Von deinem Server', 'Entdecke deine Filme und Serien nach Genre.', 'Beliebt', 'Neueste', 'A–Z', 'Bewertung', 'Sortieren',
      '%d Titel', '1 Titel', 'Genres werden ergänzt…', 'Noch keine Titel in dieser Kategorie.', 'Kategorie nicht gefunden', 'Alle Kategorien',
      'Genres erscheinen hier, sobald die Details deiner Filme und Serien geladen sind.'],
    fr: ['Action', 'Aventure', 'Animation', 'Comédie', 'Policier', 'Documentaire', 'Drame', 'Famille', 'Fantastique', 'Histoire', 'Horreur',
      'Musique', 'Mystère', 'Romance', 'Science-fiction', 'Thriller', 'Guerre', 'Western', 'Téléréalité',
      'Catégories', 'Genres', 'Depuis ton serveur', 'Découvre tes films et séries par genre.', 'Populaires', 'Plus récents', 'A–Z', 'Note', 'Trier',
      '%d titres', '1 titre', 'Complétion des genres…', 'Aucun titre dans cette catégorie pour l’instant.', 'Catégorie introuvable', 'Toutes les catégories',
      'Les genres apparaissent ici dès que les détails de tes films et séries sont chargés.'],
    es: ['Acción', 'Aventura', 'Animación', 'Comedia', 'Crimen', 'Documental', 'Drama', 'Familia', 'Fantasía', 'Historia', 'Terror',
      'Música', 'Misterio', 'Romance', 'Ciencia ficción', 'Suspense', 'Bélica', 'Western', 'Reality',
      'Categorías', 'Géneros', 'De tu servidor', 'Descubre tus películas y series por género.', 'Populares', 'Más recientes', 'A–Z', 'Valoración', 'Ordenar',
      '%d títulos', '1 título', 'Completando géneros…', 'Aún no hay títulos en esta categoría.', 'Categoría no encontrada', 'Todas las categorías',
      'Los géneros aparecen aquí en cuanto se cargan los detalles de tus películas y series.'],
    it: ['Azione', 'Avventura', 'Animazione', 'Commedia', 'Crimine', 'Documentario', 'Drammatico', 'Famiglia', 'Fantasy', 'Storia', 'Horror',
      'Musica', 'Mistero', 'Romantico', 'Fantascienza', 'Thriller', 'Guerra', 'Western', 'Reality',
      'Categorie', 'Generi', 'Dal tuo server', 'Scopri i tuoi film e le tue serie per genere.', 'Popolari', 'Più recenti', 'A–Z', 'Valutazione', 'Ordina',
      '%d titoli', '1 titolo', 'Completamento dei generi…', 'Ancora nessun titolo in questa categoria.', 'Categoria non trovata', 'Tutte le categorie',
      'I generi appaiono qui non appena vengono caricati i dettagli dei tuoi film e delle tue serie.'],
    pt: ['Ação', 'Aventura', 'Animação', 'Comédia', 'Crime', 'Documentário', 'Drama', 'Família', 'Fantasia', 'História', 'Terror',
      'Música', 'Mistério', 'Romance', 'Ficção científica', 'Suspense', 'Guerra', 'Faroeste', 'Reality',
      'Categorias', 'Gêneros', 'Do seu servidor', 'Descubra seus filmes e séries por gênero.', 'Populares', 'Mais recentes', 'A–Z', 'Avaliação', 'Ordenar',
      '%d títulos', '1 título', 'Completando gêneros…', 'Ainda não há títulos nesta categoria.', 'Categoria não encontrada', 'Todas as categorias',
      'Os gêneros aparecem aqui assim que os detalhes dos seus filmes e séries forem carregados.'],
    pl: ['Akcja', 'Przygodowe', 'Animacja', 'Komedia', 'Kryminał', 'Dokumentalne', 'Dramat', 'Familijne', 'Fantasy', 'Historyczne', 'Horror',
      'Muzyczne', 'Tajemnica', 'Romans', 'Sci-Fi', 'Thriller', 'Wojenne', 'Western', 'Reality',
      'Kategorie', 'Gatunki', 'Z twojego serwera', 'Odkrywaj filmy i seriale według gatunku.', 'Popularne', 'Najnowsze', 'A–Z', 'Ocena', 'Sortuj',
      '%d tytułów', '1 tytuł', 'Uzupełnianie gatunków…', 'Brak tytułów w tej kategorii.', 'Nie znaleziono kategorii', 'Wszystkie kategorie',
      'Gatunki pojawią się tutaj, gdy tylko zostaną wczytane szczegóły twoich filmów i seriali.'],
    tr: ['Aksiyon', 'Macera', 'Animasyon', 'Komedi', 'Suç', 'Belgesel', 'Dram', 'Aile', 'Fantastik', 'Tarih', 'Korku',
      'Müzik', 'Gizem', 'Romantik', 'Bilim Kurgu', 'Gerilim', 'Savaş', 'Western', 'Reality',
      'Kategoriler', 'Türler', 'Sunucundan', 'Film ve dizilerini türe göre keşfet.', 'Popüler', 'En yeni', 'A–Z', 'Puan', 'Sırala',
      '%d yapım', '1 yapım', 'Türler tamamlanıyor…', 'Bu kategoride henüz yapım yok.', 'Kategori bulunamadı', 'Tüm kategoriler',
      'Film ve dizilerinin ayrıntıları yüklenir yüklenmez türler burada görünür.'],
    ar: ['أكشن', 'مغامرة', 'رسوم متحركة', 'كوميديا', 'جريمة', 'وثائقي', 'دراما', 'عائلي', 'فانتازيا', 'تاريخي', 'رعب',
      'موسيقى', 'غموض', 'رومانسي', 'خيال علمي', 'إثارة', 'حرب', 'ويسترن', 'واقع',
      'الفئات', 'الأنواع', 'من خادمك', 'اكتشف أفلامك ومسلسلاتك حسب النوع.', 'الأكثر شيوعًا', 'الأحدث', 'أ–ي', 'التقييم', 'ترتيب',
      '%d عنوان', 'عنوان واحد', 'جارٍ إكمال الأنواع…', 'لا توجد عناوين في هذه الفئة بعد.', 'الفئة غير موجودة', 'كل الفئات',
      'تظهر الأنواع هنا بمجرد تحميل تفاصيل أفلامك ومسلسلاتك.'],
    'zh-Hans': ['动作', '冒险', '动画', '喜剧', '犯罪', '纪录片', '剧情', '家庭', '奇幻', '历史', '恐怖',
      '音乐', '悬疑', '爱情', '科幻', '惊悚', '战争', '西部', '真人秀',
      '分类', '类型', '来自你的服务器', '按类型浏览你的电影和剧集。', '热门', '最新', 'A–Z', '评分', '排序',
      '%d 部', '1 部', '正在补充类型…', '此分类中还没有内容。', '未找到分类', '所有分类',
      '电影和剧集的详细信息加载后，类型会显示在这里。']
  };
  // enkelvoud (kop van een genrepagina)
  K.push('Genre');
  var G = { nl: 'Genre', de: 'Genre', fr: 'Genre', es: 'Género', it: 'Genere', pt: 'Gênero', pl: 'Gatunek', tr: 'Tür', ar: 'النوع', 'zh-Hans': '类型' };
  Object.keys(G).forEach(function (l) { V[l].push(G[l]); });
  // build 86: rij Categorieën op Home en in de indeling van het startscherm
  K.push('%d categories', '5 rows below Live now');
  var H = {
    nl: ['%d categorieën', '5 rijen onder Nu live'], de: ['%d Kategorien', '5 Reihen unter Jetzt live'],
    fr: ['%d catégories', '5 rangées sous En direct'], es: ['%d categorías', '5 filas debajo de En directo'],
    it: ['%d categorie', '5 righe sotto In diretta'], pt: ['%d categorias', '5 fileiras abaixo de Em direto'],
    pl: ['Kategorie: %d', '5 rzędów pod Teraz na żywo'], tr: ['%d kategori', 'Şimdi canlı’nın 5 sıra altında'],
    ar: ['%d فئة', '5 صفوف أسفل مباشر الآن'], 'zh-Hans': ['%d 个分类', '“正在直播”下方 5 行']
  };
  Object.keys(H).forEach(function (l) { V[l].push(H[l][0], H[l][1]); });
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  Object.keys(V).forEach(function (lang) {
    var tab = all[lang] = all[lang] || {};
    K.forEach(function (k, i) { if (V[lang][i] != null && !Object.prototype.hasOwnProperty.call(tab, k)) tab[k] = V[lang][i]; });
  });
})();
