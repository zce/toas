import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BAR_COUNT = 18;
const OVERLAY_WIDTH = 420;

export class VoicePromptOverlay {
    constructor() {
        this._levels = Array(BAR_COUNT).fill(0.08);

        this._actor = new St.BoxLayout({
            style_class: 'voice-prompt-overlay',
            vertical: true,
            reactive: false,
            visible: false,
            width: OVERLAY_WIDTH,
        });

        const top = new St.BoxLayout({
            style_class: 'voice-prompt-overlay-top',
            x_expand: true,
        });

        this._dot = new St.Widget({style_class: 'voice-prompt-status-dot'});
        this._status = new St.Label({
            style_class: 'voice-prompt-status',
            text: 'Ready',
            y_align: Clutter.ActorAlign.CENTER,
        });

        top.add_child(this._dot);
        top.add_child(this._status);

        this._bars = new St.BoxLayout({
            style_class: 'voice-prompt-bars',
            x_align: Clutter.ActorAlign.CENTER,
        });

        this._barActors = [];
        for (let i = 0; i < BAR_COUNT; i++) {
            const bar = new St.Widget({style_class: 'voice-prompt-bar'});
            this._barActors.push(bar);
            this._bars.add_child(bar);
        }

        this._text = new St.Label({
            style_class: 'voice-prompt-text',
            text: '',
            x_expand: true,
        });
        this._text.get_clutter_text().set_line_wrap(true);

        this._actor.add_child(top);
        this._actor.add_child(this._bars);
        this._actor.add_child(this._text);

        Main.layoutManager.addChrome(this._actor, {
            affectsInputRegion: false,
            trackFullscreen: true,
        });

        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed',
            () => this._reposition()
        );

        this._reposition();
        this.updateLevel(0);
    }

    show(status = 'Listening…', text = '') {
        this._status.text = status;
        this._text.text = truncate(text);
        this._actor.show();
        this._reposition();
    }

    setState(status, text = '') {
        this._status.text = status;
        this._text.text = truncate(text);
    }

    setTranscript(text) {
        this._text.text = truncate(text);
    }

    updateLevel(level) {
        const safeLevel = Math.max(0, Math.min(1, level || 0));
        this._levels.unshift(safeLevel);
        this._levels.length = BAR_COUNT;

        this._barActors.forEach((bar, index) => {
            const history = this._levels[index] ?? 0;
            const shaped = Math.pow(history, 0.72);
            const height = Math.round(8 + shaped * 44);
            bar.set_style(`height: ${height}px;`);
        });
    }

    done(text = '') {
        this.setState('Inserted', text);
        this._scheduleHide(900);
    }

    error(message) {
        this.setState('Error', message);
        this._scheduleHide(2600);
    }

    hide() {
        if (this._hideId) {
            GLib.source_remove(this._hideId);
            this._hideId = 0;
        }

        this._actor?.hide();
    }

    _scheduleHide(ms) {
        if (this._hideId)
            GLib.source_remove(this._hideId);

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
        const y = Math.round(monitor.y + monitor.height - 155);
        this._actor.set_position(x, y);
    }

    destroy() {
        if (this._hideId)
            GLib.source_remove(this._hideId);

        if (this._monitorsChangedId)
            Main.layoutManager.disconnect(this._monitorsChangedId);

        if (this._actor) {
            Main.layoutManager.removeChrome(this._actor);
            this._actor.destroy();
        }

        this._actor = null;
        this._barActors = [];
    }
}

function truncate(text) {
    const value = (text ?? '').trim();
    if (value.length <= 180)
        return value;

    return `…${value.slice(-179)}`;
}
