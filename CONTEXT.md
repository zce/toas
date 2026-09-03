# toas Voice Input Context

This glossary defines the language for one speech-to-text interaction and its saved results.

## Language

**Voice input**:
A single user-initiated speech-to-text interaction, from recording through optional refinement and text output.
_Avoid_: Session, voice (as a standalone noun)

**Recording**:
The audio captured during a voice input.
_Avoid_: Voice input (when referring to the audio itself)

**Processing attempt**:
One transcription and refinement pass for a voice input, including a retry.
_Avoid_: Session (when referring to a retry)

**Your words**:
The friendly user-facing label for saved voice-input results.
_Avoid_: Recent voice inputs, session history

**History item**:
A saved voice-input result or processing attempt shown in history.
_Avoid_: Session

**Private mode**:
A session-only top-bar switch that suspends local retention for new voice inputs: no history records are written and each recording is deleted once processing finishes. Transcription, refine, and output still run, and uploads are unchanged.
_Avoid_: Incognito, Do not track

**Private voice input**:
A voice input started while Private mode is on. It is snapshotted as private at start, so flipping the switch mid-processing does not change what that run retains.
_Avoid_: Anonymous voice input
