# Refine recipes

Refine controls **how the transcript is transformed**. Context supplies **reference knowledge** such as names, domain terms, products, projects, or background.

Use these recipes as starting points for the **Instructions** field in Preferences. Keep them focused: the built-in Refine system prompt already protects the transcript from placeholder output and other empty-result behavior.

## Natural — default

Best for everyday voice input: remove verbal clutter while keeping your meaning, tone, technical terms, and level of detail.

```text
Turn my speech into natural written text. Remove filler words, false starts, and unnecessary repetition when they occur within otherwise meaningful speech. Preserve standalone interjections or acknowledgements, and keep my meaning, tone, technical terms, and level of detail unchanged.
```

## Translate

Speak in one language and insert natural text in another. Replace `English` with the language you want.

```text
Translate the transcript into natural English. Preserve the exact meaning, tone, technical terms, names, numbers, and formatting. Do not add or omit information.
```

## Concise

Useful when you think out loud but want the final text to be shorter and more direct.

```text
Make the transcript concise and direct. Remove repetition and unnecessary wording, but preserve every meaningful point and do not add new information.
```

## Professional

For Slack, email, issues, PR comments, and other workplace communication without making the result sound corporate or AI-written.

```text
Rewrite the transcript as clear, professional workplace communication. Keep it natural and human, not formal or corporate. Preserve the speaker's intent and technical details.
```

## Technical

For coding, debugging, prompts, issue descriptions, and technical discussion where exact names matter.

```text
Clean up the transcript while preserving technical language exactly. Keep code, identifiers, commands, paths, URLs, model names, API names, versions, and numbers unchanged unless the speaker clearly corrects them.
```

## Notes

For turning spoken thinking into compact notes or action items.

```text
Turn the transcript into clear notes. Use short paragraphs or bullets when helpful. Preserve all decisions, facts, questions, and action items without inventing anything.
```

## Context vs. Instructions

A simple rule:

```text
Instructions = how you want the speech transformed
Context      = what the model should know
```

For example, a Technical recipe might use:

```text
Instructions:
Preserve technical terminology and identifiers exactly.

Context:
GNOME, Wayland, GJS, OpenCode, GitHub, Payabli
```

Recipes are examples, not product modes. You can edit them freely or write your own Instructions.