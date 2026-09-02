const navToggle = document.querySelector('.nav-toggle')
const siteNav = document.querySelector('#site-nav')
const navLabel = navToggle?.querySelector('.sr-only')

if (navToggle && siteNav) {
  navToggle.addEventListener('click', () => {
    const open = siteNav.classList.toggle('is-open')
    navToggle.setAttribute('aria-expanded', String(open))
    const label = open ? 'Close navigation' : 'Open navigation'
    navToggle.setAttribute('aria-label', label)
    if (navLabel) { navLabel.textContent = label }
  })

  siteNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      siteNav.classList.remove('is-open')
      navToggle.setAttribute('aria-expanded', 'false')
      navToggle.setAttribute('aria-label', 'Open navigation')
      if (navLabel) { navLabel.textContent = 'Open navigation' }
    })
  })
}

const demoFrame = document.querySelector('[data-demo-frame]')
const demoPlaceholder = demoFrame?.querySelector('[data-demo-placeholder]')
const demoStatus = document.querySelector('[data-demo-status]')

const loadDemo = () => {
  if (!demoFrame || !demoPlaceholder || demoFrame.dataset.loaded) { return }

  const video = document.createElement('video')
  video.controls = true
  video.preload = 'metadata'
  video.playsInline = true
  video.setAttribute('aria-label', 'toas desktop demo')

  const source = document.createElement('source')
  source.src = demoFrame.dataset.demoSrc
  source.type = 'video/mp4'
  video.appendChild(source)

  const fallback = document.createElement('a')
  fallback.href = demoFrame.dataset.demoSrc
  fallback.textContent = 'Open the demo video'
  video.appendChild(fallback)

  demoFrame.replaceChildren(video)
  demoFrame.dataset.loaded = 'true'
  if (demoStatus) { demoStatus.textContent = 'now showing' }

  video.focus()
  video.play()?.catch(() => {})
}

if (demoPlaceholder) {
  demoPlaceholder.addEventListener('click', loadDemo)
  demoPlaceholder.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') { return }
    event.preventDefault()
    loadDemo()
  })
}

document.querySelectorAll('[data-copy-target]').forEach(button => {
  button.addEventListener('click', async () => {
    const targetId = button.dataset.copyTarget
    const target = document.getElementById(targetId)
    const label = button.querySelector('[data-copy-label]')
    const defaultLabel = label?.textContent ?? 'Copy command'

    if (!target) { return }

    const commands = [...target.querySelectorAll('code')]
      .map(code => code.innerText.replace(/^\$ /gm, '').replace(/^\s+/gm, ''))
      .join('\n')

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(commands)
      } else {
        const fallback = document.createElement('textarea')
        fallback.value = commands
        fallback.setAttribute('readonly', '')
        fallback.style.position = 'fixed'
        fallback.style.opacity = '0'
        document.body.appendChild(fallback)
        fallback.select()
        let copied = false
        try {
          copied = document.execCommand('copy')
        } finally {
          fallback.remove()
        }
        if (!copied) { throw new Error('Copy command failed') }
      }
      if (label && button.dataset.copyTarget === targetId) { label.textContent = 'Copied to clipboard' }
      window.setTimeout(() => {
        if (label && button.dataset.copyTarget === targetId) { label.textContent = defaultLabel }
      }, 2200)
    } catch {
      if (label && button.dataset.copyTarget === targetId) { label.textContent = 'Unable to copy command' }
    }
  })
})
