import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BAR_COUNT = 9;
const OVERLAY_WIDTH = 280;

const STATE_LABELS = {
    recording: 'Listening',
    recognizing: 'Transcribing',
    refining: 'Refining prompt',
    inserting: 'Inserting',
};

export class VoicePromptOverlay {
    constructor() {
        this._levels = Array(BAR_COUNT).fill(0);

        this._actor = new St.BoxLayout({
            style_class: 'popup-menu-content voice-prompt-overlay',
            reactive: false,
            visible: false,
            width: OVERLAY_WIDTH,
        });

        this._icon = new St.Icon({
            style_class: 'voice-prompt-icon',
            icon_name: 'audio-input-microphone-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._bars = new St.BoxLayout({
            style_class: 'voice-prompt-bars',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._barActors = [];
        for (let i = 0; i < BAR_COUNT; i++) {
            const bar = new St.Widget({
                style_class: 'voice-prompt-bar',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._barActors.push(bar);
            this._bars.add_child(bar);
        }

        this._status = new St.Label({
            style_class: 'voice-prompt-status',
            text: '',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._status.get_clutter_text().set_ellipsize(Pango.EllipsizeMode.END);
        this._status.get_clutter_text().set_single_line_mode(true);

        this._actor.add_child(this._icon);
        this._actor.add_child(this._bars);
        this._actor.add_child(this._status);

        // GNOME Shell 50 only accepts `trackFullscreen` and `affectsStruts`.
        // A non-reactive actor stays out of the compositor input region.
        Main.layoutManager.addChrome(this._actor, {
            trackFullscreen: true,
        });

        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed',
            () => this._reposition()
        );

        this._reposition();
        this.render('idle');
    }

    render(state, message = '') {
        this._cancelHide();

        if (state === 'idle') {
            this._actor.hide();
            return;
        }

        const recording = state === 'recording';
        const error = state === 'error';

        this._icon.icon_name = error
            ? 'dialog-error-symbolic'
            : 'audio-input-microphone-symbolic';
        this._bars.visible = recording;
        this._status.text = error
            ? truncate(message || 'Voice input failed')
            : STATE_LABELS[state] ?? state;

        if (recording) {
            this._levels.fill(0);
            this.setLevel(0);
        }

        this._actor.show();
        this._reposition();

        if (error)
            this._scheduleHide(2400);
    }

    setLevel(level) {
        const safeLevel = Math.max(0, Math.min(1, level || 0));
        this._levels.unshift(safeLevel);
        this._levels.length = BAR_COUNT;

        this._barActors.forEach((bar, index) => {
            const shaped = Math.pow(this._levels[index] ?? 0, 0.45);
            const height = Math.round(3 + shaped * 21);
            bar.set_style(`height: ${height}px;`);
        });
    }

    _cancelHide() {
        if (!this._hideId)
            return;

        GLib.source_remove(this._hideId);
        this._hideId = 0;
    }

    _scheduleHide(ms) {
        this._hideId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            ms,
            () => {
                this._hideId = 0;
                this._actor?.hide();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this._actor)
            return;

        const x = Math.round(monitor.x + (monitor.width - OVERLAY_WIDTH) / 2);
        const y = Math.round(monitor.y + monitor.height - 105);
        this._actor.set_position(x, y);
    }

    destroy() {
        this._cancelHide();

        if (this._monitorsChangedId)
            Main.layoutManager.disconnect(this._monitorsChangedId);

        if (this._actor) {
            Main.layoutManager.removeChrome(this._actor);
            this._actor.destroy();
        }

        this._actor = null;
        this._icon = null;
        this._status = null;
        this._barActors = [];
    }
}

function truncate(text) {
    const value = (text ?? '').trim();
    if (value.length <= 42)
        return value;

    return `${value.slice(0, 41)}…`;
}
