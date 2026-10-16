// Strong Foodie: is a place open right now? The same rules as the app
// (Utilities/OpenHours.swift, build 25), used by the "Open now" filter on the
// category pages and the map, and by "Open now" / "Closed now" on a place.
//
// The hours are free text, written by Strong Foodie, by members or filled in
// from OpenStreetMap (js/sf-autofill.js). This reads English and Dutch:
//   "Mon–Fri 08:00–18:00 · Sat 10:00–16:00 · Sun closed", "Daily 12-22",
//   "ma-vr 9-17", "dagelijks 12.00 - 22.00", "11am–10pm", "24/7", "24 uur",
//   "Fri–Sat 18:00–02:00" (open after midnight), "Mon–Tue Closed".
// Hours it can't read count as unknown: the place is then left out when the
// filter is on, and the place page shows nothing extra.
//
// One difference with the app: the app uses the clock of the phone, the
// website uses the local time of the place when the country or city tells
// which time zone it is in (a place in Los Angeles, seen from Amsterdam).
// When that is not known, it uses the visitor's clock, like the app.

// The hours text of a place document, also from older field names.
export function hoursOf(r) {
  if (!r) return '';
  for (const k of ['hours', 'openingHours', 'opening_hours', 'hoursText', 'openingTimes']) {
    const v = r[k];
    if (Array.isArray(v)) { const s = v.filter(x => typeof x === 'string' && x.trim()).join(' · '); if (s) return s; }
    else if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

const DAY_NAMES = [
  ['sunday', 'zondag'], ['monday', 'maandag'], ['tuesday', 'dinsdag'], ['wednesday', 'woensdag'],
  ['thursday', 'donderdag'], ['friday', 'vrijdag'], ['saturday', 'zaterdag'],
];
const DAY_ALIAS = { weds: 3, thur: 4, thurs: 4, tues: 2, zat: 6, zon: 0, vrij: 5, don: 4 };
// A word as a day (0 = Sunday), or -1. "di", "Mon", "zaterdag", "Th"...
function dayOf(w) {
  if (w in DAY_ALIAS) return DAY_ALIAS[w];
  if (w.length < 2) return -1;
  for (let d = 0; d < 7; d++) if (DAY_NAMES[d].some(n => n.startsWith(w))) return d;
  return -1;
}
const ALL = [0, 1, 2, 3, 4, 5, 6];
const GROUPS = [
  [/^(daily|dagelijks|everyday|alledagen|elkedag|7days|7dagen|mon-sun|ma-zo)$/, ALL],
  [/^(weekdays|werkdagen|doordeweeks)$/, [1, 2, 3, 4, 5]],
  [/^(weekends?)$/, [0, 6]],
];
const span = (a, b) => { const out = []; for (let d = a; ; d = (d + 1) % 7) { out.push(d); if (d === b || out.length > 7) break; } return out; };

function minutes(h, m, ap) {
  h = +h; m = +(m || 0);
  if (ap === 'am') { if (h === 12) h = 0; }
  else if (ap === 'pm') { if (h < 12) h += 12; }
  if (h > 24 || m > 59) return null;
  return h * 60 + m;
}

// Text → { days: [[from, to] minutes, ...] x 7 } or null when it can't be read.
export function parseHours(text) {
  let s = String(text || '').toLowerCase();
  if (!s.trim()) return null;
  s = s.replace(/[–—−]/g, '-')
    .replace(/\b12\s*noon\b|\bnoon\b|\bmiddag\b/g, '12:00')
    .replace(/\bmidnight\b|\bmiddernacht\b/g, '24:00')
    .replace(/\b(t\/m|tot en met|through|thru|till|until|tot|to)\b/g, '-')
    .replace(/\b(every day|elke dag|alle dagen|7 days(?: a week)?|7 dagen(?: per week)?)\b/g, 'daily')
    .replace(/\bopen 24 hours\b|\b24 hours\b|\b24 uur\b|\b24\s*h\b|\b24\/7\b|\b24-7\b/g, ' allday ')
    .replace(/(\d)\s*(a\.?m\.?|p\.?m\.?)/g, (x, d, ap) => d + ap.replace(/\./g, ''))
    .replace(/(\d)\s*u\b/g, '$1');            // "17u" (Dutch for 17:00)

  const sched = ALL.map(() => []);
  const groups = [];                          // { days, times, closed } in the order of the text
  let global = [];                            // times with no days before them
  let cur = null;                             // the group the next times are for
  let skip = false, any = false, pendingClosed = false;

  const TIME = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?\s*-\s*(\d{1,2})(?:[:.](\d{2}))?(am|pm)?\+?/;
  let i = 0;
  const startDays = (days, keyword = false) => {
    // "Mon, Wed 12-14": one group. A new group after times, after "closed", after holidays,
    // and after "daily" or "weekdays" ("Open 7 days a week. Monday - Friday 7-10:30 ...").
    if (!cur || cur.times || cur.closed || cur.keyword || keyword || skip) { cur = { days: new Set(), times: false, closed: false, keyword }; groups.push(cur); }
    skip = false;
    days.forEach(d => cur.days.add(d));
    if (pendingClosed) { cur.closed = true; pendingClosed = false; }   // "closed Monday"
  };
  const addRange = (a, b) => {
    any = true;
    if (skip) return;
    if (!cur) { global.push([a, b]); return; }
    cur.days.forEach(d => sched[d].push([a, b]));
    cur.times = true;
  };
  while (i < s.length) {
    const rest = s.slice(i);
    const ws = rest.match(/^[\s,;:&|·•/()+]+/);
    if (ws) { i += ws[0].length; continue; }
    if (rest.startsWith('allday')) { addRange(0, 1440); i += 6; continue; }
    const t = rest.match(TIME);
    if (t) {
      let ap1 = t[3], ap2 = t[6];
      // "5-10pm" is 17-22, "11-10pm" is 11:00-22:00, "11am-2" is 11:00-14:00.
      if (!ap1 && ap2) ap1 = (+t[1] <= +t[4] && +t[4] !== 12) ? ap2 : 'am';
      // "10am-11" is 10:00-11:00, "11am-2" and "9am-5" end in the afternoon.
      if (ap1 && !ap2) ap2 = ap1 === 'am' && +t[4] > +t[1] && +t[4] < 12 ? 'am' : 'pm';
      const a = minutes(t[1], t[2], ap1), b = minutes(t[4], t[5], ap2);
      if (a != null && b != null) addRange(a, b === 0 ? 1440 : b);
      i += t[0].length; continue;
    }
    const w = rest.match(/^[a-zà-ÿ]+(?:-[a-zà-ÿ]+)?/);
    if (w) {
      const word = w[0];
      const grp = GROUPS.find(([re]) => re.test(word));
      if (grp) { startDays(grp[1], true); i += word.length; continue; }
      if (/^(closed|gesloten|dicht|off)$/.test(word)) {
        if (cur && !cur.times && !skip) cur.closed = true; else if (!skip) pendingClosed = true;
        i += word.length; continue;
      }
      if (/^(holidays?|feestdagen|ph|public)$/.test(word)) { cur = null; skip = true; i += word.length; continue; }
      // "mon-fri", "ma-vr", or one day
      const parts = word.split('-');
      const d1 = dayOf(parts[0]), d2 = parts[1] ? dayOf(parts[1]) : -1;
      if (d1 >= 0 && parts[1] && d2 >= 0) { startDays(span(d1, d2)); i += word.length; continue; }
      if (d1 >= 0 && !parts[1]) {
        // "Mon - Fri" with spaces around the dash
        const r2 = rest.slice(word.length).match(/^\s*-\s*([a-zà-ÿ]+)/);
        const d3 = r2 ? dayOf(r2[1]) : -1;
        if (d3 >= 0) { startDays(span(d1, d3)); i += word.length + r2[0].length; continue; }
        startDays([d1]); i += word.length; continue;
      }
      i += word.length; continue;          // any other word: "lunch", "kitchen", "open"
    }
    i += 1;
  }
  if (!any) return null;
  const named = new Set(), closed = new Set();
  groups.forEach(g => g.days.forEach(d => { named.add(d); if (g.closed) closed.add(d); }));
  // Days a group names without times ("5-10pm daily"), and days the text
  // doesn't name at all, get the times that came without days.
  groups.forEach(g => { if (!g.times && !g.closed) g.days.forEach(d => { if (!sched[d].length && !closed.has(d)) sched[d] = global.slice(); }); });
  ALL.forEach(d => { if (!named.has(d)) sched[d] = global.slice(); });
  if (!sched.some(r => r.length)) return null;
  return { days: sched };
}

// ── Time zones ──────────────────────────────────────────────────────────
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const BY_COUNTRY = [
  [/\b(netherlands|nederland|holland|nl)\b/, 'Europe/Amsterdam'],
  [/\b(aruba)\b/, 'America/Aruba'], [/\b(curacao|bonaire)\b/, 'America/Curacao'],
  [/\b(turkey|turkiye|turkije)\b/, 'Europe/Istanbul'],
  [/\b(uae|united arab emirates|emirates)\b/, 'Asia/Dubai'],
  [/\b(thailand)\b/, 'Asia/Bangkok'],
  [/\b(uk|united kingdom|england|scotland|great britain)\b/, 'Europe/London'],
  [/\b(spain|spanje)\b/, 'Europe/Madrid'], [/\b(france|frankrijk)\b/, 'Europe/Paris'],
  [/\b(italy|italie)\b/, 'Europe/Rome'], [/\b(germany|duitsland)\b/, 'Europe/Berlin'],
  [/\b(belgium|belgie)\b/, 'Europe/Brussels'], [/\b(portugal)\b/, 'Europe/Lisbon'],
  [/\b(greece|griekenland)\b/, 'Europe/Athens'], [/\b(morocco|marokko)\b/, 'Africa/Casablanca'],
  [/\b(japan)\b/, 'Asia/Tokyo'],
];
const BY_CITY = [
  [/\b(amsterdam|rotterdam|utrecht|den haag|the hague|haarlem|zwolle|alkmaar|amstelveen|overveen|bloemendaal|zandvoort|eindhoven|groningen|leiden)\b/, 'Europe/Amsterdam'],
  [/\b(los angeles|hollywood|santa monica|beverly hills|venice|san diego|la jolla|las vegas|san francisco)\b/, 'America/Los_Angeles'],
  [/\b(new york|brooklyn|manhattan|miami)\b/, 'America/New_York'], [/\b(chicago)\b/, 'America/Chicago'],
  [/\b(oranjestad|palm beach|eagle beach|noord|savaneta)\b/, 'America/Aruba'],
  [/\b(istanbul|antalya|izmir|bodrum|beykoz)\b/, 'Europe/Istanbul'], [/\b(dubai|abu dhabi)\b/, 'Asia/Dubai'],
  [/\b(bangkok|phuket)\b/, 'Asia/Bangkok'], [/\b(london)\b/, 'Europe/London'], [/\b(paris)\b/, 'Europe/Paris'],
  [/\b(barcelona|madrid|ibiza)\b/, 'Europe/Madrid'], [/\b(rome|milan|milaan|florence)\b/, 'Europe/Rome'],
  [/\b(berlin)\b/, 'Europe/Berlin'], [/\b(lisbon|lissabon|porto)\b/, 'Europe/Lisbon'], [/\b(athens)\b/, 'Europe/Athens'],
  [/\b(marrakech|marrakesh)\b/, 'Africa/Casablanca'], [/\b(tokyo|osaka|kyoto)\b/, 'Asia/Tokyo'], [/\b(bali|ubud|canggu|seminyak)\b/, 'Asia/Makassar'],
];
// The time zone of a place, or '' when it can't be told (then the visitor's clock is used).
export function zoneOf(r) {
  if (!r) return '';
  const country = fold(r.country || r.countryLabel || '');
  const where = fold([r.city, r.address, r.destination, r.town].filter(x => typeof x === 'string').join(', '));
  const lng = typeof r.lng === 'number' ? r.lng : null;
  if (/\b(usa|us|united states|america|verenigde staten)\b/.test(country) || /\b(usa|united states)\b|, (ca|nv|ny|fl)\b/.test(where)) {
    const c = BY_CITY.find(([re]) => re.test(where));
    if (c && c[1].startsWith('America/')) return c[1];
    if (lng != null) return lng <= -114 ? 'America/Los_Angeles' : lng <= -102 ? 'America/Denver' : lng <= -87 ? 'America/Chicago' : 'America/New_York';
    return '';
  }
  if (/\b(indonesia|indonesie)\b/.test(country)) return lng != null && lng < 114.5 ? 'Asia/Jakarta' : 'Asia/Makassar';
  const k = BY_COUNTRY.find(([re]) => re.test(country));
  if (k) return k[1];
  const c = BY_CITY.find(([re]) => re.test(where));
  if (c) return c[1];
  return '';
}

// Day (0 = Sunday) and minutes since midnight at `now`, in a time zone ('' = the visitor's clock).
function clock(now, zone) {
  if (zone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
      const get = t => (parts.find(p => p.type === t) || {}).value;
      const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
      const h = +get('hour') % 24, m = +get('minute');
      if (day >= 0 && !isNaN(h) && !isNaN(m)) return { day, min: h * 60 + m };
    } catch (e) { /* unknown zone: the visitor's clock */ }
  }
  return { day: now.getDay(), min: now.getHours() * 60 + now.getMinutes() };
}

export function isOpenAt(parsed, day, min) {
  if (!parsed) return null;
  const today = parsed.days[day], yday = parsed.days[(day + 6) % 7];
  for (const [a, b] of today) {
    if (b > a ? (min >= a && min < b) : min >= a) return true;   // b <= a: until after midnight
  }
  for (const [a, b] of yday) if (b <= a && b < 1440 && min < b) return true;  // yesterday's late hours
  return false;
}

// 'open', 'closed', or null when it isn't known. `r` is a place document (or
// a place object with hours, closedStatus, country, city, address, lat, lng).
export function openState(r, now = new Date()) {
  if (!r) return null;
  const cs = String(r.closedStatus || 'open').toLowerCase();
  const parsed = parseHours(hoursOf(r));
  if (!parsed) return null;
  if (cs !== 'open') return 'closed';
  const { day, min } = clock(now, zoneOf(r));
  return isOpenAt(parsed, day, min) ? 'open' : 'closed';
}
export const isOpenNow = (r, now) => openState(r, now) === 'open';
