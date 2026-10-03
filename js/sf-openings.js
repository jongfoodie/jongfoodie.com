// Strong Foodie: "Just opened". Strong Foodie marks a place as newly opened in
// admin-openings.html; the homepage, its destination page and the place itself
// then show it, for 90 days or until the date set. A date in the future shows
// as "Opens …". The app reads the same documents (Rork batch 17).
//
// openings/{coll}_{id}: { placeKey: "reviews/<id>", placeName, openedOn, until, note, updatedAt }

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const SHOW_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;
const toDate = v => (v && typeof v.toDate === 'function') ? v.toDate() : (v instanceof Date ? v : (v ? new Date(v) : null));

// Shown from 30 days before the opening until `until` (or 90 days after it).
export function isShown(o, now = new Date()) {
  const opened = toDate(o.openedOn);
  if (!o.placeKey || !opened || isNaN(opened)) return false;
  const until = toDate(o.until) || new Date(opened.getTime() + SHOW_DAYS * DAY);
  return now < until && opened.getTime() - 30 * DAY <= now.getTime();
}

export function isUpcoming(o, now = new Date()) {
  const opened = toDate(o.openedOn);
  return !!opened && opened > now;
}

let promise = null;
export function loadOpenings(db) {
  if (!promise) {
    promise = getDocs(collection(db, 'openings'))
      .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => isShown(o)))
      .catch(e => { console.log('Openings could not load:', e.code || e); return []; });
  }
  return promise;
}

// The shown openings joined to their places, newest opening first. Closed places are left out.
export function openingsWithPlaces(openings, byKey) {
  return openings.map(o => ({ o, place: byKey.get(o.placeKey) }))
    .filter(x => x.place && !x.place.closed)
    .sort((a, b) => toDate(b.o.openedOn) - toDate(a.o.openedOn));
}

export function openingLabel(o, now = new Date()) {
  const d = toDate(o.openedOn);
  if (!d) return '';
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return isUpcoming(o, now) ? `Opens ${day}` : `Opened ${day}`;
}

const CSS = `
.pill-new { background: #2D5A3D !important; color: #fff !important; }
.open-when { font-size: 12px; color: #2D5A3D; font-weight: 600; margin-top: 2px; }
`;
export function addOpeningStyle() {
  if (document.getElementById('sfOpenStyle')) return;
  const s = document.createElement('style');
  s.id = 'sfOpenStyle'; s.textContent = CSS;
  document.head.appendChild(s);
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A mini card (sf-places.js miniCard) with a green "New" label and the opening date.
export function openingCard(html, o) {
  addOpeningStyle();
  const pill = `<span class="pill pill-new" title="${esc(openingLabel(o))}">${isUpcoming(o) ? 'Soon' : 'New'}</span>`;
  return html.replace('<p class="mini-meta">', `<p class="mini-meta">${pill}`)
    .replace('<h3 class="mini-title">', `<p class="open-when">${esc(openingLabel(o))}${o.note ? ' · ' + esc(String(o.note).slice(0, 60)) : ''}</p><h3 class="mini-title">`);
}
