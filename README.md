# toas - Talk Once, Act Smart

**Talk Once, Act Smart.**

`toas` is push-to-talk voice input for Fedora, GNOME, and Wayland:

```text
record -> transcribe -> refine -> focused application
```

The pipeline separates recording, transcription, Refine, and output.
Transcription currently targets MiMo's JSON multimodal Chat Completions
protocol, while the optional Refine stage uses Chat Completions for text.

## Target

- Fedora
- GNOME Shell 49 / 50
- Wayland
- `pw-record` from PipeWire
- A MiMo-compatible multimodal Chat Completions endpoint
- An optional OpenAI-compatible Chat Completions endpoint

There is no daemon, database, local model runtime, context capture, or dynamic
provider plugin framework.

## Install

```bash
sudo dnf install pipewire-utils glib2
./install.sh
```

If GNOME does not immediately discover the extension, log out and back in,
then run:

```bash
gnome-extensions enable toas@zce.me
```

Open settings with:

```bash
gnome-extensions prefs toas@zce.me
```

The default shortcut is `Ctrl+Shift+Space`. Hold it while speaking, then
release the modifiers to stop and process. GNOME Shell does not expose a
matching shortcut-release callback, so the extension polls the held modifier
mask every 40 ms. A shortcut without modifiers works as a start/stop toggle.

Left-click the top-bar microphone to start or stop. Right-click it to open the
action menu.

## Transcription

The extension embeds the WAV recording as a Base64 Data URL in a JSON
multimodal Chat Completions request:

```json
{
  "model": "mimo-v2.5-asr",
  "messages": [{
    "role": "user",
    "content": [{
      "type": "input_audio",
      "input_audio": {"data": "data:audio/wav;base64,..."}
    }]
  }],
  "asr_options": {"language": "auto"},
  "stream": false
}
```

Authentication uses the standard `Authorization: Bearer <key>` request header.
The transcript is read from `choices[0].message.content` in the JSON response.

Defaults:

```text
endpoint = https://token-plan-cn.xiaomimimo.com/v1/chat/completions
model    = mimo-v2.5-asr
```

Configure the endpoint, model, language, and API key in Preferences.

Settings can be left empty and supplied to the GNOME session environment:

```text
TOAS_TRANSCRIPTION_ENDPOINT=...
TOAS_TRANSCRIPTION_MODEL=...
TOAS_TRANSCRIPTION_API_KEY=...
```

The transcription key can be supplied through `TOAS_TRANSCRIPTION_API_KEY`.

## Refine

Refine turns the raw transcript into clean text without answering it or
inventing content. It makes one non-streaming OpenAI-compatible Chat
Completions request after transcription.

Defaults:

```text
endpoint = https://api.openai.com/v1/chat/completions
model    = empty (Refine is skipped until configured)
```

Environment variables:

```text
TOAS_REFINE_ENDPOINT=...
TOAS_REFINE_MODEL=...
TOAS_REFINE_API_KEY=...
```

`OPENAI_API_KEY` is the final Refine key fallback. If Refine is disabled,
incomplete, or fails, the raw transcript is inserted instead.

## Recording

The recording format is exposed as a constrained setting. WAV is currently the
only supported choice for the MiMo transcription request.

`pw-record` emits 16 kHz, mono, signed 16-bit PCM in 100 ms chunks. `toas` uses
those chunks for the live waveform and wraps the completed recording in a
standard WAV container before transcription.

Audio is never sent while recording. It is uploaded only after the user stops.
Recordings shorter than one second are discarded without transcription.
Recordings are capped at 24 MB (about 13 minutes at this format) so an
accidental open session cannot exhaust GNOME Shell memory during upload.

## History

Successful sessions and processing failures are stored under:

```text
${XDG_STATE_HOME:-~/.local/state}/toas/
  history.jsonl
  recordings/*.wav
```

Each JSONL entry contains the raw transcript, final output, status, model names,
stage timings, recording duration, and a relative recording path. Refine
fallbacks are recorded as warnings. Failed transcriptions retain their audio so
later history UI can support retry without recording again.

The retention limit is configurable in Preferences and defaults to 10
sessions. Text entries and their corresponding recordings are pruned together.
Recordings left unreferenced by a crash are removed the next time the extension
starts.
The top-bar menu intentionally does not list history yet.

## Input behavior

The final output is flattened to one line, copied to the GNOME clipboard, and
pasted through a compositor-side Clutter virtual keyboard. Known terminals use
`Ctrl+Shift+V`; other applications use `Ctrl+V`. The extension never
synthesizes Enter.

When `Restore text clipboard` is enabled, the previous text clipboard value is
restored after pasting. Rich or image clipboard content cannot be restored
through `St.Clipboard`.

## Secrets

Keys entered in Preferences are stored as plain text in dconf. To keep keys out
of dconf, provide environment variables before the GNOME session starts. For
`~/.config/environment.d/`, log out and back in after changing values.

Secret Service integration is not implemented yet.

## Debug

Watch extension logs:

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```

Check extension state:

```bash
gnome-extensions info toas@zce.me
```

On Wayland, GNOME Shell's ES-module cache can make disable/enable insufficient
after JavaScript changes. Log out and back in when updated code does not appear
to load.
