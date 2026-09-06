<p align="center">
  <a href="https://toas.cc/">
    <strong>toas</strong>
  </a>
</p>

<h1 align="center">Talk Once, Act Smart.</h1>

<p align="center">
  Push-to-talk voice input for Fedora, GNOME, and Wayland.<br>
  Say it once. Keep moving.
</p>

<p align="center">
  <a href="https://toas.cc/">Homepage</a> &middot;
  <a href="https://github.com/zce/toas">Source</a> &middot;
  <a href="LICENSE">MIT License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/GNOME-49%20%2F%2050-4a86cf?style=flat-square&logo=gnome&logoColor=white" alt="GNOME Shell 49 and 50">
  <img src="https://img.shields.io/badge/Wayland-native-8ec07c?style=flat-square" alt="Wayland native">
  <img src="https://img.shields.io/badge/license-MIT-f2c14e?style=flat-square" alt="MIT license">
</p>

> Cloud intelligence, local lightness: a small desktop-native voice layer for the moments when typing is slower than thinking.

## What It Does

`toas` turns one held shortcut into text in the application that is already in focus:

```text
record -> transcribe -> optional refine -> focused application
```

The extension lives in the GNOME top bar. Hold the default `Ctrl+Shift+Space`, speak,
and release the modifiers. A compact overlay shows the live waveform and active stage
without opening another application.

## Cloud Intelligence, Local Lightness

`toas` keeps the intelligence in the cloud and the desktop layer deliberately small.
It captures audio locally, sends the completed recording through your configured
transcription provider, and returns text to the application in focus. Each provider owns
its own request protocol, while the local extension stays focused on recording, orchestration,
history, and output.

There are no model weights to download, no local inference runtime to maintain, and no
always-on model service consuming your machine's resources.

The default path makes requests only when you speak: one transcription request, plus one
optional Refine request when enabled. Choose from the providers and models supported by
`toas` based on the speed, quality, policy, and cost that fit your workflow.

## Privacy, Clearly Bounded

**On your desktop:** our local promise is concrete. There is no background listening,
telemetry, local model runtime, or always-on inference service. Audio is captured only
during an explicit recording and uploaded only after you stop.

`toas` never automatically inspects your desktop, editor, clipboard, files, or project.
The only reference material it sends is the **Context text** you explicitly configure,
and only to providers that support it.

Voice input text and retained recordings are kept locally for history and retry, bounded
by your retention settings and removable from the top-bar menu.

For a zero-retention tier, turn on **Private mode** from the top-bar menu. New voice inputs
are transcribed, refined, and inserted as usual, but nothing is written to history and each
recording is deleted as soon as processing finishes — including recordings from failed
attempts, which are not retained for retry while Private mode is on.

Private mode is session-only: it resets when you log out or the extension restarts.
Existing history remains available.

Private mode changes only what `toas` keeps on your disk. It does not change what is
uploaded.

**After upload:** your chosen provider's policy applies. Completed audio goes to your
configured transcription provider. Optional Refine sends transcript text to its configured
provider. Retention, training, logging, and data residency are determined by those services,
not by the local extension.

## Why toas

### One gesture, no context switching

Push-to-talk keeps the interaction predictable. Left-click the top-bar microphone to
toggle recording, right-click it for history and settings, or choose another shortcut
from Preferences.

### Clean words, unchanged meaning

The optional Refine stage can remove filler, fix punctuation, and repair broken speech
according to the instructions you configure, without changing the transcription path itself.

If Refine fails, the **On refine failure** setting decides whether `toas` falls back to the
transcription result or fails the voice input.

### Output that respects your target

Single-line text is committed directly when the focused Wayland application exposes a
text-input focus. Multiline text uses the clipboard path, preserving whitespace,
Markdown, lists, and code indentation.

Standalone terminals get terminal-aware paste. If the target window changes while
processing runs, the result stays on the clipboard instead of landing in the wrong window.

## Compatibility

| Component       | Target                             |
| --------------- | ---------------------------------- |
| Distribution    | Fedora                             |
| Desktop shell   | GNOME Shell 49 / 50                |
| Display server  | Wayland                            |
| Audio capture   | `pw-record` from PipeWire          |
| Transcription   | Qwen (recommended), or MiMo        |
| Optional Refine | MiMo, OpenAI, or OpenAI-compatible |

## Install

### One-line install

The online installer downloads the current `main` snapshot from GitHub and runs the same
installer used by a local checkout:

```bash
curl -fsSL https://toas.cc/install.sh | bash
```

Remove the extension with:

```bash
curl -fsSL https://toas.cc/uninstall.sh | bash
```

The online installer needs `curl` and `tar`. The extension installer checks for
`glib-compile-schemas`, `gnome-extensions`, and `pw-record` before installing.

### Local install

```bash
sudo dnf install pipewire-utils glib2
./install.sh
```

If GNOME does not immediately discover the extension, log out and back in, then run:

```bash
gnome-extensions enable toas@zce.me
```

Open Preferences with:

```bash
gnome-extensions prefs toas@zce.me
```

## First Run

On first enable, a one-time notice explains the shortcut and discloses that audio is
uploaded to your configured transcription provider while voice input text and some
recordings may be kept on disk.

Recording is blocked until the selected transcription provider has the required API key.

Preferences includes connection tests for both transcription and Refine so the configured
provider can be verified before normal use.

## Configure

Open GNOME Preferences for `toas`.

The default transcription configuration is the speed-first recommendation:

```text
provider = qwen
model    = fun-asr-flash-2026-06-15
```

Qwen routes supported models through their verified protocol automatically. An endpoint
override is available for advanced configurations.

MiMo with `mimo-v2.5-asr` is the alternative transcription provider.

### Context

**Context** is free text you write once — domain terms, background, names, or anything else
that may help processing.

Providers that support Context receive the text verbatim. Providers without Context support
never receive it.

### Refine

Refine is optional and runs as a separate text-processing step after transcription.

Supported Refine providers are:

* MiMo
* OpenAI
* OpenAI-compatible endpoints

Configure the provider, model, API key, and your own Refine instructions in Preferences.

The **On refine failure** setting controls what happens when Refine fails:

* **Use transcription** — continue with the transcription result.
* **Fail voice input** — treat the entire voice input as failed.

### API keys

Keys entered in Preferences are stored as plain text in GNOME settings.

Each provider also declares environment-variable fallbacks for its credentials and advanced
connection settings. Leave a key empty in Preferences and provide the corresponding
environment variable before the GNOME session starts if you prefer not to store it in dconf.

Secret Service integration is not implemented.

## Use It

1. Enable `toas` and configure a transcription provider API key.
2. Hold `Ctrl+Shift+Space` while speaking.
3. Release the modifiers to stop and process the recording.
4. Let `toas` insert the result, or use the clipboard when automatic insertion is disabled.

A shortcut without modifiers behaves as a start/stop toggle because GNOME Shell does not
expose a matching shortcut-release callback.

To change the shortcut, click the shortcut button in Preferences. Escape cancels and
Backspace disables it.

## Failure Handling

Recording, processing, and insertion failures show the error in the overlay and send a
desktop notification with a next action.

If Refine fails, behavior follows the configured **On refine failure** policy.

The overlay close action cancels a live voice input.

If the focused window changes while processing runs, the result stays on the clipboard
with a notice.

Failed processing retains its recording when possible so it can be retried from history
without recording again. Private mode disables that retention for new voice inputs.

## Recording

`pw-record` captures mono signed 16-bit PCM in 100 ms chunks. Those chunks drive the live
waveform, then the completed recording is wrapped in a standard WAV container before
processing.

The **Audio quality** preference controls the sample rate for new recordings:

| Preset   | Sample rate | Approximate cap |
| -------- | ----------: | --------------: |
| Minimum  |       8 kHz |      26 minutes |
| Low      |      12 kHz |      17 minutes |
| Standard |      16 kHz |      13 minutes |
| High     |      24 kHz |       9 minutes |
| Maximum  |      48 kHz |       4 minutes |

`Standard` is the default.

Audio is never uploaded during capture. Recordings shorter than one second are discarded.

Recordings are capped at 24 MB of PCM data so an accidentally open recording cannot exhaust
GNOME Shell memory during upload. A recording that reaches the cap stops and processes what
was captured.

## History

Recent voice inputs are listed directly in the top-bar menu. Each row has a copy action;
failed voice inputs also offer retry while their recording is still retained.

Retry reprocesses the stored recording and appends the attempt to history without pasting.

The **Private mode** switch above the list suspends retention for new voice inputs.
Existing history stays visible and `Clear History` keeps working while it is on.

History is stored under:

```text
${XDG_STATE_HOME:-~/.local/state}/toas/
  history.jsonl
  recordings/*.wav
```

`History entries` defaults to 500 and limits records. `Saved recordings` defaults to 20
and limits retained WAV files. Records can outlive their audio reference.

The top-bar `Clear History` action asks for confirmation and is disabled while recording.

<details>
<summary>Technical details</summary>

### Processing architecture

Voice processing runs through a small runtime-agnostic kernel with pluggable providers.

A voice input resolves to an ephemeral plan of one or two physical steps:

1. primary audio-to-text processing
2. an optional separate text Refine step

Each provider owns its protocol mapping. The GNOME host owns HTTP execution, persistence,
recording, and output.

History stores the final text plus a per-call trace of the steps that actually ran — never
raw HTTP bodies or credentials.

See `docs/adr/0001-processing-kernel.md`.

### Qwen transcription

Qwen exposes an explicit set of verified audio model/protocol mappings.

The default model is:

```text
fun-asr-flash-2026-06-15
```

It uses the DashScope native multimodal-generation API.

`qwen-audio-3.0-asr-flash` uses the same native protocol.

For these models, Context is sent as an `input_text` part before the audio:

```json
{
  "model": "fun-asr-flash-2026-06-15",
  "input": {
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": "<your Context text, verbatim>"
          }
        ]
      },
      {
        "role": "user",
        "content": [
          {
            "type": "input_audio",
            "input_audio": {
              "data": "data:audio/wav;base64,..."
            }
          }
        ]
      }
    ]
  },
  "parameters": {
    "format": "wav"
  }
}
```

The Context part is present only when Context text is configured.

`qwen3-asr-flash-2026-02-10` instead uses DashScope's OpenAI-compatible Chat Completions
endpoint with Context as a system message.

The legacy `qwen3-asr-flash` alias is retained for configurations saved before the
versioned model ID was introduced.

### MiMo transcription and Refine

MiMo uses one provider family with separate verified model selections for each role:

```text
Transcription: mimo-v2.5-asr
Refine:        mimo-v2.5
               mimo-v2.5-pro
```

The ASR model accepts audio input.

The text models are used by the optional Refine stage and support configurable instructions
and Context.

### OpenAI and OpenAI-compatible Refine

OpenAI and OpenAI-compatible providers are text-only in `toas` and are used for Refine,
not transcription.

The official OpenAI provider defaults to:

```text
gpt-4o-mini
```

The OpenAI-compatible provider accepts a user-configured service base URL and model ID
using the Chat Completions wire contract.

### Refine behavior

Refine makes one non-streaming text request after transcription.

Its instructions are configurable free text. Providers that support Context also receive
your configured Context text.

Refine never changes which provider or model performs the original audio transcription.

### Output behavior

When direct text input is unavailable, the final output is copied to the GNOME clipboard
and pasted through a compositor-side Clutter virtual keyboard.

Standalone terminals use `Ctrl+Shift+V`; other applications, including IDE-embedded
terminals, use `Shift+Insert`.

The extension never synthesizes Enter. Embedded line breaks remain part of
clipboard-pasted text.

When **Restore clipboard** is enabled, the previous text clipboard value is restored after
pasting. Rich or image clipboard content cannot be restored through `St.Clipboard`.

When **Insert automatically** is disabled, the result stays on the clipboard as the
deliverable.

</details>

## Debug

Watch extension logs:

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```

Check extension state:

```bash
gnome-extensions info toas@zce.me
```

On Wayland, GNOME Shell's ES-module cache can make disable/enable insufficient after
JavaScript changes. Log out and back in when updated code does not appear to load.

## License

Released under the [MIT License](LICENSE).
