// Shell-native confirmation dialog for destructive actions. The extension owns
// the instance lifecycle and destroys it in disable() to release the modal
// grab. destroyOnClose:false keeps the object reusable across opens.

import Clutter from 'gi://Clutter'
import St from 'gi://St'

import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js'
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js'

export class ConfirmDialog extends ModalDialog.ModalDialog {
  constructor ({ title, description, confirmLabel = 'Confirm', onConfirm }) {
    super({
      destroyOnClose: false,
      styleClass: 'toas-confirm-dialog'
    })

    this._onConfirm = onConfirm

    const content = new Dialog.MessageDialogContent({
      title,
      description
    })
    this.contentLayout.add_child(content)

    this.addButton({
      label: 'Cancel',
      action: () => this.close(global.get_current_time()),
      key: Clutter.KEY_Escape,
      isDefault: true
    })

    this.addButton({
      label: confirmLabel,
      action: () => {
        this.close(global.get_current_time())
        this._onConfirm?.()
      }
    })
  }
}