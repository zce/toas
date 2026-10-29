# Matrix HUD experiment (GNOME 49/50)

This is a **draft visual experiment**, not a replacement for the original Toas HUD.
The existing audio recording, transcription, refine, insertion, and error state
logic are unchanged. The normal HUD remains the **default**.

## Try it on Fedora

Install this branch via the repository's existing `./install.sh`.
Only test from an idle Toas session; the installer disables the extension while
it copies the branch and compiles its schema.

Then enable the preview and reload the extension:

```sh
GSETTINGS_SCHEMA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/toas@zce.me/schemas" \
  gsettings set org.gnome.shell.extensions.toas matrix-hud true
gnome-extensions disable toas@zce.me
gnome-extensions enable toas@zce.me
```

For an immediate, dependency-free rollback to the original view (without
reinstalling Toas), set `matrix-hud false` using the same
`GSETTINGS_SCHEMA_DIR` command, then disable/enable the extension again.
The choice is read at extension startup; it does not hot-swap the overlay.

## Behavior

- Recording: full-capsule dot matrix, three braided amplitude-responsive strands.
  Uses the **existing** 100 ms normalized RMS feed and AudioLevelMeter. No FFT.
- Busy (transcribing, refining, outputting, copying): shorter matrix capsule,
  a moving dot packet, no stage words or extra line primitives.
- Hover: reduced signal brightness and a subdued amber dot-matrix **CANCEL**.
  Clicking anywhere on the capsule invokes the same orchestrator cancellation
  callback as the original close button.
- Completion / cancellation: short fade-out; no ongoing animation after hide.
- Error: a readable, short failure message instead of a decorative-only animation.
  The top-bar indicator retains the actual stage and Private Mode indication.

## Resource and compatibility budget

- The regular HUD path allocates no drawing canvas or timer.
- Matrix path: one `St.DrawingArea` (Cairo), one user-session GLib timer
  at **15 FPS maximum** while recording or processing, and about
  **200–400 circular dots per frame** at the default capsule sizes.
- The Cairo context is always explicitly disposed. No new service, audio
  capture, inference, FFT, plugin, or library dependency.
- Timer stops on hide, error, and extension disable. System Reduce Motion /
  disabled animations uses only the native 100 ms audio-level callbacks in
  recording, with a static processing matrix and no animation timer.
- The hover interaction uses the same input region as the capsule; it does
  not add a separate invisible close widget.

**Important:** The automated renderer tests run with a strict fake Cairo
context and verify dot counts, volume response, and the warning glyph. Actual
GNOME 49/50 visual fidelity, texture/upload costs, Shell CPU utilization, and
fractional-scaling behavior have **not** been measured. Reject this experiment
if it causes any noticeable Shell jank or idle regression; opt-out immediately.

## Manual smoke-test checklist

1. Idle with toggle off: confirm the original HUD is pixel-identical and no
   matrix timer is running.
2. Toggle on, record for 30+ seconds at 48 kHz: observe GNOME Shell CPU,
   responsiveness, wave dynamics, and mouse hover.
3. Hover and click the full capsule; confirm cancellation and zero output.
4. Record and release: confirm recording → narrower processing dot packet →
   fade-out, with no leftover overlay or timer.
5. Retry a stored recording; trigger a provider error and confirm readable
   error feedback.
6. Turn off GNOME animations; confirm no periodic idle/busy repainting.
7. Disable the extension during an active HUD and verify resource cleanup.
