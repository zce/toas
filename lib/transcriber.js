import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(
    Soup.Session.prototype,
    'send_and_read_async',
    'send_and_read_finish'
);
Gio._promisify(
    Gio.File.prototype,
    'load_bytes_async',
    'load_bytes_finish'
);

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-1';
const REQUEST_TIMEOUT_MS = 120000;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export class OpenAiCompatibleTranscriber {
    constructor(settings) {
        this._settings = settings;
        this._session = new Soup.Session();
    }

    get model() {
        return userString(this._settings, 'transcription-model') ||
            GLib.getenv('TOAS_TRANSCRIPTION_MODEL') ||
            DEFAULT_MODEL;
    }

    async transcribe(recording, model = this.model) {
        const endpoint =
            userString(this._settings, 'transcription-endpoint') ||
            GLib.getenv('TOAS_TRANSCRIPTION_ENDPOINT') ||
            DEFAULT_ENDPOINT;
        const apiKey =
            this._settings.get_string('transcription-api-key').trim() ||
            GLib.getenv('TOAS_TRANSCRIPTION_API_KEY') ||
            GLib.getenv('OPENAI_API_KEY');

        if (!apiKey) {
            throw new Error(
                'Transcription API key is missing. Configure it in Preferences or OPENAI_API_KEY.'
            );
        }

        const file = Gio.File.new_for_path(recording.path);
        const fileInfo = file.query_info(
            Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        if (fileInfo.get_size() > MAX_UPLOAD_BYTES)
            throw new Error('Recording exceeds the 25 MB transcription limit');

        const [contents] = await file.load_bytes_async(null);
        const multipart = Soup.Multipart.new('multipart/form-data');
        multipart.append_form_string('model', model);
        multipart.append_form_string('response_format', 'json');

        const language = this._settings.get_string('transcription-language').trim();
        if (language)
            multipart.append_form_string('language', language);

        multipart.append_form_file(
            'file',
            file.get_basename(),
            recording.mimeType,
            contents
        );

        const message = Soup.Message.new('POST', endpoint);
        message.get_request_headers().append('Authorization', `Bearer ${apiKey}`);
        const body = multipart.to_message(message.get_request_headers());
        const contentType = message.get_request_headers().get_one('Content-Type');
        message.set_request_body_from_bytes(contentType, body);

        const bytes = await this._send(message);
        const responseText = new TextDecoder().decode(bytes.get_data());
        const status = message.get_status();

        if (status < 200 || status >= 300) {
            throw new Error(
                `Transcription HTTP ${status}: ${responseText.slice(0, 240)}`
            );
        }

        let response;
        try {
            response = JSON.parse(responseText);
        } catch {
            throw new Error('Transcription returned invalid JSON');
        }

        const transcript = response?.text?.trim();
        if (!transcript)
            throw new Error('Transcription returned no text');

        return transcript;
    }

    async _send(message) {
        const cancellable = new Gio.Cancellable();
        this._activeCancellable = cancellable;
        let timedOut = false;
        let timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            REQUEST_TIMEOUT_MS,
            () => {
                timeoutId = 0;
                timedOut = true;
                cancellable.cancel();
                return GLib.SOURCE_REMOVE;
            }
        );

        try {
            return await this._session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                cancellable
            );
        } catch (error) {
            if (timedOut)
                throw new Error('Transcription request timed out');
            throw error;
        } finally {
            if (timeoutId)
                GLib.source_remove(timeoutId);
            if (this._activeCancellable === cancellable)
                this._activeCancellable = null;
        }
    }

    cancel() {
        this._activeCancellable?.cancel();
    }

    destroy() {
        this.cancel();
        this._session?.abort();
        this._session = null;
        this._settings = null;
    }
}

function userString(settings, key) {
    return settings.get_user_value(key)
        ? settings.get_string(key).trim()
        : '';
}
