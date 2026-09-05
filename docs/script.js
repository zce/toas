const frame = document.querySelector('[data-demo-frame]')
const cover = frame?.querySelector('[data-demo-cover]')
const video = frame?.querySelector('[data-demo-video]')

if (cover && video) {
  cover.addEventListener('click', async () => {
    frame.classList.add('is-playing')
    try {
      await video.play()
    } catch {
      frame.classList.remove('is-playing')
    }
  })

  video.addEventListener('ended', () => {
    frame.classList.remove('is-playing')
    video.currentTime = 0
  })
}
