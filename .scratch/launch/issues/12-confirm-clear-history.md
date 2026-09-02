# 12: Confirm before clearing history

**What to build:** Clearing history from the Shell menu opens a Shell-native confirmation dialog explaining that session text and retained recordings will be permanently deleted.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Cancel closes the dialog without calling clear or changing files
- [ ] Confirm invokes clear exactly once and preserves the existing cleared-count feedback
- [ ] Clear remains unavailable while a session is active
- [ ] Disabling the extension while the dialog is open destroys it and releases its modal grab
