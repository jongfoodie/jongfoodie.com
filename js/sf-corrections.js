// Strong Foodie: members suggest a correction for a place ("the phone number
// changed", "it closed"). The suggestion waits in admin-edits.html until Strong
// Foodie applies or rejects it. The app writes the same documents (Rork batch 21).
//
// placeEdits/{id}: { status: 'pending' | 'approved' | 'rejected', submittedBy,
//   placeId, placeCollection, placeName, field, suggestedValue, note,
//   currentValue, createdAt, handledAt, applied }
// field is one of FIELDS below. For "closed", suggestedValue is temp, perm or open.

import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { addModerationStyle } from "./sf-moderation.js?v=1";

export const FIELDS = {
  name: { label: 'Name', ask: 'The right name' },
  address: { label: 'Address', ask: 'The right address' },
  phone: { label: 'Phone number', ask: 'The right phone number' },
  hours: { label: 'Opening hours', ask: 'The right opening hours, e.g. Mon to Fri 9:00 to 17:00' },
  closed: { label: 'It closed, or opened again', ask: '' },
  other: { label: 'Something else', ask: 'What is wrong?' },
};
export const CLOSED = { temp: 'Temporarily closed', perm: 'Permanently closed', open: 'Open again' };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// What the place shows now for a field (for the admin's side by side).
export function currentValue(p, field) {
  if (field === 'closed') return p.closedStatus && p.closedStatus !== 'open' ? p.closedStatus : 'open';
  if (field === 'address') return p.address || p.city || '';
  return String(p[field] || '');
}

// The dialog. place = { coll, id, name, address, phone, hours, website, closedStatus }, user = signed-in user or null.
export function openCorrection(db, place, user) {
  addModerationStyle();
  const box = document.createElement('div');
  box.className = 'sfr';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'sfcTitle');
  const back = document.activeElement;
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); if (back && back.focus) back.focus(); };
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
  document.addEventListener('keydown', onKey, true);
  box.addEventListener('click', e => { if (e.target === box) close(); });
  document.body.appendChild(box);

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    box.innerHTML = `<div class="sfr-card"><h2 id="sfcTitle">Log in to suggest a correction</h2>
      <p>Corrections come from Strong Foodie members, so we can check them.</p>
      <div class="sfr-actions"><a class="sfr-go" href="/account.html?next=${next}">Log in</a><button class="sfr-no" type="button">Cancel</button></div></div>`;
    box.querySelector('.sfr-no').addEventListener('click', close);
    box.querySelector('.sfr-go').focus();
    return;
  }

  box.innerHTML = `<div class="sfr-card">
    <h2 id="sfcTitle">Suggest a correction</h2>
    <p>For ${esc(place.name)}. Strong Foodie checks it before it changes on the website and in the app.</p>
    <form novalidate>
      <fieldset><legend>What needs changing?</legend>
        ${Object.entries(FIELDS).map(([k, f]) => `<label class="sfr-opt"><input type="radio" name="sfcField" value="${k}"> ${esc(f.label)}</label>`).join('')}
      </fieldset>
      <div id="sfcValue"></div>
      <p class="sfr-err" hidden></p>
      <div class="sfr-actions"><button class="sfr-go" type="submit">Send</button><button class="sfr-no" type="button">Cancel</button></div>
    </form></div>`;
  const form = box.querySelector('form'), slot = box.querySelector('#sfcValue'), err = box.querySelector('.sfr-err');
  box.querySelector('.sfr-no').addEventListener('click', close);
  box.querySelectorAll('input[name="sfcField"]').forEach(r => r.addEventListener('change', () => {
    const k = r.value;
    err.hidden = true;
    slot.innerHTML = k === 'closed'
      ? `<fieldset><legend>It is now</legend>${Object.entries(CLOSED).map(([v, t]) => `<label class="sfr-opt"><input type="radio" name="sfcClosed" value="${v}"> ${esc(t)}</label>`).join('')}</fieldset>
         <label class="sfr-lab" for="sfcNote">Anything to add? (optional)</label><textarea id="sfcNote" maxlength="300" placeholder="e.g. Closed for renovation until March"></textarea>`
      : `<label class="sfr-lab" for="sfcText">${esc(FIELDS[k].ask)}</label><textarea id="sfcText" maxlength="1200">${k === 'other' ? '' : esc(currentValue(place, k))}</textarea>`;
  }));
  box.querySelector('input[name="sfcField"]').focus();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const field = (box.querySelector('input[name="sfcField"]:checked') || {}).value;
    if (!field) { err.textContent = 'Choose what needs changing.'; err.hidden = false; return; }
    let value = '', note = '';
    if (field === 'closed') {
      value = (box.querySelector('input[name="sfcClosed"]:checked') || {}).value || '';
      note = (box.querySelector('#sfcNote') || {}).value || '';
      if (!value) { err.textContent = 'Choose whether it closed or opened again.'; err.hidden = false; return; }
    } else {
      value = ((box.querySelector('#sfcText') || {}).value || '').trim();
      if (!value) { err.textContent = 'Fill in the correction.'; err.hidden = false; return; }
      if (field !== 'other' && value === currentValue(place, field).trim()) { err.textContent = 'That is what it says now. Change it to the right one.'; err.hidden = false; return; }
    }
    const btn = form.querySelector('.sfr-go');
    btn.disabled = true;
    try {
      await addDoc(collection(db, 'placeEdits'), {
        status: 'pending', submittedBy: user.uid,
        placeId: place.id, placeCollection: place.coll, placeName: String(place.name || '').slice(0, 120),
        field, suggestedValue: value.slice(0, 1200), note: note.trim().slice(0, 300),
        currentValue: currentValue(place, field).slice(0, 1200),
        createdAt: serverTimestamp(),
      });
      box.querySelector('.sfr-card').innerHTML = `<h2 id="sfcTitle">Thank you!</h2><p>Strong Foodie will check your correction soon.</p><div class="sfr-actions"><button class="sfr-no" type="button">Close</button></div>`;
      box.querySelector('.sfr-no').addEventListener('click', close);
      box.querySelector('.sfr-no').focus();
    } catch (e2) {
      console.log('Correction not sent:', e2.code || e2);
      err.textContent = 'Could not send. Please try again.'; err.hidden = false;
      btn.disabled = false;
    }
  });
}
