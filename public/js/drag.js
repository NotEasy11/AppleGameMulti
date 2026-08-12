import { TARGET_SUM } from "./board.js";

export function createDragController({ boardEl, frameEl, cellEls, centers, values, isRemoved, onCommit }) {
  const eventEl = frameEl || boardEl;

  const box = document.createElement("div");
  box.className = "selection-box";
  boardEl.appendChild(box);

  let dragging = false;
  let cancelled = false;
  let startX = 0;
  let startY = 0;
  let selected = new Set();

  function boardPoint(e) {
    const rect = boardEl.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function computeSelection(minX, minY, maxX, maxY) {
    const included = [];
    let sum = 0;
    for (let i = 0; i < centers.length; i++) {
      if (isRemoved(i)) continue;
      const c = centers[i];
      if (c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY) {
        included.push(i);
        sum += values[i];
      }
    }
    return { included, sum };
  }

  function applySelectedClasses(included) {
    const next = new Set(included);
    for (const idx of selected) {
      if (!next.has(idx)) {
        cellEls[idx].classList.remove("selected");
      }
    }
    for (const idx of next) {
      if (!selected.has(idx)) {
        cellEls[idx].classList.add("selected");
      }
    }
    selected = next;
  }

  function clearSelectedClasses() {
    for (const idx of selected) {
      cellEls[idx].classList.remove("selected");
    }
    selected = new Set();
  }

  function updateBox(minX, minY, maxX, maxY, sumIsTen) {
    box.style.display = "block";
    box.style.left = `${minX}px`;
    box.style.top = `${minY}px`;
    box.style.width = `${maxX - minX}px`;
    box.style.height = `${maxY - minY}px`;
    box.classList.toggle("sum-ten", sumIsTen);
  }

  function hideBox() {
    box.style.display = "none";
    box.classList.remove("sum-ten");
  }

  function endDrag() {
    dragging = false;
    hideBox();
    clearSelectedClasses();
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    dragging = true;
    cancelled = false;
    const p = boardPoint(e);
    startX = p.x;
    startY = p.y;
    eventEl.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragging || cancelled) return;
    const p = boardPoint(e);
    const minX = Math.min(startX, p.x);
    const minY = Math.min(startY, p.y);
    const maxX = Math.max(startX, p.x);
    const maxY = Math.max(startY, p.y);
    const { included, sum } = computeSelection(minX, minY, maxX, maxY);
    updateBox(minX, minY, maxX, maxY, sum === TARGET_SUM && included.length > 0);
    applySelectedClasses(included);
  }

  function onPointerUp(e) {
    if (!dragging) return;
    eventEl.releasePointerCapture(e.pointerId);
    if (cancelled) {
      endDrag();
      return;
    }
    const p = boardPoint(e);
    const minX = Math.min(startX, p.x);
    const minY = Math.min(startY, p.y);
    const maxX = Math.max(startX, p.x);
    const maxY = Math.max(startY, p.y);
    const { included, sum } = computeSelection(minX, minY, maxX, maxY);
    endDrag();
    if (sum === TARGET_SUM && included.length > 0) {
      onCommit(included);
    } else {
      onCommit([]);
    }
  }

  function onKeyDown(e) {
    if (dragging && e.key === "Escape") {
      cancelled = true;
      endDrag();
    }
  }

  function onContextMenu(e) {
    if (dragging) {
      e.preventDefault();
      cancelled = true;
      endDrag();
    }
  }

  eventEl.addEventListener("pointerdown", onPointerDown);
  eventEl.addEventListener("pointermove", onPointerMove);
  eventEl.addEventListener("pointerup", onPointerUp);
  eventEl.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);

  return {
    destroy() {
      eventEl.removeEventListener("pointerdown", onPointerDown);
      eventEl.removeEventListener("pointermove", onPointerMove);
      eventEl.removeEventListener("pointerup", onPointerUp);
      eventEl.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
    },
  };
}
