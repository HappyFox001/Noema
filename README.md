<h1 style="border-bottom: none" align="center">
  Noema
  <br />
  <p>Putting a living soul into the desktop</p>
</h1>

<div align="center">
  <blockquote>
    <em><strong>Voice, memory, emotion, personality, and tools, connected into a desktop companion.</strong></em>
  </blockquote>
</div>

<p align="center">
  <img src="./assets/banner.png" alt="Noema banner" width="100%" />
</p>

<p align="center">
  <a href="https://noema-web.netlify.app/">
    <img src="https://img.shields.io/badge/Web-noema--web.netlify.app-111111?style=for-the-badge&labelColor=111111&color=7dd3fc" alt="Noema website" />
  </a>
  <a href="https://noema-web.netlify.app/docs">
    <img src="https://img.shields.io/badge/Docs-Read%20the%20docs-111111?style=for-the-badge&labelColor=111111&color=c4b5fd" alt="Noema documentation" />
  </a>
</p>

<p align="center">
  <a href="#features">Features</a>
  ·
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="#plugins">Plugins</a>
</p>

<p align="center">
  <img src="./assets/Halo.png" alt="Noema halo orb" width="250" />
  <img src="./assets/live2d.png" alt="Noema Live2D avatar" width="250" />
</p>

<p align="center">
  <img src="./assets/dark.png" alt="Noema dark control panel" width="390" />
  <img src="./assets/light.png" alt="Noema light control panel" width="390" />
</p>

---

Noema is a small experiment toward something like JARVIS: a desktop companion
that can speak with personality, remember context, understand tasks, and act
through tools.

The project is built around a three-layer runtime split:

- **Emotional layer**: speaks naturally, applies personality and memory, and detects task intent.
- **Work layer**: owns durable task state, plans steps, calls tools, tracks execution state, and records recoverable progress.
- **Interaction layer**: routes user interruptions, task starts, resumes, pauses, and status requests between the emotional and work layers.
- **Output layer**: speaks or displays selected runtime signals without inventing task facts.
- **Voice pipeline**: streams ASR, VAD, turn detection, TTS, interruption, and playback frames.
- **Plugin system**: adds tools, prompt extensions, task context, text transforms, expressions, and admin actions.

## Features

- **Voice-first desktop conversation** with streaming ASR, VAD, smart turn detection, and Fish Audio TTS.
- **Personality-aware replies** driven by role YAML files and conversation memory.
- **Task execution runtime** with planning, tool calls, execution state, compaction, and task admission.
- **Interruption-aware audio path** that can stop speech output without necessarily cancelling active tasks.
- **Persistent memory** backed by SQLite for conversation turns, summaries, user profile, and task runs.
- **Extensible plugin system** for adding new runtime capabilities without changing the core.

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm 8+
- macOS, Windows, or Linux with microphone access

```bash
# Install workspace dependencies.
pnpm install

# Build the SDK and desktop app.
pnpm build

# Launch the desktop app.
pnpm start
```

### API Configuration

Noema has four independent model slots:

| Slot | Purpose | Default provider/model |
| --- | --- | --- |
| Dialogue | Low-latency conversation | OpenAI-compatible chat endpoint |
| Task | Tool use, planning, and long-running work | OpenAI-compatible chat endpoint |
| TTS | Voice output | Fish Audio `s2-pro` |
| ASR | Voice input | Qwen `qwen3-asr-flash-realtime` |

Configure these in **Settings > System** after launching the app, or seed the
same values with a `.env` file in the repository root or `apps/desktop/.env`.
When using the default Fish Audio + Qwen voice setup through a proxy, a
Japan-based network node is recommended for lower latency.

```bash
# Dialogue model, OpenAI-compatible
LLM_1_API_KEY=your_dialogue_api_key
LLM_1_MODEL=deepseek-chat
LLM_1_BASE_URL=https://api.deepseek.com

# Task model, OpenAI-compatible
TASK_1_API_KEY=your_task_api_key
TASK_1_MODEL=gemini-3.1-pro-preview
TASK_1_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai

# Text-to-speech
TTS_1_PROVIDER=fish
TTS_1_API_KEY=your_tts_api_key
TTS_1_MODEL=s2-pro
TTS_1_VOICE_ID=your_voice_id

# Speech-to-text
ASR_1_PROVIDER=qwen
ASR_1_API_KEY=your_asr_api_key
ASR_1_MODEL=qwen3-asr-flash-realtime
ASR_1_LANGUAGE=zh

# Optional
PROXY_URL=http://127.0.0.1:7890
```

The numbered suffix lets you save multiple profiles, for example
`LLM_2_API_KEY`, `TASK_2_MODEL`, or `TTS_2_VOICE_ID`. Select the active profile
with `LLM_ACTIVE`, `TASK_ACTIVE`, `TTS_ACTIVE`, and `ASR_ACTIVE`.

Voice provider references:

- Fish Audio TTS: [Fish Audio S2](https://fish.audio/s2/) and
  [Text to Speech API](https://docs.fish.audio/developer-guide/core-features/text-to-speech).
- Qwen realtime ASR: [Realtime speech recognition](https://docs.qwencloud.com/developer-guides/speech/asr-realtime)
  and [speech-to-text models](https://docs.qwencloud.com/developer-guides/speech/speech-to-text-models)
  for `qwen3-asr-flash-realtime`.

## Plugins

Noema loads runtime plugins from `plugins/*/plugin.json`. Plugins can register
tools, extend prompts, inject task context, transform text, select expression
assets, and expose admin actions.

| Plugin | Purpose |
| --- | --- |
| `base-tools` | File reads/writes, search, patching, shell commands, interactive command sessions |
| `browser-use` | Electron browser automation, DOM/AX snapshots, screenshots, file upload, page actions |
| `computer-use` | Native desktop observation and mouse/keyboard control |
| `skills-manager` | Local skill discovery, reading, and management |
| `mcp-manager` | MCP server management and remote tool dispatch |
| `sticker-expression` | Emotion-based sticker selection for replies |
| `fish-s2-emotion` | Fish Audio S2 voice cue prompt additions and TTS text filtering |

Plugin manifests declare permissions, config fields, default enablement, and
admin actions. Keep plugin hooks generic: tools execute actions, context
providers contribute task context, and UI/admin behavior remains separate from
runtime execution.

## Acknowledgements

The orb UI in Noema directly references the visual direction and interaction
ideas from these excellent Three.js projects. Thanks to their authors and
communities:

- [r3f-rapier-ball-of-glass](https://github.com/antonbobrov/r3f-rapier-ball-of-glass)
  by Anton Bobrov.
- [Singularity](https://github.com/MisterPrada/singularity) by MisterPrada for
  real-time Three.js scene and orb interaction inspiration.

Community thanks:

<a href="http://linux.do/">
  <img src="./assets/LinuxDo.png" alt="LinuxDo" width="72" />
</a>

## License

AGPL-3.0-only. See [LICENSE](./LICENSE).
