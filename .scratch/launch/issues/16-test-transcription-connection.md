# 16: Test transcription configuration

**What to build:** Preferences can send a tiny generated test-audio request through the same effective transcription configuration and report whether endpoint, authentication, model, and expected response shape are usable, without recording or adding history.

**Blocked by:** 02 (effective configuration).

**Status:** ready-for-agent

- [ ] The test uses current immediately persisted preference values and the same environment/default resolution as production
- [ ] A small valid generated WAV exercises the real input-audio request shape; no microphone or user recording is used
- [ ] A valid 2xx protocol response counts as connectivity success even if test audio yields no recognized speech
- [ ] Unauthorized, unavailable, timeout, invalid JSON, and incompatible response errors receive distinct useful feedback where the server provides enough information
- [ ] The row shows busy, success, and failure states and prevents overlapping tests
- [ ] Tests can exercise outcomes through a local fake endpoint; validation does not depend solely on a live provider
