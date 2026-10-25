// Strong Foodie: makes a real page for every place, destination, best-of list
// and guide, with the right title, text and photo for Google, WhatsApp,
// Instagram and iMessage. Runs on GitHub (.github/workflows/build-pages.yml)
// every few hours and after every upload, and commits the result.
//
//   node tools/build-pages.mjs
//
// It reads the same Firestore database as the app and the website, through
// Firestore's public web address (the same reads a visitor's browser does),
// so it needs no password or key. Everything it writes is made again on
// every run: p/, stad/, best/, guide/, og/ and sitemap.xml.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATS, SITE, slugOf, placeUrl, destinationUrl, guideUrl, normalise, isPublished,
  destinations, applyListEdits, buildLists, placeKey, normaliseDish, byQuality, LIST_CATS, toDate, starStr,
} from '../js/sf-core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.FIRESTORE_BASE || 'https://firestore.googleapis.com/v1/projects/jongfoodie/databases/(default)/documents';
const CATALOG = Object.keys(CATS).map(k => CATS[k].coll);
const GENERATED = ['p', 'stad', 'best', 'guide', 'list', 'og', 'links', 'press', 'kit'];
// Short addresses for an Instagram bio, a business card or a sticker: strongfoodie.com/links
const SHORT = [['links', 'links.html'], ['press', 'press.html'], ['kit', 'kit.html'], ['best', 'best.html']];
const day = d => d ? d.toISOString().slice(0, 10) : '';
// The newest change among some places, so a page's date only moves when its places do.
const newest = (places, changedOf) => day(places.map(changedOf).filter(Boolean).sort((a, b) => b - a)[0]);

// ── Firestore's web format → plain values ─────────────────────────────────
function fromValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('referenceValue' in v) return v.referenceValue;
  return null;
}
const fromFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, fromValue(v)]));
const idOf = name => name.split('/').pop();

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    if (attempt >= 3) throw new Error(`${res.status} for ${url}`);
    await new Promise(r => setTimeout(r, 1500 * attempt));
  }
}
async function listAll(coll, mask = []) {
  const out = [];
  let token = '';
  do {
    const qs = new URLSearchParams({ pageSize: '300' });
    mask.forEach(m => qs.append('mask.fieldPaths', m));
    if (token) qs.set('pageToken', token);
    const data = await getJson(`${BASE}/${coll}?${qs}`);
    if (!data) break;
    (data.documents || []).forEach(d => out.push({ id: idOf(d.name), ...fromFields(d.fields) }));
    token = data.nextPageToken || '';
  } while (token);
  return out;
}
// Members with a private account: their spots get no public page.
// One read for all profiles when the database allows it, else one per member.
// Also gives each member's name, and who has no profile (any more).
async function privateMembers(owners) {
  const ids = new Set();
  ids.names = new Map();
  ids.missing = new Set();
  try {
    const all = await listAll('profiles', ['isPrivate', 'displayName']);
    all.forEach(p => { if (p.isPrivate === true) ids.add(p.id); if (p.displayName) ids.names.set(p.id, String(p.displayName)); });
    const known = new Set(all.map(p => p.id));
    owners.forEach(uid => { if (!known.has(uid)) ids.missing.add(uid); });
    return ids;
  } catch (e) { console.log('Profiles read one by one:', e.message); }
  for (const uid of [...new Set(owners)]) {
    // No profile: public, like on the website. A profile that can't be read: private, to be safe.
    const p = await getDoc(`profiles/${uid}`).then(v => { if (!v) ids.missing.add(uid); return v || {}; }).catch(() => ({ isPrivate: true }));
    if (p.isPrivate === true) ids.add(uid);
    if (p.displayName) ids.names.set(uid, String(p.displayName));
  }
  return ids;
}

// Published guides only: the database lets anyone read those, and drafts only
// to Strong Foodie, so they are asked for with a filter.
async function publishedGuides() {
  const body = JSON.stringify({ structuredQuery: { from: [{ collectionId: 'guides' }], where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'published' } } } } });
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}:runQuery`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (res.ok) return (await res.json()).filter(r => r.document).map(r => ({ id: idOf(r.document.name), ...fromFields(r.document.fields) }));
    if (attempt >= 3) { console.log(`Guides not read (${res.status}): no guide pages this time.`); return []; }
    await new Promise(r => setTimeout(r, 1500 * attempt));
  }
}
// Lists made by members (my-list.html): published ones that Strong Foodie did
// not hide. The database shows only those to visitors, so the query asks for
// exactly that.
async function publishedMemberLists() {
  const eq = (f, v) => ({ fieldFilter: { field: { fieldPath: f }, op: 'EQUAL', value: v } });
  const body = JSON.stringify({ structuredQuery: { from: [{ collectionId: 'memberLists' }], where: { compositeFilter: { op: 'AND', filters: [eq('status', { stringValue: 'published' }), eq('hidden', { booleanValue: false })] } } } });
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}:runQuery`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (res.ok) return (await res.json()).filter(r => r.document).map(r => ({ id: idOf(r.document.name), ...fromFields(r.document.fields) }));
    if (attempt >= 3) { console.log(`Member lists not read (${res.status}): no list pages this time.`); return []; }
    await new Promise(r => setTimeout(r, 1500 * attempt));
  }
}
// The address of a member's list. js/sf-memberlists.js makes the same one.
const memberListUrl = l => `/list/${slugOf(l.title) || 'list'}-${l.id}/`;

async function getDoc(p) {
  const d = await getJson(`${BASE}/${p}`);
  return d ? fromFields(d.fields) : null;
}

// ── Share photos (og:image) ───────────────────────────────────────────────
// App photos live in the database as text (base64). Link previews need a real
// image file, so those are written to og/ once per run.
const ogCache = new Map();
const EXT = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
async function writeOg(name, base64, type) {
  const ext = EXT[type] || 'jpg';
  const file = `og/${String(name).replace(/[^A-Za-z0-9_-]/g, '-')}.${ext}`;
  await writeFile(path.join(ROOT, file), Buffer.from(base64.replace(/\s/g, ''), 'base64'));
  return `${SITE}/${file}`;
}
async function ogImage(url, fallbackName) {
  if (!url || typeof url !== 'string') return '';
  if (ogCache.has(url)) return ogCache.get(url);
  let out = '';
  try {
    if (url.startsWith('fsimg://')) {
      const id = url.slice(8);
      const img = await getDoc(`images/${id}`);
      if (img && img.data) out = await writeOg(id.replace(/[^A-Za-z0-9_-]/g, '-') || fallbackName, img.data, img.contentType);
    } else if (/^https?:\/\//i.test(url)) {
      out = url;
    } else if (url.startsWith('data:image/')) {
      const m = /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(url);
      if (m) out = await writeOg(fallbackName, m[2], m[1]);
    } else if (/^\/?images\//.test(url)) {
      out = `${SITE}/${url.replace(/^\//, '')}`;
    } else if (/^[A-Za-z0-9+/=\s]{200,}$/.test(url)) {
      out = await writeOg(fallbackName, url, 'image/jpeg');
    }
  } catch (e) { console.log('Photo skipped:', fallbackName, e.message); }
  ogCache.set(url, out);
  return out;
}

// ── Pages from the site's own templates ───────────────────────────────────
const attr = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const text = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const oneLine = (s, n = 155) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };

function setMeta(html, attrName, key, value) {
  const re = new RegExp(`<meta ${attrName}="${key}" content="[^"]*">`);
  const tag = `<meta ${attrName}="${key}" content="${attr(value)}">`;
  return re.test(html) ? html.replace(re, () => tag) : html.replace('</head>', () => `${tag}\n</head>`);
}
function makePage(template, { title, description, canonical, image, type = 'website', params, ld, pre, slot }) {
  let html = template;
  // Every link on the template is written from the site's root.
  html = html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n<base href="/">');
  // Replacements go through a function, so a "$" in a name or review stays a "$".
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${text(title)}</title>`);
  html = setMeta(html, 'name', 'description', description);
  html = setMeta(html, 'property', 'og:type', type);
  html = setMeta(html, 'property', 'og:title', title.replace(/ \| Strong Foodie$/, ''));
  html = setMeta(html, 'property', 'og:description', description);
  html = setMeta(html, 'property', 'og:url', canonical);
  html = setMeta(html, 'property', 'og:image', image || `${SITE}/icon-512.png`);
  html = setMeta(html, 'name', 'twitter:card', image ? 'summary_large_image' : 'summary');
  // The template works out its canonical address in the browser; here it is fixed.
  html = html.replace(/<script>\s*\/\/ The canonical address is set here[\s\S]*?<\/script>\s*/, '');
  html = html.replace(/<link rel="canonical" href="[^"]*">\s*/g, '');
  html = html.replace('</head>', () => `<link rel="canonical" href="${attr(canonical)}">\n<script>window.SF_PARAMS = ${JSON.stringify(params).replace(/</g, '\\u003c')};</script>\n</head>`);
  // Structured data in the page itself, so search engines read it without
  // running JavaScript. The template's script then adds no second copy.
  if (ld) html = html.replace('</head>', () => `<script type="application/ld+json" data-sf="ld">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n</head>`);
  // The essentials of the page (name, rating, review, the list) in plain HTML,
  // where the template shows "Loading…". Its script replaces this when it runs.
  if (pre && slot) {
    if (html.includes(slot)) html = html.replace(slot, () => pre).replace('</head>', () => `${PRE_CSS}\n</head>`);
    else console.log('No spot for the page content in the template:', slot);
  }
  return html;
}

// ── Content in the page itself ────────────────────────────────────────────
const SLOTS = {
  plek: '<div class="place-loading">Loading place…</div>',
  stad: '<div class="loading">Loading destinations…</div>',
  best: '<div class="loading">Loading the lists…</div>',
};
const PRE_CSS = `<style>.sf-pre{max-width:820px;margin:0 auto;padding:2rem 1.25rem 3rem;line-height:1.6}.sf-pre h1{font-family:'Playfair Display',Georgia,serif;font-size:clamp(1.7rem,5vw,2.3rem);line-height:1.2;margin:.35rem 0 .6rem}.sf-pre .sf-crumb,.sf-pre .sf-meta{font-size:14px;color:var(--muted,#8A7A66)}.sf-pre .sf-stars{color:#D4521A;letter-spacing:1px}.sf-pre img{display:block;width:100%;max-height:420px;object-fit:cover;border-radius:14px;margin:1rem 0}.sf-pre ol{padding-left:1.3rem}.sf-pre li{margin:.5rem 0}.sf-pre a{color:var(--accent,#D4521A)}.sf-pre .sf-wait{color:var(--muted,#8A7A66);font-size:14px;margin-top:1.5rem}</style>`;
const SCHEMA = { eat: 'Restaurant', drink: 'BarOrPub', shop: 'Store', culture: 'TouristAttraction', health: 'HealthClub', stay: 'Hotel' };
// What a destination has, in words: "3 places to eat, 1 bar or café".
const KIND = { eat: ['place to eat', 'places to eat'], drink: ['bar or café', 'bars and cafés'], shop: ['shop', 'shops'], culture: ['culture spot', 'culture spots'], health: ['health spot', 'health spots'], stay: ['place to stay', 'places to stay'] };
const kinds = counts => counts.map(([k, n]) => `${n} ${KIND[k] ? KIND[k][n === 1 ? 0 : 1] : CATS[k].label.toLowerCase()}`).join(', ');
const score = r => String(Math.round(r * 10) / 10);
const hasGeo = p => typeof p.lat === 'number' && typeof p.lng === 'number' && isFinite(p.lat) && isFinite(p.lng) && !(p.lat === 0 && p.lng === 0);
const paras = s => String(s || '').split(/\n+/).map(x => x.trim()).filter(Boolean).map(x => `<p>${text(x)}</p>`).join('');
const urlOfItem = p => placeUrl(p.dish ? p.place : p);
const nameOfItem = p => p.dish ? `${p.name}, ${p.place.name}` : p.name;

function placeLd(p, raw, url, image) {
  const ld = { '@context': 'https://schema.org', '@type': SCHEMA[p.cat] || 'LocalBusiness', name: p.name, url };
  const address = raw.address || raw.city;
  if (address) ld.address = String(address);
  if (hasGeo(p)) ld.geo = { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng };
  if (p.price) ld.priceRange = String(p.price);
  if (image) ld.image = image;
  if (!p.member && p.rating && p.review) {
    ld.review = { '@type': 'Review', author: { '@type': 'Person', name: 'Merdan Koc' }, publisher: { '@type': 'Organization', name: 'Strong Foodie' },
      reviewRating: { '@type': 'Rating', ratingValue: p.rating, bestRating: 5, worstRating: 1 }, reviewBody: p.review.slice(0, 500) };
    if (p.created) ld.review.datePublished = day(p.created);
  }
  return ld;
}
function placePre(p, raw, image) {
  const crumb = ['<a href="/">Strong Foodie</a>', p.destination ? `<a href="${attr(destinationUrl(p.destination))}">${text(p.destination)}</a>` : '', text(CATS[p.cat].label)].filter(Boolean).join(' › ');
  const where = [p.town, p.destination, p.country].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
  const meta = [
    p.rating ? `<span class="sf-stars">${starStr(p.rating)}</span> ${score(p.rating)}/5` : '',
    p.member ? `Spot added by ${text(p.author)}, a Strong Foodie member` : 'Reviewed by Strong Foodie',
    text(p.type || p.tip),
    text(raw.address || where),
  ].filter(Boolean).join(' · ');
  return `<article class="sf-pre"><p class="sf-crumb">${crumb}</p><h1>${text(p.name)}</h1><p class="sf-meta">${meta}</p>`
    + (image ? `<img src="${attr(image)}" alt="${attr(p.name)}">` : '')
    + paras(p.review)
    + (p.closed ? '<p><b>This place has closed.</b></p>' : '')
    + '<p class="sf-wait">Loading photos, the map and member reviews…</p></article>';
}
function destPre(d, counts) {
  const top = d.places.slice().sort(byQuality).slice(0, 20);
  const best = top.filter(p => p.rating).slice(0, 3);
  const intro = `${d.count} ${d.count === 1 ? 'place' : 'places'} in ${d.name}${d.country && d.country !== d.name ? ', ' + d.country : ''}, visited and rated by Strong Foodie and its members: ${kinds(counts)}.`
    + (best.length ? ` Highest rated: ${best.map(p => `${p.name} (${score(p.rating)}/5)`).join(', ')}.` : '');
  const items = top.map(p => `<li><a href="${attr(placeUrl(p))}">${text(p.name)}</a> · ${text(CATS[p.cat].label)}${p.rating ? ` · ${score(p.rating)}/5` : ''}${p.town && p.town !== d.name ? ` · ${text(p.town)}` : ''}</li>`).join('');
  return `<section class="sf-pre"><p class="sf-crumb"><a href="/">Strong Foodie</a> › <a href="/stad.html">Destinations</a></p><h1>Best places in ${text(d.name)}</h1><p>${text(intro)}</p><ol>${items}</ol><p class="sf-wait">Loading the map and every place…</p></section>`;
}
function listPre(l, top, what) {
  const intro = l.intro || `The ${top.length} best ${what}${l.dest ? ' in ' + l.dest : ' worldwide'}, picked from every place Strong Foodie visited and rated.${top[0] ? ` Number one: ${nameOfItem(top[0])}${top[0].rating ? ` (${score(top[0].rating)}/5)` : ''}.` : ''}`;
  const items = top.map(p => {
    const loc = (p.dish ? p.place.town || p.place.destination : p.town || p.destination) || '';
    return `<li><a href="${attr(urlOfItem(p))}">${text(nameOfItem(p))}</a>${p.rating ? ` · ${score(p.rating)}/5` : ''}${loc && loc !== l.dest ? ` · ${text(loc)}` : ''}${p.review ? `<br><span class="sf-meta">${text(oneLine(p.review, 160))}</span>` : ''}</li>`;
  }).join('');
  return `<section class="sf-pre"><p class="sf-crumb"><a href="/">Strong Foodie</a> › <a href="/best.html">Best of</a>${l.dest ? ` › ${text(l.dest)}` : ''}</p><h1>${text(l.title)}</h1>${paras(intro)}<ol>${items}</ol><p class="sf-wait">Loading photos and more lists…</p></section>`;
}
const listLd = (name, items, ordered) => ({
  '@context': 'https://schema.org', '@type': 'ItemList', name,
  ...(ordered ? { itemListOrder: 'https://schema.org/ItemListOrderDescending' } : {}),
  numberOfItems: items.length,
  itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + urlOfItem(p), name: nameOfItem(p) })),
});
async function writePage(url, html) {
  const dir = path.join(ROOT, url.replace(/^\/|\/$/g, ''));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), html);
}

// ── Build ─────────────────────────────────────────────────────────────────
async function main() {
  const now = new Date();
  const [catalogLists, memberDocs, guideDocs, listEdits, dishDocs, flagDocs, memberListDocs] = await Promise.all([
    Promise.all(CATALOG.map(c => listAll(c))),
    listAll('userPlaces'),
    publishedGuides(),
    // Strong Foodie's changes to the lists (list-edit.html); none is fine too.
    listAll('lists').then(ds => ds.map(d => ({ ...d, slug: d.id }))).catch(e => { console.log('List changes not read:', e.message); return []; }),
    // The dishes Strong Foodie rated (dish-edit.html); none is fine too.
    listAll('dishes').catch(e => { console.log('Dishes not read:', e.message); return []; }),
    // Members Strong Foodie blocked (admin-members.html); none is fine too.
    listAll('memberFlags').catch(e => { console.log('Member flags not read:', e.message); return []; }),
    publishedMemberLists().catch(e => { console.log('Member lists not read:', e.message); return []; }),
  ]);
  const blockedIds = new Set(flagDocs.filter(d => d.blocked === true).map(d => d.id));
  const privateIds = await privateMembers(memberDocs.map(r => r.addedByUserId).concat(memberListDocs.map(l => l.authorId)).filter(Boolean));

  const catalog = [];
  CATALOG.forEach((coll, i) => catalogLists[i]
    .filter(r => r.name && isPublished(r, now))
    .forEach(r => catalog.push({ place: normalise(coll, r.id, r, false), raw: r })));
  const members = memberDocs
    .filter(r => r.name && r.hidden !== true && !privateIds.has(r.addedByUserId) && !blockedIds.has(r.addedByUserId))
    .map(r => ({ place: normalise('userPlaces', r.id, r, true), raw: r }));
  const entries = catalog.concat(members);
  const all = entries.map(e => e.place);
  console.log(`${catalog.length} reviewed places, ${members.length} member spots`);
  // Safety: an empty answer means something went wrong, not that every review is gone.
  if (!catalog.length) throw new Error('No reviewed places came back from the database; the pages are left as they are.');

  for (const dir of GENERATED) await rm(path.join(ROOT, dir), { recursive: true, force: true });
  await mkdir(path.join(ROOT, 'og'), { recursive: true });

  const [plek, stad, best, guide, listPage] = await Promise.all(['plek.html', 'stad.html', 'best.html', 'guide.html', 'list.html']
    .map(f => readFile(path.join(ROOT, f), 'utf8').catch(() => '')));
  const sitemap = [];
  const changedOf = new Map();
  const changed = p => changedOf.get(p);

  // Places
  for (const { place: p, raw } of entries) {
    // An id with odd characters gets no page of its own; 404.html still finds it.
    if (!/^[A-Za-z0-9_-]+$/.test(p.id)) continue;
    const url = placeUrl(p);
    const where = p.town || p.destination || p.country;
    // "review" is what people search for: "in-n-out review".
    const reviewed = !p.member && p.rating;
    const title = `${p.name}${where ? ', ' + where : ''}${reviewed ? `: review ${score(p.rating)}/5` : ''} | Strong Foodie`;
    const lead = p.rating ? `Rated ${score(p.rating)}/5 by Strong Foodie. ` : (p.member ? `Spot added by ${p.author}, a Strong Foodie member. ` : '');
    const body = p.review || p.tip || `${CATS[p.cat].label} spot${p.where ? ' in ' + p.where : ''}.`;
    const image = await ogImage(p.photos[0], `${p.coll}-${p.id}`);
    await writePage(url, makePage(plek, { title, description: oneLine(lead + body), canonical: SITE + url, image, type: 'article', params: { c: p.coll, id: p.id },
      ld: placeLd(p, raw, SITE + url, image), pre: placePre(p, raw, image), slot: SLOTS.plek }));
    changedOf.set(p, toDate(raw.updatedAt) || p.created);
    sitemap.push({ loc: SITE + url, lastmod: day(changedOf.get(p)), priority: p.member ? '0.5' : '0.7' });
  }

  // Destinations
  const dests = destinations(all);
  for (const d of dests) {
    const url = destinationUrl(d.name);
    const counts = Object.keys(CATS).map(k => [k, d.places.filter(p => p.cat === k).length]).filter(([, n]) => n);
    const members = d.places.filter(p => p.member).length;
    const title = `Best places in ${d.name}: where to eat, drink and stay | Strong Foodie`;
    const description = `${d.count} ${d.count === 1 ? 'place' : 'places'} in ${d.name}${d.country && d.country !== d.name ? ', ' + d.country : ''}: ${kinds(counts)}. Honest ratings by Strong Foodie${members ? ' and tips from members' : ''}.`;
    const cover = d.places.filter(p => p.photos.length).sort(byQuality)[0];
    const image = cover ? await ogImage(cover.photos[0], `${cover.coll}-${cover.id}`) : '';
    await writePage(url, makePage(stad, { title, description, canonical: SITE + url, image, params: { d: d.slug },
      ld: listLd(`Best places in ${d.name}`, d.places.slice().sort(byQuality).slice(0, 20), false), pre: destPre(d, counts), slot: SLOTS.stad }));
    sitemap.push({ loc: SITE + url, lastmod: newest(d.places, changed), priority: '0.8' });
  }

  // Best-of lists, with the dishes
  const placeByKey = new Map(all.map(p => [placeKey(p), p]));
  const dishes = dishDocs.map(d => normaliseDish(d.id, d, placeByKey.get(`${d.placeColl}/${d.placeId}`))).filter(Boolean);
  const lists = applyListEdits(all, listEdits, { dishes });
  for (const l of lists) {
    const top = l.places.slice(0, 10);
    const title = `${l.title} (${now.getFullYear()}) | Strong Foodie`;
    const what = l.kind === 'cat' ? LIST_CATS[l.cat].title.toLowerCase() : l.kind === 'tag' ? l.tag.toLowerCase() : l.kind === 'dish' ? l.dishKind.toLowerCase() + ' dishes' : 'places';
    const description = l.intro ? oneLine(l.intro) : oneLine(`The ${top.length} best ${what}${l.dest ? ' in ' + l.dest : ' worldwide'}, rated and reviewed by Strong Foodie: ${top.slice(0, 3).map(p => p.dish ? p.place.name : p.name).join(', ')} and more.`);
    const image = l.cover ? await ogImage(l.cover, `list-${l.slug}`) : '';
    if (best) await writePage(l.url, makePage(best, { title, description, canonical: SITE + l.url, image, params: { l: l.slug },
      ld: listLd(l.title, top, true), pre: listPre(l, top, what), slot: SLOTS.best }));
    sitemap.push({ loc: SITE + l.url, lastmod: newest(l.places, changed), priority: '0.8' });
  }

  // The automatic lists for the app, before Strong Foodie's changes (the app adds
  // those itself from the `lists` collection, so a change shows right away).
  const autoLists = buildLists(all, { min: 1, dishes }).map(l => ({
    slug: l.slug, url: l.url, kind: l.kind, cat: l.cat || '', tag: l.tag || '', dishKind: l.dishKind || '', dest: l.dest, destSlug: l.destSlug, country: l.country,
    title: l.title, places: l.places.map(placeKey),
  }));
  await mkdir(path.join(ROOT, 'best'), { recursive: true });
  await writeFile(path.join(ROOT, 'best', 'lists.json'), JSON.stringify({ version: 1, lists: autoLists }, null, 1) + '\n');

  // Guides for a moment (written by Strong Foodie in guide-edit.html)
  // Only plain slugs: a guide's address becomes a folder on the website.
  const guides = guideDocs.filter(g => g.status === 'published' && typeof g.slug === 'string' && /^[a-z0-9-]{1,80}$/.test(g.slug) && g.title);
  for (const g of guides) {
    const url = guideUrl(g.slug);
    const title = `${g.title} | Strong Foodie`;
    const description = oneLine(g.intro || `A Strong Foodie guide${g.city ? ' to ' + g.city : ''}.`);
    let image = g.cover ? await ogImage(g.cover, `guide-${g.slug}`) : '';
    if (!image && Array.isArray(g.places)) {
      for (const it of g.places) {
        const e = entries.find(x => x.place.id === it.id && x.place.coll === it.coll);
        if (e && e.place.photos.length) { image = await ogImage(e.place.photos[0], `${e.place.coll}-${e.place.id}`); break; }
      }
    }
    if (guide) await writePage(url, makePage(guide, { title, description, canonical: SITE + url, image, type: 'article', params: { g: g.slug } }));
    sitemap.push({ loc: SITE + url, lastmod: day(toDate(g.updatedAt) || toDate(g.createdAt)), priority: '0.8' });
  }

  // Lists made by members: a page of their own when the list is public, its
  // maker's account isn't private or blocked, and at least one of its places
  // is online. Only plain ids: the address becomes a folder.
  let memberListPages = 0;
  for (const l of memberListDocs) {
    if (!/^[A-Za-z0-9]{1,64}$/.test(l.id) || typeof l.title !== 'string' || !l.title.trim() || !l.authorId) continue;
    if (privateIds.has(l.authorId) || blockedIds.has(l.authorId) || privateIds.missing.has(l.authorId)) continue;
    const items = (Array.isArray(l.places) ? l.places : []).map(it => it && placeByKey.get(`${it.coll}/${it.id}`)).filter(Boolean);
    if (!items.length || !listPage) continue;
    const url = memberListUrl(l);
    // The name on the member's profile, not the one typed into the list.
    const by = String(privateIds.names.get(l.authorId) || 'a Strong Foodie member').trim();
    const title = `${l.title.trim()}, a list by ${by} | Strong Foodie`;
    const description = oneLine(l.intro || `${items.length} ${items.length === 1 ? 'place' : 'places'}${l.city ? ' in ' + l.city : ''}, picked by ${by}: ${items.slice(0, 3).map(p => p.name).join(', ')}${items.length > 3 ? ' and more' : ''}.`);
    const cover = l.cover || (items.find(p => p.photos.length) || { photos: [] }).photos[0] || '';
    const image = cover ? await ogImage(cover, `mlist-${l.id}`) : '';
    await writePage(url, makePage(listPage, { title, description, canonical: SITE + url, image, type: 'article', params: { id: l.id } }));
    sitemap.push({ loc: SITE + url, lastmod: day(toDate(l.updatedAt) || toDate(l.createdAt)), priority: '0.5' });
    memberListPages++;
  }

  // Short addresses: the same page in a folder (strongfoodie.com/links/). GitHub
  // sends strongfoodie.com/links there by itself. Google keeps the .html page.
  for (const [dir, file] of SHORT) {
    const html = await readFile(path.join(ROOT, file), 'utf8').catch(() => '');
    if (html) await writePage(`/${dir}/`, html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n<base href="/">'));
  }

  // Sitemap: the fixed pages first, then everything made above.
  const fixed = [
    ['', '1.0'], ['reviews.html', '0.9'], ['drink.html', '0.9'], ['shop.html', '0.8'], ['culture.html', '0.8'], ['health.html', '0.8'],
    ['hotel.html', '0.9'], ['stad.html', '0.9'], ['best.html', '0.9'], ['guides.html', '0.8'], ['battle.html', '0.6'], ['deals.html', '0.5'], ['map.html', '0.7'], ['community.html', '0.7'],
    ['videos.html', '0.6'], ['about.html', '0.6'], ['press.html', '0.5'], ['links.html', '0.5'], ['privacy.html', '0.3'],
  ].map(([p, priority]) => ({ loc: `${SITE}/${p}`, lastmod: '', priority }));
  const urls = fixed.concat(sitemap);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url>\n    <loc>${text(u.loc)}</loc>\n    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>\n    ` : ''}<priority>${u.priority}</priority>\n  </url>`).join('\n')}\n</urlset>\n`;
  await writeFile(path.join(ROOT, 'sitemap.xml'), xml);

  console.log(`Pages: ${entries.length} places, ${dests.length} destinations, ${lists.length} lists, ${guides.length} guides, ${memberListPages} member lists. Sitemap: ${urls.length} addresses.`);
}

main().catch(e => { console.error(e); process.exit(1); });
