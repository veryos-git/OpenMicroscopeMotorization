the existing project should  also be able to handle a single adressable RGB-led with a additional Warm white or cold white channel. the vendor name is RGBWW or RGBCW
the LED should be able to represent RGB colors aswell as the separate channel (warmwhite or coldwhite). the brightness should be settable . on startup the led is set to a usefull default value. 
the control is done via a configurable free hardware GPIO esp32 pin and can be set in the hardware settings. supply voltage and data level have to fit to the module. esp32 and led need a common ground. 

the exact LED'chip and the dataformat have yet to be confirmed. 
as a reference there is the programm  WS2812B_WS2812_RGBWW/led_test_mgc/led_test_mgc.ino. 
this programm has been tested with one led, but was created to work with 3 leds all connected to only one pin it does not require an additional LED library.


there have to be UI options to configure the hardware LED(s) (by default only use one optional led) . and after flashing the LED has to be controllable via UI.