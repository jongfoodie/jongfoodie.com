// Strong Foodie: half stars in the admin star pickers (admin.html).
//
// Tap the left half of a star for a half star, the right half for a full star.
// Below the stars: "4.5 out of 5". Saved as a number in the same field (rating: 4.5).
// Only works when HALF_STARS_ON is true in js/sf-flags.js.
import { HALF_STARS_ON } from "./sf-flags.js?v=3";

const css = `
.star-select span.half { background: linear-gradient(90deg, #C8901A 50%, #D4C4A8 50%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sf-rate-val { display: block; margin-top: 4px; font-size: 12px; color: var(--muted, #8A7A66); }`;

function paint(box, v) {
  const n = Number(v) || 0, full = Math.floor(n), half = n - full >= 0.5;
  box.querySelectorAll('span[onclick]').forEach((s, i) => {
    s.classList.toggle('lit', i < full);
    s.classList.toggle('half', half && i === full);
  });
  let label = box.parentElement.querySelector('.sf-rate-val');
  if (!label) { label = document.createElement('span'); label.className = 'sf-rate-val'; box.after(label); }
  label.textContent = n ? `${String(n).replace('.0', '')} out of 5` : '';
}

function setup() {
  document.querySelectorAll('.star-select').forEach(box => {
    const first = box.querySelector('span[onclick]');
    const m = first && first.getAttribute('onclick').match(/^(\w+)\(/);
    if (!m) return;
    const name = m[1];
    if (!box.parentElement.querySelector('.sf-rate-val')) { const hint = document.createElement('span'); hint.className = 'sf-rate-val'; hint.textContent = 'Tap the left half of a star for a half star.'; box.after(hint); }
    const orig = window[name];
    if (typeof orig !== 'function' || orig.__half) return;
    // Every way the rating is set (a tap, or loading a review to edit) paints the half star.
    const wrapped = v => { orig(v); paint(box, v); };
    wrapped.__half = true;
    window[name] = wrapped;
    // Taps: left half of a star gives n - 0.5.
    box.addEventListener('click', e => {
      const star = e.target.closest('span[onclick]');
      if (!star || !box.contains(star)) return;
      e.stopPropagation(); e.preventDefault();
      const n = Number(star.getAttribute('onclick').match(/\((\d+)\)/)[1]);
      const r = star.getBoundingClientRect();
      window[name](e.clientX - r.left < r.width / 2 ? n - 0.5 : n);
    }, true);
  });
}

if (HALF_STARS_ON) {
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  // admin.html defines the setters in its own module script, which runs first.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
  window.addEventListener('load', setup);
}
