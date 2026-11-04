// sf-admin-nav.js: one admin menu on every admin page (Dutch, only the admin sees it).
//
// Before, admin.html had 17 links on one row and every admin page had its own
// small menu. This script replaces the header of the page (.admin-nav on
// admin.html, .top on the other admin pages) with the same header everywhere,
// and a menu in groups: on a wide screen on the left, on a phone behind "Menu".
//
// Badges (Meldingen, Claims, Correcties) come from the "Te doen" block on
// admin.html, which keeps the counts in sessionStorage "sf_admin_counts".
(function () {
  var GROUPS = [
    ['Start', [['admin.html#todo', '✅', 'Te doen']]],
    ['Plekken', [
      ['admin.html#eatSection', '➕', 'Plek toevoegen'],
      ['admin-dates.html', '📅', 'Bezoekdata'],
      ['admin-duplicates.html', '🔁', 'Dubbele plekken'],
      ['admin-edits.html', '✏️', 'Correcties', 'edits']]],
    ['Lijsten en pagina’s', [
      ['list-edit.html', '🏆', 'Lijsten'],
      ['guide-edit.html', '📖', 'Gidsen'],
      ['dish-edit.html', '🍴', 'Gerechten'],
      ['admin-home.html', '🏠', 'Homepage'],
      ['admin-battles.html', '⚔️', 'Battles'],
      ['admin-openings.html', '🆕', 'Nieuwe openingen']]],
    ['Leden', [
      ['admin-members.html', '👥', 'Leden'],
      ['admin-reports.html', '🚩', 'Meldingen', 'reports'],
      ['admin-claims.html', '🏪', 'Claims', 'claims']]],
    ['Geld', [
      ['admin-ads.html', '📣', 'Advertenties'],
      ['admin-booking.html', '🛎️', 'Boekingen'],
      ['admin-deals.html', '🎟️', 'Deals']]],
    ['Cijfers', [
      ['admin-stats.html', '📊', 'Statistieken'],
      ['admin-report.html', '📈', 'Rapport per plek'],
      ['admin-export.html', '⬇️', 'Export']]],
    ['Instellingen', [['admin.html#socialSettings', '⚙️', 'Social accounts']]]
  ];

  var CSS =
    '.sfa-top{position:sticky;top:0;z-index:900;background:#1A1208;color:#fff;height:56px;display:flex;align-items:center;gap:14px;padding:0 20px;font-family:"DM Sans",sans-serif}' +
    '.sfa-brand{color:#fff;text-decoration:none;font:700 20px "Playfair Display",serif;white-space:nowrap}' +
    '.sfa-brand span{font:700 11px "DM Sans",sans-serif;letter-spacing:.14em;color:#D4521A;margin-left:6px}' +
    '.sfa-page{color:rgba(255,255,255,.6);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.sfa-sp{flex:1}' +
    '.sfa-site{color:rgba(255,255,255,.75);font-size:13.5px;text-decoration:none;white-space:nowrap}' +
    '.sfa-top #signOutBtn{margin:0}' +
    '.sfa-menu-btn{display:none;white-space:nowrap;flex-shrink:0;background:none;border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:16px;padding:5px 12px;font:500 13px "DM Sans",sans-serif;cursor:pointer}' +
    '.sfa-side{position:fixed;top:56px;left:0;bottom:0;width:228px;overflow-y:auto;background:#FFFDF9;border-right:1px solid rgba(26,18,8,.1);padding:14px 10px 30px;z-index:800;font-family:"DM Sans",sans-serif}' +
    '.sfa-side p{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#8A7A66;font-weight:700;margin:14px 10px 5px}' +
    '.sfa-side p:first-child{margin-top:0}' +
    '.sfa-side a{display:flex;align-items:center;gap:9px;padding:6px 10px;border-radius:9px;font-size:14px;color:#3D2F1A;text-decoration:none;line-height:1.35}' +
    '.sfa-side a:hover{background:#F3EEE6}' +
    '.sfa-side a.on{background:#1A1208;color:#fff}' +
    '.sfa-side a b{margin-left:auto;background:#D4521A;color:#fff;font-size:11px;border-radius:10px;padding:1px 7px}' +
    '.sfa-shade{display:none}' +
    'body.sfa{padding-left:228px}body.sfa .sfa-top{margin-left:-228px}' +
    '@media (max-width:1099px){body.sfa{padding-left:0}body.sfa .sfa-top{margin-left:0}.sfa-menu-btn{display:inline-block}.sfa-page{display:none}' +
    '.sfa-side{transform:translateX(-105%);transition:transform .2s;width:270px;box-shadow:0 0 30px rgba(26,18,8,.2)}' +
    'body.sfa-open .sfa-side{transform:none}' +
    'body.sfa-open .sfa-shade{display:block;position:fixed;inset:56px 0 0 0;background:rgba(26,18,8,.35);z-index:790}}' +
    '@media (max-width:600px){.sfa-top{padding:0 12px;gap:10px}.sfa-site{display:none}}';

  function here() {
    var file = location.pathname.split('/').pop() || 'index.html';
    var hash = location.hash;
    var best = null;
    GROUPS.forEach(function (g) {
      g[1].forEach(function (it) {
        var parts = it[0].split('#'), f = parts[0], h = parts[1] ? '#' + parts[1] : '';
        if (f !== file) return;
        if (h && hash === h) best = it;
        else if (!best && (!h || h === '#todo')) best = it;
      });
    });
    return best;
  }

  function counts() {
    try { return JSON.parse(sessionStorage.getItem('sf_admin_counts') || '{}') || {}; } catch (e) { return {}; }
  }

  function badges() {
    var c = counts();
    document.querySelectorAll('.sfa-side a[data-count]').forEach(function (a) {
      var n = c[a.getAttribute('data-count')] || 0, b = a.querySelector('b');
      if (n && !b) { b = document.createElement('b'); a.appendChild(b); }
      if (b) { if (n) b.textContent = n; else b.remove(); }
    });
  }
  window.sfAdminNavBadges = badges;

  function mark() {
    var cur = here();
    document.querySelectorAll('.sfa-side a').forEach(function (a) { a.classList.toggle('on', !!cur && a.getAttribute('href') === cur[0]); });
    var page = document.querySelector('.sfa-page');
    if (page) page.textContent = cur ? cur[2] : '';
    // A link to a folded section (like Social accounts) opens it.
    var target = location.hash && document.getElementById(location.hash.slice(1));
    if (target && target.tagName === 'DETAILS') target.open = true;
  }

  function build() {
    var old = document.querySelector('.admin-nav') || document.querySelector('body > .top') || document.querySelector('.top');
    var style = document.createElement('style');
    style.id = 'sf-admin-nav';
    style.textContent = CSS;
    document.head.appendChild(style);

    var top = document.createElement('header');
    top.className = 'sfa-top';
    top.innerHTML = '<button class="sfa-menu-btn" type="button" aria-expanded="false" aria-controls="sfaSide">☰ Menu</button>' +
      '<a class="sfa-brand" href="admin.html#todo">Strong Foodie<span>ADMIN</span></a>' +
      '<span class="sfa-page"></span><span class="sfa-sp"></span>' +
      '<a class="sfa-site" href="index.html" target="_blank" rel="noopener">Naar de website ↗</a>';
    var signOut = old && old.querySelector('#signOutBtn');
    if (signOut) { signOut.textContent = 'Uitloggen'; top.appendChild(signOut); }

    var side = document.createElement('nav');
    side.className = 'sfa-side'; side.id = 'sfaSide';
    side.setAttribute('aria-label', 'Admin-menu');
    side.innerHTML = GROUPS.map(function (g) {
      return '<p>' + g[0] + '</p>' + g[1].map(function (it) {
        return '<a href="' + it[0] + '"' + (it[3] ? ' data-count="' + it[3] + '"' : '') + '><span>' + it[1] + '</span>' + it[2] + '</a>';
      }).join('');
    }).join('');
    var shade = document.createElement('div');
    shade.className = 'sfa-shade';

    if (old) old.replaceWith(top); else document.body.prepend(top);
    top.after(side, shade);
    document.body.classList.add('sfa');

    var btn = top.querySelector('.sfa-menu-btn');
    var setOpen = function (open) { document.body.classList.toggle('sfa-open', open); btn.setAttribute('aria-expanded', String(open)); };
    btn.addEventListener('click', function () { setOpen(!document.body.classList.contains('sfa-open')); });
    shade.addEventListener('click', function () { setOpen(false); });
    side.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    window.addEventListener('hashchange', mark);
    mark(); badges();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
