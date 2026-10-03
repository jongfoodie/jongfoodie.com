// Strong Foodie: "Been there". A member ticks off the places they have been to,
// on the place itself or from their wishlist (account.html). Private, like the
// wishlist: only the member reads it. The app uses the same documents (Rork
// batch 18), so a place ticked off in the app shows here too.
//
// profiles/{uid}/beenThere/{collection}_{placeId}:
//   { placeKey: "<collection>/<id>", placeCollection, placeDocId, placeName,
//     placeCategory, city, source: "web" | "app", createdAt }
// One document per place (the id), so ticking twice never makes a copy.

import { collection, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const beenId = (coll, id) => `${coll}_${id}`;
const ref = (db, uid, coll, id) => doc(db, 'profiles', uid, 'beenThere', beenId(coll, id));

export async function isBeen(db, uid, coll, id) {
  const s = await getDoc(ref(db, uid, coll, id));
  return s.exists();
}

// place: { coll, id, name, cat, city }
export async function markBeen(db, uid, place) {
  await setDoc(ref(db, uid, place.coll, place.id), {
    placeKey: `${place.coll}/${place.id}`,
    placeCollection: place.coll,
    placeDocId: place.id,
    placeName: String(place.name || '').slice(0, 120),
    placeCategory: place.cat || '',
    city: String(place.city || '').slice(0, 160),
    source: 'web',
    createdAt: serverTimestamp(),
  });
}

export async function unmarkBeen(db, uid, coll, id) {
  await deleteDoc(ref(db, uid, coll, id));
}

// Newest first.
export async function loadBeen(db, uid) {
  const toMs = v => (v && typeof v.toDate === 'function') ? v.toDate().getTime() : (v ? new Date(v).getTime() || 0 : 0);
  const snap = await getDocs(collection(db, 'profiles', uid, 'beenThere'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(b => b.placeCollection && b.placeDocId)
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
}
