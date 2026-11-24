// "Go for" (23 Nov 2026): what a Strong Foodie place is good for, chosen in the admin.
// Saved on the place as goFor: an array of the keys below, in this order. The app reads
// the same keys (Rork batch 86). Keep the keys fixed; labels may change.
export const GO_FOR = [
  ['date', 'Date night'],
  ['friends', 'Dinner with friends'],
  ['drinks', 'Drinks'],
  ['lunch', 'Lunch'],
  ['solo', 'Solo'],
  ['family', 'Family'],
  ['business', 'Business'],
  ['late', 'Late night'],
];
const LABEL = new Map(GO_FOR);

// Only known keys, no doubles, in the fixed order.
export function cleanGoFor(v) {
  if (!Array.isArray(v)) return [];
  const set = new Set(v.map(x => String(x).trim().toLowerCase()));
  return GO_FOR.map(([k]) => k).filter(k => set.has(k));
}
export const goForLabels = v => cleanGoFor(v).map(k => LABEL.get(k));

// ── Members (23 Nov 2026) ───────────────────────────────────────────────
// A member who marked a place as Been there can say what it is good for.
// goForVotes/{coll}_{placeId}_{uid}: { placeKey: "<coll>/<id>", uid, goFor: [keys], updatedAt }
//   Private: only the member reads their own vote (Firestore rule).
// goForCounts/{coll}_{placeId}: { placeKey, counts: { key: n }, voters, updatedAt }
//   Public, written only by the Cloud Function goForCount, which leaves out blocked and
//   sandbox accounts. So nobody can see which member has been where.
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const safe = s => String(s || '').replace(/[^A-Za-z0-9-]/g, '');
export const voteId = (coll, id, uid) => `${safe(coll)}_${safe(id)}_${safe(uid)}`;
export const countId = (coll, id) => `${safe(coll)}_${safe(id)}`;

export async function myVote(db, uid, coll, id) {
  try {
    const s = await getDoc(doc(db, 'goForVotes', voteId(coll, id, uid)));
    return s.exists() ? cleanGoFor(s.data().goFor) : [];
  } catch (e) { console.log('Go for vote not read:', e.code || e); return []; }
}
export async function saveVote(db, uid, coll, id, keys) {
  const goFor = cleanGoFor(keys), ref = doc(db, 'goForVotes', voteId(coll, id, uid));
  if (!goFor.length) { await deleteDoc(ref); return []; }
  await setDoc(ref, { placeKey: `${coll}/${id}`, uid, goFor, updatedAt: serverTimestamp() });
  return goFor;
}
export async function deleteVote(db, uid, coll, id) {
  try { await deleteDoc(doc(db, 'goForVotes', voteId(coll, id, uid))); } catch (e) { console.log('Go for vote not removed:', e.code || e); }
}
// "Date night (4) · Drinks (2)": at most 4, most votes first, then the fixed order.
export async function memberCounts(db, coll, id) {
  try {
    const s = await getDoc(doc(db, 'goForCounts', countId(coll, id)));
    const c = s.exists() ? (s.data().counts || {}) : {};
    return GO_FOR.map(([k, label], i) => ({ k, label, n: Math.max(0, Math.floor(Number(c[k]) || 0)), i }))
      .filter(x => x.n > 0).sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 4);
  } catch (e) { console.log('Go for counts not read:', e.code || e); return []; }
}
