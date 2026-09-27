import { f_o_dataset_catalog } from './training_dataset.module.js';
import { f_o_yolo_model_store } from './yolo_model_store.module.js';
import { f_s_yolo, f_validate_sample } from './webserved_dir/training_data.module.js';

let f_o_yolo_split = function (a_o_sample) {
    a_o_sample = a_o_sample.filter((o) => o.s_quality !== 'bad');
    if (!a_o_sample.length) {
        throw new Error('Save annotated images before fine-tuning (bad-quality images are excluded).');
    }
    let o_group = new Map();
    for (let o_sample of a_o_sample) {
        f_validate_sample(o_sample);
        let o_pos = o_sample.o_position;
        let s_group = o_pos && Number.isFinite(o_pos.x) && Number.isFinite(o_pos.y)
            ? JSON.stringify([
                o_sample.s_device || '',
                [o_sample.o_axis?.x, o_sample.o_axis?.y],
                o_pos.x,
                o_pos.y,
            ])
            : o_sample.o_region
            ? JSON.stringify([o_sample.o_region.s_grid, o_sample.o_region.n_idx])
            : o_sample.s_set || o_sample.s_id;
        if (!o_group.has(s_group)) o_group.set(s_group, []);
        o_group.get(s_group).push(o_sample);
    }
    if (o_group.size < 2) {
        throw new Error(
            'Capture at least two different XY regions for separate training and validation data.',
        );
    }
    let a_s_label = [...new Set(a_o_sample.flatMap((o) => o.a_o_box.map((b) => b.s_label)))].sort();
    let a_o_group = [...o_group.entries()].sort(([a], [b]) => a.localeCompare(b)).map((
        [s_group, a_o_sample],
    ) => ({ s_group, a_o_sample: a_o_sample.toSorted((a, b) => a.s_id.localeCompare(b.s_id)) }));
    let o_count = new Map(
        a_s_label.map((s) => [
            s,
            a_o_group.filter((o) => o.a_o_sample.some((a) => a.a_o_box.some((b) => b.s_label === s))).length,
        ]),
    );
    let a_o_val = [], a_o_train = [];
    let n_val = Math.max(1, Math.round(a_o_group.length * .2));
    for (let o of a_o_group) {
        let a_s_present = [...new Set(o.a_o_sample.flatMap((s) => s.a_o_box.map((b) => b.s_label)))];
        if (a_o_val.length < n_val && a_s_present.every((s) => o_count.get(s) > 1)) {
            a_o_val.push(o);
            for (let s of a_s_present) o_count.set(s, o_count.get(s) - 1);
        } else a_o_train.push(o);
    }
    if (!a_o_val.length) {
        throw new Error(
            'Capture more regions with repeated labels so every label can remain in training while holding out a validation region.',
        );
    }
    return { a_s_label, a_o_train, a_o_val };
};
let f_o_yolo_config = function (o = {}) {
    let n_epoch = o.n_epoch ?? 50, n_size = o.n_size ?? 640;
    if (!Number.isInteger(n_epoch) || n_epoch < 1 || n_epoch > 500) throw new Error('Use 1–500 epochs');
    if (!Number.isInteger(n_size) || n_size < 64 || n_size > 1280 || n_size % 32) {
        throw new Error('Image size must be a multiple of 32 between 64 and 1280');
    }
    return { n_epoch, n_size };
};
let f_o_yolo_service = function (
    {
        s_root = Deno.cwd(),
        o_catalog = f_o_dataset_catalog(`${s_root}/training_data`),
        s_python = `${s_root}/venv_yolo/bin/python3`,
        s_worker = `${s_root}/yolo_worker.py`,
    } = {},
) {
    let s_folder = `${s_root}/weights/yolo`, o_job = null, o_child = null, o_probe = null;
    let o_model_store = f_o_yolo_model_store(s_folder);
    let f_busy = () => ['preparing', 'running', 'cancelling', 'publishing'].includes(o_job?.s_status);
    let f_check = () => {
        if (o_job?.b_cancel) throw new Error('YOLO job cancelled');
    };
    let f_ready = async () => {
        if (!o_probe) {
            o_probe = (async () => {
                try {
                    await Deno.mkdir(`${s_folder}/config`, { recursive: true });
                    let o = await new Deno.Command(s_python, {
                        env: { YOLO_CONFIG_DIR: `${s_folder}/config` },
                        args: ['-c', 'import ultralytics, torch, torchvision'],
                        stdout: 'null',
                        stderr: 'piped',
                    }).output();
                    return o.success;
                } catch {
                    return false;
                }
            })();
        }
        let b_ready = await o_probe;
        if (!b_ready) o_probe = null;
        return b_ready;
    };
    let f_status = async (s_dataset = 'default') => {
        await o_catalog.f_read(s_dataset);
        let a_o_model = await o_model_store.f_list(s_dataset);
        return {
            b_ready: await f_ready(),
            a_o_model,
            o_model: a_o_model[0] || null,
            o_job: o_job ? JSON.parse(JSON.stringify(o_job)) : null,
        };
    };
    let f_log = (s) => {
        if (!s) return;
        o_job.a_s_log.push(s.slice(-1000));
        if (o_job.a_s_log.length > 30) o_job.a_s_log.shift();
    };
    let f_pipe = async (o_stream) => {
        let s_pending = '';
        for await (let s_text of o_stream.pipeThrough(new TextDecoderStream())) {
            s_pending += s_text;
            let a_s_line = s_pending.split(/[\r\n]/);
            s_pending = a_s_line.pop();
            for (let s_line of a_s_line) {
                try {
                    let o = JSON.parse(s_line);
                    if (o.s_type === 'progress') {
                        o_job.n_epoch = o.n_epoch;
                        o_job.n_epoch_total = o.n_epoch_total;
                    } else f_log(s_line);
                } catch {
                    f_log(s_line);
                }
            }
            if (s_pending.length > 4000) {
                f_log(s_pending);
                s_pending = '';
            }
        }
        f_log(s_pending);
    };
    let f_spawn = function (s_run, o_config) {
        f_check();
        o_child = new Deno.Command(s_python, {
            args: ['-u', s_worker, `${s_run}/job.json`],
            cwd: s_root,
            env: { YOLO_CONFIG_DIR: `${s_folder}/config`, OMP_NUM_THREADS: '2' },
            stdin: 'null',
            stdout: 'piped',
            stderr: 'piped',
        }).spawn();
        let o_current = o_child;
        o_job.s_status = 'running';
        // Await both streams and process completion before allowing another job.
        o_job.o_result = null;
        let f_complete = async () => {
            try {
                let [o_exit] = await Promise.all([
                    o_current.status,
                    f_pipe(o_current.stdout),
                    f_pipe(o_current.stderr),
                ]);
                f_check();
                if (!o_exit.success) {
                    throw new Error(
                        `YOLO exited with code ${o_exit.code}. ${o_job.a_s_log.slice(-3).join(' ')}`,
                    );
                }
                let o_result = JSON.parse(await Deno.readTextFile(`${s_run}/result.json`));
                if (o_config.s_kind === 'train') {
                    await Deno.stat(`${s_run}/model/weights/best.pt`);
                    f_check();
                    let o_model = {
                        s_id: o_job.s_id,
                        n_ts_ms: Date.now(),
                        a_s_label: o_config.a_s_label,
                        n_epoch: o_config.n_epoch,
                        n_size: o_config.n_size,
                        n_train: o_config.n_train,
                        n_val: o_config.n_val,
                        s_dataset: o_config.s_dataset,
                        s_name: o_config.s_name,
                        s_parent: o_config.s_parent || null,
                        s_base: o_config.s_parent || 'yolo11n.pt',
                        o_metric: o_result.o_metric || {},
                    };
                    f_check();
                    o_job.s_status = 'publishing';
                    await o_model_store.f_publish(o_model);
                }
                o_job.o_result = o_result;
                o_job.s_status = 'done';
            } catch (o_error) {
                o_job.s_status = o_job.b_cancel ? 'cancelled' : 'error';
                o_job.s_error = o_error.message;
            } finally {
                o_child = null;
            }
        };
        // f_complete handles all failures; this promise is also exposed to tests.
        return f_complete();
    };
    let o_completion = Promise.resolve();
    let f_begin = async function (s_kind, s_dataset, f_prepare) {
        if (f_busy()) throw new Error('A YOLO job is already running');
        o_job = {
            s_id: crypto.randomUUID(),
            s_kind,
            s_dataset,
            s_status: 'preparing',
            s_error: '',
            n_epoch: 0,
            n_epoch_total: 0,
            a_s_log: [],
            b_cancel: false,
        };
        try {
            o_job.s_dataset_name = (await o_catalog.f_read(s_dataset)).s_name;
            if (!await f_ready()) throw new Error('YOLO support is missing. Run: deno task install-yolo');
            f_check();
            let s_run = `${s_folder}/run/${o_job.s_id}`;
            await Deno.mkdir(s_run, { recursive: true });
            let o_config = await f_prepare(s_run);
            f_check();
            await Deno.writeTextFile(`${s_run}/job.json`, JSON.stringify(o_config, null, 2));
            f_check();
            o_completion = f_spawn(s_run, o_config);
            return { s_id: o_job.s_id };
        } catch (o_error) {
            o_job.s_status = o_job.b_cancel ? 'cancelled' : 'error';
            o_job.s_error = o_error.message;
            throw o_error;
        }
    };
    let f_train = (o_option = {}) =>
        f_begin('train', o_option.s_dataset || 'default', async (s_run) => {
            let s_dataset = o_option.s_dataset || 'default';
            let o_store = await o_catalog.f_store(s_dataset);
            let s_name = o_option.s_name === undefined ? 'YOLO ' + new Date().toISOString() : o_option.s_name;
            if (typeof s_name !== 'string' || !s_name.trim() || s_name.length > 100) {
                throw new Error('Enter a model name (1–100 characters)');
            }
            let o_config = f_o_yolo_config(o_option);
            let o_split = f_o_yolo_split(await o_store.f_list());
            let o_parent = o_option.s_model ? await o_model_store.f_read(s_dataset, o_option.s_model) : null;
            if (o_parent && JSON.stringify(o_parent.a_s_label) !== JSON.stringify(o_split.a_s_label)) {
                throw new Error(
                    'Labels have changed. Start from pretrained YOLO to build the new class mapping.',
                );
            }
            let a_o_snapshot = [];
            for (let [s_split, a_o_group] of [['train', o_split.a_o_train], ['val', o_split.a_o_val]]) {
                await Deno.mkdir(`${s_run}/dataset/images/${s_split}`, { recursive: true });
                await Deno.mkdir(`${s_run}/dataset/labels/${s_split}`, { recursive: true });
                for (let o_group of a_o_group) {
                    for (let o_sample of o_group.a_o_sample) {
                        f_check();
                        await Deno.writeFile(
                            `${s_run}/dataset/images/${s_split}/${o_sample.s_id}.png`,
                            await o_store.f_image(o_sample.s_id),
                        );
                        await Deno.writeTextFile(
                            `${s_run}/dataset/labels/${s_split}/${o_sample.s_id}.txt`,
                            f_s_yolo(o_sample.a_o_box, o_split.a_s_label),
                        );
                        a_o_snapshot.push({ ...o_sample, s_split, s_group: o_group.s_group });
                    }
                }
            }
            await Deno.writeTextFile(`${s_run}/dataset/metadata.json`, JSON.stringify(a_o_snapshot, null, 2));
            // JSON is valid YAML; quoting labels this way avoids YAML injection.
            await Deno.writeTextFile(
                `${s_run}/dataset/data.yaml`,
                JSON.stringify({
                    path: `${s_run}/dataset`,
                    train: 'images/train',
                    val: 'images/val',
                    names: o_split.a_s_label,
                }),
            );
            return {
                ...o_config,
                s_kind: 'train',
                s_run,
                s_base: o_parent
                    ? `${s_folder}/run/${o_parent.s_id}/model/weights/best.pt`
                    : `${s_folder}/yolo11n.pt`,
                s_dataset,
                s_name: s_name.trim(),
                s_parent: o_parent?.s_id || null,
                a_s_label: o_split.a_s_label,
                n_train: a_o_snapshot.filter((o) => o.s_split === 'train').length,
                n_val: a_o_snapshot.filter((o) => o.s_split === 'val').length,
            };
        });
    let f_infer = (a_n_image, n_confidence = .25, o_option = {}) =>
        f_begin('infer', o_option.s_dataset || 'default', async (s_run) => {
            if (!Number.isFinite(n_confidence) || n_confidence < .01 || n_confidence > 1) {
                throw new Error('Confidence must be between 0.01 and 1');
            }
            if (
                a_n_image.length > 50 * 1024 * 1024 || a_n_image.length < 24 ||
                ![137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => a_n_image[i] === n)
            ) throw new Error('Expected a PNG image up to 50 MB');
            let o_model = await o_model_store.f_read(o_option.s_dataset || 'default', o_option.s_model);
            await Deno.writeFile(`${s_run}/frame.png`, a_n_image);
            return {
                s_kind: 'infer',
                s_dataset: o_option.s_dataset || 'default',
                s_run,
                n_confidence,
                s_model: `${s_folder}/run/${o_model.s_id}/model/weights/best.pt`,
                s_model_id: o_model.s_id,
                n_size: o_model.n_size,
            };
        });
    let f_cancel = function (s_dataset) {
        if (s_dataset && f_busy() && o_job.s_dataset !== s_dataset) {
            throw new Error('The running YOLO job belongs to another dataset');
        }
        if (!f_busy() || o_job.s_status === 'publishing') return;
        o_job.b_cancel = true;
        o_job.s_status = 'cancelling';
        // No training subprocesses: one device, data-loader workers=0.
        if (o_child) {
            try {
                o_child.kill('SIGKILL');
            } catch { /* already exited */ }
        }
    };
    return { f_status, f_train, f_infer, f_cancel, f_done: () => o_completion };
};
let o_service = f_o_yolo_service();
let f_o_yolo_response = async function (o_request, o_target = o_service) {
    let o_url = new URL(o_request.url);
    let s_action = o_url.pathname.split('/').at(-1),
        s_dataset = o_url.searchParams.get('dataset') || 'default';
    try {
        if (s_action === 'status' && o_request.method === 'GET') {
            return Response.json(await o_target.f_status(s_dataset));
        }
        if (s_action === 'train' && o_request.method === 'POST') {
            return Response.json(await o_target.f_train({ ...await o_request.json(), s_dataset }), {
                status: 202,
            });
        }
        if (s_action === 'infer' && o_request.method === 'POST') {
            let o_form = await o_request.formData(), o_image = o_form.get('image');
            if (!(o_image instanceof File) || o_image.size > 50 * 1024 * 1024) {
                throw new Error('Missing PNG image or image exceeds 50 MB');
            }
            return Response.json(
                await o_target.f_infer(
                    new Uint8Array(await o_image.arrayBuffer()),
                    Number(o_form.get('confidence') ?? .25),
                    { s_dataset, s_model: o_form.get('model') || undefined },
                ),
                { status: 202 },
            );
        }
        if (s_action === 'cancel' && o_request.method === 'POST') {
            o_target.f_cancel(s_dataset);
            return Response.json({ b_cancelled: true });
        }
        return new Response('Unknown YOLO operation', { status: 404 });
    } catch (o_error) {
        return Response.json({ s_error: o_error.message }, { status: 400 });
    }
};
if (typeof addEventListener === 'function') addEventListener('unload', () => o_service.f_cancel());
export { f_o_yolo_config, f_o_yolo_response, f_o_yolo_service, f_o_yolo_split };
