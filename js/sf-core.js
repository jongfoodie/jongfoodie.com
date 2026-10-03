// Strong Foodie: the shared rules about places, without any Firebase code.
//
// Used in the browser (through js/sf-places.js, which re-exports all of this)
// and by tools/build-pages.mjs on GitHub, so the website pages and the
// generated share pages always agree on names, addresses, cities and lists.

export const CATS = {
  eat:     { label: 'Eat',     emoji: '🍽️', color: '#D4521A', tint: '#FBF3EF', page: 'reviews.html', coll: 'reviews',      aliases: ['eat', 'food', 'restaurant', 'restaurants'] },
  drink:   { label: 'Drink',   emoji: '🍸', color: '#6B2A5C', tint: '#F3E8F0', page: 'drink.html',   coll: 'drinkspots',   aliases: ['drink', 'drinks', 'bar', 'bars', 'cafe'] },
  shop:    { label: 'Shop',    emoji: '🛍️', color: '#A32323', tint: '#F6E6E6', page: 'shop.html',    coll: 'shopspots',    aliases: ['shop', 'shops', 'store'] },
  culture: { label: 'Culture', emoji: '🎭', color: '#8A6A0A', tint: '#F4EEDD', page: 'culture.html', coll: 'culturespots', aliases: ['culture', 'cultuur', 'museum'] },
  health:  { label: 'Health',  emoji: '💪', color: '#1A5C2E', tint: '#E3EFE6', page: 'health.html',  coll: 'healthspots',  aliases: ['health', 'gym', 'sport', 'spa'] },
  stay:    { label: 'Stay',    emoji: '🏨', color: '#2F5D7C', tint: '#E4ECF2', page: 'hotel.html',   coll: 'hotelreviews', aliases: ['stay', 'stays', 'hotel', 'hotels'] },
};

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const toDate = ts => !ts ? null : (ts.toDate ? ts.toDate() : (isNaN(new Date(ts)) ? null : new Date(ts)));
export const starStr = n => { const r = Math.round(n || 0); return '★'.repeat(r) + '☆'.repeat(5 - r); };
export const slugOf = name => fold(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const SITE = 'https://strongfoodie.com';
// Pretty addresses. The pages behind them are made by tools/build-pages.mjs;
// a place or list that has no page yet is sent on by 404.html.
// The id is encoded: a member chooses it, so it may hold any character.
export const placeUrl = p => `/p/${slugOf(p.name) || 'place'}-${encodeURIComponent(p.id)}/`;
export const destinationUrl = name => `/stad/${slugOf(name)}/`;
export const listUrl = slug => `/best/${slug}/`;
export const guideUrl = slug => `/guide/${slug}/`;
const num = v => (typeof v === 'number' && isFinite(v) && v !== 0) ? v : null;
export const catOf = raw => { const c = String(raw || '').toLowerCase().trim(); return Object.keys(CATS).find(k => CATS[k].aliases.includes(c)) || 'eat'; };

// ── Where is a place? ────────────────────────────────────────────────────
// Country names and abbreviations that can appear in an address.
const COUNTRY_NORM = {
  'usa': 'United States', 'us': 'United States', 'united states': 'United States', 'united states of america': 'United States', 'america': 'United States',
  'nl': 'Netherlands', 'netherlands': 'Netherlands', 'the netherlands': 'Netherlands', 'nederland': 'Netherlands', 'holland': 'Netherlands',
  'turkey': 'Turkey', 'turkiye': 'Turkey', 'uae': 'United Arab Emirates', 'united arab emirates': 'United Arab Emirates',
  'uk': 'United Kingdom', 'united kingdom': 'United Kingdom', 'england': 'United Kingdom',
  'aruba': 'Aruba', 'thailand': 'Thailand', 'spain': 'Spain', 'france': 'France', 'italy': 'Italy', 'germany': 'Germany',
  'belgium': 'Belgium', 'portugal': 'Portugal', 'greece': 'Greece', 'morocco': 'Morocco', 'japan': 'Japan', 'indonesia': 'Indonesia',
};
// Towns and neighbourhoods that belong to a bigger destination.
const DEST_ALIAS = {
  'west hollywood': 'Los Angeles', 'hollywood': 'Los Angeles', 'venice': 'Los Angeles', 'venice beach': 'Los Angeles',
  'beverly hills': 'Los Angeles', 'santa monica': 'Los Angeles', 'la': 'Los Angeles',
  'la jolla': 'San Diego',
  'oranjestad': 'Aruba', 'savaneta': 'Aruba', 'palm beach': 'Aruba', 'eagle beach': 'Aruba',
  'new west': 'Amsterdam', 'nieuw-west': 'Amsterdam', 'amsterdam-noord': 'Amsterdam', 'amsterdam noord': 'Amsterdam', 'de pijp': 'Amsterdam', 'jordaan': 'Amsterdam',
  'business bay': 'Dubai',
};
// Parts of a city: shown as the city itself.
const NEIGHBOURHOODS = new Set(['new west', 'nieuw-west', 'amsterdam-noord', 'amsterdam noord', 'de pijp', 'jordaan', 'business bay']);

const titleCase = s => s.replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
export function countryOf(raw) {
  const k = fold(raw).trim();
  if (!k) return '';
  return COUNTRY_NORM[k] || titleCase(String(raw).trim());
}
// In the catalogue "city" often holds a whole address
// ("8361 Beverly Blvd, Los Angeles", "Singel 83, 1012 VE Amsterdam").
export function townOf(raw, country) {
  const parts = String(raw || '').split(',').map(x => x.split('·')[0].replace(/\(.*?\)/g, '').trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const t = parts[i].replace(/^\d{4}\s?[A-Z]{2}\s+/, '').trim();
    if (!t || /\d/.test(t) || /^[A-Z]{2,3}$/.test(t)) continue;
    const f = fold(t);
    if (COUNTRY_NORM[f] || (country && f === fold(country))) continue;
    return t;
  }
  return '';
}
export function destinationOf(town, country) {
  if (country === 'Aruba') return 'Aruba';
  if (!town) return '';
  return DEST_ALIAS[fold(town)] || town;
}
// Everything a page needs to say where a place is, from a raw address and country.
export function locate(address, countryRaw) {
  const country = countryOf(countryRaw);
  let town = townOf(address, country);
  const destination = destinationOf(town, country);
  if (town && NEIGHBOURHOODS.has(fold(town))) town = destination;
  // "Noord, Aruba", "Venice, Los Angeles", "Amsterdam"
  const where = !town ? (destination || country)
    : (destination && fold(destination) !== fold(town) ? `${town}, ${destination}` : town);
  return { town, country, destination, where, area: town || destination };
}

// ── Documents → places ───────────────────────────────────────────────────
export function isPublished(r, now) {
  if (r.status === 'draft' || r.status === 'hidden' || r.hidden === true) return false;
  const pub = toDate(r.publishAt);
  return !(pub && pub > now);
}

export function normalise(coll, id, r, member) {
  const cat = member ? catOf(r.category) : Object.keys(CATS).find(k => CATS[k].coll === coll);
  const photos = [];
  if (r.photoUrl) photos.push(r.photoUrl);
  if (Array.isArray(r.photos)) r.photos.forEach(ph => { if (typeof ph === 'string' && ph && !photos.includes(ph)) photos.push(ph); });
  const tags = Array.isArray(r.tags) ? r.tags.filter(t => typeof t === 'string') : [];
  const p = {
    coll, id, cat, member,
    name: r.name || 'Unnamed place',
    ...locate(r.city || r.address, r.country || r.countryLabel),
    type: member ? '' : (r.type || ''),
    tip: member ? (r.type || '') : '',
    review: r.review || '',
    rating: typeof r.rating === 'number' && r.rating > 0 ? r.rating : null,
    price: r.price || '',
    tags,
    emoji: r.emoji || CATS[cat].emoji,
    photos,
    lat: num(r.lat), lng: num(r.lng),
    closed: !!(r.closedStatus && r.closedStatus !== 'open'),
    // Old reviews still say "Jong Foodie", the brand's former name.
    author: member ? (r.addedByName || 'a member') : (r.author && r.author !== 'Jong Foodie' ? r.author : 'Strong Foodie'),
    authorId: member ? (r.addedByUserId || '') : '',
    created: toDate(r.createdAt),
  };
  // Lower-case copies for searching
  p._name = fold(p.name);
  p._place = fold([p.town, p.destination, r.address, r.city, p.country].join(' '));
  p._kind = fold([CATS[cat].label, p.type, p.tip, tags.join(' ')].join(' '));
  p._text = fold(p.review);
  return p;
}

// Destinations with their places, biggest first.
export function destinations(all) {
  const map = new Map();
  all.forEach(p => {
    if (!p.destination) return;
    if (!map.has(p.destination)) map.set(p.destination, []);
    map.get(p.destination).push(p);
  });
  return [...map.entries()].map(([name, places]) => {
    const countries = new Map();
    places.forEach(p => { if (p.country) countries.set(p.country, (countries.get(p.country) || 0) + 1); });
    const country = [...countries.entries()].sort((a, b) => b[1] - a[1])[0];
    return { name, slug: slugOf(name), url: destinationUrl(name), count: places.length, country: country ? country[0] : '', places };
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// Best first: rating, then with a photo, then Strong Foodie before members, then newest.
export const byQuality = (a, b) => (b.rating || 0) - (a.rating || 0)
  || (b.photos.length ? 1 : 0) - (a.photos.length ? 1 : 0)
  || (a.member - b.member)
  || (b.created || 0) - (a.created || 0);

// Small copy of a photo from the site's own images folder, for cards.
export function thumbOf(url) {
  const m = /^((?:https?:)?\/\/(?:www\.)?strongfoodie\.com\/|\/)?images\/([^\/?#]+\.jpe?g)$/i.exec(String(url || ''));
  return m ? (m[1] || '') + 'images/thumbs/' + m[2] : '';
}

// ── Best-of lists ───────────────────────────────────────────────────────
// Made from the places Strong Foodie rated, per destination: one list per
// category and one per tag that at least `min` places share. The same rules
// run on best.html and in tools/build-pages.mjs, so both know the same lists.
export const LIST_CATS = {
  eat:     { slug: 'restaurants', title: 'Restaurants' },
  drink:   { slug: 'bars',        title: 'Bars & Cafés' },
  shop:    { slug: 'shops',       title: 'Shops' },
  culture: { slug: 'culture',     title: 'Culture Spots' },
  health:  { slug: 'wellness',    title: 'Gyms & Wellness' },
  stay:    { slug: 'hotels',      title: 'Hotels' },
};
const TAG_SKIP = new Set(['must try', 'must-try', 'musttry', 'new', 'top', 'favorite', 'favourite', 'recommended']);
const tagKey = t => fold(t).replace(/[^a-z0-9]+/g, ' ').trim().replace(/s$/, '');

// ── Dishes ───────────────────────────────────────────────────────────────
// The dishes Strong Foodie rated, in the `dishes` collection (dish-edit.html):
//   dishes/{id}: { placeColl, placeId, name, kind, rating, note, photo, createdAt, updatedAt }
// `kind` groups them into lists ("Smash burger" → Best Smash Burger in Amsterdam).
// A dish item has the shape of a place (so the lists can show it) plus
// `dish: true` and `place`, the place it is served at.
export function normaliseDish(id, d, place) {
  if (!place || !d || typeof d.name !== 'string' || !d.name.trim()) return null;
  const rating = typeof d.rating === 'number' && d.rating > 0 ? Math.min(5, d.rating) : null;
  const photos = typeof d.photo === 'string' && d.photo ? [d.photo] : place.photos.slice(0, 1);
  const x = {
    ...place, coll: 'dishes', id, dish: true, place,
    name: d.name.trim(), kind: typeof d.kind === 'string' ? d.kind.trim() : '', rating, photos,
    review: typeof d.note === 'string' ? d.note.trim() : '', note: typeof d.note === 'string' ? d.note.trim() : '',
    tags: [], type: place.name, created: toDate(d.createdAt) || place.created, member: false,
  };
  x._name = fold(x.name + ' ' + place.name);
  x._kind = fold(x.kind);
  return x;
}
export const dishUrl = x => placeUrl(x.place);

export function buildLists(all, { min = 3, dishes = [] } = {}) {
  const rated = all.filter(p => !p.member && p.rating && !p.closed);
  const lists = [];
  const add = (slug, fields, places) => {
    if (places.length < min || lists.some(l => l.slug === slug)) return;
    lists.push({ slug, url: listUrl(slug), count: places.length, places: places.slice().sort(byQuality), ...fields });
  };
  const placeWords = new Set(all.flatMap(p => [p.town, p.destination, p.country]).filter(Boolean).map(tagKey));
  for (const d of destinations(rated)) {
    for (const cat of Object.keys(LIST_CATS)) {
      add(`${LIST_CATS[cat].slug}-${d.slug}`, { kind: 'cat', cat, dest: d.name, destSlug: d.slug, country: d.country, title: `Best ${LIST_CATS[cat].title} in ${d.name}` }, d.places.filter(p => p.cat === cat));
    }
    const tags = new Map();
    d.places.forEach(p => p.tags.forEach(t => {
      const k = tagKey(t);
      if (!k || k.length < 3 || TAG_SKIP.has(k) || TAG_SKIP.has(fold(t).trim()) || placeWords.has(k)) return;
      if (!tags.has(k)) tags.set(k, { labels: new Map(), places: new Set() });
      const e = tags.get(k);
      e.labels.set(t.trim(), (e.labels.get(t.trim()) || 0) + 1);
      e.places.add(p);
    }));
    for (const [k, e] of tags) {
      const label = [...e.labels.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
      const nice = label.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
      add(`${slugOf(k)}-${d.slug}`, { kind: 'tag', tag: nice, dest: d.name, destSlug: d.slug, country: d.country, title: `Best ${nice} in ${d.name}` }, [...e.places]);
    }
  }
  // Dishes, per destination and worldwide, grouped by their kind
  const goodDishes = dishes.filter(x => x && x.rating && x.kind && !x.closed);
  const dishKinds = list => {
    const m = new Map();
    list.forEach(x => { const k = tagKey(x.kind); if (!k) return; if (!m.has(k)) m.set(k, { labels: new Map(), items: [] }); const e = m.get(k); e.labels.set(x.kind, (e.labels.get(x.kind) || 0) + 1); e.items.push(x); });
    return [...m.entries()].map(([k, e]) => [k, [...e.labels.entries()].sort((a, b) => b[1] - a[1])[0][0].split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' '), e.items]);
  };
  const byDishRating = (a, b) => (b.rating || 0) - (a.rating || 0) || (b.created || 0) - (a.created || 0);
  const addDish = (slug, fields, items) => {
    if (items.length < min || lists.some(l => l.slug === slug)) return;
    lists.push({ slug, url: listUrl(slug), count: items.length, places: items.slice().sort(byDishRating), ...fields });
  };
  for (const d of destinations(goodDishes)) {
    for (const [k, label, items] of dishKinds(d.places)) {
      addDish(`dish-${slugOf(k)}-${d.slug}`, { kind: 'dish', dishKind: label, dest: d.name, destSlug: d.slug, country: d.country, title: `Best ${label} in ${d.name}` }, items);
    }
  }
  for (const [k, label, items] of dishKinds(goodDishes)) {
    addDish(`dish-${slugOf(k)}-worldwide`, { kind: 'dish', dishKind: label, dest: '', destSlug: '', country: '', title: `Best ${label} Worldwide` }, items);
  }

  for (const cat of Object.keys(LIST_CATS)) {
    add(`${LIST_CATS[cat].slug}-worldwide`, { kind: 'cat', cat, dest: '', destSlug: '', country: '', title: `Best ${LIST_CATS[cat].title} Worldwide` }, rated.filter(p => p.cat === cat));
  }
  return lists.sort((a, b) => (a.dest ? 0 : 1) - (b.dest ? 0 : 1) || b.count - a.count || a.title.localeCompare(b.title));
}

// ── Lists adjusted by Strong Foodie ──────────────────────────────────────
// The admin (list-edit.html on the website, the admin screen in the app) can
// change any list without switching the automatic lists off. One document per
// list in the `lists` collection, its id is the list's slug:
//   { slug, hidden, title, intro, cover, order: ["reviews/<id>", …],
//     removed: ["reviews/<id>", …], custom, dest, cat, updatedAt }
// `order` puts those places first, in that order; the other places of the list
// follow by score, so new reviews still join by themselves. `removed` keeps a
// place out of that list. `custom: true` is a list the admin made: only the
// places in `order`.
export const placeKey = p => `${p.coll}/${p.id}`;
const sortLists = (a, b) => (a.dest ? 0 : 1) - (b.dest ? 0 : 1) || b.count - a.count || a.title.localeCompare(b.title);

export function applyListEdits(all, edits = [], { min = 3, admin = false, dishes = [] } = {}) {
  const byKey = new Map(all.concat(dishes.filter(Boolean)).map(p => [placeKey(p), p]));
  const strings = v => Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  const text = v => typeof v === 'string' ? v.trim() : '';
  const bySlug = new Map();
  edits.forEach(e => { if (e && typeof e.slug === 'string' && /^[a-z0-9-]{1,80}$/.test(e.slug)) bySlug.set(e.slug, e); });
  const shape = (base, e) => {
    if (!e) return { ...base, autoTitle: base.title, cover: base.places.find(p => p.photos.length)?.photos[0] || '', edited: false, hidden: false, pinned: 0 };
    const removed = new Set(strings(e.removed));
    const pinned = strings(e.order).filter(k => !removed.has(k)).map(k => byKey.get(k)).filter(Boolean);
    const pinnedKeys = new Set(pinned.map(placeKey));
    const places = pinned.concat(base.places.filter(p => !removed.has(placeKey(p)) && !pinnedKeys.has(placeKey(p))));
    return {
      ...base, autoTitle: base.title, places, count: places.length, edited: true, hidden: e.hidden === true, pinned: pinned.length,
      title: text(e.title) || base.title, intro: text(e.intro),
      cover: text(e.cover) || places.find(p => p.photos.length)?.photos[0] || '',
      removedKeys: [...removed],
    };
  };
  const lists = buildLists(all, { min: 1, dishes: dishes.filter(Boolean) }).map(l => shape(l, bySlug.get(l.slug)));
  const known = new Set(lists.map(l => l.slug));
  for (const e of bySlug.values()) {
    if (e.custom !== true || known.has(e.slug)) continue;
    const dest = text(e.dest);
    lists.push(shape({ slug: e.slug, url: listUrl(e.slug), kind: 'custom', cat: CATS[e.cat] ? e.cat : '', dest, destSlug: slugOf(dest), country: '', title: text(e.title) || e.slug, places: [], count: 0 }, e));
  }
  // Shown: an untouched list with at least `min` places, or any list the admin
  // changed, as long as it is not hidden and not empty. The admin sees them all.
  return lists
    .filter(l => admin || (l.count && !l.hidden && (l.edited || l.count >= min)))
    .sort(sortLists);
}

