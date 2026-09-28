/* What's new (updates.html). Two things:

   1. Each release card settles into place as it scrolls into view ("placed
      down", reference/05-brand-feel.md's motion map).
   2. Pressing a card opens its whole list in a pop-up the way Settings opens in
      the app: the page behind fades to a soft blur, and the sheet grows out of
      the card itself — Settings grows out of its gear, with these same curves
      (app.css .genie) — its words fading in once it has landed. Closing runs it
      back into the card. Escape, the cross, or a click on the blurred page close
      it. Styles: updates.css. */
(function () {
  var cards = [].slice.call(document.querySelectorAll('.rel'));
  if (!cards.length) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { threshold: 0.12 });
    cards.forEach(function (c) { io.observe(c); });
  } else {
    cards.forEach(function (c) { c.classList.add('is-in'); });
  }

  var dlg = document.querySelector('.rel-dialog');
  if (!dlg || typeof dlg.showModal !== 'function' || typeof dlg.animate !== 'function') {
    document.documentElement.classList.add('rel-flat');
    return;
  }
  var slot = {
    meta: dlg.querySelector('[data-slot="meta"]'),
    title: dlg.querySelector('[data-slot="title"]'),
    body: dlg.querySelector('[data-slot="body"]')
  };
  var inner = [dlg.querySelector('.rel-dialog-head'), slot.body];
  var from = null;
  var running = [];
  var safety = 0;

  function stop() {
    running.forEach(function (a) { a.cancel(); });
    running = [];
  }

  // Where the card sits relative to the pop-up, as the transform that puts the
  // pop-up exactly over it. Measured with nothing animating.
  function overCard(card) {
    var c = card.getBoundingClientRect();
    var d = dlg.getBoundingClientRect();
    var dx = c.left + c.width / 2 - (d.left + d.width / 2);
    var dy = c.top + c.height / 2 - (d.top + d.height / 2);
    return 'translate(' + dx + 'px, ' + dy + 'px) scale(' + c.width / d.width + ', ' + c.height / d.height + ')';
  }

  function open(card) {
    if (dlg.open) return;
    from = card;
    slot.meta.innerHTML = card.querySelector('.rel-meta').innerHTML;
    slot.title.innerHTML = card.querySelector('.rel-title').innerHTML;
    slot.body.textContent = '';
    slot.body.appendChild(card.querySelector('.rel-list').cloneNode(true));
    dlg.classList.remove('is-closing');
    document.documentElement.classList.add('rel-lock');
    dlg.showModal();
    slot.body.scrollTop = 0;
    stop();
    if (reduce.matches) {
      running = [dlg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' })];
    } else {
      running = [
        dlg.animate([{ transform: overCard(card) }, { transform: 'none' }],
          { duration: 460, easing: 'cubic-bezier(0.22, 1.2, 0.36, 1)' })
      ].concat(inner.map(function (el) {
        return el.animate([{ opacity: 0 }, { opacity: 1 }],
          { duration: 220, delay: 150, easing: 'cubic-bezier(0.33, 1, 0.68, 1)', fill: 'backwards' });
      }));
    }
    card.classList.add('is-lifted');
  }

  function close() {
    if (!dlg.open || dlg.classList.contains('is-closing')) return;
    stop();
    dlg.classList.add('is-closing');
    var main;
    if (reduce.matches || !from) {
      main = dlg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' });
      running = [main];
    } else {
      main = dlg.animate([{ transform: 'none' }, { transform: overCard(from) }],
        { duration: 260, easing: 'cubic-bezier(0.5, 0, 0.85, 0.35)', fill: 'forwards' });
      running = [main].concat(inner.map(function (el) {
        return el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, fill: 'forwards' });
      }));
    }
    main.onfinish = shut;
    // Never leave a pop-up over the page if the finish event goes missing.
    safety = setTimeout(shut, 600);
  }

  function shut() {
    clearTimeout(safety);
    if (dlg.open) dlg.close();
  }

  // Every way the pop-up ends up closed comes through here.
  dlg.addEventListener('close', function () {
    clearTimeout(safety);
    stop();
    dlg.classList.remove('is-closing');
    document.documentElement.classList.remove('rel-lock');
    if (from) {
      from.classList.remove('is-lifted');
      var btn = from.querySelector('.rel-open');
      if (btn) btn.focus({ preventScroll: true });
    }
    from = null;
  });
  dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
  dlg.querySelector('.rel-close').addEventListener('click', close);

  cards.forEach(function (card) {
    card.querySelector('.rel-open').addEventListener('click', function () { open(card); });
  });
})();
