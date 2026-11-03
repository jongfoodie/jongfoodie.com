// sf-nl-prompt.js: asks for an email only after the visitor has looked around.
//
// Feedback from a tester: "why would I give my email when I don't know what it
// offers yet?" So no popup on the first page. The card shows once the visitor
// has opened 2 place pages, or has spent 5 minutes on the site, and has been on
// the current page for at least 10 seconds.
//
// - "No thanks" or ×: not again for 30 days.
// - Subscribed, or came from Substack: never again on this browser.
// - Never while the cookie banner, a search dropdown or a text field is in use.
// - The email goes to Substack (strongfoodie.substack.com), like the form on Home.
// - Stored on the device: localStorage "sf_nl" = place pages seen, seconds, and
//   the choice. Nothing is sent anywhere until the visitor subscribes.
(function () {
  var KEY = 'sf_nl', PLACES = 2, SECS = 300, ON_PAGE = 10, SNOOZE_DAYS = 30;
  var st;
  try { st = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }

  var q = new URLSearchParams(location.search);
  if (/substack/i.test(q.get('utm_source') || '') || /substack\.com/i.test(document.referrer)) { st.done = 'reader'; save(); }
  if (st.done) return;
  if (st.snooze && Date.now() < st.snooze) return;

  var path = location.pathname;
  if (/^\/p\/[^/]+\/?$/.test(path) || /\/plek\.html$/.test(path)) { st.places = (st.places || 0) + 1; save(); }

  var onPage = 0, shown = false;
  var ready = function () { return (st.places || 0) >= PLACES || (st.secs || 0) >= SECS; };
  function busy() {
    var cb = document.getElementById('cookieBanner');
    if (cb && getComputedStyle(cb).display !== 'none') return true;
    if (document.querySelector('.search-results:not([hidden])')) return true;
    var a = document.activeElement;
    return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }

  var timer = setInterval(function () {
    if (document.hidden) return;
    onPage += 5; st.secs = (st.secs || 0) + 5; save();
    if (!shown && onPage >= ON_PAGE && ready() && !busy()) show();
  }, 5000);

  function close(snooze) {
    if (snooze) { st.snooze = Date.now() + SNOOZE_DAYS * 864e5; save(); }
    var el = document.getElementById('sfNlp');
    if (el) { el.classList.remove('in'); setTimeout(function () { el.remove(); }, 300); }
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(true); }

  function show() {
    shown = true; clearInterval(timer);
    var css = document.createElement('style');
    css.textContent =
      '.sf-nlp{position:fixed;right:20px;bottom:20px;z-index:9500;width:340px;max-width:calc(100vw - 24px);background:#E8F2EC;border:1px solid rgba(45,90,61,0.25);border-radius:16px;padding:1.1rem 1.1rem 0.9rem;box-shadow:0 12px 32px rgba(26,18,8,0.18);font-family:"DM Sans",sans-serif;color:#2D5A3D;opacity:0;transform:translateY(16px);transition:opacity .3s,transform .3s}' +
      '.sf-nlp.in{opacity:1;transform:none}' +
      '.sf-nlp-t{font-family:"Playfair Display",serif;font-size:19px;font-weight:700;color:#1A1208;margin:0 1.5rem 0.35rem 0}' +
      '.sf-nlp-p{font-size:13.5px;line-height:1.5;margin:0 0 0.75rem}' +
      '.sf-nlp form{display:flex;gap:6px}' +
      '.sf-nlp input{flex:1;min-width:0;border:1px solid rgba(45,90,61,0.3);border-radius:22px;padding:9px 14px;font:inherit;font-size:14px;background:#fff;color:#1A1208}' +
      '.sf-nlp form button{border:none;border-radius:22px;padding:9px 16px;background:#2D5A3D;color:#fff;font:500 14px "DM Sans",sans-serif;cursor:pointer}' +
      '.sf-nlp-x{position:absolute;top:8px;right:10px;background:none;border:none;font-size:22px;line-height:1;color:#2D5A3D;cursor:pointer;padding:4px}' +
      '.sf-nlp-no{display:block;margin:0.6rem auto 0;background:none;border:none;font:400 12.5px "DM Sans",sans-serif;color:#2D5A3D;text-decoration:underline;cursor:pointer}' +
      '@media (max-width:600px){.sf-nlp{left:12px;right:12px;bottom:12px;width:auto;max-width:none}}';
    document.head.appendChild(css);
    var el = document.createElement('div');
    el.className = 'sf-nlp'; el.id = 'sfNlp';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-labelledby', 'sfNlpT');
    el.innerHTML =
      '<button class="sf-nlp-x" type="button" aria-label="Close">×</button>' +
      '<p class="sf-nlp-t" id="sfNlpT">Like what you see?</p>' +
      '<p class="sf-nlp-p">New reviews and what I\'m building, by email. Free, on Substack.</p>' +
      '<form action="https://strongfoodie.substack.com/api/v1/free?nojs=true" method="post" target="_blank">' +
      '<input type="email" name="email" autocomplete="email" placeholder="your@email.com" aria-label="Your email address" required>' +
      '<button type="submit">Subscribe</button></form>' +
      '<button class="sf-nlp-no" type="button">No thanks</button>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('in'); });
    el.querySelector('.sf-nlp-x').addEventListener('click', function () { close(true); });
    el.querySelector('.sf-nlp-no').addEventListener('click', function () { close(true); });
    el.querySelector('form').addEventListener('submit', function () {
      st.done = 'subscribed'; save();
      if (window.gtag) gtag('event', 'sign_up', { method: 'newsletter_prompt' });
      setTimeout(function () {
        el.innerHTML = '<p class="sf-nlp-t">Thanks.</p><p class="sf-nlp-p" style="margin:0">Check your inbox to confirm.</p>';
        setTimeout(function () { close(false); }, 4000);
      }, 300);
    });
    document.addEventListener('keydown', onKey);
    if (window.gtag) gtag('event', 'newsletter_prompt_shown');
  }
})();
