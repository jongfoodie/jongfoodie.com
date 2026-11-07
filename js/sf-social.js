// Strong Foodie: log in with Google (and later Apple).
// Used by account.html and plek.html. It is the same Firebase login as the app,
// so someone who uses the same Google account in the app gets the same account.
//
// A provider only shows when `on` is true. Switch it on here after it is
// switched on in Firebase › Authentication › Sign-in method.

import { GoogleAuthProvider, OAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const PROVIDERS = [
  { id: 'google', name: 'Google', on: true, icon: 'https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg' },
  { id: 'apple', name: 'Apple', on: true, icon: '' },
];

const CSS = `
  .sf-social { display: flex; flex-direction: column; gap: 0.55rem; margin: 0 0 1rem; }
  .sf-social-btn { display: flex; align-items: center; justify-content: center; gap: 0.6rem; width: 100%; padding: 11px 16px; border-radius: 22px;
    border: 1px solid rgba(26,18,8,0.18); background: #fff; color: #1A1208; font: 500 14px 'DM Sans', sans-serif; cursor: pointer; }
  .sf-social-btn:hover { border-color: #3D2F1A; }
  .sf-social-btn:disabled { opacity: 0.6; cursor: default; }
  .sf-social-btn img { width: 18px; height: 18px; flex-shrink: 0; }
  .sf-social-btn.apple { background: #000; border-color: #000; color: #fff; }
  .sf-social-err { font-size: 13px; color: #B3261E; line-height: 1.45; margin: 0; }
  .sf-or { display: flex; align-items: center; gap: 0.75rem; color: #8A7A66; font-size: 12px; margin-top: 0.35rem; }
  .sf-or::before, .sf-or::after { content: ''; flex: 1; height: 1px; background: rgba(26,18,8,0.1); }
  .sf-iab { margin: 0; padding: 12px 14px; border-radius: 12px; background: #FBEDE4; color: #3D2F1A; font-size: 13.5px; line-height: 1.5; }
  .sf-iab b { color: #1A1208; }
`;
let styled = false;
function addStyle() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

const active = () => PROVIDERS.filter(p => p.on);

// Instagram, TikTok, Facebook, Snapchat and some other apps open links in their own
// browser. Google blocks logging in there ("disallowed_useragent"), and the login
// window often doesn't open at all. In that browser the buttons make way for a tip
// to open the page in Safari or Chrome; logging in with email still works there.
// (A Reddit reader ran into this on 7 Nov: visitors from X saw an error and left.)
export function inAppBrowser(ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '') {
  return /Instagram|FBAN|FBAV|FB_IAB|FBIOS|TikTok|musical_ly|Bytedance|Snapchat|LinkedInApp|Pinterest|Line\/|KAKAOTALK|; wv\).*Twitter|Twitter.*; wv\)/i.test(ua);
}

// The buttons, an error line and an "or with email" divider. Empty when no provider is on.
export function socialHtml() {
  const list = active();
  if (!list.length) return '';
  addStyle();
  if (inAppBrowser()) {
    const names = list.map(p => p.name).join(' or ');
    return `<div class="sf-social">
    <p class="sf-iab">Logging in with ${names} doesn't work inside this app. Tap <b>•••</b> at the top and choose <b>Open in browser</b>, or copy the link and open it in Safari or Chrome. Logging in with your email below works here too.</p>
    <button type="button" class="sf-social-btn" data-copy-link>Copy link</button>
    <div class="sf-or"><span>or with email</span></div>
  </div>`;
  }
  return `<div class="sf-social">
    ${list.map(p => `<button type="button" class="sf-social-btn ${p.id}" data-social="${p.id}">${p.icon ? `<img src="${p.icon}" alt="" onerror="this.remove()">` : ''}<span>Continue with ${p.name}</span></button>`).join('')}
    <p class="sf-social-err" role="alert" hidden></p>
    <div class="sf-or"><span>or with email</span></div>
  </div>`;
}

function providerFor(id) {
  if (id === 'apple') {
    const p = new OAuthProvider('apple.com');
    p.addScope('email');
    p.addScope('name');
    return p;
  }
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
}

// Text for the visitor. Empty when there is nothing to say (they closed the window themselves).
export function socialMessage(err, id) {
  const name = (PROVIDERS.find(p => p.id === id) || {}).name || 'this service';
  const c = err && err.code;
  if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request' || c === 'auth/user-cancelled') return '';
  if (c === 'auth/popup-blocked') return 'Your browser blocked the login window. Allow pop-ups for strongfoodie.com and try again.';
  if (c === 'auth/account-exists-with-different-credential') return 'There is already an account with this email address. Log in with your email and password below.';
  if (c === 'auth/network-request-failed') return 'No connection. Check your internet and try again.';
  if (c === 'auth/too-many-requests') return 'Too many attempts. Wait a moment and try again.';
  if (c === 'auth/user-disabled') return 'This account has been disabled.';
  if (c === 'auth/operation-not-allowed' || c === 'auth/unauthorized-domain' || c === 'auth/configuration-not-found' || c === 'auth/invalid-oauth-provider' || c === 'auth/operation-not-supported-in-this-environment')
    return `Logging in with ${name} is not available yet. Please use your email and password.`;
  return `Logging in with ${name} did not work. Please try again.`;
}

// Wires the buttons inside `root`. After a login Firebase fires onAuthStateChanged
// as usual, so each page carries on the same way as after an email login.
export function wireSocial(root, auth) {
  root.querySelectorAll('[data-copy-link]').forEach(b => b.addEventListener('click', async () => {
    const url = location.href;
    try { await navigator.clipboard.writeText(url); b.textContent = 'Link copied. Paste it in Safari or Chrome.'; }
    catch (e) { b.textContent = url; }
  }));
  root.querySelectorAll('[data-social]').forEach(b => b.addEventListener('click', async () => {
    const box = b.closest('.sf-social');
    const errEl = box && box.querySelector('.sf-social-err');
    const buttons = box ? [...box.querySelectorAll('[data-social]')] : [b];
    if (errEl) errEl.hidden = true;
    // The login window has to open straight from the click, so nothing is awaited before this.
    const pending = signInWithPopup(auth, providerFor(b.dataset.social));
    buttons.forEach(x => { x.disabled = true; });
    try {
      await pending;
      if (window.gtag) gtag('event', 'login', { method: b.dataset.social });
    } catch (err) {
      console.log('Social login failed:', err && err.code, err);
      const msg = socialMessage(err, b.dataset.social);
      if (msg && errEl) { errEl.textContent = msg; errEl.hidden = false; }
    } finally {
      if (b.isConnected) buttons.forEach(x => { x.disabled = false; });
    }
  }));
}
