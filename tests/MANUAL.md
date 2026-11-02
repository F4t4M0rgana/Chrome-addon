# Browser acceptance checklist

These checks require a real loaded extension and user gesture. Automated tests do not replace them.

- [ ] Load unpacked in Chrome without manifest/service-worker errors.
- [ ] On an HTTPS page, right-click an image: one direct `Enlarge image` entry exists. Chrome controls its position.
- [ ] Open the image without a new tab or source-layout change. Check Fit, cursor-anchored wheel zoom, trackpad zoom, dragging and resize.
- [ ] Close with Escape and Close. Prior focus, scroll position and normal scrolling return. Repeated opening does not duplicate UI.
- [ ] Y outside the viewer, modified Y, typing in a page field and key repeat do not copy.
- [ ] In the ready viewer, Y and Copy paste actual image pixels into an image-capable application, at source dimensions independent of zoom.
- [ ] Hover a Google Images thumbnail at least 160 × 100 CSS pixels: one pair of enlarge/copy buttons appears. Small images and other thumbnails have no controls. Moving onto either button keeps it clickable.
- [ ] Top-left resolution light: gray while checking, then red below 1,000 px, yellow below 2,000 px, green from 2,000 px (longer edge). Tooltip matches the selected original's actual dimensions. Thumbnail-only and partial/failed measurements remain gray. Hovering the light keeps the tooltip available.
- [ ] On page load without moving the mouse, visible eligible images are prechecked, two at a time. Offscreen images wait until scrolled into view; newly loaded visible images are included. Cached results appear immediately on hover without another request. Hover joins/prioritizes unfinished work. Hidden tabs cancel pending checks. Changed source candidates trigger a new check; stale results never color another thumbnail.
- [ ] Click the hover Copy button: no viewer opens; progress and success appear. Paste the largest reachable source with transparency. Repeated clicks during copying do not start additional requests.
- [ ] Test a blocked or expired source using direct Copy: show an error, never false success or a copied URL.
- [ ] Test cross-origin images without CORS headers where the image server permits extension retrieval.
- [ ] Test PNG alpha, JPEG, WebP, AVIF, animated GIF preview, data URLs and blob URLs. The direct Copy button copies GIFs as PNG frames. Paste transparency over a colored background.
- [ ] Test HTTP pages and restricted Chrome pages: display the documented limitations without silent failure.
- [ ] Test 404, redirect, invalid MIME, large-image limits and offline retrieval.
- [ ] Test Google Images `.com`, `.de`, `.co.uk` and `.co.jp`: scroll, load more, navigate between searches and resize. No controls accumulate; newly added images work on hover.
- [ ] Test original `imgurl` links, `srcset` and recognized Google metadata: preview/copy and resolution light agree on the largest reachable variant. Block the original to verify gray indicator and preview fallback. Automatic prechecks and hovering never write to the clipboard.
- [ ] Test clipped images, site dialogs/headers and narrow viewports: controls do not cover unrelated content.
- [ ] Test same-origin and cross-origin iframes: viewer stays within its frame; clipboard-policy failures are explicit.
- [ ] Reload the extension, refresh pages and test again after service-worker suspension.
- [ ] Inspect Network: packaged assets and selected image candidates only; no uploads, telemetry, external processing or remote scripts.
