/*
 * Build 128: teksten van "één lijst over alle servers" (js/xs.js): de melding als een titel van een verwijderde server
 * (of die niet meer op zijn server staat) nergens gevonden is, en de knoppen. Sleutel = Engels (terugval).
 */
(function () {
  'use strict';
  var K = [
    'Unknown title',
    '“%@” was on “%@”, but that server has been removed. This title wasn’t found on your other servers (%@).',
    '“%@” is no longer on “%@” and wasn’t found on %@ either.',
    '“%@” was on “%@”, but that server has been removed, and you have no other server to search.',
    '“%@” is no longer on “%@”, and you have no other server to search.',
    'Remove from %@',
    'Removed',
    'the collection “%@”',
    'a removed server',
    'Show categories',
    'Turn categories on or off for this profile. Applies to all your servers.'
  ];
  var V = {
    nl: ['Onbekende titel',
      '‘%@’ stond op ‘%@’, maar die server is verwijderd. Op je andere servers (%@) is deze titel niet gevonden.',
      '‘%@’ staat niet meer op ‘%@’ en is ook niet gevonden op %@.',
      '‘%@’ stond op ‘%@’, maar die server is verwijderd, en je hebt geen andere server waarop we kunnen zoeken.',
      '‘%@’ staat niet meer op ‘%@’, en je hebt geen andere server waarop we kunnen zoeken.',
      'Verwijderen uit %@', 'Verwijderd', 'collectie ‘%@’', 'een verwijderde server', 'Categorieën tonen', 'Zet categorieën aan of uit voor dit profiel. Geldt voor al je servers.'],
    de: ['Unbekannter Titel',
      '‘%@’ war auf ‘%@’, aber dieser Server wurde gelöscht. Auf deinen anderen Servern (%@) wurde dieser Titel nicht gefunden.',
      '‘%@’ ist nicht mehr auf ‘%@’ und wurde auch nicht auf %@ gefunden.',
      '‘%@’ war auf ‘%@’, aber dieser Server wurde gelöscht, und du hast keinen anderen Server, auf dem wir suchen können.',
      '‘%@’ ist nicht mehr auf ‘%@’, und du hast keinen anderen Server, auf dem wir suchen können.',
      'Aus %@ entfernen', 'Entfernt', 'der Sammlung ‘%@’', 'einem gelöschten Server', 'Kategorien anzeigen', 'Schalte Kategorien für dieses Profil ein oder aus. Gilt für alle deine Server.'],
    fr: ['Titre inconnu',
      '‘%@’ était sur ‘%@’, mais ce serveur a été supprimé. Ce titre est introuvable sur tes autres serveurs (%@).',
      '‘%@’ n’est plus sur ‘%@’ et est également introuvable sur %@.',
      '‘%@’ était sur ‘%@’, mais ce serveur a été supprimé, et tu n’as aucun autre serveur sur lequel chercher.',
      '‘%@’ n’est plus sur ‘%@’, et tu n’as aucun autre serveur sur lequel chercher.',
      'Retirer de %@', 'Retiré', 'la collection ‘%@’', 'un serveur supprimé', 'Afficher les catégories', 'Active ou désactive des catégories pour ce profil. S’applique à tous tes serveurs.'],
    es: ['Título desconocido',
      '‘%@’ estaba en ‘%@’, pero ese servidor se ha eliminado. Este título no se encontró en tus otros servidores (%@).',
      '‘%@’ ya no está en ‘%@’ y tampoco se encontró en %@.',
      '‘%@’ estaba en ‘%@’, pero ese servidor se ha eliminado y no tienes otro servidor en el que buscar.',
      '‘%@’ ya no está en ‘%@’ y no tienes otro servidor en el que buscar.',
      'Quitar de %@', 'Quitado', 'la colección ‘%@’', 'un servidor eliminado', 'Mostrar categorías', 'Activa o desactiva categorías para este perfil. Se aplica a todos tus servidores.'],
    it: ['Titolo sconosciuto',
      '‘%@’ era su ‘%@’, ma quel server è stato eliminato. Questo titolo non è stato trovato sugli altri tuoi server (%@).',
      '‘%@’ non è più su ‘%@’ e non è stato trovato nemmeno su %@.',
      '‘%@’ era su ‘%@’, ma quel server è stato eliminato e non hai altri server su cui cercare.',
      '‘%@’ non è più su ‘%@’ e non hai altri server su cui cercare.',
      'Rimuovi da %@', 'Rimosso', 'la raccolta ‘%@’', 'un server eliminato', 'Mostra categorie', 'Attiva o disattiva le categorie per questo profilo. Vale per tutti i tuoi server.'],
    pt: ['Título desconhecido',
      '‘%@’ estava em ‘%@’, mas esse servidor foi eliminado. Este título não foi encontrado nos teus outros servidores (%@).',
      '‘%@’ já não está em ‘%@’ e também não foi encontrado em %@.',
      '‘%@’ estava em ‘%@’, mas esse servidor foi eliminado e não tens outro servidor onde procurar.',
      '‘%@’ já não está em ‘%@’ e não tens outro servidor onde procurar.',
      'Remover de %@', 'Removido', 'a coleção ‘%@’', 'um servidor eliminado', 'Mostrar categorias', 'Ativa ou desativa categorias para este perfil. Aplica-se a todos os teus servidores.'],
    pl: ['Nieznany tytuł',
      '‘%@’ był na ‘%@’, ale ten serwer został usunięty. Nie znaleziono tego tytułu na Twoich innych serwerach (%@).',
      '‘%@’ nie ma już na ‘%@’ i nie znaleziono go też na %@.',
      '‘%@’ był na ‘%@’, ale ten serwer został usunięty, a nie masz innego serwera, na którym możemy szukać.',
      '‘%@’ nie ma już na ‘%@’, a nie masz innego serwera, na którym możemy szukać.',
      'Usuń z: %@', 'Usunięto', 'kolekcja ‘%@’', 'usuniętym serwerze', 'Pokaż kategorie', 'Włącz lub wyłącz kategorie dla tego profilu. Dotyczy wszystkich Twoich serwerów.'],
    tr: ['Bilinmeyen başlık',
      '‘%@’, ‘%@’ üzerindeydi ama bu sunucu silindi. Bu başlık diğer sunucularında (%@) bulunamadı.',
      '‘%@’ artık ‘%@’ üzerinde değil ve %@ üzerinde de bulunamadı.',
      '‘%@’, ‘%@’ üzerindeydi ama bu sunucu silindi ve arayabileceğimiz başka bir sunucun yok.',
      '‘%@’ artık ‘%@’ üzerinde değil ve arayabileceğimiz başka bir sunucun yok.',
      'Şuradan kaldır: %@', 'Kaldırıldı', '‘%@’ koleksiyonu', 'silinmiş bir sunucu', 'Kategorileri göster', 'Bu profil için kategorileri aç veya kapat. Tüm sunucuların için geçerlidir.'],
    ar: ['عنوان غير معروف',
      'كان ‘%@’ على ‘%@’، لكن هذا الخادم حُذف. لم يُعثر على هذا العنوان في خوادمك الأخرى (%@).',
      'لم يعد ‘%@’ على ‘%@’ ولم يُعثر عليه أيضًا في %@.',
      'كان ‘%@’ على ‘%@’، لكن هذا الخادم حُذف، وليس لديك خادم آخر يمكننا البحث فيه.',
      'لم يعد ‘%@’ على ‘%@’، وليس لديك خادم آخر يمكننا البحث فيه.',
      'إزالة من %@', 'تمت الإزالة', 'المجموعة ‘%@’', 'خادم محذوف', 'إظهار الفئات', 'شغّل الفئات أو أوقفها لهذا الملف الشخصي. ينطبق على كل خوادمك.'],
    'zh-Hans': ['未知标题',
      '‘%@’ 原在 ‘%@’ 上，但该服务器已被删除。在你的其他服务器（%@）上未找到此标题。',
      '‘%@’ 已不在 ‘%@’ 上，在 %@ 上也未找到。',
      '‘%@’ 原在 ‘%@’ 上，但该服务器已被删除，而且你没有其他可供搜索的服务器。',
      '‘%@’ 已不在 ‘%@’ 上，而且你没有其他可供搜索的服务器。',
      '从%@中移除', '已移除', '合集 ‘%@’', '已删除的服务器', '显示分类', '为此个人资料开启或关闭分类。适用于你的所有服务器。']
  };
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  Object.keys(V).forEach(function (lang) {
    var tab = all[lang] = all[lang] || {};
    K.forEach(function (k, i) { if (V[lang][i] != null && !Object.prototype.hasOwnProperty.call(tab, k)) tab[k] = V[lang][i]; });
  });
})();
