import Dexie, { type Table } from 'dexie';
import {
  DEFAULT_SETTINGS,
  type CaptureSession,
  type Settings,
  type Task,
} from './types';

class TaskLensDatabase extends Dexie {
  tasks!: Table<Task, string>;
  capture_sessions!: Table<CaptureSession, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('tasklens');
    this.version(1).stores({
      tasks: 'id, completed, priority, due_date, created_at, updated_at',
      capture_sessions: 'id, type, created_at',
      settings: 'id',
    });
  }
}

export const db = new TaskLensDatabase();

export async function listTasks(): Promise<Task[]> {
  return db.tasks.orderBy('created_at').reverse().toArray();
}

export async function saveTask(task: Task): Promise<string> {
  await db.tasks.put(task);
  return task.id;
}

export async function updateTask(
  id: string,
  changes: Partial<Task>,
): Promise<void> {
  await db.tasks.update(id, { ...changes, updated_at: new Date().toISOString() });
}

export async function deleteTask(id: string): Promise<void> {
  await db.tasks.delete(id);
}

export async function saveCaptureSession(session: CaptureSession): Promise<string> {
  await db.capture_sessions.put(session);
  return session.id;
}

export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get('default');
  if (existing) return { ...DEFAULT_SETTINGS, ...existing };
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function updateSettings(changes: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...changes };
  await db.settings.put(next);
  return next;
}

export async function clearAllData(): Promise<void> {
  await Promise.all([
    db.tasks.clear(),
    db.capture_sessions.clear(),
    db.settings.clear(),
  ]);
}
