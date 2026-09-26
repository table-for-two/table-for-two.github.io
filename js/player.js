/* player.js: turns each group of slides into a player. Progressive enhancement: without it, each slide is its
 * final-state picture with its name.
 *
 * A player's slides play one after another, muted and inline, as the talk presents them (tools/record.js: quick
 * builds, held while there is text to read or a clip playing). Tabs on top name the slides and show how far each has
 * played; the bar under the slide steps through its builds (buttons, ticks, ← →), and a click on the slide pauses it.
 * A player starts when it is mostly on screen and stops when it leaves (one at a time). With prefers-reduced-motion
 * nothing starts by itself and the stills stay until the reader presses play.
 *
 * Markup (tools/build.js): .player > figure.talk-slide[data-id data-short data-src data-steps data-settle
 * data-duration] > .talk-slide__media > img  +  figcaption
 */
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('js');
  var REDUCE = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function svg(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>'; }
  var ICON = {
    play: svg('M8 5.14v13.72a1 1 0 0 0 1.52.85l10.9-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z'),
    pause: svg('M7 5h3.2v14H7zM13.8 5H17v14h-3.2z'),
    replay: svg('M12 5V2L7.5 6.5 12 11V7.5a5 5 0 1 1-5 5H4.5A7.5 7.5 0 1 0 12 5z'),
    prev: svg('M6 5h2.2v14H6zM19 6.1v11.8a.9.9 0 0 1-1.37.77L9.6 12.77a.9.9 0 0 1 0-1.54l8.03-5.9A.9.9 0 0 1 19 6.1z'),
    next: svg('M15.8 5H18v14h-2.2zM5 6.1v11.8a.9.9 0 0 0 1.37.77l8.03-5.9a.9.9 0 0 0 0-1.54L6.37 5.33A.9.9 0 0 0 5 6.1z'),
    full: svg('M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zm5 11v5h-5v-2h3v-3zM9 20H4v-5h2v3h3z')
  };
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function button(cls, label, icon) {
    var b = el('button', cls, icon || null); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; return b;
  }
  function mmss(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function nums(s) { return String(s || '0').split(',').map(Number); }

  // playback speed, 1x or 2x: one setting for every player, remembered in this browser (a convenience only)
  var RATE = 1;
  try { if (localStorage.getItem('tft-rate') === '2') RATE = 2; } catch (e) { }
  function setRate(r) {
    RATE = r;
    try { localStorage.setItem('tft-rate', String(r)); } catch (e) { }
    players.forEach(function (p) { p.rate(r); });
  }

  var players = [];
  [].forEach.call(document.querySelectorAll('.player'), function (node) { players.push(Player(node)); });
  function stopOthers(p) { players.forEach(function (q) { if (q !== p) q.stop(); }); }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) players.forEach(function (p) { p.stop(); });
  });

  // ------------------------------------------------------------------ BibTeX
  var copy = document.querySelector('.bibtex__copy'), code = document.querySelector('.bibtex code');
  if (copy && code && navigator.clipboard) {
    copy.hidden = false;
    copy.addEventListener('click', function () {
      navigator.clipboard.writeText(code.textContent).then(function () {
        copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy'; }, 1600);
      });
    });
  }

  // ------------------------------------------------------------------ one player
  function Player(node) {
    var figs = [].slice.call(node.querySelectorAll('.talk-slide'));
    var S = figs.map(function (f, i) {
      return {
        i: i, id: f.getAttribute('data-id'), short: f.getAttribute('data-short') || '', src: f.getAttribute('data-src'),
        steps: nums(f.getAttribute('data-steps')), settle: nums(f.getAttribute('data-settle')),
        dur: +f.getAttribute('data-duration') || 0, img: f.querySelector('img')
      };
    });
    var N = S.length, LOOP = node.getAttribute('data-loop') === 'true';
    var name = node.getAttribute('aria-label') || 'Slides';
    if (N === 1) node.classList.add('player--single');

    // ---- layout: tabs on top, then the slide, then the control bar
    var tabs = el('ol', 'tabs'), main = el('div', 'player__main'), stage = el('div', 'player__stage'), bar = el('div', 'bar');
    tabs.setAttribute('aria-label', name + ': slides');
    stage.tabIndex = 0;
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-roledescription', 'slide player');
    stage.setAttribute('aria-label', name + ': click or press space to play or pause, arrow keys step through the builds');
    var tabBtns = [], tabFills = [];
    S.forEach(function (s, i) {
      stage.appendChild(s.img);
      var li = el('li'), b = el('button', 'tab', '<span class="tab__bar"><span class="tab__fill"></span></span><span class="n">' + (i + 1) + '</span>' + s.short);
      b.type = 'button';
      b.addEventListener('click', function () { user = false; activate(i, { user: true, play: !REDUCE || playing }); });
      li.appendChild(b); tabs.appendChild(li); tabBtns.push(b); tabFills.push(b.querySelector('.tab__fill'));
    });
    var hint = el('span', 'player__hint', ICON.play);
    var vids = [video(), video()], act = 0;
    stage.appendChild(hint);

    var bPlay = button('bar__play', 'Play', ICON.play), bPrev = button('bar__prev', 'Previous build', ICON.prev);
    var bNext = button('bar__next', 'Next build', ICON.next), bFull = button('bar__full', 'Full screen', ICON.full);
    var bSpeed = button('bar__speed', 'Playback speed');
    var track = el('div', 'track'), fill = el('div', 'track__fill'), count = el('span', 'bar__count');
    track.appendChild(fill);
    [bPlay, bPrev, bNext, track, count, bSpeed, bFull].forEach(function (x) { bar.appendChild(x); });
    function speedLabel() {
      bSpeed.textContent = RATE + '×';
      bSpeed.setAttribute('aria-pressed', RATE === 2 ? 'true' : 'false');
      bSpeed.title = RATE === 2 ? 'Playing at 2× speed: click for normal speed' : 'Play at 2× speed';
    }
    main.appendChild(stage); main.appendChild(bar);
    figs.forEach(function (f) { f.parentNode.removeChild(f); });
    node.appendChild(tabs); node.appendChild(main);

    // ---- state
    var cur = -1, playing = false, user = false, ended = false, near = false, raf = 0, ticks = [];

    function video() {
      var v = document.createElement('video');
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'none';
      v.defaultPlaybackRate = RATE; v.playbackRate = RATE;          // default: a new src resets the rate to it
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
      v.disablePictureInPicture = true; v.tabIndex = -1;
      v._i = -1;
      // a loaded video only replaces the slide's still (its final state) once it plays or the reader seeks
      v.addEventListener('loadeddata', function () { v._ready = true; if (v === vids[act] && v._i === cur && (playing || v._seek)) { onScreen(v); render(); } });
      v.addEventListener('playing', function () { if (v === vids[act] && v._i === cur) { onScreen(v); render(); } });
      v.addEventListener('ended', function () { if (v === vids[act] && playing) next(); });
      v.addEventListener('seeked', function () { if (v === vids[act]) render(); });
      v.addEventListener('pause', function () { if (v === vids[act] && playing && !v.ended) { playing = false; render(); } });
      stage.appendChild(v);
      return v;
    }
    function load(v, i, preload) {
      if (v._i === i) { if (preload === 'auto' && v.preload !== 'auto') v.preload = 'auto'; return; }
      v._i = i; v._ready = false; v._seek = false; v.classList.remove('is-on');
      v.preload = preload || 'auto';
      v.src = S[i].src;
    }
    function onScreen(v) { vids.forEach(function (x) { x.classList.toggle('is-on', x === v); }); }
    // the video of the current slide, when it (not the slide's still) is what the reader sees
    function live() { var v = vids[act]; return v._i === cur && v._ready && v.classList.contains('is-on') ? v : null; }
    function now() { var v = live(); return v ? v.currentTime : (ended ? S[cur].dur : 0); }
    function stepAt(s, t) { var k = 0; for (var j = 1; j < s.steps.length; j++) if (s.steps[j] <= t + 0.03) k = j; return k; }

    // show slide i; how: { play, user, t }
    function activate(i, how) {
      how = how || {};
      var s = S[i], old = vids[act];
      cur = i; ended = false;
      S.forEach(function (x, j) { x.img.classList.toggle('is-cur', j === i); });
      tabBtns.forEach(function (b, j) { b.setAttribute('aria-current', j === i ? 'true' : 'false'); });
      ticks.forEach(function (t) { t.remove(); });
      ticks = s.steps.slice(1).map(function (t, j) {
        var b = button('track__tick', 'Build ' + (j + 1) + ' of ' + (s.steps.length - 1));
        b.style.left = (100 * t / (s.dur || 1)) + '%';
        b.addEventListener('click', function (e) { e.stopPropagation(); toStep(j + 1); });
        b.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        track.appendChild(b);
        return b;
      });
      var j = vids[0]._i === i ? 0 : vids[1]._i === i ? 1 : 1 - act, v = vids[j];
      act = j;
      if (old !== v) old.pause();
      if (near || how.play || how.user) load(v, i, 'auto');
      if (v._i === i) { try { v.currentTime = how.t || 0; } catch (e) { } }
      if (how.play) { if (v._ready) onScreen(v); }               // else the outgoing frame stays until this one plays
      else if (how.t && v._ready) { v._seek = true; onScreen(v); }
      else vids.forEach(function (x) { x.classList.remove('is-on'); });   // paused: the slide's still, its final state
      // a tab strip wider than the player (phones) scrolls the current tab into view, within the strip only
      var li = tabBtns[i] && tabBtns[i].parentNode;
      if (li && tabs.scrollWidth > tabs.clientWidth) {
        var x = li.getBoundingClientRect().left - tabs.getBoundingClientRect().left + tabs.scrollLeft;
        if (x < tabs.scrollLeft || x + li.offsetWidth > tabs.scrollLeft + tabs.clientWidth) tabs.scrollTo({ left: Math.max(0, x - 8), behavior: REDUCE ? 'auto' : 'smooth' });
      }
      if (how.play) play(); else render();
    }

    function play() {
      var v = vids[act];
      if (v._i !== cur) load(v, cur, 'auto');
      stopOthers(api);
      playing = true; ended = false;
      var p = v.play();
      if (p && p.catch) p.catch(function () { playing = false; render(); });
      if (v._ready) onScreen(v);
      loop();
      render();
    }
    function stop() { if (!playing) return; playing = false; vids[act].pause(); render(); }
    function toggle() {
      if (playing) { user = true; stop(); return; }
      user = false;
      if (ended) activate(0, { play: true }); else play();
    }
    function next() {
      if (cur < N - 1) activate(cur + 1, { play: true });
      else if (LOOP) activate(0, { play: true });
      else { playing = false; ended = true; render(); }
    }

    function seekTo(t) {
      var v = vids[act];
      if (v._i !== cur) load(v, cur, 'auto');
      ended = false; v._seek = true;
      var go = function () { try { v.currentTime = Math.max(0, Math.min(t, (S[cur].dur || v.duration) - 0.05)); } catch (e) { } if (v._ready) onScreen(v); render(); };
      if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, { once: true });
    }
    function toStep(k) {
      var s = S[cur];
      k = Math.max(0, Math.min(s.steps.length - 1, k));
      seekTo(k === 0 ? 0 : s.settle[k] + 0.04);
    }
    // the still on screen (before playing) is the slide's final state: its last build
    function stepBy(d) {
      var s = S[cur], last = s.steps.length - 1, on = !!live(), t = now(), k = on ? stepAt(s, t) : last;
      if (d > 0) {
        if (k < last) toStep(k + 1);
        else if (cur < N - 1) activate(cur + 1, { user: true, play: playing });
        return;
      }
      if (on && k > 0 && t - s.settle[k] > 1.5) toStep(k);                       // back to the start of this build
      else if (k > 0) toStep(k - 1);
      else if (cur > 0) { var p = S[cur - 1]; activate(cur - 1, { user: true, play: playing, t: p.settle[p.settle.length - 1] + 0.04 }); }
    }

    // ---- drawing the tabs and the bar from the video's time
    function render() {
      if (cur < 0) return;
      var s = S[cur], v = live(), t = now(), started = !!v, frac = started ? Math.min(1, t / (s.dur || 1)) : 0;
      var k = started ? stepAt(s, t) : s.steps.length - 1;
      fill.style.width = (100 * frac) + '%';
      ticks.forEach(function (b, j) { b.classList.toggle('is-past', started && j + 1 <= k); });
      count.textContent = started ? mmss(t) + ' / ' + mmss(s.dur) : (s.steps.length - 1) + ' build' + (s.steps.length === 2 ? '' : 's');
      tabFills.forEach(function (f, j) { f.style.width = (j < cur ? 100 : j > cur ? 0 : 100 * (ended ? 1 : frac)) + '%'; });
      tabBtns.forEach(function (b, j) { b.classList.toggle('is-done', j < cur); });
      var icon = playing ? 'pause' : ended ? 'replay' : 'play';
      if (bPlay._icon !== icon) { bPlay._icon = icon; bPlay.innerHTML = ICON[icon]; }
      bPlay.setAttribute('aria-label', playing ? 'Pause' : ended ? 'Play again' : 'Play');
      bPlay.title = bPlay.getAttribute('aria-label');
      node.classList.toggle('is-idle', !playing);
      // preload the next slide once this one is well under way
      if (playing && started && t > Math.min(s.dur * 0.5, s.dur - 8)) {
        var n = cur < N - 1 ? cur + 1 : LOOP ? 0 : -1;
        if (n >= 0 && n !== cur && vids[1 - act]._i !== n) load(vids[1 - act], n, 'auto');
      }
    }
    function loop() {
      cancelAnimationFrame(raf);
      (function f() { render(); if (playing) raf = requestAnimationFrame(f); })();
    }

    // ---- input
    bPlay.addEventListener('click', toggle);
    bSpeed.addEventListener('click', function () { setRate(RATE === 2 ? 1 : 2); });
    bPrev.addEventListener('click', function () { stepBy(-1); });
    bNext.addEventListener('click', function () { stepBy(1); });
    bFull.addEventListener('click', function () {
      var v = vids[act];
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      if (main.requestFullscreen) main.requestFullscreen().catch(function () { });
      else if (main.webkitRequestFullscreen) main.webkitRequestFullscreen();
      else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();                   // iPhone: the video alone
    });
    stage.addEventListener('click', toggle);
    function scrub(e) {
      var r = track.getBoundingClientRect(), x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      seekTo(x * (S[cur].dur || 0));
    }
    track.addEventListener('pointerdown', function (e) {
      scrub(e);
      track.setPointerCapture(e.pointerId);
      var move = function (m) { scrub(m); };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', function up() { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); });
    });
    node.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var onButton = e.target.closest && e.target.closest('button');
      if ((e.key === ' ' || e.key === 'k') && !onButton) { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight' || e.key === 'l') { e.preventDefault(); stepBy(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'j') { e.preventDefault(); stepBy(-1); }
    });

    // ---- when on screen: load the current slide nearby, play when mostly visible, stop when it leaves
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting && !near && !REDUCE) { near = true; load(vids[act], cur, 'auto'); }
        });
      }, { rootMargin: '400px 0px' }).observe(stage);
      new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.intersectionRatio >= 0.55) { if (!REDUCE && !user && !playing && !ended) play(); }
          else if (e.intersectionRatio < 0.3) stop();
        });
      }, { threshold: [0, 0.3, 0.55, 0.8] }).observe(stage);
    }

    var api = {
      stop: stop,
      rate: function (r) { vids.forEach(function (v) { v.defaultPlaybackRate = r; v.playbackRate = r; }); speedLabel(); }
    };
    speedLabel();
    activate(0, {});
    return api;
  }
})();
