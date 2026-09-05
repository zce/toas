// History browsing: a Shell modal listing recent sessions (bounded pages,
// load-more) with a detail view and clipboard copy. Shell-only module.

import Clutter from 'gi://Clutter'
import St from 'gi://St'

import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js'
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js'

import { formatRelativeTime, formatDuration, previewText, getProviders, extractText } from '../domain/history-format.js'

const PAGE_SIZE = 20

const STATUS_ICONS = {
  ok: 'emblem-ok-symbolic',
  error: 'dialog-error-symbolic'
}

export class HistoryBrowser {
  constructor ({ repository, clipboard, notifier, retryFn = null }) {
    this._repository = repository
    this._clipboard = clipboard
    this._notifier = notifier
    this._retryFn = retryFn
    this._dialog = null
    this._listBox = null
    this._rows = []
    this._lastPageEndId = null
    this._exhausted = false
    this._loadMoreButton = null
  }

  open () {
    if (!this._dialog) { this._buildDialog() }

    this._lastPageEndId = null
    this._exhausted = false
    this._clearRows()
    this._loadPage()

    this._dialog.open(global.get_current_time())
  }

  destroy () {
    this._detailDialog?.destroy()
    this._detailDialog = null
    this._dialog?.destroy()
    this._dialog = null
    this._listBox = null
    this._rows = []
  }

  _buildDialog () {
    this._dialog = new ModalDialog.ModalDialog({
      styleClass: 'toas-history-dialog'
    })

    const content = new Dialog.MessageDialogContent({
      title: 'Your words',
      description: 'Your words and recordings are stored on this device. Clear them from the menu.'
    })
    this._dialog.contentLayout.add_child(content)

    const scroller = new St.ScrollView({
      style_class: 'toas-history-scroll',
      x_expand: true,
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC
    })
    this._listBox = new St.BoxLayout({
      vertical: true,
      style_class: 'toas-history-list',
      y_align: Clutter.ActorAlign.START
    })
    scroller.add_child(this._listBox)
    this._dialog.contentLayout.add_child(scroller)

    this._dialog.addButton({
      label: 'Close',
      action: () => this._dialog.close(global.get_current_time()),
      key: Clutter.KEY_Escape,
      isDefault: true
    })
  }

  _clearRows () {
    for (const row of this._rows) { row.destroy() }
    this._rows = []
  }

  _loadPage () {
    const page = this._repository.list({
      limit: PAGE_SIZE,
      beforeId: this._lastPageEndId
    })

    if (page.length === 0) {
      if (!this._lastPageEndId) { this._addEmptyRow() }
      this._exhausted = true
      this._removeLoadMore()
      return
    }

    for (const entry of page) {
      this._listBox.add_child(this._buildRow(entry))
    }

    this._lastPageEndId = page[page.length - 1].id

    if (page.length < PAGE_SIZE) {
      this._exhausted = true
      this._removeLoadMore()
    } else {
      this._ensureLoadMore()
    }
  }

  _addEmptyRow () {
    const empty = new St.Label({
      text: 'Nothing here yet. Say something.',
      style_class: 'toas-history-empty',
      x_align: Clutter.ActorAlign.CENTER
    })
    this._listBox.add_child(empty)
    this._rows.push(empty)
  }

  _buildRow (entry) {
    const row = new St.Button({
      style_class: 'toas-history-row',
      reactive: true,
      can_focus: true,
      x_expand: true
    })

    const box = new St.BoxLayout({
      vertical: false,
      x_expand: true,
      style: 'spacing: 10px;'
    })

    const statusIcon = new St.Icon({
      icon_name: STATUS_ICONS[entry.status] ?? 'audio-input-microphone-symbolic',
      icon_size: 14,
      y_align: Clutter.ActorAlign.CENTER
    })

    const textColumn = new St.BoxLayout({ vertical: true, x_expand: true })

    const preview = new St.Label({
      text: previewText(entry),
      style_class: 'toas-history-preview'
    })
    preview.get_clutter_text().set_single_line_mode(true)

    const meta = new St.Label({
      text: `${formatRelativeTime(entry.createdAt)} · ${formatDuration(entry.durationMs)}` +
            (entry.attemptNumber ? ` · retry ${entry.attemptNumber}` : ''),
      style_class: 'toas-history-meta'
    })
    meta.get_clutter_text().set_single_line_mode(true)

    textColumn.add_child(preview)
    textColumn.add_child(meta)

    box.add_child(statusIcon)
    box.add_child(textColumn)
    row.set_child(box)
    row.connect('clicked', () => this._openDetail(entry))

    this._rows.push(row)
    return row
  }

  _ensureLoadMore () {
    if (this._loadMoreButton) { return }

    this._loadMoreButton = new St.Button({
      label: 'Load more',
      style_class: 'toas-history-load-more',
      can_focus: true,
      x_align: Clutter.ActorAlign.CENTER
    })
    this._loadMoreButton.connect('clicked', () => this._loadPage())
    this._listBox.add_child(this._loadMoreButton)
  }

  _removeLoadMore () {
    this._loadMoreButton?.destroy()
    this._loadMoreButton = null
  }

  _openDetail (entry) {
    // One detail dialog at a time; destroy the previous to avoid actor leaks.
    this._detailDialog?.destroy()

    const detail = new ModalDialog.ModalDialog({
      styleClass: 'toas-history-detail'
    })
    this._detailDialog = detail

    const text = extractText(entry) || '(no text recognized)'

    const content = new Dialog.MessageDialogContent({
      title: formatRelativeTime(entry.createdAt),
      description: text
    })
    detail.contentLayout.add_child(content)

    const meta = new St.Label({
      text: [
        entry.status.toUpperCase(),
        formatDuration(entry.durationMs),
        getProviders(entry) !== 'Unknown' ? getProviders(entry) : null,
        entry.warning ? 'refine failed' : null,
        entry.error ? `error: ${entry.error.message}` : null
      ].filter(Boolean).join(' · '),
      style_class: 'toas-history-meta'
    })
    detail.contentLayout.add_child(meta)

    const attempts = this._repository.attemptsOf?.(entry.id) ?? []
    if (attempts.length > 0) {
      const attemptRows = attempts.map(a =>
        `#${a.attemptNumber} ${a.status}` +
                (extractText(a) ? `: ${previewText(a)}` : '')
      ).join('\n')
      const attemptsLabel = new St.Label({
        text: `Retry attempts:\n${attemptRows}`,
        style_class: 'toas-history-meta'
      })
      detail.contentLayout.add_child(attemptsLabel)
    }

    const audio = this._repository.resolveAudio(entry)
    const failed = entry.status === 'error'

    if (failed && !audio.available) {
      const note = new St.Label({
        text: 'Retry is unavailable: the recording was removed.',
        style_class: 'toas-history-meta'
      })
      detail.contentLayout.add_child(note)
    }

    if (failed && audio.available && this._retryFn) {
      detail.addButton({
        label: 'Retry',
        action: () => {
          detail.close(global.get_current_time())
          this._runRetry(entry)
        }
      })
    }
    detail.addButton({
      label: 'Copy text',
      action: () => {
        const value = extractText(entry)
        if (value) {
          this._clipboard.copy(value)
          this._notifier.notify('Copied', 'Your words are on the clipboard.')
        }
      }
    })

    detail.addButton({
      label: 'Close',
      action: () => detail.close(global.get_current_time()),
      key: Clutter.KEY_Escape,
      isDefault: true
    })

    detail.open(global.get_current_time())
  }

  async _runRetry (entry) {
    if (!this._retryFn) { return }

    this._notifier.notify(
      'Trying again',
      'Running transcription again on the retained recording.'
    )
    const attempt = await this._retryFn(entry)

    if (attempt?.status === 'ok') {
      this._notifier.notify(
        'Retry succeeded',
        'The updated text is on the detail view — open Your words to copy it.'
      )
    } else if (attempt?.status === 'error') {
      this._notifier.notify(
        'Retry failed',
        attempt.error?.message ?? 'It failed again. The recording is kept for another try.'
      )
    }
  }
}

// Minimal clipboard seam over St.Clipboard; kept in Shell-land so the browser
// stays testable through injection.
export class StClipboardAdapter {
  constructor () {
    this._clipboard = St.Clipboard.get_default()
  }

  copy (text) {
    this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text)
  }
}
