# 11: Own the recording indicator style

**What to build:** The top-bar recording state uses an extension-owned style instead of GNOME Shell's internal screen-recording class, preserving the familiar red indication without depending on an unstable implementation detail.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] No GNOME Shell internal recording-indicator CSS class remains referenced
- [ ] An extension-owned class controls the recording state and is removed on every idle, error, cancel, and destroy path
- [ ] Idle and recording states remain legible under light and dark Shell themes
- [ ] The indicator's accessible name/state communicates whether recording is active
