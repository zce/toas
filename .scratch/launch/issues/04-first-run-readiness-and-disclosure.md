# 04: Guide first use and block unconfigured recording

**What to build:** On first enable, users learn the shortcut, left-click action, and right-click menu, and are told before recording that audio is uploaded to their configured transcription service, session text and some WAV files are retained locally, and keys entered in preferences are stored in dconf. Trying to record without a usable transcription configuration opens Settings instead of recording doomed audio.

**Blocked by:** 02 (effective configuration).

**Status:** ready-for-agent

- [ ] A dedicated persistent setting records that onboarding was shown; clearing history does not make it reappear
- [ ] Existing users with prior history are migrated without receiving a misleading new-install notice
- [ ] Disclosure identifies remote audio upload, local history retention and clearing, and dconf key storage in concise user language
- [ ] An unready transcription configuration prevents both shortcut and top-bar recording, notifies the user, and opens preferences
- [ ] Environment-only users pass the same readiness check and can record normally
