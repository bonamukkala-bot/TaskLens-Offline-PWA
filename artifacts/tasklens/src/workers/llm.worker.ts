import { CreateMLCEngine } from '@mlc-ai/web-llm';

let engine: Awaited<ReturnType<typeof CreateMLCEngine>> | null = null;

self.onmessage = async (event: MessageEvent<{ model: string; prompt: string }>) => {
  try {
    engine ??= await CreateMLCEngine(event.data.model);
    const result = await engine.chat.completions.create({
      messages: [{ role: 'user', content: event.data.prompt }],
      temperature: 0.1,
      max_tokens: 300,
    });
    self.postMessage({ ok: true, text: result.choices[0]?.message?.content ?? '[]' });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'LLM unavailable' });
  }
};
