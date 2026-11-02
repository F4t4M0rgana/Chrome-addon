# Personal Image Zoom

A modular Manifest V3 Chrome extension for opening an enlarged image over the current page, zooming with the wheel, and copying its pixels with **Y**. No build step, remote code, analytics, external API, or processing service.

## Important platform boundary

**Chrome does not let an extension choose the position of its entry among the browser's native context-menu items.** This extension creates one direct `Enlarge image` entry, without an extension submenu. It cannot promise a position near the top. The execution-checklist item “Context-menu entry added at the top of the menu” is therefore **not achievable through Chrome's supported API**. The direct thumbnail icon is the fast alternative. The extension does not replace or suppress Chrome's native menu.

“In-place” means a modal overlay in the current tab, with no new tab and no modification of the source image's dimensions in the page layout.

## Load in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
4. Refresh existing Google Images tabs so automatic icons are installed.
5. Right-click an image and select **Enlarge image**, or hover a Google Images thumbnail at least **160 × 100 CSS pixels** and click the **⤢** icon that appears at its top-right corner.
6. Move the wheel over the viewer to zoom; drag to pan. **Fit** resets the view. Once the footer says **Ready**, press **Y** or click **Copy · Y**. Paste into an application that accepts image data. Close with **Escape** or **Close**.

For **direct copying without opening the viewer**, click **⧉** beside the enlarge icon. The extension finds the largest accessible source and copies its decoded pixels as lossless PNG without resizing, including alpha transparency. A small status message shows progress, success or failure. Animated GIFs copy a PNG frame through this direct button. Both hover buttons are disabled during the operation to prevent duplicate requests.

The **top-left resolution light** appears on the hovered thumbnail. Visible eligible images are checked automatically when the page loads; completed results appear immediately on hover, with no dwell delay. Red/L means the selected variant's longer edge is **under 1,000 px**, yellow/M means **1,000–1,999 px**, and green/H means **2,000 px or more**. The tooltip gives exact width × height and megapixels. Gray/… means checking; gray/? means only the thumbnail is known or some candidates could not be checked. A tiny thumbnail alone is never evidence that the original is low resolution. The light describes the highest found variant, not a guarantee about hidden or inaccessible originals. Thresholds and precheck concurrency are editable in `shared/config.js`.

After editing a module, click the extension's **Reload** button and refresh the webpage. If Chrome denies script injection, the extension toolbar icon shows `!`; hover it for the error. Restricted pages such as `chrome://` and the Chrome Web Store cannot host the viewer.

## Folder layout and responsibilities

```text
manifest.json
shared/
  google-domains.js            Bundled Google country-domain allowlist
  config.js                    Feature switches and zoom/resource limits
background/
  service-worker.js            Registers background features
  image-broker.js              Selected-image authorization and bounded fetch
content/
  bootstrap.js                 Idempotent module wiring and message receiver
features/
  source/resolver.js           Original links, responsive variants, Google metadata
  resolution/indicator.js      Immediate cached result display and traffic-light grading
  resolution/precheck.js       Visible-image discovery and bounded background queue
  context-menu/menu.js         Menu registration and frame-specific opening
  zoom/zoom.js                 Cursor-anchored wheel zoom and pointer panning
  clipboard/clipboard.js       PNG conversion and scoped, trusted Y/click copy
  clipboard/direct-copy.js     Gesture-initiated direct copy of the best source
  overlay/
    overlay.js                 Modal lifecycle, focus, loading/error states
    overlay.html               Packaged accessible viewer markup
    overlay.css                Shadow-DOM viewer styles
  google-images/
    icons.js                   Dynamic Google Images thumbnail icons
    icons.css                  Small top-right button styles
tests/
  extension.test.js            Dependency-free unit/security checks
  browser-check.js             Headless Chrome DOM integration checks
  MANUAL.md                    Real-browser acceptance checklist
package.json                   Optional Node test command; no dependencies
README.md
DESIGN.md                      Architecture, implementation plan, tradeoffs
```

Background files use ES modules. Content files each own one feature and register it on an isolated-world namespace. They run in the order declared in the manifest or context-menu module; they are not concatenated into a monolithic script. Each module guards against reinjection. HTML/CSS are separate packaged assets.

## Permissions

| Permission | Purpose |
| --- | --- |
| `contextMenus` | Image-specific native menu item |
| `activeTab` | User-invoked access after choosing the context-menu action |
| `scripting` | Inject modules into the clicked image's frame; validate inline image selection |
| `clipboardWrite` | Write PNG data from a trusted Y press or Copy click; never read the clipboard |
| HTTP/HTTPS host permissions | Retrieve the selected image from its existing host despite page CORS; support images and frames across websites |

Broad host access is an intentional tradeoff for the “any image” requirement. `activeTab` alone does not grant access to an arbitrary image CDN. Automatic content scripts are limited to Google's published search domains; on other sites they are injected only when the menu is used. There is no all-sites background scraper. For a Google-Images-only version, narrow hosts after identifying the image hosts your image searches use. Such a variant cannot promise arbitrary-site copying.

Image requests run locally in the browser but may download the selected image again from its original server, using ordinary browser-managed credentials where allowed. “No external APIs or services” does not mean network images can be copied without accessing their bytes. No image is uploaded anywhere. Bytes and authorization tokens are held only in memory.

## Behavior and limitations

- Google Images icons are enabled by default. Turn them off in `shared/config.js`.
- Search domains: all **187 country domains** in Google's published `supported_domains` list as of 2026-10-28, including `.com`, `.de`, `.co.uk`, `.co.jp`, and `.com.br`. Each supports its bare, `www`, and `images` hostname. Detection includes `tbm=isch`, `udm=2`, and the `images` subdomain. The list is bundled locally, with no runtime domain service; genuinely new future Google domains require a package update. Other websites retain context-menu support, without automatic hover icons.
- **Only the hovered image gets controls.** One pair of enlarge/copy buttons is lazily created and reused. Images must be loaded and at least **160 × 100 CSS pixels**. Change `minThumbnailWidth` and `minThumbnailHeight` in `shared/config.js`. The hover UI uses delegated pointer events; a separate precheck module discovers images once, tracks viewport intersections and observes DOM additions/source changes. There is no periodic full-page polling. Canvas/CSS-background images are not covered. Google DOM changes can require adapter updates.
- **Prefer the highest accessible resolution.** Automatic visible-image prechecks, opening, and Copy use the same resolver for `srcset`, matching picture sources, explicit original-image links/attributes, and recognized Google thumbnail/original metadata pairs. It measures candidates and chooses the largest pixel area, then uses that same source for copying. The footer shows actual pixel dimensions. Up to 32 candidates, three concurrent probes per image, an eight-second probe deadline per image, and an 8 MiB inline-metadata budget bound work. Google metadata is indexed once per unchanged script and reused across thumbnails. It does not visit publisher pages, execute page scripts, guess URL resizing parameters, or upscale pixels to pretend detail exists. A hidden, unavailable, slow, or blocked original cannot be guaranteed; the best found accessible image remains available.
- **Resolution-check performance:** all visible eligible thumbnails are queued immediately, with at most two images checked concurrently (up to six image probes). Offscreen images wait; newly visible or newly loaded images are added automatically. Hidden tabs and removed/offscreen pending images are canceled. Hover joins its existing job and moves queued work to the front. Complete measurements are reused for five minutes; uncertain results have a short 30-second retention and can be retried on a later event. Source/metadata changes invalidate affected records. The shared resolver cache keeps up to 100 source sets with keys under 64 KiB; the per-element precheck record also retains results without holding image bytes. Downloads may happen before any hover, as requested, but only for visible eligible thumbnails. Buttons and the light remain hover-only.
- **Transparency is preserved** by drawing onto an unfilled transparent canvas and encoding PNG. JPEG/WebP/AVIF are decoded locally. Copying is independent of zoom/pan. SVG remains view-only.
- **GIF previews remain animated** when the selected source is an animated GIF. The original GIF bytes are retained for clipboard use. If `ClipboardItem.supports('image/gif')` is true, Y offers GIF plus PNG; otherwise it copies one PNG frame with transparency and reports the fallback. Current Chrome generally supports PNG rather than native GIF clipboard data; animation cannot be promised when pasting. No original metadata or animation is preserved in the PNG fallback.
- Copy requires a focused secure page (normally HTTPS). On plain HTTP pages the viewer works but the content-script Clipboard API is unavailable. Cross-origin iframe clipboard policy may also block copying. The error is shown; no text/URL substitution occurs.
- Download failures, login/cookie restrictions, hotlink protection, redirects, expired URLs, revoked blob URLs, page CSP, and unsupported formats can prevent display or copying. Redirecting image downloads are deliberately rejected. Viewability does not guarantee readable pixels.
- Image downloads are capped at 16 MiB and 15 seconds. PNG preparation rejects images over 32 megapixels, over 16,384 pixels in either dimension, or PNG output over 32 MiB. These limits reduce resource use; image decoding itself still consumes memory before dimension checks.
- An image in an iframe opens inside that frame's viewport. It does not automatically cover the top-level page. Restricted frames may reject injection.
- Copy requires an explicit trusted action: Y/Copy inside the viewer, or the thumbnail's direct Copy button. Y remains scoped to the active viewer; Ctrl/Alt/Meta+Y, IME input, and typing in inputs are ignored. Uppercase Y is accepted. Viewing/hovering alone never copies. Direct Copy calls `clipboard.write` immediately from the click with a promise-backed PNG item; authorization, source selection and conversion resolve that promise later. No background event initiates a clipboard write.
- Wheel handling is attached only to the viewer's image stage with `passive: false`. No page-wide wheel listener or body overflow change is installed. Closing restores page interaction, focus, and ordinary scrolling. The modal intentionally blocks page interaction while open.

## Verify

With Node installed, run `npm test` (or `node --test tests/*.test.js`). No package install is needed. Run the browser checks in `tests/MANUAL.md` before relying on the extension for daily use. Unit tests cannot certify Google Images behavior or actual OS clipboard integration.

`npm run test:browser` also checks the actual rendered viewer and thumbnail controls in a disposable headless Chrome profile. It defaults to the standard Windows Chrome installation; set `CHROME_PATH` for another installation. Chrome extension APIs and clipboard writes are mocked in this fixture, so it does not modify your real clipboard or verify extension loading. Generated profiles and a viewer screenshot are saved under the ignored `.test-output/` directory.

## References

- [Chrome contextMenus API](https://developer.chrome.com/docs/extensions/reference/api/contextMenus): supported menu properties; no native-menu position control.
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab): gesture-granted access scope.
- [Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests): host permission and background-fetch separation.
- [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting): targeted injection.
- [Async Clipboard API](https://web.dev/articles/async-clipboard): PNG and gesture-driven clipboard writes.
- [Google supported domains](https://www.google.com/supported_domains): bundled country-domain list.
- [Chrome match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns): country domains must be enumerated; `google.*` is not supported.

## Confirmed personal preferences

Google `.com` and `.de` plus other country domains; highest accessible source resolution; existing dark full-window viewer; PNG with alpha transparency; GIF when clipboard support permits, otherwise PNG. Hover icons appear only for sufficiently large thumbnails. The initial minimum size is 160 × 100 CSS pixels and can be changed in the configuration.
