# Coarse focus response check

In Setup, assign the focus motor to Z and click Calibrate on its motor card (or Quickly calibrate all). Use a textured specimen, manual exposure, and a slightly defocused starting position with room for 100 steps of travel.

Before measuring focus backlash, calibration samples five stationary frames, commands 100 steps, and samples five more frames. A response must exceed both 5% of the initial sharpness and three times the observed frame-to-frame score range. It then commands 100 steps back; backlash and friction mean this is not an exact physical return.

If no response is detected, calibration stops, retains the previous backlash compensation, and saves a “no response” result. Automatic focus tools treat Z as unavailable. Check the motor connection, friction drive and specimen, then retry Calibrate. A successful probe restores automatic focus availability. Stopped runs, missing/frozen camera frames, and movement failures do not save a hardware verdict.

The top bar shows camera streaming, X/Y motor assignments, and the last focus probe result alongside the controller connection. Click the overview to open Setup. “No response” is an image-based observation, not electrical detection of an unplugged motor. Results persist across reloads and belong to the probed motor; recalibrate after changing hardware.
