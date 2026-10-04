/* Pointer-based drag tracking. Deliberately DOM-light: the caller owns
 * ghosts, hit-testing, and preview state; this module owns the pointer
 * lifecycle (threshold, rAF throttling, Escape-to-cancel, cleanup). */

export interface DragHandlers {
  /** Fired once the pointer moves past the threshold. */
  onStart: (e: PointerEvent) => void;
  /** rAF-throttled while dragging. */
  onMove: (e: PointerEvent) => void;
  /** Pointer released while dragging. */
  onDrop: (e: PointerEvent) => void;
  /** Escape / pointercancel, or release before threshold (started=false). */
  onCancel: (started: boolean) => void;
}

export function trackDrag(down: PointerEvent, handlers: DragHandlers, threshold = 6): void {
  let started = false;
  let raf = 0;
  let last: PointerEvent = down;

  const move = (e: PointerEvent) => {
    last = e;
    if (!started) {
      if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < threshold) return;
      started = true;
      handlers.onStart(e);
    }
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        handlers.onMove(last);
      });
  };

  const finish = (e: PointerEvent) => {
    cleanup();
    if (started) handlers.onDrop(e);
    else handlers.onCancel(false);
  };

  const cancel = () => {
    cleanup();
    handlers.onCancel(started);
  };

  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
    }
  };

  const cleanup = () => {
    if (raf) cancelAnimationFrame(raf);
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", finish);
    removeEventListener("pointercancel", cancel);
    removeEventListener("keydown", key, true);
  };

  addEventListener("pointermove", move);
  addEventListener("pointerup", finish);
  addEventListener("pointercancel", cancel);
  addEventListener("keydown", key, true);
}

/** Scroll `el` when the pointer nears its edges (call per onMove). */
export function edgeScroll(
  el: Element,
  x: number,
  y: number,
  opts?: { margin?: number; speed?: number; axis?: "x" | "y" | "both" },
): void {
  const margin = opts?.margin ?? 48;
  const speed = opts?.speed ?? 14;
  const axis = opts?.axis ?? "both";
  const r = el.getBoundingClientRect();
  if (axis !== "y") {
    if (x < r.left + margin) el.scrollLeft -= speed;
    else if (x > r.right - margin) el.scrollLeft += speed;
  }
  if (axis !== "x") {
    if (y < r.top + margin) el.scrollTop -= speed;
    else if (y > r.bottom - margin) el.scrollTop += speed;
  }
}
