let workerPromise: Promise<Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>> | null = null;

export async function extractText(imageBlob: Blob): Promise<string> {
  try {
    if (!workerPromise) {
      const { createWorker } = await import('tesseract.js');
      workerPromise = createWorker('eng');
    }
    const worker = await workerPromise;
    const result = await worker.recognize(imageBlob);
    return result.data.text.trim();
  } catch {
    return '';
  }
}
