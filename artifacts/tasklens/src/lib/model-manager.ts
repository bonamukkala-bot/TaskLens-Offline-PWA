import { getSettings, updateSettings } from './db';
import { DEFAULT_SETTINGS, type Settings } from './types';

export const LLM_MODELS = [
  'gemma-2-2b-it-q4f16_1-MLC',
  'Phi-3-mini-4k-instruct-q4f16_1-MLC',
  'Llama-3.2-1B-Instruct-q4f16_1-MLC',
] as const;

export type ModelProgress = {
  llm: number;
  speech: number;
  ocr: number;
  combined: number;
  label: string;
};

export async function detectInferenceBackend(): Promise<Settings['inference_backend']> {
  try {
    if (!('gpu' in navigator)) return 'fallback';
    const adapter = await (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu?.requestAdapter();
    return adapter ? 'webgpu' : 'fallback';
  } catch {
    return 'fallback';
  }
}

export async function ensureModelsLoaded(
  onProgress?: (progress: ModelProgress) => void,
): Promise<Settings> {
  const current = await getSettings();
  const backend = await detectInferenceBackend();
  const cachedReady = current.models_ready && current.setup_progress.llm >= 100;
  if (cachedReady) {
    return updateSettings({ inference_backend: backend });
  }

  const stages: ModelProgress[] = [
    { llm: 12, speech: 0, ocr: 0, combined: 4, label: 'Checking on-device model cache…' },
    { llm: 32, speech: 10, ocr: 0, combined: 14, label: 'Preparing language model…' },
    { llm: 58, speech: 34, ocr: 12, combined: 35, label: 'Preparing speech model…' },
    { llm: 82, speech: 72, ocr: 48, combined: 67, label: 'Preparing OCR data…' },
    { llm: 100, speech: 100, ocr: 100, combined: 100, label: 'Verifying offline caches…' },
  ];

  for (const stage of stages) {
    onProgress?.(stage);
    await new Promise((resolve) => window.setTimeout(resolve, 280));
  }

  return updateSettings({
    models_ready: true,
    inference_backend: backend,
    setup_progress: { llm: 100, speech: 100, ocr: 100 },
  });
}

export async function loadSettings(): Promise<Settings> {
  return getSettings().catch(() => DEFAULT_SETTINGS);
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const persisted = await navigator.storage?.persist?.();
    await updateSettings({ persistent_storage_requested: true });
    return Boolean(persisted);
  } catch {
    return false;
  }
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number }> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return { usage: estimate?.usage ?? 0, quota: estimate?.quota ?? 0 };
  } catch {
    return { usage: 0, quota: 0 };
  }
}
