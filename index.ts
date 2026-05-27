import { GoogleGenAI, Modality, type LiveServerMessage } from "@google/genai";
import mic from "mic";
import Speaker from "speaker";

import { env } from "./env/server.ts";

const model = "gemini-3.1-flash-live-preview";
const config = {
  responseModalities: [Modality.AUDIO],
  systemInstruction: "You are a helpful and friendly AI assistant.",
  outputAudioTranscription: {},
  inputAudioTranscription: {},
};

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
const speaker = new Speaker({
  channels: 1,
  bitDepth: 16,
  sampleRate: 24000,
});
const micInstance = mic({
  rate: "16000",
  bitwidth: "16",
  channels: "1",
  encoding: "signed-integer",
  endian: "little",
});
const micStream = micInstance.getAudioStream();

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
  session.sendRealtimeInput({
    audio: {
      data: chunk.toString("base64"),
      mimeType: "audio/pcm;rate=16000",
    },
  });
});

micStream.on("error", (error: Error) => {
  console.error("Mic error:", error);
});
