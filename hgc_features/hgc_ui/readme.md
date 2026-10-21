the ui of the application should be generally expressed with more icons than text. if text is used it should only be used precicely. 

the application is intented to work in combination with a microscope and hardware, all together is called the assembly. 
the application is intented to run as a fullscreen window. all the functionalities can be accessed by toggling overlay windows. 
each overlay window can be resized and moved. 

Overlay design workflow: first build a coarse functional draft if needed, then
the user draws the exact arrangement and chooses the controls for that function.
Refine the window from that drawing. Drawings live in `ui_guide`; ask for a drawing
before refining an overlay that does not have one.

The microcontroller overlay follows `ui_guide/microcontroller_settings/image.png`:
M1–M3 wiring, X/Y/Z assignments and reverse/backlash/calibration controls, LED
hardware and startup colour/white, then USB connection and Flash. Wi-Fi, motor
tests, detailed calibration, and live LED output remain in expandable sections.
The startup W value is the existing single white channel intensity on a 0–1 scale;
warm/cool colour temperature is determined by the LED module.


Implemented: overlay windows can be moved by dragging their header with a mouse,
pen, or touch. Selecting a window brings it forward; header buttons and fields
remain interactive. Positions are kept while panels are hidden/reopened, and moved
windows are kept within the viewport when it changes size. Digital zoom keeps its
existing position handling. General window resizing remains a separate task.

The general guide now uses one toolbar row: pinned tool icons, movement speed
preset, camera selector, Stop, Tools and Search. Right-click a tool in Tools to
pin/unpin it; right-click a toolbar shortcut to remove it. The pin buttons also
work with keyboard and touch. Shortcuts are saved in this browser, and overflow
scrolls horizontally without adding rows. Hover or focus shows immediate tooltips
with full labels and current camera/speed values.

Tools, Quick settings and Search have movable, closable window headers. Tools and
Quick settings retain their position when reopened during the session. Shared
windows snap to viewport edges and nearby windows; digital zoom retains its own
movement handler. Changed settings and active processes stay in the toolbar as
icons. Detailed speed values, camera tuning, project and slide selection are in
Tools → Quick settings.



problem: 
- the UI is simply to crowded. for advanced users it makes sense to see all details but for a quick look it is overwhelming. 
possible solution: 
- provide the most accessed functions on the first layer of the GUI, so that no overlay has to be opened. 
- use icons/pictograms. they often tell a lot more than having to read complex long text 
- use tool tip text when hovering over an item with complex functionality (buttons with icons , and others)



problem: 
inputs are not practical
possible solution: 
depending on what the actual parameter could be use senseful input elements, such as sliders, textboxes, textareas, and more

problem: 
configuration settings are activated one by one, for example camera image filters are added  more and more, and the user cannot quickly remove them because it would require clicking through the hole gui and finding stuff
possible solution: 
- each input, or changeable funcitonality should be findable via text search, text search can be opened with 'ctrl+shift+p' or via button on the first layer of UI
- as soon as an input has been manipulated there is a representative icon added to the first layer of the input, clicking this icon will remove the function it is related to , this way the user can add functionality via clicking throught the UI but quickly remove them again
