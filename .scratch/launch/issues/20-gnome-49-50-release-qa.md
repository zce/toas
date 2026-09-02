# 20: Verify the release candidate on GNOME 49 and 50

**What to build:** A human-run clean-session QA pass verifies the release candidate on both declared GNOME Shell versions before any publication.

**Blocked by:** 19 (release preparation).

**Status:** manual-qa (ready after ticket 19)

- [ ] Fresh install, enable, disable, logout/login, and uninstall are verified on GNOME 49 and GNOME 50
- [ ] Each version verifies keybinding capture/use, first-run disclosure, modal dialogs, overlay hit testing/animation, notification behavior, clipboard restore, and terminal paste
- [ ] A real provider smoke test verifies transcription, Refine fallback/success, history browse, copy, and failed-session retry
- [ ] Light/dark themes and at least one HiDPI scale are checked for overlay and history readability
- [ ] Results and any accepted limitations are recorded for release notes
