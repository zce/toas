# 09: Cancel directly from the overlay

**What to build:** A small close action in the overlay cancels recording or processing without a trip to the top bar. Only that action captures input; the rest of the overlay remains click-through. Cancellation prevents all work that has not crossed the irreversible virtual-key-event boundary.

**Blocked by:** 01 (session lifecycle foundation).

**Status:** ready-for-agent

- [ ] Close cancels recording, transcription, Refine, and delayed pre-paste output and hides the overlay promptly
- [ ] A partial recording is discarded and no history record is written, matching explicit cancel semantics
- [ ] No virtual paste events occur when cancel wins before key emission
- [ ] Only the close action is reactive; the remaining overlay does not block underlying applications
- [ ] Destroying the extension while the action is focused or activated leaves no input grab or callback
