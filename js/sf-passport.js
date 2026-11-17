// Strong Foodie: the Foodie passport (17 Nov 2026). One stamp per destination where a
// member has been. A place counts when they marked it Been there (beenThere and
// beenPlaces), wrote a review of it (userReviews) or added it as a spot (userPlaces).
// The same rules as the passport in the app (Rork batch 85). Only the member reads
// their own documents, so no new Firestore rules are needed.

import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { toDate, loadPlaces, locate, fold } from "./sf-places.js?v=7";

// Country (as countryOf in sf-core writes it) → continent. Unknown countries count
// for the country, not for a continent.
const CONTINENTS = {
  Europe: ['Netherlands', 'Belgium', 'Germany', 'France', 'Spain', 'Portugal', 'Italy', 'Greece', 'United Kingdom', 'Ireland',
    'Austria', 'Switzerland', 'Denmark', 'Sweden', 'Norway', 'Finland', 'Iceland', 'Poland', 'Czech Republic', 'Czechia', 'Hungary',
    'Croatia', 'Slovenia', 'Slovakia', 'Romania', 'Bulgaria', 'Serbia', 'Albania', 'Montenegro', 'Bosnia And Herzegovina',
    'North Macedonia', 'Luxembourg', 'Monaco', 'Malta', 'Cyprus', 'Estonia', 'Latvia', 'Lithuania', 'Ukraine', 'Turkey'],
  'North America': ['United States', 'Canada', 'Mexico', 'Aruba', 'Curacao', 'Curaçao', 'Bonaire', 'Sint Maarten', 'Jamaica',
    'Bahamas', 'Dominican Republic', 'Cuba', 'Puerto Rico', 'Costa Rica', 'Panama', 'Barbados', 'Trinidad And Tobago'],
  'South America': ['Brazil', 'Argentina', 'Chile', 'Peru', 'Colombia', 'Ecuador', 'Uruguay', 'Paraguay', 'Bolivia', 'Venezuela', 'Suriname'],
  Asia: ['Thailand', 'Japan', 'Indonesia', 'China', 'Hong Kong', 'Singapore', 'Malaysia', 'Vietnam', 'Philippines', 'South Korea',
    'Korea', 'Taiwan', 'India', 'Sri Lanka', 'Nepal', 'Maldives', 'Cambodia', 'Laos', 'United Arab Emirates', 'Qatar', 'Saudi Arabia',
    'Oman', 'Bahrain', 'Kuwait', 'Jordan', 'Israel', 'Lebanon', 'Georgia', 'Armenia', 'Azerbaijan', 'Kazakhstan', 'Uzbekistan'],
  Africa: ['Morocco', 'Egypt', 'Tunisia', 'South Africa', 'Kenya', 'Tanzania', 'Ghana', 'Nigeria', 'Senegal', 'Ethiopia', 'Mauritius', 'Cape Verde'],
  Oceania: ['Australia', 'New Zealand', 'Fiji'],
};
const CONTINENT_OF = new Map();
Object.entries(CONTINENTS).forEach(([c, list]) => list.forEach(k => CONTINENT_OF.set(fold(k), c)));
export const continentOf = country => CONTINENT_OF.get(fold(country)) || '';

const read = (label, q) => getDocs(q).then(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
  .catch(e => { console.log(label + ' not read:', e.code || e); return []; });

// The catalogue is read once per page, also when the passport is counted again.
let placesP = null;
const catalogue = db => placesP || (placesP = loadPlaces(db).catch(() => { placesP = null; return { all: [] }; }));

export async function readPassportData(db, uid) {
  const [reviews, spots, beenSf, beenOther, loaded] = await Promise.all([
    read('reviews', query(collection(db, 'userReviews'), where('authorId', '==', uid))),
    read('spots', query(collection(db, 'userPlaces'), where('addedByUserId', '==', uid))),
    read('been there', collection(db, 'profiles', uid, 'beenThere')),
    read('been there, not on Strong Foodie', collection(db, 'profiles', uid, 'beenPlaces')),
    catalogue(db),
  ]);
  return { reviews, spots, beenSf, beenOther, all: loaded.all || [] };
}

// Pure: from the documents to the stamps. Tested in snaptest/passport.mjs.
export function buildPassport({ reviews = [], spots = [], beenSf = [], beenOther = [], all = [] }) {
  const byKey = new Map(all.map(p => [`${p.coll}/${p.id}`, p]));
  // The country of a destination, as most catalogue places there say it.
  const destCountry = new Map();
  all.forEach(p => {
    if (!p.destination || !p.country) return;
    const m = destCountry.get(p.destination) || new Map();
    m.set(p.country, (m.get(p.country) || 0) + 1);
    destCountry.set(p.destination, m);
  });
  const countryFor = (dest, own) => {
    if (own) return own;
    const m = destCountry.get(dest);
    return m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : '';
  };

  // One entry per place (a place you reviewed and marked Been there counts once),
  // with the earliest date of the three.
  const places = new Map();
  const note = (key, when, where) => {
    if (!key) return;
    const d = toDate(when);
    const cur = places.get(key);
    if (!cur) { places.set(key, { date: d, dest: where.destination || '', country: where.country || '' }); return; }
    if (d && (!cur.date || d < cur.date)) cur.date = d;
    if (!cur.dest && where.destination) { cur.dest = where.destination; cur.country = where.country || cur.country; }
  };
  const fromCatalogue = (key, fallback) => {
    const p = byKey.get(key);
    if (p && (p.destination || p.town)) return { destination: p.destination || p.town, country: p.country };
    return fallback();
  };

  beenSf.forEach(b => {
    const key = b.placeKey || (b.placeCollection && b.placeDocId ? `${b.placeCollection}/${b.placeDocId}` : '');
    note(key, b.createdAt, fromCatalogue(key, () => locate(b.city, b.country)));
  });
  beenOther.filter(b => b.name).forEach(b => {
    note('beenPlaces/' + b.id, b.createdAt, locate([b.address, b.city].filter(Boolean).join(', ') || b.city, b.country));
  });
  reviews.forEach(r => {
    const key = r.placeCollection && r.placeDocId ? `${r.placeCollection}/${r.placeDocId}` : 'userReviews/' + r.id;
    note(key, r.createdAt, fromCatalogue(key, () => locate(r.placeCity || r.city || r.placeAddress, r.placeCountry || r.country)));
  });
  spots.forEach(s => {
    const key = 'userPlaces/' + s.id;
    note(key, s.createdAt, fromCatalogue(key, () => locate([s.address, s.city].filter(Boolean).join(', ') || s.city, s.country)));
  });

  // Places → stamps, one per destination.
  const stamps = new Map();
  places.forEach(x => {
    if (!x.dest) return;
    const k = fold(x.dest);
    const s = stamps.get(k) || { destination: x.dest, country: '', first: null, count: 0 };
    s.count++;
    if (x.date && (!s.first || x.date < s.first)) s.first = x.date;
    if (!s.country && x.country) s.country = x.country;
    stamps.set(k, s);
  });
  const list = [...stamps.values()].map(s => ({ ...s, country: countryFor(s.destination, s.country) }));
  // Newest stamp first; a stamp without a date last.
  list.sort((a, b) => ((b.first || 0) - (a.first || 0)) || (b.count - a.count) || a.destination.localeCompare(b.destination));
  const countries = new Set(list.map(s => s.country).filter(Boolean));
  const continents = new Set([...countries].map(continentOf).filter(Boolean));
  return { stamps: list, places: places.size, cities: list.length, countries: countries.size, continents: continents.size };
}

export async function loadPassport(db, uid) {
  return buildPassport(await readPassportData(db, uid));
}

export const monthYear = d => d ? d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const passportLine = x => [plural(x.cities, 'city', 'cities'), plural(x.countries, 'country', 'countries'), plural(x.places, 'place', 'places')].join(' · ');
