(() => {
  const app = globalThis.PersonalImageZoom;
  if (app.zoom) return;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  function zoomAt(state, factor, point) {
    const scale = clamp(state.scale * factor, app.config.minZoom, app.config.maxZoom);
    const ratio = scale / state.scale;
    return { scale, x: point.x - (point.x - state.x) * ratio, y: point.y - (point.y - state.y) * ratio };
  }
  function attach(stage, img, report, signal) {
    let state = { scale: 1, x: 0, y: 0 };
    let pointer = null;
    function paint() {
      img.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
      report(`${Math.round(state.scale * 100)}%`);
    }
    function reset() {
      if (!img.naturalWidth) return;
      const fit = Math.min(1, (stage.clientWidth - 48) / img.naturalWidth, (stage.clientHeight - 48) / img.naturalHeight);
      state = { scale: clamp(fit, 0.01, app.config.maxZoom), x: 0, y: 0 };
      paint();
    }
    stage.addEventListener("wheel", event => {
      event.preventDefault();
      event.stopPropagation();
      if (!img.naturalWidth) return;
      const rect = stage.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
      const delta = clamp(event.deltaY * unit, -600, 600);
      state = zoomAt(state, Math.exp(-delta * app.config.wheelSensitivity), {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2
      });
      paint();
    }, { passive: false, signal });
    stage.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      stage.setPointerCapture(event.pointerId);
      stage.classList.add("dragging");
      event.preventDefault();
    }, { signal });
    stage.addEventListener("pointermove", event => {
      if (pointer?.id !== event.pointerId) return;
      state.x += event.clientX - pointer.x;
      state.y += event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      paint();
    }, { signal });
    const stop = () => { pointer = null; stage.classList.remove("dragging"); };
    stage.addEventListener("pointerup", stop, { signal });
    stage.addEventListener("pointercancel", stop, { signal });
    stage.addEventListener("lostpointercapture", stop, { signal });
    img.addEventListener("load", reset, { signal });
    window.addEventListener("resize", reset, { signal });
    return { reset };
  }
  app.zoom = { attach, zoomAt };
})();
