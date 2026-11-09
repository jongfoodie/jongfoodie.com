// Strong Foodie admin: fill in a review form from the place's name, address or Google Maps link.
//
// On admin.html each of the six forms gets a search field above it. Type the name
// of the place or its street address and pick a suggestion. The form then fills in
// the name, the address (in the City field, like the catalogue: "Singel 83, Amsterdam"),
// the coordinates, the opening hours and, for Eat, the food type. Phone and country
// are saved with the review as well, so they show on the place page.
// Picking a street address shows the places at that address to choose from.
// For Eat and Shop, other branches with the same name can be added as extra locations.
// Everything stays editable: the admin checks and changes what they like.
//
// A Google Maps link (8 Nov 2026) works in the same field. Only the name and the pin
// are read from the link; address, hours and phone come from OpenStreetMap, like for a
// typed name, because Google's terms don't allow storing their place data. A short
// link from the phone (maps.app.goo.gl) is opened by the admin-only Cloud Function
// expandMapsLink. The texts in the admin are Dutch.
//
// Data: OpenStreetMap, through Photon (search, free, no key) and Nominatim
// (opening hours and phone, one request per pick, never while typing).

import { placeFinder, fromFeature, isPoiFeature, foldText, catInfo, strongFoodiePlaces } from './sf-find.js?v=5';
import { townOf } from './sf-core.js?v=3';

const FORMS = [
  { prefix: 'r', cat: 'eat', name: 'rName', locations: 'rLocations', type: 'rType' },
  { prefix: 'h', cat: 'stay', name: 'hName', city: 'hCity' },          // no coordinate fields: saved with the review
  { prefix: 'd', cat: 'drink', name: 'dName', city: 'dCity', lat: 'dLat', lng: 'dLng' },
  { prefix: 's', cat: 'shop', name: 'sName', locations: 'sLocations' },
  { prefix: 'c', cat: 'culture', name: 'cName', city: 'cCity', lat: 'cLat', lng: 'cLng' },
  { prefix: 'hl', cat: 'health', name: 'hlName', city: 'hlCity', lat: 'hlLat', lng: 'hlLng' },
];
const NUMBER_FIRST = new Set(['US', 'CA', 'AU', 'NZ', 'GB', 'IE', 'FR']);
const OSM_LETTER = { node: 'N', way: 'W', relation: 'R', N: 'N', W: 'W', R: 'R' };
const MAX_BRANCHES = 15;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fix6 = n => (typeof n === 'number' && isFinite(n)) ? Math.round(n * 1e6) / 1e6 : null;
const state = {};

// ── Helpers anyone can test ──────────────────────────────────────────────

// "Singel 83, Amsterdam" or "8361 Beverly Boulevard, Los Angeles"
export function lineOf(p) {
  const cc = String(p.countryCode || '').toUpperCase();
  const street = p.streetName
    ? (p.houseNumber ? (NUMBER_FIRST.has(cc) ? `${p.houseNumber} ${p.streetName}` : `${p.streetName} ${p.houseNumber}`) : p.streetName)
    : '';
  return [street, p.town].filter(Boolean).join(', ');
}

// OpenStreetMap opening_hours → "Mon–Fri 08:00–18:00 · Sat 10:00–16:00 · Sun closed"
export function niceHours(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (s === '24/7') return 'Open 24/7';
  const D = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun', PH: 'holidays' };
  s = s.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, d => D[d]);
  s = s.replace(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}\+?)/g, '$1–$2');
  s = s.replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*-\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g, '$1–$2');
  s = s.replace(/\b(off|closed)\b/gi, 'closed');
  s = s.replace(/,(?=\S)/g, ', ');
  s = s.replace(/\s*;\s*/g, ' · ');
  s = s.replace(/^Mon–Sun\b/, 'Daily').replace(/ · Mon–Sun\b/g, ' · Daily');
  return s;
}

// The Food type list of the Eat form, from what OpenStreetMap says about the place.
const FOOD = [
  [/sushi|japanese|ramen|udon|izakaya/, 'Sushi / Japanese'],
  [/vietnamese|pho\b/, 'Vietnamese'],
  [/burger/, 'Burgers'],
  [/caribbean|jamaican|surinamese|antillean|cuban/, 'Caribbean'],
  [/seafood|fish|oyster/, 'Seafood'],
  [/steak/, 'Steak'],
  [/sandwich|bagel/, 'Sandwiches'],
  [/chips|fries|friture/, 'Fries'],
  [/chinese|thai|korean|asian|indonesian|malaysian|dim_sum|noodle|filipino|taiwanese/, 'Asian'],
  [/coffee|cafe|tea\b/, 'Cafe'],
  [/cake|pastry|dessert|donut|doughnut|patisserie|waffle|pancake/, 'Pastries'],
  [/street_food|kebab|taco|falafel|hot_dog/, 'Street Food'],
];
export function foodType(key, value, cuisine) {
  const c = String(cuisine || '').toLowerCase();
  for (const [re, t] of FOOD) if (c && re.test(c)) return t;
  if (key === 'amenity' && value === 'cafe') return 'Cafe';
  if (key === 'shop' && /bakery|pastry|confectionery/.test(value || '')) return 'Pastries';
  if (key === 'amenity' && (value === 'bar' || value === 'pub')) return 'Drinks';
  if (key === 'amenity' && value === 'restaurant') return 'Restaurant';
  return '';
}

// The town for a hashtag, also when the City field holds a whole address.
export function cityTag(city) {
  const t = townOf(city) || String(city || '');
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

export function distM(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── OpenStreetMap ───────────────────────────────────────────────────────

function toPlace(f) {
  const p = fromFeature(f);
  p.line = lineOf(p);
  return p;
}
const osmKeyOf = p => (p && p.osmType && p.osmId) ? (OSM_LETTER[p.osmType] || '') + p.osmId : '';

async function photon(q, limit) {
  const res = await fetch('https://photon.komoot.io/api/?' + new URLSearchParams({ q, limit: String(limit), lang: 'en' }));
  if (!res.ok) return [];
  const d = await res.json();
  return (d && d.features) || [];
}

// Street addresses for the suggestion list (only when the text has a number in it).
async function addressSearch(q) {
  if (!/\d/.test(q)) return [];
  const out = [];
  for (const f of await photon(q, 10)) {
    const pr = f.properties || {};
    if (!pr.housenumber || !pr.street || isPoiFeature(f)) continue;
    const a = toPlace(f);
    if (a.lat == null) continue;
    const key = 'addr|' + foldText(a.line);
    if (out.some(o => o.key === key)) continue;
    out.push({ ...a, src: 'addr', key, name: a.line.split(',')[0], type: 'Adres', cat: null, address: [a.line, a.country].filter(Boolean).join(', ') });
    if (out.length >= 3) break;
  }
  return out;
}

// Restaurants, shops, hotels... within 80 m of a point, nearest first.
async function nearby(lat, lng) {
  const res = await fetch('https://photon.komoot.io/reverse?' + new URLSearchParams({ lat: String(lat), lon: String(lng), limit: '20', radius: '0.1', lang: 'en' }));
  if (!res.ok) return [];
  const d = await res.json();
  const here = { lat, lng };
  const out = [];
  for (const f of (d && d.features) || []) {
    if (!isPoiFeature(f)) continue;
    const p = toPlace(f);
    if (p.lat == null || distM(here, p) > 80 || out.some(o => o.key === p.key)) continue;
    p.dist = distM(here, p);
    out.push(p);
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, 8);
}

// Opening hours, phone and cuisine for up to 50 places, in one request.
export async function osmDetails(places) {
  const ids = [...new Set(places.map(osmKeyOf).filter(Boolean))].slice(0, 50);
  if (!ids.length) return {};
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/lookup?' + new URLSearchParams({ osm_ids: ids.join(','), format: 'jsonv2', extratags: '1' }));
    if (!res.ok) return {};
    const out = {};
    for (const r of await res.json()) {
      const t = r && OSM_LETTER[r.osm_type];
      if (t) out[t + r.osm_id] = r.extratags || {};
    }
    return out;
  } catch (e) { return {}; }
}
const phoneOf = tags => String(tags.phone || tags['contact:phone'] || '').split(';')[0].trim();

// ── The form ────────────────────────────────────────────────────────────

function setVal(id, v) { const el = $(id); if (el && v != null) el.value = v; }
// The Eat type was a list; since the admin update of 4 Nov it is free text with suggestions.
function setSelect(id, text) {
  const el = $(id);
  if (!el || !text) return;
  if (el.tagName !== 'SELECT') { el.value = text; return; }
  if (Array.from(el.options).some(o => (o.value || o.text) === text)) el.value = text;
}
const rowsOf = form => Array.from($(form.locations).querySelectorAll('.location-row'));
function fillRow(row, b, hours) {
  row.querySelector('.loc-city').value = b.line || b.town || '';
  row.querySelector('.loc-lat').value = b.lat != null ? fix6(b.lat) : '';
  row.querySelector('.loc-lng').value = b.lng != null ? fix6(b.lng) : '';
  const h = row.querySelector('.loc-hours');
  if (h && hours) h.value = hours;
}

// Address and coordinates of a picked place or street address.
function fillWhere(form, p) {
  const st = state[form.prefix];
  if (form.locations) {
    fillRow(rowsOf(form)[0], p, '');
  } else {
    setVal(form.city, p.line || p.town || '');
    if (form.lat) { setVal(form.lat, fix6(p.lat)); setVal(form.lng, fix6(p.lng)); }
    else if (p.lat != null) { st.extras.lat = fix6(p.lat); st.extras.lng = fix6(p.lng); }
  }
  if (p.country) st.extras.country = p.country;
}

function note(form, html) { const el = $(form.prefix + 'AfPicked'); el.innerHTML = html; el.hidden = !html; }
function more(form, html) { const el = $(form.prefix + 'AfMore'); el.innerHTML = html; el.hidden = !html; }

// opt.name: the name to show (from a Google Maps link); opt.extra: HTML added to the note.
async function fillPlace(form, p, opt = {}) {
  const st = state[form.prefix];
  const mine = ++st.seq;
  if (!p.line) p.line = lineOf(p);
  setVal(form.name, opt.name || p.name);
  fillWhere(form, p);
  if (form.type) { const t = foodType(p.osmKey, p.osmValue, ''); if (t) setSelect(form.type, t); }
  const wrongSection = (p.cat && p.cat !== form.cat
    ? `<br>⚠️ OpenStreetMap noemt dit ${esc(catInfo(p.cat).label)}${p.type ? ' (' + esc(p.type) + ')' : ''}. Kijk of je in de goede categorie zit.` : '') + (opt.extra || '');
  note(form, `✓ Ingevuld: naam, adres en coördinaten. Ik zoek openingstijden en telefoon op…${wrongSection}`);

  const tags = (await osmDetails([p]))[osmKeyOf(p)] || {};
  if (mine !== st.seq) return;
  const done = ['naam', 'adres', 'coördinaten'];
  const hours = niceHours(tags.opening_hours);
  if (hours) {
    const h = form.locations && rowsOf(form)[0].querySelector('.loc-hours');
    if (h) { h.value = hours; done.push('openingstijden'); }
    else st.extras.hours = hours;          // the form has no hours field: saved with the review
  }
  if (form.type) {
    const t = foodType(p.osmKey, p.osmValue, tags.cuisine);
    if (t) { setSelect(form.type, t); done.push('soort eten'); }
  }
  const phone = phoneOf(tags);
  if (phone) st.extras.phone = phone;
  const saved = [st.extras.phone && 'telefoon ' + esc(st.extras.phone), st.extras.country && 'land ' + esc(st.extras.country),
    !form.locations && st.extras.hours && 'openingstijden ' + esc(st.extras.hours),
    !form.locations && !form.lat && st.extras.lat != null && 'coördinaten'].filter(Boolean);
  note(form, `✓ Ingevuld: ${done.filter(x => form.locations || form.lat || x !== 'coördinaten').join(', ')}.`
    + (saved.length ? ` Wordt ook bij de review opgeslagen: ${saved.join(', ')}.` : '')
    + (hours ? '' : ' Geen openingstijden gevonden: vul ze zelf in als je ze weet.')
    + ' Kijk alles na en pas aan wat je wilt.' + wrongSection);

  if (form.locations) findBranches(form, p, mine);
}

// Other branches with exactly the same name (Eat and Shop have a row per location).
async function findBranches(form, p, mine) {
  const st = state[form.prefix];
  let feats = [];
  try { feats = await photon(p.name, 40); } catch (e) { return; }
  if (mine !== st.seq) return;
  const want = foldText(p.name);
  const taken = rowsOf(form).map(r => ({ lat: parseFloat(r.querySelector('.loc-lat').value), lng: parseFloat(r.querySelector('.loc-lng').value) }))
    .filter(t => isFinite(t.lat) && isFinite(t.lng));
  const list = [];
  for (const f of feats) {
    if (!isPoiFeature(f)) continue;
    const b = toPlace(f);
    if (foldText(b.name) !== want || b.lat == null) continue;
    if (taken.concat(list).some(t => distM(t, b) < 150)) continue;
    list.push(b);
    if (list.length >= MAX_BRANCHES) break;
  }
  if (!list.length) return;
  st.branches = list;
  const n = list.length;
  more(form, `<p><strong>${n} andere ${n === 1 ? 'vestiging' : 'vestigingen'} van ${esc(p.name)} gevonden.</strong> Vink aan welke je als extra locatie wilt toevoegen.</p>
    ${list.map((b, i) => `<label><input type="checkbox" data-b="${i}"${b.countryCode === p.countryCode ? ' checked' : ''}>
      <span>${esc(b.line || b.town || b.address)}${b.country ? ', ' + esc(b.country) : ''}</span></label>`).join('')}
    <button type="button" class="af-btn" data-add-branches>+ Locaties toevoegen</button>`);
  const box = $(form.prefix + 'AfMore');
  const btn = box.querySelector('[data-add-branches]');
  const count = () => {
    const k = box.querySelectorAll('input[data-b]:checked').length;
    btn.textContent = k ? `+ ${k} ${k === 1 ? 'locatie' : 'locaties'} toevoegen` : 'Vink eerst een locatie aan';
    btn.disabled = !k;
  };
  box.addEventListener('change', count);
  count();
  btn.addEventListener('click', () => addBranches(form, Array.from(box.querySelectorAll('input[data-b]:checked')).map(c => list[+c.dataset.b]), mine));
}

async function addBranches(form, chosen, mine) {
  const st = state[form.prefix];
  const btn = $(form.prefix + 'AfMore').querySelector('[data-add-branches]');
  btn.disabled = true; btn.textContent = 'Bezig…';
  const det = await osmDetails(chosen);
  if (mine !== st.seq) return;
  for (const b of chosen) {
    window.addLocationRow(form.locations);
    const rows = rowsOf(form);
    fillRow(rows[rows.length - 1], b, niceHours((det[osmKeyOf(b)] || {}).opening_hours));
  }
  more(form, '');
  const el = $(form.prefix + 'AfPicked');
  el.insertAdjacentHTML('beforeend', `<br>✓ ${chosen.length} extra ${chosen.length === 1 ? 'locatie' : 'locaties'} toegevoegd.`);
}

async function onPick(form, pick) {
  const st = state[form.prefix];
  st.seq++;
  st.extras = {};
  st.branches = [];
  more(form, '');
  if (!pick || pick.src === 'sf') return;            // typing again, or already on Strong Foodie
  if (pick.src !== 'addr') { fillPlace(form, pick); return; }

  // A street address: fill in where it is, then offer the places at that address.
  pick.line = pick.line || lineOf(pick);
  fillWhere(form, pick);
  note(form, '✓ Ingevuld: adres en coördinaten. Ik zoek plekken op dit adres…');
  const mine = st.seq;
  let near = [];
  try { near = await nearby(pick.lat, pick.lng); } catch (e) { near = []; }
  if (mine !== st.seq) return;
  if (!near.length) {
    note(form, '✓ Ingevuld: adres en coördinaten. Geen zaak gevonden op dit adres: typ de naam zelf.');
    return;
  }
  note(form, '✓ Ingevuld: adres en coördinaten.');
  more(form, `<p><strong>Plekken op dit adres.</strong> Kies er een om de rest in te vullen.</p>
    <div class="af-chips">${near.map((p, i) => `<button type="button" class="af-chip" data-n="${i}">${catInfo(p.cat || form.cat).emoji} ${esc(p.name)}${p.type ? ` <small>${esc(p.type)}</small>` : ''}</button>`).join('')}</div>`);
  $(form.prefix + 'AfMore').querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => {
    more(form, '');
    $(form.prefix + 'AfFind').value = near[+b.dataset.n].name;
    fillPlace(form, near[+b.dataset.n]);
  }));
}


// ── Google Maps link ────────────────────────────────────────────────────

const SHORT_LINK = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i;
const LONG_LINK = /^https?:\/\/(((www|maps)\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+\/)/i;
export const isShortMapsLink = t => SHORT_LINK.test(String(t || '').trim());
export const isMapsLink = t => { const x = String(t || '').trim(); return SHORT_LINK.test(x) || LONG_LINK.test(x); };

// Name and pin from a long Google Maps address. Null when it isn't one.
//   /maps/place/Ros%C3%A8l+Amsterdam/@52.37,4.88,17z/data=…!3d52.3717!4d4.8892…
//   /maps?q=52.37,4.88   /maps?q=Rosèl,+Spuistraat+214,+Amsterdam   /maps/search/?api=1&query=…
export function parseMapsUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
  if (!LONG_LINK.test(u.href)) return null;
  const dec = x => { try { return decodeURIComponent(String(x).replace(/\+/g, ' ')); } catch (e) { return String(x).replace(/\+/g, ' '); } };
  const path = u.pathname;
  let name = '', full = '', lat = null, lng = null;
  const place = path.match(/\/maps\/place\/([^/]+)/);
  if (place && !/^@/.test(place[1])) full = dec(place[1]);
  const pin = (path + u.search + u.hash).match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  const at = path.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (pin) { lat = +pin[1]; lng = +pin[2]; } else if (at) { lat = +at[1]; lng = +at[2]; }
  const q = u.searchParams.get('q') || u.searchParams.get('query') || '';
  if (q) {
    const ll = q.match(/^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
    if (ll) { if (lat == null) { lat = +ll[1]; lng = +ll[2]; } } else if (!full) full = q.trim();
  }
  const search = path.match(/\/maps\/search\/([^/@]+)/);
  if (!full && search) {
    const t = dec(search[1]);
    const ll = t.match(/^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
    if (ll) { if (lat == null) { lat = +ll[1]; lng = +ll[2]; } } else full = t;
  }
  full = full.replace(/\s+/g, ' ').trim();
  name = full.split(',')[0].trim();
  if (lat != null && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) { lat = null; lng = null; }
  if (!name && lat == null) return null;
  return { name, full: full || name, lat, lng };
}

// Do two names belong to the same place? "Rosèl Amsterdam" and "Rosèl" do.
const COMMON = new Set(['the', 'and', 'de', 'het', 'een', 'van', 'restaurant', 'cafe', 'bar', 'hotel', 'eatery', 'kitchen', 'bistro', 'grill', 'shop', 'store', 'gym', 'club', 'house', 'amsterdam', 'los', 'angeles', 'aruba', 'rotterdam', 'istanbul', 'dubai', 'london', 'paris', 'new', 'york']);
const wordsOf = t => foldText(t).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !COMMON.has(w));
export function sameName(a, b) {
  const x = foldText(a).replace(/[^a-z0-9]/g, ''), y = foldText(b).replace(/[^a-z0-9]/g, '');
  if (!x || !y) return false;
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return true;
  const wy = new Set(wordsOf(b));
  return wordsOf(a).some(w => wy.has(w));
}

// OpenStreetMap places near the pin: the one with the same name, and the others close by.
async function nearPin(g) {
  const here = { lat: g.lat, lng: g.lng };
  let feats = [];
  try {
    const res = await fetch('https://photon.komoot.io/api/?' + new URLSearchParams({ q: g.name || g.full, lat: String(g.lat), lon: String(g.lng), limit: '15', lang: 'en' }));
    if (res.ok) feats = ((await res.json()) || {}).features || [];
  } catch (e) { feats = []; }
  const named = feats.filter(isPoiFeature).map(toPlace).filter(p => p.lat != null && distM(here, p) <= 250 && sameName(p.name, g.name))
    .sort((a, b) => distM(here, a) - distM(here, b));
  if (named.length) return { match: named[0], near: [] };
  let near = [];
  try { near = await nearby(g.lat, g.lng); } catch (e) { near = []; }
  const same = near.find(p => sameName(p.name, g.name));
  return { match: same || null, near: same ? [] : near };
}

// The street address at the pin, when OpenStreetMap doesn't know the place itself.
async function addressAt(lat, lng) {
  try {
    const res = await fetch('https://photon.komoot.io/reverse?' + new URLSearchParams({ lat: String(lat), lon: String(lng), limit: '1', lang: 'en' }));
    if (!res.ok) return null;
    const f = (((await res.json()) || {}).features || [])[0];
    if (!f) return null;
    const p = toPlace(f);
    p.lat = lat; p.lng = lng;
    return p.line ? p : null;
  } catch (e) { return null; }
}

// For the member form on add.html (English): what a Google Maps link points to.
// → { ok: false, reason: 'short' | 'unreadable' }, or { ok: true, g, match, near, where }:
//   match: the place in OpenStreetMap (with Google's pin), near: places close to the pin
//   when there is no match, where: the street address at the pin when there is no match.
export async function resolveMapsLink(raw, opts = {}) {
  let url = String(raw || '').trim();
  if (isShortMapsLink(url)) {
    if (!opts.expandLink) return { ok: false, reason: 'short' };
    try { url = await opts.expandLink(url); } catch (e) { console.log('expandMapsLink:', e); return { ok: false, reason: 'short' }; }
  }
  const g = parseMapsUrl(url);
  if (!g) return { ok: false, reason: 'unreadable' };
  let match = null, near = [], where = null;
  if (g.lat != null) ({ match, near } = await nearPin(g));
  else {
    let feats = [];
    try { feats = await photon(g.full, 10); } catch (e) { feats = []; }
    match = feats.filter(isPoiFeature).map(toPlace).find(p => sameName(p.name, g.name)) || null;
  }
  if (match && g.lat != null) { match.lat = g.lat; match.lng = g.lng; }
  if (!match && g.lat != null) where = await addressAt(g.lat, g.lng);
  // "360 Hampton Drive" in the US, "Spuistraat 214" in the Netherlands
  for (const p of [match, where, ...near]) {
    if (!p || !p.streetName) continue;
    p.street = lineOf(p).split(', ')[0];
    p.address = [p.street, [p.postcode, p.town].filter(Boolean).join(' '), p.country].filter(Boolean).join(', ');
  }
  return { ok: true, g, match, near, where };
}

const SHORT_HELP = 'Deze korte link kan ik nu niet openen. Open hem in je browser, kopieer het lange adres uit de adresbalk en plak dat hier.';

async function fromLink(form, raw, opts) {
  const P = form.prefix, st = state[P];
  st.finder.reset();
  st.seq++; st.extras = {}; st.branches = [];
  const mine = st.seq;
  more(form, '');
  let url = String(raw || '').trim();
  if (isShortMapsLink(url)) {
    if (!opts.expandLink) { note(form, SHORT_HELP); return; }
    note(form, '🔗 Korte Google Maps-link: ik open hem…');
    try { url = await opts.expandLink(url); } catch (e) { console.log('expandMapsLink:', e); if (mine === st.seq) note(form, SHORT_HELP); return; }
    if (mine !== st.seq) return;
  }
  const g = parseMapsUrl(url);
  if (!g) { note(form, 'Deze link kan ik niet lezen. Open de plek in Google Maps, tik op Delen › Link kopiëren en plak die link hier.'); return; }
  note(form, `🔗 Uit de link: ${esc(g.name || 'een plek op de kaart')}. Ik zoek de gegevens op…`);
  const known = g.name ? await strongFoodiePlaces(opts.db).then(all => all.find(x => x.n === foldText(g.name) || sameName(x.name, g.name) && (!x.town || foldText(g.full).includes(foldText(x.town))))).catch(() => null) : null;
  if (mine !== st.seq) return;
  const already = known ? `<br>⚠️ ${esc(known.name)} staat al op Strong Foodie${known.where ? ' (' + esc(known.where) + ')' : ''}. Bewerk hem liever in de lijst hieronder dan hem dubbel toe te voegen.` : '';

  let match = null, near = [];
  if (g.lat != null) ({ match, near } = await nearPin(g));
  else {
    let feats = [];
    try { feats = await photon(g.full, 10); } catch (e) { feats = []; }
    match = feats.filter(isPoiFeature).map(toPlace).find(p => sameName(p.name, g.name)) || null;
  }
  if (mine !== st.seq) return;
  const input = $(P + 'AfFind');
  if (match) {
    if (g.lat != null) { match.lat = g.lat; match.lng = g.lng; }   // Google's pin is the most precise
    input.value = g.name || match.name;
    fillPlace(form, match, { name: g.name || match.name, extra: already });
    return;
  }
  // OpenStreetMap doesn't know it: the name, the pin and the street address at the pin.
  if (g.name) { setVal(form.name, g.name); input.value = g.name; }
  const where = g.lat != null ? (await addressAt(g.lat, g.lng)) || { lat: g.lat, lng: g.lng, line: '' } : null;
  if (mine !== st.seq) return;
  if (where) fillWhere(form, where);
  const got = [g.name && 'naam', where && where.line && 'adres', where && 'coördinaten'].filter(Boolean);
  note(form, (got.length ? `✓ Ingevuld: ${got.join(', ')}. ` : '') + 'Niet gevonden in OpenStreetMap: openingstijden en telefoon vul je zelf in.' + already);
  if (near.length) {
    more(form, `<p><strong>Plekken vlak bij de pin.</strong> Is het een van deze? Kies hem om de rest in te vullen.</p>
      <div class="af-chips">${near.map((p, i) => `<button type="button" class="af-chip" data-n="${i}">${catInfo(p.cat || form.cat).emoji} ${esc(p.name)}${p.type ? ` <small>${esc(p.type)}</small>` : ''}</button>`).join('')}</div>`);
    $(P + 'AfMore').querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => {
      more(form, '');
      const p = near[+b.dataset.n];
      if (g.lat != null) { p.lat = g.lat; p.lng = g.lng; }
      fillPlace(form, p, { name: g.name || p.name, extra: already });
    }));
  }
}

const CSS = `
  .af-box { margin-bottom: 1rem; padding: 12px 14px; border: 1px dashed var(--accent); border-radius: 12px; background: rgba(255,255,255,0.75); }
  .af-label { display: block; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink); font-weight: 600; margin-bottom: 6px; }
  .af-box .sugg { list-style: none; margin: 0.35rem 0 0; padding: 0; border: 1px solid var(--border); border-radius: 12px; background: #fff; overflow: hidden; box-shadow: 0 8px 24px rgba(26,18,8,0.08); }
  .af-box .sugg li { display: flex; gap: 0.6rem; align-items: flex-start; padding: 10px 12px; border-top: 1px solid var(--border); cursor: pointer; }
  .af-box .sugg li:first-child { border-top: none; }
  .af-box .sugg li.active, .af-box .sugg li:hover { background: #FFF1EA; }
  .af-box .sugg .s-emoji { font-size: 18px; line-height: 1.25; flex-shrink: 0; }
  .af-box .sugg .s-text { min-width: 0; }
  .af-box .sugg .s-name { font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
  .af-box .sugg .s-meta { display: block; font-size: 12.5px; color: var(--muted); line-height: 1.4; overflow-wrap: anywhere; }
  .af-box .sugg .s-on { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--green); background: #E3EEE6; border-radius: 8px; padding: 1px 6px; margin-left: 6px; vertical-align: 2px; }
  .af-box .sugg .sugg-note { display: block; cursor: default; font-size: 12px; color: var(--muted); }
  .af-box .sugg .sugg-note:hover { background: none; }
  .af-note { margin-top: 8px; font-size: 12.5px; color: var(--ink); line-height: 1.5; }
  .af-more { margin-top: 10px; font-size: 13px; line-height: 1.45; }
  .af-more p { margin: 0 0 6px; }
  .af-more label { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; cursor: pointer; }
  .af-more input[type=checkbox] { margin-top: 3px; accent-color: var(--accent); }
  .af-btn { margin-top: 6px; background: none; border: 1px dashed var(--accent); color: var(--accent); border-radius: 8px; padding: 8px 14px; cursor: pointer; font-size: 12px; font-weight: 600; font-family: inherit; }
  .af-btn:disabled { opacity: 0.55; cursor: default; }
  .af-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .af-chip { background: #fff; border: 1px solid var(--border); border-radius: 100px; padding: 7px 12px; font-size: 13px; cursor: pointer; font-family: inherit; color: var(--ink); text-align: left; }
  .af-chip:hover { border-color: var(--accent); }
  .af-chip small { color: var(--muted); }
  .af-box [hidden] { display: none !important; }
`;

// opts.expandLink(url) → the long address of a short Google Maps link (admin.html passes
// the Cloud Function expandMapsLink). Without it, short links ask for the long address.
export function setupAutofill(db, opts = {}) {
  if (!document.getElementById('afStyle')) {
    const style = document.createElement('style');
    style.id = 'afStyle';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  for (const form of FORMS) {
    const nameEl = $(form.name);
    if (!nameEl || $(form.prefix + 'Af')) continue;
    const P = form.prefix;
    const anchor = nameEl.closest('.form-row') || nameEl.parentElement.parentElement;
    anchor.insertAdjacentHTML('beforebegin', `
      <div class="af-box" id="${P}Af">
        <label class="af-label" for="${P}AfFind">🔎 Invullen met de naam, het adres of een Google Maps-link</label>
        <input class="form-input" type="text" id="${P}AfFind" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${P}AfList"
          placeholder="Naam, adres of Google Maps-link, bijv. Bakers &amp; Roasters Amsterdam">
        <ul class="sugg" id="${P}AfList" role="listbox" hidden></ul>
        <div class="af-note" id="${P}AfPicked" hidden></div>
        <div class="af-more" id="${P}AfMore" hidden></div>
      </div>`);
    state[P] = { seq: 0, extras: {}, branches: [] };
    // A Google Maps link: read it instead of searching for the text. Added before the
    // type-ahead and in the capture phase, so the type-ahead never sees the link.
    const linkOpts = { db, expandLink: opts.expandLink };
    let lastLink = '', linkTimer = null;
    const run = v => { if (v === lastLink) return; lastLink = v; fromLink(form, v, linkOpts).catch(e => { console.log('Google Maps link:', e && e.stack || e); note(form, 'Er ging iets mis met deze link. Probeer het nog eens, of typ de naam.'); }); };
    const onLink = e => {
      const v = $(P + 'AfFind').value.trim();
      if (!isMapsLink(v)) { lastLink = ''; clearTimeout(linkTimer); return; }
      e.stopImmediatePropagation();
      clearTimeout(linkTimer);
      if (e.type === 'keydown') { if (e.key === 'Enter') { e.preventDefault(); lastLink = ''; run(v); } return; }
      linkTimer = setTimeout(() => run(v), 400);   // a pasted link is whole at once; typed by hand, wait a moment
    };
    $(P + 'AfFind').addEventListener('input', onLink, { capture: true });
    $(P + 'AfFind').addEventListener('keydown', onLink, { capture: true });
    state[P].finder = placeFinder({
      db, input: $(P + 'AfFind'), list: $(P + 'AfList'), picked: $(P + 'AfPicked'),
      catName: P + 'AfNoCategory', idPrefix: P + 'AfS',
      emptyText: 'Niets gevonden. Probeer de naam met de plaats, de straat met huisnummer, of plak een Google Maps-link.',
      moreResults: addressSearch,
      describe: s => s.src === 'sf'
        ? `✓ ${esc(s.name)} staat al op Strong Foodie. Bewerk hem in de lijst hieronder in plaats van hem opnieuw toe te voegen.`
        : `📍 ${esc([s.type, s.address].filter(Boolean).join(' · ') || s.name)}`,
      onPick: s => onPick(form, s),
    });
    $(P + 'AfFind').addEventListener('focus', () => state[P].finder.warmUp(), { once: true });
  }
}

// What the last pick adds to the document besides the form fields (phone, country...).
export function autofillExtras(prefix) {
  const st = state[prefix];
  if (!st) return {};
  const out = {};
  for (const [k, v] of Object.entries(st.extras)) if (v !== '' && v != null) out[k] = v;
  return out;
}

// After saving, or when another item is loaded into the form.
export function clearAutofill(prefix) {
  const st = state[prefix];
  if (!st) return;
  st.seq++;
  st.extras = {};
  st.branches = [];
  st.finder.reset();
  const input = $(prefix + 'AfFind');
  if (input) input.value = '';
  more({ prefix }, '');
  note({ prefix }, '');
}
