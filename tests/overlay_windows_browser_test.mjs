// node tests/overlay_windows_browser_test.mjs (requires Google Chrome; no app/hardware needed)
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { once } from 'node:events';

const server = createServer(async (req, res) => {
    if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<link rel="stylesheet" href="/index.css"><style>.panel-body {height:120px}</style>
            <div class="overlay-panel panel-gamepad visible"><div class="panel-header"><h2>Gamepad</h2><button class="panel-close" onclick="window.clicked=true">×</button></div><div class="panel-body"><input></div></div>
            <div class="overlay-panel panel-training visible"><div class="panel-header"><h2>Training</h2><button class="panel-close">×</button></div><div class="panel-body"></div></div>
            <script type="module">import {f_install_overlay_windows} from '/overlay_windows.module.js'; window.cleanup = f_install_overlay_windows();</script>`);
        return;
    }
    try {
        if (!['/index.css', '/overlay_windows.module.js'].includes(req.url)) throw Error();
        res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css');
        res.end(await readFile(new URL('../webserved_dir' + req.url, import.meta.url)));
    } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const profile = await mkdtemp(tmpdir() + '/overlay-browser-');
const chrome = spawn(process.env.CHROME_PATH || '/usr/bin/google-chrome', [
    '--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
    const address = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(Error('Chrome startup timed out')), 15000);
        chrome.stderr.on('data', data => {
            output += data;
            const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
            if (match) { clearTimeout(timer); resolve(match[1]); }
        });
        chrome.on('error', reject);
        chrome.on('exit', code => { clearTimeout(timer); reject(Error('Chrome exited: ' + code + output)); });
    });
    const pages = await (await fetch(address.replace(/^ws:/, 'http:').replace(/\/devtools\/.*/, '/json/list'))).json();
    socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener('message', evt => {
        const msg = JSON.parse(evt.data);
        if (pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? reject(Error(JSON.stringify(msg.error))) : resolve(msg.result);
        }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    const viewport = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await viewport(1600, 1000);
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    for (let i = 0; i < 100 && !await evaluate('typeof cleanup === "function"'); i++) await new Promise(r => setTimeout(r, 30));
    assert.equal(await evaluate('typeof cleanup'), 'function', await evaluate('location.href + ": " + document.documentElement.outerHTML'));
    const rect = (selector = '.panel-gamepad') => evaluate(`document.querySelector('${selector}').getBoundingClientRect().toJSON()`);
    const mouse = (type, x, y, button = 'left') => send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1, buttons: type === 'mouseReleased' ? 0 : button === 'left' ? 1 : 2 });
    const drag = async (x, y, dx, dy, button = 'left') => {
        await mouse('mousePressed', x, y, button);
        await mouse('mouseMoved', x + dx, y + dy, button);
        await mouse('mouseReleased', x + dx, y + dy, button);
    };
    // Hide the right-anchored panel until tested; it overlaps the centered one.
    await evaluate("document.querySelector('.panel-training').classList.remove('visible')");
    const before = await rect();
    await drag(before.x + 40, before.y + 20, 120, 90);
    let after = await rect();
    assert.equal(after.x, before.x + 120);
    assert.equal(after.y, before.y + 90);
    assert.equal(after.width, before.width);
    assert.equal(after.height, before.height);
    await drag(after.x + 40, after.y + 20, 80, 60, 'right');
    assert.deepEqual(await rect(), after);
    const close = await rect('.panel-gamepad .panel-close');
    await drag(close.x + 10, close.y + 10, 0, 0);
    assert.equal(await evaluate('window.clicked'), true);
    assert.deepEqual(await rect(), after);
    const input = await rect('.panel-gamepad input');
    await drag(input.x + 10, input.y + 10, 30, 10);
    assert.deepEqual(await rect(), after);
    // Expanding quick settings must keep a previously dragged header reachable.
    await evaluate("document.documentElement.style.setProperty('--topbar-h', '220px'); window.dispatchEvent(new Event('toolbar-resize'))");
    assert.equal((await rect()).y, 220);
    await evaluate("document.documentElement.style.setProperty('--topbar-h', '56px'); window.dispatchEvent(new Event('toolbar-resize'))");
    await evaluate("document.querySelector('.panel-gamepad').classList.remove('visible')");
    await viewport(600, 500);
    await evaluate("document.querySelector('.panel-gamepad').classList.add('visible')");
    await evaluate('new Promise(requestAnimationFrame)');
    after = await rect();
    assert.ok(after.x >= 0 && after.x + after.width <= 600);
    assert.ok(after.y >= 56 && after.y + after.height <= 500);
    // Touch dragging and cancellation, with responsive CSS active.
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: after.x + 40, y: after.y + 20 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: after.x + 30, y: after.y + 50 }] });
    await send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    assert.equal(await evaluate("document.querySelector('[data-panel-dragging]') === null"), true);
    assert.ok((await rect()).x < after.x);
    await viewport(1600, 1000);
    await evaluate("document.querySelector('.panel-gamepad').classList.remove('visible'); document.querySelector('.panel-training').classList.add('visible')");
    const right = await rect('.panel-training');
    await drag(right.x + 40, right.y + 20, -200, 70);
    const moved = await rect('.panel-training');
    assert.equal(moved.x, right.x - 200);
    assert.equal(moved.y, right.y + 70);
    assert.equal(moved.width, right.width);
    await evaluate('cleanup()');
    await drag(moved.x + 40, moved.y + 20, 30, 30);
    assert.deepEqual(await rect('.panel-training'), moved);
    console.log('Passed: centered/right-anchored panels, mouse/touch, controls, responsive bounds, reopen, cancellation and cleanup.');
} finally {
    socket?.close();
    chrome.kill();
    await once(chrome, 'exit');
    server.close();
    await rm(profile, { recursive: true, force: true });
}
