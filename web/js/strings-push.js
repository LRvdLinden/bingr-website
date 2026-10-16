/*
 * Teksten van de pushmeldingen in de webspeler (js/push.js, Instellingen → App → Pushmeldingen). Sleutel = Engels.
 * Worden toegevoegd aan BINGR_STRINGS (alle talen van de webspeler).
 */
(function () {
  'use strict';
  var K = [
    'Push notifications',
    'Push notifications are on.',
    'Get notifications for messages from Bingr and for reminders you set in the Bingr app, also when this tab is closed.',
    'On iPhone and iPad, notifications only work when Bingr is on your Home Screen: tap Share → Add to Home Screen, open Bingr from there and turn this on.',
    'This browser doesn’t support notifications.',
    'Notifications are blocked for bingr.online. Allow them in your browser’s site settings and try again.',
    'Couldn’t turn on notifications. Please try again later.'
  ];
  var V = {
    nl: ['Pushmeldingen', 'Pushmeldingen staan aan.',
      'Krijg een melding bij berichten van Bingr en bij herinneringen die je in de Bingr-app zet, ook als dit tabblad dicht is.',
      'Op iPhone en iPad werken meldingen alleen als Bingr op je beginscherm staat: tik op Deel → Zet op beginscherm, open Bingr van daaruit en zet dit aan.',
      'Deze browser ondersteunt geen meldingen.',
      'Meldingen zijn geblokkeerd voor bingr.online. Sta ze toe in de site-instellingen van je browser en probeer het opnieuw.',
      'Meldingen aanzetten is niet gelukt. Probeer het later opnieuw.'],
    de: ['Push-Mitteilungen', 'Push-Mitteilungen sind aktiviert.',
      'Erhalte Mitteilungen zu Nachrichten von Bingr und zu Erinnerungen, die du in der Bingr-App setzt, auch wenn dieser Tab geschlossen ist.',
      'Auf iPhone und iPad funktionieren Mitteilungen nur, wenn Bingr auf deinem Home-Bildschirm ist: Tippe auf Teilen → Zum Home-Bildschirm, öffne Bingr von dort und aktiviere dies.',
      'Dieser Browser unterstützt keine Mitteilungen.',
      'Mitteilungen sind für bingr.online blockiert. Erlaube sie in den Website-Einstellungen deines Browsers und versuche es erneut.',
      'Mitteilungen konnten nicht aktiviert werden. Bitte versuche es später erneut.'],
    fr: ['Notifications push', 'Les notifications push sont activées.',
      'Recevez une notification pour les messages de Bingr et pour les rappels que vous créez dans l’app Bingr, même quand cet onglet est fermé.',
      'Sur iPhone et iPad, les notifications ne fonctionnent que si Bingr est sur votre écran d’accueil : touchez Partager → Sur l’écran d’accueil, ouvrez Bingr depuis là et activez cette option.',
      'Ce navigateur ne prend pas en charge les notifications.',
      'Les notifications sont bloquées pour bingr.online. Autorisez-les dans les réglages du site de votre navigateur et réessayez.',
      'Impossible d’activer les notifications. Réessayez plus tard.'],
    es: ['Notificaciones push', 'Las notificaciones push están activadas.',
      'Recibe una notificación con los mensajes de Bingr y los recordatorios que crees en la app Bingr, incluso con esta pestaña cerrada.',
      'En iPhone y iPad, las notificaciones solo funcionan si Bingr está en tu pantalla de inicio: toca Compartir → Añadir a pantalla de inicio, abre Bingr desde allí y activa esta opción.',
      'Este navegador no admite notificaciones.',
      'Las notificaciones están bloqueadas para bingr.online. Permítelas en los ajustes del sitio de tu navegador e inténtalo de nuevo.',
      'No se han podido activar las notificaciones. Inténtalo más tarde.'],
    it: ['Notifiche push', 'Le notifiche push sono attive.',
      'Ricevi una notifica per i messaggi di Bingr e per i promemoria che imposti nell’app Bingr, anche quando questa scheda è chiusa.',
      'Su iPhone e iPad le notifiche funzionano solo se Bingr è nella schermata Home: tocca Condividi → Aggiungi alla schermata Home, apri Bingr da lì e attiva questa opzione.',
      'Questo browser non supporta le notifiche.',
      'Le notifiche sono bloccate per bingr.online. Consentile nelle impostazioni del sito del browser e riprova.',
      'Impossibile attivare le notifiche. Riprova più tardi.'],
    pt: ['Notificações push', 'As notificações push estão ativadas.',
      'Receba uma notificação para mensagens da Bingr e para lembretes que definir na app Bingr, mesmo com este separador fechado.',
      'No iPhone e iPad, as notificações só funcionam se a Bingr estiver no ecrã principal: toque em Partilhar → Adicionar ao ecrã principal, abra a Bingr a partir daí e ative esta opção.',
      'Este navegador não suporta notificações.',
      'As notificações estão bloqueadas para bingr.online. Permita-as nas definições do site do navegador e tente novamente.',
      'Não foi possível ativar as notificações. Tente novamente mais tarde.'],
    pl: ['Powiadomienia push', 'Powiadomienia push są włączone.',
      'Otrzymuj powiadomienia o wiadomościach od Bingr i o przypomnieniach ustawionych w aplikacji Bingr, także gdy ta karta jest zamknięta.',
      'Na iPhonie i iPadzie powiadomienia działają tylko wtedy, gdy Bingr jest na ekranie początkowym: stuknij Udostępnij → Do ekranu początkowego, otwórz stamtąd Bingr i włącz tę opcję.',
      'Ta przeglądarka nie obsługuje powiadomień.',
      'Powiadomienia dla bingr.online są zablokowane. Zezwól na nie w ustawieniach witryny w przeglądarce i spróbuj ponownie.',
      'Nie udało się włączyć powiadomień. Spróbuj ponownie później.'],
    tr: ['Anlık bildirimler', 'Anlık bildirimler açık.',
      'Bu sekme kapalıyken bile Bingr\'dan gelen mesajlar ve Bingr uygulamasında kurduğun hatırlatıcılar için bildirim al.',
      'iPhone ve iPad\'de bildirimler yalnızca Bingr ana ekranındaysa çalışır: Paylaş → Ana Ekrana Ekle\'ye dokun, Bingr\'ı oradan aç ve bunu etkinleştir.',
      'Bu tarayıcı bildirimleri desteklemiyor.',
      'bingr.online için bildirimler engellendi. Tarayıcının site ayarlarından izin ver ve tekrar dene.',
      'Bildirimler açılamadı. Lütfen daha sonra tekrar dene.'],
    ar: ['الإشعارات الفورية', 'الإشعارات الفورية مفعّلة.',
      'تلقَّ إشعارًا برسائل Bingr وبالتذكيرات التي تضبطها في تطبيق Bingr، حتى عندما تكون علامة التبويب هذه مغلقة.',
      'على iPhone وiPad تعمل الإشعارات فقط عندما يكون Bingr على الشاشة الرئيسية: اضغط مشاركة ← إضافة إلى الشاشة الرئيسية، ثم افتح Bingr من هناك وفعّل هذا الخيار.',
      'هذا المتصفح لا يدعم الإشعارات.',
      'الإشعارات محظورة لموقع bingr.online. اسمح بها في إعدادات الموقع في متصفحك ثم حاول مرة أخرى.',
      'تعذّر تفعيل الإشعارات. يُرجى المحاولة لاحقًا.'],
    'zh-Hans': ['推送通知', '推送通知已开启。',
      '即使关闭此标签页，也能收到 Bingr 的消息以及你在 Bingr App 中设置的提醒通知。',
      '在 iPhone 和 iPad 上，只有将 Bingr 添加到主屏幕后才能收到通知：轻点“共享”→“添加到主屏幕”，从主屏幕打开 Bingr 后再开启此项。',
      '此浏览器不支持通知。',
      'bingr.online 的通知已被阻止。请在浏览器的网站设置中允许通知，然后重试。',
      '无法开启通知，请稍后再试。']
  };
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  Object.keys(V).forEach(function (lang) {
    var tab = all[lang] = all[lang] || {};
    K.forEach(function (k, i) { if (V[lang][i] != null && !Object.prototype.hasOwnProperty.call(tab, k)) tab[k] = V[lang][i]; });
  });
})();
