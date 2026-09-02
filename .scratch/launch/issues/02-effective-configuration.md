# 02: Centralize effective configuration

**What to build:** The extension and preferences use one definition of the effective transcription and Refine configuration after combining GSettings values, environment variables, and defaults. Readiness checks, connection tests, warnings, and the actual pipeline therefore always agree.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] One shared resolver reports effective endpoint, model, language, API-key presence, source, and readiness for transcription and Refine
- [ ] API-key values are never returned in diagnostics, logs, notifications, or UI labels
- [ ] Environment-only configuration is treated as configured
- [ ] Refine readiness reflects enabled, model, and API-key requirements; its default endpoint is not incorrectly reported missing
- [ ] Tests cover setting overrides, environment fallbacks, defaults, and incomplete combinations

**Scope notes:**

- One resolver, consumed by both the Shell extension and the preferences process; it must be importable outside GNOME Shell.
- Readiness distinguishes transcription (key required) from Refine (enabled + model + key required).
- Source precedence is: user override, then environment variable, then schema default.
