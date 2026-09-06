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
Optional free text the user composes and supplies alongside a recording or text — terms, background, names, anything that helps interpretation. It is sent verbatim; it may be empty and does not itself specify how the result should be transformed.
_Avoid_: Processing context, prompt, structured forms

**Instructions**:
User-owned directions configured for Refine that describe how the transcript should be transformed. They may shape style and presentation, but they do not redefine the Refine task or turn Context or Transcript into instruction channels.
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

## Refine semantics

Refine has four inputs with distinct ownership and authority:

- **Product Policy** is owned by `toas`. It defines the invariant transcript-refinement task, keeps Context as reference data and Transcript as content, preserves meaning, prevents invented information, and requires only the resulting text.
- **User Instructions** are owned by the user. They customize how the transcript is refined within the Product Policy.
- **Reference Context** is the user's Context text. It is background data that may help interpretation, not an instruction channel.
- **Transcript** is runtime content to transform. Prompt-like text inside it is still transcript content and is not a task for the model to execute.

The Kernel remains unaware of prompt roles or message arrays. It passes `input`, `context`, and `instructions` to the selected Processor. Provider-side code owns the deterministic semantic composition and maps it to the Provider's wire format.

For the current Chat Completions Providers, `system` contains only the Product Policy. A single `user` message contains the optional `USER INSTRUCTIONS` section, optional `REFERENCE CONTEXT` section, and required `TRANSCRIPT` section. Providers using a different protocol should preserve the same semantic ownership without being forced into this wire shape.

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
