export type TaskWithDueDate = {
  id?: string;
  title: string;
  due?: string | null;
  due_date?: string | null;
  completed?: boolean;
  priority?: 'low' | 'medium' | 'high' | string;
  [key: string]: any;
};

export type TaskClassification<T> = {
  overdue: T[];
  dueToday: T[];
  dueSoon: T[];
};

export type TaskSectionKey =
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'thisWeek'
  | 'later'
  | 'noDate'
  | 'completed';

export type TaskSections<T> = {
  overdue: T[];
  today: T[];
  tomorrow: T[];
  thisWeek: T[];
  later: T[];
  noDate: T[];
  completed: T[];
};

export type ParsedDue = {
  dateStr: string;
  timeStr: string | null;
  fullDate: Date;
  isAllDay: boolean;
};

/**
 * Format a Date object to YYYY-MM-DD in local time
 */
export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Split a due string into date (YYYY-MM-DD) and time (HH:mm) parts for form inputs
 */
export function splitDueDateTime(due: string | null | undefined): { date: string; time: string } {
  if (!due || typeof due !== 'string') return { date: '', time: '' };
  const trimmed = due.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}))?/);
  if (!match) return { date: '', time: '' };
  return {
    date: match[1] || '',
    time: match[2] || '',
  };
}

/**
 * Combine date and optional time into standard due string
 */
export function combineDueDateTime(date: string, time?: string | null): string {
  const trimmedDate = date.trim();
  if (!trimmedDate) return '';
  const trimmedTime = time ? time.trim() : '';
  if (trimmedTime && /^\d{2}:\d{2}/.test(trimmedTime)) {
    return `${trimmedDate}T${trimmedTime.slice(0, 5)}`;
  }
  return trimmedDate;
}

/**
 * Parse a task's due date/time string.
 * If time is omitted, fullDate is set to 23:59:59.999 of that day (all-day).
 */
export function parseTaskDue(raw: string | null | undefined): ParsedDue | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2})(?::\d{2})?)?/);
  if (!match) return null;

  const dateStr = match[1];
  const timeStr = match[2] || null;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

  if (timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) {
      const fullDate = new Date(year, month - 1, day, 23, 59, 59, 999);
      return { dateStr, timeStr: null, fullDate, isAllDay: true };
    }
    const fullDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
    return { dateStr, timeStr, fullDate, isAllDay: false };
  }

  // All day: due at end of day
  const fullDate = new Date(year, month - 1, day, 23, 59, 59, 999);
  return { dateStr, timeStr: null, fullDate, isAllDay: true };
}

/**
 * Extract normalized date string (YYYY-MM-DD) from task
 */
export function getTaskDueDateString(task: TaskWithDueDate): string | null {
  const parsed = parseTaskDue(task.due ?? task.due_date);
  return parsed ? parsed.dateStr : null;
}

/**
 * Format 24-hour HH:mm string to friendly 12-hour format e.g. "6:00 PM"
 */
export function formatTime12Hour(timeStr: string | null | undefined): string {
  if (!timeStr) return '';
  const [hoursStr, minutesStr] = timeStr.split(':');
  let hours = parseInt(hoursStr, 10);
  const minutes = minutesStr || '00';
  if (isNaN(hours)) return timeStr;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${ampm}`;
}

/**
 * Format task due date and time for card chips and labels
 * e.g. "Today, 6:00 PM", "Tomorrow, 9:00 AM", "Today", "Tomorrow", "Sep 25, 4:30 PM"
 */
export function formatTaskDueLabel(dueStr: string | null | undefined, now: Date = new Date()): string {
  if (!dueStr) return '';
  const parsed = parseTaskDue(dueStr);
  if (!parsed) return dueStr;

  const todayStr = formatDateKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = formatDateKey(tomorrow);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDateKey(yesterday);

  let dateLabel = '';
  if (parsed.dateStr === todayStr) {
    dateLabel = 'Today';
  } else if (parsed.dateStr === tomorrowStr) {
    dateLabel = 'Tomorrow';
  } else if (parsed.dateStr === yesterdayStr) {
    dateLabel = 'Yesterday';
  } else {
    dateLabel = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(parsed.fullDate);
  }

  if (parsed.timeStr) {
    return `${dateLabel}, ${formatTime12Hour(parsed.timeStr)}`;
  }
  return dateLabel;
}

/**
 * Pure function to classify incomplete tasks into Overdue, Due today, and Due soon (tomorrow),
 * checking against the exact datetime.
 */
export function classifyTasks<T extends TaskWithDueDate>(
  tasks: T[],
  now: Date = new Date(),
): TaskClassification<T> {
  const todayStr = formatDateKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = formatDateKey(tomorrow);
  const nowTime = now.getTime();

  const overdue: T[] = [];
  const dueToday: T[] = [];
  const dueSoon: T[] = [];

  for (const task of tasks) {
    if (task.completed) continue;
    const parsed = parseTaskDue(task.due ?? task.due_date);
    if (!parsed) continue;

    if (parsed.fullDate.getTime() < nowTime) {
      overdue.push(task);
    } else {
      if (parsed.dateStr === todayStr) {
        dueToday.push(task);
      } else if (parsed.dateStr === tomorrowStr) {
        dueSoon.push(task);
      }
    }
  }

  return { overdue, dueToday, dueSoon };
}

/**
 * Group tasks into the full set of collapsible sections:
 * Overdue, Today, Tomorrow, This week, Later, No date, Completed.
 */
export function groupTasksIntoSections<T extends TaskWithDueDate>(
  tasks: T[],
  now: Date = new Date(),
): TaskSections<T> {
  const todayStr = formatDateKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = formatDateKey(tomorrow);
  const nowTime = now.getTime();

  // End of this week (next Sunday or 7 days from today)
  const currentDay = now.getDay();
  const daysUntilSunday = currentDay === 0 ? 0 : 7 - currentDay;
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + Math.max(daysUntilSunday, 6));
  const endOfWeekStr = formatDateKey(endOfWeek);

  const sections: TaskSections<T> = {
    overdue: [],
    today: [],
    tomorrow: [],
    thisWeek: [],
    later: [],
    noDate: [],
    completed: [],
  };

  for (const task of tasks) {
    if (task.completed) {
      sections.completed.push(task);
      continue;
    }

    const parsed = parseTaskDue(task.due ?? task.due_date);
    if (!parsed) {
      sections.noDate.push(task);
      continue;
    }

    if (parsed.fullDate.getTime() < nowTime) {
      sections.overdue.push(task);
    } else if (parsed.dateStr === todayStr) {
      sections.today.push(task);
    } else if (parsed.dateStr === tomorrowStr) {
      sections.tomorrow.push(task);
    } else if (parsed.dateStr <= endOfWeekStr) {
      sections.thisWeek.push(task);
    } else {
      sections.later.push(task);
    }
  }

  return sections;
}

/**
 * Find the single most urgent task from a list of tasks
 */
export function getMostUrgentTask<T extends TaskWithDueDate>(tasks: T[]): T | null {
  if (!tasks.length) return null;

  const priorityScore = (p?: string) => {
    if (p === 'high') return 3;
    if (p === 'medium') return 2;
    return 1;
  };

  return [...tasks].sort((a, b) => {
    const parsedA = parseTaskDue(a.due ?? a.due_date);
    const parsedB = parseTaskDue(b.due ?? b.due_date);
    const timeA = parsedA ? parsedA.fullDate.getTime() : Infinity;
    const timeB = parsedB ? parsedB.fullDate.getTime() : Infinity;

    // Earlier due time first
    if (timeA !== timeB) {
      return timeA - timeB;
    }

    // Higher priority first
    const pDiff = priorityScore(b.priority) - priorityScore(a.priority);
    if (pDiff !== 0) return pDiff;
    return 0;
  })[0] ?? null;
}

/**
 * Generate human-friendly reminder banner and notification summary
 */
export function getReminderSummary<T extends TaskWithDueDate>(
  classification: TaskClassification<T>,
): {
  bannerHeadline: string;
  bannerSubtext?: string;
  notificationBody: string;
  mostUrgent: T | null;
} {
  const { overdue, dueToday } = classification;
  const urgentTasks = [...overdue, ...dueToday];
  const mostUrgent = getMostUrgentTask(urgentTasks);

  if (urgentTasks.length === 0) {
    return {
      bannerHeadline: 'No tasks due today',
      notificationBody: 'All clear.',
      mostUrgent: null,
    };
  }

  // Single task due today case with time
  if (overdue.length === 0 && dueToday.length === 1 && mostUrgent) {
    const parsed = parseTaskDue(mostUrgent.due ?? mostUrgent.due_date);
    if (parsed && parsed.timeStr) {
      const timeLabel = formatTime12Hour(parsed.timeStr);
      const headline = `"${mostUrgent.title}" is due at ${timeLabel}`;
      return {
        bannerHeadline: headline,
        bannerSubtext: 'Due today with specific time',
        notificationBody: `"${mostUrgent.title}" is due at ${timeLabel}.`,
        mostUrgent,
      };
    }
  }

  // Multiple tasks or overdue tasks
  let headline = '';
  if (overdue.length > 0 && dueToday.length > 0) {
    headline = `${overdue.length} ${overdue.length === 1 ? 'task' : 'tasks'} overdue, ${dueToday.length} due today`;
  } else if (overdue.length > 0) {
    headline = `${overdue.length} ${overdue.length === 1 ? 'task' : 'tasks'} overdue`;
  } else {
    headline = `${dueToday.length} ${dueToday.length === 1 ? 'task' : 'tasks'} due today`;
  }

  let notificationBody = headline;
  if (mostUrgent) {
    const parsed = parseTaskDue(mostUrgent.due ?? mostUrgent.due_date);
    if (parsed && parsed.timeStr) {
      notificationBody += ` · Urgent: "${mostUrgent.title}" at ${formatTime12Hour(parsed.timeStr)}`;
    } else {
      notificationBody += ` · Urgent: "${mostUrgent.title}"`;
    }
  }

  return {
    bannerHeadline: headline,
    bannerSubtext: mostUrgent ? `Most urgent: ${mostUrgent.title}` : undefined,
    notificationBody,
    mostUrgent,
  };
}

/**
 * Check if the Notification API is supported
 */
export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Get current browser notification permission
 */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported';
  try {
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

/**
 * Request Notification permission safely
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isNotificationSupported()) return 'unsupported';
  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch {
    return 'unsupported';
  }
}

/**
 * Send a browser notification safely
 */
export function sendBrowserNotification(
  title: string,
  options?: NotificationOptions,
): Notification | null {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return null;
  }

  try {
    const notification = new Notification(title, {
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      ...options,
    });

    notification.onclick = () => {
      try {
        window.focus?.();
      } catch {
        // ignore
      }
      notification.close();
    };

    return notification;
  } catch {
    return null;
  }
}

/**
 * Schedule a foreground-only demo notification (e.g. 8 seconds after review high-priority save)
 */
export function scheduleForegroundReminder(
  taskTitle: string,
  delayMs: number = 8000,
): number | null {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return null;
  }

  const timerId = window.setTimeout(() => {
    sendBrowserNotification(`Reminder: ${taskTitle}`, {
      body: 'High-priority task scheduled reminder.',
      tag: `demo-reminder-${Date.now()}`,
    });
  }, delayMs);

  return timerId;
}
