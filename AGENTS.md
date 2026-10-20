# UI design workflow

The user designs each overlay window by hand to decide its exact layout and the
controls needed for its function. Look for the relevant drawing under
`hgc_features/hgc_ui/ui_guide` before changing an overlay.

An LLM may build a coarse functional prototype first. Refinement into the intended
layout must follow the user's drawing. If an overlay has no drawing, ask the user
to draw it before refining its layout; do not substitute an invented final design.
Continue any independent functionality work while waiting for that drawing.

Use the general guide for the toolbar and window behavior. The microcontroller
drawing specifies the ESP32, motor wiring, axis assignment, backlash, and LED
configuration window. Preserve existing hardware behavior, validation, and access
to advanced controls when applying a drawing.
