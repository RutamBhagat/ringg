import {
  ActivityHandling,
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
} from "@google/genai";
import mic from "mic";
import Speaker from "speaker";

import { env } from "./env/server.ts";

const model = "gemini-3.1-flash-live-preview";
const speechThreshold = 700;
const silenceChunksBeforeEnd = 8;
const config = {
  responseModalities: [Modality.AUDIO],
  systemInstruction: "You are a helpful and friendly AI assistant.",
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
let speaker = createSpeaker();
const micInstance = mic({
  rate: "16000",
  bitwidth: "16",
  channels: "1",
  encoding: "signed-integer",
  endian: "little",
  device: "default",
});
const micStream = micInstance.getAudioStream();
let userIsSpeaking = false;
let aiIsSpeaking = false;
let silenceChunks = 0;

const session = await ai.live.connect({
  model,
  config,
  callbacks: {
    onopen: () => {
      console.log("Connected. Speak into your mic.");
      micInstance.start();
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

micStream.on("data", (chunk: Buffer) => {
  const speechDetected = getPcmRms(chunk) > speechThreshold;

  if (!speechDetected && !userIsSpeaking) {
    return;
  }

  if (!userIsSpeaking) {
    if (aiIsSpeaking) {
      stopSpeakerPlayback();
      aiIsSpeaking = false;
    }

    userIsSpeaking = true;
    session.sendRealtimeInput({ activityStart: {} });
  }

  if (speechDetected) {
    silenceChunks = 0;
  } else {
    silenceChunks += 1;
  }

  session.sendRealtimeInput({
    audio: {
      data: chunk.toString("base64"),
      mimeType: "audio/pcm;rate=16000",
    },
  });

  if (silenceChunks >= silenceChunksBeforeEnd) {
    userIsSpeaking = false;
    silenceChunks = 0;
    session.sendRealtimeInput({ activityEnd: {} });
  }
});

micStream.on("error", (error: Error) => {
  console.error("Mic error:", error);
});

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

function getPcmRms(chunk: Buffer) {
  let sumOfSquares = 0;
  const sampleCount = Math.floor(chunk.length / 2);

  if (sampleCount === 0) {
    return 0;
  }

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = chunk.readInt16LE(index * 2);
    sumOfSquares += sample * sample;
  }

  return Math.sqrt(sumOfSquares / sampleCount);
}

function shutdown() {
  micInstance.stop();
  speaker.end();
  session.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
