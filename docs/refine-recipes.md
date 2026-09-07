# Refine recipes

Refine controls **how the transcript is transformed**. Context supplies **reference knowledge** such as names, domain terms, products, projects, or background.

Use these recipes as starting points for the **Instructions** field in Preferences. The built-in system prompt stays deliberately small and leaves transformation behavior to your Instructions.

## Natural — default

Best for everyday voice input: remove verbal clutter while keeping your meaning, tone, technical terms, and level of detail.

```text
Turn my speech into natural written text. Remove filler words, false starts, and unnecessary repetition when they occur within otherwise meaningful speech. Preserve standalone interjections or acknowledgements, and keep my meaning, tone, technical terms, and level of detail unchanged. Use paragraph breaks when I clearly move to a new thought or topic; keep short, continuous speech in a single paragraph.
```

## Translate

Speak in one language and insert natural text in another. Replace `English` with the language you want.

```text
Translate the transcript into natural English. Preserve the exact meaning, tone, technical terms, names, numbers, and formatting. Translate by meaning rather than word for word, and do not add or omit information.
```

## Inline directives

Useful when you want one Refine setup to change behavior based on an explicit instruction you say at the very end. The ending directive controls the preceding speech and is omitted from the result.

For example, end with `英文`, `用英文表达`, or `in English` to render the message in natural English, or `简洁一点` / `make it concise` to shorten it.

```text
Refine the transcript naturally without changing what the speaker means. By default, preserve the original language. Treat only a clear, short directive at the very end as a command for transforming the preceding speech, and omit that directive from the result. For example, “英文”, “用英文表达”, or “in English” means express the preceding message in natural English, while “简洁一点” or “make it concise” means make it concise. Only trigger when the ending is clearly an instruction; do not trigger merely because a language name, translation phrase, or directive is mentioned or quoted in the message. When translating, translate by meaning rather than word for word and preserve intent, reasoning, emphasis, level of certainty, technical terms, names, numbers, and exact values. Without an ending directive, refine normally. Do not add information or commentary.
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