# research
there was research done. the question was if there is a good js library that reliably can provide usb camera capabilities and is a nice wrapper around the default getUserMedia js native API. but even the W3C specification states that there are quite some limitations when using webcams in the browser. 

the full summary of the research done is below. 


# JavaScript libraries for USB camera control

Research date: 2026-09-30

## Conclusion

For a normal USB webcam in a browser, **Dynamsoft Camera Enhancer is the closest match found to a comprehensive camera wrapper**. It provides camera selection, resolution discovery, capability inspection, and several camera controls.

However, a browser library can only control what the camera, driver, operating system, and browser expose. There is no universal browser wrapper that provides unrestricted hardware access or a complete list of native capture modes.

## Libraries and tools

| Option | Environment | Features | Assessment |
| --- | --- | --- | --- |
| [Dynamsoft Camera Enhancer](https://www.dynamsoft.com/camera-enhancer/docs/web/programming/javascript/api-reference/camera-control.html) | Browser | Camera selection, resolution probing, capabilities, frame rate, focus, exposure compensation, color temperature, zoom, and frame capture. | Closest fit for a comprehensive wrapper. Advanced controls have browser/platform restrictions. |
| [react-webcam](https://github.com/mozmorris/react-webcam) | React/browser | Preview, snapshots, camera selection, and video constraints. | Useful UI integration; capability discovery and advanced controls still require application code. |
| [webcam-easy](https://github.com/bensonruan/webcam-easy) | Browser | Start/stop streaming, camera listing, facing-direction switching, and snapshots. | Suitable for basic capture; lacks a comprehensive camera-control interface. |
| [uvcc](https://github.com/joelpurra/uvcc) | Local Node.js command-line tool | Enumerates and adjusts UVC controls, including gain, white balance, brightness, contrast, and zoom; imports/exports settings. | Useful for deeper hardware control. Requires local installation and a separate capture interface. |

### Dynamsoft caveats

- `getAvailableResolutions()` tests ten predefined sizes, from 160×120 to 3840×2160. It can take time and can miss resolutions outside that list.
- `setResolution()` can select the closest available resolution if the requested one is unavailable.
- Focus and exposure controls have platform restrictions; do not assume every documented method works with every webcam/browser combination.
- Enhanced features such as auto-zoom and enhanced focus require licensing.
- The standalone GitHub repository was archived in November 2024. The vendor's current integration guide still documents the package, but the archived repository does not establish ongoing maintenance.

Sources: [camera control API](https://www.dynamsoft.com/camera-enhancer/docs/web/programming/javascript/api-reference/camera-control.html), [integration guide](https://www.dynamsoft.com/camera-enhancer/docs/web/programming/javascript/user-guide/), [repository](https://github.com/Dynamsoft/camera-enhancer-javascript).

## What native browser APIs already provide

`getUserMedia()` opens the stream. The returned video track provides the control interface:

| API | Purpose |
| --- | --- |
| `navigator.mediaDevices.enumerateDevices()` | Discover available cameras, subject to permissions. |
| `navigator.mediaDevices.getSupportedConstraints()` | Check which constraint names the browser understands; this does not prove the connected camera supports them. |
| `track.getCapabilities()` | Inspect the selected camera's exposed capabilities and ranges. |
| `track.getSettings()` | Read the track's current settings. |
| `track.applyConstraints()` | Request changes to resolution, frame rate, and supported camera controls. |

Depending on the hardware and browser, controls can include focus, exposure, white balance, brightness, contrast, and zoom. Pan/tilt/zoom can require additional permission. Build controls from the capabilities actually returned at runtime.

Sources: [MDN capabilities reference](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getCapabilities), [camera settings guide](https://developer.chrome.com/blog/imagecapture), [pan/tilt/zoom guide](https://web.dev/articles/camera-pan-tilt-zoom).

## Resolution discovery limitations

Browsers expose width, height, and frame-rate ranges rather than an exhaustive list of supported combinations. A camera might support 1080p at 30 fps and 720p at 60 fps, but separate maximum values do not imply 1080p at 60 fps works.

A practical browser wrapper can:

1. Open the selected camera and inspect its capabilities.
2. Test candidate resolution/frame-rate combinations using `applyConstraints()` with `exact` values.
3. Check the resulting settings with `getSettings()`.
4. Where supported, request `resizeMode: { exact: "none" }` to exclude browser cropping/scaling. Check support first because unsupported constraints can be ignored.

Even with `resizeMode: "none"`, results reflect what the camera, driver, or operating system offers; they do not establish raw sensor modes. Probing determines which tested combinations work, not every possible mode.

Source: [W3C Media Capture and Streams specification](https://www.w3.org/TR/mediacapture-streams/).

## Native mode discovery on Linux

V4L2 can enumerate driver-supported pixel formats, frame sizes, and frame intervals. A local Node.js service could invoke `v4l2-ctl` and expose those results and controls to a browser UI.

Example read-only queries, after selecting the appropriate camera device:

```bash
v4l2-ctl --device=/dev/video0 --list-formats-ext
v4l2-ctl --device=/dev/video0 --list-ctrls-menus
```

This requires software running on the computer to which the camera is attached; a remote web server cannot directly inspect a visitor's USB camera through V4L2.

Sources: [V4L2 frame-size enumeration](https://kernel.org/doc/html/v5.4/media/uapi/v4l/vidioc-enum-framesizes.html), [v4l2-ctl source](https://github.com/gjasny/v4l-utils/blob/master/utils/v4l2-ctl/v4l2-ctl.cpp).

## Recommendation

- **Existing browser SDK:** Evaluate Dynamsoft Camera Enhancer for its convenience API, taking its licensing, platform restrictions, and archived standalone repository into account.
- **Focused browser webcam application:** Use a small TypeScript wrapper around the native track APIs, with capability-driven controls and resolution probing. Add `react-webcam` only if its React integration is useful.
- **Exhaustive native mode discovery or deeper hardware controls:** Use a local Node.js/native component. On Linux, V4L2 is the strongest fit for mode enumeration; `uvcc` is another option for UVC control settings.

These findings are based on documentation and repository research. No library was installed or tested against a physical camera during this research.
