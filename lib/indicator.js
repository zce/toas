import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const STATE_LABELS = {
    idle: 'Ready',
    recording: 'Listening',
    recognizing: 'Transcribing',
    refining: 'Refining prompt',
    inserting: 'Inserting',
};

export class VoicePromptIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor({onToggle, onCancel, onOpenPreferences}) {
        super(0.5, 'Voice Prompt');

        this._onToggle = onToggle;
        this._onCancel = onCancel;
        this._onOpenPreferences = onOpenPreferences;

        this._icon = new St.Icon({
            icon_name: 'audio-input-microphone-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._statusItem = new PopupMenu.PopupMenuItem('Ready', {
            reactive: false,
            can_focus: false,
        });
        this.menu.addMenuItem(this._statusItem);

        this._toggleItem = new PopupMenu.PopupMenuItem('Start voice input');
        this._toggleItem.connect('activate', () => this._onToggle?.());
        this.menu.addMenuItem(this._toggleItem);

        this._cancelItem = new PopupMenu.PopupMenuItem('Cancel');
        this._cancelItem.connect('activate', () => this._onCancel?.());
        this.menu.addMenuItem(this._cancelItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => {
            this.menu.close();
            this._onOpenPreferences?.();
        });
        this.menu.addMenuItem(settingsItem);

        this.render('idle');
    }

    render(state, message = '') {
        const recording = state === 'recording';
        const idle = state === 'idle' || state === 'error';

        this._icon.icon_name = state === 'error'
            ? 'dialog-error-symbolic'
            : recording
                ? 'media-record-symbolic'
                : 'audio-input-microphone-symbolic';

        if (recording)
            this.add_style_class_name('screen-recording-indicator');
        else
            this.remove_style_class_name('screen-recording-indicator');

        this._statusItem.label.text = state === 'error'
            ? truncate(message || 'Voice input failed')
            : STATE_LABELS[state] ?? state;

        this._toggleItem.label.text = recording
            ? 'Stop and process'
            : 'Start voice input';
        this._toggleItem.setSensitive(idle || recording);
        this._cancelItem.visible = !idle && state !== 'inserting';
    }

    destroy() {
        this._onToggle = null;
        this._onCancel = null;
        this._onOpenPreferences = null;
        super.destroy();
    }
}

function truncate(text) {
    const value = (text ?? '').trim();
    if (value.length <= 52)
        return value;

    return `${value.slice(0, 51)}…`;
}
