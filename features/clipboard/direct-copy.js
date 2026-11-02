(() => {
  const app = globalThis.PersonalImageZoom;
  if (app.directCopy) return;
  let busy = false;

  function copy(event, img, report = () => {}) {
    if (!event.isTrusted || busy || !img?.isConnected) return Promise.resolve(false);
    if (!window.isSecureContext || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      report("Image copy requires an HTTPS page and clipboard support in Chrome.", "error");
      return Promise.resolve(false);
    }
    if (!document.hasFocus()) {
      report("Focus this page and click Copy again.", "error");
      return Promise.resolve(false);
    }
    busy = true;
    const controller = new AbortController();
    const { signal } = controller;
    window.addEventListener("pagehide", () => controller.abort(), { once: true, signal });
    const sourceUrl = img.currentSrc || img.src;
    let animated = false;
    report("Finding the highest available resolution…", "busy");

    // A promise-backed ClipboardItem starts the write inside this trusted click.
    // Image selection/download can finish later without losing the initiating gesture.
    const png = Promise.resolve().then(async () => {
      signal.throwIfAborted();
      const access = await chrome.runtime.sendMessage({ type: "PIZ_AUTHORIZE_ICON", url: sourceUrl });
      if (!access?.ok) throw new Error(access?.error || "Could not access this image.");
      signal.throwIfAborted();
      const best = await app.source.best(img, sourceUrl, signal);
      let token = access.token;
      if (best.url !== sourceUrl) {
        const upgraded = await chrome.runtime.sendMessage({ type: "PIZ_UPGRADE_IMAGE", token, url: best.url });
        if (!upgraded?.ok) throw new Error(upgraded?.error || "Could not access the larger image. Try again.");
        token = upgraded.token;
      }
      signal.throwIfAborted();
      report("Copying the best available image…", "busy");
      const data = await app.clipboard.prepare(best.url, token, signal);
      signal.throwIfAborted();
      animated = Boolean(data.gif);
      return data.png;
    });
    // Also handle rejection if write() throws before consuming the promised blob.
    void png.catch(() => {});
    let write;
    try {
      write = navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    } catch (error) { write = Promise.reject(error); }
    return Promise.resolve(write).then(() => {
      report(animated ? "Copied best available GIF frame as PNG with transparency." : "Copied best available image as PNG with transparency.", "success");
      return true;
    }).catch(error => {
      if (!signal.aborted) report(`Copy failed: ${error.message}`, "error");
      return false;
    }).finally(() => {
      busy = false;
      controller.abort();
    });
  }
  app.directCopy = { copy, isBusy: () => busy };
})();
