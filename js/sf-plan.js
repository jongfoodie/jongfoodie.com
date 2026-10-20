// Plan a meetup at a place: the same meetups/{id} fields as the app.
// Used by wishlist.html ("Want to go together?", which also invites the
// wishlist's owner) and plek.html ("Plan a meetup here").
//
//   openPlanMeetup(db, {
//     me:     { uid },                                   signed-in member
//     place:  { coll, id, name, cat, emoji, where, city },
//     invite: { uid, name, first } | null,               invited straight away
//   })
//
// The host is going (attendees [host]). An invitation is the same write as
// "Invite people" on meetups.html (invited, inviteNames, invitedAt), so the
// rules (VERSIE 13 OKTOBER) and notifyMeetupRequest treat it the same.
import { collection, doc, getDoc, addDoc, updateDoc, arrayUnion, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { esc } from "./sf-core.js?v=3";

const CSS = `
  .plan { margin: auto; border: none; border-radius: 20px; padding: 0; width: min(460px, calc(100vw - 24px)); max-height: calc(100vh - 24px); background: var(--warm-white, #FFFDF9); color: var(--ink, #1A1208); box-shadow: 0 20px 60px rgba(26,18,8,0.3); }
  .plan::backdrop { background: rgba(26,18,8,0.45); }
  .plan form { padding: 1.25rem 1.25rem 1.1rem; display: flex; flex-direction: column; gap: 0.85rem; }
  .plan h2 { font-family: 'Playfair Display', serif; font-size: 1.35rem; }
  .plan-place { font-weight: 700; overflow-wrap: anywhere; }
  .plan-place small { display: block; font-weight: 400; color: var(--muted, #8A7A66); font-size: 13px; }
  .plan-invite { background: var(--accent-pale, #FBF3EF); color: #B8461A; border-radius: 10px; padding: 0.55rem 0.75rem; font-size: 13.5px; font-weight: 600; }
  .plan-label { font-size: 13px; font-weight: 700; color: var(--ink, #1A1208); margin-bottom: 0.35rem; display: block; }
  .plan-kinds { display: flex; flex-direction: column; gap: 0.45rem; }
  .plan-kind { display: flex; gap: 0.6rem; align-items: center; border: 1px solid var(--border, rgba(26,18,8,0.1)); border-radius: 14px; padding: 0.6rem 0.75rem; cursor: pointer; background: #fff; }
  .plan-kind:has(input:checked) { border-color: var(--accent, #D4521A); background: var(--accent-pale, #FBF3EF); }
  .plan-kind input { accent-color: var(--accent, #D4521A); width: 18px; height: 18px; flex-shrink: 0; }
  .plan-kind b { display: block; font-size: 14.5px; }
  .plan-kind span { font-size: 12.5px; color: var(--ink-soft, #3D2F1A); }
  .plan-when { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .plan input[type="date"], .plan input[type="time"], .plan textarea { border: 1px solid var(--border, rgba(26,18,8,0.1)); border-radius: 12px; padding: 0.6rem 0.75rem; font: 15px 'DM Sans', sans-serif; background: #fff; color: var(--ink, #1A1208); min-height: 44px; }
  .plan textarea { width: 100%; resize: vertical; min-height: 70px; }
  .plan-count { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
  .plan-count output { font-size: 20px; font-weight: 700; min-width: 2ch; }
  .plan-step { display: inline-flex; border: 1px solid var(--border, rgba(26,18,8,0.1)); border-radius: 22px; overflow: hidden; background: #fff; }
  .plan-step button { border: none; background: none; width: 48px; height: 44px; font-size: 20px; cursor: pointer; color: var(--ink, #1A1208); }
  .plan-step button + button { border-left: 1px solid var(--border, rgba(26,18,8,0.1)); }
  .plan-step button:disabled { color: var(--muted, #8A7A66); cursor: default; }
  .plan-error { color: #A32323; font-size: 13.5px; }
  .plan-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .plan-actions .go { flex: 1; border: none; background: #B8461A; color: #fff; border-radius: 24px; min-height: 46px; padding: 0 1.25rem; font: 600 15px 'DM Sans', sans-serif; cursor: pointer; }
  .plan-actions .go:disabled { opacity: 0.6; }
  .plan-actions .no { border: 1px solid var(--border, rgba(26,18,8,0.1)); background: #fff; color: var(--ink, #1A1208); border-radius: 24px; min-height: 46px; padding: 0 1.1rem; font: 500 15px 'DM Sans', sans-serif; cursor: pointer; }
  .plan-done { padding: 1.25rem; display: flex; flex-direction: column; gap: 0.8rem; }
  .plan-done a { align-self: flex-start; background: #B8461A; color: #fff; text-decoration: none; border-radius: 24px; padding: 11px 18px; font-weight: 600; }
`;

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const num = v => typeof v === 'number' && isFinite(v) && v !== 0;

function box() {
  if (!document.getElementById('sfPlanCss')) {
    const st = document.createElement('style');
    st.id = 'sfPlanCss';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  let d = document.getElementById('sfPlan');
  if (!d) {
    d = document.createElement('dialog');
    d.className = 'plan';
    d.id = 'sfPlan';
    d.setAttribute('aria-labelledby', 'planTitle');
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    document.body.appendChild(d);
  }
  return d;
}

export function openPlanMeetup(db, { me, place, invite = null }) {
  if (!me || !me.uid || !place || !place.id || !place.coll) return;
  if (invite && invite.uid === me.uid) invite = null;
  const plan = box();
  let count = 2;
  const day = new Date(Date.now() + 3 * 864e5);
  plan.innerHTML = `<form id="planForm" method="dialog" novalidate>
      <h2 id="planTitle">Plan a meetup</h2>
      <p class="plan-place">${place.emoji ? esc(place.emoji) + ' ' : ''}${esc(place.name)}${place.where ? `<small>📍 ${esc(place.where)}</small>` : ''}</p>
      ${invite ? `<p class="plan-invite">${esc(invite.first || invite.name)} gets an invitation as soon as you plan it.</p>` : ''}
      <div><span class="plan-label" id="planKindLabel">What kind of meetup?</span>
        <div class="plan-kinds" role="radiogroup" aria-labelledby="planKindLabel">
          <label class="plan-kind"><input type="radio" name="kind" value="friends"${place.cat === 'health' ? '' : ' checked'}><span><b>🍽️ Just food</b><span>Meet other foodies. No romance involved.</span></span></label>
          <label class="plan-kind"><input type="radio" name="kind" value="sport"${place.cat === 'health' ? ' checked' : ''}><span><b>🏃 Sport</b><span>Run, train or play a game together. Any spot works.</span></span></label>
        </div></div>
      <div><span class="plan-label">When</span>
        <div class="plan-when"><input type="date" id="planDate" aria-label="Date" min="${ymd(new Date())}" value="${ymd(day)}" required><input type="time" id="planTime" aria-label="Time" value="19:00" step="300" required></div></div>
      <div class="plan-count"><span class="plan-label" style="margin:0;">How many people can join, including you</span>
        <span style="display:flex;align-items:center;gap:0.6rem;"><output id="planN" aria-live="polite">2</output><span class="plan-step"><button type="button" id="planMinus" aria-label="One less" disabled>−</button><button type="button" id="planPlus" aria-label="One more">+</button></span></span></div>
      <div><label class="plan-label" for="planNote">Anything they should know</label>
        <textarea id="planNote" maxlength="300" placeholder="Going for the tasting menu, happy to split a starter."></textarea></div>
      ${invite ? '' : '<p class="plan-label" style="font-weight:400;color:var(--ink-soft,#3D2F1A);margin:0;">Once it\'s planned, invite people you follow or who follow you.</p>'}
      <p class="plan-error" id="planError" role="alert" hidden></p>
      <div class="plan-actions"><button type="submit" class="go" id="planGo">Plan meetup</button><button type="button" class="no" id="planNo">Cancel</button></div>
    </form>`;
  const q = s => plan.querySelector(s);
  const n = q('#planN'), minus = q('#planMinus'), plus = q('#planPlus');
  const setN = v => { count = Math.max(2, Math.min(20, v)); n.textContent = count; minus.disabled = count <= 2; plus.disabled = count >= 20; };
  minus.addEventListener('click', () => setN(count - 1));
  plus.addEventListener('click', () => setN(count + 1));
  q('#planNo').addEventListener('click', () => plan.close());
  const error = msg => { const el = q('#planError'); el.textContent = msg; el.hidden = !msg; };

  q('#planForm').addEventListener('submit', async e => {
    e.preventDefault();
    const d = q('#planDate').value, t = q('#planTime').value;
    const when = d && t ? new Date(`${d}T${t}`) : null;
    if (!when || isNaN(when)) return error('Pick a date and a time.');
    if (when.getTime() < Date.now() + 15 * 60e3) return error('Pick a time in the future.');
    const kind = (q('input[name="kind"]:checked') || {}).value === 'sport' ? 'sport' : 'friends';
    const note = q('#planNote').value.trim().slice(0, 300);
    const go = q('#planGo');
    go.disabled = true; go.textContent = 'Planning…'; error('');
    let ref = null;
    try {
      // The host's name and photo, and the place's address and pin.
      const [mine, pl] = await Promise.all([
        getDoc(doc(db, 'profiles', me.uid)).then(x => x.exists() ? x.data() : {}).catch(() => ({})),
        getDoc(doc(db, place.coll, place.id)).then(x => x.exists() ? x.data() : {}).catch(() => ({})),
      ]);
      const rawCity = String(pl.city || '');
      const address = String(pl.address || (rawCity.includes(',') ? rawCity.split(',')[0] : '') || '').trim().slice(0, 200);
      const m = {
        hostId: me.uid,
        hostName: String(mine.displayName || '').trim() || 'A member',
        hostPhoto: typeof mine.photoUrl === 'string' ? mine.photoUrl : '',
        placeId: place.id,
        placeName: place.name,
        locationText: place.name,
        placeCategory: place.cat || '',
        city: place.city || '',
        address,
        date: Timestamp.fromDate(when),
        intent: kind,
        maxGuests: count,
        note,
        attendees: [me.uid],
        pendingRequests: [],
        requestNames: {},
        declinedRequests: [],
        status: 'open',
        source: 'web',
        createdAt: serverTimestamp(),
      };
      if (num(pl.lat) && num(pl.lng)) { m.lat = pl.lat; m.lng = pl.lng; }
      ref = await addDoc(collection(db, 'meetups'), m);
    } catch (err) {
      console.log('Meetup not planned:', err.code || err);
      go.disabled = false; go.textContent = 'Plan meetup';
      return error('Your meetup could not be planned. Please try again.');
    }
    const link = `meetups.html?id=${encodeURIComponent(ref.id)}`;
    if (!invite) { location.href = link; return; }
    try {
      await updateDoc(ref, { invited: arrayUnion(invite.uid), [`inviteNames.${invite.uid}`]: invite.name || 'A member', [`invitedAt.${invite.uid}`]: serverTimestamp() });
      location.href = link;
    } catch (err) {
      console.log('Invite not sent:', err.code || err);
      plan.innerHTML = `<div class="plan-done"><h2 id="planTitle">Meetup planned</h2>
        <p>Meetup planned, but ${esc(invite.first || invite.name)} could not be invited. Invite them from the meetup.</p>
        <a href="${link}">Open the meetup →</a></div>`;
    }
  });
  if (typeof plan.showModal === 'function') plan.showModal(); else plan.setAttribute('open', '');
}
