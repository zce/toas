# Changelog

## Version 13 — 2026-09-06

- Added Doubao BigASR Flash as a selectable transcription provider and aligned the website/setup copy with the new option.
- Made the minimum recording duration configurable in Preferences, with a 600 ms default to filter accidental short activations.
- Made **Private mode** persist until explicitly disabled while leaving existing history available.
- Added `Saved recordings = 0` to keep text history without retaining completed WAV files or retry-from-audio.
- Reduced the default `History entries` retention from 500 to 30 to match the recent-history depth surfaced in the top-bar menu; explicitly configured larger limits remain supported.
- Placed the voice overlay on the active target monitor instead of always using the primary monitor.
- Aligned output, failure, retry, and history feedback with actual runtime behavior, including clipboard-only delivery and unavailable retained audio.
- Polished product naming, privacy copy, first-run feedback, and Preferences guidance to match the current UI and behavior.

## Version 12 — 2026-09-05

- Replaced the fixed transcription/refinement pipeline with a provider-neutral processing kernel: Qwen (recommended), MiMo, and OpenAI providers, cross-provider refine combinations, and shared per-provider credentials.
- Added optional separate Refine with configurable instructions and fallback/abort failure behavior. Refine is configured inside the Voice Processing group and shares per-provider credentials with primary processing.
- Added Context: free text the user composes (terms, background, names), sent verbatim to providers that support it. No automatic desktop, editor, clipboard, or file inspection.
- Preferences, connection tests, and history were rebuilt on the new architecture; history now stores final text and a per-call Trace. Context settings appear only when an active role consumes them.

## Version 11 — 2026-09-03

- Added session-only **Private mode** for new voice inputs.
- Private voice inputs still transcribe, refine, and insert text, but write no history and delete their recordings after processing.
- Added visible private-state indicators to the top-bar icon and recording overlay.
- Documented the boundary between local retention and provider-side upload policies.

## Version 10 — Initial version

- Added push-to-talk voice input for Fedora, GNOME Shell 49 / 50, and Wayland.
- Added cloud transcription, optional refinement, focused-application output, local history, and retry support.
