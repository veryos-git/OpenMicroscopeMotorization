// interface for calling python scripts from deno

let s_path__dir = new URL('.', import.meta.url).pathname;
let s_path__venv_python = `${s_path__dir}image_stitching_test/venv/bin/python`;
let s_path__python_stitch = `${s_path__dir}image_stitching_test/python_stitch.py`;

let f_run = async function(s_cmd, a_s_arg = []) {
    let o_command = new Deno.Command(s_cmd, {
        args: a_s_arg,
        stdout: 'piped',
        stderr: 'piped',
        stdin: 'null',
    });
    let o_result = await o_command.output();
    return {
        b_success: o_result.success,
        n_code: o_result.code,
        s_stdout: new TextDecoder().decode(o_result.stdout),
        s_stderr: new TextDecoder().decode(o_result.stderr),
    };
};

// stitch multiple images into one panorama
// a_s_path_input: array of absolute paths to input images
// s_path_output: absolute path for the stitched output image
// returns: { b_success, s_path_output, s_error, n_scl_x, n_scl_y }
let f_o_stitch_image = async function(a_s_path_input, s_path_output) {
    let o_run = await f_run(s_path__venv_python, [
        s_path__python_stitch,
        s_path_output,
        ...a_s_path_input,
    ]);

    if (o_run.s_stdout.trim() === '') {
        return {
            b_success: false,
            s_path_output: s_path_output,
            s_error: o_run.s_stderr || `python exited with code ${o_run.n_code}`,
            n_scl_x: 0,
            n_scl_y: 0,
        };
    }

    try {
        return JSON.parse(o_run.s_stdout.trim());
    } catch (v_err) {
        return {
            b_success: false,
            s_path_output: s_path_output,
            s_error: `failed to parse python output: ${o_run.s_stdout}`,
            n_scl_x: 0,
            n_scl_y: 0,
        };
    }
};

export { f_o_stitch_image };
