// Strong Foodie: switches for whole features.
//
// PRO_ON: Strong Foodie launches without Pro (6 October 2026). While this is false the
// website shows nothing about Pro: no Pro deals row on place pages, no Pro months for
// invites on the account page, and deals.html says the deals come later (and has a
// noindex tag; remove it when this goes back to true). Invites are still recorded,
// so friends who join now still count when Pro comes back. The app has the same switch.
export const PRO_ON = false;

// HALF_STARS_ON: half stars (4.5) in the admin star pickers. The website already shows
// 4.5 as four and a half stars everywhere. Keep this false until app version 1.0.5 is live:
// the app reads 4.5 from that version on (Rork batch 76). Then set it to true.
export const HALF_STARS_ON = false;
