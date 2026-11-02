(() => {
  if (globalThis.PersonalImageZoom) return;
  globalThis.PersonalImageZoom = {
    config: Object.freeze({
      googleImagesIcons: true,
      googleHosts: (globalThis.PIZGoogleDomains || ["google.com", "google.de"]).flatMap(domain => [domain, `www.${domain}`, `images.${domain}`]),
      minThumbnailWidth: 160,
      minThumbnailHeight: 100,
      sourceTimeoutMs: 8000,
      resolutionHoverDelayMs: 0,
      resolutionPrecheckConcurrency: 2,
      resolutionMediumEdge: 1000,
      resolutionHighEdge: 2000,
      resolutionCacheMs: 5 * 60 * 1000,
      resolutionCacheEntries: 100,
      minZoom: 0.01,
      maxZoom: 16,
      wheelSensitivity: 0.0018,
      maxBytes: 16 * 1024 * 1024,
      maxPixels: 32 * 1024 * 1024,
      maxDimension: 16384
    })
  };
})();
