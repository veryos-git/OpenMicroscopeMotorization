import { s_root_dir, s_ds } from "./runtimedata.module.js";

let s_path__ino_template = `${s_root_dir}${s_ds}stepper_websocket.ino`;
let s_path__tmp_dir = '/tmp/stepper_websocket';
let s_path__tmp_ino = `${s_path__tmp_dir}/stepper_websocket.ino`;

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

let f_generate_ino = async function(s_wifi_ssid, s_wifi_password, a_o_pin_config) {
    let s_ino = await Deno.readTextFile(s_path__ino_template);

    // replace WiFi placeholders
    s_ino = s_ino.replace('{{wifi_ssid}}', s_wifi_ssid);
    s_ino = s_ino.replace('{{wifi_password}}', s_wifi_password);

    // replace pin placeholders for each motor
    for (let n_idx = 0; n_idx < a_o_pin_config.length; n_idx++) {
        let o_pin = a_o_pin_config[n_idx];
        s_ino = s_ino.replace(`{{n_pin1__motor_${n_idx}}}`, String(o_pin.n_pin1));
        s_ino = s_ino.replace(`{{n_pin2__motor_${n_idx}}}`, String(o_pin.n_pin2));
        s_ino = s_ino.replace(`{{n_pin3__motor_${n_idx}}}`, String(o_pin.n_pin3));
        s_ino = s_ino.replace(`{{n_pin4__motor_${n_idx}}}`, String(o_pin.n_pin4));
    }

    await Deno.mkdir(s_path__tmp_dir, { recursive: true });
    await Deno.writeTextFile(s_path__tmp_ino, s_ino);

    return s_path__tmp_ino;
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

// ─── Full flash pipeline ────────────────────────────────────────────

let f_flash_esp = async function(s_port, s_wifi_ssid, s_wifi_password, a_o_pin_config, f_on_line, f_s_request_password) {
    let s_bin = await f_s_arduino_cli_bin();
    if (!s_bin) {
        f_on_line('arduino-cli not found. Installing...', 'stdout');
        let b_installed = await f_install_arduino_cli(f_on_line);
        if (!b_installed) {
            return { b_success: false, s_ip__esp: '', s_error: 'Failed to install arduino-cli' };
        }
        s_bin = await f_s_arduino_cli_bin();
        if (!s_bin) {
            return { b_success: false, s_ip__esp: '', s_error: 'arduino-cli still not found after install' };
        }
    }

    // install deps
    f_on_line('--- Installing ESP32 dependencies ---', 'stdout');
    let b_deps = await f_install_esp32_deps(f_on_line);
    if (!b_deps) {
        return { b_success: false, s_ip__esp: '', s_error: 'Failed to install ESP32 dependencies' };
    }

    // generate firmware
    f_on_line('--- Generating firmware ---', 'stdout');
    await f_generate_ino(s_wifi_ssid, s_wifi_password, a_o_pin_config);
    f_on_line('Firmware generated with custom pin configuration.', 'stdout');

    // fix serial port permissions if needed
    try {
        let o_file = await Deno.open(s_port, { read: true });
        o_file.close();
    } catch {
        f_on_line(`Need permission to access ${s_port}. Please enter your sudo password.`, 'stdout');
        let s_sudo_password = '';
        if (f_s_request_password) {
            s_sudo_password = await f_s_request_password();
        }
        if (!s_sudo_password) {
            return { b_success: false, s_ip__esp: '', s_error: 'No password provided for serial port permissions' };
        }
        let o_command = new Deno.Command('sudo', {
            args: ['-S', 'chmod', '666', s_port],
            stdout: 'piped',
            stderr: 'piped',
            stdin: 'piped',
        });
        let o_process = o_command.spawn();
        let o_writer = o_process.stdin.getWriter();
        await o_writer.write(new TextEncoder().encode(s_sudo_password + '\n'));
        await o_writer.close();
        let o_status = await o_process.status;
        if (!o_status.success) {
            return { b_success: false, s_ip__esp: '', s_error: 'Failed to fix serial port permissions (wrong password?)' };
        }
        f_on_line(`Permissions fixed on ${s_port}.`, 'stdout');
    }

    // compile
    f_on_line('--- Compiling firmware (this may take a while on first run) ---', 'stdout');
    let b_compiled = await f_run_and_stream(s_bin, [
        'compile',
        '--fqbn', 'esp32:esp32:esp32s3',
        s_path__tmp_dir,
    ], f_on_line);

    if (!b_compiled) {
        return { b_success: false, s_ip__esp: '', s_error: 'Compilation failed' };
    }
    f_on_line('Compilation successful!', 'stdout');

    // upload
    f_on_line(`--- Uploading firmware to ${s_port} ---`, 'stdout');
    let b_uploaded = await f_run_and_stream(s_bin, [
        'upload',
        '--fqbn', 'esp32:esp32:esp32s3',
        '-p', s_port,
        s_path__tmp_dir,
    ], f_on_line);

    if (!b_uploaded) {
        return { b_success: false, s_ip__esp: '', s_error: 'Upload failed' };
    }
    f_on_line('Firmware uploaded successfully!', 'stdout');

    // read serial for IP
    f_on_line('--- Waiting for ESP32 to connect to WiFi (30s timeout) ---', 'stdout');
    let s_ip__esp = '';
    try {
        s_ip__esp = await f_s_read_serial_ip(s_bin, s_port, 30000, f_on_line);
        f_on_line(`ESP32 connected! IP: ${s_ip__esp}`, 'stdout');
    } catch (o_err) {
        f_on_line(`Could not detect ESP32 IP automatically: ${o_err.message}`, 'stderr');
        f_on_line('You can enter the IP manually on the setup page.', 'stderr');
    }

    return { b_success: true, s_ip__esp: s_ip__esp, s_error: '' };
};

// ─── Read ESP32 IP from serial output ───────────────────────────────

let f_s_read_serial_ip = async function(s_bin, s_port, n_ms__timeout, f_on_line) {
    // configure baud rate directly via stty — much faster than arduino-cli monitor
    await f_run('stty', ['-F', s_port, '115200', 'raw', '-echo', '-echoe', '-echok']);

    let o_file = await Deno.open(s_port, { read: true });
    let o_reader = o_file.readable.getReader();
    let o_decoder = new TextDecoder();
    let s_buffer = '';

    let o_promise__timeout = new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error('timeout')); }, n_ms__timeout);
    });

    let o_promise__read = (async function() {
        while (true) {
            let { done, value } = await o_reader.read();
            if (done) break;
            let s_chunk = o_decoder.decode(value, { stream: true });
            s_buffer += s_chunk;
            if (s_chunk.trim()) {
                f_on_line(s_chunk.trim(), 'stdout');
            }

            let o_match = s_buffer.match(/IP:\s*(\d+\.\d+\.\d+\.\d+)/);
            if (o_match) {
                return o_match[1];
            }
        }
        throw new Error('Serial closed without IP');
    })();

    try {
        return await Promise.race([o_promise__read, o_promise__timeout]);
    } finally {
        try { o_reader.cancel(); } catch { /* ignore */ }
        try { o_file.close(); } catch { /* ignore */ }
    }
};

export {
    f_o_detect_esp_usb,
    f_o_check_arduino_cli,
    f_generate_ino,
    f_flash_esp,
    f_install_arduino_cli,
    f_install_esp32_deps,
};
