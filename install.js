#!/usr/bin/env -S deno run -A
// run: deno task install     (or: deno task doctor  -> report only, install nothing)
//
// installs everything the software needs to run:
//   arduino-cli + esp32 core + arduino libraries  ->  detecting / flashing the ESP32
//   ./venv with numpy + opencv                    ->  stitch.py, stich_image_in_folder.py
//   torch (cpu) + lightglue + kornia              ->  autostitch.py feature matching,
//                                                     stitch.py --matcher loftr
//
// every step is idempotent: already satisfied steps are skipped, so this is safe
// to run on every `deno task start`.

import {
    s_root_dir,
    s_ds,
} from "./runtimedata.module.js";

// ─── Paths ──────────────────────────────────────────────────────────

let s_path__venv = `${s_root_dir}${s_ds}venv`;
// the webserver invokes venv/bin/python3 directly, so match that layout exactly
let s_path__python__venv = `${s_path__venv}${s_ds}bin${s_ds}python3`;
let s_path__requirement = `${s_root_dir}${s_ds}requirements.txt`;
let s_path__requirement__cellpose = `${s_root_dir}${s_ds}requirements_cellpose.txt`;
// the scan panel stitches its tiles with this script
let s_path__stitch = `${s_root_dir}${s_ds}stitch.py`;
let s_dir__bin = `${Deno.env.get('HOME')}${s_ds}.local${s_ds}bin`;
let s_path__arduino_cli = `${s_dir__bin}${s_ds}arduino-cli`;

let s_url__lightglue = 'git+https://github.com/cvg/LightGlue.git';
let s_url__torch_cpu = 'https://download.pytorch.org/whl/cpu';
// CUDA 13.0 — matches the driver of this project's dev machine.  a machine with
// an older driver needs the matching cu* index (see the pytorch install page).
let s_url__torch_cuda = 'https://download.pytorch.org/whl/cu130';

let s_path__ino = `${s_root_dir}${s_ds}stepper_websocket.ino`;
// cellpose lives in its own venv so its pins cannot break the stitcher stack
let s_path__venv__cellpose = `${s_root_dir}${s_ds}venv_cellpose`;
let s_path__python__cellpose = `${s_path__venv__cellpose}${s_ds}bin${s_ds}python3`;
let s_path__worker__cellpose = `${s_root_dir}${s_ds}cellpose_worker.py`;
// arduino-cli requires the sketch file to be named exactly like its directory
let s_name__sketch__verify = 'stepper_websocket__verify';
let s_dir__verify = `/tmp/${s_name__sketch__verify}`;
let s_path__ino__verify = `${s_dir__verify}/${s_name__sketch__verify}.ino`;
let s_fqbn = 'esp32:esp32:esp32s3';

// ─── CLI args ───────────────────────────────────────────────────────

let a_s_arg = Deno.args;
let b_check_only = a_s_arg.includes('--check');
let b_skip_arduino = a_s_arg.includes('--skip-arduino');
let b_skip_python = a_s_arg.includes('--skip-python');
let b_skip_stitch_ai = a_s_arg.includes('--skip-stitch-ai');
let b_skip_cellpose = a_s_arg.includes('--skip-cellpose');
let b_verify_compile = a_s_arg.includes('--verify-compile');
// cellpose wants a GPU by default; --cpu asks for the small CPU-only build
let b_cpu = a_s_arg.includes('--cpu');

// ─── Helpers ────────────────────────────────────────────────────────

let f_o_run = async function(s_cmd, a_s_arg__cmd = []) {
    try {
        let o_command = new Deno.Command(s_cmd, {
            args: a_s_arg__cmd,
            stdout: 'piped',
            stderr: 'piped',
            stdin: 'null',
        });
        let o_result = await o_command.output();
        return {
            b_success: o_result.success,
            s_stdout: new TextDecoder().decode(o_result.stdout),
            s_stderr: new TextDecoder().decode(o_result.stderr),
        };
    } catch (o_error) {
        return { b_success: false, s_stdout: '', s_stderr: o_error.message };
    }
};

let f_b_run_live = async function(s_cmd, a_s_arg__cmd = []) {
    try {
        let o_command = new Deno.Command(s_cmd, {
            args: a_s_arg__cmd,
            stdout: 'inherit',
            stderr: 'inherit',
            stdin: 'null',
        });
        let o_result = await o_command.output();
        return o_result.success;
    } catch {
        return false;
    }
};

let f_b_binary_exists = async function(s_name) {
    let o_result = await f_o_run('which', [s_name]);
    return o_result.b_success;
};

let f_b_path_exists = async function(s_path) {
    try {
        await Deno.stat(s_path);
        return true;
    } catch {
        return false;
    }
};

// resolve arduino-cli from PATH first, then from the local bin dir
let f_s_arduino_cli = async function() {
    if (await f_b_binary_exists('arduino-cli')) {
        let o_result = await f_o_run('which', ['arduino-cli']);
        return o_result.s_stdout.trim();
    }
    if (await f_b_path_exists(s_path__arduino_cli)) {
        return s_path__arduino_cli;
    }
    return '';
};

// ─── GPU detection ──────────────────────────────────────────────────

// an NVIDIA driver usable by torch needs BOTH the kernel modules and the device
// nodes: a container or a sandbox can have the modules on the host while the
// nodes are not passed through, and then CUDA still cannot open a device.
let f_o_gpu = async function() {
    let o_gpu = { b_found: false, s_name: '', s_driver: '', s_cuda: '', b_node: false, b_usable: false };

    try {
        o_gpu.b_node = await f_b_path_exists('/dev/nvidia0');
    } catch { /* not linux */ }

    let o_smi = await f_o_run('nvidia-smi', [
        '--query-gpu=name,driver_version',
        '--format=csv,noheader',
    ]);
    if(o_smi.b_success && o_smi.s_stdout.trim()){
        o_gpu.b_found = true;
        let a_s_part = o_smi.s_stdout.trim().split('\n')[0].split(',');
        o_gpu.s_name = (a_s_part[0] || '').trim();
        o_gpu.s_driver = (a_s_part[1] || '').trim();
    } else {
        // nvidia-smi could not reach the driver.  that may mean "no GPU" OR
        // "this shell cannot see /dev/nvidia*" — a container, a sandbox or a
        // systemd unit with DeviceAllow= can hide the nodes while the driver is
        // alive on the host.  the PCI device tells the two apart.
        o_gpu.s_name = await f_s_name_gpu__pci();
    }

    // the driver's CUDA version is printed in the nvidia-smi banner
    let o_banner = await f_o_run('nvidia-smi', []);
    if(o_banner.b_success){
        let o_match = o_banner.s_stdout.match(/CUDA Version:\s*([0-9.]+)/);
        if(o_match) o_gpu.s_cuda = o_match[1];
    }

    o_gpu.b_usable = o_gpu.b_found && o_gpu.b_node;
    return o_gpu;
};

// "this machine has an NVIDIA card" independent of what nvidia-smi can reach:
// lspci sees the PCI device without needing the driver or /dev nodes.
let f_s_name_gpu__pci = async function() {
    let o_lspci = await f_o_run('lspci', []);
    if(!o_lspci.b_success) return '';
    for(let s_line of o_lspci.s_stdout.split('\n')){
        if(/nvidia/i.test(s_line) && /(vga|3d|display)/i.test(s_line)){
            let o_match = s_line.match(/\[([^\]]+)\]\s*$/);
            return (o_match ? o_match[1] : s_line.trim());
        }
    }
    return '';
};

// ─── Logging ────────────────────────────────────────────────────────

let f_log_step = function(s_msg) {
    console.log(`\n  ▸ ${s_msg}`);
};
let f_log_ok = function(s_msg) {
    console.log(`  ✓ ${s_msg}`);
};
let f_log_todo = function(s_msg) {
    console.log(`  ○ ${s_msg}`);
};
let f_log_error = function(s_msg) {
    console.error(`  ✗ ${s_msg}`);
};
let f_log = function(s_msg) {
    console.log(`    ${s_msg}`);
};

let a_s_problem = [];
// set when this run actually installed something arduino related, which is
// when a compile verification is worth the minutes it costs
let b_installed__arduino = false;

// ─── Step: python venv ──────────────────────────────────────────────

let f_setup_python = async function() {
    f_log_step('python (image stitching)');

    if (!await f_b_binary_exists('python3')) {
        f_log_error('python3 not found — install it (e.g. sudo apt install python3 python3-venv)');
        a_s_problem.push('python3 missing');
        return;
    }

    let b_venv = await f_b_path_exists(s_path__python__venv);
    if (!b_venv) {
        if (b_check_only) {
            f_log_todo('venv missing');
            a_s_problem.push('venv missing');
            return;
        }
        f_log('creating venv...');
        if (!await f_b_run_live('python3', ['-m', 'venv', s_path__venv])) {
            f_log_error('could not create venv — try: sudo apt install python3-venv');
            a_s_problem.push('venv creation failed');
            return;
        }
    }
    f_log_ok(`venv at ${s_path__venv}`);

    // base packages
    let o_import__base = await f_o_run(s_path__python__venv, ['-c', 'import cv2, numpy']);
    if (o_import__base.b_success) {
        f_log_ok('numpy + opencv installed');
    } else if (b_check_only) {
        f_log_todo('numpy + opencv missing');
        a_s_problem.push('numpy/opencv missing');
    } else {
        f_log('installing numpy + opencv...');
        await f_b_run_live(s_path__python__venv, ['-m', 'pip', 'install', '--upgrade', 'pip']);
        if (!await f_b_run_live(s_path__python__venv, ['-m', 'pip', 'install', '-r', s_path__requirement])) {
            f_log_error('pip install failed for numpy/opencv');
            a_s_problem.push('numpy/opencv install failed');
        } else {
            f_log_ok('numpy + opencv installed');
        }
    }

    // stitch.py is what the scan panel runs on its tiles -> make sure it starts
    if (!await f_b_path_exists(s_path__stitch)) {
        f_log_error(`stitch.py not found at ${s_path__stitch} — the scan cannot stitch`);
        a_s_problem.push('stitch.py missing');
    } else {
        let o_stitch = await f_o_run(s_path__python__venv, [s_path__stitch, '--help']);
        if (o_stitch.b_success) {
            f_log_ok('stitch.py runs in the venv');
        } else {
            f_log_error('stitch.py cannot run in the venv:');
            f_log((o_stitch.s_stderr || o_stitch.s_stdout).trim().split('\n').slice(-3).join('\n'));
            a_s_problem.push('stitch.py not runnable');
        }
    }

    // feature matching packages (autostitch.py, and stitch.py --matcher loftr)
    if (b_skip_stitch_ai) {
        f_log_todo('torch + lightglue + kornia skipped (--skip-stitch-ai)');
        return;
    }
    let o_import__ai = await f_o_run(s_path__python__venv, ['-c', 'import torch, lightglue, kornia']);
    if (o_import__ai.b_success) {
        f_log_ok('torch + lightglue + kornia installed');
    } else if (b_check_only) {
        f_log_todo('torch + lightglue + kornia missing (autostitch and the LoFTR rescue matcher will not run)');
        a_s_problem.push('torch/lightglue/kornia missing');
    } else {
        f_log('installing torch (cpu build) + lightglue — this downloads a few hundred MB...');
        let b_torch = await f_b_run_live(s_path__python__venv, [
            '-m', 'pip', 'install', 'torch', 'torchvision',
            '--index-url', s_url__torch_cpu,
        ]);
        if (!b_torch) {
            f_log_error('torch install failed — autostitch will not work, the rest still does');
            a_s_problem.push('torch install failed');
            return;
        }
        if (!await f_b_binary_exists('git')) {
            f_log_error('git not found — needed to install lightglue (sudo apt install git)');
            a_s_problem.push('git missing for lightglue');
            return;
        }
        if (!await f_b_run_live(s_path__python__venv, ['-m', 'pip', 'install', s_url__lightglue])) {
            f_log_error('lightglue install failed — autostitch will not work, the rest still does');
            a_s_problem.push('lightglue install failed');
            return;
        }
        // kornia carries the LoFTR weights stitch.py falls back to
        if (!await f_b_run_live(s_path__python__venv, ['-m', 'pip', 'install', 'kornia'])) {
            f_log_error('kornia install failed — stitch.py --matcher loftr will not work, the rest still does');
            a_s_problem.push('kornia install failed');
            return;
        }
        f_log_ok('torch + lightglue + kornia installed');
    }
};

// ─── Step: cellpose venv (the "Cell pose" panel) ────────────────────
//
// Cellpose gets its own venv: it pins its own numpy / opencv / torch versions
// and must not drag the stitcher stack with it.  The split is the whole point —
// a cellpose upgrade can never break stitch.py.
let f_setup_cellpose = async function() {
    f_log_step('cellpose (AI cell segmentation)');

    // pick the torch build.  an NVIDIA card means a CUDA build even when this
    // shell cannot see /dev/nvidia* — a CUDA torch degrades to the CPU by
    // itself, so guessing "cuda" costs download size at worst, while guessing
    // "cpu" would silently waste the card.  --cpu forces the small build.
    let o_gpu = await f_o_gpu();
    let b_gpu = !b_cpu;
    if(o_gpu.b_usable){
        f_log_ok(`nvidia gpu: ${o_gpu.s_name} (driver ${o_gpu.s_driver}, cuda ${o_gpu.s_cuda || '?'})`);
    } else if(o_gpu.s_name){
        f_log(`nvidia gpu present: ${o_gpu.s_name}`);
        f_log('  but nvidia-smi cannot reach the driver from here — this shell may');
        f_log('  not have the /dev/nvidia* device nodes (container / sandbox / unit)');
        f_log('  installing the CUDA build anyway; torch will use the GPU if the');
        f_log('  process that runs the server can open the device, else the CPU');
    } else {
        f_log_todo('no nvidia gpu found — cellpose will run on the cpu');
    }
    if(!b_gpu) f_log('--cpu given: forcing the cpu build');
    f_log(b_gpu
        ? `torch build: cuda (${s_url__torch_cuda}, ~3 GB)`
        : `torch build: cpu (${s_url__torch_cpu})`);

    if (!await f_b_binary_exists('python3')) {
        f_log_error('python3 not found — install it (e.g. sudo apt install python3 python3-venv)');
        a_s_problem.push('python3 missing for cellpose');
        return;
    }

    let b_venv = await f_b_path_exists(s_path__python__cellpose);
    if (!b_venv) {
        if (b_check_only) {
            f_log_todo('cellpose venv missing (the Cell pose panel will not run)');
            a_s_problem.push('cellpose venv missing');
            return;
        }
        f_log('creating the cellpose venv...');
        if (!await f_b_run_live('python3', ['-m', 'venv', s_path__venv__cellpose])) {
            f_log_error('could not create the cellpose venv — try: sudo apt install python3-venv');
            a_s_problem.push('cellpose venv creation failed');
            return;
        }
    }

    // torch + cellpose + the worker's direct imports; 'packaging' is a missing
    // transitive dependency of fastremap (its import fails without it)
    let s_check = b_gpu
        ? 'import cellpose, torch, cv2, numpy, packaging; assert torch.cuda.is_available(), "cuda not available"'
        : 'import cellpose, torch, cv2, numpy, packaging';
    let o_import = await f_o_run(s_path__python__cellpose, ['-c', s_check]);
    let b_installed__right = o_import.b_success;

    // a venv installed as CPU keeps its +cpu wheels forever; switching builds
    // means reinstalling torch and the nvidia-* runtime packages
    let b_need__torch = !b_installed__right;
    if (b_installed__right) {
        f_log_ok(b_gpu ? 'cellpose + torch (cuda) installed' : 'cellpose + torch (cpu) installed');
    } else if (b_check_only) {
        f_log_todo(b_gpu
            ? 'cellpose + cuda torch missing (the Cell pose panel will not run on the gpu)'
            : 'cellpose missing (the Cell pose panel will not run)');
        a_s_problem.push('cellpose missing');
    } else {
        f_log(b_gpu
            ? 'installing torch (cuda build) + cellpose — this downloads ~3 GB...'
            : 'installing torch (cpu build) + cellpose — this downloads a few hundred MB...');
        await f_b_run_live(s_path__python__cellpose, ['-m', 'pip', 'install', '--upgrade', 'pip']);
        let b_ok = true;
        if(b_need__torch){
            // drop any previous build first: the CUDA wheels and the CPU wheels
            // declare conflicting nvidia-* / cuda-* dependencies, and pip will
            // not swap them in place
            f_log('removing any previous torch build...');
            await f_b_run_live(s_path__python__cellpose, [
                '-m', 'pip', 'uninstall', '-y',
                'torch', 'torchvision', 'torchaudio',
                'triton', 'nvidia-cublas', 'nvidia-cuda-cupti', 'nvidia-cuda-nvrtc',
                'nvidia-cuda-runtime', 'nvidia-cudnn', 'nvidia-cufft', 'nvidia-cufile',
                'nvidia-curand', 'nvidia-cusolver', 'nvidia-cusparse',
                'nvidia-cusparselt', 'nvidia-nccl', 'nvidia-nvjitlink', 'nvidia-nvtx',
                'nvidia-nvshmem', 'cuda-toolkit', 'cuda-bindings', 'cuda-pathfinder',
            ]);
            b_ok = await f_b_run_live(s_path__python__cellpose, [
                '-m', 'pip', 'install', 'torch', 'torchvision',
                '--index-url', b_gpu ? s_url__torch_cuda : s_url__torch_cpu,
            ]);
        }
        if (b_ok) {
            b_ok = await f_b_run_live(s_path__python__cellpose, [
                '-m', 'pip', 'install', '-r', s_path__requirement__cellpose,
            ]);
        }
        if (!b_ok) {
            f_log_error('cellpose install failed — the Cell pose panel will not run, the rest still does');
            a_s_problem.push('cellpose install failed');
            return;
        }
        f_log_ok(b_gpu ? 'cellpose + torch (cuda) installed' : 'cellpose + torch (cpu) installed');
    }

    // the model weights are downloaded on first use into ./weights/cellpose
    // (~1.2 GB for cpsam, ~25 MB for cyto3) — not part of the install
    if (!await f_b_path_exists(s_path__worker__cellpose)) {
        f_log_error(`cellpose_worker.py not found at ${s_path__worker__cellpose}`);
        a_s_problem.push('cellpose_worker.py missing');
        return;
    }
    let o_help = await f_o_run(s_path__python__cellpose, [s_path__worker__cellpose, '--help']);
    if (o_help.b_success) {
        f_log_ok('cellpose_worker.py runs in its venv');
    } else {
        f_log_error('cellpose_worker.py cannot run in its venv:');
        f_log((o_help.s_stderr || o_help.s_stdout).trim().split('\n').slice(-3).join('\n'));
        a_s_problem.push('cellpose_worker.py not runnable');
    }

    // --check must not spend a minute loading a model, but a real run should
    // prove the device actually works — a torch that cannot open the device is
    // the failure this whole step exists to prevent
    if(!b_check_only){
        await f_verify_cellpose();
    }
    f_log('model weights download on first use into weights/cellpose (cpsam ~1.2 GB)');
    f_log('note: the Cellpose *code* is BSD-3, the pretrained *models* are CC-BY-NC');
};

// load a model and report the device it actually runs on.  this is the check
// that catches "driver installed but /dev/nvidia* not usable", which pip cannot.
let f_verify_cellpose = async function() {
    f_log('verifying the cellpose device (loads the model, may take a moment)...');
    let s_path__weights = `${s_root_dir}${s_ds}weights${s_ds}cellpose`;
    let s_script = `
import numpy as np, torch
from cellpose import models
print('torch', torch.__version__)
b_cuda = torch.cuda.is_available()
print('cuda available:', b_cuda)
if b_cuda:
    print('device:', torch.cuda.get_device_name(0))
o_model = models.CellposeModel(gpu=b_cuda)
o_img = np.zeros((128, 128, 3), dtype=np.uint8)
o_model.eval(o_img)
print('DEVICE_OK ' + ('cuda' if b_cuda else 'cpu'))
`;
    // the model cache must point at the project folder: cellpose otherwise
    // wants to write ~/.cellpose, which does not exist on a fresh machine
    let o_command = new Deno.Command(s_path__python__cellpose, {
        args: ['-c', s_script],
        stdout: 'piped',
        stderr: 'piped',
        stdin: 'null',
        env: {
            ...Deno.env.toObject(),
            CELLPOSE_LOCAL_MODELS_PATH: s_path__weights,
        },
    });
    let o_result;
    try {
        o_result = await o_command.output();
    } catch (o_error) {
        f_log_error(`could not run cellpose: ${o_error.message}`);
        a_s_problem.push('cellpose verification failed');
        return false;
    }
    let s_stdout = new TextDecoder().decode(o_result.stdout);
    let s_stderr = new TextDecoder().decode(o_result.stderr);
    for(let s_line of s_stdout.trim().split('\n')){
        if(s_line.trim()) f_log(s_line.trim());
    }
    if(!o_result.success){
        f_log_error('cellpose could not run a segmentation:');
        f_log(s_stderr.trim().split('\n').slice(-4).join('\n'));
        a_s_problem.push('cellpose inference failed');
        return false;
    }
    let s_device = s_stdout.includes('DEVICE_OK cuda') ? 'cuda' : 'cpu';
    f_log_ok(`cellpose inference works on ${s_device.toUpperCase()}`);
    if(b_cpu && s_device === 'cuda'){
        f_log_todo('--cpu was given but the cuda build is active — reinstall with --cpu to shrink it');
    }
    if(!b_cpu && s_device === 'cpu'){
        f_log_todo('torch fell back to the cpu: either this shell cannot open the');
        f_log_todo('device nodes, or the CUDA build does not match the driver.');
        f_log_todo('run the server and check the panel log line "running on CUDA"');
    }
    return true;
};

// ─── Step: arduino-cli ──────────────────────────────────────────────

let f_install_arduino_cli = async function() {
    f_log('downloading arduino-cli...');
    await Deno.mkdir(s_dir__bin, { recursive: true });

    let o_curl = await f_o_run('curl', [
        '-fsSL',
        'https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh',
    ]);
    if (!o_curl.b_success) {
        f_log_error('could not download the arduino-cli installer (no network?)');
        a_s_problem.push('arduino-cli download failed');
        return false;
    }

    let o_command = new Deno.Command('sh', {
        stdin: 'piped',
        stdout: 'inherit',
        stderr: 'inherit',
        env: { ...Deno.env.toObject(), BINDIR: s_dir__bin },
    });
    let o_process = o_command.spawn();
    let o_writer = o_process.stdin.getWriter();
    await o_writer.write(new TextEncoder().encode(o_curl.s_stdout));
    await o_writer.close();
    let o_result = await o_process.output();

    if (!o_result.success || !await f_b_path_exists(s_path__arduino_cli)) {
        f_log_error('arduino-cli installation failed');
        a_s_problem.push('arduino-cli install failed');
        return false;
    }
    return true;
};

let f_setup_arduino = async function() {
    f_log_step('arduino-cli (ESP32 detection + flashing)');

    let s_bin = await f_s_arduino_cli();
    if (!s_bin) {
        if (b_check_only) {
            f_log_todo('arduino-cli missing — the setup page cannot detect the ESP32 without it');
            a_s_problem.push('arduino-cli missing');
            return;
        }
        if (!await f_install_arduino_cli()) return;
        s_bin = s_path__arduino_cli;
    }
    let o_version = await f_o_run(s_bin, ['version']);
    f_log_ok(`arduino-cli: ${o_version.s_stdout.trim() || s_bin}`);

    // esp32 board package
    let o_core = await f_o_run(s_bin, ['core', 'list']);
    if (o_core.s_stdout.includes('esp32:esp32')) {
        f_log_ok('esp32 board package installed');
    } else if (b_check_only) {
        f_log_todo('esp32 board package missing');
        a_s_problem.push('esp32 core missing');
    } else {
        f_log('installing esp32 board package (large download, takes a few minutes)...');
        await f_b_run_live(s_bin, ['core', 'update-index']);
        if (!await f_b_run_live(s_bin, ['core', 'install', 'esp32:esp32'])) {
            f_log_error('esp32 board package install failed');
            a_s_problem.push('esp32 core install failed');
        } else {
            b_installed__arduino = true;
            f_log_ok('esp32 board package installed');
        }
    }

    // arduino libraries required by stepper_websocket.ino
    // 'Async TCP' (ESP32Async fork) provides AsyncTCP.h, which ESPAsyncWebServer.h
    // includes — arduino-cli does NOT pull it in automatically when run non-interactively
    let a_s_name_lib = ['ESP Async WebServer', 'Async TCP', 'ArduinoJson'];
    let o_lib = await f_o_run(s_bin, ['lib', 'list']);
    let a_s_line__lib = o_lib.s_stdout.split('\n');
    let a_s_name_lib__missing = a_s_name_lib.filter(function(s_name) {
        // the name is the first column, so anchor on the line start to keep
        // 'ESP Async WebServer' from being mistaken for a match of 'Async TCP'
        return !a_s_line__lib.some(function(s_line) { return s_line.startsWith(s_name); });
    });

    if (a_s_name_lib__missing.length === 0) {
        f_log_ok('arduino libraries installed');
    } else if (b_check_only) {
        f_log_todo(`arduino libraries missing: ${a_s_name_lib__missing.join(', ')}`);
        a_s_problem.push('arduino libraries missing');
    } else {
        // the me-no-dev forks conflict with esp32 core 3.x, remove them first
        let s_dir__lib__arduino = `${Deno.env.get('HOME')}${s_ds}Arduino${s_ds}libraries`;
        for (let s_name_lib__old of ['ESPAsyncWebServer', 'AsyncTCP', 'ESPAsyncTCP']) {
            try {
                await Deno.remove(`${s_dir__lib__arduino}${s_ds}${s_name_lib__old}`, { recursive: true });
                f_log(`removed conflicting library: ${s_name_lib__old}`);
            } catch { /* not present, fine */ }
        }
        for (let s_name_lib of a_s_name_lib__missing) {
            f_log(`installing ${s_name_lib}...`);
            await f_b_run_live(s_bin, ['lib', 'install', s_name_lib]);
        }
        b_installed__arduino = true;
        f_log_ok('arduino libraries installed');
    }

    if (!b_check_only && (b_installed__arduino || b_verify_compile)) {
        await f_b_verify_compile(s_bin);
    }
};

// ─── Step: verify the firmware really compiles ──────────────────────

// installing the libraries is not proof that they are complete — a missing
// transitive header (AsyncTCP.h) only shows up at compile time. so compile the
// firmware once against dummy values to prove the toolchain is whole.
let f_b_verify_compile = async function(s_bin) {
    f_log_step('verifying the firmware compiles');

    let s_ino;
    try {
        s_ino = await Deno.readTextFile(s_path__ino);
    } catch {
        f_log_error(`could not read ${s_path__ino}`);
        a_s_problem.push('firmware template missing');
        return false;
    }

    // pin placeholders are bare numbers in an int array, the rest are string literals
    let s_ino__verify = s_ino
        .replace(/\{\{n_pin[^}]*\}\}/g, '1')
        .replace(/\{\{[^}]*\}\}/g, 'verify');

    await Deno.mkdir(s_dir__verify, { recursive: true });
    await Deno.writeTextFile(s_path__ino__verify, s_ino__verify);

    f_log('compiling (first run takes a few minutes)...');
    let o_compile = await f_o_run(s_bin, ['compile', '--fqbn', s_fqbn, s_dir__verify]);
    if (!o_compile.b_success) {
        f_log_error('firmware does not compile — a dependency is still missing:');
        let a_s_line = (o_compile.s_stderr + '\n' + o_compile.s_stdout)
            .split('\n')
            .filter(function(s_line) { return s_line.trim() !== ''; });
        let a_s_line__error = a_s_line.filter(function(s_line) {
            return s_line.includes('error') || s_line.includes('No such file');
        });
        // never report a failure with no detail: fall back to the tail of the output
        let a_s_line__report = a_s_line__error.length > 0
            ? a_s_line__error.slice(0, 8)
            : a_s_line.slice(-8);
        for (let s_line of a_s_line__report) {
            f_log(s_line.trim());
        }
        a_s_problem.push('firmware compile failed');
        return false;
    }
    f_log_ok('firmware compiles — all arduino dependencies present');
    return true;
};

// ─── Step: serial port access ───────────────────────────────────────

let f_check_serial = async function() {
    f_log_step('serial port access');

    let a_s_path__port = [];
    for (let s_dir_entry of ['/dev']) {
        try {
            for await (let o_entry of Deno.readDir(s_dir_entry)) {
                if (o_entry.name.startsWith('ttyUSB') || o_entry.name.startsWith('ttyACM')) {
                    a_s_path__port.push(`${s_dir_entry}/${o_entry.name}`);
                }
            }
        } catch { /* not linux, or /dev unreadable */ }
    }

    if (a_s_path__port.length === 0) {
        f_log_todo('no ttyUSB*/ttyACM* device found — plug in the ESP32 over USB');
        return;
    }
    f_log_ok(`serial device(s): ${a_s_path__port.join(', ')}`);

    let o_group = await f_o_run('id', ['-nG']);
    if (o_group.b_success && !o_group.s_stdout.split(/\s+/).includes('dialout')) {
        f_log_todo('you are not in the "dialout" group, so flashing needs a sudo password each time');
        f_log('permanent fix:  sudo usermod -aG dialout $USER   (then log out and back in)');
    } else if (o_group.b_success) {
        f_log_ok('user is in the "dialout" group');
    }
};

// ─── Run ────────────────────────────────────────────────────────────

console.log(`
  ╔══════════════════════════════════════╗
  ║   Microscope Motorization            ║
  ║   ${b_check_only ? 'Dependency check                  ' : 'Dependency install                '} ║
  ╚══════════════════════════════════════╝`);

if (!b_skip_python) await f_setup_python();
if (!b_skip_python && !b_skip_cellpose) await f_setup_cellpose();
if (!b_skip_arduino) await f_setup_arduino();
await f_check_serial();

if (a_s_problem.length === 0) {
    console.log('\n  ✓ everything is ready\n');
} else if (b_check_only) {
    console.log(`\n  ○ ${a_s_problem.length} thing(s) not installed yet — run: deno task install\n`);
} else {
    console.log(`\n  ✗ finished with problem(s):\n${a_s_problem.map(function(s) { return `      - ${s}`; }).join('\n')}\n`);
    // do not block the server from starting: partial installs still run most features
}
