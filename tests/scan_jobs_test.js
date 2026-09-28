import assert from 'node:assert/strict';
import { f_o_scan_jobs } from '../scan_jobs.module.js';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
Deno.test('live scan acknowledges tiles during processing, coalesces updates and waits before finalization', async () => {
    const root = await Deno.makeTempDir();
    const started = deferred(), release = deferred();
    const calls = [];
    const queue = f_o_scan_jobs({ s_root: root, f_run: async option => {
        calls.push(option);
        if (calls.length === 1) { started.resolve(); await release.promise; }
        return { b_success: true, s_path_output: option.s_path_folder + (option.b_live_preview ? '/live_preview.jpg' : '/stitched.png') };
    } });
    try {
        await queue.f_init();
        const folder = await tiles(root, 'live');
        await Deno.mkdir(folder + '/dowscaled');
        for (let i = 0; i < 2; i++) await Deno.writeTextFile(folder + '/dowscaled/tile_r00_c0' + i + '.png', 'small');
        await queue.f_create(folder, 1, { b_live_scan: true, n_score__min: .4 });
        await queue.f_tile(folder, 'tile_r00_c00.png');
        await started.promise;
        await queue.f_tile(folder, 'tile_r00_c01.png');
        await queue.f_tile(folder, 'tile_r00_c01.png');
        await assert.rejects(queue.f_tile(folder, '../tile.png'), /Invalid tile/);
        assert.equal(calls.length, 1);
        await queue.f_finish(folder);
        await queue.f_enqueue({ s_path_folder: folder });
        assert.equal(calls.length, 1, 'finalization must wait for live cache writer');
        release.resolve();
        await queue.f_idle();
        assert.equal(calls.at(-1).b_live_preview, undefined);
        assert.equal(calls.at(-1).b_live_scan, true);
        assert.equal(queue.f_list()[0].s_status, 'complete');
        assert.equal(queue.f_list()[0].o_live.n_revision, 1);
    } finally { release.resolve(); await queue.f_idle(); await Deno.remove(root, { recursive: true }); }
});
async function tiles(root, name) {
    const folder = root + '/' + name;
    await Deno.mkdir(folder);
    for (let i = 0; i < 2; i++) await Deno.writeTextFile(folder + '/tile_r00_c0' + i + '.png', 'tile');
    return folder;
}
Deno.test('failed live previews do not fail capture or final stitching', async () => {
    const root = await Deno.makeTempDir();
    const queue = f_o_scan_jobs({ s_root: root, f_run: async option => {
        if (option.b_live_preview) throw Error('preview test failure');
        return { b_success: true };
    } });
    try {
        await queue.f_init();
        const folder = await tiles(root, 'live');
        await Deno.mkdir(folder + '/dowscaled');
        await Deno.writeTextFile(folder + '/dowscaled/tile_r00_c00.png', 'small');
        await queue.f_create(folder, 0, { b_live_scan: true });
        await queue.f_tile(folder, 'tile_r00_c00.png');
        await queue.f_idle();
        assert.equal(queue.f_list()[0].s_status, 'capturing');
        assert.match(queue.f_list()[0].o_live.s_error, /preview test failure/);
        await queue.f_finish(folder);
        await queue.f_enqueue({ s_path_folder: folder });
        await queue.f_idle();
        assert.equal(queue.f_list()[0].s_status, 'complete');
    } finally { await queue.f_idle(); await Deno.remove(root, { recursive: true }); }
});
Deno.test('scan queue: capture while stitching, FIFO, duplicate requests, isolated logs/options and failure recovery', async () => {
    const root = await Deno.makeTempDir();
    const started = deferred(), release = deferred();
    const calls = [], completed = [];
    const queue = f_o_scan_jobs({ s_root: root, f_complete: job => completed.push(job), f_run: async (option, log) => {
        calls.push(option);
        log(option.s_path_folder);
        if (calls.length === 1) { started.resolve(); await release.promise; }
        return { b_success: calls.length !== 2, s_error: calls.length === 2 ? 'test failure' : '', s_path_output: option.s_path_folder + '/stitched.png' };
    } });
    try {
        await queue.f_init();
        const a = await tiles(root, 'a');
        await queue.f_create(a, 12);
        await assert.rejects(queue.f_enqueue({ s_path_folder: a }), /Finish capture/);
        await queue.f_finish(a);
        await queue.f_enqueue({ s_path_folder: a, n_score__min: .4 });
        await started.promise;
        const b = await tiles(root, 'b');
        await queue.f_create(b, 21); // new capture succeeds while A is blocked
        await queue.f_finish(b);
        await Promise.all([queue.f_enqueue({ s_path_folder: b, n_score__min: .7 }), queue.f_enqueue({ s_path_folder: b })]);
        assert.equal(calls.length, 1);
        assert.equal(queue.f_list().find(j => j.s_path_folder === b).s_status, 'queued');
        release.resolve();
        await queue.f_idle();
        assert.deepEqual(calls.map(o => o.n_score__min), [.4, .7]);
        assert.equal(completed[0].n_id__slide, 12);
        let jobs = queue.f_list();
        assert.equal(jobs.find(j => j.s_path_folder === b).s_status, 'failed');
        assert.deepEqual(jobs.find(j => j.s_path_folder === a).a_s_line, [a]);
        await queue.f_enqueue({ s_path_folder: b });
        await queue.f_idle();
        assert.equal(queue.f_list().find(j => j.s_path_folder === b).s_status, 'complete');
        assert.equal(completed[1].n_id__slide, 21);
        const restored = f_o_scan_jobs({ s_root: root, f_run: () => { throw Error('Completed jobs must not restart'); } });
        await restored.f_init();
        await restored.f_idle();
        assert.ok(restored.f_list().every(j => j.s_status === 'complete'));
        await assert.rejects(queue.f_enqueue({ s_path_folder: '/tmp' }), /inside scans/);
    } finally { release.resolve(); await queue.f_idle(); await Deno.remove(root, { recursive: true }); }
});
Deno.test('scan queue: resumes queued jobs, marks active jobs interrupted and discovers old scans', async () => {
    const root = await Deno.makeTempDir();
    const calls = [];
    try {
        for (const status of ['queued', 'running', 'capturing']) {
            const folder = await tiles(root, status);
            await Deno.writeTextFile(folder + '/stitch_job.json', JSON.stringify({ s_id: status, s_status: status, n_tiles: 2,
                n_queued: 1, a_s_line: [], o_option: {}, n_created: 1 }));
        }
        await tiles(root, 'old');
        const queue = f_o_scan_jobs({ s_root: root, f_run: async o => { calls.push(o.s_path_folder); return { b_success: true }; } });
        await queue.f_init();
        await queue.f_idle();
        assert.deepEqual(calls, [root + '/queued']);
        const jobs = queue.f_list();
        assert.equal(jobs.filter(j => j.s_status === 'interrupted').length, 2);
        assert.equal(jobs.find(j => j.s_name === 'old').s_status, 'ready');
    } finally { await Deno.remove(root, { recursive: true }); }
});
