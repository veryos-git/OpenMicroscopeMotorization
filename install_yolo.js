// Optional YOLO environment. CPU wheels keep the default download smaller;
// an existing GPU-capable environment is retained.
let s_root = new URL('.', import.meta.url).pathname;
let s_python = `${s_root}venv_yolo/bin/python3`;
let f_run = async function (s_command, a_s_arg) {
    let o_result = await new Deno.Command(s_command, {
        args: a_s_arg,
        cwd: s_root,
        env: { YOLO_CONFIG_DIR: `${s_root}weights/yolo/config` },
        stdin: 'null',
        stdout: 'inherit',
        stderr: 'inherit',
    }).output();
    if (!o_result.success) throw new Error(`${s_command} failed (${o_result.code})`);
};
try {
    await Deno.stat(s_python);
} catch {
    await f_run('python3', ['-m', 'venv', `${s_root}venv_yolo`]);
}
let o_probe = await new Deno.Command(s_python, {
    args: ['-c', 'import torch, torchvision'],
    stdout: 'null',
    stderr: 'null',
}).output();
if (!o_probe.success) {
    await f_run(s_python, [
        '-m',
        'pip',
        'install',
        'torch',
        'torchvision',
        '--index-url',
        'https://download.pytorch.org/whl/cpu',
    ]);
}
await f_run(s_python, ['-m', 'pip', 'install', '-r', `${s_root}requirements_yolo.txt`]);
await f_run(s_python, ['-c', 'import ultralytics; print("YOLO ready:", ultralytics.__version__)']);
