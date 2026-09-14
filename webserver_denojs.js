
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
    f_flash_esp,
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

f_init_db();

// ─── CLI args ───────────────────────────────────────────────────────

let n_port = 8000;
let s_ip__esp = '';

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
}

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

        let f_resolve_password__pending = null;

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

            if(o_data.s_type === 'flash_password_response'){
                if(f_resolve_password__pending){
                    f_resolve_password__pending(o_data.v_data.s_password);
                    f_resolve_password__pending = null;
                }
            }

            // ── Scan folder creation ─────────────────────────────
            if(o_data.s_type === 'scan_create_folder'){
                try {
                    let s_path_folder = f_s_path_folder__capture(
                        'scan_',
                        o_data.v_data && o_data.v_data.s_path_folder
                    );
                    await Deno.mkdir(s_path_folder, { recursive: true });
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

            // ── Mosaic stitching of a tile folder (stitch.py) ─────
            if(o_data.s_type === 'stitch_run'){
                try {
                    let f_on_line = function(s_line){
                        try {
                            o_socket.send(JSON.stringify({
                                s_type: 'stitch_progress',
                                v_data: { s_line: s_line },
                            }));
                        } catch { /* socket may have closed */ }
                    };

                    let o_result = await f_o_stitch_run(o_data.v_data || {}, f_on_line);

                    o_socket.send(JSON.stringify({
                        v_result: o_result,
                        s_uuid: o_data.s_uuid,
                    }));
                } catch (o_error) {
                    console.error('stitch_run error:', o_error);
                    o_socket.send(JSON.stringify({
                        v_result: { b_success: false, s_error: o_error.message, a_s_line: [] },
                        s_uuid: o_data.s_uuid,
                    }));
                }
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

            if(o_data.s_type === 'flash_esp'){
                let v = o_data.v_data;
                let f_on_line = function(s_line, s_source){
                    try {
                        o_socket.send(JSON.stringify({
                            s_type: 'flash_progress',
                            v_data: { s_line, s_source },
                        }));
                    } catch { /* socket may have closed */ }
                };

                let f_s_request_password = function(){
                    return new Promise(function(resolve){
                        f_resolve_password__pending = resolve;
                        o_socket.send(JSON.stringify({
                            s_type: 'flash_password_request',
                        }));
                    });
                };

                let o_result = await f_flash_esp(
                    v.s_port,
                    v.s_wifi_ssid,
                    v.s_wifi_password,
                    v.a_o_pin_config,
                    f_on_line,
                    f_s_request_password,
                );

                // update stored ESP IP if flash succeeded
                if(o_result.b_success && o_result.s_ip__esp){
                    s_ip__esp = o_result.s_ip__esp;
                }

                o_socket.send(JSON.stringify({
                    s_type: 'flash_result',
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
