// Strong Foodie: guides for a moment (Amsterdam in winter, a rainy Sunday,
// Valentine's Day), written by Strong Foodie in guide-edit.html and stored in
// the `guides` collection. The website shows them on guides.html and
// guide.html; the app reads the same collection (Rork batch 13).
//
//   guides/{id}: { slug, title, intro, city, season, moment, cover,
//                  places: [{ coll, id, note }], status: 'draft' | 'published',
//                  createdAt, updatedAt }

import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { esc, guideUrl, toDate } from "./sf-core.js?v=2";

export const SEASONS = {
  spring: { label: 'Spring', emoji: '🌷', color: '#5E8A3A' },
  summer: { label: 'Summer', emoji: '☀️', color: '#D48A1A' },
  autumn: { label: 'Autumn', emoji: '🍂', color: '#A3521A' },
  winter: { label: 'Winter', emoji: '❄️', color: '#2F5D7C' },
};
// The season right now (northern half of the world, where most places are).
export function seasonNow(d = new Date()) {
  const m = d.getMonth();
  return m >= 2 && m <= 4 ? 'spring' : m >= 5 && m <= 7 ? 'summer' : m >= 8 && m <= 10 ? 'autumn' : 'winter';
}

// Published guides: this season's first, then the newest.
export async function loadGuides(db) {
  const snap = await getDocs(query(collection(db, 'guides'), where('status', '==', 'published')));
  const now = seasonNow();
  const when = g => (toDate(g.updatedAt) || toDate(g.createdAt) || 0);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(g => typeof g.slug === 'string' && /^[a-z0-9-]{1,80}$/.test(g.slug) && g.title)
    .sort((a, b) => (b.season === now) - (a.season === now) || when(b) - when(a));
}

// A card (styles: .list-card, .lc-… in the page). Photos: hydratePhotos().
export function guideCard(g) {
  const s = SEASONS[g.season];
  const count = Array.isArray(g.places) ? g.places.length : 0;
  const label = String(g.moment || '').trim() || (s ? s.label : 'Guide');
  return `<a class="list-card" href="${esc(guideUrl(g.slug))}" style="background:linear-gradient(135deg, ${s ? s.color : '#D4521A'} 0%, #1A1208 100%);">
    <span class="lc-emoji">${s ? s.emoji : '📖'}</span>
    ${g.cover ? `<img data-photo="${esc(g.cover)}" alt="" loading="lazy" hidden>` : ''}
    <span class="lc-info">
      <span class="lc-count">${esc(label)}${g.city ? ' · ' + esc(g.city) : ''}</span>
      <span class="lc-title">${esc(g.title)}</span>
      <span class="lc-names">${count} ${count === 1 ? 'place' : 'places'}</span>
    </span>
  </a>`;
}
