/*
 * Bingr web, build 151: sync van de hoofdthread af. Voegt het profiel samen (B.syncMerge.mergeNow uit syncmerge.js, dezelfde
 * code als de terugval op de hoofdthread) en maakt de JSON-tekst om te bewaren.
 * In: {id, op: 'merge', inp} of {id, op: 'stringify', obj}; uit: {id, r} of {id, error}.
 * Er gaat niets anders mee: geen tokens, geen adressen, geen opslag of netwerk in de Worker.
 */
/* global importScripts */
self.window = self;
self.B = self.B || {};
// core.js verwacht een paar browserdingen; in de Worker alleen stubs (core.js gebruikt hier alleen de hulpfuncties)
if (!self.document) self.document = { readyState: 'complete', hidden: false, visibilityState: 'visible', documentElement: { getAttribute: function () { return null; } }, addEventListener: function () {}, createElement: function () { return {}; } };
if (!self.localStorage) self.localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {}, key: function () { return null; }, length: 0 };
importScripts('core.js?v=151', 'syncmerge.js?v=151');
self.onmessage = function (e) {
  var d = e.data || {}, id = d.id;
  try {
    if (d.op === 'stringify') self.postMessage({ id: id, r: JSON.stringify(d.obj) });
    else self.postMessage({ id: id, r: self.B.syncMerge.mergeNow(d.inp) });
  } catch (x) {
    self.postMessage({ id: id, error: String((x && x.message) || x) });
  }
};
