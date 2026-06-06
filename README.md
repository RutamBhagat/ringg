# ringg

Minimal Bun/TypeScript voice CLI that streams your default microphone to Gemini Live and plays Gemini's audio response through your default speakers/headphones.

## What It Does

`ringg` opens a Gemini Live audio session, detects when you speak locally, sends 16 kHz mono PCM microphone audio to Gemini, and plays returned 24 kHz PCM audio through the OS-selected output device. It also prints input and output transcriptions in the terminal when Gemini returns them.

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **AI SDK**: `@google/genai` Gemini Live API
- **Environment validation**: `@t3-oss/env-core` + `zod`
- **Audio input**: `mic` using the OS default microphone
- **Voice activity detection**: `realtime-vad`
- **Audio output**: `speaker` using the OS default output device

## Prerequisites

- Bun installed
- A Gemini API key
- A working microphone and speaker/headphones selected as your OS defaults
- Native audio dependencies for your platform:
  - Linux: ALSA tools for microphone input; `libasound2-dev` may be needed to build `speaker`
  - macOS/Windows: SoX may be needed by `mic`

## Getting Started

Install dependencies:

```bash
bun install
```

Create a local environment file:

```bash
cp .env.example .env
```

Set your API key:

```bash
GEMINI_API_KEY=your_api_key_here
```

Run the CLI:

```bash
bun run dev
```

You should see:

```bash
Connected. Speak into your mic.
```

Speak into your default microphone. Gemini's audio response should play through your default output device.

## Scripts

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the Gemini Live voice CLI |
| `bun run check` | Run TypeScript checking with `tsc --noEmit` |

## How It Works

1. `env/server.ts` validates `GEMINI_API_KEY` at startup.
2. `index.ts` connects to `gemini-3.1-flash-live-preview` with audio responses enabled.
3. The default microphone is captured as raw 16-bit little-endian PCM at 16 kHz mono.
4. Local VAD sends `activityStart` / `activityEnd` events and only streams speech frames.
5. Gemini audio chunks are decoded from base64 and written to `speaker` as 24 kHz mono PCM.
6. If Gemini reports an interrupted turn, queued speaker playback is reset for barge-in behavior.
7. `Ctrl+C` stops the mic, ends speaker output, closes the Live session, and exits.

## Key Files

| Path | Purpose |
| --- | --- |
| `index.ts` | CLI entrypoint and audio streaming loop |
| `env/server.ts` | Environment variable schema and validation |
| `.env.example` | Required environment variable template |
| `package.json` | Bun scripts and dependencies |

## Troubleshooting

### No microphone input

Confirm your OS default input device is correct, then test command-line recording:

```bash
arecord temp.wav
# or
rec temp.wav
```

### No audio output

Confirm your OS default output device is correct. On Linux, make sure ALSA is installed and configured.

### Native dependency install fails

Install your platform audio build dependencies, then rerun:

```bash
bun install
```

## Verification Status

- TypeScript check: `bun run check`
- Manual voice smoke test: requires a real `GEMINI_API_KEY`, microphone, and speaker/headphones
