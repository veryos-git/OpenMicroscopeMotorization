# Optional hardware LED

The controller supports an optional addressable RGB LED with one separate white
channel. RGBWW and RGBCW describe the white emitter's colour temperature here;
five-channel RGB+CCT modules are not supported. No additional LED library is
needed. The implementation uses Arduino-ESP32 3.x RMT and follows the supplied
[tested reference sketch](led_test_mgc.ino). The actual module's chip and data
format still need confirmation.

## Configure and flash

1. Open **Setup → Optional hardware LED** and enable the option. Existing setups
   keep it disabled, with no LED GPIO or RMT channel initialized.
2. Choose a free **LED data GPIO**. The suggestion is GPIO 21. GPIO 18 from the
   reference sketch is already used by Motor 2 in the default microscope wiring.
   Motor conflicts and reserved ESP32-S3 pins are rejected in the UI, firmware
   generator and firmware initialization. Check your specific board for other
   peripherals that also use the selected pin.
3. Leave **LED count** at one, or select 2–16 chained LEDs. Connect DOUT to the
   next DIN; every configured LED receives the same colour and brightness.
4. Select the protocol and byte order matching your module:

   | Protocol | Channel order | White channel |
   | --- | --- | --- |
   | SK6812-style RGBW, 32 bits | GRBW (default) or RGBW | Separate warm or cool white |
   | WS2812/WS2812B-style RGB, 24 bits | GRB or RGB | None; RGB can mix white |

5. **Startup light** defaults to on, RGB zero, white 255, brightness 8/255.
   Selecting RGB converts the white-only startup into an RGB white mix. Startup
   settings are saved in the application and included in the generated firmware.
6. Use **Generate Firmware & Flash ESP32** below. After verification and USB
   reconnection, the UI shows the flashed LED configuration and live controls.

Connect the GPIO to the module's **DIN**, use its specified supply voltage, and
connect LED supply ground to ESP32 ground. Match the module's required data
voltage; use a suitable level shifter where necessary. The software does not
detect the attached LED, its voltage, chip, byte order or chain length.

The available GPIO choices exclude flash/PSRAM, USB, UART0 and strapping pins.
The restrictions follow the ESP32-S3 target used by this project's flasher;
board-specific wiring still matters. See Espressif's
[GPIO documentation](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/gpio.html).

## Live control

Open the **LED** window from the LED icon beside the camera selector in the main
toolbar, or **Tools → Image → LED**. The window is available without opening Setup
and follows the drawing in [overlay_led_control](overlay_led_control/).
It has one slider and one percent field for each channel: **RED**, **GREEN**,
**BLUE** and **WW/CW** (the module's single warm or cold white emitter; hidden
for RGB-only firmware). Every change is sent immediately, without an apply
button. While a slider is dragged, only one command is in flight; the latest
value follows as soon as the controller replies, so the USB link is not flooded.
Set all channels to 0 % for off.

Percentages describe the real output of each emitter: live commands use full
brightness (255) and map 0–100 % to 0–255, with 0.1 % steps so the dim levels
used for illumination remain reachable. A firmware output with a different
brightness, such as the startup light, is shown as its effective percentage
(white 255 at brightness 8 is 3.1 %).

Live output lives in the controller's RAM and survives a browser reconnect.
Restarting the controller restores the flashed startup settings. Changing GPIO,
count, protocol, order, startup values or the enable option requires flashing.
The UI reports when saved settings differ from the connected firmware and uses
that firmware's protocol for live controls. Older firmware displays upgrade
guidance. Controller initialization and transmission errors appear in the LED
window and Setup. Wiring, protocol and startup configuration remain in Setup,
opened with the setup icon in the LED window header (its tooltip shows the
flashed GPIO, LED count and protocol).

The legacy `deno task flash` terminal workflow generates default motor pins with
the LED disabled; use Hardware Setup for an LED-enabled build.

## Firmware API and timing

Newline-delimited USB serial JSON accepts:

```json
{"command":"setLed","b_on":true,"n_red":0,"n_green":0,"n_blue":0,"n_white":255,"n_brightness":8}
```

Fields other than `command` are optional and retain their previous value when
omitted. Invalid types, null values and values outside 0–255 are rejected before
any output changes. RGB-only firmware rejects nonzero white. Errors have
`type: "hardwareLedError"` and an `error` message. Valid commands return the
normal motor `status` with `o_hardware_led` containing `o_config`, `o_output`,
`b_ready`, `b_pending` and `s_error`. Output status describes the controller's
requested output; these LEDs do not acknowledge reception.

Each byte is sent most-significant bit first at a 10 MHz RMT tick rate. The
reference timing is preserved: RGBW zero/one high-low durations are 3/9 and 6/6
ticks; RGB uses 4/8 and 8/4. A 350 µs LOW latch follows the complete frame.
RMT sends both data and latch asynchronously, and only the main loop owns the
transmit buffer. Commands arriving during transmission queue the latest output
without rewriting the in-flight buffer. See Espressif's
[RMT API documentation](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/rmt.html).

## Verification

```sh
deno test -A tests/hardware_led_test.js tests/hardware_led_firmware_test.js tests/hardware_led_browser_test.js
```

The firmware host test runs the actual generated LED code with mocked GPIO/RMT.
It checks all channel orders, brightness, startup, multiple LEDs, off, queued
updates, validation and initialization/transmission failures. It needs `g++`
and the installed ArduinoJson headers; set `ARDUINOJSON_INCLUDE` if those headers
are elsewhere. It is skipped if ArduinoJson is absent. The browser test uses
local headless Chrome and a simulated controller; it does not send hardware
commands. ESP32-S3 compilation was also checked with Arduino-ESP32 3.3.12 for
disabled, RGBW and RGB builds. Physical output still needs checking on the
actual module, starting at low brightness.
