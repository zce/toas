const REFINE_SYSTEM_PROMPT = `Refine the transcript into clear written text.
Follow the user's instructions when provided and use context as helpful reference.
By default, return only the refined text.`

export function composeRefineRequest ({ transcript, context = '', instructions = '' }) {
  const sections = []

  if (instructions?.trim()) { sections.push(section('instructions', instructions)) }
  if (context?.trim()) { sections.push(section('context', context)) }
  sections.push(section('transcript', transcript))

  return {
    systemPrompt: REFINE_SYSTEM_PROMPT,
    userPrompt: sections.join('\n\n')
  }
}

function section (name, content) {
  return `<${name}>\n${content}\n</${name}>`
}
