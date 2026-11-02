(() => {
  const app = globalThis.PersonalImageZoom;
  if (app.resolution) return;
  function classify(result) {
    const width = result.width || 0, height = result.height || 0;
    const dimensions = width && height ? `${width} × ${height} px` : "";
    if (!result.complete || !result.alternatives || !dimensions) {
      return { color: "unknown", label: "?", title: `Höchste Auflösung unbekannt${dimensions ? `; bisher ${dimensions}` : ""}. ${!result.alternatives ? "Nur das Thumbnail ist bekannt." : "Nicht alle Bildvarianten konnten geprüft werden."}` };
    }
    const edge = Math.max(width, height);
    const color = edge >= app.config.resolutionHighEdge ? "high" : edge >= app.config.resolutionMediumEdge ? "medium" : "low";
    const label = { high: "H", medium: "M", low: "L" }[color];
    return { color, label, title: `Höchste gefundene Auflösung: ${dimensions} · ${(width * height / 1e6).toFixed(1)} MP. ${color === "high" ? "Hoch" : color === "medium" ? "Mittel" : "Niedrig"} (längere Bildkante). Nicht zugängliche Originale können größer sein.` };
  }
  function create(render) {
    let current = null, currentUrl = null, controller = null, timer = null;
    function clear() {
      clearTimeout(timer);
      controller?.abort();
      controller = null; current = null; currentUrl = null;
    }
    function show(img) {
      const url = img.currentSrc || img.src;
      if (current === img && currentUrl === url) return;
      clear();
      current = img; currentUrl = url;
      controller = new AbortController();
      const { signal } = controller;
      const cached = app.precheck?.lookup(img);
      if (cached?.done && cached.result) { render(classify(cached.result)); return; }
      render({ color: "loading", label: "…", title: "Höchste erreichbare Auflösung wird geprüft…" });
      timer = setTimeout(async () => {
        try {
          // Join/prefer the visible-image queue instead of duplicating its image loads.
          const precheck = app.precheck?.prioritize(img);
          const result = precheck ? await precheck.promise : await app.source.best(img, url, signal);
          if (!result) {
            if (!signal.aborted) render({ color: "unknown", label: "?", title: "Vorprüfung unterbrochen. Beim Öffnen wird erneut geprüft." });
            return;
          }
          if (!signal.aborted && img.isConnected && (img.currentSrc || img.src) === url) render(classify(result));
        } catch (error) {
          if (!signal.aborted) render({ color: "unknown", label: "?", title: "Auflösung konnte nicht ermittelt werden. Beim Öffnen wird erneut geprüft." });
        }
      }, app.config.resolutionHoverDelayMs);
    }
    return { show, clear };
  }
  app.resolution = { classify, create };
})();
