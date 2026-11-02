import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function content(files, extras = {}) {
  const context = vm.createContext({ ...extras });
  for (const file of ["shared/google-domains.js", "shared/config.js", ...files]) vm.runInContext(read(file), context, { filename: file });
  return context;
}

test("manifest references existing packaged files and declares required permissions", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  for (const permission of ["activeTab", "contextMenus", "scripting", "clipboardWrite"]) assert.ok(manifest.permissions.includes(permission));
  for (const path of [manifest.background.service_worker, ...manifest.content_scripts.flatMap(s => s.js), ...manifest.web_accessible_resources.flatMap(s => s.resources)]) {
    assert.ok(read(path).length > 0, path);
  }
  assert.ok(!manifest.permissions.includes("clipboardRead"));
});

test("zoom preserves the point under the cursor and clamps scale", () => {
  const { PersonalImageZoom: app } = content(["features/zoom/zoom.js"]);
  const state = { scale: 2, x: 40, y: -20 };
  const point = { x: 100, y: 80 };
  const next = app.zoom.zoomAt(state, 1.5, point);
  assert.equal(next.scale, 3);
  assert.equal((point.x - next.x) / next.scale, (point.x - state.x) / state.scale);
  assert.equal((point.y - next.y) / next.scale, (point.y - state.y) / state.scale);
  assert.equal(app.zoom.zoomAt(state, 1e8, point).scale, 16);
  assert.equal(app.zoom.zoomAt(state, 1e-8, point).scale, .01);
});

test("Google country hosts match the manifest exactly without accepting lookalikes", () => {
  const context = content([]);
  const hosts = context.PersonalImageZoom.config.googleHosts;
  const matches = JSON.parse(read("manifest.json")).content_scripts[0].matches;
  for (const host of ["google.de", "www.google.com", "www.google.co.uk", "images.google.co.jp", "www.google.com.br"]) assert.ok(hosts.includes(host), host);
  for (const host of ["google.com.evil.test", "photos.google.com", "google.fake"]) assert.ok(!hosts.includes(host));
  assert.deepEqual(matches.slice().sort(), Array.from(hosts, host => `https://${host}/*`).sort());
});

test("source resolver ties Google original metadata to the selected thumbnail", () => {
  const { PersonalImageZoom: app } = content(["features/source/resolver.js"]);
  const data = '[["https://thumb.test/a",120,160],["https://image.test/original\\u003fsize\\u003dlarge",2000,3000]],[["https://thumb.test/other",120,160],["https://image.test/wrong",9000,9000]]';
  assert.deepEqual(Array.from(app.source.googleOriginals(data, ["https://thumb.test/a"])), ["https://image.test/original?size=large"]);
  assert.deepEqual(Array.from(app.source.srcset("small.png 320w, large.png 2400w, retina.png 2x")), ["small.png", "large.png", "retina.png"]);
});

test("GIF clipboard output is used only when the browser supports it", async () => {
  for (const supported of [false, true]) {
    let handler;
    const writes = [];
    const { PersonalImageZoom: app } = content(["features/clipboard/clipboard.js"], {
      window: { isSecureContext: true }, document: { hasFocus: () => true },
      navigator: { clipboard: { write(items) { writes.push(items); return Promise.resolve(); } } },
      ClipboardItem: class { static supports(type) { return supported && type === "image/gif"; } constructor(data) { this.data = data; } }
    });
    app.clipboard.bind({ root: { addEventListener() {} }, button: { addEventListener(type, fn) { handler = fn; } }, getPng: () => "png", getGif: () => "gif", isActive: () => true, status() {}, signal: {} });
    handler({ isTrusted: true });
    assert.deepEqual(Object.keys(writes[0][0].data).sort(), supported ? ["image/gif", "image/png"] : ["image/png"]);
    await new Promise(resolve => setImmediate(resolve));
  }
});

test("wheel listener is local, non-passive, and handles line deltas", () => {
  const handlers = new Map();
  const stage = {
    clientWidth: 1000, clientHeight: 700, classList: { add() {}, remove() {} },
    addEventListener(type, handler, options) { handlers.set(type, { handler, options }); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 })
  };
  const globalListeners = [];
  const { PersonalImageZoom: app } = content(["features/zoom/zoom.js"], { window: { addEventListener: type => globalListeners.push(type) } });
  const img = { naturalWidth: 800, naturalHeight: 600, style: {}, addEventListener() {} };
  app.zoom.attach(stage, img, () => {}, {});
  let prevented = false;
  const wheel = handlers.get("wheel");
  assert.equal(wheel.options.passive, false);
  wheel.handler({ deltaMode: 1, deltaY: -3, clientX: 500, clientY: 350, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.ok(prevented);
  assert.match(img.style.transform, /scale\(1\./);
  assert.deepEqual(globalListeners, ["resize"]);
});

test("clipboard accepts only trusted, unmodified Y while active and ready", async () => {
  const root = new Map();
  const button = new Map();
  const writes = [];
  let active = true;
  let png = { type: "image/png" };
  class HTMLElement {}
  const context = content(["features/clipboard/clipboard.js"], {
    HTMLElement,
    window: { isSecureContext: true },
    document: { hasFocus: () => true },
    navigator: { clipboard: { write(items) { writes.push(items); return Promise.resolve(); } } },
    ClipboardItem: class { constructor(data) { this.data = data; } }
  });
  context.PersonalImageZoom.clipboard.bind({
    root: { addEventListener: (key, value) => root.set(key, value) },
    button: { addEventListener: (key, value) => button.set(key, value) },
    getPng: () => png, isActive: () => active, status() {}, signal: {}
  });
  const event = { key: "y", isTrusted: true, composedPath: () => [], preventDefault() {}, stopPropagation() {} };
  const press = overrides => root.get("keydown")({ ...event, ...overrides });
  active = false; press({});
  active = true; press({ isTrusted: false }); press({ ctrlKey: true }); press({ altKey: true }); press({ metaKey: true }); press({ repeat: true }); press({ isComposing: true }); press({ key: "x" });
  const input = new HTMLElement(); input.tagName = "INPUT";
  press({ composedPath: () => [input] });
  png = null; press({});
  assert.equal(writes.length, 0);
  png = { type: "image/png" }; press({});
  assert.equal(writes.length, 1, "write happens synchronously inside the key handler");
  press({}); assert.equal(writes.length, 1, "busy state prevents duplicate writes");
  await new Promise(resolve => setImmediate(resolve));
  press({ key: "Y" }); assert.equal(writes.length, 2);
});

test("background grants reject wrong documents and cannot fetch arbitrary URLs", async () => {
  let listener;
  let calls = 0;
  globalThis.crypto ??= webcrypto;
  globalThis.chrome = {
    runtime: { id: "test-extension", onMessage: { addListener(fn) { listener = fn; } } },
    tabs: { onRemoved: { addListener() {} } },
    scripting: { executeScript: async () => [{ result: false }] }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://images.example.test/selected.png");
    assert.equal(options.redirect, "error");
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
  };
  try {
    const broker = await import("../background/image-broker.js");
    broker.registerImageBroker();
    const token = broker.createGrant("https://images.example.test/selected.png", 7, 0, "document-a");
    const sender = { id: "test-extension", tab: { id: 7 }, frameId: 0, documentId: "document-a" };
    const request = (message, who = sender) => new Promise(resolve => listener(message, who, resolve));
    assert.equal((await request({ type: "PIZ_READ_IMAGE", token }, { ...sender, documentId: "document-b" })).ok, false);
    assert.equal(calls, 0);
    assert.equal((await request({ type: "PIZ_UPGRADE_IMAGE", token, url: "https://other.example.test/unrelated" })).ok, false);
    const result = await request({ type: "PIZ_READ_IMAGE", token, url: "https://other.example.test/secret" });
    assert.equal(result.ok, true);
    assert.equal(result.dataUrl, "data:image/png;base64,AQID");
    assert.equal((await request({ type: "PIZ_READ_IMAGE", token })).ok, false);
    assert.equal(calls, 1);
    assert.throws(() => broker.createGrant("javascript:alert(1)", 7, 0, "document-a"), /Unsupported/);
  } finally { globalThis.fetch = originalFetch; delete globalThis.chrome; }
});

test("direct copy starts its clipboard write inside the click and awaits highest-resolution bytes", async () => {
  let writes = 0;
  const messages = [];
  const reports = [];
  let resolvePrepared;
  const prepared = new Promise(resolve => { resolvePrepared = resolve; });
  const context = content(["features/clipboard/direct-copy.js"], {
    AbortController,
    window: { isSecureContext: true, addEventListener() {} },
    document: { hasFocus: () => true },
    chrome: { runtime: { async sendMessage(message) { messages.push(message); return { ok: true, token: message.type === "PIZ_AUTHORIZE_ICON" ? "base-token" : "original-token" }; } } },
    ClipboardItem: class { constructor(data) { this.data = data; } },
    navigator: { clipboard: { async write(items) { writes++; assert.equal(await items[0].data["image/png"], "transparent-original-png"); } } }
  });
  const app = context.PersonalImageZoom;
  app.source = { async best() { return { url: "https://image.test/original.png" }; } };
  app.clipboard = { async prepare(url, token) { assert.equal(url, "https://image.test/original.png"); assert.equal(token, "original-token"); return prepared; } };
  const img = { isConnected: true, currentSrc: "https://image.test/thumb.png" };
  assert.equal(await app.directCopy.copy({ isTrusted: false }, img), false);
  assert.equal(writes, 0);
  assert.equal(messages.length, 0);
  const result = app.directCopy.copy({ isTrusted: true }, img, (text, kind) => reports.push(kind));
  assert.equal(writes, 1, "write starts synchronously before async authorization");
  assert.equal(messages.length, 0);
  assert.equal(app.directCopy.isBusy(), true);
  assert.equal(await app.directCopy.copy({ isTrusted: true }, img), false);
  resolvePrepared({ png: "transparent-original-png", gif: null });
  assert.equal(await result, true);
  assert.equal(app.directCopy.isBusy(), false);
  assert.deepEqual(messages.map(message => message.type), ["PIZ_AUTHORIZE_ICON", "PIZ_UPGRADE_IMAGE"]);
  assert.equal(reports.at(-1), "success");
});

test("direct copy reports an authorization failure without claiming a successful copy", async () => {
  const reports = [];
  const context = content(["features/clipboard/direct-copy.js"], {
    AbortController,
    window: { isSecureContext: true, addEventListener() {} }, document: { hasFocus: () => true },
    chrome: { runtime: { async sendMessage() { return { ok: false, error: "Image disappeared" }; } } },
    ClipboardItem: class { constructor(data) { this.data = data; } },
    navigator: { clipboard: { async write(items) { await items[0].data["image/png"]; } } }
  });
  assert.equal(await context.PersonalImageZoom.directCopy.copy({ isTrusted: true }, { isConnected: true, src: "https://image.test/a.png" }, (text, kind) => reports.push({ text, kind })), false);
  assert.equal(reports.at(-1).kind, "error");
  assert.match(reports.at(-1).text, /Image disappeared/);
  assert.equal(context.PersonalImageZoom.directCopy.isBusy(), false);
});

test("resolution traffic light uses longest-edge thresholds and never calls incomplete data low resolution", () => {
  const { PersonalImageZoom: app } = content(["features/resolution/indicator.js"]);
  const grade = (width, height, extra = {}) => app.resolution.classify({ width, height, alternatives: true, complete: true, ...extra });
  assert.equal(grade(999, 600).color, "low");
  assert.equal(grade(600, 1000).color, "medium");
  assert.equal(grade(1999, 1200).color, "medium");
  assert.equal(grade(1200, 2000).color, "high");
  assert.equal(grade(300, 200, { complete: false }).color, "unknown");
  assert.equal(grade(300, 200, { alternatives: false }).color, "unknown");
  assert.match(grade(2400, 1600).title, /2400 × 1600 px/);
});

test("source measurements include real dimensions, reuse cache, and invalidate for changed candidates", async () => {
  let loads = 0;
  const sizes = { "https://fixture.test/thumb.png": [300, 200], "https://fixture.test/full.png": [2400, 1600], "https://fixture.test/next.png": [800, 600] };
  class Image {
    set src(url) { loads++; const size = sizes[url]; queueMicrotask(() => { if (size) { [this.naturalWidth, this.naturalHeight] = size; this.onload?.(); } else this.onerror?.(); }); }
    removeAttribute() {}
  }
  let original = "https://fixture.test/full.png";
  const img = { src: "https://fixture.test/thumb.png", currentSrc: "https://fixture.test/thumb.png", naturalWidth: 300, naturalHeight: 200, parentElement: null, srcset: "", getAttribute: name => name === "data-full" ? original : null, querySelectorAll: () => [] };
  const { PersonalImageZoom: app } = content(["features/source/resolver.js"], { Image, URL, AbortSignal, document: { baseURI: "https://fixture.test/", scripts: [] }, location: { hostname: "fixture.test" } });
  const signal = new AbortController().signal;
  const first = await app.source.best(img, img.src, signal);
  assert.equal(first.width, 2400); assert.equal(first.height, 1600); assert.equal(first.complete, true);
  await app.source.best(img, img.src, signal);
  assert.equal(loads, 2, "cached measurement does not reload images");
  original = "https://fixture.test/next.png";
  assert.equal((await app.source.best(img, img.src, signal)).width, 800);
  assert.equal(loads, 4);
  original = "https://fixture.test/broken.png";
  assert.equal((await app.source.best(img, img.src, signal)).complete, false);
  await app.source.best(img, img.src, signal);
  assert.equal(loads, 8, "incomplete measurements are not cached");
});

test("resolution hover cancels stale work and does not recheck on every pointer movement", async () => {
  const renders = [], requests = [];
  const { PersonalImageZoom: app } = content(["features/resolution/indicator.js"], { AbortController, setTimeout, clearTimeout });
  app.config = { ...app.config, resolutionHoverDelayMs: 0 };
  app.source = { best(img, url, signal) { return new Promise(resolve => requests.push({ img, signal, resolve })); } };
  const control = app.resolution.create(value => renders.push(value));
  const a = { src: "a", isConnected: true }, b = { src: "b", isConnected: true };
  control.show(a); control.show(a);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(requests.length, 1);
  control.show(b);
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve({ complete: true, alternatives: true, width: 5000, height: 3000 });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(renders.at(-1).color, "loading", "stale result cannot color a new thumbnail");
  requests[1].resolve({ complete: true, alternatives: true, width: 800, height: 600 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(renders.at(-1).color, "low");
  control.clear();
});

test("visible precheck queue caps concurrency, deduplicates, prioritizes hover, and skips offscreen jobs", async () => {
  const { PersonalImageZoom: app } = content(["features/resolution/precheck.js"], { AbortController });
  const requests = [];
  let active = 0, maxActive = 0;
  const queue = app.precheck.createQueue(img => img.visible, (img, signal) => {
    active++; maxActive = Math.max(maxActive, active);
    return new Promise(resolve => requests.push({ img, signal, finish() { active--; resolve({ complete: true, alternatives: true, width: 2400, height: 1600 }); } }));
  });
  const images = Array.from({ length: 5 }, (_, i) => ({ src: `image-${i}`, visible: true }));
  const first = queue.add(images[0]);
  queue.add(images[1]); queue.add(images[2]); queue.add(images[3]); queue.add(images[4]);
  assert.equal(queue.add(images[0]), first);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  queue.add(images[4], true);
  images[2].visible = false;
  requests[0].finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[2].img, images[4], "hover takes precedence over background queue");
  requests[1].finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[3].img, images[3], "offscreen waiting image is skipped");
  requests[2].finish(); requests[3].finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(maxActive, 2);
  assert.equal(queue.add(images[0]), first, "completed precheck is reused");
  assert.equal(queue.lookup(images[0]).result.width, 2400);
});

test("indicator renders prechecked result synchronously without a new resolver request", () => {
  const { PersonalImageZoom: app } = content(["features/resolution/indicator.js"], { AbortController, setTimeout, clearTimeout });
  app.precheck = { lookup: () => ({ done: true, result: { complete: true, alternatives: true, width: 2400, height: 1600 } }) };
  app.source = { best() { assert.fail("should reuse visible precheck"); } };
  const states = [];
  const control = app.resolution.create(state => states.push(state));
  control.show({ src: "thumbnail", isConnected: true });
  assert.equal(states.length, 1);
  assert.equal(states[0].color, "high");
  control.clear();
});
