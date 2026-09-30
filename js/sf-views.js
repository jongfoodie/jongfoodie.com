// Strong Foodie: counts how often a place, list, city page, guide or dish list
// is looked at, for the numbers in admin-stats.html. Nothing personal is
// stored and no cookie is used: one counter per page per month, in the
// `views` collection, e.g. views/2026-09_place_reviews-abc123 { type, ref, month, count }.
// A visitor counts once per page per 30 minutes; the admin's own visits don't count.
// The app counts the same way (Rork batch 13).

import { doc, setDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const TYPES = ['place', 'list', 'city', 'guide'];

export function viewId(type, ref, month = new Date().toISOString().slice(0, 7)) {
  return `${month}_${type}_${String(ref).replace(/[^A-Za-z0-9_-]/g, '-')}`.slice(0, 200);
}

export function countView(db, type, ref) {
  try {
    if (!TYPES.includes(type) || !ref || navigator.webdriver) return;
    let admin = false;
    try { admin = localStorage.getItem('sf_admin_device') === '1'; } catch (e) {}
    if (admin) return;
    const month = new Date().toISOString().slice(0, 7);
    const id = viewId(type, ref, month);
    try {
      const last = Number(sessionStorage.getItem('sf_view_' + id) || 0);
      if (Date.now() - last < 30 * 60 * 1000) return;
      sessionStorage.setItem('sf_view_' + id, String(Date.now()));
    } catch (e) {}
    setDoc(doc(db, 'views', id), { type, ref: String(ref).slice(0, 150), month, count: increment(1) }, { merge: true })
      .catch(e => console.log('View not counted:', e.code || e));
  } catch (e) {}
}
