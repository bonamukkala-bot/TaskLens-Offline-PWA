export type AudioCapture = {
  stream: MediaStream;
  recorder: MediaRecorder;
  analyser: AnalyserNode;
  audioContext: AudioContext;
  chunks: Blob[];
};

export async function startRecording(): Promise<AudioCapture> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not available in this browser.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.start();
  return { stream, recorder, analyser, audioContext, chunks };
}

export async function stopRecording(capture: AudioCapture): Promise<Blob> {
  await new Promise<void>((resolve) => {
    capture.recorder.addEventListener('stop', () => resolve(), { once: true });
    capture.recorder.stop();
  });
  capture.stream.getTracks().forEach((track) => track.stop());
  await capture.audioContext.close();
  return new Blob(capture.chunks, { type: capture.recorder.mimeType || 'audio/webm' });
}
