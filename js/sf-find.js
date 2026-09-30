// Strong Foodie: find a place while you type.
// Used by the wishlist (account.html) and Add a spot (add.html).
//
// Suggestions come from Strong Foodie itself (places already on the site)
// and from OpenStreetMap through Photon (photon.komoot.io, free, no key).
// Picking one fills in the name and the address and chooses one of the six
// categories. The app does the same (Rork batch 8), so both save the same fields.

import { CATS, loadPlaces } from './sf-places.js?v=7';

export const CAT_LIST = Object.keys(CATS).map(key => ({ key, label: CATS[key].label, emoji: CATS[key].emoji }));
export const catInfo = k => CAT_LIST.find(c => c.key === k) || CAT_LIST[0];
export const foldText = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// OpenStreetMap kind of place → one of the six categories
const OSM_CAT = {
  amenity: {
    eat: ['restaurant', 'fast_food', 'cafe', 'food_court', 'ice_cream'],
    drink: ['bar', 'pub', 'biergarten', 'nightclub'],
    culture: ['theatre', 'cinema', 'arts_centre', 'library', 'planetarium', 'concert_hall', 'place_of_worship', 'exhibition_centre'],
    health: ['gym', 'spa', 'sauna', 'dojo', 'public_bath'],
    shop: ['marketplace'],
  },
  tourism: {
    stay: ['hotel', 'hostel', 'guest_house', 'motel', 'apartment', 'chalet', 'camp_site', 'caravan_site', 'alpine_hut', 'resort', 'wilderness_hut'],
    culture: ['museum', 'gallery', 'attraction', 'artwork', 'zoo', 'theme_park', 'aquarium', 'viewpoint'],
  },
  leisure: {
    health: ['fitness_centre', 'sports_centre', 'swimming_pool', 'sauna', 'spa', 'stadium', 'sports_hall', 'golf_course', 'ice_rink', 'climbing', 'water_park', 'bowling_alley', 'horse_riding', 'fitness_station', 'pitch', 'track'],
    stay: ['resort'],
    culture: ['park', 'garden', 'nature_reserve'],
  },
  shop: {
    eat: ['bakery', 'pastry', 'confectionery', 'chocolate', 'deli', 'cheese', 'ice_cream'],
    health: ['massage', 'beauty', 'nutrition_supplements'],
  },
  craft: { drink: ['brewery', 'distillery', 'winery'] },
};
const POI_KEYS = new Set(['amenity', 'shop', 'tourism', 'leisure', 'historic', 'craft', 'club', 'healthcare']);

export function catFromOsm(key, value) {
  const groups = OSM_CAT[key];
  if (groups) for (const cat of Object.keys(groups)) if (groups[cat].includes(value)) return cat;
  if (key === 'shop') return 'shop';        // every other kind of shop
  if (key === 'historic') return 'culture';
  if (key === 'club' && value === 'sport') return 'health';
  return null;
}
export const typeLabel = v => !v || v === 'yes' ? '' : (v.charAt(0).toUpperCase() + v.slice(1)).replace(/_/g, ' ');

function fromFeature(f) {
  const p = f.properties || {};
  const [lng, lat] = (f.geometry && f.geometry.coordinates) || [];
  const town = p.city || p.town || p.village || p.locality || p.district || p.county || p.state || '';
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const address = [street, [p.postcode, town].filter(Boolean).join(' '), p.country].filter(Boolean).join(', ');
  return {
    src: 'osm', key: foldText(p.name) + '|' + foldText(address), name: p.name || '',
    cat: catFromOsm(p.osm_key, p.osm_value), type: typeLabel(p.osm_value),
    street, postcode: p.postcode || '', town, country: p.country || '', countryCode: (p.countrycode || '').toUpperCase(), address,
    lat: typeof lat === 'number' ? lat : null, lng: typeof lng === 'number' ? lng : null,
  };
}

// Places (restaurants, hotels, shops...) matching the text. Streets, towns and countries are left out.
export async function photonSearch(q, limit = 5) {
  const res = await fetch('https://photon.komoot.io/api/?' + new URLSearchParams({ q, limit: '12', lang: 'en' }));
  if (!res.ok) return [];
  const data = await res.json();
  const out = [];
  for (const f of (data && data.features) || []) {
    const p = f.properties || {};
    if (!p.name || !POI_KEYS.has(p.osm_key)) continue;
    const r = fromFeature(f);
    if (out.some(o => o.key === r.key)) continue;
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

// Coordinates for an address typed by hand, so the spot can go on the map. Null when not found.
export async function geocode(text) {
  try {
    const res = await fetch('https://photon.komoot.io/api/?' + new URLSearchParams({ q: text, limit: '1', lang: 'en' }));
    if (!res.ok) return null;
    const data = await res.json();
    const f = data && data.features && data.features[0];
    const c = f && f.geometry && f.geometry.coordinates;
    return c && typeof c[0] === 'number' && typeof c[1] === 'number' ? { lat: c[1], lng: c[0] } : null;
  } catch (e) { return null; }
}

// Everything already on Strong Foodie, loaded once per page.
let sfPromise = null;
export function strongFoodiePlaces(db) {
  if (!sfPromise) sfPromise = loadPlaces(db)
    .then(r => r.all.map(p => ({ src: 'sf', name: p.name, n: foldText(p.name), cat: p.cat, coll: p.coll, id: p.id, where: p.where || '', town: p.town || '', country: p.country || '' })))
    .catch(e => { console.log('Strong Foodie places could not load:', e); return []; });
  return sfPromise;
}

// The type-ahead itself.
// opts: db, input, list, picked, hint, address (elements), catName (radio name),
//       idPrefix, describe(pick) → HTML for the "picked" line, onPick(pick)
export function placeFinder(opts) {
  const { db, input, list, picked: pickedEl, hint, address: addr, catName, idPrefix = 'sug' } = opts;
  const describe = opts.describe || (p => p.src === 'sf'
    ? `✓ ${esc(p.name)} is already on Strong Foodie.`
    : `📍 ${esc([p.type, p.address].filter(Boolean).join(' · ') || p.name)}`);
  const addressOf = opts.addressOf || (p => p.src === 'sf' ? p.where : p.address);
  let pick = null, items = [], active = -1, timer = null, seq = 0;

  const close = () => { list.hidden = true; list.innerHTML = ''; items = []; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const showPicked = () => {
    if (!pick) { pickedEl.hidden = true; pickedEl.innerHTML = ''; return; }
    pickedEl.innerHTML = describe(pick);
    pickedEl.hidden = false;
  };
  const setActive = i => {
    active = i;
    list.querySelectorAll('[role="option"]').forEach((li, j) => li.classList.toggle('active', j === i));
    if (i >= 0) input.setAttribute('aria-activedescendant', idPrefix + i); else input.removeAttribute('aria-activedescendant');
  };

  function choose(i) {
    const s = items[i];
    if (!s) return;
    pick = s;
    input.value = s.name;
    const radio = s.cat && document.querySelector(`input[name="${catName}"][value="${s.cat}"]`);
    if (radio) radio.checked = true;
    if (hint) hint.hidden = !radio;
    if (addr) addr.value = addressOf(s);
    showPicked();
    close();
    if (opts.onPick) opts.onPick(s);
  }

  function render() {
    if (!items.length) {
      list.innerHTML = `<li class="sugg-note">No match found. You can still add it: choose a category below.</li>`;
    } else {
      list.innerHTML = items.map((s, i) => {
        const c = s.cat ? catInfo(s.cat) : null;
        const meta = s.src === 'sf' ? [c && c.label, s.where].filter(Boolean).join(' · ') : [s.type, s.address].filter(Boolean).join(' · ');
        return `<li role="option" id="${idPrefix}${i}" data-i="${i}" aria-selected="false"><span class="s-emoji">${c ? c.emoji : '📍'}</span>
          <span class="s-text"><span class="s-name">${esc(s.name)}</span>${s.src === 'sf' ? '<span class="s-on">On Strong Foodie</span>' : ''}
          <span class="s-meta">${esc(meta)}</span></span></li>`;
      }).join('') + (items.some(s => s.src === 'osm') ? '<li class="sugg-note">Addresses © OpenStreetMap contributors</li>' : '');
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  }

  async function search(q) {
    const mine = ++seq;
    const fq = foldText(q);
    const [sf, osm] = await Promise.all([
      strongFoodiePlaces(db).then(all => all.filter(p => p.n.includes(fq)).slice(0, 3)),
      photonSearch(q).catch(() => []),
    ]);
    if (mine !== seq || foldText(input.value) !== fq) return;   // an older search, or typing went on
    items = sf.concat(osm.filter(o => !sf.some(p => p.n === foldText(o.name))));
    render();
  }

  input.addEventListener('input', () => {
    if (pick) {   // typing again forgets the earlier pick, and the address that came with it
      if (addr && addr.value === addressOf(pick)) addr.value = '';
      pick = null; showPicked(); if (hint) hint.hidden = true;
      if (opts.onPick) opts.onPick(null);
    }
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { seq++; close(); return; }
    timer = setTimeout(() => search(q), 350);
  });
  input.addEventListener('keydown', e => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(active + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { close(); }
  });
  // mousedown keeps the focus in the field on a computer; a tap on a phone is a click
  list.addEventListener('mousedown', e => { if (e.target.closest('[data-i]')) e.preventDefault(); });
  list.addEventListener('click', e => {
    const li = e.target.closest('[data-i]');
    if (li) choose(+li.dataset.i);
  });
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 150));
  // A hand-picked category hides the "we picked it" hint.
  document.querySelectorAll(`input[name="${catName}"]`).forEach(r => r.addEventListener('change', () => { if (hint) hint.hidden = true; }));

  return {
    picked: () => pick,
    // Start from a known place, for example a wishlist idea.
    setPick: p => { pick = p; showPicked(); },
    warmUp: () => { strongFoodiePlaces(db); },
    reset: () => { pick = null; seq++; clearTimeout(timer); close(); showPicked(); if (hint) hint.hidden = true; },
  };
}
