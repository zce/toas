import Gio from 'gi://Gio'
import GLib from 'gi://GLib'

import { ChatCompletionsClient } from './chat.js'
import { resolveTranscriptionConfig } from './effective-config.js'

Gio._promisify(
  Gio.File.prototype,
  'load_bytes_async',
  'load_bytes_finish'
)

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export class MimoChatTranscriber {
  constructor (settings) {
    this._settings = settings
    this._client = new ChatCompletionsClient('Transcription')
  }

  get model () {
    return resolveTranscriptionConfig(this._settings).model.value
  }

  get endpoint () {
    return resolveTranscriptionConfig(this._settings).endpoint.value
  }

  get language () {
    return resolveTranscriptionConfig(this._settings).language
  }

  async transcribe (recording, model = this.model) {
    const config = resolveTranscriptionConfig(this._settings)
    const endpoint = config.endpoint.value
    const apiKeyPresent = config.apiKey.present

    if (!apiKeyPresent) {
      throw new Error(
        'Transcription API key is missing. Configure it in Preferences or TOAS_TRANSCRIPTION_API_KEY.'
      )
    }

    // The resolved config deliberately carries presence, not the secret;
    // read the key value only here, at the point of use.
    const apiKey =
            this._settings.get_string('transcription-api-key').trim() ||
            GLib.getenv('TOAS_TRANSCRIPTION_API_KEY')

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
