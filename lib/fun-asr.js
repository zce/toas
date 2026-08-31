import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(
    Soup.Session.prototype,
    'websocket_connect_async',
    'websocket_connect_finish'
);

const DEFAULT_ENDPOINT = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
const DEFAULT_MODEL = 'fun-asr-realtime';

export class FunAsrRealtime {
    constructor(settings, onPartial) {
        this._settings = settings;
        this._onPartial = onPartial;
        this._sentences = new Map();
        this._pendingAudio = [];
    }

    async start() {
        if (!this._startPromise)
            this._startPromise = this._startInternal();

        return this._startPromise;
    }

    write(data) {
        if (!data?.length)
            return;

        if (this._started && this._ws) {
            this._ws.send_binary(data);
            return;
        }

        this._pendingAudio.push(data.slice());
    }

    async finish() {
        await this.start();

        if (!this._ws)
            throw new Error('ASR WebSocket is not connected');

        if (!this._finishPromise) {
            this._finishPromise = new Promise((resolve, reject) => {
                this._resolveFinish = resolve;
                this._rejectFinish = reject;
            });
        }

        this._ws.send_text(JSON.stringify({
            header: {
                action: 'finish-task',
                task_id: this._taskId,
                streaming: 'duplex',
            },
            payload: {input: {}},
        }));

        await withTimeout(
            this._finishPromise,
            12000,
            'Timed out waiting for Fun-ASR final result'
        );

        return combineSentences(this._sentences);
    }

    cancel() {
        this._rejectStart?.(new Error('ASR cancelled'));
        this._rejectFinish?.(new Error('ASR cancelled'));

        try {
            this._ws?.close(1000, null);
        } catch {
            // Best effort during extension disable/session cancellation.
        }

        this._resetConnection();
    }

    async _startInternal() {
        const endpoint =
            this._settings.get_string('asr-endpoint').trim() ||
            GLib.getenv('DASHSCOPE_WEBSOCKET_URL') ||
            DEFAULT_ENDPOINT;

        const apiKey =
            this._settings.get_string('asr-api-key').trim() ||
            GLib.getenv('DASHSCOPE_API_KEY');

        const model =
            this._settings.get_string('asr-model').trim() ||
            DEFAULT_MODEL;

        if (!apiKey) {
            throw new Error(
                'Fun-ASR API key is missing. Configure it in Preferences or DASHSCOPE_API_KEY.'
            );
        }

        this._taskId = GLib.uuid_string_random();

        const message = Soup.Message.new('GET', endpoint);
        message.get_request_headers().append('Authorization', `Bearer ${apiKey}`);
        message.get_request_headers().append('User-Agent', 'voice-prompt-gnome/1');

        this._session = new Soup.Session();
        this._ws = await this._session.websocket_connect_async(
            message,
            null,
            null,
            GLib.PRIORITY_DEFAULT,
            null
        );

        this._ws.set_keepalive_interval(20);
        this._ws.connect('message', (_connection, type, bytes) =>
            this._onMessage(type, bytes)
        );
        this._ws.connect('error', (_connection, error) => {
            this._rejectStart?.(error);
            this._rejectFinish?.(error);
        });
        this._ws.connect('closed', () => {
            if (!this._finished) {
                const error = new Error('Fun-ASR WebSocket closed unexpectedly');
                this._rejectStart?.(error);
                this._rejectFinish?.(error);
            }
        });

        const startedPromise = new Promise((resolve, reject) => {
            this._resolveStart = resolve;
            this._rejectStart = reject;
        });

        this._ws.send_text(JSON.stringify({
            header: {
                action: 'run-task',
                task_id: this._taskId,
                streaming: 'duplex',
            },
            payload: {
                task_group: 'audio',
                task: 'asr',
                function: 'recognition',
                model,
                parameters: {
                    format: 'pcm',
                    sample_rate: 16000,
                },
                input: {},
            },
        }));

        await withTimeout(startedPromise, 8000, 'Timed out starting Fun-ASR');
    }

    _onMessage(type, bytes) {
        if (type !== Soup.WebsocketDataType.TEXT)
            return;

        let event;
        try {
            event = JSON.parse(new TextDecoder().decode(bytes.get_data()));
        } catch {
            return;
        }

        const eventName = event?.header?.event;

        if (eventName === 'task-started') {
            this._started = true;

            for (const chunk of this._pendingAudio)
                this._ws?.send_binary(chunk);

            this._pendingAudio = [];
            this._resolveStart?.();
            this._resolveStart = null;
            this._rejectStart = null;
            return;
        }

        if (eventName === 'result-generated') {
            const sentence = event?.payload?.output?.sentence;
            if (!sentence || sentence.heartbeat)
                return;

            if (sentence.sentence_id != null) {
                this._sentences.set(sentence.sentence_id, {
                    text: sentence.text ?? '',
                    final: Boolean(sentence.sentence_end),
                });
            }

            this._onPartial?.(combineSentences(this._sentences));
            return;
        }

        if (eventName === 'task-finished') {
            this._finished = true;
            this._resolveFinish?.();
            this._resolveFinish = null;
            this._rejectFinish = null;

            try {
                this._ws?.close(1000, null);
            } catch {
                // Server already considers the task complete.
            }
            return;
        }

        if (eventName === 'task-failed') {
            const error = new Error(
                event?.header?.error_message ||
                event?.header?.error_code ||
                'Fun-ASR task failed'
            );

            this._rejectStart?.(error);
            this._rejectFinish?.(error);
        }
    }

    _resetConnection() {
        this._started = false;
        this._finished = false;
        this._pendingAudio = [];
        this._sentences.clear();
        this._ws = null;
        this._session = null;
    }
}

function combineSentences(sentences) {
    const parts = [...sentences.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, value]) => value.text?.trim())
        .filter(Boolean);

    let result = '';
    for (const part of parts) {
        if (!result) {
            result = part;
            continue;
        }

        const previous = result[result.length - 1];
        const next = part[0];
        const previousAscii = /[\x20-\x7E]/.test(previous);
        const nextAscii = /[\x20-\x7E]/.test(next);

        result += previousAscii && nextAscii ? ` ${part}` : part;
    }

    return result.trim();
}

function withTimeout(promise, timeoutMs, message) {
    return new Promise((resolve, reject) => {
        let timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            timeoutMs,
            () => {
                timeoutId = 0;
                reject(new Error(message));
                return GLib.SOURCE_REMOVE;
            }
        );

        const clearTimeout = () => {
            if (!timeoutId)
                return;

            GLib.source_remove(timeoutId);
            timeoutId = 0;
        };

        promise.then(
            value => {
                clearTimeout();
                resolve(value);
            },
            error => {
                clearTimeout();
                reject(error);
            }
        );
    });
}
