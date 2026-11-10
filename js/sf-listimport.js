// Import a whole Google Maps list into your wishlist (Merdan, 9 Nov 2026: "zoals Step").
//
// The member pastes the link of a shared Google Maps list. The Cloud Function importMapsList
// reads the places (name, pin, address, note). Google has no official way to read a list, so
// this can stop working when Google changes its pages: Strong Foodie switches the import on
// and off in the admin (site/flags.mapsListImport). Everything already imported stays.
//
// Here, on the page: places that are already on Strong Foodie are found (same name, within
// 200 m) and saved as a link to that place; the others get a category and town from
// OpenStreetMap (Photon), like a pasted Google Maps link. The member ticks what they want.
// Used on account.html (English) and admin-wishlist.html (Dutch).

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";
import { collection, getDocs, addDoc, doc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { foldText, catInfo, CAT_LIST } from './sf-find.js?v=5';
import { loadPlaces } from './sf-places.js?v=7';
import { sameName } from './sf-autofill.js?v=3';
import { markBeen, addBeenPlace } from './sf-been.js?v=2';

const TEXT = {
  en: {
    title: 'Import a Google Maps list',
    how: 'In Google Maps, open your list, tap Share › Copy link, and paste the link here. The list has to be shared.',
    placeholder: 'Link to your Google Maps list',
    find: 'Find places', finding: 'Reading your list…',
    lookup: (i, n) => `Looking up places… ${i} of ${n}`,
    found: (t, n) => `${t ? `<strong>${t}</strong>: ` : ''}${n} ${n === 1 ? 'place' : 'places'}. Untick what you don't want.`,
    all: 'Select all', none: 'Select none',
    onSf: 'On Strong Foodie', already: 'Already on your wishlist', noOsm: 'Check the category',
    add: k => `Add ${k} ${k === 1 ? 'place' : 'places'} to my wishlist`, adding: (i, n) => `Adding… ${i} of ${n}`,
    done: k => `✓ ${k} ${k === 1 ? 'place' : 'places'} added to your wishlist.`,
    off: 'Importing lists is off right now. You can still add places one by one.',
    notList: "This isn't a link to a Google Maps list. In Google Maps, open the list itself, tap Share › Copy link and paste that.",
    nothing: 'No places found. Is the list shared? In Google Maps: open the list › ••• › Share.',
    limit: "That's 10 lists today. Try again tomorrow.",
    failed: "That didn't work. Check the link and your connection, and try again.",
    nothingNew: 'Every place in this list is already on your wishlist.',
    beenAlready: 'Already on Been there', beenAdd: k => `Add ${k} ${k === 1 ? 'place' : 'places'} to Been there`,
    beenDone: k => `✓ ${k} ${k === 1 ? 'place' : 'places'} added to Been there.`, beenNothingNew: 'Every place in this list is already on Been there.',
    beenTitle: 'Import a Google Maps list of places you have been',
  },
  nl: {
    title: 'Google Maps-lijst importeren',
    how: 'Open je lijst in Google Maps, tik op Delen › Link kopiëren en plak de link hier. De lijst moet gedeeld zijn.',
    placeholder: 'Link naar je Google Maps-lijst',
    find: 'Plekken zoeken', finding: 'Lijst lezen…',
    lookup: (i, n) => `Plekken opzoeken… ${i} van ${n}`,
    found: (t, n) => `${t ? `<strong>${t}</strong>: ` : ''}${n} ${n === 1 ? 'plek' : 'plekken'}. Vink uit wat je niet wilt.`,
    all: 'Alles aan', none: 'Alles uit',
    onSf: 'Op Strong Foodie', already: 'Staat al op je lijst', noOsm: 'Kijk de categorie na',
    add: k => `Zet ${k} ${k === 1 ? 'plek' : 'plekken'} op de lijst`, adding: (i, n) => `Bezig… ${i} van ${n}`,
    done: k => `✓ ${k} ${k === 1 ? 'plek' : 'plekken'} op je lijst gezet.`,
    off: 'Importeren staat uit. Als admin kun je het toch testen.',
    notList: 'Dit is geen link naar een Google Maps-lijst. Open in Google Maps de lijst zelf, tik op Delen › Link kopiëren en plak die.',
    nothing: 'Geen plekken gevonden. Is de lijst gedeeld?',
    limit: 'Vandaag al 10 lijsten. Probeer het morgen weer.',
    failed: 'Dat lukte niet. Kijk de link en je verbinding na en probeer het opnieuw.',
    nothingNew: 'Alle plekken uit deze lijst staan al op je lijst.',
    beenAlready: 'Al bij Been there', beenAdd: k => `Zet ${k} ${k === 1 ? 'plek' : 'plekken'} bij Been there`,
    beenDone: k => `✓ ${k} ${k === 1 ? 'plek' : 'plekken'} bij Been there gezet.`, beenNothingNew: 'Alle plekken uit deze lijst staan al bij Been there.',
    beenTitle: 'Google Maps-lijst importeren bij Been there',
  },
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const R = 6371000, rad = d => d * Math.PI / 180;
const dist = (a, b) => { const x = rad(b.lat - a.lat), y = rad(b.lng - a.lng); const h = Math.sin(x / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const POI = new Set(['amenity', 'shop', 'tourism', 'leisure', 'historic', 'craft', 'club', 'healthcare']);
const OSM_CAT = {
  amenity: { eat: ['restaurant', 'fast_food', 'cafe', 'ice_cream', 'food_court', 'bakery'], drink: ['bar', 'pub', 'biergarten', 'nightclub'], culture: ['theatre', 'cinema', 'arts_centre', 'library'], health: ['spa', 'sauna'] },
  shop: { eat: ['bakery', 'pastry', 'confectionery', 'deli'], drink: ['wine', 'alcohol', 'coffee', 'tea'] },
  tourism: { stay: ['hotel', 'hostel', 'guest_house', 'motel', 'apartment'], culture: ['museum', 'gallery', 'attraction', 'artwork', 'zoo', 'theme_park', 'viewpoint'] },
  leisure: { health: ['fitness_centre', 'sports_centre', 'swimming_pool', 'spa', 'sauna', 'yoga'], culture: ['park', 'garden'] },
  historic: { culture: ['monument', 'castle', 'memorial', 'ruins'] },
};
const catOf = (k, v) => { const g = OSM_CAT[k]; if (g) for (const c of Object.keys(g)) if (g[c].includes(v)) return c; return k === 'shop' ? 'shop' : k === 'historic' ? 'culture' : null; };

// Category, type and town from OpenStreetMap for a place with a pin. Null when not found.
async function osmFor(p) {
  try {
    const res = await fetch('https://photon.komoot.io/api/?' + new URLSearchParams({ q: p.name, lat: String(p.lat), lon: String(p.lng), limit: '8', lang: 'en' }));
    if (!res.ok) return null;
    for (const f of ((await res.json()) || {}).features || []) {
      const q = f.properties || {}, c = (f.geometry || {}).coordinates || [];
      if (!q.name || !POI.has(q.osm_key) || typeof c[1] !== 'number') continue;
      if (dist(p, { lat: c[1], lng: c[0] }) > 250 || !sameName(q.name, p.name)) continue;
      const v = q.osm_value && q.osm_value !== 'yes' ? (q.osm_value.charAt(0).toUpperCase() + q.osm_value.slice(1)).replace(/_/g, ' ') : '';
      return { cat: catOf(q.osm_key, q.osm_value), type: v, town: q.city || q.town || q.village || q.locality || q.district || '', country: q.country || '' };
    }
  } catch (e) { /* no network or Photon is busy: the member picks the category */ }
  return null;
}
// The town from the address Google gives, like "Spuistraat 214, 1012 VT Amsterdam, Netherlands".
function townFromAddress(a) {
  const parts = String(a || '').split(',').map(x => x.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const t = parts[i].replace(/^\d{4}\s?[A-Z]{2}\s+/, '').replace(/^[A-Z]{2}\s+\d{4,6}$/, '').replace(/\s+[A-Z]{2}\s+\d{5}$/, '').replace(/^\d{4,6}\s+/, '').trim();
    if (!t || /\d/.test(t) || i === parts.length - 1 && parts.length > 2) continue;
    return t;
  }
  return '';
}

export async function listImportOn(db) {
  try { const s = await getDoc(doc(db, 'site', 'flags')); return s.exists() && s.data().mapsListImport === true; } catch (e) { return false; }
}

// el: an empty element. opts: { app, db, uid, lang: 'en' | 'nl', target: 'wishlist' | 'been', onDone(count) }
export function mountListImport(el, opts) {
  const T0 = TEXT[opts.lang] || TEXT.en, { db, uid } = opts;
  const been = opts.target === 'been';
  // Been there: the same steps, other words and another list.
  const T = been ? { ...T0, title: T0.beenTitle, already: T0.beenAlready, add: T0.beenAdd, done: T0.beenDone, nothingNew: T0.beenNothingNew } : T0;
  const call = httpsCallable(getFunctions(opts.app, 'us-central1'), 'importMapsList');
  el.innerHTML = `
    <div class="li-box">
      <p class="li-title">🗺️ ${esc(T.title)}</p>
      <p class="li-how">${esc(T.how)}</p>
      <div class="li-row"><input class="li-input" type="url" maxlength="2000" placeholder="${esc(T.placeholder)}" autocomplete="off"><button class="li-btn li-main" type="button" data-find>${esc(T.find)}</button></div>
      <p class="li-msg" hidden></p>
      <div class="li-result" hidden></div>
    </div>`;
  if (!document.getElementById('liStyle')) {
    const st = document.createElement('style'); st.id = 'liStyle'; st.textContent = CSS; document.head.appendChild(st);
  }
  const $ = s => el.querySelector(s);
  const msg = (html, error = false) => { const m = $('.li-msg'); m.innerHTML = html; m.hidden = !html; m.classList.toggle('li-err', error); };
  let rows = [];

  $('[data-find]').addEventListener('click', find);
  $('.li-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); find(); } });

  async function find() {
    const url = $('.li-input').value.trim();
    if (!url) return;
    const btn = $('[data-find]'); btn.disabled = true;
    $('.li-result').hidden = true; msg(esc(T.finding));
    let res;
    try { res = (await call({ url })).data || {}; }
    catch (e) {
      btn.disabled = false;
      const code = String(e && e.code || '').replace('functions/', '');
      return msg(esc(code === 'failed-precondition' ? T.off : code === 'invalid-argument' ? T.notList : code === 'not-found' ? T.nothing : code === 'resource-exhausted' ? T.limit : T.failed), true);
    }
    const places = Array.isArray(res.places) ? res.places : [];
    if (!places.length) {
      btn.disabled = false;
      // Admins get what Google sent back, so a change at Google can be fixed.
      return msg(esc(T.nothing) + (res.debug ? `<pre class="li-debug">${esc(JSON.stringify(res.debug, null, 1).slice(0, 2500))}</pre>` : ''), true);
    }
    const ownList = been
      ? Promise.all([getDocs(collection(db, 'profiles', uid, 'beenThere')), getDocs(collection(db, 'profiles', uid, 'beenPlaces'))])
          .then(([a, b]) => a.docs.map(d => d.data()).concat(b.docs.map(d => d.data())))
      : getDocs(collection(db, 'profiles', uid, 'wishlistItems')).then(s => s.docs.map(d => d.data()));
    const [own, sf] = await Promise.all([
      ownList.catch(() => []),
      loadPlaces(db).then(r => r.all.filter(p => !p.member && typeof p.lat === 'number')).catch(() => []),
    ]);
    rows = places.map(p => {
      const hit = sf.find(s => dist(p, s) <= 200 && sameName(s.name, p.name));
      const have = own.some(w => (hit && w.placeDocId === hit.id) || (w.kind === 'idea' && foldText(w.name) === foldText(p.name)));
      return { ...p, sf: hit || null, have, on: !have, cat: hit ? hit.cat : null, type: '', town: hit ? (hit.town || '') : townFromAddress(p.address), country: hit ? (hit.country || '') : '' };
    });
    // Category and town from OpenStreetMap, three at a time.
    const todo = rows.filter(r => !r.sf && !r.have);
    let done = 0;
    msg(esc(T.lookup(0, todo.length)));
    const work = todo.slice();
    await Promise.all([0, 1, 2].map(async () => {
      for (let r = work.shift(); r; r = work.shift()) {
        const o = await osmFor(r);
        if (o) { r.cat = o.cat || r.cat; r.type = o.type; r.town = o.town || r.town; r.country = o.country || r.country; }
        r.noOsm = !o || !o.cat;
        msg(esc(T.lookup(++done, todo.length)));
      }
    }));
    btn.disabled = false;
    msg('');
    draw(res.title || '');
  }

  function draw(title) {
    const box = $('.li-result');
    box.hidden = false;
    const fresh = rows.filter(r => !r.have);
    if (!fresh.length) { box.innerHTML = `<p class="li-head">${esc(T.nothingNew)}</p>`; return; }
    box.innerHTML = `
      <p class="li-head">${T.found(esc(title), rows.length)}</p>
      <div class="li-tools"><button type="button" class="li-link" data-all>${esc(T.all)}</button> · <button type="button" class="li-link" data-none>${esc(T.none)}</button></div>
      <ul class="li-list">${rows.map((r, i) => `
        <li class="li-item${r.have ? ' li-have' : ''}">
          <input type="checkbox" data-i="${i}"${r.on ? ' checked' : ''}${r.have ? ' disabled' : ''} aria-label="${esc(r.name)}">
          ${r.sf ? `<span class="li-emoji">${catInfo(r.sf.cat).emoji}</span>` : `<select data-c="${i}" aria-label="Category">${CAT_LIST.map(c => `<option value="${c.key}"${(r.cat || 'eat') === c.key ? ' selected' : ''}>${c.emoji}</option>`).join('')}</select>`}
          <span class="li-text"><span class="li-name">${esc(r.name)}</span>${r.sf ? `<span class="li-pill li-ok">${esc(T.onSf)}</span>` : ''}${r.have ? `<span class="li-pill">${esc(T.already)}</span>` : ''}${!r.sf && !r.have && r.noOsm ? `<span class="li-pill li-warn">${esc(T.noOsm)}</span>` : ''}
            <span class="li-meta">${esc([r.type, r.address || r.town].filter(Boolean).join(' · '))}</span></span>
        </li>`).join('')}</ul>
      <p class="li-err-line" hidden></p>
      <button type="button" class="li-btn li-main" data-add></button>`;
    const count = () => rows.filter(r => r.on && !r.have).length;
    const label = () => { const b = box.querySelector('[data-add]'); const k = count(); b.textContent = T.add(k); b.disabled = !k; };
    box.querySelectorAll('[data-i]').forEach(c => c.addEventListener('change', () => { rows[+c.dataset.i].on = c.checked; label(); }));
    box.querySelectorAll('[data-c]').forEach(s => s.addEventListener('change', () => { rows[+s.dataset.c].cat = s.value; }));
    box.querySelector('[data-all]').addEventListener('click', () => { rows.forEach(r => { if (!r.have) r.on = true; }); box.querySelectorAll('[data-i]:not(:disabled)').forEach(c => { c.checked = true; }); label(); });
    box.querySelector('[data-none]').addEventListener('click', () => { rows.forEach(r => { r.on = false; }); box.querySelectorAll('[data-i]').forEach(c => { c.checked = false; }); label(); });
    box.querySelector('[data-add]').addEventListener('click', save);
    label();
  }

  async function save() {
    const box = $('.li-result'), b = box.querySelector('[data-add]');
    const chosen = rows.filter(r => r.on && !r.have);
    if (!chosen.length) return;
    b.disabled = true;
    const items = collection(db, 'profiles', uid, 'wishlistItems');
    let k = 0, failed = 0;
    const queue = chosen.slice();
    await Promise.all([0, 1, 2, 3].map(async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        if (been) {
          try {
            if (r.sf) await markBeen(db, uid, { coll: r.sf.coll, id: r.sf.id, name: r.sf.name, cat: r.sf.cat, city: r.sf.where || r.sf.town || '' });
            else await addBeenPlace(db, uid, { name: r.name, category: r.cat || 'eat', city: r.town || '', address: r.address || r.town || '', country: r.country, placeType: r.type, lat: r.lat, lng: r.lng, note: r.note || '', source: 'google-list' });
            r.have = true; k++;
          } catch (e) { console.log('Not saved:', r.name, e); failed++; }
          b.textContent = T.adding(k + failed, chosen.length);
          continue;
        }
        const data = r.sf
          ? { kind: 'place', placeCollection: r.sf.coll, placeDocId: r.sf.id, placeName: r.sf.name, placeCategory: r.sf.cat, city: r.sf.where || r.sf.town || '', note: r.note || '', source: 'google-list', createdAt: serverTimestamp() }
          : { kind: 'idea', name: r.name, category: r.cat || 'eat', city: r.town || '', address: r.address || r.town || '', note: r.note || '', lat: r.lat, lng: r.lng, source: 'google-list', createdAt: serverTimestamp() };
        if (!r.sf && r.country) data.country = r.country;
        if (!r.sf && r.type) data.placeType = r.type;
        try { await addDoc(items, data); r.have = true; k++; } catch (e) { console.log('Not saved:', r.name, e); failed++; }
        b.textContent = T.adding(k + failed, chosen.length);
      }
    }));
    box.innerHTML = `<p class="li-head">${esc(T.done(k))}${failed ? ` <span class="li-err">(${failed} ✗)</span>` : ''}</p>`;
    $('.li-input').value = '';
    if (opts.onDone) opts.onDone(k);
  }
}

const CSS = `
.li-box { border: 1px dashed rgba(26,18,8,0.25); border-radius: 14px; padding: 0.9rem 1rem; display: flex; flex-direction: column; gap: 0.55rem; background: #FFFDF9; }
.li-title { font-weight: 700; font-size: 15px; }
.li-how { font-size: 13px; color: #8A7A66; line-height: 1.5; }
.li-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.li-input { flex: 1 1 220px; min-width: 0; border: 1px solid rgba(26,18,8,0.15); border-radius: 10px; padding: 9px 12px; font: 14px 'DM Sans', sans-serif; background: #fff; color: #1A1208; outline: none; }
.li-input:focus { border-color: #D4521A; }
.li-btn { font: 600 13px 'DM Sans', sans-serif; padding: 9px 16px; border-radius: 20px; border: 1px solid rgba(26,18,8,0.15); background: #fff; color: #1A1208; cursor: pointer; min-height: 38px; }
.li-btn:disabled { opacity: 0.5; cursor: default; }
.li-main { background: #D4521A; color: #fff; border-color: #D4521A; }
.li-msg { font-size: 13.5px; color: #3D2F1A; line-height: 1.5; }
.li-err, .li-msg.li-err { color: #A32323; }
.li-debug { white-space: pre-wrap; font-size: 11px; background: #F3EEE6; border-radius: 8px; padding: 8px; margin-top: 6px; max-height: 220px; overflow: auto; color: #3D2F1A; }
.li-result { display: flex; flex-direction: column; gap: 0.55rem; }
.li-head { font-size: 14px; line-height: 1.5; }
.li-tools { font-size: 13px; color: #8A7A66; }
.li-link { background: none; border: none; padding: 0; font: inherit; color: #D4521A; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.li-list { list-style: none; max-height: 420px; overflow-y: auto; border: 1px solid rgba(26,18,8,0.1); border-radius: 12px; background: #fff; }
.li-item { display: flex; align-items: flex-start; gap: 0.55rem; padding: 9px 10px; border-top: 1px solid rgba(26,18,8,0.08); }
.li-item:first-child { border-top: none; }
.li-item input { width: 18px; height: 18px; accent-color: #D4521A; margin-top: 2px; flex-shrink: 0; }
.li-item select { border: 1px solid rgba(26,18,8,0.15); border-radius: 8px; background: #fff; font-size: 15px; padding: 1px 2px; flex-shrink: 0; }
.li-emoji { font-size: 17px; width: 34px; text-align: center; flex-shrink: 0; }
.li-have { opacity: 0.55; }
.li-text { min-width: 0; }
.li-name { font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
.li-meta { display: block; font-size: 12px; color: #8A7A66; overflow-wrap: anywhere; }
.li-pill { display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; border-radius: 8px; padding: 1px 6px; margin-left: 6px; background: #F1ECE4; color: #3D2F1A; }
.li-ok { background: #E8F2EC; color: #2D5A3D; }
.li-warn { background: #FBF3EF; color: #D4521A; }
`;
