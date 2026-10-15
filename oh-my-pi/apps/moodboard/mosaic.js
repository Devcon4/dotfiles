/* Moodboard mosaic primitives.
 *
 * Shared by board.js (per-topic image mosaic) and homepage.js (topic
 * mosaic). Owns the packer, pan/zoom, chrome (topic chip, status chip,
 * keymap), and tile-mounting plumbing. Mode-specific behaviour (data
 * source, tile DOM, lightbox, click handlers) lives in the consumers.
 *
 * Exposed via window.MoodboardMosaic. No build, no framework, file://
 * compatible.
 */
(() => {
  "use strict";

  // === config ============================================================
  const TARGET_AREA = 50_000;
  const JITTER = 0.15;
  const MIN_SIDE = 120;
  const MAX_SIDE = 520;
  const GUTTER = 14;
  const FALLBACK_ASPECT = 4 / 3;
  const FALLBACK_AREA = TARGET_AREA * 0.6;
  const SPIRAL_STEP = 18;
  const SPIRAL_MAX_R = 12_000;

  const ZOOM_MIN = 0.1;
  const ZOOM_MAX = 4.0;
  const ZOOM_STEP = 1.15;
  const PARALLAX_MAX = 6;

  // === utilities =========================================================
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") node.className = attrs[k];
      else if (k === "style") node.setAttribute("style", attrs[k]);
      else node.setAttribute(k, attrs[k]);
    }
    if (children) for (const c of children) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function shortenUrl(u) {
    try {
      const url = new URL(u);
      const host = url.hostname.replace(/^www\./, "");
      const path = url.pathname.length > 28 ? url.pathname.slice(0, 25) + "…" : url.pathname;
      return host + path;
    } catch (_) { return u; }
  }

  function seedRand(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return () => {
      h += 0x6D2B79F5;
      let t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // === measurement =======================================================
  // Resolves to { item, w, h, broken }. `item` is whatever caller passed.
  function measure(item, getUrl) {
    return new Promise((resolve) => {
      const url = getUrl(item);
      if (!url) {
        resolve({ item, w: 0, h: 0, broken: true });
        return;
      }
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.onload = () => resolve({
        item,
        w: img.naturalWidth || 1,
        h: img.naturalHeight || 1,
        broken: false,
      });
      img.onerror = () => resolve({ item, w: 0, h: 0, broken: true });
      img.src = url;
    });
  }

  // === packer ============================================================
  function sizeFor(measured, key) {
    const aspect = measured.broken ? FALLBACK_ASPECT : measured.w / measured.h;
    const baseArea = measured.broken ? FALLBACK_AREA : TARGET_AREA;
    const rand = seedRand(key || `__${Math.random()}`);
    const jitter = 1 + (rand() * 2 - 1) * JITTER;
    const area = baseArea * jitter;
    let h = Math.sqrt(area / aspect);
    let w = h * aspect;
    const scaleDown = Math.min(MAX_SIDE / w, MAX_SIDE / h, 1);
    w *= scaleDown; h *= scaleDown;
    const scaleUp = Math.max(MIN_SIDE / w, MIN_SIDE / h, 1);
    w *= scaleUp; h *= scaleUp;
    return { w: Math.round(w), h: Math.round(h) };
  }

  function collides(placed, x, y, w, h) {
    const ax1 = x - GUTTER, ay1 = y - GUTTER;
    const ax2 = x + w + GUTTER, ay2 = y + h + GUTTER;
    for (const p of placed) {
      if (ax1 < p.x + p.w && ax2 > p.x &&
          ay1 < p.y + p.h && ay2 > p.y) return true;
    }
    return false;
  }

  function findSlot(placed, w, h, key) {
    if (placed.length === 0) return { x: -w / 2, y: -h / 2 };
    const startAngle = seedRand(key + ":angle")() * Math.PI * 2;
    for (let r = 0; r <= SPIRAL_MAX_R; r += SPIRAL_STEP) {
      const arcStep = Math.max(SPIRAL_STEP / 1.5, 18);
      const steps = r === 0 ? 1 : Math.max(8, Math.ceil((2 * Math.PI * r) / arcStep));
      for (let i = 0; i < steps; i++) {
        const a = startAngle + (i / steps) * Math.PI * 2;
        const cx = Math.cos(a) * r;
        const cy = Math.sin(a) * r;
        const x = cx - w / 2;
        const y = cy - h / 2;
        if (!collides(placed, x, y, w, h)) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }

  function packAll(measuredList, getKey) {
    const placed = [];
    for (const m of measuredList) {
      const key = getKey(m.item);
      const { w, h } = sizeFor(m, key);
      const pos = findSlot(placed, w, h, key);
      placed.push({ ...pos, w, h, measured: m });
    }
    return placed;
  }

  // === root ==============================================================
  function ensureRoot() {
    let root = document.getElementById("moodboard-root");
    if (!root) {
      root = el("div", { id: "moodboard-root" });
      document.body.appendChild(root);
    }
    return root;
  }

  function mountChrome(data, opts) {
    const titleChildren = [
      data.topic || "Untitled",
      el("span", { class: "mb-count", id: "mb-count" }, ["…"]),
    ];
    if (opts && opts.backHref) {
      titleChildren.unshift(el("a", { class: "mb-back", href: opts.backHref, title: "back to topics" }, ["←"]));
    }
    const topic = el("div", { id: "mb-topic-chip", class: "mb-chip" }, [
      el("div", { class: "mb-topic-title" }, titleChildren),
      data.subtitle ? el("div", { class: "mb-topic-sub" }, [data.subtitle]) : null,
    ]);
    document.body.appendChild(topic);

    const status = el("div", { id: "mb-status-chip", class: "mb-chip" }, [
      el("span", { class: "mb-zoom", id: "mb-zoom" }, ["100%"]),
      el("span", { class: "mb-help", id: "mb-help", title: "keymap" }, ["?"]),
    ]);
    document.body.appendChild(status);

    const keymap = el("div", { id: "mb-keymap" }, [
      el("dl", {}, [
        el("dt", {}, ["drag"]),  el("dd", {}, ["pan"]),
        el("dt", {}, ["wheel"]), el("dd", {}, ["zoom"]),
        el("dt", {}, ["f"]),     el("dd", {}, ["fit all"]),
        el("dt", {}, ["r"]),     el("dd", {}, ["reset"]),
        el("dt", {}, ["+ / -"]), el("dd", {}, ["zoom step"]),
        el("dt", {}, ["← / →"]), el("dd", {}, ["lightbox nav"]),
        el("dt", {}, ["esc"]),   el("dd", {}, ["close lightbox"]),
      ]),
    ]);
    document.body.appendChild(keymap);

    mountFilterToggle();

    const help = document.getElementById("mb-help");
    help.addEventListener("mouseenter", () => keymap.classList.add("mb-visible"));
    help.addEventListener("mouseleave", () => keymap.classList.remove("mb-visible"));
  }

  function updateCount(n) {
    const c = document.getElementById("mb-count");
    if (c) c.textContent = String(n);
  }

  function setHiddenCount(n) {
    const chip = document.getElementById("mb-filter-chip");
    if (!chip) return;
    const countEl = document.getElementById("mb-filter-count");
    if (countEl) countEl.textContent = n > 0 ? `(${n})` : "";
    chip.style.display = n > 0 ? "" : "none";
  }

  // Filter preference: hide marked tiles entirely (vs faded in place).
  // URL `?show-hidden=0` wins over localStorage, both win over default.
  function readFilterPref() {
    const params = new URLSearchParams(location.search);
    const urlVal = params.get("show-hidden");
    if (urlVal === "0") return true;
    if (urlVal === "1") return false;
    try { return localStorage.getItem("mb-hide-hidden") === "1"; }
    catch (_) { return false; }
  }

  function mountFilterToggle() {
    const initial = readFilterPref();
    const input = el("input", { type: "checkbox", id: "mb-filter-input" });
    input.checked = initial;
    const chip = el("div", { id: "mb-filter-chip", class: "mb-chip mb-filter-toggle" }, [
      el("label", { class: "mb-filter-label" }, [
        input,
        el("span", { class: "mb-switch" }),
        el("span", { class: "mb-filter-text" }, ["hide marked"]),
        el("span", { class: "mb-filter-count", id: "mb-filter-count" }, [""]),
      ]),
    ]);
    chip.style.display = "none";
    document.body.appendChild(chip);
    input.addEventListener("change", () => {
      try {
        if (input.checked) localStorage.setItem("mb-hide-hidden", "1");
        else localStorage.removeItem("mb-hide-hidden");
      } catch (_) {}
      // Reload so the packer reruns against the filtered set (tight
      // mosaic instead of leaving gaps). URL stays clean — localStorage
      // is the source of truth across all boards.
      location.reload();
    });
  }

  // === pan / zoom ========================================================
  function mountPanZoom(root, viewport, board, placed) {
    const state = { tx: 0, ty: 0, scale: 1 };
    const zoomLabel = document.getElementById("mb-zoom");
    let parallax = { x: 0, y: 0 };

    function apply() {
      viewport.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
      board.style.transform = `translate(${parallax.x}px, ${parallax.y}px)`;
      if (zoomLabel) zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
    }

    function setScaleAt(newScale, cx, cy) {
      newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));
      const wx = (cx - state.tx) / state.scale;
      const wy = (cy - state.ty) / state.scale;
      state.scale = newScale;
      state.tx = cx - wx * state.scale;
      state.ty = cy - wy * state.scale;
      apply();
    }

    function bbox() {
      if (placed.length === 0) return { x: -100, y: -100, w: 200, h: 200 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of placed) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x + p.w > maxX) maxX = p.x + p.w;
        if (p.y + p.h > maxY) maxY = p.y + p.h;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    function fit() {
      const b = bbox();
      const pad = 60;
      const vw = root.clientWidth, vh = root.clientHeight;
      const s = Math.min((vw - pad * 2) / b.w, (vh - pad * 2) / b.h, 1.2);
      state.scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s));
      state.tx = vw / 2 - (b.x + b.w / 2) * state.scale;
      state.ty = vh / 2 - (b.y + b.h / 2) * state.scale;
      apply();
    }

    function reset() {
      state.scale = 1;
      state.tx = root.clientWidth / 2;
      state.ty = root.clientHeight / 2;
      apply();
    }

    // pan
    let dragging = false, startX = 0, startY = 0, startTx = 0, startTy = 0;
    root.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      if (e.target.closest(".mb-tile, .mb-chip, #mb-lightbox, #mb-keymap")) return;
      dragging = true;
      root.classList.add("grabbing");
      startX = e.clientX; startY = e.clientY;
      startTx = state.tx; startTy = state.ty;
      root.setPointerCapture(e.pointerId);
    });
    root.addEventListener("pointermove", (e) => {
      if (!dragging) {
        const vw = root.clientWidth, vh = root.clientHeight;
        const nx = (e.clientX / vw - 0.5) * 2;
        const ny = (e.clientY / vh - 0.5) * 2;
        parallax = { x: -nx * PARALLAX_MAX, y: -ny * PARALLAX_MAX };
        board.style.transform = `translate(${parallax.x}px, ${parallax.y}px)`;
        return;
      }
      state.tx = startTx + (e.clientX - startX);
      state.ty = startTy + (e.clientY - startY);
      apply();
    });
    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      root.classList.remove("grabbing");
      try { root.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    root.addEventListener("pointerup", endDrag);
    root.addEventListener("pointercancel", endDrag);

    // wheel zoom
    root.addEventListener("wheel", (e) => {
      if (e.target.closest("#mb-lightbox, #mb-keymap")) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setScaleAt(state.scale * factor, e.clientX, e.clientY);
    }, { passive: false });

    // pinch zoom
    const pointers = new Map();
    let pinchStartDist = 0, pinchStartScale = 1;
    root.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, e);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        pinchStartScale = state.scale;
      }
    });
    root.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, e);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const cx = (a.clientX + b.clientX) / 2;
        const cy = (a.clientY + b.clientY) / 2;
        setScaleAt(pinchStartScale * (d / pinchStartDist), cx, cy);
      }
    });
    function dropPointer(e) { pointers.delete(e.pointerId); }
    root.addEventListener("pointerup", dropPointer);
    root.addEventListener("pointercancel", dropPointer);

    // keys
    window.addEventListener("keydown", (e) => {
      if (e.target && e.target.matches && e.target.matches("input, textarea, select")) return;
      const lb = document.getElementById("mb-lightbox");
      if (lb && lb.classList.contains("mb-visible")) return;
      const vw = root.clientWidth, vh = root.clientHeight;
      switch (e.key) {
        case "f": fit(); break;
        case "r": reset(); break;
        case "+": case "=": setScaleAt(state.scale * ZOOM_STEP, vw / 2, vh / 2); break;
        case "-": case "_": setScaleAt(state.scale / ZOOM_STEP, vw / 2, vh / 2); break;
        case "ArrowLeft":  state.tx += 80; apply(); break;
        case "ArrowRight": state.tx -= 80; apply(); break;
        case "ArrowUp":    state.ty += 80; apply(); break;
        case "ArrowDown":  state.ty -= 80; apply(); break;
      }
    });

    window.addEventListener("resize", apply);
    apply();
    return { fit, reset };
  }

  // === main mount ========================================================
  // opts: { items, getUrl?, getKey, buildTile, onTileClick, chromeData,
  //         chromeOpts, measure? }
  // measure(item) → Promise<{ item, w, h, broken }>. Default uses getUrl
  // and natural image dimensions; provide a custom measure to mix in
  // synthetic-size items (e.g. notes).
  async function mountMosaic(opts) {
    if (opts.chromeData) mountChrome(opts.chromeData, opts.chromeOpts || {});

    const root = ensureRoot();
    const viewport = el("div", { class: "mb-viewport" });
    const board = el("div", { class: "mb-board" });
    viewport.appendChild(board);
    root.appendChild(viewport);

    const measureFn = opts.measure
      ? (it) => Promise.resolve(opts.measure(it))
      : (it) => measure(it, opts.getUrl);
    const measured = await Promise.all(opts.items.map(measureFn));
    const placed = packAll(measured, (it) => opts.getKey(it));

    const frag = document.createDocumentFragment();
    placed.forEach((p, idx) => {
      const tile = opts.buildTile(p, idx);
      tile.style.left = `${p.x}px`;
      tile.style.top = `${p.y}px`;
      tile.style.width = `${p.w}px`;
      tile.style.height = `${p.h}px`;
      if (opts.onTileClick) {
        tile.addEventListener("click", (e) => {
          e.stopPropagation();
          opts.onTileClick(p, idx, e);
        });
      }
      frag.appendChild(tile);
    });
    board.appendChild(frag);

    updateCount(placed.length);
    const ctrl = mountPanZoom(root, viewport, board, placed);
    ctrl.fit();

    return { root, board, placed, ctrl };
  }

  window.MoodboardMosaic = {
    el, shortenUrl, measure, mountMosaic, ensureRoot,
    readFilterPref, setHiddenCount,
  };
})();
