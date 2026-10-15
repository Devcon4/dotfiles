(() => {
  "use strict";

  const M = window.MoodboardMosaic;
  if (!M) { console.error("[homepage] mosaic.js not loaded"); return; }
  const { el, mountMosaic } = M;

  function collectionSlug() {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts[0] || "";
  }

  function apiBase() {
    const col = collectionSlug();
    return col ? `/${encodeURIComponent(col)}/api` : "/api";
  }
  if (location.protocol !== "http:" && location.protocol !== "https:") {

    showFileBanner();
    return;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  async function boot() {
    let topics;
    try {
      const res = await fetch(`${apiBase()}/topics`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      topics = body.boards || [];
    } catch (err) {
      console.error("[homepage] /api/topics failed:", err);
      showError(err);
      return;
    }

    if (topics.length === 0) {
      showEmpty();
      return;
    }

    const filterHidden = M.readFilterPref();
    const items = topics.filter((t) => !filterHidden || !t.hidden);
    const hiddenCount = topics.filter((t) => t.hidden).length;

    await mountMosaic({
      items,
      getUrl: (t) => t.hero,
      getKey: (t) => t.slug,
      chromeData: { topic: "Moodboards", subtitle: `${items.length} topic${items.length === 1 ? "" : "s"}` },
      chromeOpts: { backHref: "/" },
      buildTile: buildTopicTile,
      onTileClick: (placed) => {
        const topic = placed.measured.item;
        const col = collectionSlug();
        const prefix = col ? `/${encodeURIComponent(col)}` : "";
        location.href = `${prefix}/${encodeURIComponent(topic.slug)}/`;
      },
    });

    M.setHiddenCount(hiddenCount);
  }

  function buildTopicTile(placed) {
    const t = placed.measured.item;
    const tile = el("div", {
      class: "mb-tile mb-topic-tile" + (placed.measured.broken ? " mb-broken" : "") + (t.hidden ? " mb-hidden" : ""),
      "data-slug": t.slug,
      style: t.tint ? `background:${t.tint};` : "",
    });
    if (placed.measured.broken || !t.hero) {
      tile.appendChild(el("div", { class: "mb-broken-body" }, [
        el("span", { class: "mb-broken-badge" }, ["no hero"]),
        el("div", {}, [t.topic]),
      ]));
    } else {
      tile.appendChild(el("img", {
        src: t.hero, alt: t.topic, loading: "lazy", referrerpolicy: "no-referrer",
      }));
    }
    // Topic banner: title + counts
    const counts = t.hiddenCount > 0
      ? `${t.count} (${t.hiddenCount} hidden)`
      : `${t.count} refs`;
    tile.appendChild(el("div", { class: "mb-topic-tile-banner" }, [
      el("div", { class: "mb-topic-tile-title" }, [t.topic]),
      el("div", { class: "mb-topic-tile-count" }, [counts]),
    ]));
    if (t.hidden) tile.appendChild(el("div", { class: "mb-hidden-badge" }, ["hidden"]));

    // Hover ✕ to hide / unhide
    const hideBtn = el("button", {
      type: "button",
      class: "mb-topic-hide-btn",
      title: t.hidden ? "unhide topic" : "hide topic",
    }, [t.hidden ? "+" : "×"]);
    hideBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const newHidden = !t.hidden;
      const reason = newHidden ? prompt("Why hide this topic? (optional)") : null;
      hideBtn.disabled = true;
      try {
        const res = await fetch(`${apiBase()}/topic-mark`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ board: t.slug, hidden: newHidden, reason }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        t.hidden = newHidden;
        tile.classList.toggle("mb-hidden", newHidden);
        hideBtn.textContent = newHidden ? "+" : "×";
        hideBtn.title = newHidden ? "unhide topic" : "hide topic";
        const badge = tile.querySelector(".mb-hidden-badge");
        if (newHidden && !badge) tile.appendChild(el("div", { class: "mb-hidden-badge" }, ["hidden"]));
        else if (!newHidden && badge) badge.remove();
      } catch (err) {
        console.error("[homepage] topic-mark failed:", err);
      } finally {
        hideBtn.disabled = false;
      }
    });
    tile.appendChild(hideBtn);

    return tile;
  }

  function showFileBanner() {
    document.body.appendChild(el("div", { class: "mb-banner" }, [
      el("strong", {}, ["Homepage requires the moodboard server."]),
      el("div", {}, [
        "Run ",
        el("code", {}, ["moodboard up"]),
        " then open ",
        el("code", {}, ["http://localhost:5173/"]),
        ".",
      ]),
    ]));
  }

  function showError(err) {
    document.body.appendChild(el("div", { class: "mb-banner" }, [
      el("strong", {}, ["Couldn't load topics."]),
      el("div", {}, [String(err.message || err)]),
    ]));
  }

  function showEmpty() {
    document.body.appendChild(el("div", { class: "mb-banner" }, [
      el("strong", {}, ["No moodboards yet."]),
      el("div", {}, ["Create one under boards/<slug>.json."]),
    ]));
  }
})();
