// Shared by the browser and firmware generator. RGBWW/RGBCW mean RGB + one
// white channel here, matching led_test_mgc.ino (not a five-channel RGB+CCT LED).
let f_o_hardware_led_config = function(o_config = {}) {
    let n_rgb = o_config?.s_protocol === 'rgb' ? 255 : 0;
    return {
        b_enabled: false,
        n_pin: 21,
        n_count: 1,
        s_protocol: 'rgbw',
        s_order: 'grb',
        ...o_config,
        o_startup: {
            b_on: true, n_red: n_rgb, n_green: n_rgb, n_blue: n_rgb, n_white: n_rgb ? 0 : 255, n_brightness: 8,
            ...o_config?.o_startup,
        },
    };
};

let f_s_hardware_led_output_error = function(o_output) {
    if (!o_output || typeof o_output.b_on !== 'boolean') return 'Choose whether the LED is on.';
    for (let s_key of ['n_red', 'n_green', 'n_blue', 'n_white', 'n_brightness']) {
        if (!Number.isInteger(o_output[s_key]) || o_output[s_key] < 0 || o_output[s_key] > 255) {
            return 'LED channel values and brightness must be whole numbers from 0 to 255.';
        }
    }
    return '';
};

let f_s_hardware_led_config_error = function(o_config, a_o_pin_config = []) {
    if (!o_config || typeof o_config !== 'object' || Array.isArray(o_config)) return 'Invalid LED configuration.';
    if (typeof o_config.b_enabled !== 'boolean') return 'Invalid LED enable setting.';
    if (!['rgbw', 'rgb'].includes(o_config.s_protocol)) return 'Choose RGBW or RGB LED protocol.';
    if (!['grb', 'rgb'].includes(o_config.s_order)) return 'Choose GRB or RGB colour order.';
    if (!Number.isInteger(o_config.n_count) || o_config.n_count < 1 || o_config.n_count > 16) return 'Choose 1–16 LEDs.';
    let s_error = f_s_hardware_led_output_error(o_config.o_startup);
    if (s_error) return s_error;
    if (o_config.s_protocol === 'rgb' && o_config.o_startup.n_white !== 0) return 'RGB LEDs have no separate white channel; set startup white to zero.';
    if (!o_config.b_enabled) return '';
    // ESP32-S3: exclude USB, UART0, flash/PSRAM, strapping and nonexistent pins.
    let n_pin = o_config.n_pin;
    if (!Number.isInteger(n_pin) || !([1, 2, 21, 47, 48].includes(n_pin) ||
        (n_pin >= 4 && n_pin <= 18) || (n_pin >= 38 && n_pin <= 42))) {
        return 'Choose a free ESP32-S3 GPIO: 1–2, 4–18, 21, 38–42 or 47–48. Check your board wiring.';
    }
    if (a_o_pin_config.some(o_pin => [1, 2, 3, 4].some(n_idx => Number(o_pin['n_pin' + n_idx]) === n_pin))) {
        return `LED GPIO ${n_pin} is already assigned to a motor.`;
    }
    return '';
};

export { f_o_hardware_led_config, f_s_hardware_led_config_error, f_s_hardware_led_output_error };
