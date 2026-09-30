// Strong Foodie: shared place data for the homepage and the destination pages.
//
// Reads every place collection the app uses (one read per collection) and turns
// the documents into one list. Places members add in the app are included;
// members with a private account are left out. The destination logic lives here
// only, so the homepage and stad.html always show the same cities and counts.
//
//   import { loadPlaces, destinations } from './js/sf-places.js?v=1';
//   const { catalog, members, all } = await loadPlaces(db);


import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { CATS, esc, starStr, placeUrl, isPublished, normalise, thumbOf, applyListEdits, normaliseDish, placeKey } from "./sf-core.js?v=3";
import { loadFlags, isBlocked } from "./sf-moderation.js?v=1";
export * from "./sf-core.js?v=3";

async function readAll(db, coll) {
  try {
    const snap = await getDocs(collection(db, coll));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.log('Could not load ' + coll + ':', e.code || e); return []; }
}

// Places members added in the app. Members with a private account are left out,
// and so are spots Strong Foodie hid or added by a blocked member (sf-moderation.js).
async function readMemberPlaces(db) {
  const [all, flags] = await Promise.all([readAll(db, 'userPlaces'), loadFlags(db)]);
  const raw = all.filter(r => r.name && r.hidden !== true && !isBlocked(flags, r.addedByUserId));
  const owners = [...new Set(raw.map(r => r.addedByUserId).filter(Boolean))];
  const privateOwners = new Set();
  await Promise.all(owners.map(uid => getDoc(doc(db, 'profiles', uid))
    .then(s => { if (s.exists() && s.data().isPrivate === true) privateOwners.add(uid); })
    .catch(() => {})));
  return raw.filter(r => !privateOwners.has(r.addedByUserId));
}

export async function loadPlaces(db) {
  const now = new Date();
  const keys = Object.keys(CATS);
  const [lists, memberDocs] = await Promise.all([
    Promise.all(keys.map(k => readAll(db, CATS[k].coll))),
    readMemberPlaces(db),
  ]);
  const catalog = [];
  keys.forEach((k, i) => {
    lists[i].filter(r => r.name && isPublished(r, now))
      .forEach(r => catalog.push(normalise(CATS[k].coll, r.id, r, false)));
  });
  const members = memberDocs.map(r => normalise('userPlaces', r.id, r, true));
  return { catalog, members, all: catalog.concat(members) };
}

// ── Best-of lists: the automatic ones with Strong Foodie's changes (the `lists` collection)
export async function loadListEdits(db) {
  try {
    const snap = await getDocs(collection(db, 'lists'));
    return snap.docs.map(d => ({ ...d.data(), slug: d.id }));
  } catch (e) { console.log('List changes could not load:', e.code || e); return []; }
}
// The dishes Strong Foodie rated (dish-edit.html), each joined to its place.
export async function loadDishes(db, all) {
  try {
    const byKey = new Map(all.map(p => [placeKey(p), p]));
    const snap = await getDocs(collection(db, 'dishes'));
    return snap.docs.map(d => { const r = d.data(); return normaliseDish(d.id, r, byKey.get(`${r.placeColl}/${r.placeId}`)); }).filter(Boolean);
  } catch (e) { console.log('Dishes could not load:', e.code || e); return []; }
}
export async function loadLists(db, all, opts = {}) {
  const [edits, dishes] = await Promise.all([loadListEdits(db), opts.dishes ? opts.dishes : loadDishes(db, all)]);
  return applyListEdits(all, edits, { ...opts, dishes });
}

// ── Photos: normal URLs, or "fsimg://<id>" (a base64 image in `images`, from the app)
export function photoTools(db) {
  const cache = new Map();
  function resolvePhoto(url) {
    if (!url || typeof url !== 'string') return Promise.resolve('');
    if (url.startsWith('fsimg://')) {
      const id = url.slice(8);
      if (!cache.has(id)) {
        cache.set(id, getDoc(doc(db, 'images', id))
          .then(s => { const d = s.exists() ? s.data() : null; return d && d.data ? `data:${d.contentType || 'image/jpeg'};base64,${d.data}` : ''; })
          .catch(() => ''));
      }
      return cache.get(id);
    }
    if (/^[A-Za-z0-9+/=\s]{200,}$/.test(url)) return Promise.resolve('data:image/jpeg;base64,' + url.replace(/\s/g, ''));
    return Promise.resolve(url);
  }
  // Cards get the small copy from images/thumbs/; an image marked data-full
  // (a large cover) gets the original. No small copy yet: the original.
  function hydratePhotos(root) {
    root.querySelectorAll('img[data-photo]').forEach(img => {
      const src = img.getAttribute('data-photo');
      img.removeAttribute('data-photo');
      const small = img.hasAttribute('data-full') ? '' : thumbOf(src);
      if (small) {
        img.onerror = () => { img.onerror = () => img.remove(); resolvePhoto(src).then(url => { if (url) img.src = url; else img.remove(); }); };
        img.src = small; img.hidden = false;
        return;
      }
      img.onerror = () => img.remove();
      resolvePhoto(src).then(url => { if (url) { img.src = url; img.hidden = false; } else img.remove(); });
    });
  }
  return { resolvePhoto, hydratePhotos };
}

// ── Card (styles: .mini-card, .mini-img, .pill… in the page)
export function miniCard(p) {
  const cat = CATS[p.cat];
  const text = p.review || p.tip || p.type || '';
  const foot = p.rating
    ? `<span class="mini-rating">${starStr(p.rating)} ${p.rating}</span>`
    : `<span class="mini-meta" style="margin:0;">${p.member ? 'Added by ' + esc(p.author) : ''}</span>`;
  return `<a class="mini-card" href="${placeUrl(p)}">
    <div class="mini-img" style="background:linear-gradient(135deg, ${cat.color} 0%, #1A1208 100%);">
      <span>${esc(p.emoji)}</span>
      ${p.photos[0] ? `<img data-photo="${esc(p.photos[0])}" alt="" loading="lazy" hidden>` : ''}
    </div>
    <div class="mini-body">
      <p class="mini-meta"><span class="pill pill-cat">${cat.label}</span>${p.member ? '<span class="pill pill-member">Member</span>' : ''}${p.closed ? '<span class="pill pill-closed">Closed</span>' : ''}${esc(p.where)}</p>
      <h3 class="mini-title">${esc(p.name)}</h3>
      ${text ? `<p class="mini-text">${esc(text.slice(0, 90))}${text.length > 90 ? '…' : ''}</p>` : ''}
      <div class="mini-footer">${foot}<span class="mini-read">View place →</span></div>
    </div>
  </a>`;
}
