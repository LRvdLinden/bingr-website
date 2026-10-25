/*
 * Bingr web, build 149: grote JSON-lijsten (Xtream) buiten de hoofdthread lezen (B.jsonPick uit jsonpick.js).
 * In: {id, text, spec}; uit: {id, part: [...]} en {id, hpart: [...]} (verborgen, compact) (stukken van 2000) en daarna {id, done: true, skipped, total} of {id, error}.
 * Er gaat niets anders mee (geen adressen of inloggegevens: alleen de tekst van het antwoord).
 */
/* global importScripts */
self.B = self.B || {};
importScripts('jsonpick.js?v=149');
self.onmessage = function (e) {
  var d = e.data || {}, id = d.id;
  try {
    var r = self.B.jsonPick(d.text, d.spec, function (part) { self.postMessage({ id: id, part: part }); }, 2000,
      function (rows) { self.postMessage({ id: id, hpart: rows }); });
    d = null;
    if (r.error) self.postMessage({ id: id, error: r.error });
    else self.postMessage({ id: id, done: true, skipped: r.skipped, total: r.total });
  } catch (x) {
    self.postMessage({ id: id, error: 'bad_json' });
  }
};
