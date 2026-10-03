// Strong Foodie: the admin lock.
// Firebase remembers who is signed in, on the whole site. Without this lock,
// anyone who picks up your phone or laptop could open the admin pages just
// because the site still knows you. Now the admin also wants your password:
// the first time on a device, after signing out, and again after an hour
// without using the admin. While you work, the hour keeps starting over.
// The data itself stays protected by the Firestore rules (isAdmin()): this
// lock is about the device, not about the database.

import { signInWithEmailAndPassword, reauthenticateWithCredential, EmailAuthProvider, setPersistence, browserLocalPersistence, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

export const BRAND_UID = 'B9cs5MwpvkUSIoiYh2qMwMnyl4B3';
export const IDLE_MINUTES = 60;
const KEY = 'sf_admin_unlock';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
}

export function isUnlocked(uid) {
  const s = read();
  return !!(s && uid && s.uid === uid && typeof s.until === 'number' && Date.now() < s.until);
}

export function markUnlocked(uid) {
  try { localStorage.setItem(KEY, JSON.stringify({ uid, until: Date.now() + IDLE_MINUTES * 60 * 1000 })); } catch (e) {}
}

export function lockAdmin() {
  try { localStorage.removeItem(KEY); } catch (e) {}
}

// Checks the password. When the site still remembers you, it confirms the
// password on that same account; otherwise it signs you in.
export async function passwordUnlock(auth, email, pw) {
  const cur = auth.currentUser;
  if (cur && cur.email && cur.email.toLowerCase() === email.toLowerCase()) {
    await reauthenticateWithCredential(cur, EmailAuthProvider.credential(cur.email, pw));
    return cur;
  }
  await setPersistence(auth, browserLocalPersistence);
  const cred = await signInWithEmailAndPassword(auth, email, pw);
  return cred.user;
}

export function unlockError(err) {
  const code = (err && err.code) || '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-email' || code === 'auth/user-mismatch') return 'Wrong email or password.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Try again later.';
  if (code === 'auth/network-request-failed') return 'No connection. Check your internet.';
  return 'Could not check your password. Try again.';
}

// Keeps the admin open while you use it, and calls onLock once the hour
// without use has passed (also when you come back to a tab that sat open).
export function watchAdminLock(uid, onLock) {
  let last = 0, done = false;
  const check = () => { if (!done && !isUnlocked(uid)) { stop(); onLock(); } };
  const touch = () => {
    if (!isUnlocked(uid)) return check();
    if (Date.now() - last < 30 * 1000) return;
    last = Date.now();
    markUnlocked(uid);
  };
  const onVisible = () => { if (document.visibilityState === 'visible') check(); };
  const onStorage = e => { if (e.key === KEY || e.key === null) check(); };
  const timer = setInterval(check, 30 * 1000);
  const events = ['pointerdown', 'keydown', 'input'];
  events.forEach(ev => document.addEventListener(ev, touch, true));
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('storage', onStorage);
  function stop() {
    done = true;
    clearInterval(timer);
    events.forEach(ev => document.removeEventListener(ev, touch, true));
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('storage', onStorage);
  }
  return stop;
}

// For the admin tool pages (stats, reports, members, homepage, ads, booking, lists, guides, dishes). Waits until the
// admin is unlocked, asking for the password over the page when needed, and
// locks the page again after an hour without use. Resolves false when you
// sign out from the lock screen instead.
export async function requireUnlock(auth, user) {
  if (!isUnlocked(user.uid) && !(await lockScreen(auth, user))) return false;
  markUnlocked(user.uid);
  keepWatching(auth, user);
  return true;
}

function keepWatching(auth, user) {
  watchAdminLock(user.uid, async () => {
    if (await lockScreen(auth, user)) { markUnlocked(user.uid); keepWatching(auth, user); }
  });
}

const CSS = `
.sfl { position: fixed; inset: 0; z-index: 10000; background: #F7F2EA; display: flex; align-items: center; justify-content: center; padding: 16px; overflow-y: auto; }
.sfl-card { background: #fff; border: 1px solid rgba(26,18,8,0.12); border-radius: 16px; padding: 1.5rem; width: 100%; max-width: 380px; box-shadow: 0 10px 40px rgba(26,18,8,0.08); font-family: 'DM Sans', system-ui, sans-serif; color: #1A1208; }
.sfl-card h2 { font-family: 'Playfair Display', Georgia, serif; font-size: 1.5rem; margin: 0 0 0.4rem; }
.sfl-card p { color: #6B5D4D; font-size: 14px; line-height: 1.5; margin: 0 0 1rem; }
.sfl-card label { display: block; font-size: 13px; font-weight: 600; margin: 0 0 0.3rem; }
.sfl-card input { display: block; width: 100%; box-sizing: border-box; font: 16px 'DM Sans', system-ui, sans-serif; padding: 0.7rem 0.8rem; border: 1px solid rgba(26,18,8,0.2); border-radius: 10px; margin: 0 0 0.9rem; background: #fff; color: #1A1208; }
.sfl-card input[readonly] { background: #F7F2EA; color: #6B5D4D; }
.sfl-card input:focus { outline: 2px solid #D4521A; outline-offset: 1px; }
.sfl-go { display: block; width: 100%; border: 0; border-radius: 10px; background: #D4521A; color: #fff; font: 600 15px 'DM Sans', system-ui, sans-serif; padding: 0.8rem; cursor: pointer; }
.sfl-go:disabled { opacity: 0.6; cursor: default; }
.sfl-err { color: #A32323 !important; font-weight: 600; margin: 0.8rem 0 0 !important; }
.sfl-out { display: block; margin: 1rem auto 0; background: none; border: 0; color: #6B5D4D; font: 14px 'DM Sans', system-ui, sans-serif; text-decoration: underline; cursor: pointer; padding: 0.4rem; }
`;

let open = null;

// The lock screen over the page. Resolves true once the password is right,
// false when you sign out instead.
export function lockScreen(auth, user) {
  if (open) return open;
  if (!document.getElementById('sflStyle')) {
    const st = document.createElement('style');
    st.id = 'sflStyle'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const box = document.createElement('div');
  box.className = 'sfl';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'sflTitle');
  box.innerHTML = `
    <form class="sfl-card" novalidate>
      <h2 id="sflTitle">Enter your password</h2>
      <p>The admin locks after an hour without use, so nobody else can open it on this device.</p>
      <label for="sflEmail">Email</label>
      <input id="sflEmail" type="email" autocomplete="username" value="${esc(user.email)}"${user.email ? ' readonly' : ''}>
      <label for="sflPw">Password</label>
      <input id="sflPw" type="password" autocomplete="current-password" required>
      <button class="sfl-go" type="submit">Open the admin</button>
      <p class="sfl-err" role="alert" hidden></p>
      <button class="sfl-out" type="button">Sign out</button>
    </form>`;
  document.body.appendChild(box);
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  const $ = s => box.querySelector(s);
  setTimeout(() => $(user.email ? '#sflPw' : '#sflEmail').focus(), 50);

  open = new Promise(resolve => {
    const close = ok => {
      box.remove();
      document.documentElement.style.overflow = prevOverflow;
      window.removeEventListener('storage', onStorage);
      open = null;
      resolve(ok);
    };
    // Unlocked in another tab: this one opens too.
    const onStorage = () => { if (isUnlocked(user.uid)) close(true); };
    window.addEventListener('storage', onStorage);

    $('form').addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('#sflEmail').value.trim(), pw = $('#sflPw').value;
      const err = $('.sfl-err');
      err.hidden = true;
      if (!email || !pw) { err.textContent = 'Enter your password.'; err.hidden = false; return; }
      const btn = $('.sfl-go');
      btn.disabled = true; btn.textContent = 'Checking...';
      try {
        const u = await passwordUnlock(auth, email, pw);
        if (u.uid !== user.uid) { close(false); return; }
        markUnlocked(user.uid);
        close(true);
      } catch (ex) {
        console.log('Unlock failed:', ex && ex.code || ex);
        err.textContent = unlockError(ex); err.hidden = false;
        $('#sflPw').value = ''; $('#sflPw').focus();
        btn.disabled = false; btn.textContent = 'Open the admin';
      }
    });
    $('.sfl-out').addEventListener('click', async () => {
      lockAdmin();
      close(false);
      try { await signOut(auth); } catch (e) {}
    });
  });
  return open;
}

// Only admin pages on this site may be a ?next= target of admin.html.
export function safeNext(raw) {
  return raw && /^(admin-stats|admin-reports|admin-members|admin-home|admin-ads|admin-booking|admin-report|list-edit|guide-edit|dish-edit|correcties)\.html(\?[^#]*)?$/.test(raw) ? raw : null;
}

export function nextLink(page = location.pathname.split('/').pop() + location.search) {
  const n = safeNext(page);
  return n ? `admin.html?next=${encodeURIComponent(n)}` : 'admin.html';
}
