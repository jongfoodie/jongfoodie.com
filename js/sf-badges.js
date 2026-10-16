// Strong Foodie: badges members earn, shown on their profile (member.html) and,
// with how far along they are, on their account page. Worked out from what is
// already public: reviews, spots, the cities of those, followers and public
// lists. Nothing is stored. The app shows the same badges (Rork batch 19).
//
// A new badge is celebrated once, with a sheet that slides up (app build 25):
// checkBadges() runs from the navigation on every page (at most every 30
// minutes), on the account page and right after posting a review. Which
// badges were already celebrated is kept in this browser only
// (celebratedBadges.{uid}); the very first check only records what you have.

import { collection, query, where, getDocs, getDoc, doc, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { esc, normalise } from "./sf-core.js?v=3";

// stat: which number counts; goal: how many are needed.
export const BADGES = [
  { id: 'first-review', emoji: '✍️', name: 'First review', stat: 'reviews', goal: 1, how: 'Write your first review' },
  { id: 'reviewer', emoji: '⭐', name: 'Reviewer', stat: 'reviews', goal: 10, how: 'Write 10 reviews' },
  { id: 'critic', emoji: '🏅', name: 'Critic', stat: 'reviews', goal: 25, how: 'Write 25 reviews' },
  { id: 'scout', emoji: '📍', name: 'Scout', stat: 'spots', goal: 5, how: 'Add 5 spots' },
  { id: 'explorer', emoji: '🧭', name: 'Explorer', stat: 'cities', goal: 5, how: 'Review or add places in 5 cities' },
  { id: 'list-maker', emoji: '📝', name: 'List maker', stat: 'lists', goal: 1, how: 'Make a public list' },
  { id: 'trendsetter', emoji: '🔥', name: 'Trendsetter', stat: 'followers', goal: 10, how: 'Get 10 followers' },
];

export const earned = stats => BADGES.filter(b => (Number(stats[b.stat]) || 0) >= b.goal);

const CSS = `
.sf-badges { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.75rem; }
.sf-badge { display: inline-flex; align-items: center; gap: 5px; background: #FBF3EF; color: #3D2F1A; border: 1px solid rgba(212,82,26,0.25); border-radius: 20px; padding: 4px 11px; font: 600 12.5px 'DM Sans', system-ui, sans-serif; white-space: nowrap; }
.sf-badge-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.6rem; }
.sf-bcard { border: 1px solid rgba(26,18,8,0.1); border-radius: 14px; padding: 0.75rem; background: #fff; display: flex; flex-direction: column; gap: 0.25rem; }
.sf-bcard.off { background: #FAF7F2; }
.sf-bcard.off .sf-bemoji { filter: grayscale(1); opacity: 0.55; }
.sf-bemoji { font-size: 24px; line-height: 1; }
.sf-bname { font: 700 14px 'DM Sans', system-ui, sans-serif; color: #1A1208; }
.sf-bhow { font-size: 12px; color: #8A7A66; line-height: 1.4; }
.sf-bbar { height: 6px; border-radius: 4px; background: #EFE8DC; overflow: hidden; margin-top: 0.25rem; }
.sf-bbar span { display: block; height: 100%; background: #D4521A; border-radius: 4px; }
.sf-bdone { font-size: 12px; color: #2D5A3D; font-weight: 700; }
`;
function addStyle() {
  if (document.getElementById('sfBadgeStyle')) return;
  const s = document.createElement('style');
  s.id = 'sfBadgeStyle'; s.textContent = CSS;
  document.head.appendChild(s);
}

// The earned badges as a row of chips (empty when there are none).
export function badgeRow(stats) {
  const got = earned(stats);
  if (!got.length) return '';
  addStyle();
  return `<div class="sf-badges" aria-label="Badges">${got.map(b => `<span class="sf-badge" title="${esc(b.how)}"><span aria-hidden="true">${b.emoji}</span>${esc(b.name)}</span>`).join('')}</div>`;
}

// Every badge with progress, for the member's own account page.
export function badgeProgress(stats) {
  addStyle();
  return `<div class="sf-badge-list">${BADGES.map(b => {
    const n = Math.max(0, Number(stats[b.stat]) || 0), done = n >= b.goal;
    return `<div class="sf-bcard${done ? '' : ' off'}"><span class="sf-bemoji" aria-hidden="true">${b.emoji}</span>
      <span class="sf-bname">${esc(b.name)}</span><span class="sf-bhow">${esc(b.how)}</span>
      ${done ? '<span class="sf-bdone">✓ Earned</span>' : `<div class="sf-bbar" role="img" aria-label="${Math.min(n, b.goal)} of ${b.goal}"><span style="width:${Math.round(Math.min(n, b.goal) / b.goal * 100)}%"></span></div><span class="sf-bhow">${Math.min(n, b.goal)} of ${b.goal}</span>`}
    </div>`;
  }).join('')}</div>`;
}

// The numbers for one member, read from the database (account.html).
// member.html works them out from what it already loaded.
export async function memberStats(db, uid) {
  const [spots, reviews, followers, lists] = await Promise.all([
    getDocs(query(collection(db, 'userPlaces'), where('addedByUserId', '==', uid))).then(s => s.docs.map(d => d.data()).filter(r => r.name && r.hidden !== true)).catch(() => []),
    getDocs(query(collection(db, 'userReviews'), where('authorId', '==', uid))).then(s => s.docs.map(d => d.data()).filter(r => typeof r.rating === 'number' && r.rating > 0 && r.hidden !== true)).catch(() => []),
    // Followers: every follow minus requests still waiting for a private account.
    Promise.all([
      getCountFromServer(query(collection(db, 'follows'), where('followingId', '==', uid))).then(s => s.data().count),
      getCountFromServer(query(collection(db, 'follows'), where('followingId', '==', uid), where('status', '==', 'pending'))).then(s => s.data().count).catch(() => 0),
    ]).then(([all, waiting]) => Math.max(0, all - waiting)).catch(() => 0),
    getDocs(query(collection(db, 'memberLists'), where('authorId', '==', uid), where('status', '==', 'published'), where('hidden', '==', false))).then(s => s.size).catch(() => 0),
  ]);
  const cities = new Set(spots.map(r => normalise('userPlaces', 'x', r, true).destination).filter(Boolean));
  const seen = new Set();
  await Promise.all(reviews.slice(0, 60).map(async r => {
    if (!r.placeCollection || !r.placeDocId || seen.has(r.placeCollection + r.placeDocId)) return;
    seen.add(r.placeCollection + r.placeDocId);
    try {
      const s = await getDoc(doc(db, r.placeCollection, r.placeDocId));
      if (s.exists()) { const d = normalise(r.placeCollection, s.id, s.data(), r.placeCollection === 'userPlaces').destination; if (d) cities.add(d); }
    } catch (e) {}
  }));
  return { reviews: reviews.length, spots: spots.length, cities: cities.size, followers, lists };
}


// ── Badge celebration (app build 25) ──────────────────────────────────────
const CEL_CSS = `
.sf-cel { position: fixed; inset: 0; z-index: 10050; background: rgba(26,18,8,0.45); display: flex; align-items: flex-end; justify-content: center; padding: 0 12px; animation: sfCelFade 0.2s ease both; }
.sf-cel-sheet { position: relative; width: 100%; max-width: 420px; background: #FFFDF9; border-radius: 24px 24px 0 0; padding: 1.75rem 1.5rem calc(1.5rem + env(safe-area-inset-bottom)); text-align: center; box-shadow: 0 -10px 40px rgba(26,18,8,0.25); animation: sfCelUp 0.35s cubic-bezier(.2,.9,.3,1.2) both; font-family: 'DM Sans', system-ui, sans-serif; }
@media (min-width: 640px) { .sf-cel { align-items: center; } .sf-cel-sheet { border-radius: 24px; } }
.sf-cel-burst { position: relative; width: 120px; height: 120px; margin: 0 auto 0.5rem; }
.sf-cel-emoji { position: absolute; inset: 18px; border-radius: 50%; background: #FBEDE4; display: flex; align-items: center; justify-content: center; font-size: 46px; animation: sfCelPop 0.55s cubic-bezier(.2,1.6,.4,1) 0.1s both; }
.sf-cel-dot { position: absolute; left: 50%; top: 50%; width: 9px; height: 9px; margin: -4.5px; border-radius: 50%; opacity: 0; animation: sfCelDot 0.9s ease-out 0.15s both; }
.sf-cel-kicker { font-size: 11.5px; font-weight: 700; letter-spacing: 0.16em; color: #D4521A; margin: 0 0 0.25rem; }
.sf-cel-name { font-family: 'Playfair Display', Georgia, serif; font-size: 1.6rem; color: #1A1208; margin: 0 0 0.35rem; line-height: 1.2; }
.sf-cel-how { font-size: 15px; color: #5A4A36; margin: 0 0 1.25rem; line-height: 1.5; }
.sf-cel-btn { width: 100%; min-height: 48px; border: none; border-radius: 24px; background: #D4521A; color: #fff; font: 600 15.5px 'DM Sans', system-ui, sans-serif; cursor: pointer; }
.sf-cel-btn:focus-visible { outline: 3px solid #1A1208; outline-offset: 2px; }
@keyframes sfCelFade { from { opacity: 0; } }
@keyframes sfCelUp { from { transform: translateY(40px); opacity: 0; } }
@keyframes sfCelPop { 0% { transform: scale(0.2); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
@keyframes sfCelDot { 0% { transform: translate(0, 0) scale(0.6); opacity: 1; } 80% { opacity: 1; } 100% { transform: translate(var(--x), var(--y)) scale(1); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .sf-cel, .sf-cel-sheet, .sf-cel-emoji { animation: none; } .sf-cel-dot { display: none; } }
`;
function addCelStyle() {
  if (document.getElementById('sfCelStyle')) return;
  const s = document.createElement('style');
  s.id = 'sfCelStyle'; s.textContent = CEL_CSS;
  document.head.appendChild(s);
}

// Show the sheet for each badge, one after another.
export function celebrate(list) {
  const b = list && list[0];
  if (!b || typeof document === 'undefined') return;
  addCelStyle();
  const colors = ['#D4521A', '#C8901A', '#2D7A46', '#6B2A5C', '#2F5D7C', '#E8A23A'];
  const dots = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2, r = 54 + (i % 3) * 8;
    return `<i class="sf-cel-dot" style="background:${colors[i % colors.length]};--x:${Math.round(Math.cos(a) * r)}px;--y:${Math.round(Math.sin(a) * r)}px;"></i>`;
  }).join('');
  const prev = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'sf-cel';
  wrap.innerHTML = `<div class="sf-cel-sheet" role="dialog" aria-modal="true" aria-labelledby="sfCelName">
    <div class="sf-cel-burst" aria-hidden="true">${dots}<span class="sf-cel-emoji">${b.emoji}</span></div>
    <p class="sf-cel-kicker">BADGE EARNED</p>
    <h2 class="sf-cel-name" id="sfCelName">${esc(b.name)}</h2>
    <p class="sf-cel-how">${esc(b.how)}. Nice one.</p>
    <button type="button" class="sf-cel-btn">Keep going</button>
  </div>`;
  document.body.appendChild(wrap);
  // A short buzz on phones that allow it (only after the visitor has tapped the page).
  try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate([18, 40, 28]); } catch (e) {}
  const btn = wrap.querySelector('.sf-cel-btn');
  btn.focus();
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    document.removeEventListener('keydown', onKey);
    wrap.remove();
    if (prev && prev.focus) { try { prev.focus(); } catch (e) {} }
    if (list.length > 1) setTimeout(() => celebrate(list.slice(1)), 250);
  };
  const onKey = e => { if (e.key === 'Escape') close(); if (e.key === 'Tab') { e.preventDefault(); btn.focus(); } };
  document.addEventListener('keydown', onKey);
  btn.addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
}

// Look for badges that are new since the last check, and celebrate them.
// force: check now (after posting a review). stats: numbers already worked out (account.html).
export async function checkBadges(db, uid, { force = false, stats = null } = {}) {
  if (!uid) return;
  const tkey = 'sfBadgeCheck.' + uid;
  if (!force && !stats) {
    try { if (Date.now() - (+localStorage.getItem(tkey) || 0) < 30 * 60e3) return; } catch (e) {}
  }
  try { localStorage.setItem(tkey, String(Date.now())); } catch (e) {}
  const st = stats || await memberStats(db, uid);
  const have = earned(st).map(b => b.id);
  const key = 'celebratedBadges.' + uid;
  let seen;
  try { seen = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return; }
  const save = ids => { try { localStorage.setItem(key, JSON.stringify(ids)); } catch (e) {} };
  // The very first check in this browser only records what you already have.
  if (!Array.isArray(seen)) { save(have); return; }
  const fresh = have.filter(id => !seen.includes(id));
  if (!fresh.length) return;
  save([...new Set([...seen, ...have])]);
  celebrate(fresh.map(id => BADGES.find(b => b.id === id)).filter(Boolean));
}
