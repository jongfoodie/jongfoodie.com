// Strong Foodie: "Surprise me". Picks a random place worth going to from the
// places the page already loaded: rated 4 or higher by Strong Foodie, open,
// optionally one category. On a destination page it picks from that city. On
// the homepage it picks from one country or city, chosen under "Where": at
// first the visitor's own country, guessed from the time zone of their device
// (no permission needed, nothing sent anywhere), or "Near me", which asks for
// the location only when chosen and keeps it in the page. The last few picks
// are skipped, so "Spin again" never shows the same place twice in a row. The
// chosen country or city is remembered in this browser only.
// The app does the same (Rork batch 17).

import { CATS, esc, miniCard, placeUrl, placeKey } from "./sf-places.js?v=7";

const SEEN_KEY = 'sf_surprise_seen';
const WHERE_KEY = 'sf_surprise_where';
const MIN_RATING = 4;
const NEAR_KM = [25, 75];

// Time zone of the device → country. Most of America is the United States.
const TZ_COUNTRY = {
  'Europe/Amsterdam': 'Netherlands', 'Europe/Brussels': 'Belgium', 'Europe/Istanbul': 'Turkey', 'Europe/London': 'United Kingdom',
  'Europe/Paris': 'France', 'Europe/Madrid': 'Spain', 'Europe/Rome': 'Italy', 'Europe/Berlin': 'Germany', 'Europe/Lisbon': 'Portugal',
  'Europe/Athens': 'Greece', 'Africa/Casablanca': 'Morocco', 'America/Aruba': 'Aruba', 'America/Curacao': 'Curaçao',
  'Asia/Dubai': 'United Arab Emirates', 'Asia/Bangkok': 'Thailand', 'Asia/Tokyo': 'Japan', 'Asia/Jakarta': 'Indonesia', 'Asia/Makassar': 'Indonesia',
  'Pacific/Honolulu': 'United States',
};
export function countryFromTimeZone(tz) {
  if (TZ_COUNTRY[tz]) return TZ_COUNTRY[tz];
  return /^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Indiana|Kentucky|North_Dakota)/.test(tz || '') ? 'United States' : '';
}
// No place in the visitor's own country: the nearest home base instead.
function regionFallback(tz) {
  if (/^(Europe|Africa)\//.test(tz || '')) return 'Netherlands';
  if (/^(America|Pacific)\//.test(tz || '')) return 'United States';
  return '';
}

export function surprisePool(places, cat = '') {
  return places.filter(p => !p.member && !p.closed && p.rating >= MIN_RATING && (!cat || p.cat === cat));
}

function seen() {
  try { return JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]'); } catch (e) { return []; }
}
function remember(key) {
  try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([key, ...seen().filter(k => k !== key)].slice(0, 8))); } catch (e) {}
}

// A random place from the pool, not one of the last picks when there is a choice.
export function pickSurprise(pool, random = Math.random) {
  if (!pool.length) return null;
  const recent = new Set(seen());
  const fresh = pool.filter(p => !recent.has(placeKey(p)));
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(random() * from.length)] || from[0];
}

const CSS = `
.sp-back { position: fixed; inset: 0; z-index: 10001; background: rgba(26,18,8,0.55); display: flex; align-items: flex-end; justify-content: center; padding: 16px; }
@media (min-width: 640px) { .sp-back { align-items: center; } }
.sp-sheet { background: #FFFDF9; border-radius: 20px; width: 100%; max-width: 420px; max-height: calc(100vh - 32px); overflow-y: auto; padding: 1.25rem; box-shadow: 0 20px 60px rgba(26,18,8,0.3); font-family: 'DM Sans', system-ui, sans-serif; color: #1A1208; position: relative; }
.sp-sheet h2 { font-family: 'Playfair Display', Georgia, serif; font-size: 1.5rem; margin: 0 2rem 0.25rem 0; }
.sp-sub { color: #8A7A66; font-size: 13.5px; line-height: 1.5; margin: 0 0 0.8rem; }
.sp-close { position: absolute; top: 0.8rem; right: 0.8rem; width: 36px; height: 36px; border-radius: 50%; border: 1px solid rgba(26,18,8,0.12); background: #fff; font-size: 16px; cursor: pointer; color: #1A1208; }
.sp-where-lab { display: block; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #8A7A66; margin-bottom: 0.3rem; }
.sp-where { width: 100%; border: 1px solid rgba(26,18,8,0.18); border-radius: 12px; padding: 10px 12px; font: 500 15px 'DM Sans', system-ui, sans-serif; background: #fff; color: #1A1208; margin-bottom: 0.8rem; }
.sp-chips[hidden] { display: none; }
.sp-chips { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.9rem; }
.sp-chip { border: 1px solid rgba(26,18,8,0.14); background: #fff; border-radius: 20px; padding: 6px 12px; font: 500 13px 'DM Sans', system-ui, sans-serif; cursor: pointer; color: #3D2F1A; }
.sp-chip[aria-pressed="true"] { background: #1A1208; border-color: #1A1208; color: #fff; }
.sp-card .mini-card { display: block; margin: 0; }
.sp-spin { min-height: 120px; display: flex; align-items: center; justify-content: center; text-align: center; font-family: 'Playfair Display', Georgia, serif; font-size: 1.4rem; color: #D4521A; padding: 1rem; border: 1px dashed rgba(26,18,8,0.15); border-radius: 14px; }
.sp-actions { display: flex; gap: 0.5rem; margin-top: 0.9rem; flex-wrap: wrap; }
.sp-go { flex: 1 1 auto; text-align: center; background: #D4521A; color: #fff; text-decoration: none; border-radius: 24px; padding: 11px 16px; font-weight: 600; font-size: 14.5px; }
.sp-again { flex: 0 0 auto; border: 1px solid rgba(26,18,8,0.15); background: #fff; color: #1A1208; border-radius: 24px; padding: 11px 16px; font: 600 14.5px 'DM Sans', system-ui, sans-serif; cursor: pointer; }
.sp-empty { color: #3D2F1A; font-size: 14px; line-height: 1.5; padding: 1rem 0; }
`;

function addStyle() {
  if (document.getElementById('sfSurpriseStyle')) return;
  const s = document.createElement('style');
  s.id = 'sfSurpriseStyle'; s.textContent = CSS;
  document.head.appendChild(s);
}

// The countries and cities that have places to pick, biggest first.
// Keys: "c:<country>" and "d:<city>". A place without a country takes its city's.
export function whereOptions(places) {
  const pool = surprisePool(places);
  const destCountry = new Map();
  pool.forEach(p => { if (p.destination && p.country && !destCountry.has(p.destination)) destCountry.set(p.destination, p.country); });
  const countries = new Map();
  pool.forEach(p => {
    const c = p.country || destCountry.get(p.destination) || '';
    if (!c) return;
    if (!countries.has(c)) countries.set(c, { count: 0, cities: new Map() });
    const e = countries.get(c);
    e.count++;
    if (p.destination && p.destination !== c) e.cities.set(p.destination, (e.cities.get(p.destination) || 0) + 1);
  });
  return [...countries.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).map(([name, e]) => ({
    key: 'c:' + name, name, count: e.count,
    cities: [...e.cities.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([city, count]) => ({ key: 'd:' + city, name: city, count })),
  }));
}

export function inWhere(p, key, destCountry = new Map()) {
  if (!key) return true;
  if (key.startsWith('d:')) return p.destination === key.slice(2);
  if (key.startsWith('c:')) return (p.country || destCountry.get(p.destination) || '') === key.slice(2);
  return false;
}

// First choice: what this browser chose before, else the visitor's country,
// else the nearest home base, else the country with the most places.
export function defaultWhere(options, tz, saved = '') {
  const keys = new Set(options.flatMap(o => [o.key, ...o.cities.map(c => c.key)]));
  if (saved && keys.has(saved)) return saved;
  for (const c of [countryFromTimeZone(tz), regionFallback(tz)]) if (c && keys.has('c:' + c)) return 'c:' + c;
  return options[0] ? options[0].key : '';
}

export function distanceKm(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Places within 25 km, or 75 km when fewer than 3 are that close.
export function nearPool(pool, here) {
  const withKm = pool.filter(p => typeof p.lat === 'number' && typeof p.lng === 'number').map(p => ({ p, km: distanceKm(here, p) }));
  for (const max of NEAR_KM) {
    const hits = withKm.filter(x => x.km <= max).map(x => x.p);
    if (hits.length >= 3 || max === NEAR_KM[NEAR_KM.length - 1]) return hits;
  }
  return [];
}

function savedWhere() { try { return localStorage.getItem(WHERE_KEY) || ''; } catch (e) { return ''; } }
function saveWhere(key) { try { localStorage.setItem(WHERE_KEY, key); } catch (e) {} }
function timeZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } }

// Opens the sheet. places: what the page loaded. where: "Amsterdam" on a city page
// (then only that city's places are passed in and there is no "Where" choice).
export function openSurprise({ places, where = '', hydratePhotos = () => {} }) {
  addStyle();
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const options = where ? [] : whereOptions(places);
  const destCountry = new Map();
  places.forEach(p => { if (p.destination && p.country && !destCountry.has(p.destination)) destCountry.set(p.destination, p.country); });
  let whereKey = where ? '' : defaultWhere(options, timeZone(), savedWhere());
  let near = null, cat = '', timer = null;
  const opener = document.activeElement;
  const back = document.createElement('div');
  back.className = 'sp-back';
  const opt = (key, label, count) => `<option value="${esc(key)}"${key === whereKey ? ' selected' : ''}>${esc(label)} (${count})</option>`;
  back.innerHTML = `
    <div class="sp-sheet" role="dialog" aria-modal="true" aria-labelledby="spTitle">
      <button class="sp-close" type="button" aria-label="Close">✕</button>
      <h2 id="spTitle">🎲 Surprise me</h2>
      <p class="sp-sub">A random place we rated 4 or higher${where ? ' in ' + esc(where) : ''}. Not feeling it? Spin again.</p>
      ${options.length ? `<label class="sp-where-lab" for="spWhere">Where</label>
      <select class="sp-where" id="spWhere">
        <option value="near">📍 Near me</option>
        ${options.map(o => `<optgroup label="${esc(o.name)}">${opt(o.key, 'All of ' + o.name, o.count)}${o.cities.map(c => opt(c.key, c.name, c.count)).join('')}</optgroup>`).join('')}
      </select>` : ''}
      <div class="sp-chips" id="spChips" role="group" aria-label="Category"></div>
      <div class="sp-card" id="spCard" aria-live="polite"></div>
      <div class="sp-actions" id="spActions"></div>
    </div>`;
  document.body.appendChild(back);
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  const $ = s => back.querySelector(s);

  function close() {
    clearInterval(timer);
    back.remove();
    document.documentElement.style.overflow = prevOverflow;
    document.removeEventListener('keydown', onKey);
    if (opener && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  }
  // Escape closes; Tab stays inside the sheet.
  function onKey(e) {
    if (e.key === 'Escape') return close();
    if (e.key !== 'Tab') return;
    const items = [...back.querySelectorAll('button, a[href], select')].filter(x => !x.disabled && x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !back.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', e => { if (e.target === back) close(); });
  $('.sp-close').addEventListener('click', close);

  // The places for the chosen country, city or "near me", before the category.
  function wherePool() {
    if (whereKey === 'near') return near || [];
    return places.filter(p => inWhere(p, whereKey, destCountry));
  }

  function drawChips() {
    const base = wherePool();
    const cats = Object.keys(CATS).filter(k => surprisePool(base, k).length);
    if (cat && !cats.includes(cat)) cat = '';
    const box = $('#spChips');
    box.hidden = cats.length < 2;
    box.innerHTML = cats.length < 2 ? '' : `<button class="sp-chip" type="button" data-cat="" aria-pressed="${!cat}">All</button>`
      + cats.map(k => `<button class="sp-chip" type="button" data-cat="${k}" aria-pressed="${cat === k}">${CATS[k].emoji} ${CATS[k].label}</button>`).join('');
    box.querySelectorAll('.sp-chip').forEach(b => b.addEventListener('click', () => {
      cat = b.dataset.cat;
      box.querySelectorAll('.sp-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      spin();
    }));
  }

  function message(text) {
    const card = $('#spCard');
    card.removeAttribute('aria-busy');
    card.innerHTML = `<p class="sp-empty">${text}</p>`;
    $('#spActions').innerHTML = '';
  }

  function show(p) {
    const card = $('#spCard'), actions = $('#spActions');
    if (!p) return message(whereKey === 'near' ? 'No places of ours near you yet. Pick a country or city above.' : 'No place to pick yet. Try another category.');
    card.removeAttribute('aria-busy');
    remember(placeKey(p));
    card.innerHTML = miniCard(p);
    hydratePhotos(card);
    actions.innerHTML = `<a class="sp-go" href="${esc(placeUrl(p))}">Take me there →</a><button class="sp-again" type="button">🎲 Spin again</button>`;
    actions.querySelector('.sp-again').addEventListener('click', spin);
    actions.querySelector('.sp-go').focus({ preventScroll: true });
  }

  function spin() {
    clearInterval(timer);
    const pool = surprisePool(wherePool(), cat);
    const p = pickSurprise(pool);
    if (!p || reduce || pool.length < 3) return show(p);
    // A short spin through names before landing on the pick.
    const card = $('#spCard');
    let n = 0;
    card.setAttribute('aria-busy', 'true');
    card.innerHTML = '<div class="sp-spin" aria-hidden="true"></div>';
    const box = card.firstChild;
    timer = setInterval(() => {
      box.textContent = pool[Math.floor(Math.random() * pool.length)].name;
      if (++n >= 8) { clearInterval(timer); show(p); }
    }, 70);
  }

  // "Near me": the location is asked for only now, and only kept in this page.
  function findNear() {
    if (near) { drawChips(); return spin(); }
    if (!navigator.geolocation) return message('This browser can\'t share your location. Pick a country or city above.');
    message('Finding places near you…');
    $('#spChips').hidden = true;
    navigator.geolocation.getCurrentPosition(pos => {
      if (whereKey !== 'near') return;
      near = nearPool(surprisePool(places), { lat: pos.coords.latitude, lng: pos.coords.longitude });
      drawChips(); spin();
    }, () => {
      if (whereKey !== 'near') return;
      message('Your location is off. Pick a country or city above.');
    }, { timeout: 10000, maximumAge: 600000 });
  }

  const sel = $('#spWhere');
  if (sel) sel.addEventListener('change', () => {
    whereKey = sel.value;
    if (whereKey === 'near') return findNear();
    saveWhere(whereKey);
    drawChips(); spin();
  });
  drawChips();
  spin();
  return close;
}
