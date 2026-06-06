import {
  ActivityHandling,
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
} from "@google/genai";
import mic from "mic";
import { VoiceActivityDetector } from "realtime-vad";
import Speaker from "speaker";

import { env } from "./env/server.ts";

const model = "gemini-3.1-flash-live-preview";
const sampleRate = 16000;
const vadFrameDurationMs = 30;
const vadPreSpeechFrameCount = 10;
const vadSpeechThreshold = 0.1;
const speakerTailMs = 250;
const config = {
  responseModalities: [Modality.AUDIO],
  systemInstruction: "You are anime cosplayer marin kitagawa",
  speechConfig: {
    voiceConfig: {
      prebuiltVoiceConfig: {
        voiceName: "Aoede",
      },
    },
  },
  outputAudioTranscription: {},
  inputAudioTranscription: {},
  realtimeInputConfig: {
    automaticActivityDetection: {
      disabled: true,
    },
    activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
  },
};

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
const vad = new VoiceActivityDetector({
  sampleRate,
  channels: 1,
  bitsPerSample: 16,
  frameDurationMs: vadFrameDurationMs,
  speechThreshold: vadSpeechThreshold,
  silenceDebounceMs: 600,
});
await vad.init();

let speaker = createSpeaker();
const micInstance = mic({
  rate: sampleRate.toString(),
  bitwidth: "16",
  channels: "1",
  encoding: "signed-integer",
  endian: "little",
  device: "default",
});
const micStream = micInstance.getAudioStream();
let userIsSpeaking = false;
let aiIsSpeaking = false;
let suppressMicUntil = 0;
let pendingMicAudio = Buffer.alloc(0);
let micProcessing = Promise.resolve();
const preSpeechFrames: Buffer[] = [];

const session = await ai.live.connect({
  model,
  config,
  callbacks: {
    onopen: () => {
      console.log("Connected. Speak into your mic.");
    },
    onmessage: (message: LiveServerMessage) => {
      const serverContent = message.serverContent;
      if (serverContent?.turnComplete) {
        aiIsSpeaking = false;
      }

      if (serverContent?.interrupted) {
        stopSpeakerPlayback();
        aiIsSpeaking = false;
      }

      if (serverContent?.inputTranscription?.text) {
        process.stdout.write(`\nYou: ${serverContent.inputTranscription.text}`);
      }

      if (serverContent?.outputTranscription?.text) {
        process.stdout.write(`\nAI: ${serverContent.outputTranscription.text}`);
      }

      const parts = serverContent?.modelTurn?.parts ?? [];
      for (const part of parts) {
        const audio = part.inlineData?.data;
        if (audio) {
          aiIsSpeaking = true;
          const audioBuffer = Buffer.from(audio, "base64");
          suppressMicForAudio(audioBuffer.length);
          speaker.write(audioBuffer);
        }
      }
    },
    onerror: (event: ErrorEvent) => {
      console.error("Gemini Live error:", event.message);
    },
    onclose: (event: CloseEvent) => {
      console.log("Gemini Live closed:", event.reason);
    },
  },
});

vad.on("speechStart", () => {
  if (userIsSpeaking) {
    return;
  }

  if (micInputIsSuppressed()) {
    clearMicAudio();
    return;
  }

  userIsSpeaking = true;
  session.sendRealtimeInput({ activityStart: {} });

  for (const frame of preSpeechFrames) {
    sendAudioFrame(frame);
  }
});

vad.on("speechEnd", () => {
  if (!userIsSpeaking) {
    return;
  }

  userIsSpeaking = false;
  session.sendRealtimeInput({ activityEnd: {} });
});

micStream.on("data", (chunk: Buffer) => {
  if (micInputIsSuppressed()) {
    clearMicAudio();
    return;
  }

  pendingMicAudio = Buffer.concat([pendingMicAudio, chunk]);
  micProcessing = micProcessing.then(processPendingMicAudio).catch((error) => {
    console.error("VAD error:", error);
  });
});

micStream.on("error", (error: Error) => {
  console.error("Mic error:", error);
});

micInstance.start();

function sendAudioFrame(frame: Buffer) {
  session.sendRealtimeInput({
    audio: {
      data: frame.toString("base64"),
      mimeType: "audio/pcm;rate=16000",
    },
  });
}

function suppressMicForAudio(byteLength: number) {
  const audioDurationMs = (byteLength / 2 / 24000) * 1000;
  suppressMicUntil =
    Math.max(suppressMicUntil - speakerTailMs, Date.now()) +
    audioDurationMs +
    speakerTailMs;
}

function micInputIsSuppressed() {
  return aiIsSpeaking || Date.now() < suppressMicUntil;
}

function clearMicAudio() {
  pendingMicAudio = Buffer.alloc(0);
  preSpeechFrames.length = 0;
}

async function processPendingMicAudio() {
  while (pendingMicAudio.length >= vad.chunkBytes) {
    if (micInputIsSuppressed()) {
      clearMicAudio();
      return;
    }

    const frame = pendingMicAudio.subarray(0, vad.chunkBytes);
    pendingMicAudio = pendingMicAudio.subarray(vad.chunkBytes);

    const wasSpeaking = userIsSpeaking;
    preSpeechFrames.push(frame);
    if (preSpeechFrames.length > vadPreSpeechFrameCount) {
      preSpeechFrames.shift();
    }

    await vad.processAudioChunk(frame);

    if (wasSpeaking) {
      sendAudioFrame(frame);
    }
  }
}

function createSpeaker() {
  const nextSpeaker = new Speaker({
    channels: 1,
    bitDepth: 16,
    sampleRate: 24000,
  });

  nextSpeaker.on("error", (error) => {
    if (speaker !== nextSpeaker && error.message === "write() failed: 0") {
      return;
    }

    console.error("Speaker error:", error.message);
    aiIsSpeaking = false;
    nextSpeaker.close(false);

    if (speaker === nextSpeaker) {
      speaker = createSpeaker();
    }
  });

  return nextSpeaker;
}

function stopSpeakerPlayback() {
  speaker.close(false);
  speaker = createSpeaker();
}

function shutdown() {
  micInstance.stop();
  speaker.end();
  session.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
