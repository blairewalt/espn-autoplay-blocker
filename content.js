// ESPN Autoplay Blocker
//
// Runs in the page's own JavaScript world at document_start, before any of
// ESPN's scripts. A video may only start if the user recently clicked on it
// (or on its player), or pressed a play key while focused inside it.
// Everything else - the autoplay attribute, scripted play() calls, players
// that start on scroll or after navigation - is refused the same way the
// browser's own autoplay policy refuses it, so players fall back to showing
// their normal play button.
(() => {
  'use strict';

  if (window.__espnAutoplayBlocker) return;
  window.__espnAutoplayBlocker = true;

  // How long after a click a player may take to actually start playback
  // (it often has to fetch a manifest or an ad first).
  const GESTURE_WINDOW_MS = 10000;
  const PLAY_KEYS = new Set(['Enter', ' ', 'k', 'K']);

  const proto = HTMLMediaElement.prototype;
  const origPlay = proto.play;
  const origPause = proto.pause;

  let gesture = null; // { time, path, x, y, target }
  let unlocked = []; // [{ ref: WeakRef<video>, rect }] videos the user started
  let unlockedPath = location.pathname;

  const area = (r) => Math.max(0, r.width) * Math.max(0, r.height);

  function pageRect(el) {
    const r = el.getBoundingClientRect();
    return {
      left: r.left + window.scrollX,
      top: r.top + window.scrollY,
      width: r.width,
      height: r.height,
    };
  }

  function overlapArea(a, b) {
    const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
    const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function parentOf(node) {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode && node.getRootNode();
    return root && root.host ? root.host : null; // step out of shadow DOM
  }

  // True if `target` (what the user clicked / had focused) sits inside a
  // player-sized container that also holds `video`.
  function sharesPlayer(target, video) {
    const videoArea = area(video.getBoundingClientRect());
    const maxArea = Math.max(videoArea * 3, window.innerWidth * window.innerHeight * 0.5);
    let node = target;
    for (let i = 0; node && i < 10; i++, node = parentOf(node)) {
      if (node === document.body || node === document.documentElement) return false;
      if (node === video) return true;
      if (node.contains && node.contains(video)) {
        return area(node.getBoundingClientRect()) <= maxArea;
      }
    }
    return false;
  }

  function gestureApplies(video) {
    if (!gesture) return false;
    if (performance.now() - gesture.time > GESTURE_WINDOW_MS) return false;
    if (gesture.path !== location.pathname) return false; // click was a navigation
    if (gesture.x !== null) {
      const r = video.getBoundingClientRect();
      if (
        area(r) > 0 &&
        gesture.x >= r.left && gesture.x <= r.right &&
        gesture.y >= r.top && gesture.y <= r.bottom
      ) {
        return true; // clicked on the video, or on an overlay covering it
      }
    }
    return gesture.target ? sharesPlayer(gesture.target, video) : false;
  }

  function unlock(video) {
    unlocked = unlocked.filter((u) => u.ref.deref() && u.ref.deref() !== video);
    unlocked.push({ ref: new WeakRef(video), rect: pageRect(video) });
  }

  function isUnlocked(video) {
    const rect = pageRect(video);
    for (const u of unlocked) {
      if (u.ref.deref() === video) return true;
      // A different <video> in the same spot as one the user started: this
      // is the player swapping elements (pre-roll ad -> content).
      const smaller = Math.min(area(rect), area(u.rect));
      if (smaller > 0 && overlapArea(rect, u.rect) >= smaller * 0.5) {
        unlock(video);
        return true;
      }
    }
    return false;
  }

  function isAllowed(video) {
    if (location.pathname !== unlockedPath) {
      // In-page navigation to another article: start from scratch.
      unlocked = [];
      unlockedPath = location.pathname;
    }
    if (isUnlocked(video)) return true;
    if (gestureApplies(video)) {
      unlock(video);
      return true;
    }
    return false;
  }

  // --- Track genuine user gestures -----------------------------------------

  function deepTarget(event) {
    const path = event.composedPath ? event.composedPath() : [];
    return path[0] instanceof Element ? path[0] : event.target;
  }

  function onPointer(event) {
    if (!event.isTrusted) return;
    gesture = {
      time: performance.now(),
      path: location.pathname,
      x: event.clientX,
      y: event.clientY,
      target: deepTarget(event),
    };
  }

  function onKey(event) {
    if (!event.isTrusted || !PLAY_KEYS.has(event.key)) return;
    gesture = {
      time: performance.now(),
      path: location.pathname,
      x: null,
      y: null,
      target: deepTarget(event),
    };
  }

  window.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('click', onPointer, true);
  window.addEventListener('keydown', onKey, true);

  // --- Block scripted playback ---------------------------------------------

  proto.play = function play() {
    if (this instanceof HTMLVideoElement && !isAllowed(this)) {
      return Promise.reject(
        new DOMException('Autoplay blocked by ESPN Autoplay Blocker.', 'NotAllowedError')
      );
    }
    return origPlay.apply(this, arguments);
  };

  // --- Block the autoplay attribute / property -----------------------------

  const autoplayDesc = Object.getOwnPropertyDescriptor(proto, 'autoplay');
  if (autoplayDesc && autoplayDesc.set) {
    Object.defineProperty(proto, 'autoplay', {
      ...autoplayDesc,
      set(value) {
        if (this instanceof HTMLVideoElement) return;
        autoplayDesc.set.call(this, value);
      },
    });
  }

  function stripAutoplay(node) {
    if (!(node instanceof Element)) return;
    if (node instanceof HTMLVideoElement) node.removeAttribute('autoplay');
    for (const v of node.querySelectorAll('video[autoplay]')) v.removeAttribute('autoplay');
  }

  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') stripAutoplay(record.target);
      else for (const node of record.addedNodes) stripAutoplay(node);
    }
  }).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['autoplay'],
  });

  // --- Backstop: pause anything that started anyway ------------------------

  document.addEventListener(
    'play',
    (event) => {
      const video = event.target;
      if (video instanceof HTMLVideoElement && !isAllowed(video)) origPause.call(video);
    },
    true
  );
})();
