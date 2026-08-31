/* Top-bar behaviour, shared by every page that includes .topbar.

   Home page (index.html): the bar carries [data-topbar-reveal] on a hero-height
   sentinel. It starts hidden so it never competes with the load-in animation;
   the first time the visitor scrolls past ~60% of the first screen it slides in,
   and from then on it just stays — scrolling back to the top does not hide it
   again. One-way latch, no scroll-direction tracking.

   Inner pages: no [data-topbar-reveal], so the reveal logic is skipped and the
   bar shows from load (its markup already has the `is-visible` class).

   Also marks the current page's link in the bar. */
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
