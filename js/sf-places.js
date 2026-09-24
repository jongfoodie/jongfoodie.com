// Strong Foodie: shared place data for the homepage and the destination pages.
//
// Reads every place collection the app uses (one read per collection) and turns
// the documents into one list. Places members add in the app are included;
// members with a private account are left out. The destination logic lives here
// only, so the homepage and stad.html always show the same cities and counts.
//
//   import { loadPlaces, destinations } from './js/sf-places.js?v=1';
//   const { catalog, members, all } = await loadPlaces(db);

import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
export const placeUrl = p => `plek.html?c=${encodeURIComponent(p.coll)}&id=${encodeURIComponent(p.id)}`;
export const slugOf = name => fold(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const destinationUrl = name => `stad.html?d=${encodeURIComponent(slugOf(name))}`;
const num = v => (typeof v === 'number' && isFinite(v) && v !== 0) ? v : null;
const catOf = raw => { const c = String(raw || '').toLowerCase().trim(); return Object.keys(CATS).find(k => CATS[k].aliases.includes(c)) || 'eat'; };

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
function isPublished(r, now) {
  if (r.status === 'draft' || r.status === 'hidden' || r.hidden === true) return false;
  const pub = toDate(r.publishAt);
  return !(pub && pub > now);
}

function normalise(coll, id, r, member) {
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
    author: member ? (r.addedByName || 'a member') : (r.author || 'Strong Foodie'),
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

async function readAll(db, coll) {
  try {
    const snap = await getDocs(collection(db, coll));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.log('Could not load ' + coll + ':', e.code || e); return []; }
}

// Places members added in the app. Members with a private account are left out.
async function readMemberPlaces(db) {
  const raw = (await readAll(db, 'userPlaces')).filter(r => r.name && r.hidden !== true);
  const owners = [...new Set(raw.map(r => r.addedByUserId).filter(Boolean))];
  const privateOwners = new Set();
  await Promise.all(owners.map(uid => getDoc(doc(db, 'profiles', uid))
    .then(s => { if (s.exists() && s.data().isPrivate === true) privateOwners.add(uid); })
    .catch(() => {})));
  return raw.filter(r => !privateOwners.has(r.addedByUserId));
}

export async function loadPlaces(db) {
  const now = new Date();
  const keys = Object.keys(CATS);
  const [lists, memberDocs] = await Promise.all([
    Promise.all(keys.map(k => readAll(db, CATS[k].coll))),
    readMemberPlaces(db),
  ]);
  const catalog = [];
  keys.forEach((k, i) => {
    lists[i].filter(r => r.name && isPublished(r, now))
      .forEach(r => catalog.push(normalise(CATS[k].coll, r.id, r, false)));
  });
  const members = memberDocs.map(r => normalise('userPlaces', r.id, r, true));
  return { catalog, members, all: catalog.concat(members) };
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

// ── Photos: normal URLs, or "fsimg://<id>" (a base64 image in `images`, from the app)
export function photoTools(db) {
  const cache = new Map();
  function resolvePhoto(url) {
    if (!url || typeof url !== 'string') return Promise.resolve('');
    if (url.startsWith('fsimg://')) {
      const id = url.slice(8);
      if (!cache.has(id)) {
        cache.set(id, getDoc(doc(db, 'images', id))
          .then(s => { const d = s.exists() ? s.data() : null; return d && d.data ? `data:${d.contentType || 'image/jpeg'};base64,${d.data}` : ''; })
          .catch(() => ''));
      }
      return cache.get(id);
    }
    if (/^[A-Za-z0-9+/=\s]{200,}$/.test(url)) return Promise.resolve('data:image/jpeg;base64,' + url.replace(/\s/g, ''));
    return Promise.resolve(url);
  }
  function hydratePhotos(root) {
    root.querySelectorAll('img[data-photo]').forEach(img => {
      const src = img.getAttribute('data-photo');
      img.removeAttribute('data-photo');
      img.onerror = () => img.remove();
      resolvePhoto(src).then(url => { if (url) { img.src = url; img.hidden = false; } else img.remove(); });
    });
  }
  return { resolvePhoto, hydratePhotos };
}

// ── Card (styles: .mini-card, .mini-img, .pill… in the page)
export function miniCard(p) {
  const cat = CATS[p.cat];
  const text = p.review || p.tip || p.type || '';
  const foot = p.rating
    ? `<span class="mini-rating">${starStr(p.rating)} ${p.rating}</span>`
    : `<span class="mini-meta" style="margin:0;">${p.member ? 'Added by ' + esc(p.author) : ''}</span>`;
  return `<a class="mini-card" href="${placeUrl(p)}">
    <div class="mini-img" style="background:linear-gradient(135deg, ${cat.color} 0%, #1A1208 100%);">
      <span>${esc(p.emoji)}</span>
      ${p.photos[0] ? `<img data-photo="${esc(p.photos[0])}" alt="" loading="lazy" hidden>` : ''}
    </div>
    <div class="mini-body">
      <p class="mini-meta"><span class="pill pill-cat">${cat.label}</span>${p.member ? '<span class="pill pill-member">Member</span>' : ''}${p.closed ? '<span class="pill pill-closed">Closed</span>' : ''}${esc(p.where)}</p>
      <h3 class="mini-title">${esc(p.name)}</h3>
      ${text ? `<p class="mini-text">${esc(text.slice(0, 90))}${text.length > 90 ? '…' : ''}</p>` : ''}
      <div class="mini-footer">${foot}<span class="mini-read">View place →</span></div>
    </div>
  </a>`;
}
