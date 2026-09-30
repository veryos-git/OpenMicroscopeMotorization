// runs stitch.py (mosaic stitcher) on a folder of scan tiles
//
// stitch.py logs its progress line by line on stderr and writes the mosaic to
// disk, so the result is assembled from the exit code + the written files.
//
// NOTE: the old "Live stitch" session code (f_o_live_*) used to live here too;
// it was archived to archive/overlays_live_and_fog/.  This module now only
// serves the scan panel's tile mosaic.

import {
    s_root_dir,
    s_ds,
} from "./runtimedata.module.js";

let s_path__script = `${s_root_dir}${s_ds}stitch.py`;
let s_path__python = `${s_root_dir}${s_ds}venv${s_ds}bin${s_ds}python3`;

// how many log lines are kept for the result sent back to the client
let N_CNT__LINE__MAX = 400;

let f_b_path_exists = async function(s_path) {
    try {
        await Deno.stat(s_path);
        return true;
    } catch {
        return false;
    }
};

// o_option: {
//   s_path_folder, n_score__min, n_dim__max, s_blend,
//   b_matcher__loftr, b_dry_run
// }
// f_on_line: called with every log line while stitch.py runs (may be omitted)
let f_o_stitch_run = async function(o_option, f_on_line) {
    let s_path_folder = o_option.s_path_folder;
    if(!s_path_folder){
        return { b_success: false, s_error: 'no folder given', a_s_line: [] };
    }
    if(!await f_b_path_exists(s_path_folder)){
        return { b_success: false, s_error: `no such folder: ${s_path_folder}`, a_s_line: [] };
    }
    if(!await f_b_path_exists(s_path__python)){
        return {
            b_success: false,
            a_s_line: [],
            s_error: 'python venv missing — run: deno task install',
        };
    }
    if(!await f_b_path_exists(s_path__script)){
        return { b_success: false, s_error: `stitch.py not found at ${s_path__script}`, a_s_line: [] };
    }

    const live = o_option.b_live_preview === true;
    let s_path_output = `${s_path_folder}${s_ds}${live ? 'live_preview.jpg' : 'stitched.png'}`;
    let s_path_jpeg = `${s_path_folder}${s_ds}stitched.jpg`;
    let s_path_preview = `${s_path_folder}${s_ds}stitched_preview.jpg`;
    const s_path_original_colors = `${s_path_folder}${s_ds}stitched_original_colors.png`;
    const s_path_original_colors_jpeg = `${s_path_folder}${s_ds}stitched_original_colors.jpg`;
    const s_path_original_colors_preview = `${s_path_folder}${s_ds}stitched_original_colors_preview.jpg`;
    const s_path_flatfield = `${s_path_folder}${s_ds}stitched_flatfield.png`;
    const s_path_flatfield_jpeg = `${s_path_folder}${s_ds}stitched_flatfield.jpg`;
    const s_path_flatfield_preview = `${s_path_folder}${s_ds}stitched_flatfield_preview.jpg`;
    const s_path_exposure = `${s_path_folder}${s_ds}stitched_exposure.png`;
    const s_path_exposure_jpeg = `${s_path_folder}${s_ds}stitched_exposure.jpg`;
    const s_path_exposure_preview = `${s_path_folder}${s_ds}stitched_exposure_preview.jpg`;
    let s_path_position = `${s_path_folder}${s_ds}positions.json`;
    let s_path_report = `${s_path_folder}${s_ds}report.json`;

    let a_s_arg = [
        s_path__script,
        ...(live ? o_option.a_s_tile.map(name => `${s_path_folder}${s_ds}${name}`) : [s_path_folder]),
        '-o', s_path_output,
        '--positions', s_path_position,
        '--report', s_path_report,
        '--registration-max-width', '256',
        '--jobs', live ? '1' : '2',
    ];
    if (!live) {
        const pattern = o_option.b_live_scan ? '^tile_r[0-9]+_c[0-9]+\\.png$' : '^tile_r[0-9]+_c[0-9]+.*\\.(png|jpe?g|tiff?)$';
        a_s_arg.push('--jpeg-copy', '--all-color-variants', '--pattern', pattern);
    }
    if (o_option.b_live_scan) {
        a_s_arg.push('--scan-live-cache', `${s_path_folder}${s_ds}live_alignment.json`);
    }
    if (live) a_s_arg.push('--live-preview', '--passes', '1');
    if(o_option.n_score__min) a_s_arg.push('--min-score', String(o_option.n_score__min));
    if(o_option.n_dim__max) a_s_arg.push('--max-dim', String(o_option.n_dim__max));
    if(o_option.s_blend === 'none') a_s_arg.push('--blend', 'none');
    if(o_option.b_matcher__loftr && !live) a_s_arg.push('--matcher', 'loftr');
    if(o_option.b_dry_run) a_s_arg.push('--dry-run');

    let a_s_line = [];
    let f_line = function(s_line) {
        if(!s_line) return;
        a_s_line.push(s_line);
        if(a_s_line.length > N_CNT__LINE__MAX) a_s_line.shift();
        if(f_on_line) f_on_line(s_line);
    };

    let o_command = new Deno.Command(s_path__python, {
        args: a_s_arg,
        env: { OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1' },
        stdout: 'piped',
        stderr: 'piped',
    });
    let o_child = o_command.spawn();

    let f_read_stream = async function(o_stream) {
        let o_decoder = new TextDecoder();
        let s_rest = '';
        for await (let a_n_byte of o_stream){
            s_rest += o_decoder.decode(a_n_byte, { stream: true });
            let a_s_part = s_rest.split('\n');
            s_rest = a_s_part.pop();
            for(let s_part of a_s_part){
                f_line(s_part.trimEnd());
            }
        }
        if(s_rest.trim()) f_line(s_rest.trimEnd());
    };

    await Promise.all([
        f_read_stream(o_child.stderr),
        f_read_stream(o_child.stdout),
    ]);
    let o_status = await o_child.status;

    let b_output = await f_b_path_exists(s_path_output);
    // the preview is only written when the mosaic is larger than --preview
    let b_preview = await f_b_path_exists(s_path_preview);

    let o_result = {
        b_success: o_status.success && (b_output || o_option.b_dry_run === true),
        s_path_output: b_output ? s_path_output : '',
        s_path_jpeg: !live && await f_b_path_exists(s_path_jpeg) ? s_path_jpeg : '',
        s_path_preview: b_preview ? s_path_preview : '',
        s_path_original_colors: !live && await f_b_path_exists(s_path_original_colors) ? s_path_original_colors : '',
        s_path_original_colors_jpeg: !live && await f_b_path_exists(s_path_original_colors_jpeg) ? s_path_original_colors_jpeg : '',
        s_path_original_colors_preview: !live && await f_b_path_exists(s_path_original_colors_preview) ? s_path_original_colors_preview : '',
        s_path_flatfield: !live && await f_b_path_exists(s_path_flatfield) ? s_path_flatfield : '',
        s_path_flatfield_jpeg: !live && await f_b_path_exists(s_path_flatfield_jpeg) ? s_path_flatfield_jpeg : '',
        s_path_flatfield_preview: !live && await f_b_path_exists(s_path_flatfield_preview) ? s_path_flatfield_preview : '',
        s_path_exposure: !live && await f_b_path_exists(s_path_exposure) ? s_path_exposure : '',
        s_path_exposure_jpeg: !live && await f_b_path_exists(s_path_exposure_jpeg) ? s_path_exposure_jpeg : '',
        s_path_exposure_preview: !live && await f_b_path_exists(s_path_exposure_preview) ? s_path_exposure_preview : '',
        s_path_position: await f_b_path_exists(s_path_position) ? s_path_position : '',
        s_path_report: await f_b_path_exists(s_path_report) ? s_path_report : '',
        a_s_line: a_s_line,
        s_error: '',
    };
    if(!o_result.b_success){
        // the closing lines carry the reason stitch.py gave up
        o_result.s_error = a_s_line.slice(-4).join(' | ')
            || `stitch.py exited with code ${o_status.code}`;
    }
    return o_result;
};

export { f_o_stitch_run };
