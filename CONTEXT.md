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
Optional information supplied alongside a recording or text to help interpret it. It may be empty and does not itself specify how the result should be transformed.
_Avoid_: Processing context, prompt

**Instructions**:
Directions configured for Refine that describe the text result the user wants. Their requested operation is not a built-in output mode.
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
A session-only top-bar switch that suspends local retention for new voice inputs: no history records are written and each recording is deleted once processing finishes. Processing and output still run, and uploads are unchanged.
_Avoid_: Incognito, Do not track

**Private voice input**:
A voice input started while Private mode is on. It is snapshotted as private at start, so flipping the switch mid-processing does not change what that run retains.
_Avoid_: Anonymous voice input
