# Configuration Guide

## Setup via Preferences (recommended)

Open GNOME Extensions → toas → Settings.

Configure:

- Primary provider (Qwen recommended) and its model
- The provider's API key
- Optional: Refine (provider, model, instructions, failure behavior)
- Optional: Context text (sent to providers that support it)
- Audio quality and history limits

All settings are saved automatically. Each provider group has a **Test
connection** button that sends a harmless sample through the same processing
path as a real voice input.

## Manual configuration via dconf

### Processing Config

```bash
# One generic JSON document. Omitted properties receive shipped defaults.
dconf write /org/gnome/shell/extensions/toas/processing-config \
  "'{\"providers\":{},\"primary\":{\"provider\":\"qwen\",\"values\":{\"model\":\"fun-asr-flash-2026-06-15\"}},\"refine\":{\"enabled\":true,\"execution\":\"separate\",\"provider\":\"mimo\",\"values\":{\"model\":\"mimo-v2.5\"},\"instructions\":\"Refine the text\",\"onError\":\"fallback\"}}'"
```

Provider-level non-secret values live under `providers.<provider-id>`. For
example, configure an OpenAI-compatible service with
`{"providers":{"openai-compatible":{"endpoint":"https://my-gateway.example/v1"}}}`.

### API keys

Keys are stored per provider in one dictionary, keyed
`providers/<provider-id>/key`:

```bash
dconf write /org/gnome/shell/extensions/toas/provider-secrets \
  "{'providers/qwen/key': 'sk-your-qwen-key', 'providers/mimo/key': 'sk-your-mimo-key'}"
```

A key entered here is shared by both roles when the same provider serves
primary and refine. Keys are stored in plain text by dconf; see the security
note below.

### Context text

```bash
dconf write /org/gnome/shell/extensions/toas/context \
  "'技术讨论。术语：useEffect, usePaymentMethods, fetchPaymentMethods'"
```

The Context is free text you compose: terms, background, names — anything
that helps recognition or refinement. It is sent verbatim, only to roles
whose provider supports Context (Qwen primary, all refine providers); other
roles never see it. toas never reads your desktop, editor, clipboard, or
files on its own.

## Environment variables (optional fallback)

For each provider key, the first non-empty variable wins. Values never appear
in the UI.

```text
Qwen:  TOAS_QWEN_API_KEY / QWEN_API_KEY / DASHSCOPE_API_KEY
MiMo:  TOAS_MIMO_API_KEY / MIMO_API_KEY
OpenAI: TOAS_OPENAI_API_KEY / OPENAI_API_KEY
OpenAI-compatible: TOAS_OPENAI_COMPATIBLE_API_KEY
```

Priority: dconf stored value → environment variable → missing.

## Supported providers

### Qwen (default, recommended)

- Primary processing only
- Model: `fun-asr-flash-2026-06-15` (default; also verified:
  `qwen-audio-3.0-asr-flash`, `qwen3-asr-flash-2026-02-10`)
- Fast mixed Chinese/English technical dictation; supports free-text Context
  as recognition bias. The endpoint routes by model: DashScope native ASR for
  audio-3.0/fun-asr, OpenAI-compatible for versioned qwen3 models.
- API: [DashScope](https://dashscope.aliyuncs.com/)

### MiMo

- Primary processing (`mimo-v2.5-asr`) and text Refine (`mimo-v2.5` or
  `mimo-v2.5-pro`)
- One shared base URL and credential for both roles; independent models

### OpenAI

- Refine only (protocol compatibility does not imply primary capability)
- Model default: `gpt-4o-mini`
- API: [OpenAI](https://platform.openai.com/)

### OpenAI-compatible

- Refine only, for bring-your-own endpoints
- Requires a Provider `endpoint` value and a model

## Security note

Keys entered in Preferences are stored in plain text by dconf. To keep keys out
of that storage, leave the fields empty and set the environment variables
before the GNOME session starts. Secret Service integration is not implemented
yet.

## Troubleshooting

View all settings:

```bash
dconf dump /org/gnome/shell/extensions/toas/
```

Reset to defaults:

```bash
dconf reset -f /org/gnome/shell/extensions/toas/
```

Check logs:

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```

## See also

- Architecture: `docs/adr/0001-processing-kernel.md`
- Domain language: `CONTEXT.md`
