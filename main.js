/* =========================================================
   CourtMap — interactions + GSAP motion
   Baseline behaviour works without GSAP; the motion layer is
   added on top and fully reverted by gsap.matchMedia().
   ========================================================= */
(() => {
  const root = document.documentElement;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  /* ---------------------------------------------------------
     Baseline (no GSAP required)
     --------------------------------------------------------- */

  // Light / dark theme. The head script has already set data-theme; here we keep the
  // app screens (<picture><source data-dark>), the toggle and the browser UI colour in sync.
  const THEME_KEY = 'cm-theme';
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const themeBtn = $('.theme-btn');
  const themeMeta = $('meta[name="theme-color"]');
  const savedTheme = () => { try { return localStorage.getItem(THEME_KEY); } catch { return null; } };
  const applyTheme = (theme) => {
    root.setAttribute('data-theme', theme);
    $$('source[data-dark]').forEach((s) => { s.media = theme === 'dark' ? 'all' : 'not all'; });
    themeMeta?.setAttribute('content', theme === 'dark' ? '#0b0b0c' : '#ffffff');
    themeBtn?.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  };
  themeBtn?.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked: still switch for this visit */ }
    // Swap every colour at once (no per-element transitions), then crossfade the page where supported
    const swap = () => {
      root.classList.add('theme-switching');
      applyTheme(next);
      getComputedStyle(root).color; // flush styles before transitions come back
      setTimeout(() => root.classList.remove('theme-switching'), 0);
    };
    if (document.startViewTransition && !reduceMotion.matches) document.startViewTransition(swap);
    else swap();
  });
  // Follow the system setting until the visitor picks a theme themselves
  systemDark.addEventListener('change', (e) => { if (!savedTheme()) applyTheme(e.matches ? 'dark' : 'light'); });
  applyTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

  // Duplicate each carousel column's screens so its loop is seamless
  const reelTracks = $$('.reel__track');
  reelTracks.forEach((track) => {
    [...track.children].forEach((node) => {
      const clone = node.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      clone.querySelector('img')?.setAttribute('alt', '');
      track.appendChild(clone);
    });
  });

  // Header border once scrolled
  const header = $('.header');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Mobile menu
  const menuBtn = $('.menu-btn');
  const nav = $('#nav');
  const menuOpen = () => menuBtn.getAttribute('aria-expanded') === 'true';
  const setMenu = (open) => {
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    nav.classList.toggle('is-open', open);
  };
  menuBtn.addEventListener('click', () => setMenu(!menuOpen()));
  $$('a', nav).forEach((a) => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  // Feature tabs (the motion layer hooks into onChange / onUser)
  const tabs = (() => {
    const list = $('.showcase__tabs');
    const btns = $$('[role="tab"]', list);
    const panels = btns.map((t) => document.getElementById(t.getAttribute('aria-controls')));
    // One visual per tab, in tab order: the challenge stack, then a phone screen for each other tab
    const chal = $('.chal');
    const stage = $('.showcase__device');
    const shots = [chal, ...$$('.device img')];
    let current = 0;
    const api = { btns, panels, shots, chal, onChange: null, onUser: null, current: () => current, select };

    function select(i, { focus = false, user = false } = {}) {
      const prev = current;
      current = i;
      btns.forEach((t, j) => {
        const on = i === j;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        panels[j].hidden = !on;
        shots[j]?.classList.toggle('is-active', on);
      });
      stage.classList.toggle('is-chal', shots[i] === chal); // the phone frame steps aside for challenges
      if (focus) btns[i].focus({ preventScroll: true });
      // Keep the active tab visible inside the (horizontally scrollable) tab bar only
      list.scrollTo({ left: btns[i].offsetLeft - 24, behavior: 'smooth' });
      if (user && api.onUser) api.onUser();
      if (prev !== i && api.onChange) api.onChange(prev, i);
    }

    btns.forEach((t, i) => {
      t.addEventListener('click', () => select(i, { user: true }));
      t.addEventListener('keydown', (e) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (step) { e.preventDefault(); select((i + step + btns.length) % btns.length, { focus: true, user: true }); }
        if (e.key === 'Home') { e.preventDefault(); select(0, { focus: true, user: true }); }
        if (e.key === 'End') { e.preventDefault(); select(btns.length - 1, { focus: true, user: true }); }
      });
    });
    return api;
  })();

  // Links with data-tab (e.g. in the footer) open that feature tab as they jump to the showcase
  $$('a[data-tab]').forEach((a) => a.addEventListener('click', () => {
    const i = tabs.btns.findIndex((b) => b.id === 'tab-' + a.dataset.tab);
    if (i >= 0) tabs.select(i, { user: true });
  }));

  // Waitlist forms → Loops.
  // The endpoint lives in <meta name="waitlist-endpoint"> in index.html. Each signup is sent
  // as a Loops contact with userGroup "Waitlist" and a source naming the form it came from.
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const forms = $$('form.waitlist');
  const endpoint = () => ($('meta[name="waitlist-endpoint"]')?.content || '').trim();
  const markJoined = (form) => {
    form.classList.add('is-done');
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    btn.textContent = 'You’re on the list';
  };

  // Resolves to 'ok' | 'already' or throws an Error whose message is safe to show
  async function joinWaitlist(email, source) {
    const url = endpoint();
    if (!url) {
      console.warn('[waitlist] No endpoint set: add your Loops form endpoint to <meta name="waitlist-endpoint"> in index.html.');
      throw new Error('Signups aren’t open just yet. Please check back soon.');
    }
    const body = new URLSearchParams({ email, userGroup: 'Waitlist', source });
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    } catch {
      throw new Error('We couldn’t reach the server. Check your connection and try again.');
    }
    if (res.status === 429) throw new Error('Too many signups right now. Please try again in a minute.');
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) return 'ok';
    const detail = String(data.message || res.status);
    if (/already/i.test(detail)) return 'already';
    console.error('[waitlist] Loops rejected the signup:', detail);
    throw new Error('We couldn’t add that email. Check it and try again.');
  }

  forms.forEach((form) => {
    const input = $('input[type="email"]', form);
    const btn = $('button[type="submit"]', form);
    const msg = $('.waitlist__msg', form);
    const trap = $('.waitlist__hp', form);
    const label = btn.textContent;
    const say = (text, kind) => {
      msg.textContent = text;
      msg.className = `waitlist__msg is-${kind}`;
      window.gsap?.fromTo(msg, { y: 8, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, ease: 'power3.out' });
    };
    input.addEventListener('input', () => { if (msg.classList.contains('is-error')) say('', 'idle'); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      const email = input.value.trim();
      if (!EMAIL.test(email)) { say('Enter a valid email address.', 'error'); input.focus(); return; }
      btn.disabled = true;
      btn.textContent = 'Joining…';
      try {
        // Bots fill the hidden field; pretend it worked and send nothing
        const result = trap?.value ? 'ok' : await joinWaitlist(email, form.dataset.source || 'Website');
        forms.forEach(markJoined); // one signup covers every form on the page
        say(result === 'already'
          ? 'You’re already on the list. We’ll email your invite as soon as your spot opens.'
          : 'Thanks! We’ll email your invite as soon as your spot opens.', 'ok');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = label;
        say(err.message, 'error');
      }
    });
  });

  const year = $('#year');
  if (year) year.textContent = new Date().getFullYear();

  /* ---------------------------------------------------------
     Motion layer (GSAP)
     --------------------------------------------------------- */
  if (!window.gsap || !window.ScrollTrigger || !window.SplitText) { root.classList.remove('js'); return; }

  gsap.registerPlugin(ScrollTrigger, SplitText, Draggable, InertiaPlugin);
  root.classList.add('gsap');
  gsap.defaults({ ease: 'power3.out', duration: 0.8 });


  // Count a [data-count] element up from zero. Returns a tween (add it to a timeline).
  const countUp = (el, duration = 1.6) => {
    const to = parseFloat(el.dataset.count);
    const dec = Number(el.dataset.decimals || 0);
    const fmt = (v) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const o = { v: 0 };
    el.textContent = fmt(0);
    return gsap.fromTo(o, { v: 0 }, {
      v: to, duration, ease: 'power2.out', immediateRender: false,
      onUpdate: () => { el.textContent = fmt(o.v); },
      onComplete: () => { el.textContent = fmt(to); },
    });
  };
  const resetCounters = () => $$('[data-count]').forEach((el) => {
    const dec = Number(el.dataset.decimals || 0);
    el.textContent = parseFloat(el.dataset.count).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  });

  const start = () => {
    const mm = gsap.matchMedia();

    /* ===== Everyone who hasn't asked for reduced motion ===== */
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const cleanups = [];
      const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); cleanups.push(() => el.removeEventListener(type, fn, opts)); };

      /* ---------- Hero intro ---------- */
      const title = $('.hero__title');
      const floats = $$('.float').filter((f) => getComputedStyle(f).display !== 'none');
      const fds = floats.map((f) => $('.fd', f));

      const split = SplitText.create(title, { type: 'words', wordsClass: 'w', mask: 'words' });

      // Floating photos and badges start tucked in toward the headline
      const titleRect = title.getBoundingClientRect();
      const cx = titleRect.left + titleRect.width / 2;
      const cy = titleRect.top + titleRect.height / 2;
      const burst = fds.map((fd) => {
        const r = fd.getBoundingClientRect();
        return { x: (cx - (r.left + r.width / 2)) * 0.35, y: (cy - (r.top + r.height / 2)) * 0.35 };
      });

      // Pieces hidden at this breakpoint still need to be visible if the window grows later
      const offstage = $$('.float .fd').filter((fd) => !fds.includes(fd));
      if (offstage.length) gsap.set(offstage, { autoAlpha: 1 });

      gsap.timeline({ defaults: { ease: 'power3.out' } })
        // Nav bar settles in from just above: logo, links, then actions
        .fromTo('.header [data-intro]', { autoAlpha: 0, y: -8 },
          { autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.05, clearProps: 'transform,opacity' }, 0)
        .fromTo('.pill', { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.7 }, 0.05)
        .set(title, { autoAlpha: 1 }, 0.1)
        .from(split.words, { yPercent: 125, duration: 1, stagger: 0.07, ease: 'power4.out' }, 0.15)
        .fromTo(['.hero__sub', '.waitlist', '.hero__note'].map((s) => $('.hero ' + s)),
          { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.1 }, 0.6)
        .fromTo(fds,
          { x: (i) => burst[i].x, y: (i) => burst[i].y, scale: 0.7, autoAlpha: 0 },
          { x: 0, y: 0, scale: 1, autoAlpha: 1, duration: 1.6, ease: 'expo.out', stagger: 0.1 },
          0.7);

      // Floating pieces drift very gently
      floats.forEach((f) => {
        gsap.to($('.fi', f), {
          y: gsap.utils.random(-6, 6), duration: gsap.utils.random(3.5, 5),
          ease: 'sine.inOut', yoyo: true, repeat: -1, delay: gsap.utils.random(0, 1.5),
        });
      });

      /* ---------- Screen carousel: three columns looping in alternating directions ---------- */
      // Speed is in screens per second so it feels the same at every size. Columns differ slightly.
      const REEL_SPEED = 0.15;
      const REEL_PACE = [1, 0.85, 0.93];
      const reel = $('.reel');
      const reelCols = $$('.reel__col'); // all three, so a column hidden on phones is ready if the window widens
      const loops = reelCols.map((col, i) => {
        const track = $('.reel__track', col);
        const reverse = col.hasAttribute('data-reverse');
        const screens = track.children.length / 2; // half the track is the original set
        const loop = gsap.fromTo(track, { yPercent: reverse ? -50 : 0 }, {
          yPercent: reverse ? 0 : -50, duration: screens / (REEL_SPEED * REEL_PACE[i]), ease: 'none', repeat: -1,
        });
        return loop.progress(i * 0.21); // stagger the columns so their screens don't line up
      });

      // The columns rise in once when the carousel scrolls into view
      gsap.fromTo(reelCols, { autoAlpha: 0, y: 60 }, {
        autoAlpha: 1, y: 0, duration: 1.2, ease: 'expo.out', stagger: 0.12,
        scrollTrigger: { trigger: reel, start: 'top 90%', once: true },
      });

      // Hovering over the screens (not the space beside them) eases the carousel to a stop
      const reelArea = $('.reel__cols');
      const setReelSpeed = (timeScale, duration) => loops.forEach((loop) => gsap.to(loop, { timeScale, duration, overwrite: true }));
      on(reelArea, 'mouseenter', () => setReelSpeed(0, 0.6));
      on(reelArea, 'mouseleave', () => setReelSpeed(1, 0.8));

      /* ---------- Header hides on scroll down, returns on scroll up ---------- */
      const headerAnim = gsap.from(header, { yPercent: -100, paused: true, duration: 0.35, ease: 'power2.out' }).progress(1);
      ScrollTrigger.create({
        start: 0, end: 'max',
        onUpdate(self) {
          if (menuOpen()) return;
          if (self.direction === -1 || self.scroll() < 160) headerAnim.play();
          else headerAnim.reverse();
        },
      });

      /* ---------- Section headings (masked line reveals) ---------- */
      const revealHead = (head) => {
        const t = $('.split-lines', head);
        if (t) {
          SplitText.create(t, {
            type: 'lines', mask: 'lines', linesClass: 'ln', autoSplit: true,
            onSplit: (self) => gsap.from(self.lines, {
              yPercent: 125, duration: 1.1, stagger: 0.12, ease: 'power4.out',
              scrollTrigger: { trigger: head, start: 'top 82%', once: true },
            }),
          });
        }
        const extras = $$('.eyebrow, .section__sub', head);
        if (extras.length) {
          gsap.from(extras, { autoAlpha: 0, y: 16, duration: 0.8, stagger: 0.12, scrollTrigger: { trigger: head, start: 'top 85%', once: true } });
        }
      };

      /* ---------- Features showcase ---------- */
      revealHead($('#screens .section__head'));
      revealHead($('#features .section__head'));
      gsap.from('.showcase', { autoAlpha: 0, y: 70, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: '.showcase', start: 'top 88%', once: true } });
      gsap.fromTo('.device', { y: 32 }, {
        y: 0, ease: 'none',
        scrollTrigger: { trigger: '.showcase', start: 'top bottom', end: 'center center', scrub: 0.6 },
      });

      tabs.shots.forEach((s, j) => gsap.set(s, { autoAlpha: j === tabs.current() ? 1 : 0 }));
      gsap.set('.device', { autoAlpha: tabs.shots[tabs.current()] === tabs.chal ? 0 : 1 });

      // The challenges fan out from a neat stack, with their details rising in after
      const fanChallenges = () => {
        const chal = tabs.chal;
        gsap.fromTo($('.chal__slot--l .chal__tile', chal), { x: 0, xPercent: 76, rotation: 10 }, { xPercent: 0, rotation: 0, duration: 1, ease: 'expo.out', overwrite: true });
        gsap.fromTo($('.chal__slot--r .chal__tile', chal), { x: 0, xPercent: -76, rotation: -10 }, { xPercent: 0, rotation: 0, duration: 1, ease: 'expo.out', overwrite: true });
        gsap.fromTo($('.chal__slot--c .chal__tile', chal), { y: 18, scale: 0.94 }, { y: 0, scale: 1, duration: 0.8, ease: 'expo.out', overwrite: true });
        gsap.fromTo($('.chal__info', chal), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.7, delay: 0.2, overwrite: true });
      };
      ScrollTrigger.create({
        trigger: '.showcase', start: 'top 70%', once: true,
        onEnter: () => { if (tabs.shots[tabs.current()] === tabs.chal) fanChallenges(); },
      });
      let auto = null;
      let autoStopped = false;
      let inView = false;
      let paused = false;
      const AUTO_SECONDS = 8;
      const runAuto = () => {
        auto?.kill();
        gsap.set($$('.tab__bar'), { scaleX: 0 });
        if (autoStopped) return;
        auto = gsap.fromTo($('.tab__bar', tabs.btns[tabs.current()]), { scaleX: 0 }, {
          scaleX: 1, duration: AUTO_SECONDS, ease: 'none', paused: !inView || paused,
          onComplete: () => tabs.select((tabs.current() + 1) % tabs.btns.length),
        });
      };
      const syncAuto = () => { if (auto) (inView && !paused ? auto.resume() : auto.pause()); };

      tabs.onChange = (prev, next) => {
        const out = tabs.shots[prev];
        const inc = tabs.shots[next];
        tabs.shots.forEach((s, j) => { if (j !== prev && j !== next) gsap.set(s, { autoAlpha: 0 }); });
        gsap.to(out, { autoAlpha: 0, scale: 0.96, duration: 0.4, ease: 'power2.in', overwrite: true });
        if (inc === tabs.chal) {
          gsap.to('.device', { autoAlpha: 0, duration: 0.35, ease: 'power2.in', overwrite: 'auto' });
          gsap.fromTo(inc, { autoAlpha: 0, scale: 1 }, { autoAlpha: 1, duration: 0.4, delay: 0.08, overwrite: true });
          fanChallenges();
        } else {
          if (out === tabs.chal) gsap.fromTo('.device', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, delay: 0.08, overwrite: 'auto' });
          gsap.fromTo(inc, { autoAlpha: 0, scale: 1.06, yPercent: 3 }, { autoAlpha: 1, scale: 1, yPercent: 0, duration: 0.85, ease: 'expo.out', delay: 0.08, overwrite: true });
        }
        const panel = tabs.panels[next];
        gsap.from($$(':scope > h3, :scope > p, li', panel), { autoAlpha: 0, y: 18, duration: 0.6, stagger: 0.06, overwrite: true });
        runAuto();
      };
      tabs.onUser = () => { autoStopped = true; auto?.kill(); gsap.set($$('.tab__bar'), { scaleX: 0 }); };

      const showcase = $('.showcase');
      on(showcase, 'mouseenter', () => { paused = true; syncAuto(); });
      on(showcase, 'mouseleave', () => { paused = false; syncAuto(); });
      on(showcase, 'focusin', () => { paused = true; syncAuto(); });
      ScrollTrigger.create({
        trigger: showcase, start: 'top 65%', end: 'bottom 35%',
        onToggle: (self) => { inView = self.isActive; if (!auto) runAuto(); syncAuto(); },
      });
      cleanups.push(() => { tabs.onChange = null; tabs.onUser = null; auto?.kill(); });

      /* ---------- Bento cards ---------- */
      revealHead($('#everything .section__head'));
      const cards = $$('.bento .card');
      gsap.set(cards, { autoAlpha: 0, y: 70 });
      ScrollTrigger.batch(cards, {
        start: 'top 88%', once: true,
        onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 1.1, ease: 'expo.out', stagger: 0.12, overwrite: true }),
      });
      const whenSeen = (card, tl) => ScrollTrigger.create({ trigger: card, start: 'top 86%', once: true, onEnter: () => tl.play() });

      // Map: slow push-in on scroll, court card rises
      const mapCard = $('[data-card="map"]');
      gsap.fromTo($('.mapviz img', mapCard), { scale: 1.2 }, {
        scale: 1, ease: 'none', scrollTrigger: { trigger: mapCard, start: 'top bottom', end: 'bottom top', scrub: true },
      });
      whenSeen(mapCard, gsap.timeline({ paused: true }).from($('.ui-court', mapCard), { y: 50, autoAlpha: 0, duration: 0.9, ease: 'back.out(1.4)' }, 0.35));

      // Game: tap Join, you drop into the open slot, the points chip glints
      const game = $('[data-card="game"]');
      const join = $('.ui-join', game);
      const joinLabel = $('.ui-join__label', game);
      const gameTl = gsap.timeline({ paused: true })
        .call(() => { join.classList.remove('is-joined'); joinLabel.textContent = 'Join'; }, null, 0.01)
        .to(join, { scale: 0.88, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.inOut' }, 0.35)
        .fromTo($('.ui-join__ring', game), { scale: 1, autoAlpha: 0.9 }, { scale: 1.9, autoAlpha: 0, duration: 0.7, ease: 'power2.out' }, 0.35)
        .to($('.slot .open', game), { scale: 0, autoAlpha: 0, duration: 0.25 }, 0.55)
        .fromTo($('.drop', game), { y: -52, autoAlpha: 0, scale: 0.6 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.8, ease: 'bounce.out' }, 0.6)
        .call(() => { join.classList.add('is-joined'); joinLabel.textContent = 'Joined'; }, null, 0.75)
        .fromTo($('.shine', game), { xPercent: -120, skewX: -20 }, { xPercent: 320, duration: 0.8, ease: 'power2.inOut' }, 1.15);
      whenSeen(game, gameTl);
      on(game, 'mouseenter', () => { if (gameTl.progress() === 1) gameTl.restart(); });
      cleanups.push(() => { join.classList.remove('is-joined'); joinLabel.textContent = 'Join'; });

      // Filters: the selected day glides along the week once, then settles
      const days = $('[data-card="filters"] .ui-days');
      const hl = $('.ui-days__hl', days);
      const dayEls = $$('span', days);
      let dayIdx = dayEls.findIndex((d) => d.classList.contains('on'));
      days.classList.add('has-hl');
      const placeDay = (i, animate) => {
        const d = dayEls[i];
        dayEls.forEach((el, j) => el.classList.toggle('on', j === i));
        gsap.set(hl, { width: d.offsetWidth, height: d.offsetHeight });
        const to = { x: d.offsetLeft, y: d.offsetTop };
        animate ? gsap.to(hl, { ...to, duration: 0.6, ease: 'back.out(1.7)' }) : gsap.set(hl, to);
      };
      placeDay(dayIdx, false);
      whenSeen($('[data-card="filters"]'), gsap.timeline({ paused: true })
        .call(() => { dayIdx = 2; placeDay(dayIdx, true); }, null, 0.7)
        .call(() => { dayIdx = 3; placeDay(dayIdx, true); }, null, 1.5));
      const onDaysRefresh = () => placeDay(dayIdx, false);
      ScrollTrigger.addEventListener('refresh', onDaysRefresh);
      cleanups.push(() => {
        ScrollTrigger.removeEventListener('refresh', onDaysRefresh);
        days.classList.remove('has-hl');
        dayEls.forEach((el, j) => el.classList.toggle('on', j === 1));
      });

      // Leaderboard: rows slide in, points count up, medals drop
      const board = $('[data-card="board"]');
      const boardTl = gsap.timeline({ paused: true })
        .from($$('.ui-board li', board), { x: 40, autoAlpha: 0, duration: 0.7, stagger: 0.12 }, 0.2)
        .from($$('.medal', board), { y: -24, rotation: -30, autoAlpha: 0, duration: 0.8, stagger: 0.12, ease: 'bounce.out' }, 0.5);
      $$('[data-count]', board).forEach((el, i) => boardTl.add(countUp(el, 1.4), 0.3 + i * 0.12));
      whenSeen(board, boardTl);

      // Badges: badges rise into place, progress fills, points roll up
      const badges = $('[data-card="badges"]');
      const badgeImgs = $$('.badge', badges);
      const badgesTl = gsap.timeline({ paused: true })
        .fromTo(badgeImgs, { y: 50, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1, stagger: 0.15, ease: 'power3.out' }, 0.2)
        .fromTo($('.bar i', badges), { scaleX: 0 }, { scaleX: 1, duration: 1.6, ease: 'power2.out' }, 0.4);
      $$('[data-count]', badges).forEach((el) => badgesTl.add(countUp(el, 1.6), 0.4));
      whenSeen(badges, badgesTl);

      // Community: the upvote ticks over
      const post = $('[data-card="post"]');
      const upN = $('.ui-up__n', post);
      const upTl = gsap.timeline({ paused: true })
        .call(() => { upN.textContent = '159'; }, null, 0.01)
        .to($('.ui-up', post), { scale: 1.15, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.inOut' }, 0.05)
        .to($('.ui-up__arrow', post), { yPercent: -160, duration: 0.2, ease: 'power2.in' }, 0.05)
        .fromTo($('.ui-up__arrow', post), { yPercent: 160 }, { yPercent: 0, duration: 0.35, ease: 'back.out(2)', immediateRender: false })
        .to(upN, { yPercent: -110, duration: 0.18, ease: 'power2.in' }, 0.1)
        .call(() => { upN.textContent = '160'; })
        .fromTo(upN, { yPercent: 110 }, { yPercent: 0, duration: 0.35, ease: 'back.out(2)', immediateRender: false });
      const postTl = gsap.timeline({ paused: true })
        .from($('.ui-post', post), { y: 30, rotation: -2, autoAlpha: 0, duration: 0.9 }, 0.2)
        .call(() => upTl.restart(), null, 0.9);
      whenSeen(post, postTl);
      on(post, 'mouseenter', () => { if (postTl.progress() === 1 && upTl.progress() === 1) upTl.restart(); });
      cleanups.push(() => { upN.textContent = '160'; });

      // Events: rows slide in, prices count up
      // Match: teams and time settle in, the stake counts up, then the buttons rise
      const match = $('[data-card="match"]');
      const matchTl = gsap.timeline({ paused: true })
        .from($$('.ui-match__team, .ui-match__mid', match), { y: 14, autoAlpha: 0, duration: 0.7, stagger: 0.1 }, 0.2)
        .add(countUp($('.ui-match__pts b', match), 1.2), 0.45)
        .from($$('.ui-match__btn', match), { y: 12, autoAlpha: 0, duration: 0.6, stagger: 0.08 }, 0.55);
      whenSeen(match, matchTl);
      cleanups.push(resetCounters);

      /* ---------- How it works ---------- */
      revealHead($('#how .section__head'));
      gsap.from($$('.flow__num, .flow__step h3, .flow__step p'), {
        autoAlpha: 0, y: 20, duration: 0.8, stagger: 0.05,
        scrollTrigger: { trigger: '.flow', start: 'top 60%', once: true },
      });

      /* ---------- Story ---------- */
      const photos = $$('.story__photos img');
      gsap.fromTo(photos,
        { clipPath: 'inset(100% 0% 0% 0% round 28px)', scale: 1.15 },
        { clipPath: 'inset(0% 0% 0% 0% round 28px)', scale: 1, duration: 1.3, ease: 'expo.out', stagger: 0.15,
          scrollTrigger: { trigger: '.story__photos', start: 'top 80%', once: true } });

      SplitText.create('.story__lead', {
        type: 'lines', mask: 'lines', linesClass: 'ln', autoSplit: true,
        onSplit: (self) => gsap.from(self.lines, { yPercent: 125, duration: 1.1, stagger: 0.12, ease: 'power4.out', scrollTrigger: { trigger: '.story__copy', start: 'top 80%', once: true } }),
      });
      // The second line fills in word by word as you scroll; "one player short" ends in blue
      // --p blends each word from a faint tone to ink (or blue) in CSS, so it follows the theme
      const muted = SplitText.create('.story__copy .muted', { type: 'words', wordsClass: 'sw' });
      gsap.fromTo(muted.words, { '--p': 0 }, {
        '--p': 1, stagger: 0.1, ease: 'none',
        scrollTrigger: { trigger: '.story__copy', start: 'top 70%', end: 'center 40%', scrub: true },
      });
      gsap.from('.story__copy .eyebrow, .story__text', { autoAlpha: 0, y: 18, duration: 0.8, stagger: 0.1, scrollTrigger: { trigger: '.story__copy', start: 'top 80%', once: true } });
      gsap.from('.sports li', { autoAlpha: 0, scale: 0.6, y: 10, duration: 0.7, stagger: 0.1, ease: 'back.out(2)', scrollTrigger: { trigger: '.sports', start: 'top 92%', once: true } });

      /* ---------- FAQ ---------- */
      revealHead($('.faq__head'));
      gsap.from('.faq details', { autoAlpha: 0, y: 24, duration: 0.7, stagger: 0.07, scrollTrigger: { trigger: '.faq__list', start: 'top 85%', once: true } });
      $$('.faq details').forEach((d) => {
        const answer = $('.faq__a', d);
        on($('summary', d), 'click', (e) => {
          e.preventDefault();
          if (d.open) {
            gsap.to(answer, {
              height: 0, autoAlpha: 0, duration: 0.35, ease: 'power2.inOut', overwrite: true,
              onComplete: () => { d.open = false; gsap.set(answer, { clearProps: 'height,opacity,visibility' }); },
            });
          } else {
            d.open = true;
            gsap.fromTo(answer, { height: 0, autoAlpha: 0 }, { height: 'auto', autoAlpha: 1, duration: 0.5, ease: 'power3.out', overwrite: true, clearProps: 'height' });
            gsap.from($('p', answer), { y: 12, duration: 0.5 });
          }
        });
      });

      /* ---------- Final CTA ---------- */
      const ctaTitle = SplitText.create('.cta__title', { type: 'words', wordsClass: 'w', mask: 'words' });
      gsap.timeline({ scrollTrigger: { trigger: '.cta', start: 'top 72%', once: true } })
        .from('.cta__icon img', { autoAlpha: 0, y: 20, duration: 0.9 })
        .from(ctaTitle.words, { yPercent: 125, duration: 1, stagger: 0.08, ease: 'power4.out' }, 0.15)
        .from('.cta__sub, .cta .waitlist', { autoAlpha: 0, y: 16, duration: 0.8, stagger: 0.12 }, 0.5);

      // Recalculate trigger positions once images have settled
      const onLoad = () => ScrollTrigger.refresh();
      if (document.readyState === 'complete') requestAnimationFrame(onLoad); else on(window, 'load', onLoad);

      return () => { cleanups.forEach((fn) => fn()); };
    });

    /* ===== Desktop-only scroll choreography ===== */
    mm.add('(prefers-reduced-motion: no-preference) and (min-width: 861px)', () => {
      // Floating pieces drift away at different depths as the hero scrolls out
      gsap.to($$('.float'), {
        y: (i, el) => -Number(el.dataset.depth || 1) * 80, ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.6 },
      });

      // How it works: screens land in sequence; the progress rail draws step by step
      gsap.fromTo('.screen--flow', { y: (i) => 40 + i * 30 }, {
        y: 0, ease: 'none',
        scrollTrigger: { trigger: '.flow', start: 'top 95%', end: 'top 30%', scrub: 0.8 },
      });
      const rail = gsap.timeline({ scrollTrigger: { trigger: '.flow', start: 'top 55%', end: 'bottom 75%', scrub: 0.6 } });
      $$('.flow__step').forEach((step) => {
        rail.fromTo($('.flow__dot', step), { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(3)' });
        const line = $('.flow__line i', step);
        if (line) rail.fromTo(line, { scaleX: 0 }, { scaleX: 1, duration: 1, ease: 'none' });
      });

      // Story collage parallax
      const [p1, p2, p3] = $$('.story__photos img');
      const st = { trigger: '.story__photos', start: 'top bottom', end: 'bottom top', scrub: 0.8 };
      gsap.fromTo(p1, { y: 30 }, { y: -30, ease: 'none', scrollTrigger: st });
      gsap.fromTo(p2, { y: 70 }, { y: -60, ease: 'none', scrollTrigger: { ...st } });
      gsap.fromTo(p3, { y: 15 }, { y: -25, ease: 'none', scrollTrigger: { ...st } });
    });

    /* ===== Mouse/trackpad niceties ===== */
    mm.add('(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)', () => {
      const cleanups = [];
      const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); cleanups.push(() => el.removeEventListener(type, fn, opts)); };

      // Hero pieces lean toward the cursor (depth-weighted)
      const heroTop = $('.hero__top');
      const movers = $$('.float').map((f) => ({
        depth: Number(f.dataset.depth || 1),
        x: gsap.quickTo($('.fp', f), 'x', { duration: 0.9, ease: 'power3' }),
        y: gsap.quickTo($('.fp', f), 'y', { duration: 0.9, ease: 'power3' }),
      }));
      on(heroTop, 'pointermove', (e) => {
        const r = heroTop.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        movers.forEach((m) => { m.x(nx * 18 * m.depth); m.y(ny * 12 * m.depth); });
      });
      on(heroTop, 'pointerleave', () => movers.forEach((m) => { m.x(0); m.y(0); }));

      // ...and can be picked up and thrown; they spring back home
      const home = (t) => gsap.to(t, {
        x: 0, y: 0, scale: 1, rotation: 0, duration: 1.4, ease: 'elastic.out(1, 0.45)', overwrite: 'auto',
        onComplete: () => { t.closest('.float').style.zIndex = ''; },
      });
      const drags = Draggable.create($$('.float .fd'), {
        type: 'x,y', inertia: true, zIndexBoost: false,
        onPress() {
          this.target.closest('.float').style.zIndex = 5;
          gsap.to(this.target, { scale: 1.06, duration: 0.25, overwrite: 'auto' });
        },
        onRelease() { if (!this.isThrowing) home(this.target); },
        onThrowComplete() { home(this.target); },
      });
      cleanups.push(() => drags.forEach((d) => d.kill()));

      // Magnetic primary buttons
      $$('.magnetic').forEach((btn) => {
        const xTo = gsap.quickTo(btn, 'x', { duration: 0.5, ease: 'power3' });
        const yTo = gsap.quickTo(btn, 'y', { duration: 0.5, ease: 'power3' });
        on(btn, 'pointermove', (e) => {
          const r = btn.getBoundingClientRect();
          xTo((e.clientX - (r.left + r.width / 2)) * 0.12);
          yTo((e.clientY - (r.top + r.height / 2)) * 0.18);
        });
        on(btn, 'pointerleave', () => { xTo(0); yTo(0); });
      });

      return () => cleanups.forEach((fn) => fn());
    });

    /* ===== Reduced motion: show everything in its final state ===== */
    mm.add('(prefers-reduced-motion: reduce)', () => {
      gsap.set('.hero [data-intro], .header [data-intro], .floats .fd, .reel__col', { autoAlpha: 1 });
    });
  };

  // Split text only after the brand font has loaded so line breaks are right
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(start);
})();
