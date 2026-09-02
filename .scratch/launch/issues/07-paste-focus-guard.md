# 07: Fall back to clipboard when the target window changes

**What to build:** When recording ends, the extension remembers the focused target window. Immediately before synthesizing paste, it checks again; if that window is gone or another window is focused, output stays on the clipboard and the user is notified instead of pasting into the other window.

**Blocked by:** 01 (session lifecycle foundation), 06 (notification policy).

**Status:** ready-for-agent

- [ ] Target identity is captured when recording ends and checked again at the last reversible point before virtual key events
- [ ] A changed, closed, or missing target produces clipboard-only output plus one notification
- [ ] Clipboard restore never overwrites voice text in the clipboard-only path
- [ ] An unchanged target retains current terminal and regular-app paste behavior
- [ ] The UI and documentation describe this as a window-level safeguard, not a guarantee about controls within the same window
