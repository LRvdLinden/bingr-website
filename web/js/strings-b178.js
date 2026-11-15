/*
 * Build 178: terugkijken in de tv-gids (diagnose: terugkijken per server). Sleutel = Engels (terugval); hier de andere
 * talen van de apps (zelfde teksten als Translations.json van Apple en Android). Niets overschrijven wat er al staat.
 */
(function () {
  'use strict';
  var T = {
    "ar": {
      "Catch-up": "إعادة المشاهدة",
      "No channels with catch-up": "لا توجد قنوات مع المشاهدة لاحقاً",
      "%d channels, up to %d days": "%d قناة، حتى %d أيام"
    },
    "de": {
      "Catch-up": "Nachträglich ansehen",
      "No channels with catch-up": "Keine Sender mit Replay",
      "%d channels, up to %d days": "%d Sender, bis zu %d Tage"
    },
    "es": {
      "Catch-up": "Ver de nuevo",
      "No channels with catch-up": "Ningún canal con reproducción diferida",
      "%d channels, up to %d days": "%d canales, hasta %d días"
    },
    "fr": {
      "Catch-up": "Replay",
      "No channels with catch-up": "Aucune chaîne avec replay",
      "%d channels, up to %d days": "%d chaînes, jusqu’à %d jours"
    },
    "it": {
      "Catch-up": "Rivedi",
      "No channels with catch-up": "Nessun canale con replay",
      "%d channels, up to %d days": "%d canali, fino a %d giorni"
    },
    "nl": {
      "Catch-up": "Terugkijken",
      "No channels with catch-up": "Geen zenders met terugkijken",
      "%d channels, up to %d days": "%d zenders, tot %d dagen"
    },
    "pl": {
      "Catch-up": "Oglądaj ponownie",
      "No channels with catch-up": "Brak kanałów z odtwarzaniem wstecz",
      "%d channels, up to %d days": "%d kanałów, do %d dni"
    },
    "pt": {
      "Catch-up": "Rever",
      "No channels with catch-up": "Nenhum canal com catch-up",
      "%d channels, up to %d days": "%d canais, até %d dias"
    },
    "tr": {
      "Catch-up": "Tekrar izle",
      "No channels with catch-up": "Tekrar izleme olan kanal yok",
      "%d channels, up to %d days": "%d kanal, %d güne kadar"
    },
    "zh-Hans": {
      "Catch-up": "回看",
      "No channels with catch-up": "没有支持回看的频道",
      "%d channels, up to %d days": "%d 个频道，最多 %d 天"
    }
  };
  var all = window.BINGR_STRINGS = window.BINGR_STRINGS || {};
  Object.keys(T).forEach(function (lang) {
    var tab = all[lang] = all[lang] || {};
    Object.keys(T[lang]).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(tab, k)) tab[k] = T[lang][k]; });
  });
})();
