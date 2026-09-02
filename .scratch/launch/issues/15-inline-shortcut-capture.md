# 15: Capture the shortcut inline in preferences

**What to build:** The shortcut row follows Clipboard Indicator's proven GTK pattern: a frameless suffix button enters capture mode, `Gtk.EventControllerKey` records the next accelerator, Escape cancels, and Backspace disables the binding. Users no longer type accelerator syntax manually.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] The row uses an inline suffix button and `Gtk.EventControllerKey`, modeled on Clipboard Indicator's implementation
- [ ] Clicking enters a visible capture state; Escape restores the old value and Backspace clears the binding
- [ ] Valid input is normalized with `Gtk.accelerator_name_with_keycode()` and saved as the existing `strv` schema value
- [ ] Invalid bare modifier presses and accelerators rejected by GTK are not saved and show concise feedback
- [ ] Event controllers, signal handlers, and debounce sources are removed after save, cancel, repeat editing, and window destruction
- [ ] The ticket does not claim to discover every shortcut owned by GNOME Shell or another extension
