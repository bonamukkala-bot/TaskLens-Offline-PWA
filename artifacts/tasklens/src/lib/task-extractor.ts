import { type ExtractedTask, type Priority } from './types';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

/**
 * Resolve specific time of day e.g. "at 6pm", "by 9 in the morning", "at 18:00".
 * Returns "HH:mm" in 24-hour format or null.
 * Vague expressions like "before lunch", "in the evening" without a number return null.
 */
function resolveDueTime(text: string): string | null {
  const value = text.toLowerCase();

  // Pattern: "at 6pm", "at 6:30 pm", "by 9 am", "by 11:45pm"
  const ampmMatch = value.match(/\b(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1], 10);
    const min = ampmMatch[2] || '00';
    const isPm = ampmMatch[3].toLowerCase() === 'pm';
    if (hour === 12) hour = isPm ? 12 : 0;
    else if (isPm) hour += 12;
    return `${String(hour).padStart(2, '0')}:${min}`;
  }

  // Pattern: "by 9 in the morning", "at 6 in the evening", "by 4 in the afternoon"
  const periodMatch = value.match(/\b(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\s+in the (morning|afternoon|evening|night)\b/i);
  if (periodMatch) {
    let hour = parseInt(periodMatch[1], 10);
    const min = periodMatch[2] || '00';
    const period = periodMatch[3].toLowerCase();
    const isPm = period === 'afternoon' || period === 'evening' || period === 'night';
    if (hour === 12) hour = isPm ? 12 : 0;
    else if (isPm && hour < 12) hour += 12;
    return `${String(hour).padStart(2, '0')}:${min}`;
  }

  // Pattern: "at 18:00", "at 09:30" (24h)
  const militaryMatch = value.match(/\bat\s+([01]?\d|2[0-3]):([0-5]\d)\b/i);
  if (militaryMatch) {
    const hour = String(parseInt(militaryMatch[1], 10)).padStart(2, '0');
    return `${hour}:${militaryMatch[2]}`;
  }

  // Pattern: standalone "6:30 pm", "9:00 am"
  const standaloneAmPm = value.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i);
  if (standaloneAmPm) {
    let hour = parseInt(standaloneAmPm[1], 10);
    const min = standaloneAmPm[2];
    const isPm = standaloneAmPm[3].toLowerCase() === 'pm';
    if (hour === 12) hour = isPm ? 12 : 0;
    else if (isPm) hour += 12;
    return `${String(hour).padStart(2, '0')}:${min}`;
  }

  return null;
}

function priorityFor(text: string): Priority {
  const value = text.toLowerCase();
  if (/\b(urgent|asap|important|must|high priority|critical)\b/.test(value)) return 'high';
  if (/\b(low priority|whenever|someday|low)\b/.test(value)) return 'low';
  return 'medium';
}

function cleanTitle(value: string): string {
  return value
    .replace(/\b(?:at|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, '')
    .replace(/\b(?:at|by)\s+\d{1,2}(?::\d{2})?\s+in the (?:morning|afternoon|evening|night)\b/gi, '')
    .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi, '')
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

    let due = candidate.due_date;
    const time = candidate.due_time;
    let validTime: string | null = null;

    // Validate due_time if provided
    if (typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time.trim())) {
      validTime = time.trim();
    }

    // Validate due_date
    if (due !== null && due !== undefined) {
      if (typeof due !== 'string') return null;
      const trimmedDue = due.trim();
      // If already in YYYY-MM-DDTHH:mm or YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(trimmedDue)) {
        if (validTime && /^\d{4}-\d{2}-\d{2}$/.test(trimmedDue)) {
          due = `${trimmedDue}T${validTime}`;
        } else {
          due = trimmedDue;
        }
      } else {
        return null;
      }
    } else {
      due = null;
    }

    const priority: Priority = candidate.priority === 'low' || candidate.priority === 'high' ? candidate.priority : 'medium';
    output.push({
      title: candidate.title.trim(),
      due_date: due as string | null,
      due_time: validTime,
      priority,
    });
  }
  return output;
}

export function ruleBasedExtractTasks(rawText: string, now = new Date()): ExtractedTask[] {
  const pieces = rawText
    .split(/\n|[.!?]+|\band then\b|\bthen\b|\band\b/gi)
    .map((piece) => piece.trim())
    .filter(Boolean);

  const tasks: ExtractedTask[] = pieces.map((piece) => {
    const date = resolveDueDate(piece, now);
    const time = resolveDueTime(piece);
    let combinedDue: string | null = null;

    if (date && time) {
      combinedDue = `${date}T${time}`;
    } else if (date) {
      combinedDue = date;
    } else if (time) {
      // If time was specified without date, default to today
      combinedDue = `${isoDate(now)}T${time}`;
    }

    return {
      title: cleanTitle(piece) || piece,
      due_date: combinedDue,
      due_time: time,
      priority: priorityFor(piece),
    };
  });

  return tasks.length
    ? tasks
    : [{ title: rawText.trim() || 'Review captured note', due_date: null, due_time: null, priority: 'medium' }];
}

export function buildExtractionPrompt(rawText: string, now = new Date()): string {
  const today = isoDate(now);
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = isoDate(tomorrow);

  return `You extract to-do tasks from text. Reply with ONLY a JSON array, no markdown, no explanation.
Each item: {
  "title": string,
  "due_date": string in YYYY-MM-DD or null,
  "due_time": string in HH:mm (24-hour format) or null,
  "priority": "low" | "medium" | "high"
}.
Resolve relative dates like tomorrow / next Friday using today's date, which is ${today} (${weekday}).
If a specific time is mentioned (e.g. "at 6pm" -> "18:00", "by 9 in the morning" -> "09:00"), extract "due_time". If vague (e.g. "before lunch", "in the evening"), use null for due_time.
Words like urgent, asap, important, must => high priority.
Keep titles short, concise, and imperative.

Examples:
Input: "Remind me to call John at 6pm tomorrow, it's urgent."
Output: [{"title": "Call John", "due_date": "${tomorrowStr}", "due_time": "18:00", "priority": "high"}]

Input: "Submit the project notes before lunch on Friday."
Output: [{"title": "Submit project notes", "due_date": "${today}", "due_time": null, "priority": "medium"}]

Text:
${rawText}`;
}

export async function extractTasks(rawText: string): Promise<ExtractedTask[]> {
  return ruleBasedExtractTasks(rawText);
}
