// Strong Foodie: lists made by members, like "My top 5 in Rotterdam".
// Members make them in my-list.html (and in the app, Rork batch 19); everyone
// sees a published one on list.html, which the GitHub Action also turns into a
// page of its own for Google (strongfoodie.com/list/<title>-<id>/).
//
// memberLists/{id}: { authorId, authorName, title, slug, city, intro, cover,
//   places: [{ coll, id, name, note }], status: 'published' | 'draft',
//   hidden: false, createdAt, updatedAt, publishedAt }
// hidden is set by Strong Foodie only (admin-reports.html). The Firestore rules
// show a list to everyone only while it is published and not hidden; the
// author always sees their own.

import { collection, query, where, getDocs, getDoc, doc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { esc, slugOf, normalise, isPublished, toDate } from "./sf-core.js?v=3";

export const LIMITS = { title: 80, city: 60, intro: 600, note: 200, places: 30 };
export const PLACE_COLLS = ['reviews', 'drinkspots', 'shopspots', 'culturespots', 'healthspots', 'hotelreviews', 'userPlaces'];

// The address of a list's own page. tools/build-pages.mjs makes the same one.
export const memberListUrl = l => `/list/${slugOf(l.title) || 'list'}-${l.id}/`;
// Works before that page exists too.
export const memberListLink = l => `/list.html?id=${encodeURIComponent(l.id)}`;

const when = l => (toDate(l.updatedAt) || toDate(l.publishedAt) || toDate(l.createdAt) || new Date(0)).getTime();

// A member's public lists, newest first.
export async function publishedListsBy(db, uid) {
  const s = await getDocs(query(collection(db, 'memberLists'), where('authorId', '==', uid), where('status', '==', 'published'), where('hidden', '==', false)));
  return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => when(b) - when(a));
}

// All lists of the signed-in member, drafts too.
export async function myLists(db, uid) {
  const s = await getDocs(query(collection(db, 'memberLists'), where('authorId', '==', uid)));
  return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => when(b) - when(a));
}

// The places of a list, in its order, each with the member's note. Places that
// are gone, hidden, not published, or from a private account or a member
// Strong Foodie blocked are skipped. flags: loadFlags() from sf-moderation.js.
export async function listPlaces(db, l, flags = null) {
  const items = Array.isArray(l.places) ? l.places.filter(it => it && PLACE_COLLS.includes(it.coll) && typeof it.id === 'string' && it.id).slice(0, LIMITS.places) : [];
  const now = new Date();
  const owners = new Map();
  const found = await Promise.all(items.map(async it => {
    try {
      const s = await getDoc(doc(db, it.coll, it.id));
      if (!s.exists()) return null;
      const r = s.data();
      const member = it.coll === 'userPlaces';
      if (!r.name || (member ? r.hidden === true : !isPublished(r, now))) return null;
      if (member && flags && flags.blocked && flags.blocked.has(r.addedByUserId)) return null;
      if (member && r.addedByUserId && r.addedByUserId !== l.authorId) {
        if (!owners.has(r.addedByUserId)) owners.set(r.addedByUserId, getDoc(doc(db, 'profiles', r.addedByUserId)).then(o => o.exists() && o.data().isPrivate === true).catch(() => false));
        if (await owners.get(r.addedByUserId)) return null;
      }
      return { ...normalise(it.coll, it.id, r, member), note: String(it.note || '').trim().slice(0, LIMITS.note) };
    } catch (e) { console.log('List place skipped:', it.coll, it.id, e.code || e); return null; }
  }));
  return found.filter(Boolean);
}

const CSS = `
.ml-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; }
.ml-card { position: relative; display: block; border-radius: 16px; overflow: hidden; aspect-ratio: 16 / 10; color: #fff; text-decoration: none; background: linear-gradient(135deg, #D4521A 0%, #1A1208 100%); }
.ml-card img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform 0.35s; }
.ml-card:hover img { transform: scale(1.04); }
.ml-card::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(26,18,8,0.05) 20%, rgba(26,18,8,0.9) 100%); }
.ml-emoji { position: absolute; top: 12px; right: 14px; font-size: 26px; z-index: 1; }
.ml-info { position: absolute; left: 16px; right: 16px; bottom: 14px; z-index: 2; }
.ml-count { display: inline-block; background: #D4521A; font: 700 10px 'DM Sans', system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 8px; border-radius: 6px; margin-bottom: 6px; }
.ml-title { display: block; font-family: 'Playfair Display', Georgia, serif; font-size: 20px; line-height: 1.15; overflow-wrap: anywhere; }
.ml-names { display: block; font: 12px 'DM Sans', system-ui, sans-serif; color: rgba(255,255,255,0.78); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 600px) { .ml-grid { grid-template-columns: 1fr; } }
`;
export function addListStyle() {
  if (document.getElementById('sfListStyle')) return;
  const s = document.createElement('style');
  s.id = 'sfListStyle'; s.textContent = CSS;
  document.head.appendChild(s);
}

// A card for a grid (photo: hydratePhotos from sf-places.js).
export function listCard(l) {
  addListStyle();
  const n = Array.isArray(l.places) ? l.places.length : 0;
  const names = (l.places || []).map(p => p && p.name).filter(Boolean).slice(0, 4).join(', ');
  return `<a class="ml-card" href="${esc(memberListLink(l))}">
    ${l.cover ? `<img data-photo="${esc(l.cover)}" alt="" loading="lazy" hidden>` : ''}
    <span class="ml-emoji" aria-hidden="true">📝</span>
    <span class="ml-info"><span class="ml-count">${n} ${n === 1 ? 'place' : 'places'}${l.city ? ' · ' + esc(l.city) : ''}</span>
      <span class="ml-title">${esc(l.title || 'A list')}</span>
      ${names ? `<span class="ml-names">${esc(names)}</span>` : ''}</span>
  </a>`;
}
