// runs focus_stack.py on a folder of depth frames (z_0001.png, ...)
//
// focus_stack.py logs its progress on stderr and prints one JSON result line on
// stdout, so the result is parsed from stdout while stderr feeds the live log.

import {
    s_root_dir,
    s_ds,
} from "./runtimedata.module.js";

let s_path__script = `${s_root_dir}${s_ds}focus_stack.py`;
let s_path__python = `${s_root_dir}${s_ds}venv${s_ds}bin${s_ds}python3`;

// how many log lines are kept for the result sent back to the client
let N_CNT__LINE__MAX = 400;
// the preview is only shown in the panel, so cap it
let N_PX__PREVIEW = 1600;

let f_b_path_exists = async function(s_path) {
    try {
        await Deno.stat(s_path);
        return true;
    } catch {
        return false;
    }
};

// o_option: {
//   s_path_folder, n_dim__max, b_no_align
// }
// f_on_line: called with every stderr line while focus_stack.py runs (may be omitted)
let f_o_focus_stack_run = async function(o_option, f_on_line) {
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
        return { b_success: false, s_error: `focus_stack.py not found at ${s_path__script}`, a_s_line: [] };
    }

    let s_path_output = `${s_path_folder}${s_ds}focus_stack.png`;
    let s_path_preview = `${s_path_folder}${s_ds}focus_stack_preview.jpg`;

    let a_s_arg = [
        s_path__script,
        s_path_folder,
        '-o', s_path_output,
        '--preview', String(N_PX__PREVIEW),
        '--pattern', 'z_',
    ];
    if(o_option.n_dim__max) a_s_arg.push('--max-dim', String(o_option.n_dim__max));
    if(o_option.b_no_align) a_s_arg.push('--no-align');

    let a_s_line = [];
    let f_line = function(s_line) {
        if(!s_line) return;
        a_s_line.push(s_line);
        if(a_s_line.length > N_CNT__LINE__MAX) a_s_line.shift();
        if(f_on_line) f_on_line(s_line);
    };

    let o_command = new Deno.Command(s_path__python, {
        args: a_s_arg,
        stdout: 'piped',
        stderr: 'piped',
    });
    let o_child = o_command.spawn();

    let s_stdout = '';
    let f_read_stdout = async function(o_stream) {
        let o_decoder = new TextDecoder();
        for await (let a_n_byte of o_stream){
            s_stdout += o_decoder.decode(a_n_byte, { stream: true });
        }
    };
    let f_read_stderr = async function(o_stream) {
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
        f_read_stdout(o_child.stdout),
        f_read_stderr(o_child.stderr),
    ]);
    let o_status = await o_child.status;

    let o_result;
    try {
        o_result = JSON.parse(s_stdout.trim());
    } catch {
        o_result = {
            b_success: false,
            s_error: 'failed to parse focus_stack output: ' + s_stdout.trim(),
        };
    }
    o_result.a_s_line = a_s_line;

    // a successful run has to have actually written the output image
    if(o_result.b_success && !await f_b_path_exists(s_path_output)){
        o_result.b_success = false;
        o_result.s_error = o_result.s_error
            || `focus_stack.py reported success but ${s_path_output} was not written`;
        o_result.s_path_output = '';
        o_result.s_path_preview = '';
    } else if(o_result.b_success){
        o_result.s_path_output = s_path_output;
        o_result.s_path_preview = await f_b_path_exists(s_path_preview) ? s_path_preview : '';
    }
    if(!o_result.b_success && !o_result.s_error){
        o_result.s_error = a_s_line.slice(-4).join(' | ')
            || `focus_stack.py exited with code ${o_status.code}`;
    }
    return o_result;
};

export { f_o_focus_stack_run };
