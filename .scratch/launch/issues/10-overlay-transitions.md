# 10: Animate overlay transitions safely

**What to build:** The overlay uses a short native-feeling fade and slight scale transition instead of hard appearing and disappearing, without ever leaving an invisible input region or letting an old transition hide a new session.

**Blocked by:** 09 (overlay interaction and cancellation lifecycle).

**Status:** ready-for-agent

- [ ] Show and hide use an approximately 150 ms fade plus subtle scale transition
- [ ] Rapid show, cancel, error, hide, and new-session sequences settle in the latest requested state
- [ ] A hidden overlay and close action are non-reactive and do not intercept input
- [ ] Error hide timers and extension destruction remove active transitions and callbacks safely
