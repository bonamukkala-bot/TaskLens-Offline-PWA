export type Priority = 'low' | 'medium' | 'high';
export type SourceType = 'voice' | 'camera' | 'manual';

export type Task = {
  id: string;
  title: string;
  details?: string;
  due_date: string | null;
  priority: Priority;
  source_type: SourceType;
  source_session_id: string | null;
  completed: boolean;
  created_at: string;
  updated_at: string;
};

export type CaptureSession = {
  id: string;
  type: 'voice' | 'camera';
  raw_text: string;
  model_used: string;
  processing_time_ms: number;
  created_at: string;
};

export type Settings = {
  id: 'default';
  models_ready: boolean;
  model_versions: {
    llm: string;
    speech: string;
    ocr: string;
  };
  inference_backend: 'webgpu' | 'fallback';
  selected_llm: string;
  setup_progress: {
    llm: number;
    speech: number;
    ocr: number;
  };
  persistent_storage_requested: boolean;
  theme: 'dark' | 'light';
};

export type ExtractedTask = {
  title: string;
  due_date: string | null;
  priority: Priority;
};

export const DEFAULT_SETTINGS: Settings = {
  id: 'default',
  models_ready: false,
  model_versions: {
    llm: 'gemma-2-2b-it-q4f16_1-MLC',
    speech: 'Xenova/whisper-tiny.en',
    ocr: 'tesseract.js · eng',
  },
  inference_backend: 'fallback',
  selected_llm: 'gemma-2-2b-it-q4f16_1-MLC',
  setup_progress: { llm: 0, speech: 0, ocr: 0 },
  persistent_storage_requested: false,
  theme: 'dark',
};
