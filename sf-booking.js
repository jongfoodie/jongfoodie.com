// Strong Foodie: the Reserve and Book buttons on a place page. The app shows
// the same button from the same documents (Rork batch 16).
//
// bookings/{coll}_{id}: set by Strong Foodie in admin-booking.html.
//   { placeKey: "reviews/<id>", placeName, url, kind, partner, partnerName, updatedAt }
//   kind: "table" | "room" | "tickets" | "book", or "none" for no button at all.
//   partner: true when Strong Foodie earns a commission on the link. The page
//   then says so under the button (Dutch advertising code, ACM).
// site/partners: the partner accounts, also set in admin-booking.html.
//   { booking: "<one partner link to booking.com from CJ (Europe) or Awin, or aid=<number>>",
//     getyourguide: "<partner ID>", updatedAt }
//   With these, hotels without their own link get "Check prices on Booking.com"
//   and culture spots get "Tickets and tours" (GetYourGuide).
// Restaurants and bars without a link: "Call to reserve" when the phone is known.
// A click counts in `views` as type "book" (js/sf-views.js), nothing personal.

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const KINDS = {
  table: 'Reserve a table',
  room: 'Book a room',
  tickets: 'Get tickets',
  book: 'Book now',
  none: 'No button',
};

export function defaultKind(cat) {
  return { eat: 'table', drink: 'table', stay: 'room', culture: 'tickets' }[cat] || 'book';
}

export const bookingId = key => String(key || '').replace('/', '_');
const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only real web links: never javascript: or data: links.
export function safeUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') ? u.href : '';
  } catch (e) { return ''; }
}

const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } };
const isHost = (url, domain) => { const h = hostOf(url); return h === domain || h.endsWith('.' + domain); };

// A short code for the partner reports: which place the booking came from.
const refOf = key => String(key || '').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 50);

// ── Booking.com: one partner link, from Awin, from CJ, or with your own aid.
const CJ_HOSTS = ['anrdoezrs.net', 'jdoqocy.com', 'tkqlhce.com', 'dpbolvw.net', 'kqzyfj.com'];

export function readBookingSetting(raw) {
  if (typeof raw !== 'string') return null;
  const typed = readTypedAid(raw);
  if (typed) return typed;
  const url = safeUrl(raw);
  if (!url) return null;
  const u = new URL(url);
  if (isHost(url, 'awin1.com')) {
    const mid = u.searchParams.get('awinmid'), affid = u.searchParams.get('awinaffid');
    return /^\d+$/.test(mid || '') && /^\d+$/.test(affid || '') ? { type: 'awin', mid, affid, label: `Awin, publisher ${affid}` } : null;
  }
  const cj = CJ_HOSTS.find(h => isHost(url, h));
  if (cj) {
    // Two CJ link shapes: /click-<website id>-<link id>?url=… and /links/<website id>/type/dlg/…
    const m = u.pathname.match(/^\/click-(\d+)-(\d+)/);
    if (m) return { type: 'cj', base: `https://www.${cj}/click-${m[1]}-${m[2]}`, label: `CJ, website ${m[1]}` };
    const d = u.pathname.match(/^\/links\/(\d+)\/type\/dlg\//);
    return d ? { type: 'cjdlg', base: `https://www.${cj}/links/${d[1]}/type/dlg`, label: `CJ, website ${d[1]}` } : null;
  }
  return null;
}

// "aid=1234567" typed by hand: an old direct Booking.com partner number.
// A pasted booking.com address is not accepted: its aid is usually Booking's own.
function readTypedAid(raw) {
  const m = String(raw || '').trim().match(/^aid\s*[=:]?\s*(\d{4,10})$/i);
  return m ? { type: 'aid', aid: m[1], label: `Booking.com, aid ${m[1]}` } : null;
}

// Any booking.com page, through your partner account.
// Links copied from booking.com carry Booking's own aid and tracking: those go.
const BOOKING_TRACKING = ['aid', 'label', 'sid', 'srpvid', 'ucfs', 'sb_price_type', 'sr_order', 'srepoch', 'all_sr_blocks', 'highlighted_blocks', 'matching_block_id', 'hpos', 'hapos'];
function cleanBooking(url) {
  const u = new URL(url);
  if (!BOOKING_TRACKING.some(k => u.searchParams.has(k))) return url;
  BOOKING_TRACKING.forEach(k => u.searchParams.delete(k));
  return u.href;
}

export function bookingComLink(setting, target, key) {
  const s = readBookingSetting(setting);
  const raw = safeUrl(target);
  if (!s || !raw || !isHost(raw, 'booking.com')) return '';
  const url = cleanBooking(raw);
  const ref = refOf(key);
  if (s.type === 'awin') return `https://www.awin1.com/cread.php?awinmid=${s.mid}&awinaffid=${s.affid}&clickref=web&clickref2=${encodeURIComponent(ref)}&ued=${encodeURIComponent(url)}`;
  if (s.type === 'cj') return `${s.base}?sid=${encodeURIComponent(ref)}&url=${encodeURIComponent(url)}`;
  if (s.type === 'cjdlg') return `${s.base}/sid/${encodeURIComponent(ref)}/${url}`;
  const u = new URL(url);
  u.searchParams.set('aid', s.aid);
  u.searchParams.set('label', 'sf-' + ref);
  return u.href;
}

export const bookingSearchUrl = q => `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(q)}`;

// ── GetYourGuide: the partner ID, or any GetYourGuide link that has partner_id in it.
export function readGygSetting(raw) {
  const s = String(raw || '').trim();
  if (/^[A-Za-z0-9]{4,16}$/.test(s)) return s.toUpperCase();
  const url = safeUrl(s);
  if (!url) return '';
  const id = new URL(url).searchParams.get('partner_id') || '';
  return /^[A-Za-z0-9]{4,16}$/.test(id) ? id.toUpperCase() : '';
}

export function gygLink(id, target, key) {
  const url = safeUrl(target);
  if (!id || !url || !isHost(url, 'getyourguide.com')) return '';
  const u = new URL(url);
  u.searchParams.set('partner_id', id);
  u.searchParams.set('cmp', refOf(key));
  return u.href;
}

export const gygSearchUrl = q => `https://www.getyourguide.com/s/?q=${encodeURIComponent(q)}`;

// A link Strong Foodie set by hand: a booking.com or GetYourGuide page gets the
// partner code added when it has none yet. Returns { href, partner }.
export function withPartner(url, partners, key) {
  const href = safeUrl(url);
  if (!href) return { href: '', partner: false };
  const p = partners || {};
  const u = new URL(href);
  if (isHost(href, 'booking.com') && p.booking) {
    const l = bookingComLink(p.booking, href, key);
    if (l) return { href: l, partner: true };
  }
  if (isHost(href, 'getyourguide.com') && !u.searchParams.get('partner_id') && p.getyourguide) {
    const l = gygLink(readGygSetting(p.getyourguide), href, key);
    if (l) return { href: l, partner: true };
  }
  return { href, partner: false };
}

// ── Reading
let partnersPromise = null;
export function loadPartners(db) {
  if (!partnersPromise) {
    partnersPromise = getDoc(doc(db, 'site', 'partners'))
      .then(s => (s.exists() ? s.data() : {}))
      .catch(e => { console.log('Partner settings could not load:', e.code || e); return {}; });
  }
  return partnersPromise;
}

export function loadBooking(db, key) {
  return getDoc(doc(db, 'bookings', bookingId(key)))
    .then(s => (s.exists() ? s.data() : null))
    .catch(e => { console.log('Booking link could not load:', e.code || e); return null; });
}

// ── The button for one place.
// p: { coll, id, cat, name, phone, closedStatus }, town: for the partner search.
// Returns null (no button) or { href, label, partner, partnerName, tel, kind }.
export function bookingButton(p, booking, partners, town = '') {
  if (!p || p.closedStatus) return null;
  const key = `${p.coll}/${p.id}`;
  const b = booking || {};
  if (b.kind === 'none') return null;
  const kind = has(KINDS, b.kind) ? b.kind : defaultKind(p.cat);
  if (b.url) {
    const { href, partner } = withPartner(b.url, partners, key);
    if (href) return { href, label: KINDS[kind], partner: partner || b.partner === true, partnerName: String(b.partnerName || '').slice(0, 40), tel: false, kind };
  }
  const q = [p.name, town].filter(Boolean).join(', ');
  const pr = partners || {};
  if (p.cat === 'stay' && pr.booking) {
    // Booking.com only recognises the bare hotel name: "Petit Ermitage, West Hollywood"
    // lands on its home page with "we don't recognize that name" (tested 6 October 2026).
    const href = bookingComLink(pr.booking, bookingSearchUrl(String(p.name || '').trim() || q), key);
    if (href) return { href, label: 'Check prices on Booking.com', partner: true, partnerName: 'Booking.com', tel: false, kind: 'room' };
  }
  if (p.cat === 'culture' && pr.getyourguide) {
    const href = gygLink(readGygSetting(pr.getyourguide), gygSearchUrl(q), key);
    if (href) return { href, label: 'Tickets and tours', partner: true, partnerName: 'GetYourGuide', tel: false, kind: 'tickets' };
  }
  const tel = telOf(p.phone);
  if ((p.cat === 'eat' || p.cat === 'drink') && tel) {
    return { href: 'tel:' + tel, label: 'Call to reserve', partner: false, partnerName: '', tel: true, kind: 'table' };
  }
  return null;
}

// A phone number to dial: "+31 (0)20 123 4567" becomes +31201234567.
export function telOf(phone) {
  const t = String(phone || '').replace(/\(0\)/g, '').replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return t.replace(/\D/g, '').length >= 6 ? t : '';
}

export const PARTNER_NOTE = 'Partner link: if you book, Strong Foodie may earn a small commission. Your price stays the same.';

// The button as HTML, for the row of buttons on the place page.
export function bookingButtonHtml(btn, cls = 'btn btn-primary') {
  if (!btn) return '';
  const ICONS = { table: '🍽️ ', room: '🛏️ ', tickets: '🎟️ ', book: '📅 ' };
  const icon = btn.tel ? '📞 ' : has(ICONS, btn.kind) ? ICONS[btn.kind] : '';
  const href = btn.tel ? btn.href : safeUrl(btn.href);
  if (!href) return '';
  const attrs = btn.tel ? '' : ` target="_blank" rel="${btn.partner ? 'sponsored ' : ''}noopener"`;
  return `<a class="${cls}" id="bookBtn" href="${esc(href)}"${attrs}>${icon}${esc(btn.label)}${btn.tel ? '' : ' ↗'}</a>`;
}

export function partnerNoteHtml(btn) {
  return btn && btn.partner ? `<p class="book-note">${esc(PARTNER_NOTE)}</p>` : '';
}
