// Strong Foodie: guides for a moment (Amsterdam in winter, a rainy Sunday,
// Valentine's Day), written by Strong Foodie in guide-edit.html and stored in
// the `guides` collection. The website shows them on guides.html and
// guide.html; the app reads the same collection (Rork batch 11).
//
//   guides/{id}: { slug, title, intro, city, season, moment, cover, walk,
//                  places: [{ coll, id, note }], status: 'draft' | 'published',
//                  createdAt, updatedAt }
//
// walk: true makes the guide a food walk (Rork batch 22): the places are a
// route in their order, with the walking distance and time between them.

import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { esc, guideUrl, toDate } from "./sf-core.js?v=3";

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
  const label = String(g.moment || '').trim() || (g.walk === true ? 'Food walk' : s ? s.label : 'Guide');
  return `<a class="list-card" href="${esc(guideUrl(g.slug))}" style="background:linear-gradient(135deg, ${s ? s.color : '#D4521A'} 0%, #1A1208 100%);">
    <span class="lc-emoji">${g.walk === true ? '🚶' : s ? s.emoji : '📖'}</span>
    ${g.cover ? `<img data-photo="${esc(g.cover)}" alt="" loading="lazy" hidden>` : ''}
    <span class="lc-info">
      <span class="lc-count">${esc(label)}${g.city ? ' · ' + esc(g.city) : ''}</span>
      <span class="lc-title">${esc(g.title)}</span>
      <span class="lc-names">${count} ${count === 1 ? 'place' : 'places'}</span>
    </span>
  </a>`;
}

// ── Food walks
// Straight-line distance times 1.3 for the streets in between, walked at 4.5 km/h.
const DETOUR = 1.3, KMH = 4.5;
const hasXY = p => p && typeof p.lat === 'number' && typeof p.lng === 'number' && isFinite(p.lat) && isFinite(p.lng) && !(p.lat === 0 && p.lng === 0);
export function metres(a, b) {
  const rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
// The legs of the walk, from each place with a location to the next one with a
// location: { from, to (indexes in places), m, min }. Places without one are skipped.
export function walkLegs(places) {
  const legs = [];
  let prev = -1;
  places.forEach((p, i) => {
    if (!hasXY(p)) return;
    if (prev >= 0) {
      const m = metres(places[prev], p) * DETOUR;
      legs.push({ from: prev, to: i, m, min: Math.max(1, Math.round(m / 1000 / KMH * 60)) });
    }
    prev = i;
  });
  return legs;
}
export function walkTotal(legs) {
  return { m: legs.reduce((t, l) => t + l.m, 0), min: legs.reduce((t, l) => t + l.min, 0), legs: legs.length };
}
export const fmtDistance = m => m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`;
export const fmtMinutes = min => min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ' ' + (min % 60) + ' min' : ''}`;
// Google Maps on foot, from where you are past every stop in order (Google takes up to 9 stops on the way).
export function walkMapsUrl(places) {
  const pts = places.filter(hasXY).slice(0, 10);
  if (pts.length < 2) return '';
  const ll = p => `${+p.lat.toFixed(6)},${+p.lng.toFixed(6)}`;
  const last = pts[pts.length - 1];
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ll(last))}&waypoints=${encodeURIComponent(pts.slice(0, -1).map(ll).join('|'))}&travelmode=walking`;
}
