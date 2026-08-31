import {FocusedInputSink} from './input.js';
import {VoicePromptOverlay} from './overlay.js';
import {OpenAiCompatiblePromptBuilder} from './prompt-builder.js';
import {VoicePromptSession} from './session.js';

export class VoicePromptOrchestrator {
    constructor(settings, onStateChanged = null) {
        this._settings = settings;
        this._overlay = new VoicePromptOverlay();
        this._input = new FocusedInputSink(settings);
        this._builder = new OpenAiCompatiblePromptBuilder(settings);
        this._onStateChanged = onStateChanged;
        this._state = 'idle';
        this._session = null;
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

        const session = new VoicePromptSession(
            this._settings,
            level => {
                if (this._session === session && this._state === 'recording')
                    this._overlay.setLevel(level);
            }
        );

        this._session = session;
        this._transition('recording');
        session.start().catch(error => this._fail(session, error));
    }

    async end() {
        if (this._state !== 'recording')
            return;

        const session = this._session;
        this._transition('recognizing');

        try {
            const transcript = (await session.finish())?.trim();
            if (this._session !== session)
                return;

            if (!transcript)
                throw new Error('No speech was recognized');

            let output = transcript;

            if (this._builder.enabled) {
                this._transition('refining');
                try {
                    output = await this._builder.build(transcript);
                } catch (error) {
                    if (this._session !== session)
                        return;

                    console.warn(
                        `[Voice Prompt] Prompt Builder failed, using transcript: ${error.message}`
                    );
                    output = transcript;
                }
            }

            if (this._session !== session)
                return;

            this._transition('inserting');
            await this._input.insert(output);

            if (this._session !== session)
                return;

            this._cleanupSession(session);
            this._transition('idle');
        } catch (error) {
            this._fail(session, error);
        }
    }

    cancel() {
        if (this._state === 'idle')
            return;

        this._builder.cancel();
        this._cleanupSession();
        this._transition('idle');
    }

    _fail(session, error) {
        if (this._session !== session)
            return;

        console.error(`[Voice Prompt] ${error?.stack ?? error}`);
        this._state = 'idle';
        this._cleanupSession(session);
        const message = error?.message ?? String(error);
        this._overlay.render('error', message);
        this._onStateChanged?.('error', message);
    }

    _transition(state) {
        this._state = state;
        this._overlay.render(state);
        this._onStateChanged?.(state);
    }

    _cleanupSession(session = this._session) {
        if (!session)
            return;

        try {
            session.cancel();
        } catch {
            // Best effort during extension disable or failure cleanup.
        }

        if (this._session === session)
            this._session = null;
    }

    destroy() {
        this._onStateChanged = null;
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
