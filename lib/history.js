import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class HistoryStore {
    constructor(settings) {
        this._settings = settings;
        this.directory = GLib.build_filenamev([
            GLib.get_user_state_dir(),
            'toas',
        ]);
        this.recordingsDirectory = GLib.build_filenamev([
            this.directory,
            'recordings',
        ]);
        this._historyPath = GLib.build_filenamev([
            this.directory,
            'history.jsonl',
        ]);

        GLib.mkdir_with_parents(this.recordingsDirectory, 0o700);
        this._settingsChangedId = this._settings.connect(
            'changed::history-limit',
            () => this._pruneSafely()
        );
        this._pruneSafely();
        this._removeOrphanedRecordings();
    }

    append(entry) {
        const line = new TextEncoder().encode(`${JSON.stringify(entry)}\n`);
        const file = Gio.File.new_for_path(this._historyPath);
        const stream = file.append_to(Gio.FileCreateFlags.PRIVATE, null);
        try {
            stream.write_all(line, null);
        } finally {
            stream.close(null);
        }

        this._pruneSafely();
    }

    clear() {
        const sessions = this._readEntries().length;

        if (GLib.file_test(this._historyPath, GLib.FileTest.EXISTS))
            GLib.file_set_contents(this._historyPath, '');

        this._forEachRecording(name =>
            this.discardRecording({
                path: GLib.build_filenamev([this.recordingsDirectory, name]),
            })
        );
        return sessions;
    }

    discardRecording(recording) {
        if (!recording?.path)
            return true;

        try {
            Gio.File.new_for_path(recording.path).delete(null);
            return true;
        } catch (error) {
            if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                return true;
            console.warn(`[toas] Could not remove recording: ${error.message}`);
            return false;
        }
    }

    _pruneSafely() {
        try {
            this._prune();
        } catch (error) {
            console.error(`[toas] Could not prune history: ${error.message}`);
        }
    }

    _prune() {
        const entries = this._readEntries();
        const limit = this._settings.get_uint('history-limit');
        const removed = entries.slice(0, Math.max(0, entries.length - limit));
        const retained = entries.slice(-limit);

        if (removed.length > 0) {
            const contents = retained.length
                ? `${retained.map(entry => JSON.stringify(entry)).join('\n')}\n`
                : '';
            GLib.file_set_contents(this._historyPath, contents);
        }

        for (const entry of removed) {
            if (!entry.audio)
                continue;
            this.discardRecording({
                path: GLib.build_filenamev([this.directory, entry.audio]),
            });
        }
    }

    _removeOrphanedRecordings() {
        const referenced = new Set(
            this._readEntries()
                .map(entry => entry.audio)
                .filter(Boolean)
                .map(path => GLib.build_filenamev([this.directory, path]))
        );

        this._forEachRecording(name => {
            const path = GLib.build_filenamev([this.recordingsDirectory, name]);
            if (!referenced.has(path))
                this.discardRecording({path});
        });
    }

    _forEachRecording(callback) {
        const directory = Gio.File.new_for_path(this.recordingsDirectory);
        const children = directory.enumerate_children(
            Gio.FILE_ATTRIBUTE_STANDARD_NAME,
            Gio.FileQueryInfoFlags.NONE,
            null
        );

        try {
            let info;
            while ((info = children.next_file(null)))
                callback(info.get_name());
        } finally {
            children.close(null);
        }
    }

    _readEntries() {
        if (!GLib.file_test(this._historyPath, GLib.FileTest.EXISTS))
            return [];

        const [, bytes] = GLib.file_get_contents(this._historyPath);
        return new TextDecoder()
            .decode(bytes)
            .split('\n')
            .filter(Boolean)
            .flatMap(line => {
                try {
                    return [JSON.parse(line)];
                } catch {
                    return [];
                }
            });
    }

    destroy() {
        if (this._settingsChangedId)
            this._settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = 0;
        this._settings = null;
    }
}
