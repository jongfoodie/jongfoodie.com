// Strong Foodie: photos the app stores in Firestore, on the category pages.
//
// Places Strong Foodie adds in the app keep their photos as "fsimg://<id>"
// (a base64 image in the `images` collection) or as plain base64. A browser
// can't load those as an <img src>, so the cards stayed empty. The category
// pages (reviews, drink, shop, culture, health, hotel) now write their photo
// with window.sfSrc(url) and call window.sfHydrate(container) after a render;
// the gallery asks window.sfResolve(url) for the photo it shows.
//
//   import { initPhotos } from "./js/sf-photo-fix.js?v=1";
//   initPhotos(db);

import { photoTools } from "./sf-places.js?v=7";

// A 1×1 transparent gif, so the <img> doesn't fail before the real photo arrives.
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const attr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const stored = url => typeof url === 'string' && (url.startsWith('fsimg://') || /^[A-Za-z0-9+/=\s]{200,}$/.test(url));

let tools = null;
const resolve = url => (stored(url) && tools ? tools.resolvePhoto(url) : Promise.resolve(url || ''));

export function initPhotos(db) {
  tools = photoTools(db);
}

// The src attribute for a card photo.
window.sfSrc = url => stored(url) ? `src="${BLANK}" data-sfphoto="${attr(url)}"` : `src="${attr(url)}"`;

// Load the stored photos in a list that was just rendered.
window.sfHydrate = root => {
  if (!root) return;
  root.querySelectorAll('img[data-sfphoto]').forEach(img => {
    const url = img.getAttribute('data-sfphoto');
    img.removeAttribute('data-sfphoto');
    resolve(url).then(src => { if (src) img.src = src; else img.remove(); });
  });
};

// For the photo gallery.
window.sfResolve = resolve;
