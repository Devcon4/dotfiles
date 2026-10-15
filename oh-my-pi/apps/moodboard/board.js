(() => {
  "use strict";

  const M = window.MoodboardMosaic;
  if (!M) { console.error("[board] mosaic.js not loaded"); return; }
  const { el, shortenUrl, mountMosaic } = M;

  const REASONS = [
    "too ornate", "off-topic", "duplicate", "wrong era", "low quality", "other",
  ];

  const NOTE_COLORS = [
    { id: "yellow", label: "yellow" },
    { id: "cream",  label: "cream" },
    { id: "mint",   label: "mint" },
    { id: "lilac",  label: "lilac" },
    { id: "blush",  label: "blush" },
    { id: "sky",    label: "sky" },
  ];

  // === entry =============================================================
  let booted = false;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  async function boot() {
    if (booted) return;
    booted = true;

    const data = readData();
    if (!data) return;
    if (data.topic) document.title = `Moodboard — ${data.topic}`;

    const slug = boardSlug();
    const serverMode = location.protocol === "http:" || location.protocol === "https:";
    const state = serverMode && slug
      ? await fetchState(slug)
      : { hidden: {}, notes: [] };
    const hidden = state.hidden || {};
    const notes = Array.isArray(state.notes) ? state.notes : [];
    const filterHidden = M.readFilterPref();

    const lightbox = mountLightbox({ slug, serverMode, onHideChange, onNoteChange });
    const composer = serverMode && slug ? mountComposer({ slug, onNoteCreated }) : null;
    if (composer) mountAddNoteChip(composer.open);

    // --- merged items list ---
    function rebuildItems() {
      const pinned = notes
        .filter((n) => n.pinned)
        .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
        .map((n) => ({ kind: "note", note: n }));
      const imageItems = (data.images || [])
        .map((entry) => ({ kind: "image", entry, hidden: !!hidden[entry.url] }))
        .filter((it) => !filterHidden || !it.hidden);
      const unpinned = notes
        .filter((n) => !n.pinned)
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
        .map((n) => ({ kind: "note", note: n }));
      return [...pinned, ...imageItems, ...unpinned];
    }

    const items = rebuildItems();

    function onHideChange(url, hideState) {
      if (hideState && hideState.hidden) hidden[url] = hideState;
      else delete hidden[url];
      const tile = document.querySelector(`.mb-tile[data-url="${cssEscape(url)}"]`);
      if (tile) tile.classList.toggle("mb-hidden", !!hidden[url]);
      M.setHiddenCount(Object.keys(hidden).length);
    }

    function onNoteChange(updated, action) {
      const idx = notes.findIndex((n) => n.id === updated.id);
      if (action === "deleted") {
        if (idx >= 0) notes.splice(idx, 1);
        location.reload();   // simplest: repack
        return;
      }
      if (idx >= 0) notes[idx] = updated;
      else notes.push(updated);
      location.reload();     // pin/unpin or body change → repack for correct slot
    }

    function onNoteCreated(note) {
      notes.push(note);
      location.reload();
    }

    await mountMosaic({
      items,
      getKey: (it) => it.kind === "note" ? `note:${it.note.id}` : (it.entry.url || ""),
      measure: measureItem,
      chromeData: data,
      chromeOpts: { backHref: serverMode ? (collectionSlug() ? `/${encodeURIComponent(collectionSlug())}/` : "/") : null },
      buildTile: (placed) => buildAnyTile(placed, hidden),
      onTileClick: (placed, idx) => lightbox.open(idx),
    }).then((mosaic) => {
      lightbox.setPlaced(mosaic.placed);
      M.setHiddenCount(Object.keys(hidden).length);
    });
  }

  function urlParts() {
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts.length > 0 && parts[parts.length - 1].endsWith(".html")) {
      parts[parts.length - 1] = parts[parts.length - 1].replace(/\.html$/, "");
    }
    return parts;
  }

  function collectionSlug() {
    const parts = urlParts();
    return parts.length >= 2 ? parts[0] : "";
  }

  function boardSlug() {
    const parts = urlParts();
    if (parts.length === 0) return null;
    return parts.length >= 2 ? parts[1] : parts[0];
  }

  function apiBase() {
    const col = collectionSlug();
    return col ? `/${encodeURIComponent(col)}/api` : "/api";
  }

  // === data ==============================================================
  function readData() {
    const node = document.getElementById("moodboard-data");
    if (!node) { console.error("[board] no <script id=moodboard-data>"); return null; }
    try { return JSON.parse(node.textContent || "{}"); }
    catch (err) { console.error("[board] invalid JSON:", err); return null; }
  }

  async function fetchState(slug) {
    try {
      const res = await fetch(`${apiBase()}/state?board=${encodeURIComponent(slug)}`);
      if (!res.ok) return { hidden: {}, notes: [] };
      return await res.json();
    } catch (_) { return { hidden: {}, notes: [] }; }
  }

  async function postMark(slug, url, hidden, reason) {
    try {
      const res = await fetch(`${apiBase()}/mark`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ board: slug, url, hidden, reason }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) { console.error("[board] mark failed:", err); return null; }
  }

  async function apiNote(method, body, query) {
    const qs = query ? `?${new URLSearchParams(query)}` : "";
    const opts = { method, headers: { "content-type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${apiBase()}/note${qs}`, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  // === measure ===========================================================
  function measureItem(item) {
    if (item.kind === "note") return measureNote(item);
    return M.measure(item, (it) => it.entry.url);
  }

  function measureNote(item) {
    const n = item.note;
    const pinned = !!n.pinned;
    const w = pinned ? 420 : 280;
    const charsPerLine = pinned ? 56 : 38;
    const titleH = n.title ? 30 : 0;
    const body = n.body || "";
    const rawLines = body.split("\n");
    let lines = 0;
    for (const ln of rawLines) {
      lines += Math.max(1, Math.ceil((ln.length || 1) / charsPerLine));
    }
    const bodyH = Math.max(60, lines * 22 + 12);
    const pad = 32;
    // Pinned (centre) cards grow to fit content. Unpinned clamp so the
    // edge of the mosaic stays orderly.
    const h = pinned
      ? titleH + bodyH + pad
      : Math.min(360, titleH + bodyH + pad);
    return { item, w, h, broken: false };
  }

  // === markdown ==========================================================
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function inlineMd(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^\*])\*([^\*\n]+?)\*/g, "$1<em>$2</em>")
      .replace(/_([^_\n]+?)_/g, "<em>$1</em>")
      .replace(/`([^`\n]+?)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  function renderMarkdown(src) {
    if (!src) return "";
    const safe = escapeHtml(src);
    const lines = safe.split("\n");
    const out = [];
    let inList = null;     // "ul" | "ol" | null
    let paraBuf = [];

    const flushPara = () => {
      if (paraBuf.length) { out.push(`<p>${inlineMd(paraBuf.join(" "))}</p>`); paraBuf = []; }
    };
    const closeList = () => {
      flushPara();
      if (inList) { out.push(`</${inList}>`); inList = null; }
    };
    const ensureList = (kind) => {
      flushPara();
      if (inList !== kind) { closeList(); out.push(`<${kind}>`); inList = kind; }
    };

    for (const raw of lines) {
      const line = raw;
      let m;
      if (/^\s*$/.test(line))                  { closeList(); continue; }
      if ((m = line.match(/^###\s+(.+)$/)))    { closeList(); out.push(`<h3>${inlineMd(m[1])}</h3>`); continue; }
      if ((m = line.match(/^##\s+(.+)$/)))     { closeList(); out.push(`<h2>${inlineMd(m[1])}</h2>`); continue; }
      if ((m = line.match(/^#\s+(.+)$/)))      { closeList(); out.push(`<h1>${inlineMd(m[1])}</h1>`); continue; }
      if ((m = line.match(/^[-*]\s+(.+)$/)))   { ensureList("ul"); out.push(`<li>${inlineMd(m[1])}</li>`); continue; }
      if ((m = line.match(/^\d+\.\s+(.+)$/)))  { ensureList("ol"); out.push(`<li>${inlineMd(m[1])}</li>`); continue; }
      closeList();
      paraBuf.push(line);
    }
    closeList();
    return out.join("\n");
  }

  // === tiles =============================================================
  function buildAnyTile(placed, hidden) {
    return placed.measured.item.kind === "note"
      ? buildNoteTile(placed)
      : buildImageTile(placed, hidden);
  }

  function buildImageTile(placed) {
    const e = placed.measured.item.entry;
    const isHidden = placed.measured.item.hidden;
    const tile = el("div", {
      class: "mb-tile" + (placed.measured.broken ? " mb-broken" : "") + (isHidden ? " mb-hidden" : ""),
      "data-url": e.url || "",
      style: e.tint ? `background:${e.tint};` : "",
    });
    if (placed.measured.broken) {
      tile.appendChild(el("div", { class: "mb-broken-body" }, [
        el("span", { class: "mb-broken-badge" }, ["broken"]),
        el("div", {}, [e.url || "(no url)"]),
        e.note ? el("div", {}, [e.note]) : null,
      ]));
    } else {
      tile.appendChild(el("img", {
        src: e.url, alt: e.title || "", loading: "lazy", referrerpolicy: "no-referrer",
      }));
      if (e.title) tile.appendChild(el("div", { class: "mb-title" }, [e.title]));
      if (e.note) tile.appendChild(el("div", { class: "mb-note-glyph", title: "has curator note" }, ["i"]));
      if (isHidden) tile.appendChild(el("div", { class: "mb-hidden-badge" }, ["hidden"]));
    }
    return tile;
  }

  function buildNoteTile(placed) {
    const n = placed.measured.item.note;
    const colorClass = n.color ? ` mb-note-color-${n.color}` : "";
    const tile = el("div", {
      class: `mb-tile mb-note-tile mb-note-${n.author}${colorClass}${n.pinned ? " mb-note-pinned" : ""}`,
      "data-note-id": n.id,
    });
    const inner = el("div", { class: "mb-note-inner" });
    if (n.title) inner.appendChild(el("div", { class: "mb-note-title" }, [n.title]));
    const body = el("div", { class: "mb-note-body" });
    body.innerHTML = renderMarkdown(n.body);
    inner.appendChild(body);
    tile.appendChild(inner);
    return tile;
  }

  // === lightbox ==========================================================
  function mountLightbox({ slug, serverMode, onHideChange, onNoteChange }) {
    let placedList = [];
    let idx = 0;

    // Image view
    const imgEl = el("img", { id: "mb-lb-img" });
    const titleEl = el("div", { class: "mb-lb-title" });
    const tagsEl = el("div", { class: "mb-lb-tags" });
    const noteEl = el("div", { class: "mb-lb-note" });
    const sourceEl = el("a", { class: "mb-lb-source", target: "_blank", rel: "noopener" });
    const indexEl = el("div", { class: "mb-lb-index" });

    // Hide controls
    const hideBtn = el("button", { type: "button", class: "mb-lb-hide-btn" });
    const reasonSelect = el("select", { class: "mb-lb-reason" });
    REASONS.forEach((r) => reasonSelect.appendChild(el("option", { value: r }, [r])));
    const reasonCustom = el("input", { type: "text", class: "mb-lb-reason-custom", placeholder: "reason (other)…", maxlength: "80" });
    reasonCustom.style.display = "none";
    reasonSelect.addEventListener("change", () => {
      reasonCustom.style.display = reasonSelect.value === "other" ? "" : "none";
      if (reasonSelect.value === "other") reasonCustom.focus();
    });
    const hideRow = el("div", { class: "mb-lb-hide-row" }, [reasonSelect, reasonCustom, hideBtn]);
    if (!serverMode) hideRow.style.display = "none";

    hideBtn.addEventListener("click", async () => {
      const p = placedList[idx]; if (!p || p.measured.item.kind !== "image") return;
      const url = p.measured.item.entry.url;
      const wasHidden = p.measured.item.hidden;
      const newHidden = !wasHidden;
      const reason = newHidden
        ? (reasonSelect.value === "other" ? reasonCustom.value.trim() || "other" : reasonSelect.value)
        : null;
      hideBtn.disabled = true;
      const result = await postMark(slug, url, newHidden, reason);
      hideBtn.disabled = false;
      if (!result) return;
      p.measured.item.hidden = newHidden;
      onHideChange(url, newHidden ? { reason, at: new Date().toISOString() } : null);
      renderImage();
    });

    const meta = el("div", { class: "mb-lb-meta" }, [indexEl, titleEl, tagsEl, noteEl, hideRow, sourceEl]);
    const imageFrame = el("div", { class: "mb-lb-frame mb-lb-frame-image" }, [
      el("div", { class: "mb-lb-image-wrap" }, [imgEl]),
      meta,
    ]);

    // Note view
    const noteIndexEl = el("div", { class: "mb-lb-index" });
    const noteTitleInput = el("input", { type: "text", class: "mb-lb-note-title-input", placeholder: "title (optional)" });
    const noteBodyTextarea = el("textarea", { class: "mb-lb-note-body-input", placeholder: "markdown supported…" });
    const notePreview = el("div", { class: "mb-lb-note-preview" });
    const noteColorPicker = el("div", { class: "mb-lb-note-colors" });
    NOTE_COLORS.forEach((c) => {
      const swatch = el("button", { type: "button", class: `mb-lb-color-swatch mb-lb-color-${c.id}`, "data-color": c.id, title: c.label });
      noteColorPicker.appendChild(swatch);
    });
    const noteCancelBtn = el("button", { type: "button", class: "mb-lb-note-cancel" }, ["cancel"]);
    const noteDeleteBtn = el("button", { type: "button", class: "mb-lb-note-delete" }, ["delete"]);
    const noteEditRow = el("div", { class: "mb-lb-note-row" }, [noteColorPicker, noteDeleteBtn, noteCancelBtn]);

    const noteFrame = el("div", { class: "mb-lb-frame mb-lb-frame-note" }, [
      noteIndexEl,
      noteTitleInput,
      el("div", { class: "mb-lb-note-edit-wrap" }, [
        noteBodyTextarea,
        notePreview,
      ]),
      noteEditRow,
    ]);

    // --- edit state tracking (autosave on close, cancel discards) ---
    let liveColor = null;
    let noteSnapshot = null;       // {title, body, color} captured on open
    let noteDirty = false;
    let cancelRequested = false;

    function snapshotEqualsLive() {
      if (!noteSnapshot) return true;
      return noteSnapshot.title === noteTitleInput.value
          && noteSnapshot.body  === noteBodyTextarea.value
          && (noteSnapshot.color || null) === (liveColor || null);
    }
    function markDirty() { noteDirty = !snapshotEqualsLive(); }

    noteColorPicker.addEventListener("click", (e) => {
      const btn = e.target.closest(".mb-lb-color-swatch"); if (!btn) return;
      liveColor = btn.getAttribute("data-color");
      [...noteColorPicker.children].forEach((c) => c.classList.toggle("mb-lb-color-active", c === btn));
      markDirty();
    });

    noteBodyTextarea.addEventListener("input", () => {
      notePreview.innerHTML = renderMarkdown(noteBodyTextarea.value);
      markDirty();
    });
    noteTitleInput.addEventListener("input", markDirty);

    async function persistNoteIfDirty() {
      if (!noteDirty || cancelRequested) return;
      const p = placedList[idx]; if (!p || p.measured.item.kind !== "note") return;
      const n = p.measured.item.note;
      const body = noteBodyTextarea.value.trim();
      if (!body) { noteDirty = false; return; }  // refuse empty saves
      try {
        const r = await apiNote("PATCH", {
          board: slug, id: n.id, body,
          title: noteTitleInput.value.trim() || null,
          color: liveColor || null,
        });
        noteDirty = false;
        onNoteChange(r.note, "updated");
      } catch (err) { console.error("[note] autosave failed:", err); }
    }

    noteCancelBtn.addEventListener("click", () => {
      cancelRequested = true;
      noteDirty = false;
      closeLb();
    });

    noteDeleteBtn.addEventListener("click", async () => {
      const p = placedList[idx]; if (!p || p.measured.item.kind !== "note") return;
      const n = p.measured.item.note;
      if (!confirm(`Delete this note?\n\n${(n.title || n.body).slice(0, 80)}`)) return;
      cancelRequested = true;   // avoid autosave racing the delete
      noteDirty = false;
      noteDeleteBtn.disabled = true;
      try {
        await apiNote("DELETE", null, { board: slug, id: n.id });
        onNoteChange({ id: n.id }, "deleted");
      } catch (err) { console.error(err); }
      finally { noteDeleteBtn.disabled = false; }
    });

    const prev = el("div", { class: "mb-lb-nav mb-prev" }, ["‹"]);
    const next = el("div", { class: "mb-lb-nav mb-next" }, ["›"]);
    const close = el("div", { class: "mb-lb-close" }, ["×"]);
    const lb = el("div", { id: "mb-lightbox" }, [prev, imageFrame, noteFrame, next, close]);
    document.body.appendChild(lb);

    function renderImage() {
      imageFrame.style.display = "";
      noteFrame.style.display = "none";
      const item = placedList[idx].measured.item;
      const e = item.entry;
      imgEl.src = e.url || "";
      imgEl.alt = e.title || "";
      titleEl.textContent = e.title || "(untitled)";
      titleEl.style.display = e.title ? "" : "none";
      tagsEl.innerHTML = "";
      (e.tags || []).forEach((t) => tagsEl.appendChild(el("span", { class: "mb-lb-tag" }, [t])));
      tagsEl.style.display = (e.tags && e.tags.length) ? "" : "none";
      noteEl.textContent = e.note || "";
      noteEl.style.display = e.note ? "" : "none";
      if (e.source) {
        sourceEl.href = e.source;
        sourceEl.textContent = "↗ " + shortenUrl(e.source);
        sourceEl.style.display = "";
      } else { sourceEl.style.display = "none"; }
      indexEl.textContent = `${idx + 1} / ${placedList.length}`;
      if (serverMode) {
        hideBtn.textContent = item.hidden ? "Unhide ref" : "Hide ref";
        hideBtn.classList.toggle("mb-lb-hide-active", item.hidden);
        reasonSelect.style.display = item.hidden ? "none" : "";
        reasonCustom.style.display = (!item.hidden && reasonSelect.value === "other") ? "" : "none";
      }
      imageFrame.classList.toggle("mb-lb-frame-hidden", !!item.hidden);
    }

    function renderNote() {
      noteFrame.style.display = "";
      imageFrame.style.display = "none";
      const n = placedList[idx].measured.item.note;
      noteIndexEl.textContent = `${idx + 1} / ${placedList.length}`;
      noteTitleInput.value = n.title || "";
      noteBodyTextarea.value = n.body || "";
      notePreview.innerHTML = renderMarkdown(n.body || "");
      liveColor = n.color || null;
      [...noteColorPicker.children].forEach((c) =>
        c.classList.toggle("mb-lb-color-active", c.getAttribute("data-color") === liveColor));
      noteSnapshot = { title: noteTitleInput.value, body: noteBodyTextarea.value, color: liveColor };
      noteDirty = false;
      cancelRequested = false;
    }

    function render() {
      const p = placedList[idx]; if (!p) return;
      if (p.measured.item.kind === "note") renderNote();
      else renderImage();
    }

    function open(i) { idx = i; render(); lb.classList.add("mb-visible"); }
    async function closeLb() {
      // If a note is open and edited, autosave before close.
      if (noteFrame.style.display !== "none") await persistNoteIfDirty();
      lb.classList.remove("mb-visible");
    }
    async function step(d) {
      if (placedList.length === 0) return;
      // Persist current note before navigating away (cancel-button discards via flag).
      if (noteFrame.style.display !== "none") await persistNoteIfDirty();
      idx = (idx + d + placedList.length) % placedList.length;
      render();
    }

    lb.addEventListener("click", (e) => { if (e.target === lb) closeLb(); });
    close.addEventListener("click", closeLb);
    prev.addEventListener("click", (e) => { e.stopPropagation(); step(-1); });
    next.addEventListener("click", (e) => { e.stopPropagation(); step(1); });
    window.addEventListener("keydown", (e) => {
      if (!lb.classList.contains("mb-visible")) return;
      // Escape always closes (and autosaves); arrows only when not in a field.
      if (e.key === "Escape") { closeLb(); return; }
      if (e.target && e.target.matches && e.target.matches("input, textarea, select")) return;
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    });

    return { open, setPlaced(list) { placedList = list; } };
  }

  // === composer (add note modal) ========================================
  function mountComposer({ slug, onNoteCreated }) {
    const title = el("input", { type: "text", class: "mb-composer-title", placeholder: "title (optional)" });
    const body = el("textarea", { class: "mb-composer-body", placeholder: "what's on your mind? markdown supported…", rows: "8" });
    const pin = el("label", { class: "mb-composer-toggle" }, [
      el("input", { type: "checkbox", class: "mb-composer-pin" }),
      el("span", {}, ["pin to centre"]),
    ]);
    const colors = el("div", { class: "mb-composer-colors" });
    let pickedColor = null;
    NOTE_COLORS.forEach((c) => {
      const swatch = el("button", { type: "button", class: `mb-lb-color-swatch mb-lb-color-${c.id}`, "data-color": c.id, title: c.label });
      colors.appendChild(swatch);
    });
    colors.addEventListener("click", (e) => {
      const btn = e.target.closest(".mb-lb-color-swatch"); if (!btn) return;
      pickedColor = btn.getAttribute("data-color");
      [...colors.children].forEach((c) => c.classList.toggle("mb-lb-color-active", c === btn));
    });

    const save = el("button", { type: "button", class: "mb-composer-save" }, ["add note"]);
    const cancel = el("button", { type: "button", class: "mb-composer-cancel" }, ["cancel"]);
    const card = el("div", { class: "mb-composer-card" }, [
      el("div", { class: "mb-composer-header" }, ["New note"]),
      title, body, pin, colors,
      el("div", { class: "mb-composer-row" }, [cancel, save]),
    ]);
    const overlay = el("div", { id: "mb-composer-overlay" }, [card]);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeIt(); });
    document.body.appendChild(overlay);

    function openIt() { overlay.classList.add("mb-visible"); body.focus(); }
    function closeIt() {
      overlay.classList.remove("mb-visible");
      title.value = ""; body.value = "";
      pin.querySelector("input").checked = false;
      pickedColor = null;
      [...colors.children].forEach((c) => c.classList.remove("mb-lb-color-active"));
    }
    cancel.addEventListener("click", closeIt);
    save.addEventListener("click", async () => {
      const bd = body.value.trim(); if (!bd) return;
      save.disabled = true;
      try {
        const r = await apiNote("POST", {
          board: slug, author: "user", body: bd,
          title: title.value.trim() || undefined,
          pinned: pin.querySelector("input").checked,
          color: pickedColor || undefined,
        });
        closeIt();
        onNoteCreated(r.note);
      } catch (err) { console.error("[composer] save failed:", err); }
      finally { save.disabled = false; }
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && overlay.classList.contains("mb-visible")) closeIt();
    });

    return { open: openIt, close: closeIt };
  }

  function mountAddNoteChip(openComposer) {
    const chip = el("div", { id: "mb-addnote-chip", class: "mb-chip", title: "add note (post-it style)" });
    chip.appendChild(el("button", { type: "button", class: "mb-addnote-btn" }, ["+ note"]));
    chip.querySelector("button").addEventListener("click", openComposer);
    document.body.appendChild(chip);
  }

  function cssEscape(s) { return String(s).replace(/["\\]/g, "\\$&"); }
})();
