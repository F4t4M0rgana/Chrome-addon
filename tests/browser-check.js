// Dependency-free DOM integration check in a disposable headless Chrome profile.
// Chrome APIs and clipboard writes are mocked; this is not a loaded-extension E2E test.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".test-output");
await fs.mkdir(output, { recursive: true });
const profile = await fs.mkdtemp(path.join(output, "chrome-"));
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><title>Image Zoom test fixture</title><style>body{margin:0;background:#e3ebf5;font:18px system-ui}main{padding:60px;height:2200px}img{width:300px;height:200px}</style><main><h1>Image Zoom browser fixture</h1><button id="before">Page focus target</button><p>Background page retains ordinary scrolling.</p><img id="source" alt="Test image"></main>');
      return;
    }
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
    response.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : "text/javascript");
    response.end(await fs.readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executable = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const chrome = spawn(executable, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let browserErrors = "";
chrome.stderr.on("data", data => { browserErrors = (browserErrors + data.toString()).slice(-4000); });
let launchError;
chrome.on("error", error => { launchError = error; });
let socket;
let serial = 0;
const pending = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, description, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (launchError) throw launchError; const value = await check(); if (value) return value; await delay(80); }
  throw new Error(`Timed out: ${description}. Chrome exit: ${chrome.exitCode}. ${browserErrors}`);
}
function command(method, params = {}) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: false });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
try {
  const port = await until(async () => {
    try { return (await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch { return null; }
  }, "Chrome debugging port");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  };
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 1200, height: 850, deviceScaleFactor: 1, mobile: false });
  await command("Page.navigate", { url: `${origin}/?udm=2` });
  await until(() => evaluate('document.readyState === "complete" && Boolean(document.querySelector("#source"))'), "fixture ready");
  await evaluate(`
    window.testRoots = [];
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); testRoots.push(root); return root; };
    window.chrome = {runtime: { getURL: path => location.origin + '/' + path, sendMessage: async () => ({ok: true, token: 'fixture'}) }};
    window.copies = [];
    Object.defineProperty(navigator, 'clipboard', {value: {write: async items => { await Promise.all(items.map(item => item.getType('image/png'))); copies.push(items); }}});
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 600;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 960, 600); gradient.addColorStop(0, '#11667a'); gradient.addColorStop(1, '#18243f');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 960, 600);
    ctx.fillStyle = '#f7bc68'; ctx.beginPath(); ctx.arc(700, 190, 90, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#55a8a1'; ctx.beginPath(); ctx.moveTo(0,600); ctx.lineTo(350,150); ctx.lineTo(710,600); ctx.fill();
    ctx.fillStyle = '#9bcec0'; ctx.beginPath(); ctx.moveTo(420,600); ctx.lineTo(700,300); ctx.lineTo(960,600); ctx.fill();
    ctx.fillStyle = 'white'; ctx.font = '24px system-ui'; ctx.fillText('960 × 600 · local test image', 32, 554);
    document.querySelector('#source').src = canvas.toDataURL('image/png');
    const large = document.createElement('canvas'); large.width = 1920; large.height = 1200;
    const largeContext = large.getContext('2d'); largeContext.drawImage(canvas, 0, 0, 1920, 1200); largeContext.clearRect(0, 0, 80, 80);
    document.querySelector('#source').dataset.full = large.toDataURL('image/png');
    document.querySelector('#before').focus();
    window.scrollTo(0, 100);
  `);
  for (const file of ["shared/google-domains.js", "shared/config.js", "features/source/resolver.js", "features/zoom/zoom.js", "features/clipboard/clipboard.js", "features/clipboard/direct-copy.js", "features/overlay/overlay.js", "features/resolution/precheck.js", "features/resolution/indicator.js"]) {
    await evaluate(await fs.readFile(path.join(root, file), "utf8"));
  }
  await evaluate("PersonalImageZoom.overlay.open(document.querySelector('#source').src, 'fixture')");
  await until(() => evaluate("testRoots[0].querySelector('.status').textContent.startsWith('Ready')"), "PNG ready");
  assert.equal(await evaluate("testRoots[0].querySelector('dialog').open"), true);
  await until(() => evaluate("testRoots[0].querySelector('img').naturalWidth === 1920"), "larger original preview");
  const before = await evaluate("testRoots[0].querySelector('.zoom').textContent");
  await command("Input.dispatchMouseEvent", { type: "mouseWheel", x: 600, y: 400, deltaX: 0, deltaY: -240 });
  await until(async () => (await evaluate("testRoots[0].querySelector('.zoom').textContent")) !== before, "wheel zoom");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "y", code: "KeyY", windowsVirtualKeyCode: 89 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "y", code: "KeyY", windowsVirtualKeyCode: 89 });
  await until(() => evaluate("copies.length === 1"), "trusted Y copy");
  assert.deepEqual(await evaluate("copies[0][0].getType('image/png').then(b => b.arrayBuffer()).then(b => Array.from(new Uint8Array(b).slice(0,8)))"), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(await evaluate("(async () => { const b = await createImageBitmap(await copies[0][0].getType('image/png')); const c = document.createElement('canvas'); c.width=b.width;c.height=b.height; const x=c.getContext('2d');x.drawImage(b,0,0);const result=[b.width,b.height,x.getImageData(0,0,1,1).data[3]];b.close();return result; })()"), [1920, 1200, 0]);
  const screenshot = await command("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(path.join(output, "viewer.png"), Buffer.from(screenshot.data, "base64"));
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until(() => evaluate("!PersonalImageZoom.overlay.isActive()"), "Escape closes modal");
  assert.equal(await evaluate("document.activeElement.id"), "before");
  assert.equal(await evaluate("window.scrollY"), 100);
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "y", code: "KeyY", windowsVirtualKeyCode: 89 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "y", code: "KeyY", windowsVirtualKeyCode: 89 });
  assert.equal(await evaluate("copies.length"), 1);
  await command("Input.dispatchMouseEvent", { type: "mouseWheel", x: 600, y: 400, deltaX: 0, deltaY: 160 });
  await until(() => evaluate("window.scrollY > 100"), "normal scrolling after close");
  await evaluate("window.scrollTo(0, 100); PersonalImageZoom.config.googleHosts.push(location.hostname)");
  await evaluate(`
    window.precheckCalls = [];
    const originalBest = PersonalImageZoom.source.best;
    PersonalImageZoom.source.best = function(img, ...args) { precheckCalls.push(img?.id); return originalBest(img, ...args); };
    for (const [id, top] of [['precheck-visible', null], ['precheck-offscreen', 1800]]) {
      const image = document.querySelector('#source').cloneNode(); image.id=id;
      const c=document.createElement('canvas');c.width=2200;c.height=1400;image.dataset.full=c.toDataURL();
      if(top) image.style.cssText='position:absolute;top:'+top+'px;left:60px';
      document.querySelector('main').append(image);
    }
  `);
  await evaluate(await fs.readFile(path.join(root, "features/google-images/icons.js"), "utf8"));
  await evaluate("PersonalImageZoom.icons.start()");
  await until(() => evaluate("PersonalImageZoom.precheck.lookup(document.querySelector('#source'))?.done && PersonalImageZoom.precheck.lookup(document.querySelector('#precheck-visible'))?.done"), "all visible images prechecked before any hover");
  assert.equal(await evaluate("precheckCalls.includes('precheck-offscreen')"), false, "offscreen image must not be checked yet");
  assert.equal(await evaluate("testRoots.length"), 1, "no icon DOM is allocated before hover");
  const checkedBeforeHover = await evaluate("precheckCalls.filter(id => id === 'source').length");
  const sourcePoint = await evaluate("(() => { const r=document.querySelector('#source').getBoundingClientRect();return {x:r.x+40,y:r.y+40}; })()");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...sourcePoint });
  await until(() => evaluate("testRoots[1]?.querySelector('button:not([hidden])') !== null && Boolean(testRoots[1]?.querySelector('button:not([hidden])'))"), "top-right thumbnail icon");
  assert.equal(await evaluate("testRoots[1].querySelectorAll('button:not([hidden])').length"), 2);
  await until(() => evaluate("testRoots[1].querySelector('.resolution').dataset.level === 'medium'"), "yellow light for 1920 px original");
  assert.equal(await evaluate("precheckCalls.filter(id => id === 'source').length"), checkedBeforeHover, "hover uses the precheck without new measurement");
  assert.match(await evaluate("testRoots[1].querySelector('.resolution').title"), /1920 × 1200 px/);
  assert.equal(await evaluate("(() => { const r=testRoots[1].querySelector('.resolution').getBoundingClientRect();const t=document.querySelector('#source').getBoundingClientRect();return r.left===t.left+6 && r.top===t.top+6; })()"), true);
  const toolbarScreenshot = await command("Page.captureScreenshot", { format: "png" });
  await fs.writeFile(path.join(output, "hover-tools.png"), Buffer.from(toolbarScreenshot.data, "base64"));
  const copyIcon = await evaluate("(() => { const r=testRoots[1].querySelector('button.copy').getBoundingClientRect();return {x:r.x+14,y:r.y+14}; })()");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...copyIcon });
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...copyIcon, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...copyIcon, button: "left", clickCount: 1 });
  await until(() => evaluate("copies.length === 2 && !testRoots[1].querySelector('button.copy').disabled"), "direct copy completes");
  assert.equal(await evaluate("PersonalImageZoom.overlay.isActive()"), false, "copy must not open viewer");
  assert.equal(await evaluate("testRoots.length"), 2, "copy creates no viewer DOM");
  assert.equal(await evaluate("testRoots[1].querySelector('.notice').dataset.kind"), "success");
  assert.deepEqual(await evaluate("(async () => { const b=await createImageBitmap(await copies[1][0].getType('image/png'));const c=document.createElement('canvas');c.width=b.width;c.height=b.height;const x=c.getContext('2d');x.drawImage(b,0,0);const result=[b.width,b.height,x.getImageData(0,0,1,1).data[3]];b.close();return result; })()"), [1920, 1200, 0]);
  const icon = await evaluate("(() => { const r = testRoots[1].querySelector('button').getBoundingClientRect(); return {x:r.x+14,y:r.y+14}; })()");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...icon });
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...icon, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...icon, button: "left", clickCount: 1 });
  await until(() => evaluate("PersonalImageZoom.overlay.isActive() && testRoots[2]?.querySelector('dialog').open"), "icon opens viewer without navigating");
  assert.equal(await evaluate("location.pathname"), "/");
  await evaluate("PersonalImageZoom.overlay.close(); const second = document.querySelector('#source').cloneNode(); second.id = 'second'; document.querySelector('main').append(second)");
  const secondPoint = await evaluate("(() => { const r=document.querySelector('#second').getBoundingClientRect();return {x:r.x+40,y:r.y+40}; })()");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...secondPoint });
  await until(() => evaluate("testRoots[1].querySelectorAll('button:not([hidden])').length === 2"), "hover newly added image");
  assert.equal(await evaluate("testRoots[1].querySelectorAll('button').length"), 2, "only one button pair is reused");
  await until(() => evaluate("testRoots[1].querySelector('.resolution').dataset.level === 'medium'"), "indicator follows new image");
  // Replace this image's original with a high-resolution fixture and re-hover.
  await evaluate("(() => { const c=document.createElement('canvas');c.width=2400;c.height=1600;document.querySelector('#second').dataset.full=c.toDataURL(); })()");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1000, y: 400 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...secondPoint });
  await until(() => evaluate("testRoots[1].querySelector('.resolution').dataset.level === 'high'"), "green light for 2400 px original");
  await evaluate("(() => { const c=document.createElement('canvas');c.width=600;c.height=400;document.querySelector('#second').src=c.toDataURL();c.width=800;c.height=600;document.querySelector('#second').dataset.full=c.toDataURL(); })()");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1000, y: 400 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...secondPoint });
  await until(() => evaluate("testRoots[1].querySelector('.resolution').dataset.level === 'low'"), "red light for 800 px original");
  await evaluate("document.querySelector('#second').removeAttribute('data-full')");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1000, y: 400 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...secondPoint });
  await until(() => evaluate("testRoots[1].querySelector('.resolution').dataset.level === 'unknown'"), "thumbnail-only resolution stays gray");
  await evaluate("document.querySelector('#second').style.cssText='width:40px;height:40px'");
  const smallPoint = await evaluate("(() => { const r=document.querySelector('#second').getBoundingClientRect();return {x:r.x+15,y:r.y+15}; })()");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...smallPoint });
  await until(() => evaluate("Array.from(testRoots[1].querySelectorAll('button')).every(button => button.hidden)"), "small image excluded");
  assert.equal(await evaluate("testRoots[1].querySelector('.resolution').hidden"), true);
  await evaluate("document.querySelector('#second').remove()");
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1000, y: 400 });
  assert.equal(await evaluate("testRoots[1].querySelector('button').hidden"), true);
  await evaluate("window.scrollTo(0, 1600)");
  await until(() => evaluate("PersonalImageZoom.precheck.lookup(document.querySelector('#precheck-offscreen'))?.done"), "newly visible image checked on scroll without hover");
  console.log("PASS: automatic visible-image precheck before hover, offscreen deferral, cached hover reuse, scroll-triggered precheck; traffic-light/copy/viewer regressions.");
  console.log(`Screenshot: ${path.join(output, "viewer.png")}`);
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await command("Browser.close").catch(() => {});
    socket.close();
  }
  if (chrome.exitCode === null && !launchError) chrome.kill();
  server.close();
}
