import "../shared/google-domains.js";
const grants = new Map();
const MAX_BYTES = 16 * 1024 * 1024;
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/bmp", "image/x-icon", "image/vnd.microsoft.icon"]);
const ICON_HOSTS = new Set(globalThis.PIZGoogleDomains.flatMap(domain => [domain, `www.${domain}`, `images.${domain}`]));

export function createGrant(url, tabId, frameId, documentId) {
  const parsed = new URL(url);
  if (!["https:", "http:", "data:", "blob:"].includes(parsed.protocol)) throw new Error("Unsupported image URL.");
  if (parsed.username || parsed.password) throw new Error("Image URLs containing credentials are unsupported.");
  for (const [key, value] of grants) {
    if (value.expires < Date.now() || (value.tabId === tabId && value.frameId === frameId)) grants.delete(key);
  }
  const token = crypto.randomUUID();
  grants.set(token, { url, tabId, frameId, documentId, expires: Date.now() + 120000 });
  return token;
}

export function registerImageBroker() {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!["PIZ_AUTHORIZE_ICON", "PIZ_UPGRADE_IMAGE", "PIZ_READ_IMAGE"].includes(message?.type)) return;
    if (sender.id !== chrome.runtime.id || !sender.tab?.id || !sender.documentId) {
      respond({ ok: false, error: "Invalid image request." });
      return;
    }
    const task = message.type === "PIZ_AUTHORIZE_ICON"
      ? authorizeIcon(message, sender)
      : message.type === "PIZ_UPGRADE_IMAGE" ? upgradeImage(message, sender) : readImage(message.token, sender);
    task.then(value => respond({ ok: true, ...value }), error => respond({ ok: false, error: error.message }));
    return true;
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    for (const [token, grant] of grants) if (grant.tabId === tabId) grants.delete(token);
  });
}

async function authorizeIcon(message, sender) {
  const page = new URL(sender.url);
  const isImages = page.hostname.startsWith("images.") || page.searchParams.get("tbm") === "isch" || page.searchParams.get("udm") === "2";
  if (page.protocol !== "https:" || !ICON_HOSTS.has(page.hostname) || !isImages) {
    throw new Error("Inline icons are enabled only on supported Google image pages.");
  }
  if (typeof message.url !== "string" || message.url.length > 24 * 1024 * 1024) throw new Error("Invalid image URL.");
  // Validate in our isolated content-script world. Never expose a general URL-fetch bridge to the page.
  const results = await chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
    func: url => Array.from(document.images).some(img => (img.currentSrc || img.src) === url),
    args: [message.url]
  });
  if (!results[0]?.result) throw new Error("This image has changed. Click its icon again.");
  return { token: createGrant(message.url, sender.tab.id, sender.frameId, sender.documentId) };
}

function validGrant(token, sender) {
  const grant = grants.get(token);
  if (!grant || grant.expires < Date.now() || grant.tabId !== sender.tab.id || grant.frameId !== sender.frameId || grant.documentId !== sender.documentId) {
    throw new Error("Image access expired. Close and reopen the image.");
  }
  return grant;
}

async function upgradeImage(message, sender) {
  const grant = validGrant(message.token, sender);
  if (typeof message.url !== "string" || message.url.length > 24 * 1024 * 1024) throw new Error("Invalid image URL.");
  const results = await chrome.scripting.executeScript({
    target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
    func: (base, candidate) => {
      const source = globalThis.PersonalImageZoom?.source;
      return Boolean(source && source.candidates(source.find(base), base).includes(candidate));
    },
    args: [grant.url, message.url]
  });
  if (!results[0]?.result) throw new Error("The larger image is no longer associated with this thumbnail.");
  validGrant(message.token, sender);
  return { token: createGrant(message.url, sender.tab.id, sender.frameId, sender.documentId) };
}

async function readImage(token, sender) {
  const grant = validGrant(token, sender);
  grants.delete(token); // A one-use capability, bound to the exact selected image and document.
  if (!/^https?:/.test(grant.url)) throw new Error("Local image data must be read in its page.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(grant.url, {
      signal: controller.signal,
      credentials: "include",
      // Reject redirects rather than allowing an authorized URL to fetch an unrelated destination.
      redirect: "error",
      referrerPolicy: "no-referrer"
    });
    if (!response.ok) throw new Error(`Image server returned HTTP ${response.status}.`);
    const mime = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!MIME_TYPES.has(mime)) throw new Error("This server did not return a supported raster image.");
    if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Image exceeds the 16 MiB copy limit.");
    if (!response.body) throw new Error("Image response was empty.");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Image exceeds the 16 MiB copy limit.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    // Chrome runtime messages use JSON, not structured-cloned Blob objects.
    return { dataUrl: `data:${mime};base64,${btoa(binary)}` };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Image download timed out. Close and reopen to retry.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
