(() => {
  const app = globalThis.PersonalImageZoom;
  if (app.source) return;
  const cache = new Map();
  const scriptIndexes = new WeakMap();
  function find(url) { return Array.from(document.images).find(img => (img.currentSrc || img.src) === url); }
  function srcset(value) {
    const result = [];
    const pattern = /([^\s]+)\s+(\d*\.?\d+)(w|x)\s*(?:,|$)/g;
    for (const match of (value || "").matchAll(pattern)) if (!match[1].startsWith("data:")) result.push(match[1]);
    return result;
  }
  function googleOriginals(text, thumbnails, script) {
    const cached = script && scriptIndexes.get(script);
    if (cached?.text === text) return thumbnails.flatMap(url => cached.index.get(url) || []);
    const index = new Map();
    // Known Google data tuple: [thumbnail,height,width],[original,height,width].
    // Parse JSON strings/numbers only; never execute Google's inline scripts.
    const tuple = /\[\s*("(?:\\.|[^"\\])*")\s*,\s*\d+\s*,\s*\d+\s*\]\s*,\s*\[\s*("(?:\\.|[^"\\])*")\s*,\s*\d+\s*,\s*\d+\s*\]/g;
    for (const match of text.matchAll(tuple)) {
      try {
        const thumbnail = JSON.parse(match[1]), original = JSON.parse(match[2]);
        if (!index.has(thumbnail)) index.set(thumbnail, []);
        index.get(thumbnail).push(original);
      } catch { /* Unrecognized data. */ }
    }
    if (script) scriptIndexes.set(script, { text, index });
    return thumbnails.flatMap(url => index.get(url) || []);
  }
  function candidates(img, fallback) {
    const urls = new Set();
    function add(value) {
      if (!value || urls.size >= 32) return;
      try {
        const url = new URL(value, document.baseURI);
        if (["http:", "https:", "blob:", "data:"].includes(url.protocol) && !url.username && !url.password && (url.protocol !== "data:" || value.startsWith("data:image/"))) urls.add(url.href);
      } catch { /* Not an image URL. */ }
    }
    add(fallback);
    if (!img) return Array.from(urls);
    add(img.currentSrc); add(img.src);
    for (const url of srcset(img.srcset)) add(url);
    for (const source of img.parentElement?.tagName === "PICTURE" ? img.parentElement.querySelectorAll("source") : []) {
      if (!source.media || matchMedia(source.media).matches) for (const url of srcset(source.srcset)) add(url);
    }
    for (let node = img, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
      // Do not collect another result's metadata from a shared grid container.
      if (node !== img && node.querySelectorAll("img").length > 1) break;
      for (const name of ["data-ou", "data-iurl", "data-original", "data-full", "data-full-src", "data-src"]) add(node.getAttribute(name));
      const links = node.tagName === "A" ? [node] : Array.from(node.querySelectorAll("a[href]")).slice(0, 12);
      for (const link of links) {
        try {
          const url = new URL(link.href, document.baseURI);
          add(url.searchParams.get("imgurl")); add(url.searchParams.get("mediaurl"));
          if (/\.(avif|webp|jpe?g|png|gif|bmp)(?:$|[?#])/i.test(url.href)) add(url.href);
        } catch { /* Ignore invalid links. */ }
      }
    }
    if (app.config.googleHosts.includes(location.hostname)) {
      const thumbnails = [fallback, img.currentSrc, img.src];
      let budget = 8 * 1024 * 1024;
      for (const script of document.scripts) {
        const text = script.textContent;
        if (text.length > budget) continue;
        budget -= text.length;
        for (const url of googleOriginals(text, thumbnails, script)) add(url);
      }
    }
    return Array.from(urls);
  }
  async function best(img, fallback, signal) {
    const urls = candidates(img, fallback);
    signal.throwIfAborted();
    if (urls.length === 1) return { url: fallback, alternatives: false, complete: true, width: img?.naturalWidth || 0, height: img?.naturalHeight || 0 };
    // Reuse measurements for hover, opening and copying; never cache image bytes.
    const key = JSON.stringify(urls);
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return { ...cached.result };
    cache.delete(key);
    const timeout = AbortSignal.timeout(app.config.sourceTimeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    let winner = { url: fallback, area: (img?.naturalWidth || 0) * (img?.naturalHeight || 0), width: img?.naturalWidth || 0, height: img?.naturalHeight || 0, alternatives: true };
    let index = 0;
    let successful = 0;
    function measure(url) {
      return new Promise(resolve => {
        if (combined.aborted) { resolve(); return; }
        const probe = new Image();
        const finish = okay => {
          const area = okay ? probe.naturalWidth * probe.naturalHeight : 0;
          if (area) successful++;
          if (area > winner.area || (area && area === winner.area && winner.url === fallback && url !== fallback)) winner = { url, area, width: probe.naturalWidth, height: probe.naturalHeight, alternatives: true };
          probe.onload = probe.onerror = null;
          combined.removeEventListener("abort", abort);
          probe.removeAttribute("src"); resolve();
        };
        const abort = () => finish(false);
        combined.addEventListener("abort", abort, { once: true });
        probe.onload = () => finish(true); probe.onerror = () => finish(false);
        probe.src = url;
      });
    }
    await Promise.all(Array.from({ length: Math.min(3, urls.length) }, async () => {
      while (index < urls.length && !combined.aborted) await measure(urls[index++]);
    }));
    signal.throwIfAborted();
    winner.complete = successful === urls.length && !timeout.aborted;
    if (winner.complete && key.length <= 65536) {
      cache.set(key, { result: { ...winner }, expires: Date.now() + app.config.resolutionCacheMs });
      while (cache.size > app.config.resolutionCacheEntries) cache.delete(cache.keys().next().value);
    }
    return winner;
  }
  app.source = { find, srcset, googleOriginals, candidates, best };
})();
