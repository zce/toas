# Toas Matrix HUD · final v8.7 port

This branch directly replaces the old HUD with the accepted interactive
`toas-matrix-v8.7-timing.html` design. There are **no visual feature flags**.

## Visual specification

- **Recording:** 164×40 logical px capsule, 46×11 dots at 3.5px pitch.
  Two reflected **angular / folded-triangle** voices with restrained,
  correlated harmonic motion; a shared carrier, 100ms RMS history,
  noise-gated slow adaptive gain and short phosphor tails. The actual
  2026-10-30 test WAV revealed over-amplification of quiet input; the
  corrected maximum observed displacement is approximately 2 rows in
  the test sweep. No freestanding lines, icons, or text.
- **Processing:** 136×40 logical px, 38×11 dots with the same 3.5px
  spacing. A luminous point packet travels horizontally through the
  same visual language, with a smooth transition from recording.
  Only the column count changes; CANCEL stays the same physical size.
- **Hover:** 63 cells of the **existing 4×5 lattice** morph into a small
  amber CANCEL. Exactly the same glyph size in both stages, no extra label.
  Only a genuine new pointer move triggers it.
- **End:** the simpler approved finish, **tight contraction + fade**
  (400ms), without outward wipe or independent clear fronts.
- **Cancel:** short fade, **no end sound**. The full capsule remains
  clickable. Errors retain their readable message.
- **Color:** the approved blue/ice-white gradient; background dots stay
  dim and interior edges soften naturally.

## Recording sounds

Preferences → **Voice Input → Recording sounds**: enabled by default.
Users can select start and stop cue styles **independently** from Tap,
Crystal, Pulse, and Halo. Defaults are **Crystal** start and **Tap** stop.
These are the eight original short v8.7 sound designs, synthesized to
tiny PCM WAV files in the app's cache on extension enable. Each cue is
played with a short-lived `pw-play` subprocess, already supplied by Fedora's
required `pipewire-utils` package. No resident service or permanent mixer.
We avoid Mutter's alert-only player: system alert mute can silence it even
when the Toas preference is enabled.

**Timing contract:**
1. The HUD begins entering when recording is requested and the start
   cue process is launched immediately.
2. The regular `pw-record` process is started immediately, but its PCM
   data and RMS levels are **discarded** during the start cue and a
   100ms safety interval. Once the gate opens, only newly read PCM enters
   the WAV file. This is a practical software guard, not a guarantee
   against every acoustic echo or unusually delayed PipeWire buffer.
3. Normal stop sends SIGINT and **drains any buffered speech** before
   closing the capture gate. The HUD switches to Processing immediately;
   a valid completed recording plays its stop cue as soon as the drain
   finishes, without waiting for network transcription. A short tap,
   cancellation, or capture failure emits no stop cue.
4. Cancel and errors do not emit a normal stop cue; pending start audio
   is cancelled. The setting is read at each playback, so disabling it
   takes effect without extension reload.

The cue WAV cache (v1 and v2) is removed by `docs/uninstall.sh`. If the user cache
or `pw-play` is unavailable, cue initialization fails open:
recording continues with sound disabled.

## Runtime cost and validation

- One `St.DrawingArea`, one GLib 30 FPS timeout while HUD is visible,
  zero ongoing idle timer. Static grid geometry, edge fade, and dot buffers
  are reused at normal recording/processing widths. The smaller Processing
  state no longer computes clipped, off-capsule columns.
- Only the existing audio recorder's 100ms RMS readings are consumed.
  No FFT, new capture source, GPU shader, backend or permanent process.
- Correct 1×/2× logical dot count and Cairo context disposal on every
  repaint. Reduced-motion mode disables periodic animation.
- Pure renderer: ten regression tests (dimensions, bounded angular
  waveform amplitude, true dot geometry at both widths, equal CANCEL
  glyph, RMS behavior, pointer reset, HiDPI, and simple exit).
- Earcon synthesis: eight WAV variants, header/length and level checks.
- Audio gate: tests verify muted data is never written, an async read
  started while muted stays excluded even after the gate opens, and the
  final buffered samples drain before the capture gate closes.
- Six mocked orchestrator tests verify start gate timing, the stop cue
  after complete drain, disabled sound, cancellation during start and
  drain, quick release, microphone launch failure, and timer cleanup.
- Mocked PipeWire playback checks check cue selection, cancellation,
  short-lived process creation, and absence of cancellation warnings.

**Still required:** hands-on Fedora GNOME 50 check of exact motion
fidelity, real audio output latency, device echo, scale factors, and
GNOME Shell CPU. Pure JavaScript tests cannot substitute for those.
Keep this PR Draft until accepted.

## Install and rollback

```sh
git switch feat/matrix-hud-preview
./install.sh
```

No setting or restart needed to activate the new visual. For the old
HUD, install `main` again. Preferences can change the sound switch and
both sound styles at any time.

## Fedora acceptance checklist

1. Record with the built-in mic and at 50% / 100% system input gain.
   Confirm angular waves move vertically, with no repeating hollow
   oval patterns.
2. Observe the smaller Processing HUD and hover it: CANCEL must not
   change font size; first show after an unmoved pointer must not show it.
3. Record for 30s, allow Processing to finish, and confirm the tight
   400ms exit, with no animation/CPU work left afterward.
4. Hear start sound as the HUD appears. Measure whether any start tone
   enters the written WAV; test speakers, headphones, and Bluetooth
   devices, as latency varies.
5. Stop normally: audio should cease accepting PCM before the stop
   sound plays. Cancel in both recording and Processing: **silent**.
6. Turn off Recording sounds in Preferences, then test start/stop.
   Switch styles and compare all eight options.
7. Repeat sessions quickly, including cancelling during the start cue.
   Confirm no stuck recording gate or leaked GLib timeout.
8. Disable the extension mid-recording, turn off GNOME animations, and
   test fractional scaling, multi-monitor placement and CPU overhead.
