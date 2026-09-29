/* Top-bar behaviour, shared by every page that includes .topbar.

   Home page (index.html): the bar carries [data-topbar-reveal] on a hero-height
   sentinel. It starts hidden so it never competes with the load-in animation;
   the first time the visitor scrolls past ~60% of the first screen it slides in,
   and from then on it just stays — scrolling back to the top does not hide it
   again. One-way latch, no scroll-direction tracking.

   Inner pages: no [data-topbar-reveal], so the reveal logic is skipped and the
   bar shows from load (its markup already has the `is-visible` class).

   Also marks the current page's link in the bar. */
/* Dev-only theme switch. Shown on local addresses (or with ?dev in the URL),
   never on notealise.com: cycles System → Light → Dark so every page can be
   checked in both (Reuben, 2026-09-14). The choice is remembered in this
   browser and applied before paint by the one-line script in each page's
   <head>; System removes it and the page follows the visitor's setting. */
(function () {
  var host = location.hostname;
  var local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(host) ||
    /\.local$/.test(host) ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (!local && !/[?&]dev(=|&|$)/.test(location.search)) return;

  var KEY = 'nl-site-theme';
  var ORDER = ['system', 'light', 'dark'];
  var root = document.documentElement;
  function read() { try { return localStorage.getItem(KEY) || 'system'; } catch (e) { return 'system'; } }
  function apply(mode) {
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    try { mode === 'system' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, mode); } catch (e) {}
    btn.innerHTML = '<b>Theme</b>' + mode.charAt(0).toUpperCase() + mode.slice(1);
  }
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dev-theme';
  btn.setAttribute('aria-label', 'Switch site theme (dev only)');
  btn.addEventListener('click', function () {
    apply(ORDER[(ORDER.indexOf(read()) + 1) % ORDER.length]);
  });
  document.body.appendChild(btn);
  apply(read());
})();

(function () {
  var bar = document.querySelector('.topbar');
  if (!bar) return;

  // Mark the active link.
  var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  var links = bar.querySelectorAll('.topbar-links a');
  for (var i = 0; i < links.length; i++) {
    var target = (links[i].getAttribute('href') || '').split('/').pop().toLowerCase();
    if (target && target === here) {
      links[i].classList.add('is-active');
      links[i].setAttribute('aria-current', 'page');
    }
  }

  // Phone only (nav.css shows the button below 620px wide): the social icons
  // fold into one circle wearing the Instagram logo. Built here rather than in
  // each page's markup, so it can't be missed on a page — and the logo is
  // copied from the Instagram link, so its path lives in one place. With no
  // script the phone bar simply has no icons, as it did before.
  var social = bar.querySelector('.topbar-social');
  var ig = social && social.querySelector('a[href*="instagram.com"] svg');
  if (social && ig) {
    social.id = 'topbar-social';
    // The drop-down's open height is worked out from this (nav.css), so a fifth
    // icon later needs no CSS change.
    social.style.setProperty('--n', String(social.children.length));
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'social-toggle';
    toggle.setAttribute('aria-label', 'Notealise on social media');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'topbar-social');
    var glyph = ig.cloneNode(true);
    glyph.setAttribute('class', 'st-ig');
    toggle.appendChild(glyph);
    toggle.insertAdjacentHTML('beforeend',
      '<svg class="st-x" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>');
    // Before the icons, so the keyboard reaches the circle first, then the list.
    bar.insertBefore(toggle, social);

    var setOpen = function (open) {
      bar.classList.toggle('social-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    var isOpen = function () { return bar.classList.contains('social-open'); };

    toggle.addEventListener('click', function () { setOpen(!isOpen()); });
    // Choosing an icon closes the list (the link itself opens in a new tab).
    social.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a')) setOpen(false);
    });
    // A tap anywhere else closes it. pointerdown, not click: iOS Safari does
    // not send a click to the document for a tap on plain page text.
    document.addEventListener('pointerdown', function (e) {
      if (isOpen() && !bar.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) { setOpen(false); toggle.focus(); }
    });
    // Turning the phone sideways past the phone width shows the icons in the
    // bar again; don't carry an "open" state across.
    if (window.matchMedia) {
      var phone = window.matchMedia('(max-width: 620px)');
      var onWidth = function () { if (!phone.matches) setOpen(false); };
      if (phone.addEventListener) phone.addEventListener('change', onWidth);
      else if (phone.addListener) phone.addListener(onWidth);
    }
  }

  var sentinel = document.querySelector('[data-topbar-reveal]');
  if (!sentinel) {
    bar.classList.add('is-visible');
    return;
  }

  var revealed = false;
  function reveal() {
    if (revealed) return;
    revealed = true;
    bar.classList.add('is-visible');
    document.documentElement.classList.add('topbar-in');
    window.removeEventListener('scroll', onScroll);
  }

  function threshold() {
    return Math.min(window.innerHeight * 0.6, 460);
  }
  function onScroll() {
    if (window.scrollY > threshold()) reveal();
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // handle a reload partway down the page
})();
