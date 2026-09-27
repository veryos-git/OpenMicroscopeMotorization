// Full websocket/HTTP/Python integration against an isolated server and scans tree.
import assert from 'node:assert/strict';

Deno.test('scan server acknowledges background jobs, accepts another scan, and exposes finished files', async () => {
    const root = await Deno.makeTempDir();
    const repo = Deno.cwd();
    let child, socket;
    const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
    const port = listener.addr.port;
    listener.close();
    const origin = 'http://localhost:' + port;
    try {
        await Deno.symlink(repo + '/venv', root + '/venv');
        await Deno.symlink(repo + '/stitch.py', root + '/stitch.py');
        child = new Deno.Command(Deno.execPath(), { args: ['run', '-A', repo + '/webserver_denojs.js', '--port', String(port), '--db', root + '/app.db'],
            cwd: root, stdout: 'null', stderr: 'piped' }).spawn();
        const stderr = new Response(child.stderr).text();
        for (let i = 0; i < 100; i++) {
            try { await fetch(origin); break; } catch { await new Promise(r => setTimeout(r, 100)); }
        }
        socket = new WebSocket('ws://localhost:' + port);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        const pending = new Map();
        socket.onmessage = event => {
            const data = JSON.parse(event.data);
            if (pending.has(data.s_uuid)) { pending.get(data.s_uuid)(data); pending.delete(data.s_uuid); }
        };
        const request = (s_type, v_data = {}) => new Promise((resolve, reject) => {
            const s_uuid = crypto.randomUUID();
            const timer = setTimeout(() => { pending.delete(s_uuid); reject(Error('Timed out: ' + s_type)); }, 10000);
            pending.set(s_uuid, data => { clearTimeout(timer); data.error ? reject(Error(data.error)) : resolve(data.v_result); });
            socket.send(JSON.stringify({ s_type, v_data, s_uuid }));
        });
        const scan = await request('scan_create_folder');
        const folder = scan.s_path_folder;
        const images = await new Deno.Command(repo + '/venv/bin/python', { args: ['-c', `
import cv2, numpy as np, sys
rng=np.random.default_rng(9)
scene=cv2.GaussianBlur(rng.integers(0,256,(240,500,3),dtype=np.uint8),(0,0),2)
for col,x in enumerate((0,160)): cv2.imwrite(sys.argv[1]+'/tile_r00_c0'+str(col)+'.png',scene[:,x:x+340])
`, folder], stdout: 'piped', stderr: 'piped' }).output();
        assert.equal(images.code, 0);
        await request('scan_finish', { s_path_folder: folder });
        const queued = await request('stitch_run', { s_path_folder: folder, b_no_flatfield: true });
        assert.ok(['running', 'queued'].includes(queued.s_status));
        const second = await request('scan_create_folder');
        assert.notEqual(second.s_path_folder, folder);
        let job;
        for (let i = 0; i < 100; i++) {
            job = (await request('scan_jobs_list')).find(j => j.s_path_folder === folder);
            if (['complete', 'failed'].includes(job.s_status)) break;
            await new Promise(r => setTimeout(r, 100));
        }
        assert.equal(job.s_status, 'complete', JSON.stringify(job));
        assert.ok(job.a_s_line.some(line => line.includes('done')));
        const response = await fetch(origin + '/api/file?path=' + encodeURIComponent(job.o_result.s_path_output));
        assert.equal(response.status, 200);
        await response.arrayBuffer();
        const files = await fetch(origin + '/api/scans/folder?path=' + encodeURIComponent(folder));
        assert.match(await files.text(), /stitched.png/);
        const denied = await fetch(origin + '/api/scans/folder?path=' + encodeURIComponent(root));
        assert.equal(denied.status, 400);
        await denied.text();
        socket.close();
        child.kill('SIGTERM');
        await child.status;
        await stderr;
        child = null;
    } finally {
        socket?.close();
        if (child) { try { child.kill('SIGTERM'); } catch {} await child.status; }
        await Deno.remove(root, { recursive: true });
    }
});
