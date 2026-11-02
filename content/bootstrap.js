(() => {
  const app = globalThis.PersonalImageZoom;
  if (app.initialized) return;
  app.initialized = true;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "PIZ_OPEN") return;
    app.overlay.open(message.url, message.token).then(
      () => respond({ ok: true }), error => respond({ ok: false, error: error.message })
    );
    return true;
  });
  void app.icons.start().catch(error => console.warn("Personal Image Zoom icons:", error.message));
})();
