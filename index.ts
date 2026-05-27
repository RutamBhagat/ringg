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

await ai.live.connect({
  model,
  config,
  callbacks: {
    onopen: () => {
      console.log("Connected. Speak into your mic.");
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
