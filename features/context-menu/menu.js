import { createGrant } from "../../background/image-broker.js";

const MENU_ID = "personal-image-zoom";
const FILES = [
  "shared/google-domains.js", "shared/config.js", "features/source/resolver.js", "features/zoom/zoom.js", "features/clipboard/clipboard.js",
  "features/clipboard/direct-copy.js", "features/overlay/overlay.js", "features/resolution/precheck.js", "features/resolution/indicator.js", "features/google-images/icons.js", "content/bootstrap.js"
];

export function registerContextMenu() {
  chrome.runtime.onInstalled.addListener(() => {
    // Chrome controls placement; there is no supported index/position property.
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: MENU_ID,
        title: "Enlarge image",
        contexts: ["image"],
        documentUrlPatterns: ["http://*/*", "https://*/*"]
      });
    });
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !info.srcUrl || !tab?.id) return;
    void openImage(info, tab).catch(async (error) => {
      console.warn("Personal Image Zoom:", error.message);
      await chrome.action.setBadgeText({ tabId: tab.id, text: "!" }).catch(() => {});
      await chrome.action.setTitle({ tabId: tab.id, title: `Cannot enlarge: ${error.message}` }).catch(() => {});
    });
  });
}

async function openImage(info, tab) {
  const frameId = info.frameId ?? 0;
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frameId] }, files: FILES });
  const documentId = results[0]?.documentId;
  if (!documentId) throw new Error("The image's page is no longer available.");
  const token = createGrant(info.srcUrl, tab.id, frameId, documentId);
  const result = await chrome.tabs.sendMessage(tab.id, {
    type: "PIZ_OPEN", url: info.srcUrl, token
  }, { documentId });
  if (!result?.ok) throw new Error(result?.error || "The image viewer could not open.");
  await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
  await chrome.action.setTitle({ tabId: tab.id, title: "Personal Image Zoom — right-click an image" });
}
