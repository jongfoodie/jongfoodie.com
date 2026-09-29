// Strong Foodie: highlights from the app, shown on the website.
//
// Reads the same `highlights` collection as the app. A row of round
// thumbnails opens a full-screen viewer, like Stories in the app.
//
//   import { highlightsRow } from './js/sf-highlights.js?v=1';
//   highlightsRow(db, element, { authorId })   // one member's highlights
//   highlightsRow(db, element, { placeId })    // highlights of one place
//   highlightsRow(db, element)                 // newest from everyone
//   ...{ ownerId: uid } adds a Delete button to that member's own highlights
//
// Same rules as the app (Instagram Stories):
// - a highlight is live for 24 hours after createdAt; the homepage shows
//   only live ones;
// - after that it is in the owner's archive in the app, unless the owner
//   pinned it (pinned: true): pinned ones stay on the profile and on the
//   place page for good.
//
// Photos are "fsimg://<id>" (a base64 image in `images`). Videos are
// "fsvid://<id>", stored in pieces that a web page cannot play yet, so a
// video shows its cover photo with "Watch it in the app".
// Highlights of private accounts are left out, except on your own profile.

import { collection, getDocs, doc, getDoc, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { CATS, esc, toDate, photoTools } from "./sf-places.js?v=3";
import { deleteHighlight, confirmTap } from "./sf-delete.js?v=1";

const COLLS = ['reviews', 'drinkspots', 'shopspots', 'culturespots', 'healthspots', 'hotelreviews', 'userPlaces'];
const COLOURS = ['#D4521A', '#2D5A3D', '#6B2A5C', '#2F5D7C', '#8A6A0A', '#A32323'];
const colourOf = s => COLOURS[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLOURS.length];
const initialsOf = name => String(name || '?').trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';

function ago(d) {
  if (!d) return '';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  if (s < 7 * 86400) { const n = Math.round(s / 86400); return n + (n === 1 ? ' day ago' : ' days ago'); }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Where a highlight links to: a place on Strong Foodie, or a web page.
function placeHref(h) {
  if (!h.placeId) return '';
  const pc = String(h.placeCategory || '').trim();
  const coll = COLLS.includes(pc) ? pc : (CATS[pc.toLowerCase()] ? CATS[pc.toLowerCase()].coll : '');
  return coll ? `plek.html?c=${encodeURIComponent(coll)}&id=${encodeURIComponent(h.placeId)}` : '';
}
const DAY = 24 * 60 * 60 * 1000;
export const isLive = h => { const d = toDate(h.createdAt); return !!d && Date.now() - d.getTime() < DAY; };
const safeUrl = u => /^https?:\/\/[^\s]+$/i.test(String(u || '')) ? String(u) : '';

const CSS = `
.hl-sec { margin-bottom: 2.25rem; }
.hl-label { font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: #8A7A66; padding-bottom: 0.75rem; border-bottom: 1px solid rgba(26,18,8,0.1); margin-bottom: 1rem; }
.hl-row { display: flex; gap: 0.9rem; overflow-x: auto; padding: 4px 2px 8px; scroll-snap-type: x proximity; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
.hl-row::-webkit-scrollbar { display: none; }
.hl-item { flex: 0 0 auto; width: 84px; background: none; border: none; padding: 0; cursor: pointer; font-family: inherit; color: #1A1208; scroll-snap-align: start; text-align: center; }
.hl-ring { display: block; width: 78px; height: 78px; margin: 0 auto; border-radius: 50%; padding: 3px; background: linear-gradient(135deg, #D4521A 0%, #C8901A 100%); position: relative; }
.hl-thumb { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; border-radius: 50%; border: 3px solid #FAF7F2; overflow: hidden; position: relative; font-size: 26px; color: #fff; }
.hl-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.hl-play { position: absolute; right: 0; bottom: 0; width: 24px; height: 24px; border-radius: 50%; background: #1A1208; color: #fff; font-size: 10px; display: flex; align-items: center; justify-content: center; border: 2px solid #FAF7F2; z-index: 1; }
.hl-cap { display: block; font-size: 12px; line-height: 1.3; margin-top: 0.4rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hl-by { display: block; font-size: 11px; color: #8A7A66; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hl-item:focus-visible .hl-ring { outline: 3px solid #1A1208; outline-offset: 2px; }

.hl-view { position: fixed; inset: 0; z-index: 20000; background: rgba(10,7,3,0.94); display: flex; align-items: center; justify-content: center; }
.hl-view[hidden] { display: none; }
.hl-card { position: relative; width: min(420px, 100vw); height: min(92vh, calc(min(420px, 100vw) * 16 / 9)); background: #1A1208; border-radius: 16px; overflow: hidden; color: #fff; }
.hl-media { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 64px; }
.hl-media img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.hl-shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.78) 100%); pointer-events: none; }
.hl-bars { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; gap: 4px; z-index: 3; }
.hl-bars span { flex: 1; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.35); }
.hl-bars span.on { background: #fff; }
.hl-top { position: absolute; top: 22px; left: 12px; right: 12px; display: flex; align-items: center; gap: 0.6rem; z-index: 3; }
.hl-av { width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; position: relative; overflow: hidden; border: 2px solid rgba(255,255,255,0.8); }
.hl-av img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.hl-who { min-width: 0; flex: 1; font-size: 13px; line-height: 1.3; }
.hl-who a { color: #fff; font-weight: 600; text-decoration: none; }
.hl-who a:hover { text-decoration: underline; }
.hl-who span { display: block; font-size: 11px; opacity: 0.8; }
.hl-del { border: none; background: rgba(0,0,0,0.4); color: #fff; border-radius: 16px; padding: 8px 12px; font: 600 12px 'DM Sans', sans-serif; cursor: pointer; flex-shrink: 0; }
.hl-del[data-armed] { background: #B3261E; }
.hl-del:disabled { opacity: 0.6; cursor: default; }
.hl-x { width: 38px; height: 38px; border-radius: 50%; border: none; background: rgba(0,0,0,0.35); color: #fff; font-size: 22px; line-height: 1; cursor: pointer; flex-shrink: 0; }
.hl-bottom { position: absolute; left: 16px; right: 16px; bottom: 18px; z-index: 3; }
.hl-title { font-family: 'Playfair Display', serif; font-size: 1.35rem; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
.hl-links { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.7rem; align-items: center; }
.hl-pill { font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; background: rgba(255,255,255,0.18); color: #fff; padding: 3px 9px; border-radius: 10px; }
.hl-go { font-size: 13px; font-weight: 600; color: #1A1208; background: #fff; border-radius: 18px; padding: 7px 14px; text-decoration: none; }
.hl-video-note { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 2; text-align: center; width: 80%; }
.hl-video-note b { display: flex; align-items: center; justify-content: center; width: 64px; height: 64px; margin: 0 auto 0.6rem; border-radius: 50%; background: rgba(0,0,0,0.55); border: 2px solid rgba(255,255,255,0.85); font-size: 24px; }
.hl-video-note span { font-size: 13px; background: rgba(0,0,0,0.55); padding: 5px 10px; border-radius: 12px; }
.hl-nav { position: absolute; top: 0; bottom: 0; width: 34%; z-index: 2; background: none; border: none; cursor: pointer; }
.hl-nav.prev { left: 0; } .hl-nav.next { right: 0; }
.hl-nav:focus-visible { outline: 3px solid #fff; outline-offset: -6px; }
.hl-arrow { position: absolute; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border-radius: 50%; border: none; background: rgba(255,255,255,0.9); color: #1A1208; font-size: 20px; cursor: pointer; z-index: 20001; }
.hl-arrow.prev { left: calc(50% - 210px - 64px); } .hl-arrow.next { right: calc(50% - 210px - 64px); }
.hl-arrow[hidden] { display: none; }
@media (max-width: 560px) {
  .hl-card { width: 100vw; height: 100dvh; border-radius: 0; }
  .hl-arrow { display: none; }
  .hl-item { width: 76px; }
  .hl-ring { width: 70px; height: 70px; }
}`;
function addStyle() {
  if (document.getElementById('hl-styles')) return;
  const s = document.createElement('style');
  s.id = 'hl-styles';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ── Viewer (one per page) ────────────────────────────────────────────────
let viewer = null;
function openViewer(list, start, resolvePhoto, ctx = {}) {
  addStyle();
  if (!viewer) {
    viewer = document.createElement('div');
    viewer.className = 'hl-view';
    viewer.hidden = true;
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-label', 'Highlight');
    document.body.appendChild(viewer);
  }
  const back = document.activeElement;
  let i = start;
  const prevOverflow = document.body.style.overflow;

  function close() {
    viewer.hidden = true;
    viewer.innerHTML = '';
    document.body.style.overflow = prevOverflow;
    document.removeEventListener('keydown', onKey);
    if (back && back.focus) back.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'Tab') {   // keep the focus inside the viewer
      const f = [...viewer.querySelectorAll('a[href], button:not([hidden])')].filter(el => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function go(step) {
    const n = i + step;
    if (n < 0) return;
    if (n >= list.length) { close(); return; }
    i = n; draw();
  }
  function draw() {
    const h = list[i];
    const cat = CATS[String(h.category || '').toLowerCase()];
    const place = placeHref(h);
    const link = h.linkType === 'url' ? safeUrl(h.linkUrl) : '';
    const video = h.mediaType === 'video';
    const who = h.authorName || 'Member';
    viewer.innerHTML = `
      <button class="hl-arrow prev" type="button" aria-label="Previous highlight"${i === 0 ? ' hidden' : ''}>‹</button>
      <div class="hl-card">
        <div class="hl-media" style="background:linear-gradient(135deg, ${cat ? cat.color : '#3D2F1A'} 0%, #1A1208 100%);">
          <span>${cat ? cat.emoji : '✨'}</span>
          ${h.photoUrl ? `<img id="hlImg" alt="${esc(h.title || '')}" hidden>` : ''}
        </div>
        <div class="hl-shade"></div>
        ${video ? `<div class="hl-video-note"><b aria-hidden="true">▶</b><span>Watch this video in the Strong Foodie app</span></div>` : ''}
        <button class="hl-nav prev" type="button" aria-label="Previous highlight"></button>
        <button class="hl-nav next" type="button" aria-label="${i === list.length - 1 ? 'Close' : 'Next highlight'}"></button>
        <div class="hl-bars" aria-hidden="true">${list.map((_, k) => `<span class="${k <= i ? 'on' : ''}"></span>`).join('')}</div>
        <div class="hl-top">
          <span class="hl-av" style="background:${colourOf(h.authorId || who)};">${esc(initialsOf(who))}${h.authorPhotoUrl ? '<img id="hlAv" alt="" hidden>' : ''}</span>
          <span class="hl-who">${h.authorId ? `<a href="member.html?u=${encodeURIComponent(h.authorId)}">${esc(who)}</a>` : esc(who)}<span>${isLive(h) ? esc(ago(toDate(h.createdAt))) : '📌 Pinned'}</span></span>
          ${ctx.ownerId && h.authorId === ctx.ownerId ? '<button class="hl-del" type="button">Delete</button>' : ''}
          <button class="hl-x" type="button" aria-label="Close">×</button>
        </div>
        <div class="hl-bottom">
          ${h.title ? `<p class="hl-title">${esc(h.title)}</p>` : ''}
          <div class="hl-links">
            ${cat ? `<span class="hl-pill">${cat.label}</span>` : ''}
            ${place ? `<a class="hl-go" href="${place}">${esc(h.placeName || 'View place')} →</a>` : (h.placeName ? `<span class="hl-pill">📍 ${esc(h.placeName)}</span>` : '')}
            ${link ? `<a class="hl-go" href="${esc(link)}" target="_blank" rel="noopener nofollow ugc">Open link ↗</a>` : ''}
          </div>
        </div>
      </div>
      <button class="hl-arrow next" type="button" aria-label="Next highlight"${i === list.length - 1 ? ' hidden' : ''}>›</button>`;
    viewer.querySelector('.hl-x').addEventListener('click', close);
    const del = viewer.querySelector('.hl-del');
    if (del) del.addEventListener('click', async () => {
      if (!confirmTap(del, 'Tap again to delete')) return;
      del.disabled = true; del.textContent = 'Deleting…';
      try {
        await deleteHighlight(ctx.db, h);
        list.splice(i, 1);
        if (ctx.onDeleted) ctx.onDeleted(h);
        if (!list.length) { close(); return; }
        if (i >= list.length) i = list.length - 1;
        draw();
      } catch (e) {
        console.log('Highlight not deleted:', e.code || e);
        delete del.dataset.armed; del.disabled = false;
        del.textContent = e && e.code === 'permission-denied' ? 'Delete it in the app' : 'Not deleted, try again';
      }
    });
    viewer.querySelectorAll('.prev').forEach(b => b.addEventListener('click', () => go(-1)));
    viewer.querySelectorAll('.next').forEach(b => b.addEventListener('click', () => go(1)));
    const img = viewer.querySelector('#hlImg');
    if (img) resolvePhoto(h.photoUrl).then(url => { if (url && img.isConnected) { img.onerror = () => img.remove(); img.src = url; img.hidden = false; } });
    const av = viewer.querySelector('#hlAv');
    if (av) resolvePhoto(h.authorPhotoUrl).then(url => { if (url && av.isConnected) { av.onerror = () => av.remove(); av.src = url; av.hidden = false; } });
    viewer.querySelector('.hl-x').focus();
  }
  viewer.onclick = e => { if (e.target === viewer) close(); };
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  viewer.hidden = false;
  draw();
}

// ── Loading ──────────────────────────────────────────────────────────────
const privateCache = new Map();
function isPrivate(db, uid) {
  if (!uid) return Promise.resolve(false);
  if (!privateCache.has(uid)) {
    privateCache.set(uid, getDoc(doc(db, 'profiles', uid))
      .then(s => s.exists() && s.data().isPrivate === true)
      .catch(() => false));
  }
  return privateCache.get(uid);
}

export async function loadHighlights(db, { authorId = '', placeId = '', max = 12, includePrivate = false } = {}) {
  const feed = !authorId && !placeId;
  const coll = collection(db, 'highlights');
  const q = authorId ? query(coll, where('authorId', '==', authorId))
    : placeId ? query(coll, where('placeId', '==', placeId))
    : query(coll, where('createdAt', '>', new Date(Date.now() - DAY)), orderBy('createdAt', 'desc'), limit(40));
  const snap = await getDocs(q);
  let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(h => h.active !== false && h.hidden !== true && (h.photoUrl || h.videoUrl))
    .filter(h => isLive(h) || (!feed && h.pinned === true));
  if (!includePrivate) {
    rows = rows.filter(h => h.authorIsPrivate !== true);
    const priv = await Promise.all(rows.map(h => isPrivate(db, h.authorId)));
    rows = rows.filter((h, k) => !priv[k]);
  }
  const t = h => (toDate(h.createdAt) || 0);
  // Live ones first (newest first), then pinned ones in the owner's order.
  rows.sort((a, b) => (isLive(b) - isLive(a))
    || (isLive(a) ? t(b) - t(a) : ((a.order ?? 0) - (b.order ?? 0) || t(b) - t(a))));
  return rows.slice(0, max);
}

// Renders the row into `el`, or leaves `el` empty when there is nothing to show.
export async function highlightsRow(db, el, opts = {}) {
  if (!el) return [];
  const { title = 'Highlights', showAuthor = !opts.authorId } = opts;
  let list = [];
  try { list = await loadHighlights(db, opts); }
  catch (e) { console.log('Highlights could not load:', e.code || e); }
  if (!list.length) { el.innerHTML = ''; el.hidden = true; return list; }
  addStyle();
  const { resolvePhoto } = photoTools(db);
  const ctx = { db, ownerId: opts.ownerId || '', onDeleted: () => renderRow() };
  function renderRow() {
  if (!list.length) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<section class="hl-sec" aria-label="${esc(title)}">
    <p class="hl-label">${esc(title)}</p>
    <div class="hl-row">${list.map((h, k) => {
      const cat = CATS[String(h.category || '').toLowerCase()];
      const label = [h.title || 'Highlight', h.mediaType === 'video' ? 'video' : '', showAuthor && h.authorName ? 'by ' + h.authorName : ''].filter(Boolean).join(', ');
      return `<button class="hl-item" type="button" data-k="${k}" aria-label="${esc(label)}">
        <span class="hl-ring"><span class="hl-thumb" style="background:linear-gradient(135deg, ${cat ? cat.color : '#3D2F1A'} 0%, #1A1208 100%);">${cat ? cat.emoji : '✨'}${h.photoUrl ? `<img data-src="${esc(h.photoUrl)}" alt="" hidden>` : ''}</span>${h.mediaType === 'video' ? '<span class="hl-play" aria-hidden="true">▶</span>' : ''}</span>
        <span class="hl-cap">${esc(h.title || 'Highlight')}</span>
        ${showAuthor && h.authorName ? `<span class="hl-by">${esc(h.authorName)}</span>` : ''}
      </button>`;
    }).join('')}</div>
  </section>`;
  el.querySelectorAll('img[data-src]').forEach(img => {
    const src = img.getAttribute('data-src');
    img.removeAttribute('data-src');
    resolvePhoto(src).then(url => { if (url) { img.onerror = () => img.remove(); img.src = url; img.hidden = false; } else img.remove(); });
  });
  el.querySelectorAll('.hl-item').forEach(b => b.addEventListener('click', () => openViewer(list, +b.dataset.k, resolvePhoto, ctx)));
  }
  renderRow();
  return list;
}
