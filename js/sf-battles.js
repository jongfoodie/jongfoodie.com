// Strong Foodie: Battle. Two places go head to head (for example "Best smash
// burger in Amsterdam: Maijard vs Le Smash"). Members vote once per battle;
// the score shows after you vote and when the battle ends. Strong Foodie
// starts battles in admin-battles.html. The app does the same (Rork batch 17).
//
// battles/{id}: { title, a: "reviews/<id>", b: "reviews/<id>", aName, bName,
//   start, end, votesA, votesB, createdAt, updatedAt }
// battles/{id}/votes/{uid}: { pick: "a" | "b", createdAt }
// A vote is one batched write: the vote document plus votesA or votesB + 1.
// The Firestore rules accept the two only together, once per member, while
// the battle is live.

import { collection, getDocs, doc, getDoc, writeBatch, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const toDate = v => (v && typeof v.toDate === 'function') ? v.toDate() : (v instanceof Date ? v : (v ? new Date(v) : null));

export function battleState(b, now = new Date()) {
  const s = toDate(b.start), e = toDate(b.end);
  if (e && e <= now) return 'ended';
  if (s && s > now) return 'soon';
  return 'live';
}

export function score(b) {
  const a = Math.max(0, Number(b.votesA) || 0), c = Math.max(0, Number(b.votesB) || 0);
  const total = a + c;
  const pa = total ? Math.round(a / total * 100) : 50;
  return { a, b: c, total, pa, pb: total ? 100 - pa : 50, winner: a === c ? '' : (a > c ? 'a' : 'b') };
}

let promise = null;
export function loadBattles(db) {
  if (!promise) {
    promise = getDocs(collection(db, 'battles'))
      .then(s => s.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => b.a && b.b && b.start && b.end))
      .catch(e => { console.log('Battles could not load:', e.code || e); return []; });
  }
  return promise;
}

// Live battles, the one ending first on top.
export function liveBattles(list, now = new Date()) {
  return list.filter(b => battleState(b, now) === 'live').sort((x, y) => toDate(x.end) - toDate(y.end));
}

export function endedBattles(list, now = new Date()) {
  return list.filter(b => battleState(b, now) === 'ended').sort((x, y) => toDate(y.end) - toDate(x.end));
}

export async function myVote(db, battleId, uid) {
  if (!uid) return '';
  try {
    const s = await getDoc(doc(db, 'battles', battleId, 'votes', uid));
    return s.exists() ? (s.data().pick || '') : '';
  } catch (e) { console.log('Vote not read:', e.code || e); return ''; }
}

export async function castVote(db, battleId, uid, pick) {
  if (pick !== 'a' && pick !== 'b') throw new Error('pick');
  const batch = writeBatch(db);
  batch.set(doc(db, 'battles', battleId, 'votes', uid), { pick, createdAt: serverTimestamp() });
  batch.update(doc(db, 'battles', battleId), pick === 'a' ? { votesA: increment(1) } : { votesB: increment(1) });
  await batch.commit();
}
