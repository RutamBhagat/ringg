1. Google SDK: local mic → Gemini Live → headphones

This is the clean one-process version.

Install:

npm i @google/genai mic speaker dotenv
npm i -D typescript tsx @types/node

Set key:

export GEMINI_API_KEY="your_key"

google-live-local.mts:

import 'dotenv/config';
import { GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai';
import mic from 'mic';
import Speaker from 'speaker';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('Set GEMINI_API_KEY');

const ai = new GoogleGenAI({ apiKey });

const model = 'gemini-3.1-flash-live-preview';

const speaker = new Speaker({
  channels: 1,
  bitDepth: 16,
  sampleRate: 24000,
});

const micInstance = mic({
  rate: '16000',
  bitwidth: '16',
  channels: '1',
  encoding: 'signed-integer',
  endian: 'little',
});

const micStream = micInstance.getAudioStream();

const session = await ai.live.connect({
  model,
  config: {
    responseModalities: [Modality.AUDIO],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    systemInstruction: 'You are a concise helpful voice assistant.',
  },
  callbacks: {
    onopen: () => {
      console.log('Connected. Speak into your mic.');
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
          speaker.write(Buffer.from(audio, 'base64'));
        }
      }
    },

    onerror: (e: ErrorEvent) => {
      console.error('Gemini Live error:', e.message);
    },

    onclose: (e: CloseEvent) => {
      console.log('Gemini Live closed:', e.reason);
    },
  },
});

micStream.on('data', (chunk: Buffer) => {
  session.sendRealtimeInput({
    audio: {
      data: chunk.toString('base64'),
      mimeType: 'audio/pcm;rate=16000',
    },
  });
});

micStream.on('error', (err: Error) => {
  console.error('Mic error:', err);
});

process.on('SIGINT', () => {
  micInstance.stop();
  speaker.end();
  session.close();
  process.exit(0);
});

Run:

npx tsx google-live-local.mts

This follows the same core pattern as Google’s official Node example: @google/genai, gemini-3.1-flash-live-preview, ai.live.connect, 16kHz mic input, and 24kHz speaker output.

Core logic: about 75 lines.