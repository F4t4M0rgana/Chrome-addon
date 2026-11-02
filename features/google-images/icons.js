(() => {
  const app = globalThis.PersonalImageZoom;
  if (app.icons) return;
  let started = false;
  function enabled() {
    const url = new URL(location.href);
    return app.config.googleImagesIcons && app.config.googleHosts.includes(url.hostname) &&
      (url.hostname.startsWith("images.") || url.searchParams.get("tbm") === "isch" || url.searchParams.get("udm") === "2");
  }
  async function start() {
    if (started) return;
    started = true;
    if (!app.config.googleHosts.includes(location.hostname)) return;
    app.precheck.start(enabled);
    // One delegated listener and one reusable pair of buttons. No scans or polling.
    let host, shadow, button, copyButton, indicator, notice, noticeTimer, target = null, point = null, frame = 0, loading = null;
    const resolution = app.resolution.create(state => {
      indicator.dataset.level = state.color;
      indicator.textContent = state.label;
      indicator.title = state.title;
      indicator.setAttribute("aria-label", state.title);
    });
    const hide = () => { target = null; resolution.clear(); if (button) { button.hidden = true; copyButton.hidden = true; indicator.hidden = true; } };
    function report(text, kind) {
      clearTimeout(noticeTimer);
      notice.textContent = text;
      notice.dataset.kind = kind;
      notice.hidden = false;
      if (kind !== "busy") noticeTimer = setTimeout(() => { notice.hidden = true; }, kind === "error" ? 10000 : 5000);
    }
    async function ensureButton() {
      if (button) return;
      if (loading) return loading;
      loading = (async () => {
        const response = await fetch(chrome.runtime.getURL("features/google-images/icons.css"));
        if (!response.ok) throw new Error("Inline image icon styles could not load.");
        const css = await response.text();
        host = document.createElement("div");
        host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;";
        shadow = host.attachShadow({ mode: "closed" });
        const style = document.createElement("style"); style.textContent = css;
        button = document.createElement("button");
        button.className = "enlarge";
        button.type = "button"; button.textContent = "⤢"; button.title = "Enlarge image"; button.hidden = true;
        copyButton = document.createElement("button");
        copyButton.className = "copy";
        copyButton.type = "button"; copyButton.textContent = "⧉"; copyButton.hidden = true;
        copyButton.title = "Copy image at highest available resolution";
        notice = document.createElement("div");
        indicator = document.createElement("span");
        indicator.className = "resolution"; indicator.hidden = true;
        indicator.setAttribute("role", "img");
        notice.className = "notice"; notice.hidden = true;
        notice.setAttribute("role", "status"); notice.setAttribute("aria-live", "polite");
        shadow.append(style, button, copyButton, indicator, notice); document.documentElement.append(host);
        copyButton.addEventListener("click", event => {
          if (!event.isTrusted || !target?.isConnected || !enabled() || app.directCopy.isBusy()) return;
          event.preventDefault(); event.stopPropagation();
          const img = target;
          resolution.clear();
          indicator.hidden = true;
          copyButton.disabled = button.disabled = true;
          copyButton.textContent = "…";
          copyButton.setAttribute("aria-busy", "true");
          // Call immediately from the trusted event, not from an async continuation.
          void app.directCopy.copy(event, img, report).finally(() => {
            copyButton.disabled = button.disabled = false;
            copyButton.textContent = "⧉";
            copyButton.removeAttribute("aria-busy");
          });
        });
        button.addEventListener("click", event => {
          if (!event.isTrusted || !target?.isConnected || !enabled() || app.directCopy.isBusy()) return;
          event.preventDefault(); event.stopPropagation();
          const img = target;
          const url = img.currentSrc || img.src;
          hide();
          void chrome.runtime.sendMessage({ type: "PIZ_AUTHORIZE_ICON", url }).then(result => {
            if (!result?.ok) throw new Error(result?.error || "Could not access image.");
            return app.overlay.open(url, result.token, img);
          }).catch(error => window.alert(`Image Zoom: ${error.message}`));
        });
      })().finally(() => { loading = null; });
      return loading;
    }
    function update() {
      frame = 0;
      if (!point || !enabled() || app.overlay.isActive()) { hide(); return; }
      const hit = document.elementFromPoint(point.x, point.y);
      if (hit === host && target?.isConnected) return;
      const link = hit?.closest?.('a,[role="link"]');
      const img = hit instanceof HTMLImageElement ? hit : link?.querySelector("img");
      if (!img || !img.complete || !img.naturalWidth) { hide(); return; }
      const rect = img.getBoundingClientRect();
      if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) { hide(); return; }
      const x = rect.right - 34, y = rect.top + 6;
      if (rect.width < app.config.minThumbnailWidth || rect.height < app.config.minThumbnailHeight || x - 32 < 0 || x + 28 > innerWidth || y < 0 || y + 28 > innerHeight) { hide(); return; }
      if (!button) { void ensureButton().then(schedule).catch(error => console.warn("Image Zoom:", error.message)); return; }
      button.hidden = copyButton.hidden = indicator.hidden = true;
      const corner = document.elementFromPoint(x + 14, y + 14);
      if (corner !== img && !(link?.contains(img) && link.contains(corner))) { hide(); return; }
      const copyCorner = document.elementFromPoint(x - 18, y + 14);
      if (copyCorner !== img && !(link?.contains(img) && link.contains(copyCorner))) { hide(); return; }
      target = img;
      button.style.left = `${x}px`; button.style.top = `${y}px`;
      copyButton.style.left = `${x - 32}px`; copyButton.style.top = `${y}px`;
      button.setAttribute("aria-label", `Enlarge image${img.alt ? `: ${img.alt.slice(0, 120)}` : ""}`);
      copyButton.setAttribute("aria-label", `Copy image at highest available resolution${img.alt ? `: ${img.alt.slice(0, 120)}` : ""}`);
      button.hidden = copyButton.hidden = false;
      const left = rect.left + 6;
      const leftCorner = document.elementFromPoint(left + 12, y + 12);
      if (left >= 0 && left + 24 <= innerWidth && (leftCorner === img || (link?.contains(img) && link.contains(leftCorner)))) {
        indicator.style.left = `${left}px`; indicator.style.top = `${y}px`;
        indicator.hidden = false;
        if (!app.directCopy.isBusy()) resolution.show(img); else indicator.hidden = true;
      } else resolution.clear();
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    document.addEventListener("pointermove", event => {
      if (event.pointerType === "touch") return;
      point = { x: event.clientX, y: event.clientY }; schedule();
    }, { passive: true, capture: true });
    document.addEventListener("pointerout", event => { if (!event.relatedTarget) { point = null; hide(); } }, { passive: true });
    window.addEventListener("scroll", () => { hide(); schedule(); }, { passive: true, capture: true });
    window.addEventListener("resize", () => { hide(); schedule(); }, { passive: true });
    window.addEventListener("blur", () => { point = null; hide(); });
    window.addEventListener("popstate", hide);
    document.addEventListener("visibilitychange", () => { if (document.hidden) hide(); });
  }
  app.icons = { start };
})();
