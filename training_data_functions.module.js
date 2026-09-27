import { f_s_yolo, f_validate_sample } from './webserved_dir/training_data.module.js';

// Each capture is committed by renaming a complete temporary directory.
let f_o_training_store = function (s_root = './training_data') {
    let f_s_path = (s_id) => {
        if (!/^[0-9a-f-]{36}$/.test(s_id)) throw new Error('Invalid capture ID');
        return `${s_root}/${s_id}`;
    };
    let f_read = async (s_id) => JSON.parse(await Deno.readTextFile(`${f_s_path(s_id)}/metadata.json`));
    let f_list = async function () {
        await Deno.mkdir(s_root, { recursive: true });
        let a_o_sample = [];
        for await (let o_entry of Deno.readDir(s_root)) {
            if (o_entry.isDirectory && /^[0-9a-f-]{36}$/.test(o_entry.name)) {
                a_o_sample.push(await f_read(o_entry.name));
            }
        }
        return a_o_sample.sort((a, b) => b.n_ts_ms - a.n_ts_ms);
    };
    let f_save = async function (o_sample, a_n_image) {
        f_validate_sample(o_sample);
        let a_n_magic = [137, 80, 78, 71, 13, 10, 26, 10];
        if (
            a_n_image.length < 24 || a_n_image.length > 50 * 1024 * 1024 ||
            !a_n_magic.every((n, i) => a_n_image[i] === n)
        ) throw new Error('Expected a PNG image up to 50 MB');
        let o_view = new DataView(a_n_image.buffer, a_n_image.byteOffset, a_n_image.byteLength);
        if (o_view.getUint32(16) !== o_sample.n_scl_x || o_view.getUint32(20) !== o_sample.n_scl_y) {
            throw new Error('Image dimensions do not match metadata');
        }
        let s_id = crypto.randomUUID();
        let o_saved = { ...o_sample, n_version: 1, s_id, s_quality: 'unrated', n_ts_ms__saved: Date.now() };
        await Deno.mkdir(s_root, { recursive: true });
        let s_temp = await Deno.makeTempDir({ dir: s_root, prefix: '.pending-' });
        try {
            await Deno.writeFile(`${s_temp}/image.png`, a_n_image);
            await Deno.writeTextFile(`${s_temp}/metadata.json`, JSON.stringify(o_saved, null, 2));
            await Deno.rename(s_temp, f_s_path(s_id));
        } catch (o_error) {
            await Deno.remove(s_temp, { recursive: true }).catch(() => {});
            throw o_error;
        }
        return o_saved;
    };
    let f_tag = async function (s_id, s_quality) {
        if (!['unrated', 'bad', 'medium', 'good'].includes(s_quality)) throw new Error('Invalid quality');
        let o_sample = await f_read(s_id);
        o_sample.s_quality = s_quality;
        let s_temp = `${f_s_path(s_id)}/${crypto.randomUUID()}.tmp`;
        try {
            await Deno.writeTextFile(s_temp, JSON.stringify(o_sample, null, 2));
            await Deno.rename(s_temp, `${f_s_path(s_id)}/metadata.json`);
        } finally {
            await Deno.remove(s_temp).catch(() => {});
        }
        return o_sample;
    };
    let f_image = (s_id) => Deno.readFile(`${f_s_path(s_id)}/image.png`);
    let f_delete = (s_id) => Deno.remove(f_s_path(s_id), { recursive: true });
    return { f_list, f_save, f_tag, f_image, f_delete };
};

// Stream an uncompressed POSIX tar: one stable class mapping for the entire export.
let f_o_export = function (o_store) {
    let o_encoder = new TextEncoder();
    let f_a_n_header = function (s_name, n_size) {
        let a_n = new Uint8Array(512);
        let f_write = (s, n_at) => a_n.set(o_encoder.encode(s), n_at);
        f_write(s_name, 0);
        f_write('0000644\0', 100);
        f_write('0000000\0', 108);
        f_write('0000000\0', 116);
        f_write(n_size.toString(8).padStart(11, '0') + '\0', 124);
        f_write('00000000000\0', 136);
        f_write('        ', 148);
        f_write('0', 156);
        f_write('ustar\0', 257);
        f_write('00', 263);
        f_write(a_n.reduce((n_sum, n) => n_sum + n, 0).toString(8).padStart(6, '0') + '\0 ', 148);
        return a_n;
    };
    let f_a_chunk = async function* () {
        let a_o_sample = await o_store.f_list();
        let a_s_label = [...new Set(a_o_sample.flatMap((o) => o.a_o_box.map((o_box) => o_box.s_label)))]
            .sort();
        let f_a_file = function* (s_name, v_data) {
            let a_n = typeof v_data === 'string' ? o_encoder.encode(v_data) : v_data;
            yield f_a_n_header(s_name, a_n.length);
            yield a_n;
            if (a_n.length % 512) yield new Uint8Array(512 - a_n.length % 512);
        };
        yield* f_a_file('classes.txt', a_s_label.join('\n') + '\n');
        yield* f_a_file(
            'metadata.json',
            JSON.stringify({ n_version: 1, o_dataset: o_store.o_dataset, a_s_label, a_o_sample }, null, 2),
        );
        for (let o_sample of a_o_sample) {
            yield* f_a_file(`images/${o_sample.s_id}.png`, await o_store.f_image(o_sample.s_id));
            yield* f_a_file(`labels/${o_sample.s_id}.txt`, f_s_yolo(o_sample.a_o_box, a_s_label));
        }
        yield new Uint8Array(1024);
    };
    let o_iterator = f_a_chunk();
    return new ReadableStream({
        pull: async function (o_controller) {
            try {
                let o_next = await o_iterator.next();
                if (o_next.done) o_controller.close();
                else o_controller.enqueue(o_next.value);
            } catch (o_error) {
                o_controller.error(o_error);
            }
        },
        cancel: () => o_iterator.return(),
    });
};
let o_catalog__default;
let f_o_training_response = async function (o_request, o_catalog) {
    let o_url = new URL(o_request.url);
    let s_action = o_url.pathname.slice('/api/training/'.length);
    let s_id = o_url.searchParams.get('id') || '';
    try {
        if (!o_catalog) {
            if (!o_catalog__default) {
                let { f_o_dataset_catalog } = await import('./training_dataset.module.js');
                o_catalog__default = f_o_dataset_catalog();
            }
            o_catalog = o_catalog__default;
        }
        if (s_action === 'dataset/list' && o_request.method === 'GET') {
            return Response.json(await o_catalog.f_list());
        }
        if (s_action === 'dataset/create' && o_request.method === 'POST') {
            return Response.json(await o_catalog.f_create((await o_request.json()).s_name), { status: 201 });
        }
        let o_store = await o_catalog.f_store(o_url.searchParams.get('dataset') || 'default');
        if (s_action === 'list' && o_request.method === 'GET') return Response.json(await o_store.f_list());
        if (s_action === 'image' && o_request.method === 'GET') {
            return new Response(await o_store.f_image(s_id), { headers: { 'content-type': 'image/png' } });
        }
        if (s_action === 'export' && o_request.method === 'GET') {
            return new Response(f_o_export(o_store), {
                headers: {
                    'content-type': 'application/x-tar',
                    'content-disposition': 'attachment; filename="training-data.tar"',
                },
            });
        }
        if (s_action === 'save' && o_request.method === 'POST') {
            let o_form = await o_request.formData();
            let o_image = o_form.get('image');
            if (!(o_image instanceof File) || o_image.size > 50 * 1024 * 1024) {
                throw new Error('Missing image or image exceeds 50 MB');
            }
            return Response.json(
                await o_store.f_save(
                    JSON.parse(o_form.get('metadata')),
                    new Uint8Array(await o_image.arrayBuffer()),
                ),
            );
        }
        if (s_action === 'tag' && o_request.method === 'POST') {
            return Response.json(await o_store.f_tag(s_id, (await o_request.json()).s_quality));
        }
        if (s_action === 'delete' && o_request.method === 'DELETE') {
            await o_store.f_delete(s_id);
            return Response.json({ b_deleted: true });
        }
        return new Response('Unknown training operation', { status: 404 });
    } catch (o_error) {
        return Response.json({ s_error: o_error.message }, {
            status: o_error instanceof Deno.errors.NotFound ? 404 : 400,
        });
    }
};
export { f_o_export, f_o_training_response, f_o_training_store };
