(() => {
  const app = globalThis.PersonalImageZoom;
  if (app.clipboard) return;

  async function prepare(url, token, signal) {
    let source = url;
    if (/^https?:/.test(url)) {
      const response = await chrome.runtime.sendMessage({ type: "PIZ_READ_IMAGE", token });
      if (!response?.ok) throw new Error(response?.error || "Image data could not be read.");
      source = response.dataUrl;
    } else if (!/^(data:image\/|blob:)/i.test(url)) {
      throw new Error("Unsupported image source.");
    }
    signal.throwIfAborted();
    const response = await fetch(source, { signal });
    const blob = await response.blob();
    if (blob.size > app.config.maxBytes) throw new Error("Image exceeds the 16 MiB copy limit.");
    if (!/^image\/(png|jpeg|webp|gif|avif|bmp|x-icon|vnd\.microsoft\.icon)$/i.test(blob.type)) {
      throw new Error("Only raster images can be copied. SVG is view-only.");
    }
    const bitmap = await createImageBitmap(blob);
    try {
      signal.throwIfAborted();
      if (bitmap.width * bitmap.height > app.config.maxPixels || Math.max(bitmap.width, bitmap.height) > app.config.maxDimension) {
        throw new Error("Image exceeds the 32 megapixel / 16,384 pixel copy limit.");
      }
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create an image canvas.");
      context.drawImage(bitmap, 0, 0);
      const png = await new Promise((resolve, reject) => canvas.toBlob(
        value => value ? resolve(value) : reject(new Error("PNG conversion failed.")), "image/png"
      ));
      canvas.width = canvas.height = 0;
      signal.throwIfAborted();
      if (png.size > 32 * 1024 * 1024) throw new Error("Converted PNG exceeds the 32 MiB copy limit.");
      return { png, gif: blob.type.toLowerCase() === "image/gif" ? blob : null };
    } finally { bitmap.close(); }
  }

  function bind({ root, button, getPng, getGif = () => null, isActive, status, signal }) {
    let busy = false;
    function copy(event) {
      if (!event.isTrusted || !isActive() || busy) return;
      if (!window.isSecureContext || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        status("Image copy requires an HTTPS page and clipboard support in Chrome.");
        return;
      }
      if (!document.hasFocus()) { status("Focus the image viewer and press Y again."); return; }
      const png = getPng();
      if (!png) { status("Image data is not ready. Wait for “Ready” or check the error shown below."); return; }
      busy = true;
      status("Copying…");
      // No await before write: this call is directly inside a trusted click/keydown.
      try {
        const gif = getGif();
        const useGif = Boolean(gif && ClipboardItem.supports?.("image/gif"));
        const data = useGif ? { "image/gif": gif, "image/png": png } : { "image/png": png };
        navigator.clipboard.write([new ClipboardItem(data)]).then(
          () => { if (isActive()) status(useGif ? "Copied GIF and PNG image data." : gif ? "Copied PNG frame with transparency (GIF clipboard format unsupported)." : "Copied PNG image with transparency to clipboard."); },
          error => { if (isActive()) status(`Copy failed: ${error.message}`); }
        ).finally(() => { busy = false; });
      } catch (error) { busy = false; status(`Copy failed: ${error.message}`); }
    }
    button.addEventListener("click", copy, { signal });
    root.addEventListener("keydown", event => {
      if (!isActive() || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== "y") return;
      if (event.composedPath().some(node => node instanceof HTMLElement && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)))) return;
      event.preventDefault();
      event.stopPropagation();
      copy(event);
    }, { capture: true, signal });
  }
  app.clipboard = { prepare, bind };
})();
