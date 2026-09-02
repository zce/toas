# 18: Review all user-facing copy

**What to build:** Existing and newly introduced interface strings use consistent, concise product language. Protocol details remain in technical documentation, while the UI explains actions, outcomes, privacy implications, and recovery steps.

**Blocked by:** 04, 06, 07, 08, 09, 12, 13, 14, 15, 16, 17 (all tickets introducing user-visible strings).

**Status:** ready-for-agent

- [ ] Voice input, session, transcription, and Refine terminology is consistent across overlay, menu, preferences, dialogs, and notifications
- [ ] Preferences remove protocol jargon such as Data URL and JSON Chat Completions where it does not help users act
- [ ] Errors state the problem and next action without exposing keys or unnecessarily dumping provider response bodies
- [ ] Privacy and retention wording matches actual upload, local storage, key storage, and clear-history behavior
- [ ] Every ticket introducing new strings includes acceptable copy before this final consistency pass
