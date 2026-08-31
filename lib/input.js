import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

const TERMINAL_HINTS = [
    'ptyxis',
    'ghostty',
    'gnome-terminal',
    'gnome-terminal-server',
    'kgx',
    'console',
    'alacritty',
    'kitty',
    'wezterm',
    'foot',
    'tilix',
];

export class FocusedInputSink {
    constructor(settings) {
        this._settings = settings;
        this._clipboard = St.Clipboard.get_default();
        this._keyboard = Clutter.get_default_backend()
            .get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }

    async insert(rawText) {
        const text = normalizeForInput(rawText);
        if (!text)
            return;

        const originalText = await this._getClipboardText();

        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
        await delay(70);

        this._pasteShortcut();

        if (
            this._settings.get_boolean('restore-clipboard') &&
            originalText !== null &&
            originalText !== text
        ) {
            await delay(450);
            this._clipboard.set_text(St.ClipboardType.CLIPBOARD, originalText);
        }
    }

    _pasteShortcut() {
        const terminal = isFocusedWindowTerminal();
        const keys = terminal
            ? [Clutter.KEY_Control_L, Clutter.KEY_Shift_L, Clutter.KEY_v]
            : [Clutter.KEY_Control_L, Clutter.KEY_v];

        const now = GLib.get_monotonic_time();

        for (let i = 0; i < keys.length - 1; i++) {
            this._keyboard.notify_keyval(
                now,
                keys[i],
                Clutter.KeyState.PRESSED
            );
        }

        const mainKey = keys[keys.length - 1];
        this._keyboard.notify_keyval(now, mainKey, Clutter.KeyState.PRESSED);
        this._keyboard.notify_keyval(now, mainKey, Clutter.KeyState.RELEASED);

        for (let i = keys.length - 2; i >= 0; i--) {
            this._keyboard.notify_keyval(
                now,
                keys[i],
                Clutter.KeyState.RELEASED
            );
        }
    }

    _getClipboardText() {
        return new Promise(resolve => {
            this._clipboard.get_text(
                St.ClipboardType.CLIPBOARD,
                (_clipboard, text) => resolve(text ?? null)
            );
        });
    }

    destroy() {
        this._keyboard = null;
        this._clipboard = null;
    }
}

function normalizeForInput(text) {
    return text
        .replace(/\s*\n+\s*/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

function isFocusedWindowTerminal() {
    const window = global.display.focus_window;
    if (!window)
        return false;

    const values = [
        window.get_wm_class?.(),
        window.get_wm_class_instance?.(),
        window.get_title?.(),
    ]
        .filter(Boolean)
        .map(value => value.toLowerCase());

    return values.some(value =>
        TERMINAL_HINTS.some(hint => value.includes(hint))
    );
}

function delay(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            ms,
            () => {
                resolve();
                return GLib.SOURCE_REMOVE;
            }
        );
    });
}
