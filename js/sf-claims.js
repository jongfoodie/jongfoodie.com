// Strong Foodie: claim your business. The owner of a place asks for its page
// on the place page (or from the app, which opens that page); Strong Foodie
// checks it in admin-claims.html. An approved owner gets a "Claimed by the owner"
// label, replies to member reviews, and suggests new hours, details and photos,
// which Strong Foodie still checks in admin-edits.html. The app shows the same
// (Rork batch 23).
//
// claims/{coll}_{placeId}_{uid}:  { placeKey, placeId, placeCollection, placeName, uid,
//                                   name, role, contact, proof, status: 'pending' | 'approved' | 'rejected' | 'removed',
//                                   createdAt, handledAt }
// businessOwners/{coll}_{placeId}: { placeKey, placeId, placeCollection, placeName, uid, since }
// ownerReplies/{reviewId}:         { reviewId, ownerKey, authorId, ownerName, text, createdAt, updatedAt }

import { collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { addModerationStyle } from "./sf-moderation.js?v=1";

export const ownerKey = p => `${p.coll}_${p.id}`;
export const claimId = (p, uid) => `${ownerKey(p)}_${uid}`;
export const ROLES = ['Owner', 'Manager', 'Staff'];
export const REPLY_MAX = 600;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The approved owner of a place, or null.
export async function loadOwner(db, p) {
  try { const s = await getDoc(doc(db, 'businessOwners', ownerKey(p))); return s.exists() && s.data().uid ? { id: s.id, ...s.data() } : null; }
  catch (e) { return null; }
}
// This member's own claim for a place, or null.
export async function myClaim(db, p, uid) {
  if (!uid) return null;
  try { const s = await getDoc(doc(db, 'claims', claimId(p, uid))); return s.exists() ? { id: s.id, ...s.data() } : null; }
  catch (e) { return null; }
}
// Owner replies for a place, by review id. Hidden ones are in it too (hidden: true): show them to nobody.
export async function loadReplies(db, p) {
  const out = new Map();
  try {
    const s = await getDocs(query(collection(db, 'ownerReplies'), where('ownerKey', '==', ownerKey(p))));
    s.docs.forEach(d => { const r = d.data(); if (typeof r.text === 'string') out.set(d.id, { id: d.id, ...r }); });
  } catch (e) { console.log('Owner replies could not load:', e.code || e); }
  return out;
}
export async function saveReply(db, p, reviewId, uid, text, existing) {
  const data = { reviewId, ownerKey: ownerKey(p), authorId: uid, ownerName: String(p.name || '').slice(0, 80), text: text.slice(0, REPLY_MAX), updatedAt: serverTimestamp() };
  if (!existing) data.createdAt = serverTimestamp();
  // merge: a reply Strong Foodie hid keeps its hidden fields (the rules refuse to drop them).
  await setDoc(doc(db, 'ownerReplies', reviewId), data, { merge: true });
  return { id: reviewId, ...data, createdAt: existing && existing.createdAt ? existing.createdAt : new Date(), updatedAt: new Date() };
}
export const deleteReply = (db, reviewId) => deleteDoc(doc(db, 'ownerReplies', reviewId));

const CSS = `
.sfr.sfr-tall { align-items: flex-start; }
.sfr-card input[type=text], .sfr-card select { display: block; width: 100%; box-sizing: border-box; font: 15px 'DM Sans', system-ui, sans-serif; padding: 0.6rem 0.7rem; border: 1px solid rgba(26,18,8,0.2); border-radius: 10px; margin-bottom: 0.8rem; background: #fff; color: #1A1208; }
.sfr-card .sfc-check { display: flex; gap: 0.55rem; align-items: flex-start; font-size: 13.5px; line-height: 1.45; margin-top: 0.8rem; cursor: pointer; }
.sfr-card .sfc-check input { accent-color: #D4521A; width: 18px; height: 18px; margin: 1px 0 0; flex: none; }
.sfr-card ul.sfc-gets { margin: 0 0 1rem 1.1rem; padding: 0; font-size: 14px; line-height: 1.55; color: #3D2F1A; }
`;
function addStyle() {
  addModerationStyle();
  if (document.getElementById('sfClaimStyle')) return;
  const s = document.createElement('style');
  s.id = 'sfClaimStyle'; s.textContent = CSS;
  document.head.appendChild(s);
}

// A dialog box like the report and correction dialogs. Returns { box, close }.
function dialog(tall) {
  addStyle();
  const box = document.createElement('div');
  box.className = 'sfr' + (tall ? ' sfr-tall' : '');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'sfcTitle');
  const back = document.activeElement;
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') {
      const f = [...box.querySelectorAll('input, textarea, button, a[href], select')].filter(el => !el.disabled && el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  function close() { box.remove(); document.removeEventListener('keydown', onKey, true); if (back && back.focus) back.focus(); }
  document.addEventListener('keydown', onKey, true);
  box.addEventListener('click', e => { if (e.target === box) close(); });
  document.body.appendChild(box);
  return { box, close };
}

// The claim form. onDone(claim) runs after it is sent.
export function openClaim(db, p, user, onDone = () => {}) {
  const { box, close } = dialog(!!user);
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search + '#claim');
    box.innerHTML = `<div class="sfr-card"><h2 id="sfcTitle">Log in to claim this place</h2>
      <p>Claiming is free. Log in with your Strong Foodie account, or make one, and you come straight back here.</p>
      <div class="sfr-actions"><a class="sfr-go" href="/account.html?next=${next}">Log in</a><button class="sfr-no" type="button">Cancel</button></div></div>`;
    box.querySelector('.sfr-no').addEventListener('click', close);
    box.querySelector('.sfr-go').focus();
    return;
  }
  box.innerHTML = `<div class="sfr-card">
    <h2 id="sfcTitle">Claim ${esc(p.name)}</h2>
    <p>Free for the owner or manager. Once Strong Foodie has checked it, you can:</p>
    <ul class="sfc-gets"><li>reply to member reviews</li><li>keep your opening hours, details and photos up to date</li><li>show "Claimed by the owner" on your page</li></ul>
    <form novalidate>
      <label class="sfr-lab" for="sfcName">Your name</label><input type="text" id="sfcName" maxlength="80" autocomplete="name" value="${esc(user.displayName || '')}">
      <label class="sfr-lab" for="sfcRole">Your role</label><select id="sfcRole">${ROLES.map(r => `<option>${r}</option>`).join('')}</select>
      <label class="sfr-lab" for="sfcContact">Business email or phone number</label><input type="text" id="sfcContact" maxlength="120" placeholder="So we can check it with you">
      <label class="sfr-lab" for="sfcProof">How can we see it's yours? (optional)</label><textarea id="sfcProof" maxlength="500" placeholder="e.g. your website or Instagram shows this email, or call us on this number"></textarea>
      <label class="sfc-check"><input type="checkbox" id="sfcOk"><span>I run this place or may speak for it. Strong Foodie keeps these details to check my claim.</span></label>
      <p class="sfr-err" hidden></p>
      <div class="sfr-actions"><button class="sfr-go" type="submit">Send claim</button><button class="sfr-no" type="button">Cancel</button></div>
    </form></div>`;
  const form = box.querySelector('form'), err = box.querySelector('.sfr-err');
  box.querySelector('.sfr-no').addEventListener('click', close);
  box.querySelector('#sfcName').focus();
  const fail = m => { err.textContent = m; err.hidden = false; };
  form.addEventListener('input', () => { err.hidden = true; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = box.querySelector('#sfcName').value.trim(), contact = box.querySelector('#sfcContact').value.trim();
    if (!name) return fail('Fill in your name.');
    if (contact.length < 6) return fail('Fill in a business email or phone number.');
    if (!box.querySelector('#sfcOk').checked) return fail('Tick the box to confirm you run this place.');
    const btn = form.querySelector('.sfr-go');
    btn.disabled = true;
    const data = {
      placeKey: `${p.coll}/${p.id}`, placeId: p.id, placeCollection: p.coll, placeName: String(p.name || '').slice(0, 120),
      uid: user.uid, name: name.slice(0, 80), role: box.querySelector('#sfcRole').value, contact: contact.slice(0, 120),
      proof: box.querySelector('#sfcProof').value.trim().slice(0, 500), status: 'pending', createdAt: serverTimestamp(),
    };
    try {
      const ref = doc(db, 'claims', claimId(p, user.uid));
      // An earlier claim (rejected, or a pending one with old details) is replaced: the rules let a member delete their own.
      try { await setDoc(ref, data); }
      catch (first) {
        if (!first || first.code !== 'permission-denied') throw first;
        await deleteDoc(ref);
        await setDoc(ref, data);
      }
      box.querySelector('.sfr-card').innerHTML = `<h2 id="sfcTitle">Thank you!</h2><p>Strong Foodie checks your claim and gets in touch at ${esc(data.contact)}. That usually takes a few days.</p><div class="sfr-actions"><button class="sfr-no" type="button">Close</button></div>`;
      box.querySelector('.sfr-no').addEventListener('click', close);
      box.querySelector('.sfr-no').focus();
      onDone({ ...data, createdAt: new Date() });
    } catch (e2) {
      console.log('Claim not sent:', e2.code || e2);
      fail('Could not send. Please try again.');
      btn.disabled = false;
    }
  });
}

// A photo from the owner, made small enough for one Firestore document (like add.html).
export function shrinkPhoto(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > max || h > max) { const f = max / Math.max(w, h); w = Math.round(w * f); h = Math.round(h * f); }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      let q = 0.8, data = c.toDataURL('image/jpeg', q);
      while (data.length > 600000 && q > 0.3) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }
      if (data.length > 900000) { reject(new Error('too big')); return; }
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });
}
// The photo goes to `images` and waits as a correction (field "photo") until Strong Foodie adds it.
export async function suggestPhoto(db, p, user, file) {
  const data = await shrinkPhoto(file);
  const img = await addDoc(collection(db, 'images'), { ownerId: user.uid, contentType: 'image/jpeg', data: data.split(',')[1], source: 'web-owner', createdAt: serverTimestamp() });
  await addDoc(collection(db, 'placeEdits'), {
    status: 'pending', submittedBy: user.uid, placeId: p.id, placeCollection: p.coll, placeName: String(p.name || '').slice(0, 120),
    field: 'photo', suggestedValue: 'fsimg://' + img.id, note: '', currentValue: (p.photos && p.photos[0]) || '', createdAt: serverTimestamp(),
  });
}
