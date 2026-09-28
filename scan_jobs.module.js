import { resolve, join, sep, basename } from 'node:path';

// Durable, single-worker queue: capture never waits for a Python stitch process.
export function f_o_scan_jobs({ s_root, f_run, f_complete = async () => {} }) {
    const m_job = new Map();
    let b_running = false;
    let o_idle = Promise.resolve();
    const m_write = new WeakMap();
    const m_live = new Map();
    let liveTail = Promise.resolve();
    function f_schedule_live(job, state) {
        if (state.pending) return;
        state.pending = true;
        state.work = liveTail = liveTail.catch(() => {}).then(async () => {
            // Coalesce notifications received while another preview is running.
            const revision = state.revision;
            const names = [...state.tiles].sort();
            try {
                const result = await f_run({ ...job.o_option, s_path_folder: job.s_path_folder,
                    b_live_scan: true, b_live_preview: true, a_s_tile: names }, () => {});
                if (result.b_success) {
                    job.o_live = { s_path_preview: result.s_path_output, n_revision: revision,
                        n_tiles: names.length, s_error: '' };
                } else {
                    job.o_live = { ...job.o_live, s_error: result.s_error || 'Waiting for overlapping tiles' };
                }
            } catch (error) {
                job.o_live = { ...job.o_live, s_error: error.message };
            }
            try { await f_save(job); }
            catch (error) { job.o_live = { ...job.o_live, s_error: 'Could not save preview state: ' + error.message }; }
            state.pending = false;
            if (state.revision !== revision && !state.closed) f_schedule_live(job, state);
        });
    }
    async function f_tile(s_path, name) {
        const folder = await f_folder(s_path);
        const job = m_job.get(folder);
        if (!job || job.s_status !== 'capturing' || !job.o_option.b_live_scan) throw Error('No active live scan');
        if (!/^tile_r\d+_c\d+\.png$/.test(name)) throw Error('Invalid tile name');
        for (const path of [join(folder, name), join(folder, 'dowscaled', name)]) {
            const real = await Deno.realPath(path);
            if (!real.startsWith(folder + sep) || !(await Deno.stat(real)).isFile) throw Error('Invalid saved tile');
        }
        let state = m_live.get(folder);
        if (!state) { state = { tiles: new Set(), revision: 0, pending: false, closed: false }; m_live.set(folder, state); }
        if (!state.tiles.has(name)) {
            state.tiles.add(name);
            job.n_tiles = state.tiles.size;
            state.revision++;
            f_schedule_live(job, state);
        }
        return { b_success: true };
    }
    const f_copy = o => structuredClone(o);
    async function f_folder(s_path) {
        const root = await Deno.realPath(s_root);
        const path = await Deno.realPath(resolve(s_path));
        if (!path.startsWith(root + sep) || path === root) throw Error('Scan folder must be inside scans/');
        return path;
    }
    function f_save(o_job) {
        const path = join(o_job.s_path_folder, 'stitch_job.json');
        const tmp = path + '.tmp';
        const data = JSON.stringify(o_job, null, 2);
        const write = (m_write.get(o_job) || Promise.resolve()).catch(() => {}).then(async () => {
            await Deno.writeTextFile(tmp, data);
            await Deno.rename(tmp, path);
        });
        m_write.set(o_job, write);
        return write;
    }
    function f_log(o_job, s_line) {
        o_job.a_s_line.push(s_line);
        if (o_job.a_s_line.length > 400) o_job.a_s_line.shift();
    }
    function f_pump() {
        if (b_running) return;
        b_running = true;
        o_idle = (async () => {
            while (true) {
                const job = [...m_job.values()].filter(j => j.s_status === 'queued')
                    .sort((a, b) => a.n_queued - b.n_queued)[0];
                if (!job) break;
                job.s_status = 'running';
                job.n_started = Date.now();
                try {
                    await f_save(job);
                    // Do not race the live writer against final cache consumption.
                    const live = m_live.get(job.s_path_folder);
                    if (live) {
                        live.closed = true;
                        await live.work;
                        m_live.delete(job.s_path_folder);
                    }
                    const result = await f_run({ ...job.o_option, s_path_folder: job.s_path_folder }, line => f_log(job, line));
                    job.o_result = result;
                    job.s_status = result.b_success ? 'complete' : 'failed';
                    job.s_error = result.s_error || '';
                    if (result.b_success) {
                        try { await f_complete(f_copy(job)); }
                        catch (error) { f_log(job, 'Could not link slide library: ' + error.message); }
                    }
                } catch (error) {
                    job.s_status = 'failed';
                    job.s_error = error.message;
                }
                job.n_finished = Date.now();
                try { await f_save(job); }
                catch (error) { job.s_error += ' Could not save job state: ' + error.message; }
            }
        })().finally(() => { b_running = false; });
    }
    async function f_init() {
        await Deno.mkdir(s_root, { recursive: true });
        for await (const entry of Deno.readDir(s_root)) {
            if (!entry.isDirectory) continue;
            const folder = join(s_root, entry.name);
            let job;
            try { job = JSON.parse(await Deno.readTextFile(join(folder, 'stitch_job.json'))); }
            catch {
                let count = 0;
                let output = '';
                for await (const file of Deno.readDir(folder)) {
                    if (/^tile_r\d+_c\d+.*\.(png|jpg|tiff?)$/i.test(file.name)) count++;
                    if (file.name === 'stitched.png') output = join(folder, file.name);
                }
                if (!count) continue;
                job = { s_id: crypto.randomUUID(), s_name: entry.name, n_created: (await Deno.stat(folder)).birthtime?.getTime() || 0,
                    s_status: output ? 'complete' : 'ready', n_tiles: count, a_s_line: [], o_option: {},
                    o_result: output ? { b_success: true, s_path_output: output } : null };
            }
            job.s_path_folder = await f_folder(folder);
            if (['running', 'capturing'].includes(job.s_status)) {
                job.s_status = 'interrupted';
                job.s_error = 'Server stopped during capture or stitching. Saved tiles can be stitched again.';
                job.n_tiles = 0;
                for await (const file of Deno.readDir(folder)) if (/^tile_r\d+_c\d+.*\.png$/i.test(file.name)) job.n_tiles++;
                await f_save(job);
            }
            m_job.set(job.s_path_folder, job);
        }
        f_pump();
    }
    async function f_create(s_path, n_id__slide = 0, o_option = {}) {
        const folder = await f_folder(s_path);
        const job = { s_id: crypto.randomUUID(), s_name: basename(folder), s_path_folder: folder,
            n_id__slide, n_created: Date.now(), s_status: 'capturing', n_tiles: 0,
            a_s_line: [], o_option: f_copy(o_option), o_result: null, s_error: '' };
        if (m_job.has(folder)) throw Error('Scan folder already registered');
        m_job.set(folder, job);
        await f_save(job);
        return f_copy(job);
    }
    async function f_finish(s_path) {
        const job = m_job.get(await f_folder(s_path));
        if (!job) throw Error('Unknown scan');
        if (job.s_status !== 'capturing') return f_copy(job);
        job.n_tiles = 0;
        for await (const file of Deno.readDir(job.s_path_folder)) {
            if (file.isFile && /^tile_r\d+_c\d+.*\.png$/i.test(file.name)) job.n_tiles++;
        }
        job.s_status = 'ready';
        await f_save(job);
        return f_copy(job);
    }
    async function f_enqueue(o_option) {
        const job = m_job.get(await f_folder(o_option.s_path_folder));
        if (!job) throw Error('Unknown scan');
        if (['queued', 'running'].includes(job.s_status)) return f_copy(job);
        if (job.s_status === 'capturing') throw Error('Finish capture before stitching');
        if (job.n_tiles < 2) throw Error('At least two saved tiles are needed');
        o_option = { ...job.o_option, ...o_option, b_live_scan: job.o_option.b_live_scan === true };
        const previous = f_copy(job);
        Object.assign(job, { s_status: 'queued', n_queued: Date.now(), n_finished: null,
            s_error: '', a_s_line: [], o_result: null, o_option: f_copy(o_option) });
        try { await f_save(job); }
        catch (error) { Object.assign(job, previous); throw error; }
        f_pump();
        return f_copy(job);
    }
    return { f_init, f_create, f_finish, f_enqueue, f_folder, f_tile,
        f_list: () => f_copy([...m_job.values()].sort((a, b) => b.n_created - a.n_created)),
        f_idle: async () => { await o_idle; while (true) { const tail = liveTail; await tail; if (tail === liveTail) break; } } };
}
