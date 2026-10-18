// Host harness: led_under_test.h is extracted from the generated real firmware.
#include <ArduinoJson.h>
#include <cassert>
#include <cstdint>
#include <string>
#include <vector>

using portMUX_TYPE = int;
#define portMUX_INITIALIZER_UNLOCKED 0
#define portENTER_CRITICAL(mux) ((void)0)
#define portEXIT_CRITICAL(mux) ((void)0)
constexpr int OUTPUT = 1, LOW = 0, RMT_TX_MODE = 1, RMT_MEM_NUM_BLOCKS_1 = 1;
struct rmt_data_t { uint32_t level0, duration0, level1, duration1; };
bool b_complete = true, b_init_ok = true, b_write_ok = true;
int n_pin_call = 0, n_write_call = 0;
std::vector<rmt_data_t> a_sent;
std::string s_reply;
void pinMode(int, int) { ++n_pin_call; }
void digitalWrite(int, int) {}
bool rmtInit(int, int, int, uint32_t n_hz) { assert(n_hz == 10000000); return b_init_ok; }
bool rmtSetEOT(int, int n_level) { assert(n_level == LOW); return true; }
bool rmtTransmitCompleted(int) { return b_complete; }
bool rmtWriteAsync(int, rmt_data_t* a_frame, size_t n_count) {
    ++n_write_call; a_sent.assign(a_frame, a_frame + n_count); b_complete = false; return b_write_ok;
}
void sendJson(JsonDocument &doc) { s_reply.clear(); serializeJson(doc, s_reply); }
constexpr int NUM_MOTORS = 3;
const uint8_t MOTOR_PINS[3][4] = {{4,5,6,7}, {15,16,17,18}, {8,3,46,9}};
#include "led_under_test.h"

bool f_command(const char* s_json) {
    JsonDocument doc;
    assert(!deserializeJson(doc, s_json));
    return ledSetOutput(doc);
}

void f_check_frame(uint8_t n_red, uint8_t n_green, uint8_t n_blue, uint8_t n_white) {
    const int n_channel = B_RGBW__LED ? 4 : 3;
    assert(a_sent.size() == size_t(N_COUNT__LED * n_channel * 8 + 1));
    uint8_t a_expected[] = {uint8_t(B_GREEN_FIRST__LED ? n_green : n_red), uint8_t(B_GREEN_FIRST__LED ? n_red : n_green), n_blue, n_white};
    for (int n_led = 0; n_led < N_COUNT__LED; ++n_led) {
        for (int n_c = 0; n_c < n_channel; ++n_c) {
            uint8_t n_byte = 0;
            for (int n_bit = 0; n_bit < 8; ++n_bit) {
                auto o_symbol = a_sent[(n_led * n_channel + n_c) * 8 + n_bit];
                assert(o_symbol.level0 == 1 && o_symbol.level1 == 0);
                assert(o_symbol.duration0 + o_symbol.duration1 == 12);
                bool b_one = o_symbol.duration0 == (B_RGBW__LED ? 6 : 8);
                assert(o_symbol.duration0 == (b_one ? (B_RGBW__LED ? 6 : 8) : (B_RGBW__LED ? 3 : 4)));
                n_byte = (n_byte << 1) | b_one;
            }
            assert(n_byte == a_expected[n_c]);
        }
    }
    auto o_latch = a_sent.back();
    assert(o_latch.level0 == 0 && o_latch.level1 == 0);
    assert(o_latch.duration0 + o_latch.duration1 == 3500);
}

int main() {
    ledInit(); ledUpdate();
    if (!B_ENABLED__LED) {
        assert(n_pin_call == 0 && n_write_call == 0);
        assert(!f_command("{\"b_on\":true}"));
        assert(s_reply.find("hardwareLedError") != std::string::npos);
        return 0;
    }
    assert(n_write_call == 1 && b_ready__led);
    f_check_frame(B_RGBW__LED ? 0 : 8, B_RGBW__LED ? 0 : 8, B_RGBW__LED ? 0 : 8, B_RGBW__LED ? 8 : 0);
    for (const char* s_bad : {"{\"n_red\":-1}", "{\"n_white\":256}", "{\"n_blue\":0.5}", "{\"n_brightness\":\"8\"}", "{\"b_on\":1}", "{\"n_red\":null}", "{\"n_green\":255,\"n_red\":999}"}) {
        assert(!f_command(s_bad));
        assert(o_output__led.n_green == O_STARTUP__LED.n_green);
    }
    assert(f_command("{\"n_red\":255,\"n_green\":128,\"n_blue\":64,\"n_brightness\":128}"));
    if (B_RGBW__LED) assert(f_command("{\"n_white\":32}"));
    else assert(!f_command("{\"n_white\":32}"));
    // The in-flight buffer must remain untouched until RMT reports completion.
    auto n_first_duration = a_frame__led[0].duration0;
    ledUpdate(); assert(n_write_call == 1 && a_frame__led[0].duration0 == n_first_duration);
    b_complete = true; ledUpdate(); assert(n_write_call == 2);
    f_check_frame(128, 64, 32, 16);
    assert(f_command("{\"b_on\":false}"));
    b_complete = true; ledUpdate(); f_check_frame(0, 0, 0, 0);
    assert(f_command("{\"b_on\":true,\"n_brightness\":255}"));
    b_complete = true; ledUpdate(); f_check_frame(255, 128, 64, 32);
    assert(f_command("{\"n_brightness\":0}"));
    b_complete = true; ledUpdate(); f_check_frame(0, 0, 0, 0);
    b_complete = true; ledUpdate(); assert(!b_transmitting__led);
    JsonDocument doc;
    ledWriteStatus(doc.to<JsonObject>());
    assert(doc["o_config"]["n_count"] == N_COUNT__LED && !doc["b_pending"].as<bool>());
    assert(f_command("{\"n_brightness\":8}"));
    b_write_ok = false; ledUpdate(); assert(!b_ready__led);
    assert(std::string(s_error__led).find("transmission failed") != std::string::npos);
    assert(!f_command("{\"b_on\":true}"));
    b_init_ok = false; ledInit(); assert(!b_ready__led);
    assert(std::string(s_error__led).find("initialization failed") != std::string::npos);
}
