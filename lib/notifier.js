// Shell notification seam. Kept separate from the orchestrator so fake-driven
// tests can substitute it; production routes through GNOME's notification API.

import * as Main from 'resource:///org/gnome/shell/ui/main.js'

export class ShellNotifier {
  notify (title, body = '') {
    Main.notify(title, body)
  }

  cancel () {
    // GNOME notifications are transient and need no explicit cancellation.
  }
}
