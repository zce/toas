# 03: Add a safe history query and attempt API

**What to build:** History becomes a small repository that can list recent sessions, retrieve one session, resolve retained audio, and append a retry attempt linked to its original session. Existing pruning behavior remains intact, malformed JSONL lines do not break the UI, and retry never rewrites away the original failure.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Public list/get operations return newest-first metadata without reading WAV contents
- [ ] Callers can request bounded pages rather than materializing UI for all retained sessions
- [ ] Retry results are appended with a stable link to the original session and attempt number; original records remain unchanged
- [ ] Missing/pruned audio and malformed JSONL records are handled explicitly without crashing
- [ ] Existing session and recording limits, orphan cleanup, clear, and append behavior remain correct
