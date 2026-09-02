# 13: Browse recent voice sessions

**What to build:** The top-bar menu provides a bounded, scrollable list of recent sessions, newest first. Selecting one opens a Shell-native detail view with the full transcript, refined output, status, duration, and useful processing metadata; users can copy the final text.

**Blocked by:** 03 (history repository).

**Status:** ready-for-agent

- [ ] The menu initially renders a bounded recent page and offers explicit pagination or load-more behavior
- [ ] List rows show status, concise output/transcript preview, timestamp, and duration without loading WAV contents
- [ ] A Shell-native modal detail view shows full text and relevant model/timing/error metadata
- [ ] Copy places final output, falling back to raw transcript, on the clipboard and reports completion
- [ ] Pruned audio and malformed history records do not break browsing
- [ ] Opening 500 retained records never creates 500 full-detail actor trees at once
