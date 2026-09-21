export async function transcribe(audioBlob: Blob): Promise<string> {
  try {
    const { pipeline } = await import('@huggingface/transformers');
    const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', { dtype: 'q8' });
    const buffer = await audioBlob.arrayBuffer();
    const context = new AudioContext({ sampleRate: 16000 });
    const decoded = await context.decodeAudioData(buffer.slice(0));
    const channel = decoded.getChannelData(0);
    const result = await transcriber(channel, { chunk_length_s: 30, stride_length_s: 5 });
    await context.close();
    if (typeof result === 'string') return result;
    if (Array.isArray(result)) return result[0]?.text ?? '';
    return 'text' in result ? result.text : '';
  } catch {
    return '';
  }
}
