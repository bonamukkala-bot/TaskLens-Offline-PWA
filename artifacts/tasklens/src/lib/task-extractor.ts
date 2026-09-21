import { type ExtractedTask, type Priority } from './types';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function resolveDueDate(text: string, now = new Date()): string | null {
  const value = text.toLowerCase();
  if (/\btoday\b/.test(value)) return isoDate(now);
  if (/\btomorrow\b/.test(value)) {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    return isoDate(date);
  }
  const inDays = value.match(/\bin\s+(\d+)\s+days?\b/);
  if (inDays) {
    const date = new Date(now);
    date.setDate(date.getDate() + Number(inDays[1]));
    return isoDate(date);
  }
  if (/\bnext week\b/.test(value)) {
    const date = new Date(now);
    date.setDate(date.getDate() + 7);
    return isoDate(date);
  }
  const weekday = value.match(new RegExp(`\\b(next\\s+)?(${WEEKDAYS.join('|')})\\b`));
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2]);
    const date = new Date(now);
    let delta = (target - date.getDay() + 7) % 7;
    if (delta === 0 || weekday[1]) delta += 7;
    date.setDate(date.getDate() + delta);
    return isoDate(date);
  }
  const numeric = value.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : now.getFullYear();
    const date = new Date(year, Number(numeric[2]) - 1, Number(numeric[1]));
    if (date.getMonth() === Number(numeric[2]) - 1) return isoDate(date);
  }
  const named = value.match(new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?\\b`));
  if (named) {
    const year = named[3] ? Number(named[3]) : now.getFullYear();
    const date = new Date(year, MONTHS.indexOf(named[1]), Number(named[2]));
    if (date.getMonth() === MONTHS.indexOf(named[1])) return isoDate(date);
  }
  return null;
}

function priorityFor(text: string): Priority {
  const value = text.toLowerCase();
  if (/\b(urgent|asap|important|must|high priority|critical)\b/.test(value)) return 'high';
  if (/\b(low priority|whenever|someday|low)\b/.test(value)) return 'low';
  return 'medium';
}

function cleanTitle(value: string) {
  return value
    .replace(/\b(today|tomorrow|next week|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi, '')
    .replace(/\b(urgent|asap|important|must|high priority|low priority)\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,.;:\-\s]+|[,.;:\-\s]+$/g, '')
    .trim();
}

export function validateExtractedTasks(value: unknown): ExtractedTask[] | null {
  if (!Array.isArray(value)) return null;
  const output: ExtractedTask[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.title !== 'string' || !candidate.title.trim()) return null;
    const due = candidate.due_date;
    if (due !== null && (typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due)))) return null;
    const priority: Priority = candidate.priority === 'low' || candidate.priority === 'high' ? candidate.priority : 'medium';
    output.push({ title: candidate.title.trim(), due_date: due as string | null, priority });
  }
  return output;
}

export function ruleBasedExtractTasks(rawText: string): ExtractedTask[] {
  const pieces = rawText
    .split(/\n|[.!?]+|\band then\b|\bthen\b|\band\b/gi)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const tasks = pieces.map((piece) => ({
    title: cleanTitle(piece) || piece,
    due_date: resolveDueDate(piece),
    priority: priorityFor(piece),
  }));
  return tasks.length ? tasks : [{ title: rawText.trim() || 'Review captured note', due_date: null, priority: 'medium' }];
}

export function buildExtractionPrompt(rawText: string, now = new Date()): string {
  const today = isoDate(now);
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  return `You extract to-do tasks from text. Reply with ONLY a JSON array, no markdown, no explanation. Each item: {"title": string, "due_date": string in YYYY-MM-DD or null, "priority": "low"|"medium"|"high"}. Resolve relative dates like tomorrow / next Friday using today's date, which is ${today} (${weekday}). Words like urgent, asap, important, must => high. If no deadline is stated use null. Never invent tasks that are not in the text. Keep titles short and imperative.\n\nText:\n${rawText}`;
}

export async function extractTasks(rawText: string): Promise<ExtractedTask[]> {
  // A worker-backed WebLLM adapter can be added when the model cache is present.
  // The deterministic path is deliberately complete so airplane mode never dead-ends.
  return ruleBasedExtractTasks(rawText);
}
