import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(
    Soup.Session.prototype,
    'send_and_read_async',
    'send_and_read_finish'
);

const DEFAULT_SYSTEM_PROMPT = `Transform spoken language into a concise prompt.

Preserve:
- technical terminology
- identifiers
- filenames
- commands
- code symbols
- explicit constraints

Remove:
- filler words
- repetitions
- false starts
- speech artifacts

Do not invent requirements.
Do not add implementation details that were not expressed.
Return only the resulting prompt.`;

export class OpenAiCompatiblePromptBuilder {
    constructor(settings) {
        this._settings = settings;
        this._session = new Soup.Session();
    }

    get enabled() {
        return this._settings.get_boolean('prompt-builder-enabled');
    }

    async build(transcript) {
        if (!this.enabled)
            return transcript;

        const endpoint =
            this._settings.get_string('prompt-builder-endpoint').trim() ||
            GLib.getenv('VOICE_PROMPT_BASE_URL');

        const model =
            this._settings.get_string('prompt-builder-model').trim() ||
            GLib.getenv('VOICE_PROMPT_MODEL');

        const apiKey =
            this._settings.get_string('prompt-builder-api-key').trim() ||
            GLib.getenv('VOICE_PROMPT_API_KEY') ||
            GLib.getenv('OPENAI_API_KEY');

        if (!endpoint || !model || !apiKey)
            return transcript;

        const systemPrompt =
            this._settings.get_string('prompt-builder-system-prompt').trim() ||
            DEFAULT_SYSTEM_PROMPT;

        const body = JSON.stringify({
            model,
            messages: [
                {role: 'system', content: systemPrompt},
                {role: 'user', content: transcript},
            ],
            temperature: 0.1,
            stream: false,
        });

        const message = Soup.Message.new('POST', endpoint);
        message.get_request_headers().append('Authorization', `Bearer ${apiKey}`);
        message.set_request_body_from_bytes(
            'application/json',
            new GLib.Bytes(new TextEncoder().encode(body))
        );

        const bytes = await this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null
        );

        const status = message.get_status();
        const responseText = new TextDecoder().decode(bytes.get_data());

        if (status < 200 || status >= 300) {
            throw new Error(
                `Prompt Builder HTTP ${status}: ${responseText.slice(0, 240)}`
            );
        }

        const response = JSON.parse(responseText);
        const result = response?.choices?.[0]?.message?.content?.trim();

        if (!result)
            throw new Error('Prompt Builder returned an empty response');

        return result;
    }

    destroy() {
        this._session?.abort();
        this._session = null;
    }
}
