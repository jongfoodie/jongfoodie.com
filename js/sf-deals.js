// Strong Foodie: Pro deals. Discounts at partner places, set by Strong Foodie in
// admin-deals.html. Everyone sees what the deal is (deals.html, the place page
// and the app); the code to use it is only for Pro members: the Firestore rules
// let someone read it only while proUntil on their profile is in the future.
// The app shows the same deals (Rork batch 20).
//
// deals/{id}:     { placeKey: "<collection>/<id>", placeName, title, details, until, active, createdAt, updatedAt }
// dealCodes/{id}: { code }

import { collection, getDocs, getDoc, doc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const toDate = v => (v && typeof v.toDate === 'function') ? v.toDate() : (v instanceof Date ? v : (v ? new Date(v) : null));

export function isLiveDeal(d, now = new Date()) {
  const until = toDate(d.until);
  return !!(d.placeKey && d.title) && d.active !== false && !(until && until <= now);
}

let promise = null;
export function loadDeals(db) {
  if (!promise) {
    promise = getDocs(collection(db, 'deals'))
      .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => isLiveDeal(d))
        .sort((a, b) => String(a.placeName || '').localeCompare(String(b.placeName || ''))))
      .catch(e => { console.log('Deals could not load:', e.code || e); return []; });
  }
  return promise;
}

// The code, or '' when this member may not see it (not Pro, or none set).
export async function dealCode(db, id) {
  try { const s = await getDoc(doc(db, 'dealCodes', id)); return s.exists() ? String(s.data().code || '') : ''; }
  catch (e) { return ''; }
}

export function untilLabel(d) {
  const u = toDate(d.until);
  return u ? 'Until ' + u.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}
