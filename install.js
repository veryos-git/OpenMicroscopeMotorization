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
// the scan panel stitches its tiles with this script
let s_path__stitch = `${s_root_dir}${s_ds}stitch.py`;
let s_dir__bin = `${Deno.env.get('HOME')}${s_ds}.local${s_ds}bin`;
let s_path__arduino_cli = `${s_dir__bin}${s_ds}arduino-cli`;

let s_url__lightglue = 'git+https://github.com/cvg/LightGlue.git';
let s_url__torch_cpu = 'https://download.pytorch.org/whl/cpu';

let s_path__ino = `${s_root_dir}${s_ds}stepper_websocket.ino`;
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
let b_verify_compile = a_s_arg.includes('--verify-compile');

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
