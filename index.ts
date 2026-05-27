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
