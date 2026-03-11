# Voice Pipeline

Bidirectional voice processing for Mach6 agents — automatic transcription of incoming voice messages and text-to-speech generation for replies.

## Overview

The voice pipeline intercepts voice and PTT (push-to-talk) messages in the gateway:

- **Inbound:** Voice notes → automatic transcription → text injected into agent context
- **Outbound:** When the original message was voice, the agent's text reply is converted to a voice note and sent back

## Inbound: Voice → Text

When a user sends a voice message on WhatsApp or Discord:

1. The media file is downloaded by the channel adapter
2. `isVoiceMessage()` detects voice/audio attachments with downloaded files
3. `transcribeAudio()` runs faster-whisper via the `stt.py` CLI
4. The transcript is injected into the user's message: `🎤 Voice transcript: "..."`
5. The agent processes it as regular text

### Transcription Details

- **Engine:** faster-whisper (local, no cloud)
- **Timeout:** 120 seconds per transcription
- **Output:** text, detected language, audio duration, processing time
- **Silence detection:** Empty/silence audio returns `isEmpty: true`

## Outbound: Text → Voice

When replying to a voice message:

1. The envelope is marked as voice-originated (`_isVoice` flag)
2. After the agent produces its text response, `generateVoiceReply()` is called
3. TTS generates an OGG audio file
4. The voice file is sent as a voice note on the same channel
5. Temporary files are cleaned up after sending

### TTS Details

- **Engine:** MeloTTS + OpenVoice V2 (local, sovereign — no cloud APIs)
- **Short text (<250 chars):** Direct `speak.py` synthesis (~15-30s)
- **Long text (>250 chars):** Chunked `tts.py` pipeline (up to 5 min)
- **Output format:** OGG (Opus codec)

## Configuration

The voice pipeline requires local Python environments:

```bash
# STT (Speech-to-Text)
~/.hektor-env/bin/python3 voice/stt.py <audio_file>

# TTS (Text-to-Speech)
~/.ava-voice/venv/bin/python3 .ava-voice/speak.py "text" --output /tmp/reply.ogg
```

No `mach6.json` configuration needed — the pipeline auto-detects voice messages and activates.

## Limitations

- CPU-only inference (no GPU required, but slower)
- TTS generation takes 15-30 seconds per sentence (warm cache)
- Voice cloning requires a reference voiceprint (pre-configured per agent)
- Currently supports WhatsApp voice notes; Discord voice channels are not yet integrated

---

*Added in v1.7.0*
