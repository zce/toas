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
record -> transcribe -> refine -> focused application
```

The extension lives in the GNOME top bar. Hold the default `Ctrl+Shift+Space`, speak,
and release the modifiers. A compact overlay shows the live waveform and each active
stage without opening another application.

## Cloud Intelligence, Local Lightness

`toas` keeps the intelligence in the cloud and the desktop layer deliberately small.
It captures audio locally, sends the completed recording to your configured
Chat Completions endpoint, and returns text to the application in focus. There are no
model weights to download, no local inference runtime to maintain, and no always-on
model service consuming your machine's resources.

The default path makes requests only when you speak: one for transcription, plus one
optional Refine request when enabled. Bring the endpoint and model that fit your needs,
speed, quality, and budget. A small, on-demand API cost can replace the installation,
maintenance, and idle resource cost of a local model stack while turning one shortcut
into a high-leverage writing workflow.

## Privacy, Clearly Bounded

**On your desktop:** our local promise is concrete. There is no background listening,
telemetry, local model runtime, or always-on inference service. Audio is
captured only during an explicit recording and uploaded only after you stop.
toas never automatically inspects your desktop, editor, clipboard, files, or
project. The only reference material it sends is the **Custom Terms** you
explicitly configure, and only to providers that support them.
Voice input text and retained recordings are kept locally for history and retry, bounded by
your retention settings and removable from the top-bar menu.

For a zero-retention tier, turn on **Private mode** from the top-bar menu. New voice inputs
are transcribed, refined, and inserted as usual, but nothing is written to history and each
recording is deleted as soon as processing finishes — including recordings from failed
attempts, which are not retained for retry while Private mode is on. The switch is
session-only: it resets when you log out or the extension restarts.

Private mode changes only what `toas` keeps on your disk. It does not change what is
uploaded: recordings still go to your configured transcription service, so read the next
paragraph with the switch on or off.

**After upload:** your chosen provider's policy applies. `toas` sends completed audio to
the transcription endpoint you configure; optional Refine sends transcript text to its
own endpoint. Retention, training, logging, and data residency are determined by those
services, not by the local extension. Choose an endpoint and model whose policy matches
your work.

## Why toas

### One gesture, no context switching

Push-to-talk keeps the interaction predictable. Left-click the top-bar microphone to
toggle recording, right-click it for history and settings, or choose another shortcut
from Preferences.

### Clean words, unchanged meaning

The optional Refine stage removes filler, fixes punctuation, and repairs broken speech
without answering, summarizing, or inventing content. If Refine is disabled, incomplete,
or unavailable, the raw transcript is still inserted.

### Output that respects your target

Single-line text is committed directly when the focused Wayland application exposes a
text-input focus. Multiline text uses the clipboard path, preserving whitespace,
Markdown, lists, and code indentation. Standalone terminals get terminal-aware paste.
If the target window changes while processing runs, the result stays on the clipboard
instead of landing in the wrong window.

## Compatibility

| Component | Target |
| --- | --- |
| Distribution | Fedora |
| Desktop shell | GNOME Shell 49 / 50 |
| Display server | Wayland |
| Audio capture | `pw-record` from PipeWire |
| Primary processing | Qwen (DashScope, recommended), or MiMo |
| Optional refine | MiMo, OpenAI, or any OpenAI-compatible endpoint |

## Install

### One-line install

The online installer downloads the current `main` snapshot from GitHub and runs the
same installer used by a local checkout:

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
uploaded to your configured voice-processing provider while voice input text and some
recordings are kept on disk. Recording is blocked until a provider API key is configured.
Each provider group includes a `Test connection` button that sends a short silent sample
through the exact processing path a real voice input uses.

## Configure

Open GNOME Preferences for `toas`. Pick a primary provider, its model, and its API key.
The default is the speed-first recommendation:

```text
provider  = qwen
model     = qwen3-asr-flash
endpoint  = https://dashscope.aliyuncs.com/... (provider default)
```

MiMo (`mimo-v2.5-asr`) is the alternative primary. Provider keys can also come from the
GNOME session environment, in the priority order each provider documents:

```text
TOAS_QWEN_API_KEY / QWEN_API_KEY / DASHSCOPE_API_KEY
TOAS_MIMO_API_KEY / MIMO_API_KEY
TOAS_OPENAI_API_KEY / OPENAI_API_KEY
```

**Custom Terms** is a list of technical terms you configure once. When your primary
provider supports recognition context, these terms are sent with each recording to help
preserve identifiers such as `useEffect` or `usePaymentMethods`.

Refine is optional: a second service (MiMo, OpenAI, or any OpenAI-compatible endpoint)
applies your written instructions to the primary text. Configure its model and key, or
disable it for literal dictation. If refine fails mid-processing, the primary text is
inserted with a non-fatal notice (or the voice input fails, if you choose abort).

Keys entered in Preferences are stored as plain text in dconf. Leave them empty and set
environment variables before the GNOME session starts if you want to keep them out of
dconf. Secret Service integration is not implemented yet. See `docs/CONFIGURATION.md`
for the full key and environment-variable reference.

## Use It

1. Enable `toas` and configure a transcription API key.
2. Hold `Ctrl+Shift+Space` while speaking.
3. Release the modifiers to stop and process the recording.
4. Let `toas` insert the result, or use the clipboard notification when automatic paste is off.

A shortcut without modifiers behaves as a start/stop toggle because GNOME Shell does
not expose a matching shortcut-release callback. The extension polls the held modifier
mask every 40 ms. To change the shortcut, click the shortcut button in Preferences;
Escape cancels and Backspace disables it.

## Failure Handling

Recording, processing, and insertion failures show the error in the overlay and
send a desktop notification with a next action. If Refine fails, the primary text is
inserted with a non-fatal notice (or the voice input fails, when you choose abort).
The overlay close action cancels a live voice input.

If the focused window changes while processing runs, the result stays on the clipboard
with a notice. Failed processing retains its recording when possible, so it can
be retried from history without recording again.

## Recording

`pw-record` captures mono signed 16-bit PCM in 100 ms chunks. Those chunks drive the
live waveform, then the completed recording is wrapped in a standard WAV container
before processing.

The `Audio quality` preference controls the sample rate for new recordings:

| Preset | Sample rate | Approximate cap |
| --- | ---: | ---: |
| Standard | 16 kHz | 13 minutes |
| Balanced | 24 kHz | 9 minutes |
| High | 48 kHz | 4 minutes |

Audio is never uploaded during capture. Recordings shorter than one second are discarded.
Recordings are capped at 24 MB so an accidentally open recording cannot exhaust GNOME
Shell memory during upload. A recording that reaches the cap stops and processes what
was captured.

## History

Recent voice inputs are listed directly in the top-bar menu. Expand a row to copy its text
or retry a failed voice input whose recording is still retained. Retry reprocesses the
stored recording and appends the attempt to history without pasting.

The `Private mode` switch above the list suspends retention for new voice inputs; existing
history stays visible and `Clear History` keeps working while it is on.

History is stored under:

```text
${XDG_STATE_HOME:-~/.local/state}/toas/
  history.jsonl
  recordings/*.wav
```

`History items to keep` defaults to 500 and limits records. `Recordings to keep` defaults
to 20 and limits retained WAV files. Records can outlive their audio reference. The
top-bar `Clear History` action asks for confirmation and is disabled while recording.

<details>
<summary>Technical details</summary>

### Processing architecture

Voice processing runs through a small runtime-agnostic kernel with pluggable
providers. A voice input resolves to an ephemeral plan of one or two physical
steps: primary audio-to-text processing, optionally followed by a separate
text refine step. Each provider owns its own protocol mapping; the GNOME host
owns HTTP execution, persistence, and output. History stores the final text
plus a per-call Trace of the steps that actually ran — never raw HTTP bodies
or credentials. See `docs/adr/0001-processing-kernel.md`.

### Qwen primary request (DashScope)

The WAV recording is embedded as a Base64 Data URL in a DashScope
multimodal-generation request. Authentication uses the standard
`Authorization: Bearer <key>` header.

```json
{
  "model": "qwen3-asr-flash",
  "input": {
    "messages": [
      {"role": "system", "content": [{"text": "技术讨论。常见术语：…"}]},
      {"role": "user", "content": [{"audio": "data:audio/wav;base64,..."}]}
    ]
  },
  "parameters": {"asr_options": {"enable_itn": true}}
}
```

The system message is present only when Custom Terms are configured.

### Refine behavior

Refine makes one non-streaming request after primary processing, on the
provider you choose (MiMo, OpenAI, or any OpenAI-compatible endpoint). Its
instructions are configurable text. Providers that support recognition
context also receive your Custom Terms.

### Output behavior

When direct text input is unavailable, the final output is copied to the GNOME clipboard
and pasted through a compositor-side Clutter virtual keyboard. Standalone terminals use
`Ctrl+Shift+V`; other applications, including IDE-embedded terminals, use `Shift+Insert`.
The extension never synthesizes Enter. Embedded line breaks remain part of clipboard-pasted
text.

When `Restore text clipboard` is enabled, the previous text clipboard value is restored
after pasting. Rich or image clipboard content cannot be restored through `St.Clipboard`.
When `Paste automatically` is disabled, the result stays on the clipboard as the deliverable.

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
