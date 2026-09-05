const TERMINAL_HINTS = [
  'ptyxis',
  'ghostty',
  'gnome-terminal',
  'gnome-terminal-server',
  'kgx',
  'console',
  'konsole',
  'alacritty',
  'kitty',
  'wezterm',
  'foot',
  'tilix'
]

export function isTerminalWindow (window) {
  if (!window) { return false }

  const identifiers = [
    window.get_wm_class?.(),
    window.get_wm_class_instance?.(),
    window.get_gtk_application_id?.(),
    window.get_sandboxed_app_id?.()
  ]
    .filter(Boolean)
    .map(value => value.toLowerCase())

  return identifiers.some(identifier =>
    TERMINAL_HINTS.some(hint => identifier.includes(hint))
  )
}
