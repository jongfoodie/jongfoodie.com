// Strong Foodie: badges members earn, shown on their profile (member.html) and,
// with how far along they are, on their account page. Worked out from what is
// already public: reviews, spots, the cities of those, followers and public
// lists. Nothing is stored. The app shows the same badges (Rork batch 19).

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
    getCountFromServer(query(collection(db, 'follows'), where('followingId', '==', uid))).then(s => s.data().count).catch(() => 0),
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
