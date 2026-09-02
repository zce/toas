# 19: Prepare the release candidate

**What to build:** Produce a release candidate whose metadata, documentation, schema, packaged files, and automated checks match the feature set, without tagging or publishing externally.

**Blocked by:** 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18 (all user-facing feature work).

**Status:** ready-for-agent

- [ ] Version metadata and README cover onboarding/disclosure, cancellation, focus fallback, history/retry, shortcut capture, and connection testing
- [ ] All JavaScript passes syntax checks and schemas compile with `glib-compile-schemas --strict`
- [ ] A package-content check confirms all runtime files and no development scratch files are included
- [ ] Automated/fake-driven regression checks cover normal processing, tap discard, capture failure, cancel, limit stop, focus mismatch, history retry, and configuration fallback
- [ ] Install and uninstall scripts work from a clean temporary user-data target
