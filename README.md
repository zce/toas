# Voice Prompt — GNOME Shell prototype

A deliberately small Fedora/GNOME/Wayland-first implementation of:

```text
hold shortcut
  → PipeWire PCM capture
  → realtime Fun-ASR
  → plain transcript
  → optional OpenAI-compatible Prompt Builder
  → clipboard
  → virtual keyboard paste into the focused app
```

There is no daemon, database, history, local model runtime, context capture, or provider plugin framework.

## Target

- Fedora
- GNOME Shell 49 / 50
- Wayland
- `pw-record` from PipeWire
- Alibaba Cloud Fun-ASR Realtime
- Optional OpenAI-compatible prompt builder

## Install

```bash
sudo dnf install pipewire-utils glib2
./install.sh
```

If this is the first locally-installed extension and GNOME does not see it immediately, log out and back in once, then:

```bash
gnome-extensions enable voice-prompt@local
```

Open settings:

```bash
gnome-extensions prefs voice-prompt@local
```

Default Push-to-Talk shortcut:

```text
Ctrl + Shift + Space
```

The top-bar microphone menu provides Start/Stop, Cancel, and Settings actions.
The compact bottom overlay shows a live waveform
while recording, a spinner while processing, and text only when an error occurs.
It stays hidden while idle and hides immediately after insertion.

Left-click the top-bar icon to start recording, then left-click the recording
dot to stop and process. Right-click the icon to open its action menu.

GNOME Shell keybindings expose the shortcut press but not a matching release callback. This prototype follows the minimal extension-only approach: while recording it polls the modifier mask every 40 ms and stops when the held modifiers are released. Release the whole chord together.

## Fun-ASR

The default endpoint is the still-supported Beijing DashScope endpoint:

```text
wss://dashscope.aliyuncs.com/api-ws/v1/inference
```

Alibaba now recommends a workspace-specific Beijing endpoint:

```text
wss://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference
```

Set it in Preferences if available.

The default model is:

```text
fun-asr-realtime
```

Keys can be entered in Preferences for convenience, or kept out of dconf by setting the environment before the GNOME session starts:

```text
DASHSCOPE_API_KEY=...
DASHSCOPE_WEBSOCKET_URL=wss://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference
```

For `~/.config/environment.d/`, log out/in after changes so GNOME Shell inherits them.

## Prompt Builder

Prompt Builder is intentionally only an OpenAI-compatible Chat Completions adapter.

Configure:

```text
endpoint = https://.../v1/chat/completions
model    = ...
api key  = ...
```

Or use session environment variables:

```text
VOICE_PROMPT_BASE_URL=...
VOICE_PROMPT_MODEL=...
VOICE_PROMPT_API_KEY=...
```

`OPENAI_API_KEY` is a final API-key fallback.

If Prompt Builder is disabled, not configured, or fails, the raw ASR transcript is inserted instead.

Its job is semantic normalization, not requirement invention.

## Input behavior

The final output is:

1. flattened to a single line;
2. written to the GNOME clipboard;
3. pasted with a compositor-side Clutter virtual keyboard.

Known terminal apps (including Ptyxis and Ghostty) receive `Ctrl+Shift+V`; other applications receive `Ctrl+V`.

The extension never synthesizes Enter.

If `Restore text clipboard` is enabled, the previous **text** clipboard value is restored after paste. `St.Clipboard` is text-oriented; this prototype does not promise restoration of rich/image clipboard content.

## Audio path

`pw-record` emits raw 16-bit PCM:

```bash
pw-record --raw --rate=16000 --channels=1 --format=s16 -
```

The extension reads 3200-byte chunks (100 ms), computes a cheap RMS level for the overlay, and sends the same raw PCM chunks to Fun-ASR over WebSocket.

Audio is not written to disk.

## Debug

Watch GNOME Shell extension logs:

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell
```

Check state:

```bash
gnome-extensions info voice-prompt@local
```

After editing extension JavaScript, GNOME Shell's ES-module cache can make disable/enable insufficient for development reloads. On Wayland, log out/in when code changes appear not to take effect.

## Intentional v1 omissions

- KDE/X11/other desktops
- daemon / DBus service
- ASR provider marketplace
- local ASR
- VAD auto-stop
- transcription history
- app context capture
- selection/screenshot context
- per-app prompt profiles
- multiline insertion
- automatic submit
- Secret Service integration

The interfaces are already separated enough to extract providers or a daemon later if real usage demands it.
