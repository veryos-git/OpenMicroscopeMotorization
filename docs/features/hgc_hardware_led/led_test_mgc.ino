// Kleiner ESP32-Test fuer drei hintereinander verbundene LED-Module.
// Arduino-ESP32 3.x; keine zusaetzliche LED-Bibliothek erforderlich.
// RGBWW wird hier als RGB + ein Weisskanal mit SK6812-RGBW-Protokoll getestet.
// Diese Annahme muss zu den tatsaechlich gelieferten LEDs passen.

#include <Arduino.h>
#include <esp32-hal-rmt.h>

// 1: RGBW/RGBWW, 32 Bit pro LED; 0: WS2812/WS2812B RGB, 24 Bit pro LED.
#ifndef LED_RGBW_MODE
#define LED_RGBW_MODE 1
#endif

constexpr uint8_t DATA_PIN = 18;
constexpr uint8_t LED_COUNT = 3;
constexpr uint8_t TEST_LEVEL = 8;  // Niedrige Helligkeit: 8 von 255.
constexpr uint32_t STEP_MS = 1000;
constexpr bool GREEN_FIRST = true;  // true: GRB(W); false: RGB(W).
constexpr bool RGBW_MODE = LED_RGBW_MODE == 1;
constexpr uint8_t CHANNEL_COUNT = RGBW_MODE ? 4 : 3;

static_assert(LED_RGBW_MODE == 0 || LED_RGBW_MODE == 1, "LED_RGBW_MODE muss 0 oder 1 sein.");
static_assert(TEST_LEVEL > 0 && TEST_LEVEL <= 8, "Fuer den ersten Test bei 1 bis 8 bleiben.");

uint8_t pixels[LED_COUNT][4] = {};  // Intern immer Rot, Gruen, Blau, Weiss.
rmt_data_t frame[LED_COUNT * CHANNEL_COUNT * 8];
bool transmitterReady = false;

void clearPixels() {
  for (uint8_t pixel = 0; pixel < LED_COUNT; ++pixel) {
    for (uint8_t channel = 0; channel < 4; ++channel) {
      pixels[pixel][channel] = 0;
    }
  }
}

bool showPixels() {
  if (!transmitterReady) return false;

  const uint8_t order[] = {
    static_cast<uint8_t>(GREEN_FIRST ? 1 : 0),
    static_cast<uint8_t>(GREEN_FIRST ? 0 : 1), 2, 3
  };
  size_t symbol = 0;
  for (uint8_t pixel = 0; pixel < LED_COUNT; ++pixel) {
    for (uint8_t channel = 0; channel < CHANNEL_COUNT; ++channel) {
      const uint8_t value = pixels[pixel][order[channel]];
      for (int bit = 7; bit >= 0; --bit) {
        const bool one = (value & (1U << bit)) != 0;
        // 10 MHz: ein Tick = 100 ns. RGB wie im bisherigen Matrixtest;
        // RGBW mit dem Timing aus dem SK6812RGBW-Datenblatt (siehe README).
        frame[symbol].level0 = 1;
        frame[symbol].duration0 = RGBW_MODE ? (one ? 6 : 3) : (one ? 8 : 4);
        frame[symbol].level1 = 0;
        frame[symbol].duration1 = RGBW_MODE ? (one ? 6 : 9) : (one ? 4 : 8);
        ++symbol;
      }
    }
  }
  // Jeder Frame enthaelt alle drei LEDs, einschliesslich der ausgeschalteten.
  if (!rmtWrite(DATA_PIN, frame, symbol, RMT_WAIT_FOR_EVER)) {
    Serial.println("FEHLER: LED-Daten konnten nicht gesendet werden; Test gestoppt.");
    transmitterReady = false;
    return false;
  }
  delayMicroseconds(350);  // LOW-Pause zum Uebernehmen des Frames.
  return true;
}

bool walkChannel(const char *name, uint8_t channel) {
  for (uint8_t pixel = 0; pixel < LED_COUNT; ++pixel) {
    clearPixels();
    pixels[pixel][channel] = TEST_LEVEL;
    if (!showPixels()) return false;
    // Angeforderte LED, keine Empfangsbestaetigung durch die Module.
    Serial.printf("%s | LED %u/%u\n", name,
                  static_cast<unsigned>(pixel + 1), static_cast<unsigned>(LED_COUNT));
    delay(STEP_MS);
  }
  clearPixels();
  if (!showPixels()) return false;
  delay(500);
  return true;
}

void setup() {
  Serial.begin(115200);
  pinMode(DATA_PIN, OUTPUT);
  digitalWrite(DATA_PIN, LOW);
  delay(500);
  Serial.println("\nLED-TEST | 3 LEDs am ESP32");
  Serial.printf("GPIO: %u | Modus: %s | Reihenfolge: %s%s | Kanalwert: %u/255\n",
                static_cast<unsigned>(DATA_PIN), RGBW_MODE ? "RGBW (32 Bit)" : "RGB (24 Bit)",
                GREEN_FIRST ? "GRB" : "RGB", RGBW_MODE ? "W" : "",
                static_cast<unsigned>(TEST_LEVEL));
  transmitterReady = rmtInit(DATA_PIN, RMT_TX_MODE, RMT_MEM_NUM_BLOCKS_1, 10000000);
  if (transmitterReady) transmitterReady = rmtSetEOT(DATA_PIN, LOW);
  if (!transmitterReady) {
    Serial.println("FEHLER: RMT konnte nicht initialisiert werden.");
    return;
  }
  clearPixels();
  if (showPixels()) delay(1000);
}

void loop() {
  if (!transmitterReady) {
    delay(1000);
    return;
  }
  if (!walkChannel("ROT", 0)) return;
  if (!walkChannel("GRUEN", 1)) return;
  if (!walkChannel("BLAU", 2)) return;
  if (RGBW_MODE && !walkChannel("WEISS (eigener Kanal)", 3)) return;

  clearPixels();
  pixels[0][0] = TEST_LEVEL;
  pixels[1][1] = TEST_LEVEL;
  pixels[2][2] = TEST_LEVEL;
  if (!showPixels()) return;
  Serial.println("GLEICHZEITIG | LED 1 rot, LED 2 gruen, LED 3 blau");
  delay(2000);

  clearPixels();
  if (!showPixels()) return;
  Serial.println("ALLE AUS | Wiederholung nach 2 Sekunden");
  delay(2000);
}
