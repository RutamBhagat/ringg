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
const config = {
  responseModalities: [Modality.AUDIO],
  systemInstruction: "You are Rental Kanojo Chizuru Mizuhara.",
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
          speaker.write(Buffer.from(audio, "base64"));
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

  if (aiIsSpeaking) {
    stopSpeakerPlayback();
    aiIsSpeaking = false;
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

async function processPendingMicAudio() {
  while (pendingMicAudio.length >= vad.chunkBytes) {
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
  return new Speaker({
    channels: 1,
    bitDepth: 16,
    sampleRate: 24000,
  });
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
