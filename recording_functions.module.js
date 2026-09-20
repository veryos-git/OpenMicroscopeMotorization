// recording storage and media helpers (server side)
//
// a recording is a folder under recordings/:
//
//   recordings/rec_2026-09-20_193000/
//     manifest.json          config + provenance + positions
//     frame.jsonl            one line per captured frame (append-only)
//     pos_00/t_000001.png    the frames themselves
//     media/timelapse.mp4    ffmpeg output
//     thumb/cover.jpg        library thumbnail
//
// the browser owns the camera; this module only creates folders, writes
// metadata, encodes video and reports disk status.  every path that comes from
// the client goes through f_b_path__recording() first.

import { s_ds, s_root_dir } from './runtimedata.module.js';

let s_name_dir = 'recordings';

let f_s_path__root = function() {
    return s_root_dir + s_ds + s_name_dir;
};

// a client-supplied folder is only accepted inside recordings/
let f_b_path__recording = function(s_path) {
    if (typeof s_path !== 'string' || s_path === '') return false;
    let s_root = f_s_path__root() + s_ds;
    if (!s_path.startsWith(s_root)) return false;
    if (s_path.includes('..')) return false;
    return true;
};

// a client-supplied filename must be a plain name (no separators, no ..)
let f_b_filename__safe = function(s_filename) {
    if (typeof s_filename !== 'string' || s_filename === '') return false;
    if (s_filename.includes('..')) return false;
    if (s_filename.includes('/') || s_filename.includes('\\')) return false;
    return true;
};

let f_s_pad = function(n) {
    return String(n).padStart(2, '0');
};

// timestamped folder name, same shape as the scan folders
let f_s_name__recording = function(s_prefix) {
    let o_date = new Date();
    return (s_prefix || 'rec_')
        + o_date.getFullYear() + '-'
        + f_s_pad(o_date.getMonth() + 1) + '-'
        + f_s_pad(o_date.getDate()) + '_'
        + f_s_pad(o_date.getHours())
        + f_s_pad(o_date.getMinutes())
        + f_s_pad(o_date.getSeconds());
};

let f_ensure_recording_dir = async function() {
    await Deno.mkdir(f_s_path__root(), { recursive: true });
};

// create a session folder (and its position subfolders)
let f_o_recording_create = async function(o_option) {
    o_option = o_option || {};
    await f_ensure_recording_dir();

    let s_path_folder = o_option.s_path_folder;
    if (!s_path_folder) {
        s_path_folder = f_s_path__root() + s_ds + f_s_name__recording(o_option.s_prefix);
    }
    if (!f_b_path__recording(s_path_folder)) {
        throw new Error('recording path must be under ' + f_s_path__root());
    }
    await Deno.mkdir(s_path_folder, { recursive: true });
    await Deno.mkdir(s_path_folder + s_ds + 'media', { recursive: true });
    await Deno.mkdir(s_path_folder + s_ds + 'thumb', { recursive: true });

    let n_cnt__position = Math.max(1, Math.round(o_option.n_cnt__position || 1));
    for (let n_idx = 0; n_idx < n_cnt__position; n_idx++) {
        await Deno.mkdir(f_s_path__position(s_path_folder, n_idx), { recursive: true });
    }
    return { s_path_folder };
};

let f_s_path__position = function(s_path_folder, n_idx__position) {
    return s_path_folder + s_ds + 'pos_' + String(Math.max(0, n_idx__position)).padStart(2, '0');
};

let f_recording_write_manifest = async function(s_path_folder, o_manifest) {
    if (!f_b_path__recording(s_path_folder)) throw new Error('invalid recording folder');
    let s_json = JSON.stringify(o_manifest, null, 2);
    await Deno.writeTextFile(s_path_folder + s_ds + 'manifest.json', s_json);
    return { b_success: true };
};

let f_recording_read_manifest = async function(s_path_folder) {
    if (!f_b_path__recording(s_path_folder)) throw new Error('invalid recording folder');
    let s_json = await Deno.readTextFile(s_path_folder + s_ds + 'manifest.json');
    return JSON.parse(s_json);
};

// append one record to a jsonl file in the session.  append-only so a crash
// never loses what was already written, and so the client can resume from the
// last line.  s_file defaults to the frame log; event.jsonl is the same shape.
let f_recording_append_frame = async function(s_path_folder, o_frame, s_file) {
    if (!f_b_path__recording(s_path_folder)) throw new Error('invalid recording folder');
    let s_name = s_file || 'frame.jsonl';
    if (!f_b_filename__safe(s_name)) throw new Error('invalid log filename');
    let s_line = JSON.stringify(o_frame) + '\n';
    await Deno.writeTextFile(s_path_folder + s_ds + s_name, s_line, { append: true, create: true });
    return { b_success: true };
};

let f_a_o_recording_frame = async function(s_path_folder) {
    if (!f_b_path__recording(s_path_folder)) throw new Error('invalid recording folder');
    let s_path = s_path_folder + s_ds + 'frame.jsonl';
    let s_text = '';
    try {
        s_text = await Deno.readTextFile(s_path);
    } catch (o_error) {
        return [];
    }
    let a_o_frame = [];
    for (let s_line of s_text.split('\n')) {
        if (!s_line.trim()) continue;
        try { a_o_frame.push(JSON.parse(s_line)); } catch (o_error) { /* skip a torn last line */ }
    }
    return a_o_frame;
};

// write one frame's bytes.  used by the HTTP endpoint.
let f_recording_write_frame = async function(s_path_folder, s_filename, a_n_byte) {
    if (!f_b_path__recording(s_path_folder)) throw new Error('invalid recording folder');
    if (!f_b_filename__safe(s_filename)) throw new Error('invalid frame filename');
    await Deno.writeFile(s_path_folder + s_ds + s_filename, a_n_byte);
    return { b_success: true, s_path: s_path_folder + s_ds + s_filename };
};

// append a MediaRecorder timeslice to a growing video file.  webm chunks from
// one recorder concatenate into one playable file, so a long recording never
// has to sit in browser memory.
let f_recording_append_blob = async function(s_path_folder, s_filename, a_n_byte) {
    if (!f_b_path__recording(s_path_folder)) throw new Error('invalid recording folder');
    if (!f_b_filename__safe(s_filename)) throw new Error('invalid blob filename');
    await Deno.writeFile(s_path_folder + s_ds + s_filename, a_n_byte, { append: true, create: true });
    return { b_success: true };
};

// turn a recorded webm into an mp4 for sharing (and a thumbnail), re-encoding
// because vp8/vp9 inside mp4 is not universally playable
let f_recording_remux = async function(o_option) {
    let s_path_folder = o_option.s_path_folder;
    if (!f_b_path__recording(s_path_folder)) throw new Error('invalid recording folder');
    let o_ffmpeg = await f_o_ffmpeg();
    if (!o_ffmpeg.b_available) throw new Error('ffmpeg is not available on the server');

    let s_name__src = o_option.s_name__src || 'video.webm';
    if (!f_b_filename__safe(s_name__src)) throw new Error('invalid source filename');
    let s_name__out = (o_option.s_name__out || 'video.mp4').replace(/[^a-zA-Z0-9_.-]/g, '_');
    let s_path__src = s_path_folder + s_ds + s_name__src;
    let s_path__out = s_path_folder + s_ds + 'media' + s_ds + s_name__out;

    let o_result = await f_run_command('ffmpeg', [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', s_path__src,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        s_path__out,
    ]);
    if (!o_result.b_success) {
        throw new Error('ffmpeg remux failed: ' + o_result.s_stderr.slice(0, 400));
    }

    let s_path_thumb = '';
    try {
        s_path_thumb = s_path_folder + s_ds + 'thumb' + s_ds + 'cover.jpg';
        let o_thumb = await f_run_command('ffmpeg', [
            '-y', '-hide_banner', '-loglevel', 'error',
            '-i', s_path__src, '-frames:v', '1', '-vf', 'scale=360:-1',
            s_path_thumb,
        ]);
        if (!o_thumb.b_success) s_path_thumb = '';
    } catch (o_error) {
        s_path_thumb = '';
    }

    return { s_path_media: s_path__out, s_path_thumb };
};

// free space on the volume holding the recordings
let f_o_disk__free = async function() {
    try {
        let o_fs = await Deno.statfs(f_s_path__root());
        return {
            n_free__byte: o_fs.bfree * o_fs.bsize,
            n_total__byte: o_fs.blocks * o_fs.bsize,
        };
    } catch (o_error) {
        return { n_free__byte: null, n_total__byte: null };
    }
};

// does ffmpeg exist?
let f_o_ffmpeg = async function() {
    if (f_o_ffmpeg._o_cache !== undefined) return f_o_ffmpeg._o_cache;
    try {
        let o_command = new Deno.Command('ffmpeg', { args: ['-version'], stdout: 'piped', stderr: 'piped' });
        let o_out = await o_command.output();
        f_o_ffmpeg._o_cache = { b_available: o_out.success };
    } catch (o_error) {
        f_o_ffmpeg._o_cache = { b_available: false, s_error: String(o_error && o_error.message || o_error) };
    }
    return f_o_ffmpeg._o_cache;
};

// list the position folders that actually contain frames
let f_a_o_position = async function(s_path_folder) {
    let a_o_position = [];
    let a_o_entry = [];
    try {
        for await (let o_entry of Deno.readDir(s_path_folder)) {
            if (o_entry.isDirectory && /^pos_\d+$/.test(o_entry.name)) a_o_entry.push(o_entry.name);
        }
    } catch (o_error) {
        return [];
    }
    a_o_entry.sort();
    for (let s_name of a_o_entry) {
        let n_idx = parseInt(s_name.slice(4), 10);
        let s_path = s_path_folder + s_ds + s_name;
        let n_cnt = 0;
        try {
            for await (let o_file of Deno.readDir(s_path)) {
                if (o_file.isFile && o_file.name.endsWith('.png')) n_cnt++;
            }
        } catch (o_error) { /* ignore */ }
        a_o_position.push({ n_idx, s_name, s_path, n_cnt__frame: n_cnt });
    }
    return a_o_position;
};

let f_run_command = async function(s_path_bin, a_s_arg) {
    let o_command = new Deno.Command(s_path_bin, { args: a_s_arg, stdout: 'piped', stderr: 'piped' });
    let o_out = await o_command.output();
    return {
        b_success: o_out.success,
        s_stdout: new TextDecoder().decode(o_out.stdout),
        s_stderr: new TextDecoder().decode(o_out.stderr),
    };
};

// encode every position folder into an mp4 and write a library thumbnail.
// the frame rate is the playback rate, independent of the capture interval.
let f_o_recording_encode = async function(o_option) {
    let s_path_folder = o_option.s_path_folder;
    if (!f_b_path__recording(s_path_folder)) throw new Error('invalid recording folder');
    let n_fps = Math.max(1, Math.min(120, Math.round(o_option.n_fps || 10)));

    let o_ffmpeg = await f_o_ffmpeg();
    if (!o_ffmpeg.b_available) {
        throw new Error('ffmpeg is not available on the server');
    }

    let a_o_position = (await f_a_o_position(s_path_folder)).filter(function(o_pos) {
        return o_pos.n_cnt__frame > 0;
    });
    if (a_o_position.length === 0) throw new Error('no frames to encode');

    let a_o_media = [];
    for (let o_pos of a_o_position) {
        // a single position keeps the friendly name, several keep their index
        let s_name_file = a_o_position.length === 1 ? 'timelapse.mp4' : o_pos.s_name + '.mp4';
        let s_path_media = s_path_folder + s_ds + 'media' + s_ds + s_name_file;
        let o_result = await f_run_command('ffmpeg', [
            '-y', '-hide_banner', '-loglevel', 'error',
            '-framerate', String(n_fps),
            '-start_number', '1',
            '-i', o_pos.s_path + s_ds + 't_%06d.png',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
            '-movflags', '+faststart',
            s_path_media,
        ]);
        if (!o_result.b_success) {
            throw new Error('ffmpeg failed for ' + o_pos.s_name + ': ' + o_result.s_stderr.slice(0, 400));
        }
        a_o_media.push({ n_idx__position: o_pos.n_idx, s_path_media });
    }

    // thumbnail for the library (best effort)
    let s_path_thumb = '';
    try {
        let o_first = a_o_position[0];
        s_path_thumb = s_path_folder + s_ds + 'thumb' + s_ds + 'cover.jpg';
        let o_result = await f_run_command('ffmpeg', [
            '-y', '-hide_banner', '-loglevel', 'error',
            '-i', o_first.s_path + s_ds + 't_000001.png',
            '-vf', 'scale=360:-1',
            s_path_thumb,
        ]);
        if (!o_result.b_success) s_path_thumb = '';
    } catch (o_error) {
        s_path_thumb = '';
    }

    return { a_o_media, s_path_thumb };
};

// size of a folder, capped so a huge session cannot stall the library
let f_n_sz__folder = async function(s_path_folder, n_max__file) {
    let n_sz = 0;
    let n_cnt = 0;
    let a_o_stack = [s_path_folder];
    while (a_o_stack.length > 0) {
        let s_path = a_o_stack.pop();
        try {
            for await (let o_entry of Deno.readDir(s_path)) {
                n_cnt++;
                if (n_cnt > (n_max__file || 40000)) return n_sz;
                let s_path__child = s_path + s_ds + o_entry.name;
                if (o_entry.isDirectory) {
                    a_o_stack.push(s_path__child);
                } else if (o_entry.isFile) {
                    try {
                        let o_stat = await Deno.stat(s_path__child);
                        n_sz += o_stat.size;
                    } catch (o_error) { /* ignore */ }
                }
            }
        } catch (o_error) { /* ignore */ }
    }
    return n_sz;
};

// the session library: every recording folder with a manifest
let f_a_o_recording__list = async function() {
    await f_ensure_recording_dir();
    let a_o_recording = [];
    let a_o_dir = [];
    try {
        for await (let o_entry of Deno.readDir(f_s_path__root())) {
            if (o_entry.isDirectory) a_o_dir.push(o_entry.name);
        }
    } catch (o_error) {
        return [];
    }
    a_o_dir.sort().reverse();
    for (let s_name of a_o_dir) {
        let s_path_folder = f_s_path__root() + s_ds + s_name;
        let o_manifest = null;
        try {
            o_manifest = JSON.parse(await Deno.readTextFile(s_path_folder + s_ds + 'manifest.json'));
        } catch (o_error) {
            o_manifest = null;
        }
        let o_stat = null;
        try { o_stat = await Deno.stat(s_path_folder); } catch (o_error) { /* ignore */ }

        let a_s_media = [];
        try {
            for await (let o_file of Deno.readDir(s_path_folder + s_ds + 'media')) {
                if (o_file.isFile) a_s_media.push(s_path_folder + s_ds + 'media' + s_ds + o_file.name);
            }
        } catch (o_error) { /* no media yet */ }
        let s_path_thumb = '';
        try {
            for await (let o_file of Deno.readDir(s_path_folder + s_ds + 'thumb')) {
                if (o_file.isFile) { s_path_thumb = s_path_folder + s_ds + 'thumb' + s_ds + o_file.name; break; }
            }
        } catch (o_error) { /* no thumbnail yet */ }

        a_o_recording.push({
            s_name_folder: s_name,
            s_path_folder,
            o_manifest,
            a_s_media,
            s_path_thumb,
            n_sz__byte: await f_n_sz__folder(s_path_folder),
            n_ts_ms: o_stat ? (o_stat.mtime ? o_stat.mtime.getTime() : null) : null,
        });
    }
    return a_o_recording;
};

let f_recording_delete = async function(s_path_folder) {
    if (!f_b_path__recording(s_path_folder)) throw new Error('invalid recording folder');
    // never delete the recordings root itself
    if (s_path_folder === f_s_path__root()) throw new Error('refusing to delete the recordings root');
    await Deno.remove(s_path_folder, { recursive: true });
    return { b_success: true };
};

// mark running sessions as interrupted after a server restart, so a crash is
// visible in the library instead of looking like an eternal "running"
let f_recording_mark_interrupted = async function(f_update_status) {
    let a_o_recording = await f_a_o_recording__list();
    let a_s_name = [];
    for (let o_recording of a_o_recording) {
        if (!o_recording.o_manifest) continue;
        if (o_recording.o_manifest.s_status !== 'running') continue;
        let o_manifest = o_recording.o_manifest;
        o_manifest.s_status = 'interrupted';
        o_manifest.n_ts_ms__end = o_manifest.n_ts_ms__end || Date.now();
        try {
            await f_recording_write_manifest(o_recording.s_path_folder, o_manifest);
            a_s_name.push(o_recording.s_name_folder);
            if (f_update_status) await f_update_status(o_recording.s_path_folder, 'interrupted');
        } catch (o_error) { /* ignore */ }
    }
    return a_s_name;
};

// export a session (one position) as an OME-TIFF via the python worker, so it
// opens in Fiji / napari with the pixel size and time increment attached
let f_o_recording_tiff = async function(o_option) {
    let s_path_folder = o_option.s_path_folder;
    if (!f_b_path__recording(s_path_folder)) throw new Error('invalid recording folder');
    let s_pos = o_option.s_pos || 'pos_00';
    if (!/^[a-zA-Z0-9_]*$/.test(s_pos)) throw new Error('invalid position name');
    let s_name__out = (o_option.s_name__out || (s_pos + '.ome.tif')).replace(/[^a-zA-Z0-9_.-]/g, '_');

    let s_path_script = s_root_dir + s_ds + 'recording_worker.py';
    let s_path_python = s_root_dir + s_ds + 'venv' + s_ds + 'bin' + s_ds + 'python3';
    let s_path_out = s_path_folder + s_ds + 'media' + s_ds + s_name__out;

    let o_command = new Deno.Command(s_path_python, {
        args: [
            s_path_script,
            '--tiff',
            '--folder', s_path_folder,
            '--pos', s_pos,
            '--out', s_path_out,
            '--interval', String(o_option.n_sec__interval || 0),
            '--um-per-px', String(o_option.n_um__per_px || 0),
        ],
        stdout: 'piped',
        stderr: 'piped',
    });
    let o_child = await o_command.output();
    let s_stdout = new TextDecoder().decode(o_child.stdout);
    let s_stderr = new TextDecoder().decode(o_child.stderr);
    if (s_stderr) console.error('recording tiff stderr:', s_stderr.slice(0, 800));

    let o_result = null;
    for (let s_line of s_stdout.trim().split('\n').reverse()) {
        try { o_result = JSON.parse(s_line); break; } catch (o_error) { /* not json */ }
    }
    if (!o_result) throw new Error('tiff worker produced no result: ' + s_stdout.slice(0, 300));
    if (!o_result.b_success) throw new Error(o_result.s_error || 'tiff export failed');
    o_result.s_path_tiff = o_result.s_path;
    return o_result;
};

// ─── camera probe (the server-side capture option) ──────────────────
// a UVC device can be streamed by one process at a time.  this only reports
// what exists and what it can do, so the UI can offer server capture honestly.

let f_o_camera__probe = async function() {
    let o_ffmpeg = await f_o_ffmpeg();
    let a_o_device = [];
    try {
        for await (let o_entry of Deno.readDir('/dev')) {
            if (/^video\d+$/.test(o_entry.name)) {
                a_o_device.push({ s_path: '/dev/' + o_entry.name, a_s_format: [] });
            }
        }
    } catch (o_error) {
        return {
            b_available: false,
            s_error: 'cannot read /dev: ' + String(o_error && o_error.message || o_error),
            a_o_device: [],
            b_ffmpeg: o_ffmpeg.b_available,
        };
    }
    a_o_device.sort(function(o_a, o_b){ return o_a.s_path.localeCompare(o_b.s_path); });

    if (o_ffmpeg.b_available) {
        for (let o_device of a_o_device) {
            try {
                let o_result = await f_run_command('ffmpeg', [
                    '-hide_banner', '-f', 'v4l2', '-list_formats', 'all', '-i', o_device.s_path,
                ]);
                let s_text = o_result.s_stdout + '\n' + o_result.s_stderr;
                for (let s_line of s_text.split('\n')) {
                    let s_trim = s_line.trim();
                    if (s_trim.includes('Video input')) continue;
                    if (/\[video4linux2/.test(s_trim) && /:/.test(s_trim)) o_device.a_s_format.push(s_trim);
                    else if (/^\s+\S+\s+:\s+/.test(s_line)) o_device.a_s_format.push(s_trim);
                }
            } catch (o_error) { /* ignore a busy device */ }
        }
    }

    return {
        b_available: a_o_device.length > 0,
        a_o_device,
        b_ffmpeg: o_ffmpeg.b_available,
    };
};

export {
    f_s_path__root,
    f_s_path__position,
    f_b_path__recording,
    f_b_filename__safe,
    f_ensure_recording_dir,
    f_o_recording_create,
    f_recording_write_manifest,
    f_recording_read_manifest,
    f_recording_append_frame,
    f_a_o_recording_frame,
    f_recording_write_frame,
    f_recording_append_blob,
    f_recording_remux,
    f_o_disk__free,
    f_o_ffmpeg,
    f_o_recording_encode,
    f_o_recording_tiff,
    f_a_o_recording__list,
    f_recording_delete,
    f_recording_mark_interrupted,
    f_o_camera__probe,
};
