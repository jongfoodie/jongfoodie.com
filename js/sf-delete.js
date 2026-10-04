// Strong Foodie: members removing their own content, or their whole account.
// Used by account.html, member.html and js/sf-highlights.js.
//
// Everything here only touches documents the signed-in member owns. The
// Firestore rules decide in the end; a refused delete throws, and the page
// tells the member.

import { collection, doc, getDocs, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Photos added in the app or on the site: "fsimg://<id>" is a document in `images`.
const imageIds = (...urls) => [...new Set(urls.flat().filter(u => typeof u === 'string' && u.startsWith('fsimg://')).map(u => u.slice(8)))];
async function dropImages(db, ids) {
  for (const id of ids) { try { await deleteDoc(doc(db, 'images', id)); } catch (e) { console.log('Photo not removed:', id, e.code || e); } }
}

export async function deleteSpot(db, spot) {
  await deleteDoc(doc(db, 'userPlaces', spot.id));
  await dropImages(db, imageIds(spot.photoUrl, spot.photos || []));
}
export async function deleteReview(db, review) {
  await deleteDoc(doc(db, 'userReviews', review.id));
  await dropImages(db, imageIds(review.photoUrl));
}
export async function deleteHighlight(db, h) {
  await deleteDoc(doc(db, 'highlights', h.id));
  // Videos are stored in pieces the website does not know; the cover photo it can remove.
  await dropImages(db, imageIds(h.photoUrl));
}

// A delete button that asks once more: the first tap arms it, the second does it.
export function confirmTap(btn, armedText, ms = 5000) {
  if (btn.dataset.armed) return true;
  const original = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = armedText;
  setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = original; } }, ms);
  return false;
}

// Everything a member owns, removed before the login itself is deleted.
// `step(text)` reports progress. Returns { ok, failed: [what], left: [what] }:
// `failed` blocks deleting the account (it would leave data nobody can remove),
// `left` is only other people's follows of this member.
export async function deleteAllContent(db, uid, step = () => {}) {
  const failed = [], left = [];
  async function each(label, q, fn, soft = false) {
    step(label);
    let docs = [];
    try { docs = (await getDocs(q)).docs; }
    catch (e) { console.log('Could not read', label, e.code || e); (soft ? left : failed).push(label); return; }
    for (const d of docs) {
      try { await fn(d); }
      catch (e) { console.log('Could not delete', label, d.id, e.code || e); if (!(soft ? left : failed).includes(label)) (soft ? left : failed).push(label); }
    }
  }
  await each('highlights', query(collection(db, 'highlights'), where('authorId', '==', uid)), d => deleteHighlight(db, { id: d.id, ...d.data() }));
  await each('reviews', query(collection(db, 'userReviews'), where('authorId', '==', uid)), d => deleteReview(db, { id: d.id, ...d.data() }));
  await each('spots', query(collection(db, 'userPlaces'), where('addedByUserId', '==', uid)), d => deleteSpot(db, { id: d.id, ...d.data() }));
  await each('wishlist', collection(db, 'profiles', uid, 'wishlistItems'), d => deleteDoc(d.ref));
  await each('been there', collection(db, 'profiles', uid, 'beenThere'), d => deleteDoc(d.ref));
  await each('settings', collection(db, 'profiles', uid, 'settings'), d => deleteDoc(d.ref));
  await each('lists', query(collection(db, 'memberLists'), where('authorId', '==', uid)), d => deleteDoc(d.ref), true);
  step('invite');
  try { await deleteDoc(doc(db, 'invites', uid)); } catch (e) { console.log('Invite not deleted:', e.code || e); }
  // Claim your business (js/sf-claims.js): their replies, claims and the places they manage.
  await each('owner replies', query(collection(db, 'ownerReplies'), where('authorId', '==', uid)), d => deleteDoc(d.ref), true);
  await each('claims', query(collection(db, 'claims'), where('uid', '==', uid)), d => deleteDoc(d.ref), true);
  await each('places you manage', query(collection(db, 'businessOwners'), where('uid', '==', uid)), d => deleteDoc(d.ref), true);
  await each('follows', query(collection(db, 'follows'), where('followerId', '==', uid)), d => deleteDoc(d.ref));
  await each('followers', query(collection(db, 'follows'), where('followingId', '==', uid)), d => deleteDoc(d.ref), true);
  // The profile goes last: while anything above failed it stays, so the member can try again.
  if (!failed.length) {
    step('profile');
    try { await deleteDoc(doc(db, 'profiles', uid)); }
    catch (e) { console.log('Could not delete the profile', e.code || e); failed.push('profile'); }
  }
  return { ok: !failed.length, failed, left };
}
