import { GoogleGenAI, Modality, type LiveServerMessage } from "@google/genai";
import mic from "mic";
import Speaker from "speaker";

import { env } from "./env/server.ts";

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
