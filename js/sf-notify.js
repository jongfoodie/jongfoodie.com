// Strong Foodie: the notification bell 🔔 next to the account button, for
// signed-in members (loaded by js/sf-account-nav.js). Nothing is sent or
// stored per notification: the list is worked out when a page opens, from
// what is already in the database, for the last 30 days:
//   - a new follower                     (follows, followingId = you)
//   - a new member review of a place on your wishlist (userReviews)
//   - a new guide                        (guides, published; publishedAt)
//   - a new battle, and a battle's result (battles)
// Only "when did I last look" is stored, so the red badge shows what is new:
//   profiles/{uid}/settings/notifications: { seenAt }
// The app reads and writes the same document (Rork batch 18), so what you
// have seen on one is seen on the other.

import { collection, getDocs, doc, getDoc, setDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { loadFlags, isBlocked } from "./sf-moderation.js?v=1";

export const WINDOW_DAYS = 30;
const DAY = 864e5;
const CACHE_MS = 5 * 60 * 1000;
const MAX = 30;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ms = v => (v && typeof v.toDate === 'function') ? v.toDate().getTime() : (v instanceof Date ? v.getTime() : (v ? (new Date(v).getTime() || 0) : 0));

export function timeAgo(t, now = Date.now()) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < DAY / 1000) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / (DAY / 1000));
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Battles: a live one is news when it started; an ended one when it ended.
export function battleItems(battles, names, since, now) {
  const out = [];
  battles.forEach(b => {
    const start = ms(b.start), end = ms(b.end);
    if (!start || !end || !b.a || !b.b) return;
    const title = esc(b.title || 'Battle');
    if (start <= now && now < end && start >= since) {
      out.push({ kind: 'battle', time: start, icon: '⚔️', html: `New battle: <b>${title}</b>. Vote now`, href: '/battle.html' });
    } else if (end <= now && end >= since) {
      const a = Math.max(0, Number(b.votesA) || 0), c = Math.max(0, Number(b.votesB) || 0);
      const win = a === c ? '' : (a > c ? (names.get(b.a) || b.aName) : (names.get(b.b) || b.bName));
      out.push({ kind: 'battle', time: end, icon: '👑', html: win ? `<b>${esc(win)}</b> won the battle <b>${title}</b>` : `The battle <b>${title}</b> ended in a draw`, href: '/battle.html' });
    }
  });
  return out;
}

export function guideItems(guides, since) {
  return guides
    .map(g => ({ g, t: ms(g.publishedAt) || ms(g.createdAt) }))
    .filter(({ g, t }) => g.status === 'published' && g.title && typeof g.slug === 'string' && /^[a-z0-9-]{1,80}$/.test(g.slug) && t >= since)
    .map(({ g, t }) => ({ kind: 'guide', time: t, icon: '📖', html: `New guide: <b>${esc(g.title)}</b>`, href: `/guide/${g.slug}/` }));
}

// Everything for one member, newest first, at most 30.
export async function collectNotifications(db, uid, now = Date.now()) {
  const since = now - WINDOW_DAYS * DAY;
  const flags = await loadFlags(db);
  const people = new Map();
  async function person(id) {
    if (!people.has(id)) {
      people.set(id, getDoc(doc(db, 'profiles', id))
        .then(s => s.exists() ? { name: s.data().displayName || 'A member', priv: s.data().isPrivate === true } : null)
        .catch(() => null));
    }
    return people.get(id);
  }
  const ok = id => id && id !== uid && !isBlocked(flags, id);

  async function followers() {
    const s = await getDocs(query(collection(db, 'follows'), where('followingId', '==', uid)));
    const rows = s.docs.map(d => d.data()).filter(f => ok(f.followerId) && ms(f.createdAt) >= since)
      .sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 20);
    const out = [];
    for (const f of rows) {
      const p = await person(f.followerId);
      if (!p) continue;
      out.push({ kind: 'follow', time: ms(f.createdAt), icon: '👤', html: `<b>${esc(p.name)}</b> started following you`, href: `/member.html?u=${encodeURIComponent(f.followerId)}` });
    }
    return out;
  }

  // Reviews by other members of places on your wishlist. Reviews hidden by
  // Strong Foodie, by blocked members or by private accounts are left out,
  // the same as on the place itself.
  async function wishlistReviews() {
    const w = await getDocs(collection(db, 'profiles', uid, 'wishlistItems'));
    const wish = new Map();
    w.docs.map(d => d.data()).forEach(x => { if (x.kind === 'place' && x.placeDocId && x.placeCollection) wish.set(x.placeDocId, x); });
    const ids = [...wish.keys()];
    const rows = [];
    for (let i = 0; i < ids.length; i += 30) {
      const s = await getDocs(query(collection(db, 'userReviews'), where('placeDocId', 'in', ids.slice(i, i + 30))));
      s.docs.forEach(d => rows.push(d.data()));
    }
    const fresh = rows.filter(r => {
      const x = wish.get(r.placeDocId);
      return x && (!r.placeCollection || r.placeCollection === x.placeCollection) && ok(r.authorId)
        && r.hidden !== true && typeof r.rating === 'number' && ms(r.createdAt) >= since;
    }).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 20);
    const out = [];
    for (const r of fresh) {
      const p = await person(r.authorId);
      if (!p || p.priv) continue;
      const x = wish.get(r.placeDocId);
      out.push({ kind: 'review', time: ms(r.createdAt), icon: '⭐', html: `<b>${esc(p.name)}</b> reviewed <b>${esc(x.placeName || r.placeName || 'a place')}</b> on your wishlist · ★ ${esc(r.rating)}`,
        href: `/plek.html?c=${encodeURIComponent(x.placeCollection)}&id=${encodeURIComponent(r.placeDocId)}` });
    }
    return out;
  }

  async function guides() {
    const s = await getDocs(query(collection(db, 'guides'), where('status', '==', 'published')));
    return guideItems(s.docs.map(d => d.data()), since);
  }

  async function battles() {
    const s = await getDocs(collection(db, 'battles'));
    const list = s.docs.map(d => d.data());
    return battleItems(list, new Map(), since, now);
  }

  const parts = await Promise.allSettled([followers(), wishlistReviews(), guides(), battles()]);
  parts.forEach(p => { if (p.status === 'rejected') console.log('Notifications: part not loaded:', p.reason && (p.reason.code || p.reason)); });
  return parts.flatMap(p => p.status === 'fulfilled' ? p.value : [])
    .filter(x => x.time && x.time <= now + 60000)
    .sort((a, b) => b.time - a.time).slice(0, MAX);
}

export const unreadCount = (items, seenAt) => items.filter(x => x.time > (seenAt || 0)).length;

// ── The bell ────────────────────────────────────────────────────────────
const CSS = `
.sf-bell-wrap { position: relative; display: inline-flex; margin-right: 8px; }
.sf-bell { position: relative; width: 36px; height: 36px; border-radius: 50%; border: 1px solid rgba(26,18,8,0.15); background: #FFFDF9; font-size: 16px; line-height: 1; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.sf-bell:hover, .sf-bell[aria-expanded="true"] { border-color: #D4521A; }
.sf-bell-dot { position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #D4521A; color: #fff; font: 700 11px/18px 'DM Sans', system-ui, sans-serif; text-align: center; box-shadow: 0 0 0 2px #FFFDF9; }
.sf-bell-dot[hidden] { display: none; }
.sf-bell-panel { position: absolute; top: calc(100% + 10px); right: 0; width: 340px; max-width: calc(100vw - 32px); max-height: min(70vh, 520px); overflow-y: auto; background: #FFFDF9; border: 1px solid rgba(26,18,8,0.12); border-radius: 16px; box-shadow: 0 16px 48px rgba(26,18,8,0.18); z-index: 10002; font-family: 'DM Sans', system-ui, sans-serif; color: #1A1208; text-align: left; }
.sf-bell-panel[hidden] { display: none; }
.sf-n-head { display: flex; justify-content: space-between; align-items: baseline; padding: 0.85rem 1rem 0.6rem; border-bottom: 1px solid rgba(26,18,8,0.08); }
.sf-n-head h2 { font: 700 1.1rem 'Playfair Display', Georgia, serif; margin: 0; }
.sf-n-head span { font-size: 12px; color: #8A7A66; }
.sf-n-list { list-style: none; margin: 0; padding: 0.3rem 0; }
.sf-n-item { display: flex; gap: 0.7rem; align-items: flex-start; padding: 0.65rem 1rem; text-decoration: none; color: #1A1208; font-size: 14px; line-height: 1.4; }
.sf-n-item:hover { background: #FBF3EF; }
.sf-n-item.unread { background: #FBF3EF; }
.sf-n-item.unread .sf-n-time::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #D4521A; margin-right: 5px; vertical-align: 1px; }
.sf-n-icon { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%; background: #F0EBE3; display: inline-flex; align-items: center; justify-content: center; font-size: 15px; }
.sf-n-text { min-width: 0; overflow-wrap: anywhere; }
.sf-n-time { display: block; font-size: 12px; color: #8A7A66; margin-top: 2px; }
.sf-n-empty { padding: 1rem; font-size: 14px; color: #3D2F1A; line-height: 1.5; margin: 0; }
@media (max-width: 600px) {
  .sf-bell-wrap { position: static; margin-right: 6px; }
  .sf-bell { width: 34px; height: 34px; }
  .sf-bell-panel { position: fixed; top: 64px; left: 16px; right: 16px; width: auto; max-width: none; }
}`;

let mounted = null;

export function unmountBell() {
  if (!mounted) return;
  mounted.destroy();
  mounted = null;
}

// anchor: the account button; the bell goes just before it.
export function mountBell({ db, uid, anchor }) {
  if (mounted && mounted.uid === uid) return;
  unmountBell();
  if (!anchor || !anchor.parentNode) return;
  if (!document.getElementById('sfBellStyle')) {
    const st = document.createElement('style');
    st.id = 'sfBellStyle'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  const wrap = document.createElement('div');
  wrap.className = 'sf-bell-wrap';
  wrap.innerHTML = `<button class="sf-bell" type="button" aria-expanded="false" aria-controls="sfBellPanel" aria-label="Notifications">🔔<span class="sf-bell-dot" hidden></span></button>
    <div class="sf-bell-panel" id="sfBellPanel" role="region" aria-label="Notifications" hidden></div>`;
  anchor.parentNode.insertBefore(wrap, anchor);
  const btn = wrap.querySelector('.sf-bell'), dot = wrap.querySelector('.sf-bell-dot'), panel = wrap.querySelector('.sf-bell-panel');
  const cacheKey = 'sf_notif_' + uid;
  let items = null, seenAt = 0, shownSeen = 0, alive = true;

  function badge() {
    const n = items ? unreadCount(items, seenAt) : 0;
    dot.hidden = !n;
    dot.textContent = n > 9 ? '9+' : String(n);
    btn.setAttribute('aria-label', n ? `Notifications, ${n} new` : 'Notifications');
  }
  function render() {
    if (!items) { panel.innerHTML = '<div class="sf-n-head"><h2>Notifications</h2></div><p class="sf-n-empty">Loading…</p>'; return; }
    const now = Date.now();
    panel.innerHTML = `<div class="sf-n-head"><h2>Notifications</h2><span>Last ${WINDOW_DAYS} days</span></div>`
      + (items.length ? `<ul class="sf-n-list">${items.map(x => `<li><a class="sf-n-item${x.time > shownSeen ? ' unread' : ''}" href="${esc(x.href)}"><span class="sf-n-icon" aria-hidden="true">${x.icon}</span><span class="sf-n-text">${x.html}<span class="sf-n-time">${esc(timeAgo(x.time, now))}</span></span></a></li>`).join('')}</ul>`
        : '<p class="sf-n-empty">Nothing new yet. Follow members and save places to your wishlist: new followers, reviews of those places, new guides and battles show up here.</p>');
  }
  function saveCache() {
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), items, seenAt })); } catch (e) {}
  }

  async function load() {
    try {
      const c = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      if (c && Date.now() - c.t < CACHE_MS && Array.isArray(c.items)) { items = c.items; seenAt = c.seenAt || 0; badge(); return; }
    } catch (e) {}
    const [list, seen] = await Promise.all([
      collectNotifications(db, uid).catch(e => { console.log('Notifications not loaded:', e.code || e); return []; }),
      getDoc(doc(db, 'profiles', uid, 'settings', 'notifications')).then(s => s.exists() ? ms(s.data().seenAt) : 0).catch(() => 0),
    ]);
    if (!alive) return;
    items = list; seenAt = Math.max(seenAt, seen);
    saveCache();
    badge();
    // Opened while loading: show what is new now, and mark it as seen.
    if (!panel.hidden) { shownSeen = seenAt; render(); markSeen(); }
  }

  async function markSeen() {
    if (!items || !unreadCount(items, seenAt)) return;
    seenAt = Date.now();
    saveCache();
    badge();
    try { await setDoc(doc(db, 'profiles', uid, 'settings', 'notifications'), { seenAt: serverTimestamp() }, { merge: true }); }
    catch (e) { console.log('Seen not saved:', e.code || e); }
  }

  // Keeps the panel on the screen: under the bar on phones, and never past
  // the left edge when the bell sits on the left.
  function place() {
    panel.style.left = ''; panel.style.right = ''; panel.style.top = '';
    if (window.matchMedia('(max-width: 600px)').matches) {
      const nav = wrap.closest('nav');
      panel.style.top = Math.round((nav ? nav.getBoundingClientRect().bottom : btn.getBoundingClientRect().bottom) + 6) + 'px';
      return;
    }
    if (panel.getBoundingClientRect().left < 8) { panel.style.right = 'auto'; panel.style.left = '0'; }
  }

  // Opening the bell marks everything as seen, here and in the app.
  function open() {
    shownSeen = seenAt;
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    render();
    place();
    markSeen();
  }
  function close(focus = false) {
    if (panel.hidden) return;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focus) btn.focus();
  }
  btn.addEventListener('click', e => { e.stopPropagation(); panel.hidden ? open() : close(); });
  const onDoc = e => { if (!wrap.contains(e.target)) close(); };
  const onKey = e => { if (e.key === 'Escape') close(true); };
  document.addEventListener('click', onDoc);
  document.addEventListener('keydown', onKey);

  mounted = { uid, destroy() { alive = false; document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); wrap.remove(); } };
  load();
}
