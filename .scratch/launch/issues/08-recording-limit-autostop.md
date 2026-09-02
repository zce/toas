# 08: Auto-stop safely at the recording limit

**What to build:** Reaching the recording size cap becomes a normal, single automatic stop. The captured audio is finalized as a valid WAV and processed once, with a clear indication that the recording limit ended the capture, rather than discarding a long session.

**Blocked by:** 01 (session lifecycle foundation), 06 (notification policy).

**Status:** ready-for-agent

- [ ] Limit stop wins safely against simultaneous modifier release, click, subprocess exit, or cancel and starts processing at most once
- [ ] The finalized WAV is valid and remains below the upload limit
- [ ] The user is told that the recording ended because the limit was reached before normal completion feedback
- [ ] The session is saved and processed like a normal recording unless the user cancels
- [ ] Shorter recordings are unaffected
