import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {VoicePromptIndicator} from './lib/indicator.js';
import {VoicePromptOrchestrator} from './lib/orchestrator.js';

const PTT_MOD_MASK =
    Clutter.ModifierType.CONTROL_MASK |
    Clutter.ModifierType.SHIFT_MASK |
    Clutter.ModifierType.MOD1_MASK |
    Clutter.ModifierType.SUPER_MASK;

const PTT_POLL_INTERVAL_MS = 40;

export default class VoicePromptExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new VoicePromptIndicator({
            onToggle: () => this._orchestrator?.toggle(),
            onCancel: () => this._orchestrator?.cancel(),
            onOpenPreferences: () => this._openPreferences(),
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');

        this._orchestrator = new VoicePromptOrchestrator(
            this._settings,
            (state, message) => this._indicator?.render(state, message)
        );

        Main.wm.addKeybinding(
            'push-to-talk',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._onPushToTalk()
        );
    }

    disable() {
        if (this._pttPollId) {
            GLib.source_remove(this._pttPollId);
            this._pttPollId = 0;
        }

        Main.wm.removeKeybinding('push-to-talk');

        this._orchestrator?.destroy();
        this._orchestrator = null;

        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }

    _onPushToTalk() {
        if (this._pttPollId)
            return;

        const heldModifiers = global.get_pointer()[2] & PTT_MOD_MASK;

        // GNOME's keybinding callback only gives us the press. With no modifier
        // there is no cheap/reliable release signal, so degrade to toggle mode.
        if (heldModifiers === 0) {
            this._orchestrator?.toggle();
            return;
        }

        this._orchestrator?.begin();

        this._pttPollId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            PTT_POLL_INTERVAL_MS,
            () => {
                const modifiers = global.get_pointer()[2];

                if ((modifiers & heldModifiers) !== 0)
                    return GLib.SOURCE_CONTINUE;

                this._pttPollId = 0;
                this._orchestrator?.end();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _openPreferences() {
        // GNOME 50's Extension.openPreferences() does not consume this async
        // result, producing an unhandled rejection when the process fails.
        Gio.DBus.session.call(
            'org.gnome.Shell.Extensions',
            '/org/gnome/Shell/Extensions',
            'org.gnome.Shell.Extensions',
            'OpenExtensionPrefs',
            new GLib.Variant('(ssa{sv})', [this.uuid, '', {}]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (_connection, result) => {
                try {
                    Gio.DBus.session.call_finish(result);
                } catch (error) {
                    console.error(
                        `[Voice Prompt] Failed to open preferences: ${error.message}`
                    );
                }
            }
        );
    }
}
