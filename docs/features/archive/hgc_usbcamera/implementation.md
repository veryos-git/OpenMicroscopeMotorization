# First camera settings implementation

Open **Optics → Camera** after selecting a camera in the toolbar.

- The panel shows the camera label, active capture dimensions and reported frame rate.
- Choose a preset through 3840 × 2160, or enter a custom width and height and apply it.
- **Request maximum** asks for the reported maximum dimensions and shows the actual result. This also accommodates cameras larger than 4K.
- Successful choices are saved separately per device and restored when its stream starts again. Startup requests 4K as a preference, allowing smaller cameras to fall back.
- Resolution changes are disabled during scans and recording (including pre-roll).
- Existing exposure, ISO/gain, white balance, focus and other camera controls remain capability-dependent. Changing these controls preserves resolution constraints.
- The live preview already fits the viewport using `object-fit: contain`; capture resolution is independent of monitor size.

Browser capabilities provide dimension ranges, not an enumeration of valid paired camera modes. Presets are requests, not promises of support. Explicit sizes use exact constraints; when available, `resizeMode: none` prevents browser cropping/downscaling. Rejected sizes display an error and do not replace the saved choice. See the [Media Capture specification](https://www.w3.org/TR/mediacapture-streams/).

Validation: `deno test -A tests/camera_test.js tests/camera_browser_test.js` (the browser test requires `/usr/bin/google-chrome`). Five tests cover persistence, errors, preserving constraints, stale tracks, and the Vue panel in Chrome with a simulated track. Physical USB cameras still need testing, particularly 4K modes, USB bandwidth and the available frame rates.
