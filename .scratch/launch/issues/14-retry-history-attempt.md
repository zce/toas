# 14: Retry a failed session as a linked attempt

**What to build:** A failed history session with retained audio can be retried without recording again. Retry runs the current transcription and Refine configuration, appends a new attempt linked to the original failure, refreshes the history view, and does not automatically paste into an application.

**Blocked by:** 01 (session lifecycle foundation), 02 (effective configuration), 03 (history repository), 06 (notification policy), 13 (history browser).

**Status:** ready-for-agent

- [ ] Retry is offered only for failure sessions with a readable retained WAV (transcription and output-stage failures; recording-stage failures have no audio by definition)
- [ ] It starts no recorder and runs at most one pipeline concurrently
- [ ] Success or failure appends a linked attempt while preserving the original record and failure details
- [ ] Retry never synthesizes paste; successful text is available in the detail view with an explicit Copy action
- [ ] Missing/pruned audio explains why retry is unavailable
- [ ] A retry in progress is visible in the history UI, and starting a new recording is blocked while it runs
- [ ] Cancelling retry leaves the original history intact and appends no partial attempt
