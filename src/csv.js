/**
 * csv.js
 *
 * Minimal dependency-free CSV parser. The app intentionally avoids pulling
 * in a CDN library for this so the whole prototype has zero external
 * runtime dependencies -- it works fully offline and behind restrictive
 * government network policies once the page itself has loaded.
 *
 * Handles quoted fields (commas/newlines inside quotes, doubled "" escapes).
 * Returns an array of row objects keyed by the header row.
 */
const CSVParser = (() => {
  function parse(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    const n = text.length;

    function pushField() { row.push(field); field = ''; }
    function pushRow() { rows.push(row); row = []; }

    while (i < n) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      } else {
        if (c === '"') { inQuotes = true; i++; continue; }
        if (c === ',') { pushField(); i++; continue; }
        if (c === '\r') { i++; continue; }
        if (c === '\n') { pushField(); pushRow(); i++; continue; }
        field += c; i++; continue;
      }
    }
    // last field/row (handle files with/without trailing newline)
    if (field.length > 0 || row.length > 0) { pushField(); pushRow(); }

    const filtered = rows.filter((r) => !(r.length === 1 && r[0] === ''));
    if (filtered.length === 0) return [];
    const headers = filtered[0].map((h) => h.trim());

    // Defensive-programming note: an untrusted CSV controls its own header
    // row, so a header literally named "__proto__" (or "constructor" /
    // "prototype") is attacker-controllable input reaching an object-key
    // position -- the classic shape of a prototype-pollution bug, even
    // though a bare `obj[h] = value` on a plain {} would only ever *shadow*
    // an own property here (JS silently no-ops a __proto__ write when the
    // value isn't itself an object, so this repo was never exploitable in
    // practice). Object.create(null) removes the inherited prototype
    // entirely, so there is nothing to pollute even if this parser is later
    // reused somewhere that merges/copies these rows less carefully.
    const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

    return filtered.slice(1).map((r) => {
      const obj = Object.create(null);
      headers.forEach((h, idx) => {
        const key = DANGEROUS_KEYS.has(h) ? `_${h}` : h;
        obj[key] = r[idx] !== undefined ? r[idx].trim() : '';
      });
      return obj;
    });
  }

  return { parse };
})();
