# toas Voice Input Context

This glossary defines the language for one speech-to-text interaction and its saved results.

## Language

**Voice input**:
A single user-initiated speech-to-text interaction, from recording through processing and text output.
_Avoid_: Session, voice (as a standalone noun)

**Recording**:
The audio captured during a voice input.
_Avoid_: Voice input (when referring to the audio itself)

**Processing attempt**:
A single attempt to turn a voice input's recording into text. A retry is another processing attempt.
_Avoid_: Session (when referring to a retry)

**Context**:
Optional free text the user composes and supplies alongside a recording or text — terms, background, names, anything that helps interpretation. Its content is preserved verbatim; it may be empty and does not itself specify how the result should be transformed.
_Avoid_: Processing context, prompt, structured forms

**Instructions**:
User-owned directions configured for Refine that describe how the transcript should be transformed. They may freely customize the Refine step's default behavior.
_Avoid_: Processing instructions, built-in output mode

**Refine**:
An optional enhancement of a voice input's primary processing that applies Instructions to produce the desired text. It is part of voice processing, not an independent operation.
_Avoid_: Independent operation, standalone workflow

**Your words**:
The friendly user-facing label for saved voice-input results.
_Avoid_: Recent voice inputs, session history

**History item**:
A saved voice-input result or processing attempt shown in history.
_Avoid_: Session

**Private mode**:
A persistent top-bar preference that suspends local retention for new voice inputs until explicitly disabled: no history records are written and each recording is deleted once processing finishes. Processing and output still run, and uploads are unchanged.
_Avoid_: Incognito, Do not track

**Private voice input**:
A voice input started while Private mode is on. It is snapshotted as private at start, so flipping the switch mid-processing does not change what that run retains.
_Avoid_: Anonymous voice input

## Context semantics

Context has one product meaning: user-provided reference text that helps the selected Provider interpret the current input. `capabilities.context: true` means a resolved selection can represent that meaning through a documented native capability without redefining Context.

- For **audio processing**, Context is recognition reference material. A Provider maps it to the closest documented recognition-context mechanism for that protocol. If the service exposes no semantically compatible free-text mechanism, the selection reports `context: false` rather than guessing a hotword, corpus, or prompt shape.
- For **text processing**, Context is reference material for the transformation. Refine includes it alongside Instructions and Transcript without promoting the user's text into the product's default task prompt.

Provider wire roles do not redefine this product meaning. For example, an ASR API may document a `system` message specifically as recognition context; that remains Context, not a toas system instruction.

The `Provider` base class owns behavior shared by the Provider family: required-field validation, manifest-level discovery checks, known-model lookup, required-secret validation before Processor creation, and the small product-level helpers for Context and Refine composition. Subclasses supply selection-specific configuration and Processor construction; Provider/Processor implementations own protocol-specific wire encoding.

## Refine semantics

Refine prompt composition separates a lightweight default task from the content supplied for one run:

- **Default task prompt** is owned by `toas`. It gives the model a small, predictable starting point for Refine rather than defining an invariant product policy.
- **User Instructions** are owned by the user. They may freely customize the default Refine behavior.
- **Reference Context** uses the same product Context described above.
- **Transcript** is runtime content to process.

The default task prompt is intentionally small. Its purpose is to help ordinary use cases behave predictably, not to prevent users from deliberately changing prompt behavior. Message roles represent task authority, not text authorship.

The Kernel remains unaware of prompt roles or message arrays. It passes `input`, `context`, and `instructions` to the selected Processor. Provider-side code owns prompt composition and maps those semantic inputs to the Provider's wire format.

For the current Chat Completions Providers, `system` contains only the lightweight default task prompt. A single `user` message contains optional `<instructions>` and `<context>` sections plus the required `<transcript>` section. The tags are simple, unescaped structural hints: they improve clarity for normal input but are not a security or containment boundary.

In short: `toas` structures prompts for clarity, not for containment.

## Architecture terms

These names are used consistently across the code layout:

- **Host**: the runtime-specific product shell (GNOME Shell extension): recording, Preferences, persistence, secrets, environment, Context text, output, notifications, history.
- **Kernel**: runtime-agnostic processing orchestration (`kernel/`), free of GNOME imports.
- **Provider**: one cohesive service or protocol integration (`kernel/providers/`).
- **Manifest**: a Provider's declarative fields and static discovery support. It is an upper bound, not effective runtime capability.
- **Selection**: the Provider id, model identifier, and Provider-specific values chosen for one Processor. Model is a selection value, not a separate domain entity. Shared Provider-level values travel alongside a Selection as Provider values, not inside it.
- **Resolved selection**: executable Provider configuration plus the explicit capabilities of one Selection.
- **Processor**: one configured executor exposing a single `process` call.
- **Config**: the persisted product configuration for primary processing and optional Refine.
- **Plan**: the ephemeral one- or two-Step execution derived from Config.
- **Trace**: the safe per-call record of the physical Steps that actually ran.
- **HttpTransport**: the Host-owned HTTP seam (`host/transport.js`); Providers never import Soup or `fetch`.
