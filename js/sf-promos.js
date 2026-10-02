// Strong Foodie: paid placements (ads) and the homepage settings. The app reads
// the same documents (Rork batch 15).
//
// promos/{id}: a place Strong Foodie features for a business, always shown with
//   an "Ad" label (Dutch Reclame Code). Set in admin-ads.html.
//   { placeKey: "reviews/<id>", placeName, where: ["home", "city", "place"],
//     start, end, createdAt, updatedAt }
//   Live from `start` until `end`. The agreement and the invoice stay outside
//   the database: everyone can read this collection.
// site/home: set in admin-home.html.
//   { featuredKey, topPicks: [placeKey], highlightId, highlightUntil,
//     announcement: { text, link, until }, updatedAt }
// site/stats: public reach numbers for the press page, written by admin-stats.html.

import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const toDate = v => (v && typeof v.toDate === 'function') ? v.toDate() : (v instanceof Date ? v : (v ? new Date(v) : null));

export function isLive(p, now = new Date()) {
  const s = toDate(p.start), e = toDate(p.end);
  return !!(p.placeKey && e && now < e && (!s || s <= now));
}

let homePromise = null;
export function loadHome(db) {
  if (!homePromise) {
    homePromise = getDoc(doc(db, 'site', 'home'))
      .then(s => (s.exists() ? s.data() : {}))
      .catch(e => { console.log('Homepage settings could not load:', e.code || e); return {}; });
  }
  return homePromise;
}

let promosPromise = null;
// Every ad that is live right now.
export function loadPromos(db) {
  if (!promosPromise) {
    promosPromise = getDocs(collection(db, 'promos'))
      .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => isLive(p)))
      .catch(e => { console.log('Ads could not load:', e.code || e); return []; });
  }
  return promosPromise;
}

// The live ads for one spot ("home", "city", "place"), joined to their places.
// byKey: Map placeKey -> place. Places that no longer exist are left out.
export function adsFor(promos, where, byKey) {
  return promos.filter(p => Array.isArray(p.where) && p.where.includes(where))
    .map(p => ({ promo: p, place: byKey.get(p.placeKey) }))
    .filter(x => x.place);
}

const CSS = `
.pill-ad { background: #1A1208 !important; color: #fff !important; }
.ad-head { display: flex; align-items: center; gap: 0.5rem; }
.ad-note { font-size: 12px; color: #8A7A66; margin: -0.6rem 0 1rem; }
.ad-note a { color: inherit; }
`;
export function addAdStyle() {
  if (document.getElementById('sfAdStyle')) return;
  const s = document.createElement('style');
  s.id = 'sfAdStyle'; s.textContent = CSS;
  document.head.appendChild(s);
}

export const AD_PILL = '<span class="pill pill-ad" title="Paid placement">Ad</span>';

// A mini card (from sf-places.js miniCard) with the Ad label in front.
export function adCard(html) {
  addAdStyle();
  return html.replace('<p class="mini-meta">', `<p class="mini-meta">${AD_PILL}`);
}
