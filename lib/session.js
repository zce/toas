import {AudioCapture} from './audio.js';
import {FunAsrRealtime} from './fun-asr.js';

export class VoicePromptSession {
    constructor(settings, onLevel) {
        this._asr = new FunAsrRealtime(settings);
        this._audio = new AudioCapture(
            chunk => this._asr.write(chunk),
            onLevel
        );
    }

    start() {
        if (!this._startPromise) {
            this._startPromise = Promise.all([
                this._asr.start(),
                this._audio.start(),
            ]);
        }

        return this._startPromise;
    }

    finish() {
        if (!this._finishPromise)
            this._finishPromise = this._finishInternal();

        return this._finishPromise;
    }

    async _finishInternal() {
        await this._audio.stop();
        return this._asr.finish();
    }

    cancel() {
        if (this._cancelled)
            return;

        this._cancelled = true;
        this._audio.destroy();
        this._asr.cancel();
    }
}
