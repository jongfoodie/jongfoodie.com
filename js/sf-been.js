// Strong Foodie: "Been there". A member ticks off the places they have been to,
// on the place itself or from their wishlist (account.html). Private, like the
// wishlist: only the member reads it. The app uses the same documents (Rork
// batch 18), so a place ticked off in the app shows here too.
//
// profiles/{uid}/beenThere/{collection}_{placeId}:
//   { placeKey: "<collection>/<id>", placeCollection, placeDocId, placeName,
//     placeCategory, city, source: "web" | "app", createdAt }
// One document per place (the id), so ticking twice never makes a copy.

import { collection, getDocs, doc, getDoc, setDoc, addDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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

// Places you have been that are not on Strong Foodie (10 Nov 2026). A list of its own, so
// the app (version 2.0), which expects a Strong Foodie place in every beenThere document,
// isn't confused. Private like beenThere. The app reads it from batch 86 on.
// profiles/{uid}/beenPlaces/{auto id}:
//   { kind: 'idea', name, category, city, country, address, lat, lng, placeType, note,
//     source: 'web' | 'google-list' | 'wishlist', createdAt }
export async function addBeenPlace(db, uid, p) {
  const data = {
    kind: 'idea', name: String(p.name || '').slice(0, 120), category: p.category || 'eat',
    city: String(p.city || '').slice(0, 160), address: String(p.address || p.city || '').slice(0, 200),
    note: String(p.note || '').slice(0, 300), source: p.source || 'web', createdAt: serverTimestamp(),
  };
  if (p.country) data.country = String(p.country).slice(0, 60);
  if (p.placeType) data.placeType = String(p.placeType).slice(0, 60);
  if (typeof p.lat === 'number' && typeof p.lng === 'number') { data.lat = p.lat; data.lng = p.lng; }
  return addDoc(collection(db, 'profiles', uid, 'beenPlaces'), data);
}
export async function loadBeenPlaces(db, uid) {
  const snap = await getDocs(collection(db, 'profiles', uid, 'beenPlaces'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => b.name);
}

// Newest first.
export async function loadBeen(db, uid) {
  const toMs = v => (v && typeof v.toDate === 'function') ? v.toDate().getTime() : (v ? new Date(v).getTime() || 0 : 0);
  const snap = await getDocs(collection(db, 'profiles', uid, 'beenThere'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(b => b.placeCollection && b.placeDocId)
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
}
