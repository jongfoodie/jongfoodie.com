// Strong Foodie: members blocking each other.
//
// A block is its own document: blocks/<blocker uid>_<blocked uid> = { blockerId, blockedId, createdAt }.
// Only the two members involved and Strong Foodie can read it (Firestore rules), so
// nobody else can see who blocked whom. It used to be a public list, blockedUsers,
// on the profile; admin-members.html moves those lists here and leaves the list empty.
// The app does the same (Rork batch 30). Used by member.html, list.html and admin-members.html.

import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const blockId = (blocker, blocked) => `${blocker}_${blocked}`;

// Has `blocker` blocked `viewer`? Also reads the old public list while a profile still has one.
export async function hasBlocked(db, blocker, viewer, profile) {
  if (!blocker || !viewer || blocker === viewer) return false;
  if (profile && Array.isArray(profile.blockedUsers) && profile.blockedUsers.includes(viewer)) return true;
  try { return (await getDoc(doc(db, 'blocks', blockId(blocker, viewer)))).exists(); }
  catch (e) { console.log('Block not read:', e.code || e); return false; }
}

// Profiles that still carry a public block list.
export const withPublicBlocks = profiles => profiles.filter(p => Array.isArray(p.blockedUsers) && p.blockedUsers.some(u => typeof u === 'string' && u));

// Admin: move every public block list into block documents, then empty the list.
// The list stays as an empty array (not removed) so older app builds keep reading the profile.
// Returns { members, blocks, failed }.
export async function movePublicBlocks(db, profiles, step = () => {}) {
  let members = 0, blocks = 0;
  const failed = [];
  for (const p of withPublicBlocks(profiles)) {
    const blocker = p.id;
    step(p.displayName || blocker);
    let ok = true;
    for (const blocked of [...new Set(p.blockedUsers)]) {
      if (typeof blocked !== 'string' || !blocked || blocked === blocker) continue;
      const ref = doc(db, 'blocks', blockId(blocker, blocked));
      try {
        if (!(await getDoc(ref)).exists()) {
          await setDoc(ref, { blockerId: blocker, blockedId: blocked, createdAt: serverTimestamp() });
          blocks++;
        }
      } catch (e) { console.log('Block not moved:', blocker, blocked, e.code || e); ok = false; }
    }
    if (!ok) { failed.push(blocker); continue; }       // keep the list, so nothing is lost
    try { await updateDoc(doc(db, 'profiles', blocker), { blockedUsers: [] }); members++; }
    catch (e) { console.log('List not emptied:', blocker, e.code || e); failed.push(blocker); }
  }
  return { members, blocks, failed };
}
