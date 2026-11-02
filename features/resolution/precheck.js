(() => {
  const app = globalThis.PersonalImageZoom;
  if (app.precheck) return;
  function identity(img) {
    const parts = [img.currentSrc || img.src, img.srcset || ""];
    for (let node = img, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
      for (const name of ["data-full", "data-original", "data-iurl", "data-ou", "data-src", "href", "srcset"]) parts.push(node.getAttribute?.(name) || "");
    }
    return parts.join("\n");
  }

  // The queue is independent of DOM observers so its concurrency can be tested.
  function createQueue(eligible, measure = (img, signal) => app.source.best(img, img.currentSrc || img.src, signal)) {
    const records = new WeakMap(), waiting = new Map(), running = new Map();
    function lookup(img) {
      const record = records.get(img);
      return record && record.key === identity(img) && (!record.done || record.expires > Date.now()) ? record : null;
    }
    function remove(img) {
      const record = records.get(img);
      if (!record || record.done) return;
      waiting.delete(img); record.controller.abort(); record.resolve(null);
      records.delete(img);
    }
    function drain() {
      while (running.size < app.config.resolutionPrecheckConcurrency && waiting.size) {
        const [img, record] = waiting.entries().next().value;
        waiting.delete(img);
        if (!eligible(img)) { remove(img); continue; }
        running.set(record, img);
        void Promise.resolve().then(() => {
          record.controller.signal.throwIfAborted();
          return measure(img, record.controller.signal);
        }).then(result => {
          if (record.controller.signal.aborted || records.get(img) !== record || record.key !== identity(img)) { record.resolve(null); return; }
          record.done = true; record.result = result;
          record.expires = Date.now() + (result?.complete && result?.alternatives ? app.config.resolutionCacheMs : 30000);
          record.resolve(result);
        }).catch(() => {
          if (records.get(img) === record) records.delete(img);
          record.resolve(null);
        }).finally(() => { running.delete(record); drain(); });
      }
    }
    function add(img, priority = false) {
      const existing = lookup(img);
      if (existing) {
        if (priority && waiting.has(img)) {
          waiting.delete(img); const rest = Array.from(waiting); waiting.clear(); waiting.set(img, existing);
          for (const [key, value] of rest) waiting.set(key, value);
        }
        return existing;
      }
      remove(img);
      let resolve;
      const record = { key: identity(img), controller: new AbortController(), done: false, result: null, promise: new Promise(done => { resolve = done; }), resolve: value => resolve(value) };
      records.set(img, record);
      if (priority) { const rest = Array.from(waiting); waiting.clear(); waiting.set(img, record); for (const [key, value] of rest) waiting.set(key, value); }
      else waiting.set(img, record);
      drain();
      return record;
    }
    function cancelPending() {
      for (const img of Array.from(waiting.keys())) remove(img);
      for (const img of Array.from(running.values())) remove(img);
    }
    function invalidate(img) { remove(img); records.delete(img); }
    return { add, lookup, remove, invalidate, cancelPending };
  }

  let manager = null, canCheck = () => false;
  function start(enabled) {
    if (manager) return;
    const tracked = new Set(), visible = new Set();
    let page = location.href, scheduled = false;
    const eligible = img => {
      if (!enabled() || document.hidden || !img.isConnected || !visible.has(img) || !img.complete || !img.naturalWidth) return false;
      const rect = img.getBoundingClientRect();
      const style = getComputedStyle(img);
      return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0" && rect.width >= app.config.minThumbnailWidth && rect.height >= app.config.minThumbnailHeight && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    };
    canCheck = eligible;
    manager = createQueue(eligible);
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) { visible.add(entry.target); if (eligible(entry.target)) manager.add(entry.target); }
        else { visible.delete(entry.target); manager.remove(entry.target); }
      }
    });
    function discover(root) {
      if (!enabled()) return;
      const images = root instanceof HTMLImageElement ? [root] : root.querySelectorAll?.("img") || [];
      for (const img of images) if (!tracked.has(img)) { tracked.add(img); observer.observe(img); }
    }
    function refresh() {
      scheduled = false;
      if (location.href !== page) { page = location.href; manager.cancelPending(); for (const img of visible) manager.invalidate(img); discover(document); }
      if (!enabled() || document.hidden) { manager.cancelPending(); return; }
      for (const img of visible) if (eligible(img)) manager.add(img); else manager.remove(img);
    }
    function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(refresh); } }
    const mutations = new MutationObserver(entries => {
      let metadataChanged = false;
      for (const entry of entries) {
        if (entry.type === "childList") {
          if (entry.target.tagName === "SCRIPT") metadataChanged = true;
          for (const node of entry.addedNodes) {
            discover(node);
            if (node.tagName === "SCRIPT" || node.querySelector?.("script")) metadataChanged = true;
          }
        }
        else {
          const images = entry.target instanceof HTMLImageElement ? [entry.target] : entry.target.querySelectorAll?.("img") || [];
          for (const img of images) manager.invalidate(img);
        }
      }
      if (metadataChanged) for (const img of visible) manager.invalidate(img);
      for (const img of tracked) if (!img.isConnected) { observer.unobserve(img); tracked.delete(img); visible.delete(img); manager.remove(img); }
      schedule();
    });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset", "data-full", "data-original", "data-iurl", "data-ou", "data-src", "href"] });
    document.addEventListener("load", schedule, true);
    document.addEventListener("visibilitychange", () => { if (document.hidden) manager.cancelPending(); else schedule(); });
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("popstate", schedule);
    window.addEventListener("pagehide", () => manager.cancelPending());
    window.addEventListener("pageshow", schedule);
    discover(document);
  }
  app.precheck = { start, createQueue, lookup: img => manager?.lookup(img), prioritize: img => canCheck(img) ? manager.add(img, true) : null };
})();
