import { f_o_scan_jobs } from './scan_jobs.module.js';
import { f_o_yolo_response } from './yolo_functions.module.js';
import { f_o_training_response } from './training_data_functions.module.js';

import {
    f_db_delete_table_data,
    f_init_db,
    f_v_crud__indb,
} from "./database_functions.module.js";
import {
    a_o_model,
    f_o_model__from_s_name_table,
    f_o_model_instance,
    o_model__o_wsclient,
    a_o_sfunexposed,
    f_s_name_table__from_o_model,
    f_o_wsmsg,
    f_o_toast,
} from "./webserved_dir/constructors.module.js";
import {
    s_ds,
    s_root_dir,
} from "./runtimedata.module.js";
import {
    f_o_detect_esp_usb,
    f_o_check_arduino_cli,
    f_compile_esp,
} from "./flash_functions.module.js";
import {
    f_o_stitch_run,
} from "./stitch_functions.module.js";
import {
    f_o_focus_stack_run,
} from "./focus_stack_functions.module.js";
import {
    f_o_locate_start,
    f_o_locate_stop,
    f_o_locate_status,
    f_o_locate_list_maps,
    f_s_locate_save_frame,
} from "./locate_map.module.js";
import {
    f_o_cellpose_start,
    f_cellpose_stop,
    f_o_cellpose_status,
    f_s_cellpose_save_frame,
    f_o_cellpose_infer,
} from "./cellpose_functions.module.js";
import {
    f_o_recording_create,
    f_recording_write_manifest,
    f_recording_read_manifest,
    f_recording_append_frame,
    f_a_o_recording_frame,
    f_recording_write_frame,
    f_recording_append_blob,
    f_recording_remux,
    f_o_disk__free,
    f_o_recording_encode,
    f_o_recording_tiff,
    f_a_o_recording__list,
    f_recording_delete,
    f_recording_mark_interrupted,
    f_o_camera__probe,
    f_ensure_recording_dir,
} from "./recording_functions.module.js";

// ─── CLI args ───────────────────────────────────────────────────────

let n_port = 8000;
let s_ip__esp = '';
let s_path_db = '';

let a_s_arg = Deno.args;
for(let n_idx = 0; n_idx < a_s_arg.length; n_idx++){
    if(a_s_arg[n_idx] === '--port' && a_s_arg[n_idx + 1]){
        n_port = parseInt(a_s_arg[n_idx + 1], 10);
        n_idx++;
    }
    if(a_s_arg[n_idx] === '--esp' && a_s_arg[n_idx + 1]){
        s_ip__esp = a_s_arg[n_idx + 1];
        n_idx++;
    }
    if(a_s_arg[n_idx] === '--db' && a_s_arg[n_idx + 1]){
        s_path_db = a_s_arg[n_idx + 1];
        n_idx++;
    }
}

// ─── Database ───────────────────────────────────────────────────────

await f_init_db(s_path_db || undefined);

// a recording left "running" by a crash or a power cut must not look alive
let f_update_status__recording = async function(s_path_folder, s_status){
    let a_o_row = await f_v_crud__indb('read', 'a_o_recording', { s_path_folder });
    if(a_o_row && a_o_row.length > 0){
        await f_v_crud__indb('update', 'a_o_recording', { n_id: a_o_row[0].n_id }, { s_status, n_ts_ms__end: Date.now() });
    }
};
await f_ensure_recording_dir();
await f_recording_mark_interrupted(f_update_status__recording);

// ─── Content type detection ─────────────────────────────────────────

let f_s_content_type = function(s_path) {
    if (s_path.endsWith('.html')) return 'text/html';
    if (s_path.endsWith('.js')) return 'application/javascript';
    if (s_path.endsWith('.css')) return 'text/css';
    if (s_path.endsWith('.json')) return 'application/json';
    if (s_path.endsWith('.png')) return 'image/png';
    if (s_path.endsWith('.jpg') || s_path.endsWith('.jpeg')) return 'image/jpeg';
    if (s_path.endsWith('.gif')) return 'image/gif';
    if (s_path.endsWith('.svg')) return 'image/svg+xml';
    if (s_path.endsWith('.ico')) return 'image/x-icon';
    if (s_path.endsWith('.webp')) return 'image/webp';
    if (s_path.endsWith('.mp4')) return 'video/mp4';
    if (s_path.endsWith('.webm')) return 'video/webm';
    if (s_path.endsWith('.jsonl')) return 'application/x-ndjson';
    return 'application/octet-stream';
};

// ─── Capture folder helper ──────────────────────────────────────────
// Resolve a capture folder: use an explicit target folder when the caller
// provides one, otherwise fall back to a timestamped folder under scans/
// (the pre-project behaviour). The project/slide UI will pass the slide's
// map__primary/ (or capture/) folder as the target.

let f_s_path_folder__capture = function(s_prefix, s_path_target) {
    if(typeof s_path_target === 'string' && s_path_target !== ''){
        return s_path_target;
    }
    let o_date = new Date();
    let f_s_pad = function(n){ return String(n).padStart(2, '0'); };
    let s_name_folder = s_prefix
        + o_date.getFullYear() + '-'
        + f_s_pad(o_date.getMonth() + 1) + '-'
        + f_s_pad(o_date.getDate()) + '_'
        + f_s_pad(o_date.getHours())
        + f_s_pad(o_date.getMinutes())
        + f_s_pad(o_date.getSeconds());
    return s_root_dir + s_ds + 'scans' + s_ds + s_name_folder;
};

// Jobs belong to the server, so closing a browser does not stop stitching.
const o_scan_jobs = f_o_scan_jobs({
    s_root: s_root_dir + s_ds + 'scans',
    f_run: f_o_stitch_run,
    f_complete: async function(job) {
        if (!job.n_id__slide) return;
        const maps = await f_v_crud__indb('read', 'a_o_map', { n_o_slide_n_id: job.n_id__slide });
        for (const map of maps || []) {
            if (map.b_primary) await f_v_crud__indb('update', 'a_o_map', { n_id: map.n_id }, { b_primary: false });
        }
        const data = { n_o_slide_n_id: job.n_id__slide, s_kind: 'scan',
            s_path_map: job.o_result.s_path_output, s_path_preview: job.o_result.s_path_preview || '',
            s_path_folder: job.s_path_folder, n_scl_x: 0, n_scl_y: 0, b_primary: true };
        const existing = (maps || []).find(map => map.s_path_folder === job.s_path_folder);
        if (existing) await f_v_crud__indb('update', 'a_o_map', { n_id: existing.n_id }, data);
        else await f_v_crud__indb('create', 'a_o_map', data);
    },
});
await o_scan_jobs.f_init();

// ─── Request handler ────────────────────────────────────────────────

let f_handler = async function(o_request, o_conninfo) {

    // ── Canonical host redirect: 127.0.0.1 → localhost ─────────────
    // Web Serial (and other secure-context APIs) are only exposed on a
    // secure origin; Chrome treats 'localhost' as secure. Redirect any
    // plain-HTTP request arriving on 127.0.0.1 to the same URL on localhost.
    // WebSocket upgrades are left untouched (they follow the page origin).
    let b_upgrade__websocket = o_request.headers.get('upgrade') === 'websocket';
    if (!b_upgrade__websocket) {
        let o_url__redirect = new URL(o_request.url);
        if (o_url__redirect.hostname === '127.0.0.1') {
            o_url__redirect.hostname = 'localhost';
            return new Response(null, {
                status: 302,
                headers: { 'location': o_url__redirect.toString() },
            });
        }
    }

    // ── WebSocket upgrade ───────────────────────────────────────────
    if (b_upgrade__websocket) {
        // read headers BEFORE upgrading: after Deno.upgradeWebSocket the inner
        // request is closed and any further headers.get() throws 'Request closed'
        let s_ip = o_request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            || o_conninfo.remoteAddr.hostname;

        let { socket: o_socket, response: o_response } = Deno.upgradeWebSocket(o_request);


        let o_wsclient = f_o_model_instance(
            o_model__o_wsclient,
            { s_ip }
        );
        let s_name_table__wsclient = f_s_name_table__from_o_model(o_model__o_wsclient);
        let o_wsclient_db = f_v_crud__indb(
            'read',
            s_name_table__wsclient,
            o_wsclient
        )?.at(0);
        if(!o_wsclient_db){
            o_wsclient_db = f_v_crud__indb(
                'create',
                s_name_table__wsclient,
                o_wsclient,
                true
            );
        }

        o_socket.onopen = async function() {
            console.log('websocket connected');
            // send init message with ESP IP from CLI
            o_socket.send(JSON.stringify({
                s_type: 'init',
                s_root_dir: s_root_dir,
                s_ip__esp: s_ip__esp,
            }));

            // send all model data
            for(let o_model of a_o_model){
                o_socket.send(JSON.stringify({
                    o_model: o_model,
                    v_data: (await f_v_crud__indb(
                            'read',
                            f_s_name_table__from_o_model(o_model)
                        )
                    )
                }));
            }
        };

        o_socket.onmessage = async function(o_evt) {
            let o_data = JSON.parse(o_evt.data);

            // uniform response for the plain message handlers below
            let f_send_result = async function(s_label, f_run){
                try {
                    let v_result = await f_run();
                    o_socket.send(JSON.stringify({ v_result, s_uuid: o_data.s_uuid }));
                } catch (o_error) {
                    console.error(s_label + ' error:', o_error);
                    o_socket.send(JSON.stringify({ error: o_error.message, s_uuid: o_data.s_uuid }));
                }
            };

            let o_sfunexposed = a_o_sfunexposed.find(function(o){ return o.s_name === o_data.s_type; });
            if(o_sfunexposed){
                try {
                    let a_v_arg = Array.isArray(o_data.v_data) ? o_data.v_data : [];
                    let AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
                    let f = new AsyncFunction('f_v_crud__indb', 'f_o_model__from_s_name_table', 'f_delete_table_data', 'Deno', '...a_v_arg', o_sfunexposed.s_f);
                    let v_result = await f(f_v_crud__indb, f_o_model__from_s_name_table, f_db_delete_table_data, Deno, ...a_v_arg);
                    o_socket.send(JSON.stringify({
                        v_result,
                        s_uuid: o_data.s_uuid,
                    }));
                } catch (o_error) {
                    console.error('Error in exposed function:', o_sfunexposed.s_name, o_error);
                    o_socket.send(JSON.stringify({ error: o_error.message, s_uuid: o_data.s_uuid }));
                    o_socket.send(JSON.stringify(
                        f_o_wsmsg(
                            'toast',
                            f_o_toast(
                                `${o_sfunexposed.s_name}: ${o_error.message}`,
                                'error',
                                Date.now(),
                                8000
                            )
                        )
                    ));
                }
            }
            if(o_data.s_type === 'hello_from_client'){
                o_socket.send(JSON.stringify({
                    s_type: 'hello_from_server',
                    v_data: { s_message: 'Hello from server!' },
                    s_uuid: o_data.s_uuid,
                }))
            }

            // ── Flash-related message handlers ──────────────────────
            if(o_data.s_type === 'check_arduino_cli'){
                let o_result = await f_o_check_arduino_cli();
                o_socket.send(JSON.stringify({
                    s_type: 'check_arduino_cli_result',
                    v_data: o_result,
                    s_uuid: o_data.s_uuid,
                }));
            }

            if(o_data.s_type === 'detect_esp_usb'){
                let o_result = await f_o_detect_esp_usb();
                o_socket.send(JSON.stringify({
                    s_type: 'detect_esp_usb_result',
                    v_data: o_result,
                    s_uuid: o_data.s_uuid,
                }));
            }

            // ── Scan folder creation ─────────────────────────────
            if(o_data.s_type === 'scan_create_folder'){
                try {
                    let s_path_folder = f_s_path_folder__capture(
                        'scan_',
                        o_data.v_data && o_data.v_data.s_path_folder
                    );
                    if (!o_data.v_data?.s_path_folder) s_path_folder += '_' + crypto.randomUUID().slice(0, 8);
                    await Deno.mkdir(s_path_folder, { recursive: true });
                    await Deno.mkdir(s_path_folder + s_ds + 'dowscaled', { recursive: true });
                    await o_scan_jobs.f_create(s_path_folder, o_data.v_data?.n_id__slide || 0,
                        o_data.v_data?.b_live_scan ? { ...o_data.v_data.o_option, b_live_scan: true } : {});
                    o_socket.send(JSON.stringify({
                        v_result: { s_path_folder: s_path_folder },
                        s_uuid: o_data.s_uuid,
                    }));
                } catch (o_error) {
                    console.error('scan_create_folder error:', o_error);
                    o_socket.send(JSON.stringify({
                        error: o_error.message,
                        s_uuid: o_data.s_uuid,
                    }));
                }
            }

            // ── Recording (time-lapse / video sessions) ───────────
            if(o_data.s_type === 'recording_create_folder'){
                await f_send_result('recording_create_folder', function(){
                    return f_o_recording_create({
                        s_prefix: (o_data.v_data && o_data.v_data.s_prefix) || 'rec_',
                        s_path_folder: o_data.v_data && o_data.v_data.s_path_folder,
                        n_cnt__position: o_data.v_data && o_data.v_data.n_cnt__position,
                    });
                });
            }

            if(o_data.s_type === 'recording_write_manifest'){
                await f_send_result('recording_write_manifest', function(){
                    return f_recording_write_manifest(o_data.v_data.s_path_folder, o_data.v_data.o_manifest);
                });
            }

            if(o_data.s_type === 'recording_read_manifest'){
                await f_send_result('recording_read_manifest', function(){
                    return f_recording_read_manifest(o_data.v_data.s_path_folder);
                });
            }

            if(o_data.s_type === 'recording_append_frame'){
                await f_send_result('recording_append_frame', function(){
                    return f_recording_append_frame(o_data.v_data.s_path_folder, o_data.v_data.o_frame, o_data.v_data.s_file);
                });
            }

            if(o_data.s_type === 'recording_read_frame'){
                await f_send_result('recording_read_frame', async function(){
                    let a_o_frame = await f_a_o_recording_frame(o_data.v_data.s_path_folder);
                    return { a_o_frame };
                });
            }

            if(o_data.s_type === 'recording_status'){
                await f_send_result('recording_status', function(){
                    return f_o_disk__free();
                });
            }

            if(o_data.s_type === 'recording_encode'){
                await f_send_result('recording_encode', function(){
                    return f_o_recording_encode({
                        s_path_folder: o_data.v_data.s_path_folder,
                        n_fps: o_data.v_data.n_fps,
                    });
                });
            }

            if(o_data.s_type === 'recording_tiff'){
                await f_send_result('recording_tiff', function(){
                    return f_o_recording_tiff({
                        s_path_folder: o_data.v_data.s_path_folder,
                        s_pos: o_data.v_data.s_pos,
                        s_name__out: o_data.v_data.s_name__out,
                        n_sec__interval: o_data.v_data.n_sec__interval,
                        n_um__per_px: o_data.v_data.n_um__per_px,
                    });
                });
            }

            if(o_data.s_type === 'recording_remux'){
                await f_send_result('recording_remux', function(){
                    return f_recording_remux({
                        s_path_folder: o_data.v_data.s_path_folder,
                        s_name__src: o_data.v_data.s_name__src,
                        s_name__out: o_data.v_data.s_name__out,
                    });
                });
            }

            if(o_data.s_type === 'recording_list'){
                await f_send_result('recording_list', async function(){
                    return { a_o_recording: await f_a_o_recording__list() };
                });
            }

            if(o_data.s_type === 'recording_delete'){
                await f_send_result('recording_delete', function(){
                    return f_recording_delete(o_data.v_data.s_path_folder);
                });
            }

            if(o_data.s_type === 'recording_probe_camera'){
                await f_send_result('recording_probe_camera', function(){
                    return f_o_camera__probe();
                });
            }

            // ── Manual stitch folder creation ─────────────────────
            if(o_data.s_type === 'manual_stitch_create_folder'){
                try {
                    let s_path_folder = f_s_path_folder__capture(
                        'manual_stitch_',
                        o_data.v_data && o_data.v_data.s_path_folder
                    );
                    await Deno.mkdir(s_path_folder, { recursive: true });
                    o_socket.send(JSON.stringify({
                        v_result: { s_path_folder: s_path_folder },
                        s_uuid: o_data.s_uuid,
                    }));
                } catch (o_error) {
                    console.error('manual_stitch_create_folder error:', o_error);
                    o_socket.send(JSON.stringify({
                        error: o_error.message,
                        s_uuid: o_data.s_uuid,
                    }));
                }
            }

            // ── Manual stitch run ────────────────────────────────
            if(o_data.s_type === 'manual_stitch_run'){
                try {
                    let s_path_folder = o_data.v_data.s_path_folder;
                    let b_row_by_row = o_data.v_data.b_row_by_row || false;
                    let s_path_output = s_path_folder + s_ds + 'stitched.jpg';
                    let s_path_script = s_root_dir + s_ds + 'stich_image_in_folder.py';

                    let a_s_arg_script = [s_path_script, s_path_output, s_path_folder];
                    if(b_row_by_row){
                        a_s_arg_script.push('--row-by-row');
                    }

                    let s_path_python = s_root_dir + s_ds + 'venv' + s_ds + 'bin' + s_ds + 'python3';
                    let o_command = new Deno.Command(s_path_python, {
                        args: a_s_arg_script,
                        stdout: 'piped',
                        stderr: 'piped',
                    });
                    let o_child = await o_command.output();
                    let s_stdout = new TextDecoder().decode(o_child.stdout);
                    let s_stderr = new TextDecoder().decode(o_child.stderr);

                    if(s_stderr){
                        console.error('stitch stderr:', s_stderr);
                    }

                    let o_result;
                    try {
                        o_result = JSON.parse(s_stdout);
                    } catch {
                        o_result = { b_success: false, s_error: 'failed to parse stitch output: ' + s_stdout };
                    }

                    o_socket.send(JSON.stringify({
                        v_result: o_result,
                        s_uuid: o_data.s_uuid,
                    }));
                } catch (o_error) {
                    console.error('manual_stitch_run error:', o_error);
                    o_socket.send(JSON.stringify({
                        v_result: { b_success: false, s_error: o_error.message },
                        s_uuid: o_data.s_uuid,
                    }));
                }
            }

            // ── Autostitch session creation ───────────────────
            if(o_data.s_type === 'autostitch_create_session'){
                try {
                    let s_name = o_data.v_data.s_name || 'autostitch';
                    let o_date = new Date();
                    let s_name_folder = s_name + '_'
                        + String(o_date.getMinutes()).padStart(2, '0')
                        + '_' + String(o_date.getHours()).padStart(2, '0')
                        + '_' + String(o_date.getDate()).padStart(2, '0')
                        + '_' + String(o_date.getMonth() + 1).padStart(2, '0')
                        + '_' + o_date.getFullYear();
                    let s_path_folder = s_root_dir + s_ds + 'scans' + s_ds + s_name_folder;
                    await Deno.mkdir(s_path_folder, { recursive: true });
                    o_socket.send(JSON.stringify({
                        v_result: { s_path_folder: s_path_folder, s_name_folder: s_name_folder },
                        s_uuid: o_data.s_uuid,
                    }));
                } catch (o_error) {
                    console.error('autostitch_create_session error:', o_error);
                    o_socket.send(JSON.stringify({
                        error: o_error.message,
                        s_uuid: o_data.s_uuid,
                    }));
                }
            }

            // ── Autostitch add image ─────────────────────────
            if(o_data.s_type === 'autostitch_add_image'){
                try {
                    let s_path_folder = o_data.v_data.s_path_folder;
                    let s_filename = o_data.v_data.s_filename;
                    let n_pct__min_extension = o_data.v_data.n_pct__min_extension || 5.0;

                    let s_path_base = s_path_folder + s_ds + 'base.jpg';
                    let s_path_new = s_path_folder + s_ds + s_filename;
                    let s_path_script = s_root_dir + s_ds + 'autostitch.py';
                    let s_path_python = s_root_dir + s_ds + 'venv' + s_ds + 'bin' + s_ds + 'python3';

                    let o_command = new Deno.Command(s_path_python, {
                        args: [
                            s_path_script,
                            s_path_base,
                            s_path_new,
                            '--min-extension-pct', String(n_pct__min_extension),
                        ],
                        stdout: 'piped',
                        stderr: 'piped',
                    });
                    let o_child = await o_command.output();
                    let s_stdout = new TextDecoder().decode(o_child.stdout);
                    let s_stderr = new TextDecoder().decode(o_child.stderr);

                    if(s_stderr){
                        console.error('autostitch stderr:', s_stderr);
                    }

                    // keep the last N diagnostic lines (they carry the timings)
                    let a_s_line__stderr = s_stderr.split('\n')
                        .map(s => s.trimEnd())
                        .filter(s => s && !/^\[ (WARN|ERROR|INFO)/.test(s))
                        .slice(-40);

                    let o_result;
                    try {
                        o_result = JSON.parse(s_stdout);
                    } catch {
                        // fall back to the last line that parses as JSON
                        o_result = null;
                        for(let s_line of s_stdout.trim().split('\n').reverse()){
                            try {
                                o_result = JSON.parse(s_line);
                                break;
                            } catch { /* not json */ }
                        }
                        if(!o_result){
                            o_result = { b_success: false, s_error: 'failed to parse autostitch output: ' + s_stdout };
                        }
                    }
                    if(o_result){
                        // prefer the full stderr diagnostics (they also carry
                        // lgsp_imerge's per-stage timings); fall back to the
                        // a_s_line embedded in the JSON result
                        o_result.a_s_line = (a_s_line__stderr.length
                            ? a_s_line__stderr
                            : (o_result.a_s_line || []));
                    }

                    o_socket.send(JSON.stringify({
                        v_result: o_result,
                        s_uuid: o_data.s_uuid,
                    }));
                } catch (o_error) {
                    console.error('autostitch_add_image error:', o_error);
                    o_socket.send(JSON.stringify({
                        v_result: { b_success: false, s_error: o_error.message },
                        s_uuid: o_data.s_uuid,
                    }));
                }
            }

            // Stitch requests acknowledge enqueue immediately; clients poll job state.
            if (o_data.s_type === 'scan_tile_ready') {
                await f_send_result('scan_tile_ready', () => o_scan_jobs.f_tile(
                    o_data.v_data.s_path_folder, o_data.v_data.s_filename));
            }
            if (o_data.s_type === 'stitch_run') {
                await f_send_result('stitch_run', () => o_scan_jobs.f_enqueue(o_data.v_data || {}));
            }
            if (o_data.s_type === 'scan_jobs_list') {
                await f_send_result('scan_jobs_list', async () => {
                    const jobs = o_scan_jobs.f_list();
                    const revision = jobs.map(job => job.s_id + ':' + (job.n_finished || 0)).join('|');
                    if (o_socket.s_scan_map_revision !== revision) {
                        o_socket.send(JSON.stringify({ o_model: f_o_model__from_s_name_table('a_o_map'),
                            v_data: await f_v_crud__indb('read', 'a_o_map') }));
                        o_socket.s_scan_map_revision = revision;
                    }
                    return jobs;
                });
            }
            if (o_data.s_type === 'scan_finish') {
                await f_send_result('scan_finish', () => o_scan_jobs.f_finish(
                    o_data.v_data.s_path_folder, o_data.v_data.n_tiles));
            }

            // ── Focus stack folder creation ────────────────────
            if(o_data.s_type === 'focus_stack_create_folder'){
                try {
                    let s_path_folder = f_s_path_folder__capture(
                        'focus_stack_',
                        o_data.v_data && o_data.v_data.s_path_folder
                    );
                    await Deno.mkdir(s_path_folder, { recursive: true });
                    o_socket.send(JSON.stringify({
                        v_result: { s_path_folder: s_path_folder },
                        s_uuid: o_data.s_uuid,
                    }));
                } catch (o_error) {
                    console.error('focus_stack_create_folder error:', o_error);
                    o_socket.send(JSON.stringify({
                        error: o_error.message,
                        s_uuid: o_data.s_uuid,
                    }));
                }
            }

            // ── Flat-field folder creation ─────────────────────
            if(o_data.s_type === 'flatfield_create_folder'){
                try {
                    // fixed, reusable folder (a flat is recalibrated in place)
                    let s_path_folder = s_root_dir + s_ds + 'scans' + s_ds + 'flatfield';
                    await Deno.mkdir(s_path_folder, { recursive: true });
                    o_socket.send(JSON.stringify({
                        v_result: { s_path_folder: s_path_folder },
                        s_uuid: o_data.s_uuid,
                    }));
                } catch (o_error) {
                    console.error('flatfield_create_folder error:', o_error);
                    o_socket.send(JSON.stringify({
                        error: o_error.message,
                        s_uuid: o_data.s_uuid,
                    }));
                }
            }

            // ── Focus stack run (focus_stack.py) ────────────────
            if(o_data.s_type === 'focus_stack_run'){
                try {
                    let f_on_line = function(s_line){
                        try {
                            o_socket.send(JSON.stringify({
                                s_type: 'focus_stack_progress',
                                v_data: { s_line: s_line },
                            }));
                        } catch { /* socket may have closed */ }
                    };

                    let o_result = await f_o_focus_stack_run(o_data.v_data || {}, f_on_line);

                    o_socket.send(JSON.stringify({
                        v_result: o_result,
                        s_uuid: o_data.s_uuid,
                    }));
                } catch (o_error) {
                    console.error('focus_stack_run error:', o_error);
                    o_socket.send(JSON.stringify({
                        v_result: { b_success: false, s_error: o_error.message, a_s_line: [] },
                        s_uuid: o_data.s_uuid,
                    }));
                }
            }

            // ── Live slide-map localizer (template matching) ────────
            if(o_data.s_type === 'locate_start'){
                let o_result = { b_success: false, s_error: '' };
                try {
                    o_result = await f_o_locate_start(o_data.v_data || {});
                } catch (o_error) {
                    console.error('locate_start error:', o_error);
                    o_result = { b_success: false, s_error: o_error.message };
                }
                o_socket.send(JSON.stringify({ v_result: o_result, s_uuid: o_data.s_uuid }));
            }
            if(o_data.s_type === 'locate_stop'){
                let o_result = { b_success: false, s_error: '' };
                try {
                    o_result = await f_o_locate_stop();
                } catch (o_error) {
                    console.error('locate_stop error:', o_error);
                    o_result = { b_success: false, s_error: o_error.message };
                }
                o_socket.send(JSON.stringify({ v_result: o_result, s_uuid: o_data.s_uuid }));
            }
            if(o_data.s_type === 'locate_status'){
                o_socket.send(JSON.stringify({
                    v_result: f_o_locate_status(),
                    s_uuid: o_data.s_uuid,
                }));
            }
            if(o_data.s_type === 'locate_list_maps'){
                let o_result = { b_success: false, a_o_map: [] };
                try {
                    o_result = await f_o_locate_list_maps();
                } catch (o_error) {
                    console.error('locate_list_maps error:', o_error);
                    o_result = { b_success: false, a_o_map: [], s_error: o_error.message };
                }
                o_socket.send(JSON.stringify({ v_result: o_result, s_uuid: o_data.s_uuid }));
            }

            // ── Cellpose cell segmentation (cellpose_worker.py) ────
            if(o_data.s_type === 'cellpose_start'){
                let o_result = { b_success: false, s_error: '' };
                try {
                    o_result = await f_o_cellpose_start(o_data.v_data || {});
                } catch (o_error) {
                    console.error('cellpose_start error:', o_error);
                    o_result = { b_success: false, s_error: o_error.message };
                }
                o_socket.send(JSON.stringify({ v_result: o_result, s_uuid: o_data.s_uuid }));
            }
            if(o_data.s_type === 'cellpose_stop'){
                let o_result = { b_success: false, s_error: '' };
                try {
                    o_result = await f_cellpose_stop();
                } catch (o_error) {
                    console.error('cellpose_stop error:', o_error);
                    o_result = { b_success: false, s_error: o_error.message };
                }
                o_socket.send(JSON.stringify({ v_result: o_result, s_uuid: o_data.s_uuid }));
            }
            if(o_data.s_type === 'cellpose_status'){
                o_socket.send(JSON.stringify({
                    v_result: f_o_cellpose_status(),
                    s_uuid: o_data.s_uuid,
                }));
            }
            if(o_data.s_type === 'cellpose_infer'){
                let o_result = { b_success: false, s_error: '' };
                try {
                    // the frame was uploaded to /api/cellpose/frame just before
                    o_result = await f_o_cellpose_infer(
                        o_data.v_data.n_seq,
                        o_data.v_data.s_path_frame,
                    );
                } catch (o_error) {
                    console.error('cellpose_infer error:', o_error);
                    o_result = { b_success: false, s_error: o_error.message };
                }
                o_socket.send(JSON.stringify({ v_result: o_result, s_uuid: o_data.s_uuid }));
            }

            if(o_data.s_type === 'compile_esp'){
                let v = o_data.v_data;
                let f_on_line = function(s_line, s_source){
                    try {
                        o_socket.send(JSON.stringify({
                            s_type: 'flash_progress',
                            v_data: { s_line, s_source },
                        }));
                    } catch { /* socket may have closed */ }
                };

                let o_result = await f_compile_esp(
                    v.s_wifi_ssid, v.s_wifi_password, v.a_o_pin_config, f_on_line,
                );

                o_socket.send(JSON.stringify({
                    s_type: 'compile_result',
                    v_data: o_result,
                    s_uuid: o_data.s_uuid,
                }));
            }
        };

        o_socket.onclose = function() {
            console.log('websocket disconnected');
        };

        return o_response;
    }

    // ── HTTP routing ────────────────────────────────────────────────

    let o_url = new URL(o_request.url);
    let s_path = o_url.pathname;
    if (s_path.startsWith('/api/training/yolo/')) return await f_o_yolo_response(o_request);
    if (s_path.startsWith('/api/training/')) return await f_o_training_response(o_request);

    // exposed functions via HTTP
    let o_sfunexposed = a_o_sfunexposed.find(function(o){ return o.s_name === s_path.slice('/api/'.length); });
    if(o_sfunexposed){
        try {
            let o_data = await o_request.json();
            let a_v_arg = Array.isArray(o_data.v_data) ? o_data.v_data : [];
            let AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
            let f = new AsyncFunction('f_v_crud__indb', 'f_o_model__from_s_name_table', 'f_delete_table_data', 'Deno', '...a_v_arg', o_sfunexposed.s_f);
            let v_result = await f(f_v_crud__indb, f_o_model__from_s_name_table, f_db_delete_table_data, Deno, ...a_v_arg);
            return new Response(JSON.stringify({ v_result }), {
                headers: { 'content-type': 'application/json' },
            });
        } catch (o_error) {
            console.error('Error in exposed function:', o_sfunexposed.s_name, o_error);
            return new Response('Error: ' + o_error.message, { status: 500 });
        }
    }

    // recording frame save endpoint (same shape as the scan image save)
    if (s_path === '/api/recording/save_frame' && o_request.method === 'POST') {
        let s_path_folder = o_url.searchParams.get('s_path_folder');
        let s_filename = o_url.searchParams.get('s_filename');
        if (!s_path_folder || !s_filename) {
            return new Response('Missing s_path_folder or s_filename', { status: 400 });
        }
        try {
            let a_n_byte = new Uint8Array(await o_request.arrayBuffer());
            let o_result = await f_recording_write_frame(s_path_folder, s_filename, a_n_byte);
            return new Response(JSON.stringify(o_result), {
                headers: { 'content-type': 'application/json' },
            });
        } catch (o_error) {
            console.error('recording save_frame error:', o_error);
            return new Response('Error: ' + o_error.message, { status: 500 });
        }
    }

    // recording video chunk append endpoint (MediaRecorder timeslices)
    if (s_path === '/api/recording/append_blob' && o_request.method === 'POST') {
        let s_path_folder = o_url.searchParams.get('s_path_folder');
        let s_filename = o_url.searchParams.get('s_filename');
        if (!s_path_folder || !s_filename) {
            return new Response('Missing s_path_folder or s_filename', { status: 400 });
        }
        try {
            let a_n_byte = new Uint8Array(await o_request.arrayBuffer());
            let o_result = await f_recording_append_blob(s_path_folder, s_filename, a_n_byte);
            return new Response(JSON.stringify(o_result), {
                headers: { 'content-type': 'application/json' },
            });
        } catch (o_error) {
            console.error('recording append_blob error:', o_error);
            return new Response('Error: ' + o_error.message, { status: 500 });
        }
    }

    // Open the folder on the computer running the microscope server.
    if (s_path === '/api/scans/open_folder') {
        if (o_request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
        }
        let folder;
        try {
            folder = await o_scan_jobs.f_folder(o_url.searchParams.get('path') || '');
            if (!(await Deno.stat(folder)).isDirectory) throw new Error('Path must be a scan folder');
        } catch (error) { return new Response(error.message, { status: 400 }); }
        try {
            const command = Deno.build.os === 'windows' ? 'explorer.exe' : Deno.build.os === 'darwin' ? 'open' : 'xdg-open';
            const result = await new Deno.Command(command, {
                args: [folder], stdin: 'null', stdout: 'null', stderr: 'piped',
            }).output();
            if (!result.success) {
                throw new Error(new TextDecoder().decode(result.stderr).trim() || 'File browser exited with code ' + result.code);
            }
            return new Response(null, { status: 204 });
        } catch (error) {
            return new Response('Could not open scan folder: ' + error.message, { status: 500 });
        }
    }

    // Browser-accessible folder view works even when the microscope server is remote.
    if (s_path === '/api/scans/folder') {
        try {
            const folder = await o_scan_jobs.f_folder(o_url.searchParams.get('path') || '');
            const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
            const entries = [];
            for await (const entry of Deno.readDir(folder)) {
                if (!entry.isFile && !entry.isDirectory) continue;
                const path = folder + s_ds + entry.name;
                const url = entry.isDirectory ? '/api/scans/folder?path=' : '/api/file?path=';
                entries.push(`<li><a href="${url}${encodeURIComponent(path)}">${escape(entry.name)}${entry.isDirectory ? '/' : ''}</a></li>`);
            }
            return new Response(`<!doctype html><meta charset="utf-8"><title>Scan files</title><h1>${escape(folder)}</h1><ul>${entries.sort().join('')}</ul>`,
                { headers: { 'content-type': 'text/html; charset=utf-8' } });
        } catch (error) { return new Response(error.message, { status: 400 }); }
    }

    // scan image save endpoint
    if (s_path === '/api/scan/save_image' && o_request.method === 'POST') {
        let s_path_folder = o_url.searchParams.get('s_path_folder');
        let s_filename = o_url.searchParams.get('s_filename');
        if (!s_path_folder || !s_filename) {
            return new Response('Missing s_path_folder or s_filename', { status: 400 });
        }
        // basic path safety: folder must be under <root>/scans/

        let s_scans_prefix = s_root_dir + s_ds + 'scans' + s_ds;
        if (!s_path_folder.startsWith(s_scans_prefix) || s_filename.includes('..') || s_filename.includes(s_ds)) {
            return new Response('Invalid path', { status: 400 });
        }
        try {
            let a_n_byte = new Uint8Array(await o_request.arrayBuffer());
            let s_path_file = s_path_folder + s_ds + s_filename;
            await Deno.writeFile(s_path_file, a_n_byte);
            return new Response(JSON.stringify({ b_success: true }), {
                headers: { 'content-type': 'application/json' },
            });
        } catch (o_error) {
            console.error('scan save_image error:', o_error);
            return new Response('Error: ' + o_error.message, { status: 500 });
        }
    }

    // locate frame upload endpoint (low-res jpeg of the current camera frame)
    if (s_path === '/api/locate/frame' && o_request.method === 'POST') {
        let n_scl_x = Number(o_url.searchParams.get('n_scl_x') || 0);
        let n_scl_y = Number(o_url.searchParams.get('n_scl_y') || 0);
        try {
            let a_n_byte = new Uint8Array(await o_request.arrayBuffer());
            await f_s_locate_save_frame(n_scl_x, n_scl_y, a_n_byte);
            return new Response(JSON.stringify({ b_success: true }), {
                headers: { 'content-type': 'application/json' },
            });
        } catch (o_error) {
            console.error('locate frame upload error:', o_error);
            return new Response('Error: ' + o_error.message, { status: 500 });
        }
    }

    // cellpose frame upload endpoint: stores the camera frame and answers with
    // the path + sequence the client then hands to the cellpose_infer message
    if (s_path === '/api/cellpose/frame' && o_request.method === 'POST') {
        try {
            let a_n_byte = new Uint8Array(await o_request.arrayBuffer());
            let o_frame = await f_s_cellpose_save_frame(a_n_byte);
            return new Response(JSON.stringify({
                b_success: true,
                s_path_frame: o_frame.s_path,
                n_seq: o_frame.n_seq,
            }), {
                headers: { 'content-type': 'application/json' },
            });
        } catch (o_error) {
            console.error('cellpose frame upload error:', o_error);
            return new Response('Error: ' + o_error.message, { status: 500 });
        }
    }

    // serve file from absolute path
    if (s_path === '/api/file') {
        let s_path_file = o_url.searchParams.get('path');
        if (!s_path_file) {
            return new Response('Missing path parameter', { status: 400 });
        }
        try {
            let a_n_byte = await Deno.readFile(s_path_file);
            let s_content_type = f_s_content_type(s_path_file);
            return new Response(a_n_byte, {
                headers: { 'content-type': s_content_type },
            });
        } catch {
            return new Response('File not found', { status: 404 });
        }
    }

    // serve static file from webserved_dir
    if (s_path === '/') {
        s_path = '/index.html';
    }

    try {
        let s_path_file = `./webserved_dir${s_path}`.replace(/\//g, s_ds);
        let a_n_byte = await Deno.readFile(s_path_file);
        let s_content_type = f_s_content_type(s_path);
        return new Response(a_n_byte, {
            headers: { 'content-type': s_content_type },
        });
    } catch {
        // SPA fallback: serve index.html for navigation routes (e.g. /setup, /control)
        if(!s_path.startsWith('/api/')){
            try {
                let a_n_byte = await Deno.readFile(`./webserved_dir/index.html`);
                return new Response(a_n_byte, {
                    headers: { 'content-type': 'text/html' },
                });
            } catch { /* fall through */ }
        }
        return new Response('Not Found', { status: 404 });
    }
};

Deno.serve({
    port: n_port,
    onListen() {
        console.log(`server running on http://localhost:${n_port}`);
    },
}, f_handler);

// the cellpose worker is a child process; take it down with the server
for(let s_signal of ['SIGINT', 'SIGTERM']){
    Deno.addSignalListener(s_signal, async function(){
        try { await f_cellpose_stop(); } catch { /* nothing to stop */ }
        Deno.exit(0);
    });
}
globalThis.addEventListener('unload', function(){
    f_cellpose_stop().catch(function(){});
});
