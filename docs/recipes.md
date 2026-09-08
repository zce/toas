# Recipes

Recipes are starting points for customizing how `toas` understands and refines your speech.

A recipe can use either or both of these fields in Preferences:

```text
Context      = what the model should know
Instructions = how the speech should be transformed
```

Use **Context** for reference knowledge such as names, domain terms, products, projects, or background. Use **Instructions** for transformation behavior such as cleanup, translation, tone, structure, or formatting.

Recipes are examples, not product modes. Copy what is useful, edit it freely, or combine parts into your own setup.

## How recipes work

### Context

Context is reference knowledge. Providers that support Context receive the text you configure; providers without Context support do not receive it.

Good Context answers questions such as:

- What names or terms may appear in my speech?
- What products, projects, or domains am I talking about?
- Which uncommon spellings should the model recognize?

Avoid putting transformation rules in Context. For example, `make this concise` or `always translate to English` belongs in Instructions instead.

### Instructions

Instructions control the optional Refine step: how the transcript should be transformed after transcription.

Good Instructions describe things such as:

- how much verbal cleanup you want
- whether to translate
- what tone to use
- how to preserve technical details
- whether to produce prose, notes, or another structure

The built-in system prompt stays deliberately small so your Instructions remain the main source of transformation behavior.

## Refine recipes

Use these as starting points for the **Instructions** field.

### Natural — default

Best for everyday voice input: remove verbal clutter while keeping your meaning, tone, technical terms, and level of detail.

```text
Turn my speech into natural written text.

Remove filler words, false starts, and unnecessary repetition when they occur within otherwise meaningful speech.

Preserve standalone interjections or acknowledgements. Keep my meaning, tone, technical terms, and level of detail unchanged.

Use paragraph breaks when I clearly move to a new thought or topic. Keep short, continuous speech in a single paragraph.
```

### Translate

Speak in one language and insert natural text in another. Replace `English` with the language you want.

```text
Translate the transcript into natural English.

Preserve the exact meaning, tone, technical terms, names, numbers, and formatting.

Translate by meaning rather than word for word. Do not add or omit information.
```

### Inline directives

Useful when you want one Refine setup to change behavior based on an explicit instruction you say at the very end. The ending directive controls the preceding speech and is omitted from the result.

For example, end with `英文`, `用英文表达`, or `in English` to render the message in natural English, or `简洁一点` / `make it concise` to shorten it.

```text
Refine the transcript naturally without changing what the speaker means. By default, preserve the original language.

Treat only a clear, short directive at the very end as a command for transforming the preceding speech, and omit that directive from the result.

For example:
- “英文”, “用英文表达”, or “in English” means express the preceding message in natural English.
- “简洁一点” or “make it concise” means make it concise.

Only trigger when the ending is clearly an instruction. Do not trigger merely because a language name, translation phrase, or directive is mentioned or quoted in the message.

When translating, translate by meaning rather than word for word. Preserve intent, reasoning, emphasis, level of certainty, technical terms, names, numbers, and exact values.

Without an ending directive, refine normally. Do not add information or commentary.
```

### Concise

Useful when you think out loud but want the final text to be shorter and more direct.

```text
Make the transcript concise and direct.

Remove repetition and unnecessary wording, but preserve every meaningful point.

Do not add new information.
```

### Professional

For Slack, email, issues, PR comments, and other workplace communication without making the result sound corporate or AI-written.

```text
Rewrite the transcript as clear, professional workplace communication.

Keep it natural and human, not formal or corporate.

Preserve the speaker's intent and technical details.
```

### Technical

For coding, debugging, prompts, issue descriptions, and technical discussion where exact names matter.

```text
Clean up the transcript while preserving technical language exactly.

Keep code, identifiers, commands, paths, URLs, model names, API names, versions, and numbers unchanged unless the speaker clearly corrects them.
```

### Notes

For turning spoken thinking into compact notes or action items.

```text
Turn the transcript into clear notes.

Use short paragraphs or bullets when helpful.

Preserve all decisions, facts, questions, and action items without inventing anything.
```

## Context recipes

Use these as starting points for the **Context** field. Keep only the terms and background that are actually useful to your own speech.

### Technical vocabulary

Useful when your speech frequently contains framework names, tools, commands, or other terms that ASR may otherwise mishear.

```text
The speaker frequently discusses software development.

Languages and frameworks:
- JavaScript
- TypeScript
- Node.js
- React
- Next.js
- ASP.NET Core
- PostgreSQL

Tools and platforms:
- GitHub
- OpenCode
- GNOME
- Wayland
- GJS
```

### Project or product context

Useful when you repeatedly discuss one project with its own vocabulary.

```text
Project: toas

toas is a push-to-talk voice-input tool for GNOME and Wayland.

Common project terms:
- Refine
- Context
- Provider
- Processor
- overlay
- GNOME Shell
- GJS
- PipeWire
```

### Names and terminology

Useful when uncommon names or exact spellings appear often in your speech.

```text
Names and terms that may appear frequently:
- OpenAI
- OpenCode
- GitHub
- GNOME Shell
- PipeWire
- Wayland
- GJS
- toas
```

Replace this list with the people, products, companies, project names, acronyms, and preferred spellings that matter to you.

## Complete recipes

These examples show how Context and Instructions can work together. Copy each block into the matching field in Preferences.

### Developer voice input

A general setup for technical discussions, coding work, issue descriptions, and everyday developer communication.

**Context**

```text
The speaker is a software developer.

Common technologies:
- JavaScript
- TypeScript
- Node.js
- React
- Next.js
- ASP.NET Core
- PostgreSQL

Common tools and platforms:
- GitHub
- OpenCode
- GNOME
- Wayland
- GJS
```

**Instructions**

```text
Turn my speech into natural written text.

Remove filler words, false starts, and accidental repetition while preserving the original meaning and level of detail.

Preserve technical terminology, identifiers, commands, paths, URLs, model names, API names, versions, numbers, and exact values.

Use paragraph breaks when I clearly move to a new thought. Do not add information or commentary.
```

### Bilingual technical work

Useful when you naturally mix languages and sometimes want the final message translated with an explicit ending directive.

**Context**

```text
The speaker often mixes Chinese and English while discussing software development.

Common English technical terms include:
- pull request
- commit
- branch
- Refine
- Context
- Provider
- API
- GitHub
- OpenCode
- GNOME
- GJS
```

**Instructions**

```text
Refine the transcript naturally while preserving the original language by default.

Keep technical terms, product names, identifiers, commands, paths, URLs, versions, numbers, and exact values unchanged.

Treat only a clear, short directive at the very end as a command for transforming the preceding speech. Omit that directive from the result.

For example, “英文”, “用英文表达”, or “in English” means express the preceding message in natural English.

Only trigger when the ending is clearly an instruction. Do not trigger merely because translation or a language name is discussed in the message.

When translating, translate by meaning rather than word for word. Preserve intent, reasoning, emphasis, and level of certainty. Do not add information or commentary.
```
