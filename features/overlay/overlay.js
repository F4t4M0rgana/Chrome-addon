(() => {
  const app = globalThis.PersonalImageZoom;
  if (app.overlay) return;
  let active = null;
  let revision = 0;
  let assets;

  function close() {
    revision++;
    if (!active) return;
    const previous = active;
    active = null;
    previous.controller.abort();
    previous.dialog.close();
    previous.img.removeAttribute("src");
    previous.host.remove();
    if (previous.focus?.isConnected) previous.focus.focus({ preventScroll: true });
  }
  async function open(url, token, sourceImage = app.source?.find(url)) {
    if (!/^(https?:|data:image\/|blob:)/i.test(url)) throw new Error("Unsupported image URL.");
    close();
    const currentRevision = revision;
    if (!assets) assets = Promise.all(["overlay.html", "overlay.css"].map(async file => {
      const response = await fetch(chrome.runtime.getURL(`features/overlay/${file}`));
      if (!response.ok) throw new Error("Viewer files could not load. Reload the extension and page.");
      return response.text();
    })).catch(error => { assets = null; throw error; });
    const [html, css] = await assets;
    if (currentRevision !== revision) return;
    const focus = document.activeElement;
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = css;
    const template = document.createElement("template");
    template.innerHTML = html; // Packaged static HTML only; never interpolate page data here.
    shadow.append(style, template.content.cloneNode(true));
    document.documentElement.append(host);
    const dialog = shadow.querySelector("dialog");
    const img = shadow.querySelector("img");
    const stage = shadow.querySelector(".stage");
    const controller = new AbortController();
    const { signal } = controller;
    const state = { host, dialog, img, controller, focus, png: null, gif: null };
    active = state;
    const isActive = () => active === state && dialog.open;
    const status = text => { if (isActive()) shadow.querySelector(".status").textContent = text; };
    const error = text => { if (isActive()) shadow.querySelector(".error").textContent = text; };
    const zoom = app.zoom.attach(stage, img, value => { shadow.querySelector(".zoom").textContent = value; }, signal);
    shadow.querySelector(".close").addEventListener("click", close, { signal });
    shadow.querySelector(".fit").addEventListener("click", zoom.reset, { signal });
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); }, { signal });
    // Keep the site's ordinary keyboard shortcuts from reacting inside the modal.
    dialog.addEventListener("keydown", event => event.stopPropagation(), { signal });
    window.addEventListener("pagehide", close, { signal });
    app.clipboard.bind({ root: shadow, button: shadow.querySelector(".copy"), getPng: () => state.png, getGif: () => state.gif, isActive, status, signal });
    img.addEventListener("error", () => error("The image cannot be displayed. Its URL may have expired or the site may block reuse."), { signal });
    try { dialog.showModal(); } catch (failure) { close(); throw failure; }
    stage.focus({ preventScroll: true });
    img.src = url;
    status("Finding the highest available resolution…");
    const resolution = shadow.querySelector(".resolution");
    img.addEventListener("load", () => { resolution.textContent = `${img.naturalWidth} × ${img.naturalHeight} pixels`; }, { signal });
    void (async () => {
      const best = app.source ? await app.source.best(sourceImage, url, signal) : { url };
      if (!isActive()) return;
      if (best.url !== url) {
        const access = await chrome.runtime.sendMessage({ type: "PIZ_UPGRADE_IMAGE", token, url: best.url });
        signal.throwIfAborted();
        if (access?.ok) { url = best.url; token = access.token; img.src = url; }
        else error("Larger image access changed; using the available preview.");
      }
      status("Preparing the best available image for copy…");
      return app.clipboard.prepare(url, token, signal);
    })().then(data => {
      if (!isActive()) return;
      state.png = data.png;
      state.gif = data.gif;
      status(data.gif ? "Ready · Animated GIF preview; Y copies GIF where supported, otherwise PNG." : "Ready · Best accessible image · Y copies PNG with transparency.");
    }).catch(failure => {
      if (signal.aborted) return;
      status("Viewing remains available; copy is unavailable.");
      error(failure.message);
    });
  }
  app.overlay = { open, close, isActive: () => Boolean(active) };
})();
