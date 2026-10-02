// Strong Foodie: the "Log in" / account button in the navigation of every page.
//
// Add to a page, as the LAST script before </body>:
//   <script type="module" src="js/sf-account-nav.js?v=1"></script>
//
// One account for the website and the app (the same Firebase Authentication).
// Signed out: "Log in" goes to account.html and back to this page afterwards.
// Signed in: a round badge with your initials goes to your account page.
// It also shows the announcement bar Strong Foodie sets in admin-home.html
// (site/home.announcement: text, link, until), at the top of every page.

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB_9UbXbYdY-TkYPLURESIkKAFLfYfwD3U",
  authDomain: "jongfoodie.firebaseapp.com",
  projectId: "jongfoodie",
  storageBucket: "jongfoodie.firebasestorage.app",
  messagingSenderId: "1006154240382",
  appId: "1:1006154240382:web:45dc5562f8205364aa232f"
};
// The sign-in is stored per Firebase app name, so this must be the page's
// default app (the one every page's own script creates).
const app = getApps().some(a => a.name === '[DEFAULT]') ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The whole path, so pages in folders (strongfoodie.com/p/..., /stad/...) come back after logging in.
const page = () => location.pathname.replace(/^\//, '') || 'index.html';
const loginHref = () => page() === 'account.html' ? '/account.html' : '/account.html?next=' + encodeURIComponent('/' + page() + location.search);

const css = `
  .sf-acct { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; font: 500 13px 'DM Sans', sans-serif; color: #3D2F1A; border: 1px solid rgba(26,18,8,0.15); border-radius: 20px; padding: 7px 14px; white-space: nowrap; background: #FFFDF9; line-height: 1; }
  .sf-acct:hover { border-color: #D4521A; color: #D4521A; }
  .sf-acct-avatar { width: 34px; height: 34px; padding: 0; justify-content: center; border-radius: 50%; background: #D4521A; border-color: #D4521A; color: #fff; font-weight: 700; font-size: 13px; letter-spacing: 0.02em; }
  .sf-acct-avatar:hover { color: #fff; opacity: 0.9; }
  .sf-acct-wrap { display: flex; align-items: center; gap: 10px; }
  .nav-actions .sf-acct { margin-right: 8px; }
  /* Phones: on the crowded homepage bar only the icon, elsewhere "👤 Log in" */
  @media (max-width: 600px) {
    .nav-actions .sf-acct:not(.sf-acct-avatar) { padding: 7px 11px; }
    .nav-actions .sf-acct-label { display: none; }
  }`;

function mount() {
  const nav = document.querySelector('nav');
  if (!nav || nav.querySelector('.sf-acct')) return null;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const a = document.createElement('a');
  a.className = 'sf-acct';
  a.href = loginHref();
  a.innerHTML = '👤<span class="sf-acct-label"> Log in</span>';
  a.setAttribute('aria-label', 'Log in');

  const actions = nav.querySelector('.nav-actions');
  const burger = nav.querySelector('.hamburger');
  if (actions) {
    actions.insertBefore(a, actions.firstChild);
  } else if (burger && nav.lastElementChild === burger) {
    // Keep the account button and the menu button together on the right.
    const wrap = document.createElement('div');
    wrap.className = 'sf-acct-wrap';
    nav.insertBefore(wrap, burger);
    wrap.appendChild(a);
    wrap.appendChild(burger);
  } else {
    nav.appendChild(a);
  }

  // Same entry at the top of the phone menu.
  const menu = document.getElementById('mobileNav');
  let m = null;
  if (menu) {
    m = document.createElement('a');
    m.href = loginHref();
    m.textContent = '👤 Log in';
    menu.insertBefore(m, menu.firstChild);
  }
  return { a, m };
}

const els = mount();

// ── Announcement bar ──────────────────────────────────────────────────────
// Read once per visit (then cached for 5 minutes), hidden after its end date,
// and a visitor can close it: then that announcement stays away on this device.
async function announcement() {
  let a = null;
  try {
    const c = JSON.parse(sessionStorage.getItem('sf_ann') || 'null');
    if (c && Date.now() - c.t < 5 * 60 * 1000) a = c.a;
  } catch (e) {}
  if (!a) {
    try {
      const s = await getDoc(doc(db, 'site', 'home'));
      const x = s.exists() && s.data().announcement ? s.data().announcement : {};
      const until = x.until && typeof x.until.toDate === 'function' ? x.until.toDate().getTime() : 0;
      a = { text: String(x.text || '').slice(0, 160), link: String(x.link || ''), until };
      try { sessionStorage.setItem('sf_ann', JSON.stringify({ t: Date.now(), a })); } catch (e) {}
    } catch (e) { return; }
  }
  if (!a.text || !a.until || a.until < Date.now()) return;
  const key = 'sf_ann_closed_' + [...(a.text + a.until)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  try { if (localStorage.getItem(key)) return; } catch (e) {}
  const link = /^https:\/\/[^\s"<>]+$/.test(a.link) || /^\/?[a-z0-9][a-z0-9\-_/.]*(\.html)?([?#][^\s"<>]*)?$/i.test(a.link) ? a.link : '';
  const style = document.createElement('style');
  style.textContent = `
    .sf-ann { position: relative; background: #D4521A; color: #fff; font: 500 14px/1.45 'DM Sans', system-ui, sans-serif; padding: 10px 48px 10px 16px; text-align: center; }
    .sf-ann a { color: #fff; font-weight: 700; text-decoration: underline; text-underline-offset: 2px; margin-left: 6px; white-space: nowrap; }
    .sf-ann button { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); width: 32px; height: 32px; border: 0; border-radius: 50%; background: rgba(0,0,0,0.15); color: #fff; font-size: 18px; line-height: 1; cursor: pointer; }
    .sf-ann button:hover { background: rgba(0,0,0,0.3); }`;
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.className = 'sf-ann';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Announcement');
  bar.innerHTML = `<span>${esc(a.text)}</span>${link ? `<a href="${esc(link)}"${link.startsWith('https://') && !link.startsWith('https://strongfoodie.com') ? ' target="_blank" rel="noopener"' : ''}>More →</a>` : ''}<button type="button" aria-label="Close this announcement">×</button>`;
  bar.querySelector('button').addEventListener('click', () => { bar.remove(); try { localStorage.setItem(key, '1'); } catch (e) {} });
  const nav = document.querySelector('nav');
  if (nav && nav.parentNode === document.body) document.body.insertBefore(bar, nav);
  else document.body.insertBefore(bar, document.body.firstChild);
}
announcement();

// ── The "More" menu in the top bar (a <details>, so it also works without this):
// close it when clicking somewhere else or pressing Escape.
document.addEventListener('click', e => {
  document.querySelectorAll('.nav-more details[open]').forEach(d => { if (!d.contains(e.target)) d.removeAttribute('open'); });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.nav-more details[open]').forEach(d => { d.removeAttribute('open'); const s = d.querySelector('summary'); if (s) s.focus(); });
});

onAuthStateChanged(auth, async user => {
  if (!els) return;
  const { a, m } = els;
  if (!user) {
    a.className = 'sf-acct';
    a.href = loginHref();
    a.innerHTML = '👤<span class="sf-acct-label"> Log in</span>';
    a.setAttribute('aria-label', 'Log in');
    if (m) { m.href = loginHref(); m.textContent = '👤 Log in'; }
    return;
  }
  let name = user.displayName || '';
  try {
    const s = await getDoc(doc(db, 'profiles', user.uid));
    if (s.exists() && s.data().displayName) name = s.data().displayName;
  } catch (e) {}
  const initials = (name || user.email || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  a.className = 'sf-acct sf-acct-avatar';
  a.href = 'account.html';
  a.innerHTML = esc(initials);
  a.title = (name || 'My account') + ' · My account';
  a.setAttribute('aria-label', 'My account');
  if (m) { m.href = 'account.html'; m.textContent = '👤 My account' + (name ? ' (' + name + ')' : ''); }
});
