// Strong Foodie: invite a friend. Every member has a link,
// https://strongfoodie.com/account.html?ref=<their uid>. Someone who makes an
// account through it (here or in the app, Rork batch 20) is saved as
// invites/{their uid}: { inviterId, createdAt }, once. Each friend who joined
// gives the inviter a month of Strong Foodie Pro, up to 12 months; the member
// claims them on their account page, which moves proUntil on their profile
// (the same field the app uses for Pro) and counts inviteMonthsClaimed.

import { collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const REWARD_CAP = 12;
const REF_KEY = 'sf_ref';
const okId = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);

export const inviteLink = uid => 'https://strongfoodie.com/account.html?ref=' + encodeURIComponent(uid);

// Remembers ?ref= from the address for this visit, so a sign-up on another page still counts.
export function rememberRef() {
  const r = new URLSearchParams(location.search).get('ref');
  if (okId(r)) { try { sessionStorage.setItem(REF_KEY, r); } catch (e) {} }
  return currentRef();
}
export function currentRef() {
  let r = new URLSearchParams(location.search).get('ref');
  if (!okId(r)) { try { r = sessionStorage.getItem(REF_KEY); } catch (e) { r = null; } }
  return okId(r) ? r : '';
}

// The inviter's name for the sign-up form ("Invited by Sam"), or '' when unknown.
export async function inviterName(db, ref) {
  if (!okId(ref)) return '';
  try { const s = await getDoc(doc(db, 'profiles', ref)); return s.exists() ? String(s.data().displayName || '') : ''; }
  catch (e) { return ''; }
}

// Right after a new profile is made. Never blocks the sign-up.
export async function recordInvite(db, uid) {
  const ref = currentRef();
  if (!ref || ref === uid) return false;
  try {
    await setDoc(doc(db, 'invites', uid), { inviterId: ref, createdAt: serverTimestamp() });
    try { sessionStorage.removeItem(REF_KEY); } catch (e) {}
    return true;
  } catch (e) { console.log('Invite not saved:', e.code || e); return false; }
}

export async function countInvites(db, uid) {
  const s = await getDocs(query(collection(db, 'invites'), where('inviterId', '==', uid)));
  return s.size;
}

const toDate = v => (v && typeof v.toDate === 'function') ? v.toDate() : (v ? new Date(v) : null);
export function proUntil(profile) {
  const d = toDate(profile && profile.proUntil);
  return d && !isNaN(d) && d > new Date() ? d : null;
}

// Months still to claim.
export function monthsToClaim(joined, profile) {
  const claimed = Math.max(0, Number(profile && profile.inviteMonthsClaimed) || 0);
  return Math.max(0, Math.min(joined, REWARD_CAP) - claimed);
}

// Adds the months to Pro: from today, or from the current end when Pro is still running.
export async function claimMonths(db, uid, profile, months) {
  const start = proUntil(profile) || new Date();
  const until = new Date(start);
  until.setMonth(until.getMonth() + months);
  const claimed = (Math.max(0, Number(profile.inviteMonthsClaimed) || 0)) + months;
  await updateDoc(doc(db, 'profiles', uid), { proUntil: until, inviteMonthsClaimed: claimed });
  profile.proUntil = until;
  profile.inviteMonthsClaimed = claimed;
  return until;
}
