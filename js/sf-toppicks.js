// Strong Foodie: "Top picks · {month}", four of the highest-rated places, a new set every month.
//
// One choice for the homepage (index.html) and the app. tools/build-pages.mjs runs this same
// code every few hours and writes the result to best/top-picks.json, which the app reads.
// So the website and the app always show the same four, in the same order.
//
// How the four are chosen:
// 1. Places Strong Foodie pinned in admin-home.html (site/home, field topPicks), in that order.
// 2. Then Strong Foodie places with a photo that are not closed and not the featured place,
//    from the highest rating down (if fewer than four have the top rating: everything from 4 up).
//    Their order is shuffled with the year and month as the seed, so it changes once a month
//    and is the same for everyone.
// 3. Four different destinations when possible, then fill up.
// No imports: this file has to work in the browser and on GitHub.

export function seededShuffle(arr, seed) {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// catalog: Strong Foodie's own published places. featured: the place in the big card (or null).
// pinnedKeys: site/home topPicks ("coll/id"). byKey: Map of "coll/id" → place. year, month: 1-12.
export function pickTopPicks({ catalog, featured = null, pinnedKeys = [], byKey = new Map(), year, month }) {
  const pool = catalog.filter(p => p !== featured && !p.closed && p.rating && p.photos && p.photos.length);
  const best = Math.max(0, ...pool.map(p => p.rating));
  let candidates = pool.filter(p => p.rating >= best);
  if (candidates.length < 4) candidates = pool.filter(p => p.rating >= Math.min(best, 4));
  candidates.sort((a, b) => (a.coll + a.id).localeCompare(b.coll + b.id));
  const shuffled = seededShuffle(candidates, year * 100 + month);
  const pinned = (Array.isArray(pinnedKeys) ? pinnedKeys : []).map(k => byKey.get(k)).filter(p => p && p !== featured && !p.closed).slice(0, 4);
  const picks = pinned.slice(), seen = new Set(pinned.map(p => p.destination));
  shuffled.forEach(p => { if (picks.length < 4 && !seen.has(p.destination)) { picks.push(p); seen.add(p.destination); } });
  shuffled.forEach(p => { if (picks.length < 4 && !picks.includes(p)) picks.push(p); });
  return picks;
}

// The place in the big card on the homepage: the one chosen in admin-home.html, else the
// newest that makes a good first click: food, drinks or a stay, with a written review and a
// photo (not a shop without text). No such place: the newest that is open, as before.
export const featurable = p => !p.closed && ['eat', 'drink', 'stay'].includes(p.cat)
  && String(p.review || '').trim().length >= 40 && p.photos && p.photos.length > 0;
export function pickFeatured({ catalog, featuredKey = '', byKey = new Map() }) {
  const chosen = featuredKey ? byKey.get(featuredKey) : null;
  if (chosen && !chosen.closed) return chosen;
  const newest = list => list.slice().sort((a, b) => (b.created || 0) - (a.created || 0))[0] || null;
  return newest(catalog.filter(featurable)) || newest(catalog.filter(x => !x.closed));
}
