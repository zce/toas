# 01: Make session termination explicit and testable

**What to build:** Recording and processing finish for one explicit reason: user stop, accidental short tap, recording limit, capture failure, or cancellation. Each reason drives one deterministic state transition, so later UX work cannot accidentally process twice, show contradictory errors, or paste after cancellation. Add the smallest dependency seams and fake-driven tests needed to verify these flows; do not introduce a general plugin architecture.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

**Scope notes:**

- Outcomes enumerate: user stop, short tap, size limit, capture failure, and explicit cancellation.
- Idempotency covers the orchestrator and recorder; network clients already use per-request cancellables.
- Cancellation must reach the delayed pre-paste output and clipboard restore timers so late work cannot run after cancel.
- Tests run as standalone GJS scripts with fakes; no GNOME Shell session is required.
- Seams stay minimal: constructor injection of collaborator instances, no plugin or registry architecture.

- [ ] Recorder completion uses structured outcomes rather than message-matching generic errors
- [ ] Stop/finalize is idempotent when modifier release, size limit, subprocess exit, and cancellation race
- [ ] Tests cover each outcome and assert exactly one terminal transition
- [ ] Cancellation can propagate through recording, network calls, delayed output, and clipboard restoration
- [ ] Existing normal recording, transcription, refine, paste, and history behavior remains unchanged
