import { createHash } from "node:crypto";
import { s_root_dir, s_ds } from "./runtimedata.module.js";

let s_path__ino_template = `${s_root_dir}${s_ds}stepper_websocket.ino`;
let s_path__tmp_dir = '/tmp/stepper_websocket';

// ─── Helpers ────────────────────────────────────────────────────────

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

let f_run_and_stream = async function(s_cmd, a_s_arg, f_on_line) {
    let o_command = new Deno.Command(s_cmd, {
        args: a_s_arg,
        stdout: 'piped',
        stderr: 'piped',
        stdin: 'null',
    });
    let o_process = o_command.spawn();

    let f_read_stream = async function(o_stream, s_source) {
        let o_reader = o_stream.getReader();
        let o_decoder = new TextDecoder();
        let s_buffer = '';
        while (true) {
            let { done, value } = await o_reader.read();
            if (done) break;
            s_buffer += o_decoder.decode(value, { stream: true });
            let a_s_line = s_buffer.split('\n');
            s_buffer = a_s_line.pop();
            for (let s_line of a_s_line) {
                f_on_line(s_line, s_source);
            }
        }
        if (s_buffer) f_on_line(s_buffer, s_source);
    };

    await Promise.all([
        f_read_stream(o_process.stdout, 'stdout'),
        f_read_stream(o_process.stderr, 'stderr'),
    ]);

    let o_status = await o_process.status;
    return o_status.success;
};

// ─── Find arduino-cli binary ────────────────────────────────────────

let f_s_arduino_cli_bin = async function() {
    // check PATH first
    let o_result = await f_run('which', ['arduino-cli']);
    if (o_result.b_success) {
        return o_result.s_stdout.trim();
    }
    // check ~/.local/bin
    let s_home = Deno.env.get('HOME');
    let s_path = `${s_home}/.local/bin/arduino-cli`;
    try {
        await Deno.stat(s_path);
        return s_path;
    } catch {
        return null;
    }
};

// ─── Detect ESP32 on USB ────────────────────────────────────────────

let f_o_detect_esp_usb = async function() {
    let s_bin = await f_s_arduino_cli_bin();
    if (!s_bin) {
        return { b_detected: false, s_port: '', s_error: 'arduino-cli not found' };
    }

    let o_result = await f_run(s_bin, ['board', 'list', '--format', 'json']);
    if (!o_result.b_success) {
        return { b_detected: false, s_port: '', s_error: 'Failed to list boards' };
    }

    let a_o_board = [];
    try {
        let o_parsed = JSON.parse(o_result.s_stdout);
        a_o_board = Array.isArray(o_parsed) ? o_parsed : (o_parsed.detected_ports ?? []);
    } catch {
        return { b_detected: false, s_port: '', s_error: 'Failed to parse board list' };
    }

    for (let o_entry of a_o_board) {
        let o_port = o_entry.port ?? o_entry;
        let s_address = o_port.address ?? o_port.port ?? '';
        if (s_address && (s_address.includes('ttyUSB') || s_address.includes('ttyACM'))) {
            return { b_detected: true, s_port: s_address, s_error: '' };
        }
    }

    return { b_detected: false, s_port: '', s_error: 'No ESP32 found on USB' };
};

// ─── Check arduino-cli status ───────────────────────────────────────

let f_o_check_arduino_cli = async function() {
    let s_bin = await f_s_arduino_cli_bin();
    if (!s_bin) {
        return { b_installed: false, s_version: '', s_bin: '' };
    }
    let o_result = await f_run(s_bin, ['version']);
    return {
        b_installed: true,
        s_version: o_result.s_stdout.trim(),
        s_bin: s_bin,
    };
};

// ─── Generate .ino firmware from template ───────────────────────────

let f_generate_ino = async function(s_wifi_ssid, s_wifi_password, a_o_pin_config, s_dir = s_path__tmp_dir) {
    let s_ino = await Deno.readTextFile(s_path__ino_template);

    // replace WiFi placeholders
    s_ino = s_ino.replace('{{wifi_ssid}}', () => JSON.stringify(s_wifi_ssid || '').slice(1, -1));
    s_ino = s_ino.replace('{{wifi_password}}', () => JSON.stringify(s_wifi_password || '').slice(1, -1));

    // replace pin placeholders for each motor
    for (let n_idx = 0; n_idx < a_o_pin_config.length; n_idx++) {
        let o_pin = a_o_pin_config[n_idx];
        s_ino = s_ino.replace(`{{n_pin1__motor_${n_idx}}}`, String(o_pin.n_pin1));
        s_ino = s_ino.replace(`{{n_pin2__motor_${n_idx}}}`, String(o_pin.n_pin2));
        s_ino = s_ino.replace(`{{n_pin3__motor_${n_idx}}}`, String(o_pin.n_pin3));
        s_ino = s_ino.replace(`{{n_pin4__motor_${n_idx}}}`, String(o_pin.n_pin4));
    }

    await Deno.mkdir(s_dir, { recursive: true });
    await Deno.writeTextFile(`${s_dir}/stepper_websocket.ino`, s_ino);

    return `${s_dir}/stepper_websocket.ino`;
};

// ─── Install arduino-cli ────────────────────────────────────────────

let f_install_arduino_cli = async function(f_on_line) {
    let s_home = Deno.env.get('HOME');
    let s_bin_dir = `${s_home}/.local/bin`;

    await Deno.mkdir(s_bin_dir, { recursive: true });

    f_on_line('Downloading arduino-cli installer...', 'stdout');

    let o_curl = await f_run('curl', [
        '-fsSL',
        'https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh',
    ]);
    if (!o_curl.b_success) {
        f_on_line('Failed to download arduino-cli installer', 'stderr');
        return false;
    }

    f_on_line('Running installer...', 'stdout');

    let o_command = new Deno.Command('sh', {
        stdin: 'piped',
        stdout: 'piped',
        stderr: 'piped',
        env: { ...Deno.env.toObject(), BINDIR: s_bin_dir },
    });
    let o_process = o_command.spawn();
    let o_writer = o_process.stdin.getWriter();
    await o_writer.write(new TextEncoder().encode(o_curl.s_stdout));
    await o_writer.close();

    let f_read_stream = async function(o_stream, s_source) {
        let o_reader = o_stream.getReader();
        let o_decoder = new TextDecoder();
        let s_buffer = '';
        while (true) {
            let { done, value } = await o_reader.read();
            if (done) break;
            s_buffer += o_decoder.decode(value, { stream: true });
            let a_s_line = s_buffer.split('\n');
            s_buffer = a_s_line.pop();
            for (let s_line of a_s_line) {
                f_on_line(s_line, s_source);
            }
        }
        if (s_buffer) f_on_line(s_buffer, s_source);
    };

    await Promise.all([
        f_read_stream(o_process.stdout, 'stdout'),
        f_read_stream(o_process.stderr, 'stderr'),
    ]);

    let o_status = await o_process.status;
    return o_status.success;
};

// ─── Install ESP32 board package + libraries ────────────────────────

let f_install_esp32_deps = async function(f_on_line) {
    let s_bin = await f_s_arduino_cli_bin();
    if (!s_bin) return false;

    f_on_line('Updating arduino-cli core index...', 'stdout');
    let b_ok = await f_run_and_stream(s_bin, ['core', 'update-index'], f_on_line);
    if (!b_ok) return false;

    f_on_line('Installing ESP32 board package (this may take a few minutes)...', 'stdout');
    b_ok = await f_run_and_stream(s_bin, ['core', 'install', 'esp32:esp32'], f_on_line);
    if (!b_ok) return false;

    // remove old conflicting libraries
    let s_lib_dir = `${Deno.env.get('HOME')}/Arduino/libraries`;
    for (let s_old_lib of ['ESPAsyncWebServer', 'AsyncTCP', 'ESPAsyncTCP']) {
        try {
            await Deno.remove(`${s_lib_dir}/${s_old_lib}`, { recursive: true });
            f_on_line(`Removed old conflicting library: ${s_old_lib}`, 'stdout');
        } catch { /* not present */ }
    }

    // 'Async TCP' (ESP32Async fork) provides AsyncTCP.h, which ESPAsyncWebServer.h includes.
    // arduino-cli does not resolve it automatically here, so install it explicitly.
    for (let s_lib of ['ESP Async WebServer', 'Async TCP', 'ArduinoJson']) {
        f_on_line(`Installing ${s_lib}...`, 'stdout');
        b_ok = await f_run_and_stream(s_bin, ['lib', 'install', s_lib], f_on_line);
        if (!b_ok) {
            f_on_line(`Failed to install ${s_lib}`, 'stderr');
            return false;
        }
    }

    return true;
};

// Only compilation runs on the server; the browser owns the USB device.
let b_building = false;
let f_compile_esp = async function(s_wifi_ssid, s_wifi_password, a_o_pin_config, f_on_line) {
    if (b_building) return { b_success: false, s_error: 'Another firmware build is running. Try again when it finishes.' };
    b_building = true;
    let s_dir;
    try {
        let s_bin = await f_s_arduino_cli_bin();
        if (!s_bin) {
            if (!await f_install_arduino_cli(f_on_line)) throw new Error('Failed to install arduino-cli');
            s_bin = await f_s_arduino_cli_bin();
        }
        if (!await f_install_esp32_deps(f_on_line)) throw new Error('Failed to install ESP32 dependencies');
        s_dir = await Deno.makeTempDir({ prefix: 'microscope-firmware-' });
        let s_sketch = `${s_dir}/stepper_websocket`;
        await f_generate_ino(s_wifi_ssid, s_wifi_password, a_o_pin_config, s_sketch);
        let s_output = `${s_dir}/output`;
        f_on_line('--- Compiling ESP32-S3 firmware ---', 'stdout');
        if (!await f_run_and_stream(s_bin, [
            'compile', '--fqbn', 'esp32:esp32:esp32s3', '--output-dir', s_output, s_sketch,
        ], f_on_line)) throw new Error('Compilation failed');
        let a_o_image = [];
        for (let [s_suffix, n_address] of [['bootloader.bin', 0], ['partitions.bin', 0x8000], ['bin', 0x10000]]) {
            let a_bytes = await Deno.readFile(`${s_output}/stepper_websocket.ino.${s_suffix}`);
            a_o_image.push(f_o_image(a_bytes, n_address));
        }
        // The Arduino core's merged image includes its matching OTA boot selector.
        let a_merged = await Deno.readFile(`${s_output}/stepper_websocket.ino.merged.bin`);
        if (a_merged.length < 0x10000) throw new Error('Incomplete merged firmware image');
        a_o_image.splice(2, 0, f_o_image(a_merged.slice(0xe000, 0x10000), 0xe000));
        f_on_line('Firmware ready for browser USB upload.', 'stdout');
        return { b_success: true, s_chip: 'ESP32-S3', a_o_image };
    } catch (o_error) {
        return { b_success: false, s_error: o_error.message };
    } finally {
        b_building = false;
        if (s_dir) await Deno.remove(s_dir, { recursive: true });
    }
};

function f_o_image(a_bytes, n_address) {
    let a_padded = new Uint8Array(Math.ceil(a_bytes.length / 4) * 4).fill(0xff);
    a_padded.set(a_bytes);
    a_bytes = a_padded;
    let s_binary = '';
    for (let n = 0; n < a_bytes.length; n += 8192) {
        s_binary += String.fromCharCode(...a_bytes.subarray(n, n + 8192));
    }
    return { n_address, s_base64: btoa(s_binary), s_md5: createHash('md5').update(a_bytes).digest('hex') };
}

export {
    f_o_detect_esp_usb, f_o_check_arduino_cli, f_generate_ino,
    f_compile_esp, f_install_arduino_cli, f_install_esp32_deps,
};
