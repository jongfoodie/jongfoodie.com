// Strong Foodie: places that members added in the app, shown on the website.
//
// One file for all six category pages and the community page. A page opts in with:
//   <section data-member-places="drink" data-search="#searchInput"></section>
//   <script type="module" src="js/member-places.js"></script>
// Use data-member-places="all" (optionally data-limit="6") for every category.
//
// It reads the same userPlaces collection as the app, so a place a member adds
// in the app appears here straight away. Places of members with a private
// account are left out.

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, query, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB_9UbXbYdY-TkYPLURESIkKAFLfYfwD3U",
  authDomain: "jongfoodie.firebaseapp.com",
  projectId: "jongfoodie",
  storageBucket: "jongfoodie.firebasestorage.app",
  messagingSenderId: "1006154240382",
  appId: "1:1006154240382:web:45dc5562f8205364aa232f"
};
// Reuse the page's Firebase app when it already exists; otherwise start a
// separately named one, so the page's own initializeApp() never collides.
const app = getApps().some(a => a.name === '[DEFAULT]')
  ? getApp()
  : (getApps().find(a => a.name === 'sf-members') || initializeApp(firebaseConfig, 'sf-members'));
const db = getFirestore(app);

const CATS = {
  eat:     { label: 'Eat',     emoji: '🍽️', color: '#D4521A', aliases: ['eat', 'food', 'restaurant', 'restaurants'] },
  drink:   { label: 'Drink',   emoji: '🍸', color: '#6B2A5C', aliases: ['drink', 'drinks', 'bar', 'bars', 'cafe'] },
  shop:    { label: 'Shop',    emoji: '🛍️', color: '#A32323', aliases: ['shop', 'shops', 'store'] },
  culture: { label: 'Culture', emoji: '🎭', color: '#8A6A0A', aliases: ['culture', 'cultuur', 'museum'] },
  health:  { label: 'Health',  emoji: '💪', color: '#1A5C2E', aliases: ['health', 'gym', 'sport', 'spa'] },
  stay:    { label: 'Stay',    emoji: '🏨', color: '#2F5D7C', aliases: ['stay', 'stays', 'hotel', 'hotels'] },
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => (typeof v === 'number' && isFinite(v) && v !== 0) ? v : null;
const toDate = ts => !ts ? null : (ts.toDate ? ts.toDate() : (isNaN(new Date(ts)) ? null : new Date(ts)));

// Photos added in the app are "fsimg://<id>": a base64 image in `images`.
const photoCache = new Map();
function resolvePhoto(url) {
  if (!url) return Promise.resolve('');
  if (!url.startsWith('fsimg://')) return Promise.resolve(url);
  const id = url.slice('fsimg://'.length);
  if (!photoCache.has(id)) {
    photoCache.set(id, getDoc(doc(db, 'images', id))
      .then(s => { const d = s.exists() ? s.data() : null; return d && d.data ? `data:${d.contentType || 'image/jpeg'};base64,${d.data}` : ''; })
      .catch(() => ''));
  }
  return photoCache.get(id);
}

function injectStyles() {
  if (document.getElementById('mp-styles')) return;
  const css = `
  .mp-section { margin-top: 3rem; box-sizing: border-box; }
  .mp-label { font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: #8A7A66; padding-bottom: 0.75rem; border-bottom: 1px solid rgba(26,18,8,0.1); margin-bottom: 1.5rem; display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  .mp-label a { color: #D4521A; text-decoration: none; letter-spacing: 0.05em; font-weight: 600; }
  .mp-intro { font-size: 13px; color: #8A7A66; margin: -0.75rem 0 1.25rem; line-height: 1.5; }
  .mp-card { display: flex; background: #FFFDF9; border-radius: 16px; overflow: hidden; margin-bottom: 1.25rem; border: 1px solid rgba(26,18,8,0.1); }
  .mp-img { width: 180px; min-width: 180px; min-height: 150px; position: relative; display: flex; align-items: center; justify-content: center; font-size: 48px; color: #fff; }
  .mp-img img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .mp-body { padding: 1.25rem 1.5rem; flex: 1; display: flex; flex-direction: column; gap: 0.4rem; min-width: 0; }
  .mp-name a { color: inherit; text-decoration: none; }
  .mp-name a:hover { color: #D4521A; }
  a.mp-img { text-decoration: none; }
  .mp-name { font-family: 'Playfair Display', serif; font-size: 1.2rem; font-weight: 700; color: #1A1208; overflow-wrap: anywhere; }
  .mp-badge { display: inline-block; margin-left: 6px; font-family: 'DM Sans', sans-serif; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 4px; background: #FBF3EF; color: #D4521A; border: 1px solid rgba(212,82,26,0.3); vertical-align: 3px; }
  .mp-meta { font-size: 12px; color: #8A7A66; overflow-wrap: anywhere; }
  .mp-text { font-size: 14px; color: #3D2F1A; line-height: 1.55; overflow-wrap: anywhere; }
  .mp-foot { display: flex; gap: 1rem; flex-wrap: wrap; align-items: center; margin-top: 0.25rem; font-size: 12px; color: #8A7A66; }
  .mp-foot a { color: #D4521A; font-weight: 600; text-decoration: none; }
  .mp-empty { text-align: center; padding: 2.25rem 1.5rem; background: #FFFDF9; border-radius: 16px; border: 1px dashed rgba(26,18,8,0.15); color: #8A7A66; font-size: 14px; line-height: 1.6; }
  @media (max-width: 700px) {
    .mp-card { flex-direction: column; }
    .mp-img { width: 100%; min-width: unset; height: 170px; }
  }`;
  const style = document.createElement('style');
  style.id = 'mp-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

function catOf(raw) {
  const c = String(raw || '').toLowerCase().trim();
  return Object.keys(CATS).find(k => CATS[k].aliases.includes(c)) || 'eat';
}

// catKey 'all' returns the newest member places across every category.
async function loadPlaces(catKey) {
  const q = catKey === 'all'
    ? collection(db, 'userPlaces')
    : query(collection(db, 'userPlaces'), where('category', 'in', CATS[catKey].aliases));
  const snap = await getDocs(q);
  const raw = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.name && r.hidden !== true);

  const owners = [...new Set(raw.map(r => r.addedByUserId).filter(Boolean))];
  const privateOwners = new Set();
  await Promise.all(owners.map(uid => getDoc(doc(db, 'profiles', uid))
    .then(s => { if (s.exists() && s.data().isPrivate === true) privateOwners.add(uid); })
    .catch(() => {})));

  return raw
    .filter(r => !privateOwners.has(r.addedByUserId))
    .map(r => ({
      id: r.id,
      cat: catOf(r.category),
      name: r.name,
      address: [r.address, r.city].filter(Boolean).join(', '),
      city: r.city || '',
      tip: r.type || '',
      review: r.review || '',
      hours: r.hours || '',
      rating: typeof r.rating === 'number' ? r.rating : null,
      photo: r.photoUrl || (Array.isArray(r.photos) ? r.photos[0] : '') || '',
      addedBy: r.addedByName || 'a member',
      lat: num(r.lat), lng: num(r.lng),
      created: toDate(r.createdAt),
    }))
    .sort((a, b) => (b.created || 0) - (a.created || 0));
}

function cardHtml(p) {
  const cat = CATS[p.cat];
  const placeUrl = `plek.html?c=userPlaces&id=${encodeURIComponent(p.id)}`;
  const route = (p.lat != null && p.lng != null)
    ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`
    : (p.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + ', ' + p.address)}` : '');
  const stars = p.rating ? '★'.repeat(Math.round(p.rating)) + '☆'.repeat(5 - Math.round(p.rating)) : '';
  return `
  <article class="mp-card">
    <a class="mp-img" href="${placeUrl}" aria-label="${esc(p.name)}" style="background:linear-gradient(135deg, ${cat.color} 0%, #1A1208 100%);">
      <span>${cat.emoji}</span>
      ${p.photo ? `<img data-photo="${esc(p.photo)}" alt="" hidden>` : ''}
    </a>
    <div class="mp-body">
      <p class="mp-name"><a href="${placeUrl}">${esc(p.name)}</a><span class="mp-badge">Member</span></p>
      ${p.address ? `<p class="mp-meta">📍 ${esc(p.address)}</p>` : ''}
      ${stars ? `<p class="mp-meta" style="color:#C8901A;font-size:14px;">${stars}</p>` : ''}
      ${p.tip ? `<p class="mp-text">${esc(p.tip)}</p>` : ''}
      ${p.review ? `<p class="mp-text">${esc(p.review)}</p>` : ''}
      ${p.hours ? `<p class="mp-meta" style="color:#2D5A3D;">🕐 ${esc(p.hours)}</p>` : ''}
      <div class="mp-foot">
        <span>Added by ${esc(p.addedBy)} in the app</span>
        <a href="${placeUrl}">View place →</a>
        ${route ? `<a href="${route}" target="_blank" rel="noopener">Route ↗</a>` : ''}
      </div>
    </div>
  </article>`;
}

function hydratePhotos(root) {
  root.querySelectorAll('img[data-photo]').forEach(img => {
    const src = img.getAttribute('data-photo');
    img.removeAttribute('data-photo');
    img.onerror = () => { img.hidden = true; };
    resolvePhoto(src).then(url => { if (url) { img.src = url; img.hidden = false; } });
  });
}

async function mount(section) {
  const catKey = section.getAttribute('data-member-places');
  const all = catKey === 'all';
  if (!all && !CATS[catKey]) return;
  const label = all ? 'All categories' : CATS[catKey].label;
  const limit = parseInt(section.getAttribute('data-limit') || '0', 10) || 0;
  const mapLink = all ? 'map.html?source=member' : `map.html?source=member&cat=${catKey}`;
  injectStyles();
  section.classList.add('mp-section');
  section.innerHTML = `
    <p class="mp-label"><span>From our members · ${label}</span><a href="${mapLink}">View on the map →</a></p>
    <p class="mp-intro">Places members added in the Strong Foodie app. Not reviewed by Strong Foodie.</p>
    <div class="mp-list"><div class="mp-empty">Loading member spots…</div></div>`;
  const list = section.querySelector('.mp-list');

  let places = [];
  try {
    places = await loadPlaces(catKey);
  } catch (e) {
    console.error('Member places could not load:', e);
    list.innerHTML = `<div class="mp-empty">Member spots could not load right now.</div>`;
    return;
  }

  const render = (term) => {
    const t = (term || '').toLowerCase().trim();
    let shown = t ? places.filter(p => `${p.name} ${p.address} ${p.tip} ${p.review}`.toLowerCase().includes(t)) : places;
    if (limit && !t) shown = shown.slice(0, limit);
    section.querySelector('.mp-label span').textContent = `From our members · ${label}` + (places.length ? ` · ${places.length}` : '');
    if (!places.length) {
      list.innerHTML = `<div class="mp-empty">No member spots${all ? '' : ' in ' + label} yet.<br>Members add places in the Strong Foodie app, and they show up here straight away.</div>`;
    } else if (!shown.length) {
      list.innerHTML = `<div class="mp-empty">No member spots match your search.</div>`;
    } else {
      list.innerHTML = shown.map(cardHtml).join('');
      hydratePhotos(list);
    }
  };
  render('');

  const searchSel = section.getAttribute('data-search');
  const input = searchSel ? document.querySelector(searchSel) : null;
  if (input) input.addEventListener('input', () => render(input.value));
}

document.querySelectorAll('[data-member-places]').forEach(mount);
