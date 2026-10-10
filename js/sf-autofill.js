// Strong Foodie admin: fill in a review form from the place's name or address.
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
// Data: OpenStreetMap, through Photon (search, free, no key) and Nominatim
// (opening hours and phone, one request per pick, never while typing).

import { placeFinder, fromFeature, isPoiFeature, foldText, catInfo } from './sf-find.js?v=5';
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
    out.push({ ...a, src: 'addr', key, name: a.line.split(',')[0], type: 'Address', cat: null, address: [a.line, a.country].filter(Boolean).join(', ') });
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
function setSelect(id, text) {
  const el = $(id);
  if (el && Array.from(el.options).some(o => (o.value || o.text) === text)) el.value = text;
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

async function fillPlace(form, p) {
  const st = state[form.prefix];
  const mine = ++st.seq;
  if (!p.line) p.line = lineOf(p);
  setVal(form.name, p.name);
  fillWhere(form, p);
  if (form.type) { const t = foodType(p.osmKey, p.osmValue, ''); if (t) setSelect(form.type, t); }
  const wrongSection = p.cat && p.cat !== form.cat
    ? `<br>⚠️ OpenStreetMap lists this as ${esc(catInfo(p.cat).label)}${p.type ? ' (' + esc(p.type) + ')' : ''}. Check that you are in the right section.` : '';
  note(form, `✓ Filled in: name, address and coordinates. Looking up opening hours and phone…${wrongSection}`);

  const tags = (await osmDetails([p]))[osmKeyOf(p)] || {};
  if (mine !== st.seq) return;
  const done = ['name', 'address', 'coordinates'];
  const hours = niceHours(tags.opening_hours);
  if (hours) {
    const h = form.locations && rowsOf(form)[0].querySelector('.loc-hours');
    if (h) { h.value = hours; done.push('opening hours'); }
    else st.extras.hours = hours;          // the form has no hours field: saved with the review
  }
  if (form.type) {
    const t = foodType(p.osmKey, p.osmValue, tags.cuisine);
    if (t) { setSelect(form.type, t); done.push('food type'); }
  }
  const phone = phoneOf(tags);
  if (phone) st.extras.phone = phone;
  const saved = [st.extras.phone && 'phone ' + esc(st.extras.phone), st.extras.country && 'country ' + esc(st.extras.country),
    !form.locations && st.extras.hours && 'opening hours ' + esc(st.extras.hours),
    !form.locations && !form.lat && st.extras.lat != null && 'coordinates'].filter(Boolean);
  note(form, `✓ Filled in: ${done.filter(x => form.locations || form.lat || x !== 'coordinates').join(', ')}.`
    + (saved.length ? ` Also saved with the review: ${saved.join(', ')}.` : '')
    + (hours ? '' : ' No opening hours found: add them yourself if you know them.')
    + ' Check everything and change what you like.' + wrongSection);

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
  more(form, `<p><strong>${n} more location${n === 1 ? '' : 's'} of ${esc(p.name)} found.</strong> Tick the ones to add as extra locations.</p>
    ${list.map((b, i) => `<label><input type="checkbox" data-b="${i}"${b.countryCode === p.countryCode ? ' checked' : ''}>
      <span>${esc(b.line || b.town || b.address)}${b.country ? ', ' + esc(b.country) : ''}</span></label>`).join('')}
    <button type="button" class="af-btn" data-add-branches>+ Add locations</button>`);
  const box = $(form.prefix + 'AfMore');
  const btn = box.querySelector('[data-add-branches]');
  const count = () => {
    const k = box.querySelectorAll('input[data-b]:checked').length;
    btn.textContent = k ? `+ Add ${k} location${k === 1 ? '' : 's'}` : 'Tick a location first';
    btn.disabled = !k;
  };
  box.addEventListener('change', count);
  count();
  btn.addEventListener('click', () => addBranches(form, Array.from(box.querySelectorAll('input[data-b]:checked')).map(c => list[+c.dataset.b]), mine));
}

async function addBranches(form, chosen, mine) {
  const st = state[form.prefix];
  const btn = $(form.prefix + 'AfMore').querySelector('[data-add-branches]');
  btn.disabled = true; btn.textContent = 'Adding…';
  const det = await osmDetails(chosen);
  if (mine !== st.seq) return;
  for (const b of chosen) {
    window.addLocationRow(form.locations);
    const rows = rowsOf(form);
    fillRow(rows[rows.length - 1], b, niceHours((det[osmKeyOf(b)] || {}).opening_hours));
  }
  more(form, '');
  const el = $(form.prefix + 'AfPicked');
  el.insertAdjacentHTML('beforeend', `<br>✓ ${chosen.length} more location${chosen.length === 1 ? '' : 's'} added.`);
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
  note(form, '✓ Filled in: address and coordinates. Looking for places at this address…');
  const mine = st.seq;
  let near = [];
  try { near = await nearby(pick.lat, pick.lng); } catch (e) { near = []; }
  if (mine !== st.seq) return;
  if (!near.length) {
    note(form, '✓ Filled in: address and coordinates. No business found at this address: type the name yourself.');
    return;
  }
  note(form, '✓ Filled in: address and coordinates.');
  more(form, `<p><strong>Places at this address.</strong> Pick one to fill in the rest.</p>
    <div class="af-chips">${near.map((p, i) => `<button type="button" class="af-chip" data-n="${i}">${catInfo(p.cat || form.cat).emoji} ${esc(p.name)}${p.type ? ` <small>${esc(p.type)}</small>` : ''}</button>`).join('')}</div>`);
  $(form.prefix + 'AfMore').querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => {
    more(form, '');
    $(form.prefix + 'AfFind').value = near[+b.dataset.n].name;
    fillPlace(form, near[+b.dataset.n]);
  }));
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

export function setupAutofill(db) {
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
        <label class="af-label" for="${P}AfFind">🔎 Fill in from the name or address</label>
        <input class="form-input" type="text" id="${P}AfFind" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${P}AfList"
          placeholder="Name or address, e.g. Bakers &amp; Roasters Amsterdam, or Singel 83 Amsterdam">
        <ul class="sugg" id="${P}AfList" role="listbox" hidden></ul>
        <div class="af-note" id="${P}AfPicked" hidden></div>
        <div class="af-more" id="${P}AfMore" hidden></div>
      </div>`);
    state[P] = { seq: 0, extras: {}, branches: [] };
    state[P].finder = placeFinder({
      db, input: $(P + 'AfFind'), list: $(P + 'AfList'), picked: $(P + 'AfPicked'),
      catName: P + 'AfNoCategory', idPrefix: P + 'AfS',
      emptyText: 'Nothing found. Try the name with the town, or the street and number.',
      moreResults: addressSearch,
      describe: s => s.src === 'sf'
        ? `✓ ${esc(s.name)} is already on Strong Foodie. Edit it in the list further down instead of adding it again.`
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
