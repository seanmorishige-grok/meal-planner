/* Ingredient scaling + merging. Shared by the app (browser) and tests (node). */
(function (root) {
  const FRACS = [[0, ''], [0.25, '1/4'], [1 / 3, '1/3'], [0.5, '1/2'], [2 / 3, '2/3'], [0.75, '3/4'], [1, '']];
  function parseQty(s) {
    if (s == null) return null;
    s = String(s).trim().replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4').replace(/⅓/g, ' 1/3').replace(/⅔/g, ' 2/3');
    if (!s) return null;
    s = s.split(/\s*(?:-|–|to)\s*/)[0]; // ranges: take the low end
    let total = 0, ok = false;
    for (const part of s.split(/\s+/)) {
      const m = part.match(/^(\d+)\/(\d+)$/);
      if (m) { total += +m[1] / +m[2]; ok = true; }
      else if (/^\d+(\.\d+)?$/.test(part)) { total += +part; ok = true; }
    }
    return ok ? total : null;
  }
  // Round to whole + friendly fraction (quarters/thirds)
  function fmt(x) {
    if (x == null || isNaN(x)) return '';
    let whole = Math.floor(x + 1e-9), frac = x - whole, best = FRACS[0], d = 9;
    for (const f of FRACS) { const dd = Math.abs(frac - f[0]); if (dd < d) { d = dd; best = f; } }
    if (best[0] === 1) { whole += 1; best = FRACS[0]; }
    if (whole === 0 && !best[1]) return '1/4';
    return [whole || '', best[1]].filter(Boolean).join(' ');
  }
  const VOL = { tsp: 1, tbsp: 3, cup: 48, quart: 192 };
  const WT = { oz: 1, lb: 16 };
  const UNIT_ALIASES = {
    teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp', t: 'tsp',
    tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp', tbs: 'tbsp', T: 'tbsp',
    cup: 'cup', cups: 'cup', c: 'cup', 'c.': 'cup', quart: 'quart', quarts: 'quart', qt: 'quart',
    pound: 'lb', pounds: 'lb', lb: 'lb', lbs: 'lb', ounce: 'oz', ounces: 'oz', oz: 'oz',
    clove: 'clove', cloves: 'clove'
  };
  function normUnit(u) {
    u = (u || '').trim();
    if (!u) return '';
    return UNIT_ALIASES[u] || UNIT_ALIASES[u.toLowerCase()] || u.toLowerCase();
  }
  function plural(unit, n) {
    if (['tsp', 'tbsp', 'oz', 'lb'].includes(unit)) return unit;
    if (unit === 'cup' || unit === 'clove' || unit === 'quart') return n > 1 ? unit + 's' : unit;
    return unit;
  }
  // Volume in tsp -> nicest unit
  function fmtVol(tsp) {
    if (tsp >= 12) { const c = Math.round(tsp / 48 * 12) / 12; return fmt(c) + ' ' + plural('cup', c); }
    if (tsp >= 3) { const t = Math.round(tsp / 3 * 2) / 2; return fmt(t) + ' tbsp'; }
    return fmt(Math.max(0.25, Math.round(tsp * 4) / 4)) + ' tsp';
  }
  function fmtWt(oz) {
    if (oz >= 12) { const lb = Math.ceil(oz / 16 * 4 - 0.1) / 4; return fmt(lb) + ' lb'; }
    return fmt(Math.max(0.5, Math.round(oz * 2) / 2)) + ' oz';
  }
  // Countable things: round up to halves when small, whole numbers otherwise
  function roundCount(n) {
    if (n < 1) return n <= 0.5 ? 0.5 : 1;
    return Math.ceil(n - 0.15);
  }
  function fmtAmount(n, unit) {
    if (n == null) return '';
    if (VOL[unit]) return fmtVol(n * VOL[unit]);
    if (WT[unit]) return fmtWt(n * WT[unit]);
    if (/\d|jar|can\b|package|bag|box|bunch|head|sheet/.test(unit)) { // things you buy whole
      const c = Math.max(1, Math.ceil(n - 0.15));
      return /\d/.test(unit) ? c + ' × ' + unit : c + ' ' + unit;
    }
    const c = roundCount(n);
    return (fmt(c) + ' ' + plural(unit, c)).trim();
  }
  // Display a single scaled ingredient
  function scaleOne(ing, factor) {
    const q = parseQty(ing.qty), unit = normUnit(ing.unit);
    if (q == null) return { qty: ing.unit ? ing.unit : 'to taste', item: ing.item };
    return { qty: fmtAmount(q * factor, unit), item: ing.item };
  }
  // ---- merging ----
  function cleanName(item) {
    let s = (item || '').toLowerCase();
    s = s.replace(/\(.*?\)/g, ' ')
      .replace(/boneless,?\s*skinless,?/g, 'boneless skinless')
      .split(',')[0]
      .replace(/\b(freshly|fresh|finely|roughly|thinly|extra-virgin|extra virgin|store-bought|homemade|good-quality|large|medium|small|chopped|minced|grated|cracked|ground black|diced|sliced|optional)\b/g, ' ')
      .replace(/\bfor serving\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (/^ground$/.test(s)) s = '';
    if (/\bblack pepper\b|^pepper$|^ground pepper$/.test(s)) s = 'black pepper';
    if (/(^|\s)(kosher |sea |fine |table )?salt$/.test(s) && !/salted/.test(s)) s = 'salt';
    if (/olive oil/.test(s)) s = 'olive oil';
    if (/^(garlic|garlic cloves?|cloves? garlic|minced garlic)$/.test(s)) s = 'garlic';
    if (/^parmesan( cheese)?$/.test(s)) s = 'parmesan cheese';
    if (/^onions?$/.test(s)) s = 'yellow onion';
    return s || (item || '').toLowerCase().trim();
  }
  function keyOf(name) { return name.replace(/(?<!s)s\b/g, '').replace(/es\b/, ''); }
  const PANTRY_HAVE = /^(salt|black pepper|olive oil|garlic|water|ice)$/;
  function isPantryStaple(name) { return PANTRY_HAVE.test(name); }

  // options: [{picked, servings, base_servings, ingredients:[{qty,unit,item,category}], title}]
  function combine(options) {
    const groups = new Map();
    for (const o of options) {
      if (!o.picked) continue;
      const factor = (o.servings || 6) / (o.base_servings || 6);
      for (const ing of o.ingredients || []) {
        let name = cleanName(ing.item);
        const k = keyOf(name);
        if (!groups.has(k)) groups.set(k, { name, category: ing.category || 'other', vol: 0, wt: 0, counts: {}, loose: [], from: new Set(), hasQty: false });
        const g = groups.get(k);
        g.from.add(o.title);
        const q = parseQty(ing.qty), unit = normUnit(ing.unit);
        if (q == null) { if (ing.unit) g.loose.push(ing.unit); continue; }
        g.hasQty = true;
        if (VOL[unit]) g.vol += q * factor * VOL[unit];
        else if (WT[unit]) g.wt += q * factor * WT[unit];
        else g.counts[unit] = (g.counts[unit] || 0) + q * factor;
      }
    }
    const out = [];
    for (const g of groups.values()) {
      const parts = [];
      if (g.vol) parts.push(fmtVol(g.vol));
      if (g.wt) parts.push(fmtWt(g.wt));
      for (const [u, n] of Object.entries(g.counts)) parts.push(fmtAmount(n, u));
      for (const l of g.loose) parts.push(l);
      let qty = parts.join(' + ');
      if (!qty) qty = 'as needed';
      const name = g.name.charAt(0).toUpperCase() + g.name.slice(1);
      out.push({ name, qty, category: g.category, have_it: isPantryStaple(g.name), recipes: [...g.from] });
    }
    out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return out;
  }
  const api = { parseQty, fmt, scaleOne, combine, cleanName, isPantryStaple };
  if (typeof module !== 'undefined') module.exports = api; else root.Ingredients = api;
})(this);
