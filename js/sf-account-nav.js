// Strong Foodie: the "Log in" / account button in the navigation of every page.
//
// Add to a page, as the LAST script before </body>:
//   <script type="module" src="js/sf-account-nav.js?v=1"></script>
//
// One account for the website and the app (the same Firebase Authentication).
// Signed out: "Log in" goes to account.html and back to this page afterwards.
// Signed in: a round badge with your initials goes to your account page.

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
const page = () => location.pathname.split('/').pop() || 'index.html';
const loginHref = () => page() === 'account.html' ? 'account.html' : 'account.html?next=' + encodeURIComponent(page() + location.search);

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
