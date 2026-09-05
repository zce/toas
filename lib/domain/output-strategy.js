export function selectOutputMethod ({ text, autoPaste, directInputAvailable }) {
  if (
    autoPaste &&
    directInputAvailable &&
    !text.includes('\n') &&
    !text.includes('\r')
  ) {
    return 'direct'
  }

  return 'clipboard'
}
