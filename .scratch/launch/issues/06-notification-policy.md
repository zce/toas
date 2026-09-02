# 06: Make failures and fallbacks discoverable

**What to build:** Important failures produce one durable GNOME notification in addition to the brief overlay. Refine fallback is communicated as a non-fatal warning that says the raw transcript was used, while cancellation and accidental taps stay silent.

**Blocked by:** 01 (session lifecycle foundation), 05 (tap classification).

**Status:** ready-for-agent

- [ ] Recording, transcription, and pre-paste output failures produce exactly one notification per session with a useful next action
- [ ] Refine failure followed by successful raw-transcript output produces a warning, not a failed-session message
- [ ] Cancellation and accidental taps produce no notification
- [ ] Successful sessions without warnings produce no notification
- [ ] Disabling the extension cancels pending notification-related callbacks safely
