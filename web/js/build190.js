/*
 * Build 190, pure logica (zonder DOM, getest met node): dubbele namen in de lijst met audio en ondertiteling krijgen
 * een nummer, zoals in de apps ("Polish", "Polish (2)").
 */
(function (root) {
  'use strict';
  var B = root.B = root.B || {};
  var P = B.b190 = {};

  /** ['Polish', 'Polish', 'English'] → ['Polish', 'Polish (2)', 'English']; de eerste houdt zijn naam. */
  P.numberDuplicates = function (labels) {
    var seen = {};
    return (labels || []).map(function (l) {
      var s = String(l == null ? '' : l);
      var k = s.toLowerCase();
      seen[k] = (seen[k] || 0) + 1;
      return seen[k] > 1 ? s + ' (' + seen[k] + ')' : s;
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
