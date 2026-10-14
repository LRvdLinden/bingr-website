/*
 * Teksten van de webspeler sinds build 83: HLS voor films en series, diagnose bij een afspeelfout ("Details") en
 * trailers automatisch in de kop. Los van strings-web.js; "Play trailers automatically", "Sound on" en "Sound off"
 * komen uit Shared/Resources/Translations.json van iptv-ios-appletv (build 82), de rest is Nederlands (anders Engels).
 * Worden toegevoegd aan BINGR_STRINGS (een sleutel die er al is, blijft staan).
 */
(function () {
  'use strict';
  var T = {
 "ar": {
  "Play trailers automatically": "تشغيل الإعلانات تلقائيًا",
  "Sound off": "كتم الصوت",
  "Sound on": "تشغيل الصوت"
 },
 "de": {
  "Play trailers automatically": "Trailer automatisch abspielen",
  "Sound off": "Ton aus",
  "Sound on": "Ton an"
 },
 "es": {
  "Play trailers automatically": "Reproducir tráileres automáticamente",
  "Sound off": "Silenciar",
  "Sound on": "Activar sonido"
 },
 "fr": {
  "Play trailers automatically": "Lire les bandes-annonces automatiquement",
  "Sound off": "Couper le son",
  "Sound on": "Activer le son"
 },
 "it": {
  "Play trailers automatically": "Riproduci trailer automaticamente",
  "Sound off": "Audio disattivato",
  "Sound on": "Audio attivo"
 },
 "nl": {
  "%@ can’t play %@ of this video (%@).": "%@ kan %@ van deze video (%@) niet afspelen.",
  "Chrome, Edge or Firefox on a computer can play this file.": "Chrome, Edge of Firefox op een computer kan dit bestand wel afspelen.",
  "Copied": "Gekopieerd",
  "Servers on http go through Bingr’s server, because browsers block http on a secure page. Movies and series that the server also offers as HLS play in every browser, Safari included. Otherwise MKV plays in Chrome, Edge and Firefox if the browser knows the picture and sound inside; AVI, and MKV in Safari, only play in the app. If something doesn’t play, “Details” in the error shows why.": "Servers op http lopen via de server van Bingr, omdat browsers http blokkeren op een beveiligde pagina. Films en series die de server ook als HLS aanbiedt, spelen in elke browser, ook in Safari. Anders speelt MKV in Chrome, Edge en Firefox als de browser het beeld en geluid erin kent; AVI, en MKV in Safari, spelen alleen in de app. Speelt iets niet, dan zie je onder “Details” in de foutmelding waarom.",
  "The HLS version from this server didn’t play either.": "De HLS-versie van deze server speelde ook niet af.",
  "Copy": "Kopiëren",
  "Details": "Details",
  "Inside: %@.": "Erin: %@.",
  "Muted, on movie and series pages. Not with data saver or Reduce Motion on.": "Zonder geluid, op film- en seriepagina’s. Niet met databesparing of Beweging beperken aan.",
  "Play trailers automatically": "Trailers automatisch afspelen",
  "Safari (and every browser on iPhone and iPad) can’t open MKV files, whatever is inside.": "Safari (en elke browser op iPhone en iPad) kan geen MKV-bestanden openen, wat er ook in zit.",
  "Sound off": "Geluid uit",
  "Sound on": "Geluid aan",
  "The connection to the server broke off while loading this video. Many IPTV subscriptions allow one stream at a time: stop playback on other devices (also in the Bingr app) and try again.": "De verbinding met de server viel weg tijdens het laden van deze video. Veel IPTV-abonnementen staan maar één stream tegelijk toe: stop het afspelen op andere apparaten (ook in de Bingr-app) en probeer het opnieuw.",
  "The server refused because too many streams are open on your IPTV subscription (error %d). Stop playback on other devices, wait a minute and try again.": "De server weigert omdat er te veel streams open staan op je IPTV-abonnement (fout %d). Stop het afspelen op andere apparaten, wacht een minuut en probeer het opnieuw.",
  "The server took too long to answer. It may be busy; try again later.": "De server reageerde te traag. Misschien is hij druk; probeer het later opnieuw.",
  "This address isn’t one of your own servers, so Bingr’s server won’t fetch it.": "Dit adres hoort niet bij je eigen servers, dus de server van Bingr haalt het niet op.",
  "This server doesn’t let the browser jump within the file, and the file’s index is at the end. Watch in the Bingr app.": "Deze server laat de browser niet door het bestand springen, en de index van het bestand staat aan het eind. Kijk in de Bingr-app.",
  "This server doesn’t offer an HLS version of it either.": "Deze server biedt er ook geen HLS-versie van aan.",
  "Watch in the Bingr app.": "Kijk in de Bingr-app.",
  "Your browser": "Je browser",
  "the picture (%@)": "het beeld (%@)",
  "the picture (%@) and the sound (%@)": "het beeld (%@) en het geluid (%@)",
  "the sound (%@)": "het geluid (%@)"
 },
 "pl": {
  "Play trailers automatically": "Automatycznie odtwarzaj zwiastuny",
  "Sound off": "Wyłącz dźwięk",
  "Sound on": "Włącz dźwięk"
 },
 "pt": {
  "Play trailers automatically": "Reproduzir trailers automaticamente",
  "Sound off": "Desligar som",
  "Sound on": "Ligar som"
 },
 "tr": {
  "Play trailers automatically": "Fragmanları otomatik oynat",
  "Sound off": "Sesi kapat",
  "Sound on": "Sesi aç"
 },
 "zh-Hans": {
  "Play trailers automatically": "自动播放预告片",
  "Sound off": "关闭声音",
  "Sound on": "打开声音"
 }
};
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  Object.keys(T).forEach(function (lang) {
    var tab = all[lang] = all[lang] || {};
    Object.keys(T[lang]).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(tab, k)) tab[k] = T[lang][k]; });
  });
})();
