generally it would be good if i really make mokups of all user interfaces , this way i have the very full controll of how the UI should look like. 

since i do not have enough time , i cannot do this. 

therefore the rules for the UI are: 

- each overlay window should fit onto the screen without having to scrol
    - i know some functionalities are very complex but still it is important to always have a good overview of all functionalities at one screen. if the functionalities are complex the UI has to be optimized, like in a pilot cockpit. every space needs to be made use of

- no floating text: 
    - currently the UI has floating text passages, that are explenations. while this is informative, it simply takes to much text. we may introduce a small '?' that can be hovered to explain functionalities . or like it is already done right now: simple tooltips on hover
     
- less redundancies and generally less text: 
    - example here: in the tile scan overlay window. the heading is 'tile scan' the user already knows what this overlay is about. but still there is the text 'SCAN AREA' and then a select box with 'Free outline' and 'Rectangular grid' . but the 'SCAN AREA' is absolutely redundant. it would be much better to simply have the select with apropriate icons.

- learning by doing / exploring. the UI should be explorable meaning, all selectboxes and inputs should be touchable by the operators , they have to explore the app anyways. the UI should not need to explain with text, but simply provide the changable parameters as inputs. the labels should be minimal , maybe even only with an icon and no text. 

- keywords and even only letters. only three characters can indicate very much the functionality of the UI. for example the speed presets are : Slow, Normal , Fast, when selected a speed preset the select box shows then only : 'Slo...' , 'Nor...' , and 'Fas...' in combination with the pictogram / icon, this is absolutely enought for the operator to understand what this UI element is for.
and if they click the select , they even see the full text and 3 options which then even gives more meta information about what this select could be for. 

- no hidden UI input elements: the important input elements that have to be changed should not be hidden with colapsable elements. this only adds a layer of complexity. there should only be two layers. the lilve image preview and top bar (always visible) and the openable overlay windows. but no further hidden inputs.

concrete stuff that needs to be adressed: 

microcontroller setup overlay: 
LED options
Hardware and startup changes are saved automatically. Use “Generate Firmware & Flash ESP32” below to apply them.

Saved LED settings differ from the connected controller. Flash to apply them.

Open LED settings
Control live brightness, colour and on/off from LED settings in the main toolbar.

this is to much text and unused functionality, move it to archive
---
Tile Scan: icon missing in overlay heading. 
after this. absolutely too much text and information. 

- the only buttons needed now are: 
scans: a button to show already done scans. the whole UI to manage already done scans may need its own overlay window. 


