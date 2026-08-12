# BIINA.ai — Voice Mode

Hands-free, **turn-based voice conversation**: speak, BIINA transcribes, answers, and
speaks the answer back. Voice mode composes the existing modalities — **STT + chat +
TTS** — and **adds no new authority**. Speaking never bypasses a control that typing
is subject to; in particular, **voice never bypasses agent approval**. Voice mode is
gated by the platform flag `VOICE_MODE_ENABLED` (default **false**) and the plan
(`voiceModeEnabled`, `voiceMinutesPerMonth`). Code: `apps/web/src/server/media/`
(`stt.ts`, `tts.ts`, `context.ts`, `config.ts`). Companion:
[`SPEECH_TO_TEXT.md`](./SPEECH_TO_TEXT.md), [`TEXT_TO_SPEECH.md`](./TEXT_TO_SPEECH.md),
[`MULTIMODAL_SECURITY.md`](./MULTIMODAL_SECURITY.md), [`ACTION_APPROVALS.md`](./ACTION_APPROVALS.md).

## The turn loop

```
record (mic) → POST /api/media (audio) → chat turn with mediaIds
   → SpeechToTextProvider transcribes → transcript appended to the user's message
   → routing → AI Gateway → model → answer (text, persisted)
   → POST /api/tts (opt-in) → TextToSpeechProvider → AUDIO asset → play
```

Each turn is an ordinary chat turn. The transcript is the **user's own words** —
trusted user input, subject to the same routing, policy, and approval gates as typed
text (see [`SPEECH_TO_TEXT.md`](./SPEECH_TO_TEXT.md)). The spoken reply is a normal,
opt-in TTS synthesis (see [`TEXT_TO_SPEECH.md`](./TEXT_TO_SPEECH.md)).

## Realtime, barge-in & interruption (readiness)

The shipped model is **turn-based**: record a turn, get a turn back. **Realtime
streaming**, **barge-in** (talking over the assistant), and mid-utterance
**interruption** are **readiness** — the interfaces leave room for them, but the
delivered flow is discrete turns.

## Stop-speaking keeps the text

Playback is always an addition to the written answer. **Stopping the assistant's
speech never loses the response** — the text is generated and persisted regardless, so
the conversation remains fully readable. Because browsers restrict autoplay,
**audio playback is user-initiated** (the opt-in TTS call), which fits the
stop-any-time posture.

## Transcripts persist, not raw audio

A voice conversation persists as **text**: the user's transcript (appended to the
message) and the assistant's written answer. **Raw audio retention is a separate
policy** — conversations keep the transcript, not the recording. Synthesized reply
audio is a per-user asset the user can delete like any media
([`MULTIMODAL_SECURITY.md`](./MULTIMODAL_SECURITY.md)).

## Voice → AgentOrchestrator: approval is unchanged

This is the load-bearing invariant. When a spoken request would drive an **agent
action**, the transcript is fed to the **Phase 11 AgentOrchestrator exactly like typed
input** — and every write still goes:

```
voice → transcript → AgentOrchestrator → ActionPolicyService → PREVIEW → human APPROVAL → execute
```

**Voice does not bypass approval.** There is no "spoken yes" fast-path around the
normal approval UI. A high-impact action proposed in a voice session pauses for the
same explicit, single-use approval a typed session would require. See
[`ACTION_APPROVALS.md`](./ACTION_APPROVALS.md), [`AGENT_SECURITY.md`](./AGENT_SECURITY.md).

## Voice → WorkflowCompiler: draft, not auto-activated

A spoken "set up a workflow that …" can produce a **workflow draft**, but the draft is
**not auto-activated**. Activation remains a deliberate, authenticated management
action with manage rights — the same gate as any workflow
([`WORKFLOWS.md`](./WORKFLOWS.md), [`AUTOMATION_SECURITY.md`](./AUTOMATION_SECURITY.md)).
Speaking cannot arm an automation.

## Voice-authorization caution — no loose "yes"

Voice is inherently lower-fidelity for consent: a stray "yeah, sure" is not an
authorization. BIINA therefore **does not accept a loose spoken affirmative for a
high-impact action.** Authorization for a write flows through the **normal approval
UI** — an explicit, reviewable confirmation of the exact previewed action — not through
conversational agreement. This keeps the human-in-the-loop meaningful when the channel
is speech.

## Entitlements & flags

- Platform: `VOICE_MODE_ENABLED` (default **false**) via `voiceModeEnabled()`.
- Plan: `voiceModeEnabled`, `voiceMinutesPerMonth`; the underlying STT/TTS
  entitlements (`speechToTextEnabled`, `textToSpeechEnabled`) also apply per turn.
- Metering: STT and TTS meter normally; `VOICE_SESSION` is a distinct
  `media_usage_event` operation reserved for session-level accounting. See
  [`MULTIMODAL_COSTS.md`](./MULTIMODAL_COSTS.md).
