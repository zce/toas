import {AudioCapture} from './audio.js';
import {FunAsrRealtime} from './fun-asr.js';
import {FocusedInputSink} from './input.js';
import {VoicePromptOverlay} from './overlay.js';
import {OpenAiCompatiblePromptBuilder} from './prompt-builder.js';

export class VoicePromptOrchestrator {
    constructor(settings) {
        this._settings = settings;
        this._overlay = new VoicePromptOverlay();
        this._input = new FocusedInputSink(settings);
        this._builder = new OpenAiCompatiblePromptBuilder(settings);
        this._state = 'idle';
    }

    toggle() {
        if (this._state === 'idle')
            this.begin();
        else if (this._state === 'recording')
            this.end();
    }

    begin() {
        if (this._state !== 'idle')
            return;

        this._state = 'recording';
        this._overlay.show('Listening…', 'Connecting to Fun-ASR…');

        this._asr = new FunAsrRealtime(
            this._settings,
            text => {
                if (this._state === 'recording' && text)
                    this._overlay.setTranscript(text);
            }
        );

        this._audio = new AudioCapture(
            chunk => this._asr?.write(chunk),
            level => this._overlay.updateLevel(level)
        );

        this._asr.start().catch(error => this._fail(error));
        this._audio.start().catch(error => this._fail(error));
    }

    async end() {
        if (this._state !== 'recording')
            return;

        this._state = 'recognizing';
        this._overlay.setState('Recognizing…', 'Finishing realtime ASR…');

        try {
            await this._audio?.stop();

            const transcript = (await this._asr?.finish())?.trim();
            if (!transcript)
                throw new Error('No speech was recognized');

            let output = transcript;

            if (this._builder.enabled) {
                this._state = 'refining';
                this._overlay.setState('Refining…', transcript);

                try {
                    output = await this._builder.build(transcript);
                } catch (error) {
                    console.warn(
                        `[Voice Prompt] Prompt Builder failed, using transcript: ${error.message}`
                    );
                    output = transcript;
                }
            }

            this._state = 'inserting';
            this._overlay.setState('Inserting…', output);
            await this._input.insert(output);

            this._overlay.done(output);
            this._cleanupSession();
            this._state = 'idle';
        } catch (error) {
            this._fail(error);
        }
    }

    _fail(error) {
        if (this._state === 'idle')
            return;

        console.error(`[Voice Prompt] ${error?.stack ?? error}`);

        try {
            this._audio?.destroy();
            this._asr?.cancel();
        } catch {
            // Best effort after the original error.
        }

        this._overlay.error(error?.message ?? String(error));
        this._cleanupSession();
        this._state = 'idle';
    }

    _cleanupSession() {
        this._audio?.destroy();
        this._asr?.cancel();
        this._audio = null;
        this._asr = null;
    }

    destroy() {
        this._cleanupSession();
        this._builder?.destroy();
        this._input?.destroy();
        this._overlay?.destroy();

        this._builder = null;
        this._input = null;
        this._overlay = null;
        this._settings = null;
        this._state = 'idle';
    }
}
