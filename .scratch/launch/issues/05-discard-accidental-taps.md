# 05: Discard accidental tap recordings silently

**What to build:** A user-initiated stop before the minimum recording length is treated as an accidental tap and returns quietly to idle. A recorder or device failure remains a real error.

**Blocked by:** 01 (session lifecycle foundation).

**Status:** ready-for-agent

- [ ] A user-stopped recording shorter than one second produces no overlay error, notification, history entry, or WAV file
- [ ] Its observed transition is recording to idle, with no error state in between
- [ ] A capture process that fails unexpectedly, including before producing bytes, remains distinguishable from a tap and follows the failure path
- [ ] Recordings meeting the minimum duration process normally
