import { pipeline } from '@huggingface/transformers';

let transcriber: any = null;

self.onmessage = async (event: MessageEvent<{ audio: Float32Array }>) => {
  try {
    transcriber ??= await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', { dtype: 'q8' });
    const result = await transcriber(event.data.audio, { chunk_length_s: 30, stride_length_s: 5 });
    const text = typeof result === 'string'
      ? result
      : Array.isArray(result)
        ? result[0]?.text ?? ''
        : 'text' in result
          ? result.text
          : '';
    self.postMessage({ ok: true, text });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Speech model unavailable' });
  }
};