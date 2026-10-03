// Strong Foodie: "Surprise me". Picks a random place worth going to from the
// places the page already loaded: rated 4 or higher by Strong Foodie, open,
// optionally one category. On the homepage it picks from everywhere, on a
// destination page from that city. The last few picks are skipped, so "Spin
// again" never shows the same place twice in a row. Nothing is stored.
// The app does the same (Rork batch 17).

import { CATS, esc, miniCard, placeUrl, placeKey } from "./sf-places.js?v=7";

const SEEN_KEY = 'sf_surprise_seen';
const MIN_RATING = 4;

export function surprisePool(places, cat = '') {
  return places.filter(p => !p.member && !p.closed && p.rating >= MIN_RATING && (!cat || p.cat === cat));
}

function seen() {
  try { return JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]'); } catch (e) { return []; }
}
function remember(key) {
  try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([key, ...seen().filter(k => k !== key)].slice(0, 8))); } catch (e) {}
}

// A random place from the pool, not one of the last picks when there is a choice.
export function pickSurprise(pool, random = Math.random) {
  if (!pool.length) return null;
  const recent = new Set(seen());
  const fresh = pool.filter(p => !recent.has(placeKey(p)));
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(random() * from.length)] || from[0];
}

const CSS = `
.sp-back { position: fixed; inset: 0; z-index: 10001; background: rgba(26,18,8,0.55); display: flex; align-items: flex-end; justify-content: center; padding: 16px; }
@media (min-width: 640px) { .sp-back { align-items: center; } }
.sp-sheet { background: #FFFDF9; border-radius: 20px; width: 100%; max-width: 420px; max-height: calc(100vh - 32px); overflow-y: auto; padding: 1.25rem; box-shadow: 0 20px 60px rgba(26,18,8,0.3); font-family: 'DM Sans', system-ui, sans-serif; color: #1A1208; position: relative; }
.sp-sheet h2 { font-family: 'Playfair Display', Georgia, serif; font-size: 1.5rem; margin: 0 2rem 0.25rem 0; }
.sp-sub { color: #8A7A66; font-size: 13.5px; line-height: 1.5; margin: 0 0 0.8rem; }
.sp-close { position: absolute; top: 0.8rem; right: 0.8rem; width: 36px; height: 36px; border-radius: 50%; border: 1px solid rgba(26,18,8,0.12); background: #fff; font-size: 16px; cursor: pointer; color: #1A1208; }
.sp-chips { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.9rem; }
.sp-chip { border: 1px solid rgba(26,18,8,0.14); background: #fff; border-radius: 20px; padding: 6px 12px; font: 500 13px 'DM Sans', system-ui, sans-serif; cursor: pointer; color: #3D2F1A; }
.sp-chip[aria-pressed="true"] { background: #1A1208; border-color: #1A1208; color: #fff; }
.sp-card .mini-card { display: block; margin: 0; }
.sp-spin { min-height: 120px; display: flex; align-items: center; justify-content: center; text-align: center; font-family: 'Playfair Display', Georgia, serif; font-size: 1.4rem; color: #D4521A; padding: 1rem; border: 1px dashed rgba(26,18,8,0.15); border-radius: 14px; }
.sp-actions { display: flex; gap: 0.5rem; margin-top: 0.9rem; flex-wrap: wrap; }
.sp-go { flex: 1 1 auto; text-align: center; background: #D4521A; color: #fff; text-decoration: none; border-radius: 24px; padding: 11px 16px; font-weight: 600; font-size: 14.5px; }
.sp-again { flex: 0 0 auto; border: 1px solid rgba(26,18,8,0.15); background: #fff; color: #1A1208; border-radius: 24px; padding: 11px 16px; font: 600 14.5px 'DM Sans', system-ui, sans-serif; cursor: pointer; }
.sp-empty { color: #3D2F1A; font-size: 14px; line-height: 1.5; padding: 1rem 0; }
`;

function addStyle() {
  if (document.getElementById('sfSurpriseStyle')) return;
  const s = document.createElement('style');
  s.id = 'sfSurpriseStyle'; s.textContent = CSS;
  document.head.appendChild(s);
}

// Opens the sheet. places: what the page loaded. where: "Amsterdam" on a city page.
export function openSurprise({ places, where = '', hydratePhotos = () => {} }) {
  addStyle();
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cats = Object.keys(CATS).filter(k => surprisePool(places, k).length);
  let cat = '', timer = null;
  const opener = document.activeElement;
  const back = document.createElement('div');
  back.className = 'sp-back';
  back.innerHTML = `
    <div class="sp-sheet" role="dialog" aria-modal="true" aria-labelledby="spTitle">
      <button class="sp-close" type="button" aria-label="Close">✕</button>
      <h2 id="spTitle">🎲 Surprise me</h2>
      <p class="sp-sub">A random place we rated 4 or higher${where ? ' in ' + esc(where) : ''}. Not feeling it? Spin again.</p>
      ${cats.length > 1 ? `<div class="sp-chips" role="group" aria-label="Category">
        <button class="sp-chip" type="button" data-cat="" aria-pressed="true">All</button>
        ${cats.map(k => `<button class="sp-chip" type="button" data-cat="${k}" aria-pressed="false">${CATS[k].emoji} ${CATS[k].label}</button>`).join('')}
      </div>` : ''}
      <div class="sp-card" id="spCard" aria-live="polite"></div>
      <div class="sp-actions" id="spActions"></div>
    </div>`;
  document.body.appendChild(back);
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  const $ = s => back.querySelector(s);

  function close() {
    clearInterval(timer);
    back.remove();
    document.documentElement.style.overflow = prevOverflow;
    document.removeEventListener('keydown', onKey);
    if (opener && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  }
  // Escape closes; Tab stays inside the sheet.
  function onKey(e) {
    if (e.key === 'Escape') return close();
    if (e.key !== 'Tab') return;
    const items = [...back.querySelectorAll('button, a[href]')].filter(x => !x.disabled && x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !back.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', e => { if (e.target === back) close(); });
  $('.sp-close').addEventListener('click', close);

  function show(p) {
    const card = $('#spCard'), actions = $('#spActions');
    if (!p) {
      card.removeAttribute('aria-busy');
      card.innerHTML = '<p class="sp-empty">No place to pick yet. Try another category.</p>';
      actions.innerHTML = '';
      return;
    }
    card.removeAttribute('aria-busy');
    remember(placeKey(p));
    card.innerHTML = miniCard(p);
    hydratePhotos(card);
    actions.innerHTML = `<a class="sp-go" href="${esc(placeUrl(p))}">Take me there →</a><button class="sp-again" type="button">🎲 Spin again</button>`;
    actions.querySelector('.sp-again').addEventListener('click', spin);
    actions.querySelector('.sp-go').focus({ preventScroll: true });
  }

  function spin() {
    clearInterval(timer);
    const pool = surprisePool(places, cat);
    const p = pickSurprise(pool);
    if (!p || reduce || pool.length < 3) return show(p);
    // A short spin through names before landing on the pick.
    const card = $('#spCard');
    let n = 0;
    card.setAttribute('aria-busy', 'true');
    card.innerHTML = '<div class="sp-spin" aria-hidden="true"></div>';
    const box = card.firstChild;
    timer = setInterval(() => {
      box.textContent = pool[Math.floor(Math.random() * pool.length)].name;
      if (++n >= 8) { clearInterval(timer); show(p); }
    }, 70);
  }

  back.querySelectorAll('.sp-chip').forEach(b => b.addEventListener('click', () => {
    cat = b.dataset.cat;
    back.querySelectorAll('.sp-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    spin();
  }));
  spin();
  return close;
}
