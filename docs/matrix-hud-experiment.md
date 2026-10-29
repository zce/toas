# Matrix HUD · v7.3 GNOME Shell port

This branch runs the **Matrix HUD directly**. There is no feature flag and no
alternate Shell HUD to maintain. Its visual reference is the user-approved
`toas-matrix-v7.3.html` prototype, specifically its 1× rendering.

## Fidelity contract

| Motion / geometry | GNOME implementation |
| --- | --- |
| Recording | 174 × 42 px, 3.7px pitch, exactly 47 columns × 11 rows |
| Voice feedback | Existing 100ms raw RMS; fixed-range sqrt mapping; 48-sample history |
| Wave motion | Time-interpolated, left→right history and shared band-limited phase |
| Anchors | Raised-sine window, all three curve endpoints on vertical midpoint |
| Edge shadow | Rounded-capsule signed distance with softened top/bottom rows |
| Processing | 116 × 42px; two stretched hollow diamonds with opposing breath |
| Hover | Soft amber dot-matrix CANCEL only after fresh pointer movement |
| Entry | Expand from 76px with native 310ms easing |
| Completion | Continue diamond breathing during 570ms contraction/fade |
| Cancel | 320ms fade and immediate input disable |
| Errors | Readable error message, unchanged presenter error handling |

No separate lines or icons are drawn; all visible waves, diamonds, and
the CANCEL label are individual Cairo dots. The top-bar status and privacy
indicator are unchanged. The completion animation is the **successful
busy→idle** exit; failure does not misleadingly show a success animation.

## Installation and rollback

```sh
git switch feat/matrix-hud-preview
./install.sh
```

The new HUD is enabled immediately. To restore the original, reinstall
`main` using the same script.

## Performance design

- A single `St.DrawingArea` and one GLib timeout during active recording,
  processing, or a finishing transition: **maximum 30 FPS**. No idle loop.
- Default recording geometry contains 517 dot positions; about 490 lie
  within the softly masked capsule. Processing draws fewer.
- Static dot coordinates, edge alpha, and typed curve work buffers are
  cached for the two stable widths. Only one temporary transition geometry
  is kept. Cache is released on extension teardown.
- Curve positions and diamond distance profiles are calculated **once per
  column/row**, not independently for each dot.
- Reuse the recorder's existing 100ms RMS events. No FFT, audio changes,
  shader, additional service or external library.
- The Cairo context is explicitly disposed after each paint; backing-surface
  scaling does not multiply the logical grid point count.
- If GNOME animations are disabled, the periodic timer is not started;
  recording refreshes only on RMS events, and Processing is static.

A pure-JavaScript fake-Cairo benchmark may help catch regressions, but is
**not** a measurement of GNOME Shell's compositor, texture upload, or real
user-session CPU usage. Keep this PR as Draft until Fedora validation.

## Fedora acceptance

1. Compare the HUD beside v7.3 HTML at **1× actual size**, especially the
   anchored ends, three smooth strands, faint top/bottom dot rows, Processing
   diamonds and the final contraction/fade.
2. Record for 30+ seconds, vary microphone distance and volume, and check
   that syllables change the *vertical* profile, not only luminance.
3. Finish a run and record again with the mouse unmoved. CANCEL must stay
   hidden until new mouse movement. Clicking the whole HUD must cancel.
4. Check the Processing state for long and short transcriptions; ensure the
   animation runs until the overlay completely disappears.
5. Trigger an error, disable the extension mid-recording, and turn off Shell
   animations; ensure no stuck timer, actor, or inaccessible error.
6. Test fractional monitor scaling and multiple monitors. There should be
   the same logical number of dots at 1× and 2×.
7. Compare `gnome-shell` CPU against `main` during a 30-second recording
   and a long Processing phase; look for skipped frames and memory growth.
   **Target**: negligible idle overhead and preferably < 5 percentage points
   of one CPU core incremental load. These are review gates, not measured
   results.
