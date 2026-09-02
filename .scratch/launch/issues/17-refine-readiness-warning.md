# 17: Explain incomplete Refine configuration

**What to build:** Preferences immediately explain when Refine is enabled but its effective model or API key is missing, and make clear that raw transcription will be used until configuration is complete.

**Blocked by:** 02 (effective configuration).

**Status:** ready-for-agent

- [ ] The warning follows effective configuration, including environment-provided model and API key
- [ ] Missing model and missing key receive accurate guidance; the default endpoint is not falsely reported missing
- [ ] Completing configuration or disabling Refine removes the warning immediately
- [ ] The warning describes fallback behavior and does not imply the entire voice-input pipeline is broken
