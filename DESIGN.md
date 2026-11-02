# Design and implementation plan

## Objective and defaults

One personal extension, independently editable features, with Google Images as the primary workflow. Confirmed preferences: all published Google search country domains, largest accessible source resolution, dark current-tab modal, PNG with alpha transparency, GIF when supported. One hover-only pair of enlarge/copy controls for thumbnails at least 160 × 100 CSS pixels. Fit-to-window initial size without upscaling, cursor-anchored 1–1600% zoom, drag panning, Y to copy, Escape to close.

Native context-menu placement is controlled by Chrome. There is no supported API to satisfy top-of-menu placement. One direct entry and a thumbnail button are the compliant implementation. No custom replacement menu is installed.

## Module contracts and communication

1. `context-menu/menu.js` receives Chrome's trusted `onClicked` event and `srcUrl`. It injects the ordered content modules into the clicked frame. The returned document ID prevents delivery to a different document after navigation. The broker creates a one-use token bound to that exact URL, tab, frame, and document. The menu sends `PIZ_OPEN {url, token}` to that document.
2. `content/bootstrap.js` receives `PIZ_OPEN`, calls `overlay.open(url, token)`, and acknowledges success or an initialization error. Repeated injection adds no duplicate listeners.
3. Google thumbnail buttons use the DOM image's `currentSrc || src`. A trusted button click sends `PIZ_AUTHORIZE_ICON {url}`. The worker checks the sender, allowed Google page, and presence of that exact image source through an isolated-world script. It returns a token. The icon module calls the same `overlay.open` API.
4. The overlay fetches only its packaged HTML/CSS, creates a closed Shadow DOM, and opens a native modal dialog. It delegates transforms to `zoom.attach` and copy readiness/keyboard handling to the clipboard module.
5. The source resolver collects linked originals, responsive variants and recognized Google metadata associated with the exact thumbnail, then measures image candidates only after opening. The largest loaded pixel area wins. If the URL changes, `PIZ_UPGRADE_IMAGE {token, url}` requires an existing document-bound grant and independently revalidates the candidate association in the isolated world. It returns a new exact-URL grant. The preview and copy use the same selected source.
6. The clipboard module requests HTTP(S) bytes through `PIZ_READ_IMAGE {token}`. The worker resolves the URL exclusively from the grant, validates ownership/expiry, consumes the token, bounds the download, and returns base64 because Chrome messages use JSON serialization. Data/blob sources stay in the page context. PNG conversion uses an unfilled canvas, preserving alpha. Original GIF bytes are retained alongside PNG; a trusted Y/Copy event selects GIF only when the browser reports native GIF clipboard support, otherwise PNG. The write call remains synchronous within the trusted event. There is no background clipboard writer.
7. Closing aborts content-side work/listeners, discards the prepared PNG, closes the dialog, removes its DOM, and restores prior focus. In-flight worker fetches have their own 15-second deadline. Grant tokens expire after two minutes; worker suspension discards unused tokens, and reopening recovers.

Internal feature calls use the isolated-world namespace; only the worker boundary uses Chrome messages. There is no `window.postMessage` bridge or page-supplied executable code.

`resolution/precheck.js` discovers existing images at startup and watches viewport intersections, new images and source changes. Eligible visible images are queued automatically, two at a time. Pending work is canceled for hidden tabs, removed images and images leaving the viewport; completed results remain reusable. Hover prioritizes its pending job and joins the same promise. `resolution/indicator.js` renders a completed precheck synchronously, otherwise waits for that shared job with no hover delay. Leaving a hover invalidates its UI listener without canceling useful visible-image prechecks. Late results cannot color another thumbnail. Red/yellow/green require complete measurements with an alternative to the thumbnail; uncertain results remain gray. Thresholds are unchanged: longer edge below 1,000 px, below 2,000 px, or at least 2,000 px. L/M/H and exact-dimension tooltips supplement color.

Successful resolver measurements are shared across precheck/open/copy through a bounded in-memory cache: five minutes, 100 source sets, keys under 64 KiB. Per-element precheck records use a WeakMap, retaining complete results for five minutes and uncertain results for 30 seconds. Source changes, route changes and new script metadata invalidate affected records. No image bytes are held by these caches. Google metadata parsing is indexed per unchanged script to avoid parsing all tuples again for each visible image. Each image retains three-probe concurrency, an eight-second deadline and candidate/metadata bounds; two prechecks mean at most six simultaneous background image probes. There is no polling interval.

The thumbnail's **direct Copy button** calls the independent `clipboard/direct-copy.js` module. That module invokes `navigator.clipboard.write` immediately inside the trusted click, with a promise-backed `image/png` ClipboardItem. The promise performs the same initial authorization, best-source selection, candidate upgrade authorization, and alpha-preserving PNG preparation used by the viewer. No modal opens and no global keyboard shortcut is added. Only one direct copy runs at a time; navigation aborts its pending content work. The hover UI disables both controls during copying and displays progress/success/error feedback, with a one-shot timeout to dismiss completed feedback. The direct path uses PNG for predictable interoperability, including a single-frame fallback for GIFs.

## Feature implementation sequence

| Phase | Deliverable | Acceptance condition |
| --- | --- | --- |
| 1. Scaffold | MV3 manifest, shared defaults, ordered bootstrap | Unpacked extension loads; reinjection is idempotent |
| 2. Entry points | Image-only native menu, frame targeting, Google icons | A selected image opens in the same tab; source links are not followed |
| 3. Viewer | HTML/CSS, native modal, shadow isolation, focus lifecycle | Escape/Close work; page dimensions and scroll position are preserved |
| 4. Zoom | Local wheel handler, bounded cursor-anchored scale, pointer panning, Fit | Wheel over viewer changes image scale; normal page wheel scrolling returns on close |
| 5. Image data | One-use grants, bounded original-host retrieval, local PNG conversion | Cross-origin raster bytes can be prepared; errors remain visible |
| 6. Clipboard | Trusted active-viewer Y and Copy button | Real PNG pastes into an image-capable application; inactive Y never copies |
| 7. Validation | Automated logic/security tests and browser checklist | Tests pass; manual Google Images/OS clipboard cases are verified |
| 8. Personalization | Quiz answers applied to isolated modules | Agreed shortcuts, domains, resolution and layout defaults documented |

## UI and lifecycle details

The modal has a label, visible close button, zoom percentage, Fit button, copy button, live status, and persistent error text. Native dialog supplies focus containment and background inertness. The image is centered around a zero-sized anchor; pixel translations and scale are applied to the image, so the zoomed point remains under the cursor. Resize resets to fit. Wheel delta modes are normalized for wheel mice and trackpads. This is image zoom, not browser-page zoom.

The Google hover module uses delegated pointer events and a single lazily created pair of enlarge/copy buttons in a fixed shadow layer. It never scans all page images and uses no image observers or polling timers. Each animation-frame-coalesced pointer update checks the image under the pointer and its size; scroll/resize revalidate the target. Moving onto the button preserves the hovered target, while leaving the image hides it. Newly inserted images work without registration. Icons are restricted to Google Images across the bundled 187-country-domain list; ordinary websites keep context-menu access only. The adapter remains a heuristic requiring real-page maintenance as Google changes its UI.

Source probing is limited to 32 candidates, three concurrent image loads, an eight-second deadline, and an 8 MiB script-metadata scan budget. Parsing Google tuples uses JSON string decoding and never evaluates scripts. Only tuples containing the selected thumbnail URL are accepted. No request is made to publisher pages or external APIs. These bounds keep a broken or huge page from creating unbounded work; an unavailable original cannot be guaranteed. Resolution is measured, not invented by scaling. The native `<img>` keeps GIF playback in the viewer; canvas conversion applies only to clipboard preparation.

## Permission and policy choices

No clipboard read permission, remote executable code, network API, analytics, upload, cookie-reading API, or browsing-history collection. Host permissions are broad because an arbitrary selected image may live on an arbitrary CDN; this is disclosed in the README. Credentialed GETs are limited to the selected image and ordinary browser cookie policy still applies. Redirects are refused rather than silently expanding the authorization. Google icons are limited by a host allowlist, matching manifest entries, and DOM validation.

`clipboardWrite` is an explicit extension permission; the implementation further requires a trusted user event and focused document. Y requires the active viewer; direct Copy requires a click on the hovered thumbnail's button. Programmatic page clicks cannot trigger copy. Every clipboard write starts within its initiating gesture, including promise-backed direct copying. No global shortcut is registered. HTTPS and iframe policy limitations are surfaced rather than bypassed. Public store publication would additionally require accurate listing/privacy disclosures and actual review; none is claimed here.

## Extension points

- Change zoom speed/limits in `shared/config.js`; transform behavior is isolated in `features/zoom/zoom.js`.
- Change layout in overlay HTML/CSS and lifecycle in `overlay.js` without changing image retrieval.
- Change copy format/shortcut in the clipboard module. Original GIF clipboard support is feature-detected; PNG fallback preserves transparency but not animation.
- Add site adapters beside `google-images`; keep selection tied to explicit user actions and exact source URLs.
- Extend `features/source/resolver.js` for new site-specific original-image metadata, keeping candidate authorization and `currentSrc` fallback.
- A narrower permission edition can use explicit CDN allowlists or a separate optional-host-permission setup screen. This needs a user choice before promising arbitrary-site image copy.
