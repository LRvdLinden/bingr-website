/*
 * Build 191, pure logica (zonder DOM, getest met node): tabbladen op de detailpagina, zoals in de apps.
 * Afleveringen / Meer zoals dit / Trailers: alleen tabbladen met inhoud; het actieve tabblad blijft staan zolang het er is.
 */
(function (root) {
  'use strict';
  var B = root.B = root.B || {};
  var P = B.b191 = {};

  /** Welke tabbladen er zijn, in vaste volgorde. has = { episodes, more, trailers } (aantallen of booleans). */
  P.tabs = function (has) {
    has = has || {};
    return ['episodes', 'more', 'trailers'].filter(function (k) { return !!has[k]; });
  };

  /** Het te tonen tabblad: de huidige als hij er nog is, anders de eerste. */
  P.pick = function (tabs, current) {
    tabs = tabs || [];
    return tabs.indexOf(current) >= 0 ? current : (tabs[0] || null);
  };

  /** Een tabbalk heeft pas zin bij twee of meer tabbladen. */
  P.showBar = function (tabs) { return (tabs || []).length >= 2; };
})(typeof window !== 'undefined' ? window : globalThis);
