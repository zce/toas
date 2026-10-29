# Matrix HUD experiment (GNOME 49/50)

This branch uses the new matrix HUD **directly**, without a feature flag or
alternate view implementation. Recording, processing, history, cancellation,
output and error handling remain unchanged.

## Install, test, and rollback

Check out `feat/matrix-hud-preview`, then run `./install.sh`. The installer
disables the extension, installs the branch, compiles the schema and re-enables
it. The dot-matrix HUD is active immediately: **no gsettings commands**.

To return to the original UI, check out `main` and run `./install.sh`.
There is no runtime selection or setting to maintain.

## Interaction

- Recording: full-capsule matrix and three braided, dot-only strands driven
  by Toas's **existing 100 ms RMS readings** (no FFT).
- Processing (transcribing/refining/outputting/copying): narrower capsule and
  moving light packet; no internal status labels or extra line primitives.
- Hover: subdued amber dot-matrix CANCEL; click anywhere on the capsule
  invokes the original orchestrator cancellation.
- Completion: native shrink/fade transition and resource cleanup.
- Error: readable error text remains available for troubleshooting, and the
  top-bar indicator preserves the real stage and private-mode indication.

## Resource budget

One `St.DrawingArea` with a GJS Cairo painter. At most one GLib timer,
capped at **15 FPS** and only active while recording or processing. Default
capsules render roughly 200–400 circular dots per frame. No additional audio
capture, sampling, FFT, third-party dependency, model or background process.
Cairo contexts are disposed on repaint; the timer stops on hide/error/
extension teardown. Disabling GNOME animations disables the periodic timer.

Pure-renderer tests verify a strict fake Cairo API, geometry and behavior.
**Actual GNOME Shell rendering, fractional scaling, click hit testing and
CPU/GPU consumption still require on-device testing before merge.**

## Fedora manual checks

1. Install the branch and start recording; no extra configuration needed.
2. Record for 30 seconds at 48 kHz; examine GNOME Shell CPU and responsiveness.
3. Hover/click the capsule and confirm cancellation.
4. Release recording, watch Processing narrow, then disappear.
5. Retry a stored recording and trigger an error; confirm readable feedback.
6. Disable GNOME animations and check the absence of ongoing refresh.
7. Disable the extension mid-recording; verify complete actor/timer cleanup.
8. Reinstall `main` to restore the original HUD.
