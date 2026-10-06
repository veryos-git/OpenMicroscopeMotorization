import { f_validate_sample } from './webserved_dir/training_data.module.js';

// One reusable model, serialized requests; no worker is started while SAM is off.
let s_root = new URL('.', import.meta.url).pathname;
let o_child, o_writer, o_reader, n_idle;
let o_queue = Promise.resolve();
let f_stop = () => {
    clearTimeout(n_idle);
    try { o_child?.kill('SIGTERM'); } catch { /* already exited */ }
    o_child = o_writer = o_reader = null;
};
let f_infer = async (s_frame, a_o_box) => {
    clearTimeout(n_idle);
    if (!o_child) {
        try { await Deno.stat(s_root + 'venv_yolo/bin/python3'); }
        catch { throw new Error('SAM needs the AI environment. Run deno task install-yolo.'); }
        o_child = new Deno.Command(s_root + 'venv_yolo/bin/python3', {
            args: [s_root + 'sam_worker.py', s_root + 'weights/sam/sam_b.pt'],
            cwd: s_root, stdin: 'piped', stdout: 'piped', stderr: 'inherit',
            env: { YOLO_CONFIG_DIR: s_root + 'weights/yolo/config', PYTHONUNBUFFERED: '1' },
        }).spawn();
        o_writer = o_child.stdin.getWriter();
        o_reader = o_child.stdout.pipeThrough(new TextDecoderStream()).getReader();
    }
    let n_timeout;
    try {
        let o_work = (async () => {
            await o_writer.write(new TextEncoder().encode(JSON.stringify({ s_frame, a_o_box }) + '\n'));
            let s_line = '';
            while (!s_line.includes('\n')) {
                let { value, done } = await o_reader.read();
                if (done) throw new Error('SAM worker exited. Check the server log and AI environment.');
                s_line += value;
            }
            let o_result = JSON.parse(s_line);
            if (o_result.s_error) throw new Error(o_result.s_error);
            return o_result;
        })();
        return await Promise.race([o_work, new Promise((_, reject) => {
            n_timeout = setTimeout(() => reject(new Error('SAM inference timed out')), 600000);
        })]);
    } catch (error) {
        f_stop();
        throw error;
    } finally {
        clearTimeout(n_timeout);
        n_idle = setTimeout(f_stop, 300000);
        Deno.unrefTimer(n_idle);
    }
};

let f_o_sam_response = async (o_request, f_worker = f_infer) => {
    if (o_request.method !== 'POST') return Response.json({ s_error: 'POST required' }, { status: 405 });
    let s_temp;
    try {
        if (Number(o_request.headers.get('content-length')) > 55 * 1024 * 1024) throw new Error('SAM image is too large');
        let o_form = await o_request.formData();
        let o_image = o_form.get('image');
        if (!(o_image instanceof File) || o_image.size > 50 * 1024 * 1024) throw new Error('Expected a PNG image up to 50 MB');
        let a_n_image = new Uint8Array(await o_image.arrayBuffer());
        if (a_n_image.length < 24 || ![137,80,78,71,13,10,26,10].every((n,i) => a_n_image[i] === n)) throw new Error('Expected a PNG image');
        let o_header = new DataView(a_n_image.buffer);
        let n_scl_x = o_header.getUint32(16), n_scl_y = o_header.getUint32(20);
        if (n_scl_x * n_scl_y > 40000000) throw new Error('SAM image exceeds 40 megapixels');
        let a_o_box = JSON.parse(o_form.get('boxes'));
        f_validate_sample({ n_scl_x, n_scl_y, a_o_box });
        if (new Set(a_o_box.map(o => o.s_id)).size !== a_o_box.length || a_o_box.some(o => typeof o.s_id !== 'string' || o.s_id.length > 100)) throw new Error('Invalid SAM box IDs');
        s_temp = await Deno.makeTempDir({ prefix: 'microscope-sam-' });
        let s_frame = s_temp + '/frame.png';
        await Deno.writeFile(s_frame, a_n_image);
        let o_work = o_queue.then(() => f_worker(s_frame, a_o_box));
        o_queue = o_work.catch(() => {});
        let o_result = await o_work;
        if (o_result.n_scl_x !== n_scl_x || o_result.n_scl_y !== n_scl_y) throw new Error('SAM image geometry changed');
        if (!Array.isArray(o_result.a_o_box) || o_result.a_o_box.length !== a_o_box.length) throw new Error('SAM did not return one mask per box');
        f_validate_sample({ n_scl_x, n_scl_y, a_o_box: a_o_box.map(o => {
            let o_mask = o_result.a_o_box.find(m => m.s_id === o.s_id)?.o_segmentation;
            if (!o_mask) throw new Error('SAM mask is missing');
            return { ...o, o_segmentation: o_mask };
        }) });
        return Response.json(o_result);
    } catch (error) {
        return Response.json({ s_error: error.message }, { status: 400 });
    } finally {
        if (s_temp) await Deno.remove(s_temp, { recursive: true });
    }
};
export { f_o_sam_response, f_stop as f_sam_stop };
