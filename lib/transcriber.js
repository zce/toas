import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { ChatCompletionsClient, userOverride } from './chat.js'

Gio._promisify(
  Gio.File.prototype,
  'load_bytes_async',
  'load_bytes_finish'
)

const DEFAULT_TRANSCRIPTION_ENDPOINT = 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions'
const DEFAULT_MODEL = 'mimo-v2.5-asr'
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export class MimoChatTranscriber {
  constructor (settings) {
    this._settings = settings
    this._client = new ChatCompletionsClient('Transcription')
  }

  get model () {
    return userOverride(this._settings, 'transcription-model') ||
            GLib.getenv('TOAS_TRANSCRIPTION_MODEL') ||
            DEFAULT_MODEL
  }

  get endpoint () {
    return userOverride(this._settings, 'transcription-endpoint') ||
            GLib.getenv('TOAS_TRANSCRIPTION_ENDPOINT') ||
            DEFAULT_TRANSCRIPTION_ENDPOINT
  }

  get language () {
    return this._settings.get_string('transcription-language').trim() || 'auto'
  }

  async transcribe (recording, model = this.model) {
    const endpoint = this.endpoint
    const apiKey =
            this._settings.get_string('transcription-api-key').trim() ||
            GLib.getenv('TOAS_TRANSCRIPTION_API_KEY')

    if (!apiKey) {
      throw new Error(
        'Transcription API key is missing. Configure it in Preferences or TOAS_TRANSCRIPTION_API_KEY.'
      )
    }

    const file = Gio.File.new_for_path(recording.path)
    const fileInfo = file.query_info(
      Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
      Gio.FileQueryInfoFlags.NONE,
      null
    )
    if (fileInfo.get_size() > MAX_UPLOAD_BYTES) { throw new Error('Recording exceeds the 25 MB transcription limit') }

    const [contents] = await file.load_bytes_async(null)
    const audio = GLib.base64_encode(contents.get_data())

    const result = await this._client.complete(endpoint, apiKey, {
      model,
      messages: [{
        role: 'user',
        content: [{
          type: 'input_audio',
          input_audio: {
            data: `data:${recording.mimeType};base64,${audio}`
          }
        }]
      }],
      asr_options: { language: this.language },
      stream: false
    })

    return {
      text: result.content,
      model,
      endpoint,
      language: this.language,
      finishReason: result.finishReason,
      usage: result.usage,
      responseModel: result.model,
      responseId: result.id
    }
  }

  cancel () {
    this._client.cancel()
  }

  destroy () {
    this._client.destroy()
    this._settings = null
  }
}
