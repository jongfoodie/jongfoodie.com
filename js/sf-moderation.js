// Strong Foodie: reporting and member flags (the app does the same, Rork batch 14).
//
// reports/{id}: a signed-in member reports a review, highlight, member or
//   member spot. Only the admin can read them (admin-reports.html).
//   { kind, coll, targetId, ownerId, label, reason, note, reportedBy, status: 'open', createdAt }
//   reportedBy is the name the Firestore rules and the app already use.
// memberFlags/{uid}: set by the admin (admin-members.html), readable by everyone.
//   { trusted: true } puts a "Trusted" mark next to the member's name;
//   { blocked: true } hides everything of that member on the site and in the app.
// Hiding one review, highlight or spot keeps the field the app already uses:
//   hidden: true on that document.

import { collection, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const REASONS = [
  ['spam', 'Spam or advertising'],
  ['offensive', 'Offensive, hateful or inappropriate'],
  ['fake', 'Fake, or not a real visit'],
  ['wrong', 'Wrong information'],
  ['other', 'Something else'],
];
export const KINDS = { review: 'review', highlight: 'highlight', member: 'member', spot: 'spot' };

const CSS = `
.sf-trusted { display: inline-flex; align-items: center; gap: 3px; font: 700 10px 'DM Sans', system-ui, sans-serif; letter-spacing: 0.04em; text-transform: uppercase; color: #2D5A3D; background: #E8F2EC; border-radius: 10px; padding: 2px 7px; margin-left: 6px; vertical-align: middle; white-space: nowrap; }
.sf-report-link { background: none; border: none; padding: 0; font: inherit; font-size: 12px; color: #8A7A66; text-decoration: underline; cursor: pointer; }
.sf-report-link:hover { color: #A32323; }
.sf-report-link:disabled { text-decoration: none; cursor: default; }
.sfr { position: fixed; inset: 0; z-index: 20050; background: rgba(10,7,3,0.6); display: flex; align-items: center; justify-content: center; padding: 16px; overflow-y: auto; }
.sfr-card { background: #fff; border-radius: 16px; padding: 1.4rem; width: 100%; max-width: 420px; font-family: 'DM Sans', system-ui, sans-serif; color: #1A1208; box-shadow: 0 16px 50px rgba(0,0,0,0.25); }
.sfr-card h2 { font-family: 'Playfair Display', Georgia, serif; font-size: 1.35rem; margin: 0 0 0.35rem; }
.sfr-card p { font-size: 14px; line-height: 1.5; color: #6B5D4D; margin: 0 0 1rem; }
.sfr-card fieldset { border: 0; padding: 0; margin: 0 0 0.9rem; }
.sfr-card legend { font-size: 13px; font-weight: 600; margin-bottom: 0.4rem; }
.sfr-opt { display: flex; align-items: center; gap: 0.6rem; padding: 0.55rem 0.7rem; border: 1px solid rgba(26,18,8,0.15); border-radius: 10px; margin-bottom: 0.4rem; font-size: 14px; cursor: pointer; }
.sfr-opt:has(input:checked) { border-color: #D4521A; background: #FBF3EF; }
.sfr-opt input { accent-color: #D4521A; width: 18px; height: 18px; margin: 0; }
.sfr-card label.sfr-lab { display: block; font-size: 13px; font-weight: 600; margin-bottom: 0.3rem; }
.sfr-card textarea { display: block; width: 100%; box-sizing: border-box; min-height: 76px; font: 15px 'DM Sans', system-ui, sans-serif; padding: 0.6rem 0.7rem; border: 1px solid rgba(26,18,8,0.2); border-radius: 10px; resize: vertical; }
.sfr-actions { display: flex; gap: 0.6rem; margin-top: 1rem; flex-wrap: wrap; }
.sfr-actions button, .sfr-actions a { flex: 1; min-width: 120px; text-align: center; border-radius: 10px; padding: 0.75rem; font: 600 14px 'DM Sans', system-ui, sans-serif; cursor: pointer; text-decoration: none; }
.sfr-go { border: 0; background: #D4521A; color: #fff; }
.sfr-go:disabled { opacity: 0.6; cursor: default; }
.sfr-no { border: 1px solid rgba(26,18,8,0.2); background: #fff; color: #1A1208; }
.sfr-err { color: #A32323 !important; font-weight: 600; margin: 0.6rem 0 0 !important; }
`;

export function addModerationStyle() {
  if (document.getElementById('sfModStyle')) return;
  const s = document.createElement('style');
  s.id = 'sfModStyle'; s.textContent = CSS;
  document.head.appendChild(s);
}

// One read per page: who is trusted and who is blocked.
let flagsPromise = null;
export function loadFlags(db) {
  if (!flagsPromise) {
    flagsPromise = getDocs(collection(db, 'memberFlags'))
      .then(snap => {
        const f = { blocked: new Set(), trusted: new Set() };
        snap.docs.forEach(d => { const x = d.data(); if (x.blocked === true) f.blocked.add(d.id); if (x.trusted === true) f.trusted.add(d.id); });
        return f;
      })
      .catch(e => { console.log('Member flags could not load:', e.code || e); return { blocked: new Set(), trusted: new Set() }; });
  }
  return flagsPromise;
}

export const isBlocked = (f, uid) => !!(f && uid && f.blocked.has(uid));
// Is this review, highlight or spot one the visitor may see?
export const isVisible = (f, item, authorKey = 'authorId') => !!item && item.hidden !== true && !isBlocked(f, item[authorKey]);

export function trustedMark(f, uid) {
  if (!(f && uid && f.trusted.has(uid))) return '';
  addModerationStyle();
  return '<span class="sf-trusted" title="Trusted reviewer: picked by Strong Foodie">✓ Trusted</span>';
}

// extra = more attributes for the button, e.g. `data-rid="abc"`.
export function reportButton(label = 'Report', extra = '') {
  addModerationStyle();
  return `<button class="sf-report-link" type="button" data-report ${extra}>${label}</button>`;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function currentUser() {
  const { getAuth, onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");
  const auth = getAuth();
  if (auth.currentUser) return auth.currentUser;
  return new Promise(resolve => {
    let done = false;
    const stop = onAuthStateChanged(auth, u => { if (done) return; done = true; resolve(u); try { stop && stop(); } catch (e) {} });
    setTimeout(() => { if (!done) { done = true; resolve(auth.currentUser); } }, 3000);
  });
}

// Opens the report dialog. target = { kind, coll, targetId, ownerId, label }.
// Resolves true when a report was sent.
export function openReport(db, target) {
  addModerationStyle();
  const noun = { review: 'review', highlight: 'highlight', member: 'member', spot: 'place' }[target.kind] || 'post';
  const box = document.createElement('div');
  box.className = 'sfr';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'sfrTitle');
  box.innerHTML = `<div class="sfr-card"><p>Checking your account…</p></div>`;
  document.body.appendChild(box);
  const back = document.activeElement;

  return new Promise(resolve => {
    let sent = false;
    const close = () => {
      box.remove();
      document.removeEventListener('keydown', onKey, true);
      if (back && back.focus) back.focus();
      resolve(sent);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Tab') {
        const f = [...box.querySelectorAll('input, textarea, button, a[href]')].filter(el => !el.disabled && el.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    box.addEventListener('click', e => { if (e.target === box) close(); });

    currentUser().then(user => {
      const card = box.querySelector('.sfr-card');
      if (!user) {
        const next = encodeURIComponent(location.pathname + location.search);
        card.innerHTML = `
          <h2 id="sfrTitle">Log in to report</h2>
          <p>Reports come from Strong Foodie members, so we can follow up and keep out fake reports.</p>
          <div class="sfr-actions"><a class="sfr-go" href="account.html?next=${next}">Log in</a><button class="sfr-no" type="button">Cancel</button></div>`;
        card.querySelector('.sfr-no').addEventListener('click', close);
        card.querySelector('.sfr-go').focus();
        return;
      }
      if (target.ownerId && user.uid === target.ownerId) {
        card.innerHTML = `
          <h2 id="sfrTitle">This is your own ${noun}</h2>
          <p>You can change or delete it yourself.</p>
          <div class="sfr-actions"><button class="sfr-no" type="button">Close</button></div>`;
        card.querySelector('.sfr-no').addEventListener('click', close);
        card.querySelector('.sfr-no').focus();
        return;
      }
      card.innerHTML = `
        <h2 id="sfrTitle">Report this ${noun}</h2>
        <p>Strong Foodie looks at every report within 24 hours. The member doesn't see who reported.</p>
        <form novalidate>
          <fieldset><legend>What's wrong?</legend>
            ${REASONS.map(([v, t]) => `<label class="sfr-opt"><input type="radio" name="sfrReason" value="${v}"> ${t}</label>`).join('')}
          </fieldset>
          <label class="sfr-lab" for="sfrNote">Anything to add? (optional)</label>
          <textarea id="sfrNote" maxlength="500" placeholder="Tell us what you noticed"></textarea>
          <p class="sfr-err" role="alert" hidden></p>
          <div class="sfr-actions"><button class="sfr-go" type="submit">Send report</button><button class="sfr-no" type="button">Cancel</button></div>
        </form>`;
      card.querySelector('.sfr-no').addEventListener('click', close);
      card.querySelector('input').focus();
      card.querySelectorAll('input[name="sfrReason"]').forEach(i => i.addEventListener('change', () => { card.querySelector('.sfr-err').hidden = true; }));
      card.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        const err = card.querySelector('.sfr-err');
        const picked = card.querySelector('input[name="sfrReason"]:checked');
        err.hidden = true;
        if (!picked) { err.textContent = 'Pick what is wrong.'; err.hidden = false; return; }
        const go = card.querySelector('.sfr-go');
        go.disabled = true; go.textContent = 'Sending…';
        try {
          await addDoc(collection(db, 'reports'), {
            kind: target.kind,
            coll: target.coll || '',
            targetId: String(target.targetId || ''),
            ownerId: target.ownerId || '',
            label: String(target.label || '').slice(0, 200),
            reason: picked.value,
            note: card.querySelector('#sfrNote').value.trim().slice(0, 500),
            reportedBy: user.uid,
            status: 'open',
            createdAt: serverTimestamp(),
          });
          sent = true;
          card.innerHTML = `
            <h2 id="sfrTitle">Thanks for reporting</h2>
            <p>We'll look at it within 24 hours. If it breaks the rules, it comes down.</p>
            <div class="sfr-actions"><button class="sfr-no" type="button">Close</button></div>`;
          card.querySelector('.sfr-no').addEventListener('click', close);
          card.querySelector('.sfr-no').focus();
        } catch (ex) {
          console.log('Report not sent:', ex.code || ex);
          err.textContent = ex && ex.code === 'permission-denied' ? 'Reporting is not switched on yet. Please try again later.' : 'Could not send. Please try again.';
          err.hidden = false;
          go.disabled = false; go.textContent = 'Send report';
        }
      });
    });
  });
}

// Reports come from the website (fields above) and from app versions that used
// other field names. normReport() gives every report the same shape for the admin.
const KIND_ALIASES = {
  review: 'review', reviews: 'review', userreview: 'review', userreviews: 'review',
  highlight: 'highlight', highlights: 'highlight', story: 'highlight',
  member: 'member', user: 'member', users: 'member', profile: 'member', account: 'member',
  spot: 'spot', place: 'spot', userplace: 'spot', userplaces: 'spot',
};
const COLL_OF = { review: 'userReviews', highlight: 'highlights', member: 'profiles', spot: 'userPlaces' };
export function normReport(r) {
  const raw = String(r.kind || r.type || r.targetType || r.contentType || r.itemType || '').toLowerCase().replace(/[^a-z]/g, '');
  const kind = KIND_ALIASES[raw] || raw || 'other';
  const targetId = String(r.targetId || r.contentId || r.itemId || r.reviewId || r.highlightId || r.placeId || r.reportedUserId || r.userId || '');
  const done = ['done', 'resolved', 'closed', 'handled'].includes(String(r.status || '').toLowerCase());
  return {
    ...r, kind, targetId,
    coll: r.coll || COLL_OF[kind] || '',
    ownerId: r.ownerId || r.reportedUserId || r.authorId || (kind === 'member' ? targetId : ''),
    reporterId: r.reportedBy || r.reporterId || '',
    note: r.note || r.details || r.description || r.comment || r.message || '',
    label: r.label || r.targetName || r.title || '',
    status: done ? 'done' : 'open',
  };
}

// Wires every [data-report] button inside root. getTarget(button) returns the target.
export function wireReports(db, root, getTarget) {
  root.querySelectorAll('[data-report]').forEach(b => {
    if (b.dataset.wired) return;
    b.dataset.wired = '1';
    b.addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation();
      const ok = await openReport(db, getTarget(b));
      if (ok) { b.textContent = 'Reported'; b.disabled = true; }
    });
  });
}
