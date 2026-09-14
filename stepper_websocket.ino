/**
 * ESP32-S3 — Three 28BYJ-48 steppers, WebSocket + USB Serial API
 *
 * Libraries required (Arduino Library Manager):
 *   - ESP Async WebServer  (by mathieucarbou)
 *   - AsyncTCP             (by mathieucarbou)
 *   - ArduinoJson          (by Benoît Blanchon)
 *
 * Wiring (ULN2003 driver boards, external 5 V supply):
 *   Motor 0: GPIO4, GPIO5, GPIO6, GPIO7
 *   Motor 1: GPIO15, GPIO16, GPIO17, GPIO18
 *   Motor 2: GPIO8, GPIO9, GPIO10, GPIO11
 *
 * WebSocket endpoint: ws://<ESP_IP>/ws
 * USB Serial endpoint: 115200 baud, one JSON command per line (newline-terminated)
 *
 * The same JSON API is served over both transports. Responses go back over the
 * transport the command arrived on. USB Serial (Web Serial API in the browser)
 * is the low-latency primary path; WebSocket remains as a network fallback.
 *
 * API (JSON):
 *   → { "motor": 0, "command": "runContinuous", "n_rpm": 10.0, "direction": "cw" }
 *   → { "motor": 0, "command": "moveSteps", "n_step": 500, "n_rpm": 8.0 }
 *   → { "motor": 0, "command": "stop" }
 *   → { "motor": 0, "command": "setBacklash", "n_step__backlash": 25 }
 *   → { "command": "stopAll" }
 *   → { "command": "status" }
 *   → { "command": "circleStart", "n_step__radius": 100, "n_rpm": 8.0, "b_loop": false }
 *   → { "command": "circleStop" }
 *   ← { "type":"status", "a_o_motor":[ {n_rpm,s_direction,b_running,n_position,s_mode,n_step__remaining,n_step__backlash,b_compensating}, ... ] }
 *   ← { "type":"moveComplete", "motor": 0, "n_position": 1734 }
 *   ← { "type":"moveCancelled", "motor": 0, "n_position": 1200 }
 *   ← { "type":"circleComplete" }
 *   ← { "type":"circleStopped" }
 */

#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>

// ─── WiFi credentials ───────────────────────────────────────────────
const char* WIFI_SSID = "{{wifi_ssid}}";
const char* WIFI_PASS = "{{wifi_password}}";

// ─── Motor hardware ─────────────────────────────────────────────────

static const int NUM_MOTORS = 3;

static const uint8_t MOTOR_PINS[NUM_MOTORS][4] = {
    { {{n_pin1__motor_0}}, {{n_pin2__motor_0}}, {{n_pin3__motor_0}}, {{n_pin4__motor_0}} },
    { {{n_pin1__motor_1}}, {{n_pin2__motor_1}}, {{n_pin3__motor_1}}, {{n_pin4__motor_1}} },
    { {{n_pin1__motor_2}}, {{n_pin2__motor_2}}, {{n_pin3__motor_2}}, {{n_pin4__motor_2}} },
};

static const uint8_t HALF_STEP_SEQ[8][4] = {
    {1,0,0,0}, {1,1,0,0}, {0,1,0,0}, {0,1,1,0},
    {0,0,1,0}, {0,0,1,1}, {0,0,0,1}, {1,0,0,1},
};

static const int SEQ_LEN            = 8;
static const int HALF_STEPS_PER_REV = 4096;

static const float N_RPM__BACKLASH_BURST = 10.0;

// ─── Move modes ─────────────────────────────────────────────────────

enum MoveMode {
    MODE_IDLE       = 0,
    MODE_CONTINUOUS = 1,
    MODE_STEPS      = 2,
};

// ─── Motor state ────────────────────────────────────────────────────

struct MotorState {
    uint8_t  pins[4];
    int      n_idx__seq;
    long     n_position;
    int      n_direction;
    int      n_direction__prev;
    bool     b_running;

    float    n_rpm;
    unsigned long n_us__step_delay;
    unsigned long n_us__last_step;

    MoveMode mode;
    long     n_step__target;
    long     n_step__current;

    long     n_step__backlash;
    // where the drive currently sits inside its play: 0 = seated on the flank
    // that a negative move pushes against, n_step__backlash = the positive one.
    // Without this a reversal that only went part way into the slack would still
    // be charged the full compensation on the way back, and overshoot.
    long     n_step__slack;
    bool     b_compensating;
    long     n_step__comp_target;
    long     n_step__comp_current;
    float    n_rpm__after_comp;
};

MotorState motors[NUM_MOTORS];

// flag: set to true in motorsUpdate when a move completes or is cancelled
// processed in loop() to send WS messages outside the tight stepping loop
struct MoveEvent {
    bool     b_pending;
    bool     b_complete;   // true = complete, false = cancelled
    int      n_motor;
    long     n_position;
};
static const int MAX_MOVE_EVENT = 4;
MoveEvent a_o_move_event[MAX_MOVE_EVENT];
int n_cnt__move_event = 0;

// ─── Circle mode state ──────────────────────────────────────────────
// Circle runs entirely on ESP32 — coordinates motors 0 (X) and 1 (Y).
// Phase 1 (tracing) runs both motors continuously and modulates their
// RPM with sin/cos so the stage traces a smooth circle.
// While active, external motor commands are blocked.

struct CircleState {
    bool  b_active;
    bool  b_loop;
    long  n_step__radius;
    float n_rpm;

    int   n_phase;              // 0=move_to_start, 1=tracing, 2=return_to_center
    bool  b_segment_started;    // for phases 0 and 2 (motorMoveSteps-based)

    long  n_pos_x__center;      // motor 0 position at circle center
    long  n_pos_y__center;      // motor 1 position at circle center

    unsigned long n_us__trace_start;   // micros() when tracing began
    unsigned long n_us__revolution;    // microseconds for one full revolution
};

CircleState circle;

// ─── WebSocket server ───────────────────────────────────────────────

AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// ─── Transport (WebSocket vs USB Serial) ────────────────────────────
// The same JSON API is served over both transports. Commands are answered on
// the transport they arrived on; async events (moveComplete, circleComplete)
// also follow that transport.

enum Transport { TR_WS, TR_SERIAL };
Transport g_transport = TR_SERIAL;

bool b_wifi_reported = false;
String s_serial_buffer = "";

void handleCommand(const uint8_t *data, size_t len);

// Serialise a JSON document and send it over the active transport.
void sendJson(JsonDocument &doc) {
    String json;
    serializeJson(doc, json);
    if (g_transport == TR_SERIAL) {
        Serial.println(json);
    } else {
        ws.textAll(json);
    }
}

void sendJsonError(const char* s_error) {
    JsonDocument doc;
    doc["error"] = s_error;
    sendJson(doc);
}

// Read complete newline-terminated JSON commands from USB Serial and dispatch
// them exactly like WebSocket frames.
void handleSerial() {
    while (Serial.available()) {
        char c = (char)Serial.read();
        if (c == '\n' || c == '\r') {
            if (s_serial_buffer.length() > 0) {
                g_transport = TR_SERIAL;
                handleCommand((const uint8_t*)s_serial_buffer.c_str(), s_serial_buffer.length());
                s_serial_buffer = "";
            }
        } else {
            s_serial_buffer += c;
            if (s_serial_buffer.length() > 512) s_serial_buffer = "";  // discard runaway line
        }
    }
}

// ─── Motor helpers ──────────────────────────────────────────────────

unsigned long rpmToDelay(float n_rpm) {
    if (n_rpm <= 0) return 0;
    return (unsigned long)(60000000.0 / ((float)HALF_STEPS_PER_REV * n_rpm));
}

void motorInit() {
    for (int m = 0; m < NUM_MOTORS; m++) {
        for (int p = 0; p < 4; p++) {
            motors[m].pins[p] = MOTOR_PINS[m][p];
            pinMode(motors[m].pins[p], OUTPUT);
            digitalWrite(motors[m].pins[p], LOW);
        }
        motors[m].n_idx__seq        = 0;
        motors[m].n_position        = 0;
        motors[m].n_direction       = 1;
        motors[m].n_direction__prev = 0;
        motors[m].b_running         = false;
        motors[m].n_rpm             = 0;
        motors[m].n_us__step_delay  = 0;
        motors[m].n_us__last_step   = 0;
        motors[m].mode              = MODE_IDLE;
        motors[m].n_step__target    = 0;
        motors[m].n_step__current   = 0;
        motors[m].n_step__backlash  = 0;
        motors[m].n_step__slack     = 0;
        motors[m].b_compensating    = false;
        motors[m].n_step__comp_target  = 0;
        motors[m].n_step__comp_current = 0;
        motors[m].n_rpm__after_comp    = 0;
    }
    n_cnt__move_event = 0;
}

void motorApplySeq(int m) {
    int idx = motors[m].n_idx__seq;
    for (int i = 0; i < 4; i++)
        digitalWrite(motors[m].pins[i], HALF_STEP_SEQ[idx][i]);
}

void motorRelease(int m) {
    for (int i = 0; i < 4; i++)
        digitalWrite(motors[m].pins[i], LOW);
}

void motorSetRPM(int m, float n_rpm) {
    if (n_rpm <= 0) n_rpm = 0.01;
    motors[m].n_rpm = n_rpm;
    motors[m].n_us__step_delay = rpmToDelay(n_rpm);
}

void queueMoveEvent(bool b_complete, int m) {
    if (n_cnt__move_event < MAX_MOVE_EVENT) {
        a_o_move_event[n_cnt__move_event].b_pending  = true;
        a_o_move_event[n_cnt__move_event].b_complete = b_complete;
        a_o_move_event[n_cnt__move_event].n_motor    = m;
        a_o_move_event[n_cnt__move_event].n_position = motors[m].n_position;
        n_cnt__move_event++;
    }
}

// Start backlash compensation phase if direction changed
// Returns true if compensation was started (caller should not set b_running yet)
bool motorStartBacklash(int m, float n_rpm_requested) {
    bool b_direction_changed = (motors[m].n_direction__prev != 0) &&
                               (motors[m].n_direction != motors[m].n_direction__prev);
    if (b_direction_changed && motors[m].n_step__backlash > 0) {
        // only the part of the play that is still ahead of us: a reversal that
        // followed a short move, or another reversal, has already used some of it
        long n_step__need = (motors[m].n_direction > 0)
            ? (motors[m].n_step__backlash - motors[m].n_step__slack)
            : motors[m].n_step__slack;
        if (n_step__need <= 0) return false;   // already seated on this flank

        motors[m].b_compensating       = true;
        motors[m].n_step__comp_target  = n_step__need;
        motors[m].n_step__comp_current = 0;
        motors[m].n_rpm__after_comp    = n_rpm_requested;
        // burst at max speed during compensation
        motors[m].n_us__step_delay = rpmToDelay(N_RPM__BACKLASH_BURST);
        motors[m].n_rpm = N_RPM__BACKLASH_BURST;
        return true;
    }
    return false;
}

void motorRunContinuous(int m, float n_rpm, int n_direction) {
    motors[m].n_direction = n_direction;
    motors[m].mode = MODE_CONTINUOUS;
    motors[m].n_step__target  = 0;
    motors[m].n_step__current = 0;

    if (!motorStartBacklash(m, n_rpm)) {
        if (motors[m].b_compensating) {
            // a same-direction command arrived mid compensation (the mouse jog
            // resends while it drives): keep the burst, apply the rpm after it
            motors[m].n_rpm__after_comp = n_rpm;
        } else {
            motorSetRPM(m, n_rpm);
        }
    }

    motors[m].n_direction__prev = n_direction;
    motors[m].b_running = true;
}

void motorMoveSteps(int m, long n_step, float n_rpm) {
    if (n_step == 0) return;

    motors[m].n_direction = (n_step > 0) ? 1 : -1;
    motors[m].mode = MODE_STEPS;
    motors[m].n_step__target  = (n_step > 0) ? n_step : -n_step;
    motors[m].n_step__current = 0;

    if (!motorStartBacklash(m, n_rpm)) {
        if (motors[m].b_compensating) {
            // a same-direction command arrived mid compensation (the mouse jog
            // resends while it drives): keep the burst, apply the rpm after it
            motors[m].n_rpm__after_comp = n_rpm;
        } else {
            motorSetRPM(m, n_rpm);
        }
    }

    motors[m].n_direction__prev = motors[m].n_direction;
    motors[m].b_running = true;
}

void motorStop(int m) {
    bool b_was_stepping = (motors[m].mode == MODE_STEPS && motors[m].b_running);
    motors[m].b_running      = false;
    motors[m].b_compensating = false;
    motors[m].mode           = MODE_IDLE;
    motors[m].n_rpm          = 0;
    motors[m].n_us__step_delay = 0;
    motorRelease(m);
    if (b_was_stepping) {
        queueMoveEvent(false, m);
    }
}

void motorSetBacklash(int m, long n_step) {
    motors[m].n_step__backlash = (n_step > 0) ? n_step : 0;
    // the play just got smaller than where we thought we were inside it
    if (motors[m].n_step__slack > motors[m].n_step__backlash) {
        motors[m].n_step__slack = motors[m].n_step__backlash;
    }
}

// ─── Circle helpers ─────────────────────────────────────────────────

void circleSendEvent(const char* s_type) {
    JsonDocument doc;
    doc["type"] = s_type;
    sendJson(doc);
}

void circleInit() {
    circle.b_active            = false;
    circle.b_loop              = false;
    circle.n_step__radius      = 0;
    circle.n_rpm               = 0;
    circle.n_phase             = 0;
    circle.b_segment_started   = false;
    circle.n_pos_x__center     = 0;
    circle.n_pos_y__center     = 0;
    circle.n_us__trace_start   = 0;
    circle.n_us__revolution    = 0;
}

void circleStart(long n_radius, float n_rpm, bool b_loop) {
    motorStop(0);
    motorStop(1);

    circle.b_active          = true;
    circle.b_loop            = b_loop;
    circle.n_step__radius    = n_radius;
    circle.n_rpm             = n_rpm;
    circle.n_phase           = 0;
    circle.b_segment_started = false;
    circle.n_pos_x__center   = motors[0].n_position;
    circle.n_pos_y__center   = motors[1].n_position;

    // time for one revolution (microseconds)
    // circumference = 2*PI*R steps, tangential speed = RPM * 4096 / 60 steps/sec
    circle.n_us__revolution = (unsigned long)(
        2.0 * PI * (double)n_radius * 60000000.0
        / ((double)n_rpm * (double)HALF_STEPS_PER_REV)
    );
}

void circleStop() {
    if (!circle.b_active) return;
    motorStop(0);
    motorStop(1);
    circle.b_active = false;
    circleSendEvent("circleStopped");
}

// Advance circle state machine — called from loop()
void circleUpdate() {
    if (!circle.b_active) return;

    // ── Phase 0: move from center to start (R, 0) via motorMoveSteps ──
    if (circle.n_phase == 0) {
        if (circle.b_segment_started) {
            if (motors[0].b_running || motors[1].b_running) return;
            // move-to-start complete → begin tracing
            circle.b_segment_started = false;
            circle.n_phase = 1;
            circle.n_us__trace_start = micros();
            return;
        }
        // issue the move
        motorMoveSteps(0, circle.n_step__radius, circle.n_rpm);
        circle.b_segment_started = true;
        return;
    }

    // ── Phase 1: continuous tracing — modulate RPM with sin/cos ────────
    if (circle.n_phase == 1) {
        unsigned long n_now = micros();
        unsigned long n_us_elapsed = n_now - circle.n_us__trace_start;
        double n_angle = (double)n_us_elapsed / (double)circle.n_us__revolution * 2.0 * PI;

        // check for revolution complete
        if (!circle.b_loop && n_angle >= 2.0 * PI) {
            motorStop(0);
            motorStop(1);
            // return to exact center position
            circle.n_phase = 2;
            long n_dx = circle.n_pos_x__center - motors[0].n_position;
            long n_dy = circle.n_pos_y__center - motors[1].n_position;
            if (n_dx != 0) motorMoveSteps(0, n_dx, circle.n_rpm);
            if (n_dy != 0) motorMoveSteps(1, n_dy, circle.n_rpm);
            circle.b_segment_started = (n_dx != 0 || n_dy != 0);
            return;
        }

        // wrap angle for loop mode
        while (circle.b_loop && n_angle >= 2.0 * PI) {
            circle.n_us__trace_start += circle.n_us__revolution;
            n_angle -= 2.0 * PI;
        }

        // x = R*cos(θ), y = R*sin(θ)
        // vx = -R*sin(θ)*ω  →  rpm_x ∝ |sin(θ)|, dir_x = -sign(sin(θ))
        // vy =  R*cos(θ)*ω  →  rpm_y ∝ |cos(θ)|, dir_y =  sign(cos(θ))
        double n_sin = sin(n_angle);
        double n_cos = cos(n_angle);

        float n_rpm_x = circle.n_rpm * (float)fabs(n_sin);
        float n_rpm_y = circle.n_rpm * (float)fabs(n_cos);
        int   n_dir_x = (n_sin >= 0) ? -1 : 1;
        int   n_dir_y = (n_cos >= 0) ?  1 : -1;

        static const float N_RPM_MIN = 0.05;

        // update motor X
        if (n_rpm_x < N_RPM_MIN) {
            motors[0].n_us__step_delay = 0;   // pause stepping, keep coils held
        } else {
            motors[0].n_direction = n_dir_x;
            motorSetRPM(0, n_rpm_x);
            if (!motors[0].b_running) {
                motors[0].mode = MODE_CONTINUOUS;
                motors[0].b_running = true;
                motors[0].n_us__last_step = n_now;
            }
        }

        // update motor Y
        if (n_rpm_y < N_RPM_MIN) {
            motors[1].n_us__step_delay = 0;
        } else {
            motors[1].n_direction = n_dir_y;
            motorSetRPM(1, n_rpm_y);
            if (!motors[1].b_running) {
                motors[1].mode = MODE_CONTINUOUS;
                motors[1].b_running = true;
                motors[1].n_us__last_step = n_now;
            }
        }
        return;
    }

    // ── Phase 2: return to center via motorMoveSteps ──────────────────
    if (circle.n_phase == 2) {
        if (circle.b_segment_started) {
            if (motors[0].b_running || motors[1].b_running) return;
            circle.b_segment_started = false;
        }
        circle.b_active = false;
        circleSendEvent("circleComplete");
        return;
    }
}

// ─── Motor update (called every loop) ───────────────────────────────

void motorsUpdate() {
    unsigned long now = micros();
    for (int m = 0; m < NUM_MOTORS; m++) {
        if (!motors[m].b_running) continue;
        if (motors[m].n_us__step_delay == 0) continue;
        if (now - motors[m].n_us__last_step < motors[m].n_us__step_delay) continue;

        motors[m].n_us__last_step = now;

        // advance one half-step
        motors[m].n_idx__seq = (motors[m].n_idx__seq + motors[m].n_direction + SEQ_LEN) % SEQ_LEN;
        motorApplySeq(m);

        // backlash compensation phase
        if (motors[m].b_compensating) {
            // the motor turns but the stage does not, so this must not count as
            // position — it used to, and every reversal shifted n_position by the
            // whole backlash, which quietly corrupted the scan bookkeeping
            motors[m].n_step__slack += motors[m].n_direction;
            if (motors[m].n_step__slack < 0) motors[m].n_step__slack = 0;
            if (motors[m].n_step__slack > motors[m].n_step__backlash) {
                motors[m].n_step__slack = motors[m].n_step__backlash;
            }
            motors[m].n_step__comp_current++;
            if (motors[m].n_step__comp_current >= motors[m].n_step__comp_target) {
                // compensation done — restore requested RPM
                motors[m].b_compensating = false;
                motorSetRPM(m, motors[m].n_rpm__after_comp);
                // for MODE_STEPS, the step counter starts now (after compensation)
            }
            continue;
        }

        // a step that actually carries the stage: the drive is seated on the
        // flank of the direction it is moving in
        motors[m].n_position += motors[m].n_direction;
        motors[m].n_step__slack = (motors[m].n_direction > 0) ? motors[m].n_step__backlash : 0;

        // step counting for MODE_STEPS
        if (motors[m].mode == MODE_STEPS) {
            motors[m].n_step__current++;
            if (motors[m].n_step__current >= motors[m].n_step__target) {
                // move complete
                motors[m].b_running = false;
                motors[m].mode = MODE_IDLE;
                motors[m].n_rpm = 0;
                motors[m].n_us__step_delay = 0;
                motorRelease(m);
                queueMoveEvent(true, m);
            }
        }
    }
}

// ─── WebSocket handling ─────────────────────────────────────────────

void sendStatus(AsyncWebSocketClient *client = nullptr) {
    JsonDocument doc;
    doc["type"] = "status";
    JsonArray arr = doc["a_o_motor"].to<JsonArray>();
    for (int i = 0; i < NUM_MOTORS; i++) {
        JsonObject mo = arr.add<JsonObject>();
        mo["n_rpm"]             = motors[i].n_rpm;
        mo["s_direction"]       = (motors[i].n_direction == 1) ? "cw" : "ccw";
        mo["b_running"]         = motors[i].b_running;
        mo["n_position"]        = motors[i].n_position;
        mo["n_step__backlash"]  = motors[i].n_step__backlash;
        mo["b_compensating"]    = motors[i].b_compensating;

        const char* s_mode = "idle";
        long n_remaining = 0;
        if (motors[i].mode == MODE_CONTINUOUS) {
            s_mode = "continuous";
        } else if (motors[i].mode == MODE_STEPS) {
            s_mode = "steps";
            n_remaining = motors[i].n_step__target - motors[i].n_step__current;
            if (n_remaining < 0) n_remaining = 0;
        }
        mo["s_mode"]            = s_mode;
        mo["n_step__remaining"] = n_remaining;
    }
    // circle state
    JsonObject o_circle = doc["o_circle"].to<JsonObject>();
    o_circle["b_active"] = circle.b_active;
    if (circle.b_active) {
        o_circle["n_phase"] = circle.n_phase;
        o_circle["b_loop"]  = circle.b_loop;
    }

    String json;
    serializeJson(doc, json);
    if (client != nullptr && g_transport == TR_WS) {
        client->text(json);
    } else {
        if (g_transport == TR_SERIAL) Serial.println(json);
        else                          ws.textAll(json);
    }
}

void sendMoveEvent(bool b_complete, int m, long n_position) {
    JsonDocument doc;
    doc["type"]       = b_complete ? "moveComplete" : "moveCancelled";
    doc["motor"]      = m;
    doc["n_position"] = n_position;
    sendJson(doc);
}

void handleCommand(const uint8_t *data, size_t len) {
    JsonDocument doc;
    if (deserializeJson(doc, data, len)) {
        sendJsonError("invalid JSON");
        return;
    }

    // global commands (no motor index)
    if (doc["command"].is<const char*>()) {
        String cmd = doc["command"].as<String>();
        if (cmd == "stopAll") {
            if (circle.b_active) circleStop();
            for (int i = 0; i < NUM_MOTORS; i++) motorStop(i);
            sendStatus(); return;
        }
        if (cmd == "status") { sendStatus(); return; }

        if (cmd == "circleStart") {
            long  n_radius = doc["n_step__radius"] | 100L;
            float n_rpm    = doc["n_rpm"]           | 8.0f;
            bool  b_loop   = doc["b_loop"]          | false;
            if (n_radius < 1) n_radius = 1;
            circleStart(n_radius, n_rpm, b_loop);
            sendStatus(); return;
        }

        if (cmd == "circleStop") {
            circleStop();
            sendStatus(); return;
        }
    }

    // block motor commands while circle is active
    if (circle.b_active) {
        sendJsonError("circle mode active");
        return;
    }

    // per-motor commands
    if (doc["motor"].is<int>()) {
        int m = doc["motor"].as<int>();
        if (m < 0 || m >= NUM_MOTORS) {
            sendJsonError("invalid motor index");
            return;
        }

        String cmd = "";
        if (doc["command"].is<const char*>()) {
            cmd = doc["command"].as<String>();
        }

        if (cmd == "stop") {
            motorStop(m);
            sendStatus();
            return;
        }

        if (cmd == "runContinuous") {
            float n_rpm = doc["n_rpm"] | 5.0f;
            int dir = 1;
            if (doc["direction"].is<const char*>())
                dir = (doc["direction"].as<String>() == "ccw") ? -1 : 1;
            motorRunContinuous(m, n_rpm, dir);
            sendStatus();
            return;
        }

        if (cmd == "moveSteps") {
            float n_rpm = doc["n_rpm"] | 5.0f;
            long n_step = doc["n_step"] | 0L;
            if (n_step == 0) { sendStatus(); return; }
            motorMoveSteps(m, n_step, n_rpm);
            sendStatus();
            return;
        }

        if (cmd == "setBacklash") {
            long n_backlash = doc["n_step__backlash"] | 0L;
            motorSetBacklash(m, n_backlash);
            sendStatus();
            return;
        }
    }
}

void onWsEvent(AsyncWebSocket *srv, AsyncWebSocketClient *client,
               AwsEventType type, void *arg, uint8_t *data, size_t len)
{
    switch (type) {
        case WS_EVT_CONNECT:
            g_transport = TR_WS;
            Serial.printf("WS client #%u connected from %s\n",
                          client->id(), client->remoteIP().toString().c_str());
            sendStatus(client);
            break;
        case WS_EVT_DISCONNECT:
            Serial.printf("WS client #%u disconnected\n", client->id());
            break;
        case WS_EVT_DATA: {
            AwsFrameInfo *info = (AwsFrameInfo*)arg;
            if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
                g_transport = TR_WS;
                handleCommand(data, len);
            }
            break;
        }
        default: break;
    }
}

// ─── Setup ──────────────────────────────────────────────────────────

void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== Stepper Serial + WebSocket API ===\n");

    motorInit();
    circleInit();
    Serial.println("Motors initialised.");

    // WiFi is best-effort and non-blocking: the USB Serial API must stay
    // responsive even without a network. Connect in the background; loop()
    // reports the IP once the link comes up.
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    Serial.println("Connecting to WiFi (in background)");
    Serial.println("USB Serial API: 115200 baud, one JSON command per line");
    Serial.println("WebSocket endpoint: ws://<IP>/ws (once WiFi connects)\n");

    ws.onEvent(onWsEvent);
    server.addHandler(&ws);
    server.begin();
}

// ─── Loop ───────────────────────────────────────────────────────────

void loop() {
    // report the IP once WiFi comes up (non-blocking)
    if (!b_wifi_reported && WiFi.status() == WL_CONNECTED) {
        b_wifi_reported = true;
        Serial.printf("Connected!  IP: %s\n", WiFi.localIP().toString().c_str());
    }

    handleSerial();
    motorsUpdate();
    circleUpdate();

    // send queued move events (suppress during circle mode — internal moves)
    for (int i = 0; i < n_cnt__move_event; i++) {
        if (a_o_move_event[i].b_pending) {
            if (!circle.b_active) {
                sendMoveEvent(
                    a_o_move_event[i].b_complete,
                    a_o_move_event[i].n_motor,
                    a_o_move_event[i].n_position
                );
                sendStatus();
            }
            a_o_move_event[i].b_pending = false;
        }
    }
    if (n_cnt__move_event > 0) {
        // compact: just reset counter since we processed all
        n_cnt__move_event = 0;
    }

    ws.cleanupClients();
}
