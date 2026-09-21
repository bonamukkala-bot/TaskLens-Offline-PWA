import { type ChangeEvent, type FormEvent, type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Archive, ArrowLeft, Camera, Check, CheckCircle2, ChevronRight, CircleHelp, Clock3, FileText,
  Filter, Headphones, ImagePlus, LoaderCircle, Mic, Moon, Pencil, Plus, Save, Settings,
  Sparkles, Sun, Trash2, Upload, Volume2, WifiOff, X, Zap,
} from 'lucide-react';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import NotFound from '@/pages/not-found';
import { deleteTask as deleteTaskFromDb, listTasks, saveTask, updateTask as updateTaskInDb, clearAllData, getSettings, updateSettings, saveCaptureSession } from '@/lib/db';
import { startRecording, stopRecording, type AudioCapture } from '@/lib/audio-capture';
import { transcribe } from '@/lib/stt';
import { capturePhoto } from '@/lib/camera-capture';
import { extractText } from '@/lib/ocr';
import { extractTasks } from '@/lib/task-extractor';
import { ensureModelsLoaded, getStorageEstimate, LLM_MODELS, requestPersistentStorage } from '@/lib/model-manager';
import { type ExtractedTask } from '@/lib/types';

type Task = {
  id: string;
  title: string;
  details: string;
  due: string;
  priority: 'low' | 'medium' | 'high';
  completed: boolean;
  source: 'manual' | 'voice' | 'camera';
  sourceSessionId: string | null;
  createdAt: number;
};

type Draft = Pick<Task, 'title' | 'details' | 'due' | 'priority' | 'source'> & {
  rawText?: string;
  processingTimeMs?: number;
  sessionId?: string;
};
type Theme = 'dark' | 'light';
type LensContextValue = {
  tasks: Task[];
  theme: Theme;
  setTheme: (theme: Theme) => void;
  createTask: (draft: Draft) => void;
  updateTask: (id: string, draft: Partial<Draft>) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  openComposer: (draft?: Task) => void;
};

const queryClient = new QueryClient();
const LensContext = createContext<LensContextValue | null>(null);
const today = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' });

function useLens() {
  const value = useContext(LensContext);
  if (!value) throw new Error('TaskLens context is missing');
  return value;
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function fromDbTask(task: Awaited<ReturnType<typeof listTasks>>[number]): Task {
  return {
    id: task.id,
    title: task.title,
    details: task.details ?? '',
    due: task.due_date ?? '',
    priority: task.priority,
    completed: task.completed,
    source: task.source_type,
    sourceSessionId: task.source_session_id,
    createdAt: Date.parse(task.created_at),
  };
}

function toDbTask(task: Task) {
  return {
    id: task.id,
    title: task.title,
    details: task.details,
    due_date: task.due || null,
    priority: task.priority,
    source_type: task.source,
    source_session_id: task.sourceSessionId,
    completed: task.completed,
    created_at: new Date(task.createdAt).toISOString(),
    updated_at: new Date().toISOString(),
  } as const;
}

function LensProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [theme, setThemeState] = useState<Theme>('dark');
  const [composer, setComposer] = useState<{ open: boolean; task?: Task }>({ open: false });

  useEffect(() => {
    void listTasks().then((stored) => setTasks(stored.map(fromDbTask)));
    void getSettings().then((stored) => {
      setThemeState(stored.theme);
      document.documentElement.classList.toggle('dark', stored.theme === 'dark');
    });
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    void updateSettings({ theme });
  }, [theme]);

  const value = useMemo<LensContextValue>(() => ({
    tasks,
    theme,
    setTheme: setThemeState,
    createTask: (draft) => {
      const task = { ...draft, id: makeId(), completed: false, sourceSessionId: draft.sessionId ?? null, createdAt: Date.now() };
      setTasks((current) => [task, ...current]);
      void saveTask(toDbTask(task));
    },
    updateTask: (id, draft) => {
      setTasks((current) => current.map((task) => task.id === id ? { ...task, ...draft } : task));
      void updateTaskInDb(id, {
        ...(draft.title === undefined ? {} : { title: draft.title }),
        ...(draft.details === undefined ? {} : { details: draft.details }),
        ...(draft.due === undefined ? {} : { due_date: draft.due || null }),
        ...(draft.priority === undefined ? {} : { priority: draft.priority }),
      });
    },
    toggleTask: (id) => {
      setTasks((current) => current.map((task) => {
        if (task.id !== id) return task;
        const completed = !task.completed;
        void updateTaskInDb(id, { completed });
        return { ...task, completed };
      }));
    },
    deleteTask: (id) => {
      setTasks((current) => current.filter((task) => task.id !== id));
      void deleteTaskFromDb(id);
    },
    openComposer: (task) => setComposer({ open: true, task }),
  }), [tasks, theme]);

  return <LensContext.Provider value={value}><AppShell composer={composer} closeComposer={() => setComposer({ open: false })}>{children}</AppShell></LensContext.Provider>;
}

function AppShell({ children, composer, closeComposer }: { children: ReactNode; composer: { open: boolean; task?: Task }; closeComposer: () => void }) {
  const [location] = useLocation();
  const { openComposer, tasks } = useLens();
  const navItems = [
    { href: '/', label: 'Tasks', icon: CheckCircle2 },
    { href: '/voice', label: 'Voice', icon: Mic },
    { href: '/camera', label: 'Camera', icon: Camera },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];
  return (
    <div className="app-noise min-h-[100dvh] bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[224px] flex-col border-r border-border/70 bg-card/70 px-5 py-6 backdrop-blur-xl md:flex">
        <Link href="/" className="mb-12 flex items-center gap-3" data-testid="link-brand">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_8px_24px_hsl(var(--primary)/.22)]"><Zap size={19} strokeWidth={2.5} /></span>
          <span><strong className="block text-[15px] tracking-tight">TaskLens</strong><small className="text-[11px] text-muted-foreground">private by default</small></span>
        </Link>
        <nav className="space-y-1.5" aria-label="Primary navigation">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} data-testid={`link-nav-${label.toLowerCase()}`} className={`flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm transition-colors ${location === href ? 'bg-accent font-semibold text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
              <Icon size={18} strokeWidth={location === href ? 2.4 : 1.8} /><span>{label}</span>
              {href === '/' && <span className="ml-auto font-mono text-[10px] text-muted-foreground">{tasks.length}</span>}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl border border-primary/20 bg-accent/55 p-4">
          <WifiOff size={17} className="mb-3 text-primary" />
          <p className="text-xs font-semibold">Airplane mode ready</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Your tasks stay on this device. No account required.</p>
        </div>
      </aside>

      <main className="mx-auto min-h-[100dvh] max-w-[760px] px-5 pb-28 pt-5 md:ml-[224px] md:max-w-[980px] md:px-10 md:pb-10 md:pt-9">
        <div className="mb-6 flex items-center justify-between md:hidden">
          <Link href="/" className="flex items-center gap-2.5" data-testid="link-mobile-brand">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Zap size={17} /></span>
            <span><strong className="block text-sm tracking-tight">TaskLens</strong><small className="text-[10px] text-muted-foreground">private by default</small></span>
          </Link>
          <Link href="/settings" aria-label="Open settings" className="rounded-xl border border-border p-2 text-muted-foreground"><Settings size={17} /></Link>
        </div>
        <div className="page-enter">{children}</div>
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t border-border/80 bg-card/90 px-3 pt-2 backdrop-blur-xl md:hidden" aria-label="Mobile navigation">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} data-testid={`link-mobile-${label.toLowerCase()}`} className={`flex flex-1 flex-col items-center gap-1 py-1.5 text-[10px] ${location === href ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
            <Icon size={19} strokeWidth={location === href ? 2.6 : 1.8} /><span>{label}</span>
          </Link>
        ))}
        <button type="button" onClick={() => openComposer()} data-testid="button-mobile-add" className="flex flex-1 flex-col items-center gap-1 py-1.5 text-[10px] text-muted-foreground">
          <span className="-mt-5 grid h-11 w-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20"><Plus size={21} /></span><span>Add</span>
        </button>
      </nav>
      {composer.open && <ComposerSheet task={composer.task} close={closeComposer} />}
    </div>
  );
}

function Header({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle?: string; action?: ReactNode }) {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [ready, setReady] = useState(() => false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    void getSettings().then((settings) => setReady(settings.models_ready));
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return <header className="mb-8 flex items-start justify-between gap-4">
    <div className="min-w-0">{eyebrow && <p className="mb-2 font-mono text-[10px] uppercase tracking-[.18em] text-primary">{eyebrow}</p>}<h1 className="text-[30px] font-semibold leading-tight tracking-[-.045em] md:text-[38px]">{title}</h1>{subtitle && <p className="mt-2 max-w-[520px] text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}</div>
    <div className="flex shrink-0 flex-col items-end gap-2">
      {action}
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${ready ? 'border-primary/30 bg-accent text-accent-foreground' : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300'}`} aria-label={ready ? 'On-device offline-ready' : 'Setting up on-device models'}>
        <span className={`h-1.5 w-1.5 rounded-full ${ready ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        {ready ? 'On-device · offline-ready' : 'Setting up'}
      </span>
      <span className="text-[10px] text-muted-foreground">{online ? 'Online' : 'Offline'}</span>
    </div>
  </header>;
}

function DashboardPage() {
  const { tasks, openComposer, toggleTask, deleteTask } = useLens();
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | Task['priority']>('all');
  const [dueSort, setDueSort] = useState<'recent' | 'due'>('recent');
  const [query, setQuery] = useState('');
  const visible = tasks
    .filter((task) => (filter === 'all' || (filter === 'open' ? !task.completed : task.completed)) && (priorityFilter === 'all' || task.priority === priorityFilter) && task.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => dueSort === 'due' ? (a.due || '9999-12-31').localeCompare(b.due || '9999-12-31') : b.createdAt - a.createdAt);
  const openCount = tasks.filter((task) => !task.completed).length;
  return <section data-testid="page-dashboard">
    <Header eyebrow={today.format(new Date())} title="A clear head starts here." subtitle={openCount ? `${openCount} open ${openCount === 1 ? 'task' : 'tasks'} waiting for you.` : 'Capture the thought before it gets away.'} action={<button type="button" onClick={() => openComposer()} data-testid="button-add-task" className="hidden items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/15 transition-transform hover:-translate-y-0.5 md:flex"><Plus size={17} />Add task</button>} />
     <div className="mb-6 flex flex-col gap-3">
      <label className="relative flex-1"><Filter size={16} className="absolute left-3.5 top-3.5 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} data-testid="input-search-tasks" placeholder="Find a task" className="h-11 w-full rounded-xl border border-input bg-card pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15" /></label>
       <div className="flex flex-wrap gap-2">
         <div className="flex rounded-xl border border-border bg-card p-1" role="group" aria-label="Task visibility">{(['all', 'open', 'done'] as const).map((item) => <button key={item} type="button" onClick={() => setFilter(item)} data-testid={`button-filter-${item}`} className={`rounded-lg px-3.5 py-2 text-xs font-semibold capitalize transition-colors ${filter === item ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{item === 'all' ? 'All' : item === 'open' ? 'Open' : 'Done'}</button>)}</div>
         <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as typeof priorityFilter)} aria-label="Filter by priority" className="h-10 rounded-xl border border-border bg-card px-3 text-xs font-semibold"><option value="all">Every priority</option><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select>
         <select value={dueSort} onChange={(event) => setDueSort(event.target.value as typeof dueSort)} aria-label="Sort tasks by due date" className="h-10 rounded-xl border border-border bg-card px-3 text-xs font-semibold"><option value="recent">Recently added</option><option value="due">Due date</option></select>
       </div>
    </div>
     {tasks.length === 0 ? <EmptyDashboard onAdd={() => openComposer()} /> : visible.length === 0 ? <EmptyFilter onReset={() => { setQuery(''); setFilter('all'); setPriorityFilter('all'); setDueSort('recent'); }} /> : <div className="space-y-2.5" data-testid="list-tasks">{visible.map((task, index) => <TaskCard key={task.id} task={task} index={index} onToggle={() => toggleTask(task.id)} onEdit={() => openComposer(task)} onDelete={() => { if (window.confirm('Delete this task?')) deleteTask(task.id); }} />)}</div>}
    {tasks.length > 0 && <div className="mt-7 flex items-center justify-between border-t border-border/70 pt-4 text-xs text-muted-foreground"><span>{tasks.filter((task) => task.completed).length} completed</span><button type="button" onClick={() => openComposer()} data-testid="button-add-task-bottom" className="flex items-center gap-1.5 font-semibold text-primary"><Plus size={15} />New task</button></div>}
  </section>;
}

function EmptyDashboard({ onAdd }: { onAdd: () => void }) {
  return <div className="fade-up rounded-[24px] border border-dashed border-primary/35 bg-gradient-to-br from-accent/60 to-card p-7 text-center md:p-12" data-testid="empty-tasks">
    <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl border border-primary/20 bg-primary/10 text-primary"><Sparkles size={27} /></div>
    <p className="mb-2 font-mono text-[10px] uppercase tracking-[.18em] text-primary">Your next thought</p>
    <h2 className="text-xl font-semibold tracking-tight">Nothing is competing for your attention.</h2>
    <p className="mx-auto mt-2 max-w-[350px] text-sm leading-relaxed text-muted-foreground">Write a task, say it out loud, or point your camera at a note. TaskLens keeps the rest quiet.</p>
    <div className="mt-7 flex flex-col justify-center gap-2.5 sm:flex-row"><button type="button" onClick={onAdd} data-testid="button-empty-add" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"><Plus size={17} />Write a task</button><Link href="/voice" data-testid="link-empty-voice" className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-semibold"><Mic size={17} />Use your voice</Link></div>
  </div>;
}

function EmptyFilter({ onReset }: { onReset: () => void }) {
  return <div className="rounded-[24px] border border-border bg-card px-6 py-14 text-center" data-testid="empty-filter"><Archive size={25} className="mx-auto mb-3 text-muted-foreground" /><p className="font-semibold">No matching tasks</p><p className="mt-1 text-sm text-muted-foreground">Try another filter or clear your search.</p><button type="button" onClick={onReset} data-testid="button-reset-filter" className="mt-5 text-sm font-semibold text-primary">Show all tasks</button></div>;
}

function TaskCard({ task, index, onToggle, onEdit, onDelete }: { task: Task; index: number; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const touchStart = useRef<number | null>(null);
  const onTouchStart = (event: React.TouchEvent) => { touchStart.current = event.changedTouches[0]?.clientX ?? null; };
  const onTouchEnd = (event: React.TouchEvent) => {
    if (touchStart.current === null) return;
    const delta = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current;
    touchStart.current = null;
    if (delta > 80) onToggle();
    if (delta < -80) onDelete();
  };
  return <article onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className={`fade-up delay-${Math.min(index + 1, 3)} group rounded-2xl border bg-card p-4 transition-colors ${task.completed ? 'border-border/60 opacity-70' : 'border-card-border hover:border-primary/35'}`} data-testid={`card-task-${task.id}`}>
    <div className="flex gap-3.5"><button type="button" onClick={onToggle} aria-label={task.completed ? 'Mark task open' : 'Complete task'} data-testid={`button-toggle-task-${task.id}`} className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${task.completed ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50 hover:border-primary'}`}>{task.completed && <Check size={13} strokeWidth={3} />}</button><div className="min-w-0 flex-1"><button type="button" onClick={onEdit} data-testid={`button-edit-task-${task.id}`} className="text-left"><h3 className={`text-[15px] font-semibold leading-snug ${task.completed ? 'text-muted-foreground line-through' : ''}`}>{task.title}</h3>{task.details && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{task.details}</p>}</button><div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-medium text-muted-foreground"><span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1" title={`${task.source} source`}>{task.source === 'voice' ? <Mic size={12} /> : task.source === 'camera' ? <Camera size={12} /> : <Pencil size={12} />}{task.source}</span>{task.due && <span className="flex items-center gap-1"><Clock3 size={12} />{task.due}</span>}<span className={`rounded-md px-2 py-1 capitalize ${task.priority === 'high' ? 'bg-destructive/15 text-destructive' : task.priority === 'medium' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300' : 'bg-muted text-muted-foreground'}`}>{task.priority}</span></div></div><div className="flex shrink-0 items-start gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"><button type="button" onClick={onEdit} aria-label="Edit task" data-testid={`button-edit-icon-${task.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil size={15} /></button><button type="button" onClick={onDelete} aria-label="Delete task" data-testid={`button-delete-task-${task.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 size={15} /></button></div></div>
  </article>;
}

function ComposerSheet({ task, close }: { task?: Task; close: () => void }) {
  const { createTask, updateTask } = useLens();
  const [title, setTitle] = useState(task?.title || '');
  const [details, setDetails] = useState(task?.details || '');
  const [due, setDue] = useState(task?.due || '');
  const [priority, setPriority] = useState<Draft['priority']>(task?.priority || 'medium');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) { setError('Give this task a short title first.'); return; }
    if (task) updateTask(task.id, { title: title.trim(), details: details.trim(), due, priority });
    else createTask({ title: title.trim(), details: details.trim(), due, priority, source: 'manual' });
    close();
  };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[hsl(var(--background)/.72)] p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={task ? 'Edit task' : 'Add task'}>
    <div className="fade-up w-full max-w-[520px] rounded-t-[28px] border border-border bg-card p-5 shadow-2xl sm:rounded-[28px] sm:p-7">
      <div className="mb-6 flex items-center justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">{task ? 'Refine task' : 'Quick capture'}</p><h2 className="mt-1 text-xl font-semibold">{task ? 'Edit task' : 'Add a task'}</h2></div><button type="button" onClick={close} data-testid="button-close-composer" className="rounded-xl p-2 text-muted-foreground hover:bg-muted"><X size={19} /></button></div>
      <form onSubmit={submit} className="space-y-4"><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Task title</span><input autoFocus value={title} onChange={(event) => { setTitle(event.target.value); setError(''); }} data-testid="input-task-title" placeholder="What needs to happen?" className="h-12 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Notes <span className="font-normal">(optional)</span></span><textarea value={details} onChange={(event) => setDetails(event.target.value)} data-testid="input-task-details" placeholder="Add useful context..." rows={3} className="w-full resize-none rounded-xl border border-input bg-background px-3.5 py-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /></label><div className="grid grid-cols-2 gap-3"><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Due</span><input type="date" value={due} onChange={(event) => setDue(event.target.value)} data-testid="input-task-due" className="h-11 w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm outline-none focus:border-primary" /></label><fieldset className="block"><legend className="mb-1.5 block text-xs font-semibold text-muted-foreground">Priority</legend><div className="grid grid-cols-3 overflow-hidden rounded-xl border border-input bg-background p-1">{(['low', 'medium', 'high'] as const).map((option) => <button key={option} type="button" onClick={() => setPriority(option)} className={`min-h-9 rounded-lg px-1 text-[11px] font-semibold capitalize ${priority === option ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`}>{option}</button>)}</div></fieldset></div>{error && <p className="text-sm text-destructive" data-testid="status-composer-error">{error}</p>}<button type="submit" data-testid="button-save-task" className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"><Save size={17} />{task ? 'Save changes' : 'Save task'}</button></form>
    </div>
  </div>;
}

function CapturePage({ mode }: { mode: 'voice' | 'camera' }) {
  const isVoice = mode === 'voice';
  type CaptureStatus = 'idle' | 'recording' | 'transcribing' | 'reading' | 'understanding' | 'error';
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [message, setMessage] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [image, setImage] = useState('');
  const capture = useRef<AudioCapture | null>(null);
  const timer = useRef<number | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
    capture.current?.stream.getTracks().forEach((track) => track.stop());
  }, []);
  useEffect(() => {
    if (status !== 'recording' || !capture.current) return;
    const analyser = capture.current.analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const sample = () => {
      analyser.getByteTimeDomainData(data);
      const average = data.reduce((sum, value) => sum + Math.abs(value - 128), 0) / data.length / 128;
      setLevel(Math.min(1, average * 3));
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [status]);

  const sendToReview = async (rawText: string, source: 'voice' | 'camera', startedAt: number) => {
    const tasks = await extractTasks(rawText);
    const settings = await getSettings();
    const sessionId = makeId();
    await saveCaptureSession({ id: sessionId, type: source, raw_text: rawText, model_used: settings.selected_llm, processing_time_ms: performance.now() - startedAt, created_at: new Date().toISOString() });
    const first = tasks[0];
    if (!first) throw new Error('No task proposal was produced.');
    sessionStorage.setItem('tasklens.draft', JSON.stringify({
      title: first.title,
      details: rawText,
      due: first.due_date ?? '',
      priority: first.priority,
      source,
      rawText,
      processingTimeMs: Math.round(performance.now() - startedAt),
      sessionId,
    } satisfies Draft));
    setLocation('/review');
  };
  const processText = async (rawText: string, source: 'voice' | 'camera', startedAt: number) => {
    if (!rawText.trim()) {
      setStatus('error');
      setMessage(source === 'voice' ? 'No speech detected. Try speaking a little closer to the microphone.' : 'The photo was too blurry or empty. Retake it with the note inside the frame.');
      return;
    }
    setStatus('understanding');
    try { await sendToReview(rawText, source, startedAt); } catch { setStatus('error'); setMessage('The on-device model could not finish this capture. Try again or add the task manually.'); }
  };
  const startVoice = async () => {
    if (!isVoice) return;
    try {
      capture.current = await startRecording();
      setElapsed(0); setMessage(''); setStatus('recording');
      timer.current = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    } catch { setStatus('error'); setMessage('Microphone permission was not granted. Enable it in Chrome site settings, then try again.'); }
  };
  const stopVoice = async () => {
    if (!capture.current) return;
    const startedAt = performance.now();
    if (timer.current) window.clearInterval(timer.current);
    setStatus('transcribing');
    const audio = await stopRecording(capture.current);
    capture.current = null;
    const text = await transcribe(audio);
    await processText(text, 'voice', startedAt);
  };
  const onCapture = async (blob: Blob) => {
    const startedAt = performance.now();
    setImage(URL.createObjectURL(blob));
    setStatus('reading');
    const text = await extractText(blob);
    await processText(text, 'camera', startedAt);
  };
  const onImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void onCapture(file);
  };
  const sample = () => {
    setMessage('');
    setStatus(isVoice ? 'transcribing' : 'reading');
    const startedAt = performance.now();
    window.setTimeout(() => void processText(isVoice ? "Submit the DBMS assignment tomorrow, it's urgent." : 'Review the handwritten project notes next Friday.', isVoice ? 'voice' : 'camera', startedAt), 500);
  };

  return <section data-testid={`page-${mode}`}>
    <Link href="/" data-testid={`link-back-${mode}`} className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft size={17} />Back to tasks</Link>
    <Header eyebrow={isVoice ? 'Voice capture' : 'Camera capture'} title={isVoice ? 'Say it once. Keep moving.' : 'Point. Capture. Continue.'} subtitle={isVoice ? 'Your voice stays on this device while TaskLens turns it into a task.' : 'Photograph a handwritten note and turn it into something you can act on.'} />
    {isVoice ? <VoiceCapture status={status} elapsed={elapsed} level={level} onStart={startVoice} onStop={() => void stopVoice()} onSample={sample} /> : <CameraCapture status={status} image={image} onImage={onImage} onCapture={(blob) => void onCapture(blob)} onCameraError={(error) => { setStatus('error'); setMessage(error); }} onSample={sample} />}
    {message && <div className="mt-4 flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" data-testid="status-capture-error"><CircleHelp size={18} className="mt-0.5 shrink-0" /><span>{message}</span></div>}
    {['transcribing', 'reading', 'understanding'].includes(status) && <ProcessingCard status={status} isVoice={isVoice} />}
  </section>;
}

function VoiceCapture({ status, elapsed, level, onStart, onStop, onSample }: { status: string; elapsed: number; level: number; onStart: () => void; onStop: () => void; onSample: () => void }) {
  return <div className="flex flex-col items-center rounded-[28px] border border-border bg-card px-5 py-12 text-center" data-testid="voice-capture-card">
    <div className="mb-8 flex h-12 items-end justify-center gap-1.5" aria-label="Live microphone level">{Array.from({ length: 18 }, (_, index) => <span key={index} className="w-1.5 rounded-full bg-primary transition-[height] duration-75" style={{ height: `${8 + Math.max(4, level * (18 + (index % 4) * 8))}px` }} />)}</div>
    <div className={`relative mb-7 grid h-40 w-40 place-items-center rounded-full border border-primary/35 bg-accent/50 ${status === 'recording' ? 'pulse-ring' : ''}`}><div className="absolute inset-4 rounded-full border border-primary/20" /><button type="button" onClick={status === 'recording' ? onStop : onStart} disabled={['transcribing', 'understanding', 'reading'].includes(status)} data-testid="button-record-voice" className={`relative grid h-24 w-24 place-items-center rounded-full shadow-xl transition-transform hover:scale-105 active:scale-95 ${status === 'recording' ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'}`}>{status === 'recording' ? <div className="h-6 w-6 rounded-md bg-current" /> : <Mic size={31} />}</button></div>
    <p className="font-mono text-xs uppercase tracking-[.16em] text-primary">{status === 'recording' ? `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')} recording` : status === 'transcribing' ? 'Transcribing (on-device)…' : status === 'understanding' ? 'Understanding (on-device)…' : 'Tap to speak'}</p>
    <p className="mt-2 max-w-[300px] text-sm text-muted-foreground">{status === 'recording' ? 'Tap the button when the thought is complete.' : 'Keep it natural. You can edit everything before saving.'}</p>
    <button type="button" onClick={onSample} disabled={status === 'recording' || ['transcribing', 'understanding'].includes(status)} data-testid="button-sample-voice" className="mt-7 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"><Volume2 size={15} />Use sample capture</button>
  </div>;
}

function CameraCapture({ status, image, onImage, onCapture, onCameraError, onSample }: { status: string; image: string; onImage: (event: ChangeEvent<HTMLInputElement>) => void; onCapture: (blob: Blob) => void; onCameraError: (message: string) => void; onSample: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    let active = true;
    if (!navigator.mediaDevices?.getUserMedia) { onCameraError('Live camera access is unavailable here. Choose a photo from your gallery instead.'); return; }
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then((stream) => {
      if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play(); }
    }).catch(() => onCameraError('Camera permission was not granted. Enable it in Chrome site settings, or choose a photo from your gallery.'));
    return () => { active = false; streamRef.current?.getTracks().forEach((track) => track.stop()); };
  }, [onCameraError]);
  const shutter = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    try { onCapture(await capturePhoto(videoRef.current, canvasRef.current)); } catch { onCameraError('Could not capture that frame. Try again or choose a photo from your gallery.'); }
  };
  const busy = ['reading', 'understanding'].includes(status);
  return <div className="rounded-[28px] border border-border bg-card p-3" data-testid="camera-capture-card">
    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[20px] bg-[#0d2731]">
      {image ? <img src={image} alt="Selected note preview" className="h-full w-full object-cover" /> : <><video ref={videoRef} playsInline muted className="h-full w-full object-cover" /><div className="pointer-events-none absolute inset-8 rounded-2xl border border-primary/70" /><div className="pointer-events-none absolute left-1/2 top-8 bottom-8 w-px bg-primary/15" /><div className="pointer-events-none absolute left-8 right-8 top-1/2 h-px bg-primary/15" /><div className="scan-line pointer-events-none absolute left-10 right-10 top-1/2 h-px bg-primary shadow-[0_0_18px_hsl(var(--primary))]" /></>}
      <canvas ref={canvasRef} className="hidden" />
      <button type="button" onClick={() => void shutter()} disabled={busy || Boolean(image)} aria-label="Take photo" className="absolute bottom-4 left-1/2 grid h-16 w-16 -translate-x-1/2 place-items-center rounded-full border-4 border-white/80 bg-primary text-primary-foreground shadow-xl disabled:opacity-50"><Camera size={25} /></button>
    </div>
    <div className="flex flex-col gap-2.5 p-2 pt-4 sm:flex-row"><label className="flex h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"><Upload size={17} />Choose a photo<input type="file" accept="image/*" capture="environment" onChange={onImage} data-testid="input-camera-photo" className="sr-only" /></label><button type="button" onClick={onSample} disabled={busy} data-testid="button-sample-camera" className="flex h-12 items-center justify-center gap-2 rounded-xl border border-border px-5 text-sm font-semibold disabled:opacity-50"><ImagePlus size={17} />Use sample note</button></div>
  </div>;
}

function ProcessingCard({ status, isVoice }: { status: string; isVoice: boolean }) {
  const label = status === 'transcribing' ? 'Transcribing (on-device)…' : status === 'reading' ? 'Reading (on-device)…' : 'Understanding (on-device)…';
  return <div className="mt-4 flex items-center gap-3 rounded-2xl border border-primary/25 bg-accent/40 p-4" data-testid="status-processing"><LoaderCircle size={19} className="animate-spin text-primary" /><div><p className="text-sm font-semibold">{label}</p><p className="text-xs text-muted-foreground">{isVoice ? 'The audio stays in this browser.' : 'The image stays in this browser.'}</p></div></div>;
}

function ReviewPage() {
  const { createTask } = useLens();
  const [, setLocation] = useLocation();
  const [draft, setDraft] = useState<Draft | null>(() => { try { return JSON.parse(sessionStorage.getItem('tasklens.draft') || 'null') as Draft | null; } catch { return null; } });
  const [saved, setSaved] = useState(false);
  const save = (event: FormEvent) => { event.preventDefault(); if (!draft?.title.trim()) return; createTask(draft); sessionStorage.removeItem('tasklens.draft'); navigator.vibrate?.(15); setSaved(true); window.setTimeout(() => setLocation('/'), 450); };
  const discard = () => { sessionStorage.removeItem('tasklens.draft'); setLocation('/'); };
  return <section data-testid="page-review"><Link href="/" data-testid="link-back-review" className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft size={17} />Back to tasks</Link><Header eyebrow="One last look" title="Make it yours." subtitle="TaskLens made a best guess. Tune the wording, then save it when it feels right." />{!draft ? <div className="rounded-[24px] border border-dashed border-border bg-card p-12 text-center" data-testid="empty-review"><FileText size={26} className="mx-auto mb-3 text-muted-foreground" /><p className="font-semibold">Nothing is waiting for review</p><p className="mt-1 text-sm text-muted-foreground">Capture something with voice or camera to see it here.</p><Link href="/voice" data-testid="link-review-capture" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary">Start a capture <ChevronRight size={15} /></Link></div> : <form onSubmit={save} className="space-y-4" data-testid="form-review"><div className="rounded-[24px] border border-primary/25 bg-accent/35 p-5"><div className="mb-4 flex items-center gap-2 text-xs font-semibold text-primary"><Sparkles size={15} />Proposed task</div><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Title</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} data-testid="input-review-title" className="h-12 w-full rounded-xl border border-input bg-card px-3.5 text-sm outline-none focus:border-primary" /></label><label className="mt-4 block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">What the AI heard/read</span><textarea value={draft.details} onChange={(event) => setDraft({ ...draft, details: event.target.value })} data-testid="input-review-details" rows={3} className="w-full resize-none rounded-xl border border-input bg-card px-3.5 py-3 text-sm outline-none focus:border-primary" /></label></div><details className="rounded-2xl border border-border bg-card px-4 py-3"><summary className="cursor-pointer text-sm font-semibold">Raw capture</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{draft.rawText || draft.details}</p></details><div className="grid grid-cols-2 gap-3"><label><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Due</span><input type="date" value={draft.due} onChange={(event) => setDraft({ ...draft, due: event.target.value })} data-testid="input-review-due" className="h-11 w-full rounded-xl border border-input bg-card px-3.5 text-sm outline-none focus:border-primary" /></label><fieldset><legend className="mb-1.5 block text-xs font-semibold text-muted-foreground">Priority</legend><div className="grid grid-cols-3 overflow-hidden rounded-xl border border-input bg-card p-1">{(['low', 'medium', 'high'] as const).map((option) => <button key={option} type="button" onClick={() => setDraft({ ...draft, priority: option })} className={`min-h-9 rounded-lg px-1 text-[11px] font-semibold capitalize ${draft.priority === option ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`}>{option}</button>)}</div></fieldset></div>{draft.processingTimeMs && <p className="text-xs text-muted-foreground">Processed on-device in {(draft.processingTimeMs / 1000).toFixed(1)}s</p>}<div className="flex flex-col gap-2 pt-2 sm:flex-row"><button type="submit" disabled={saved} data-testid="button-review-save" className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground">{saved ? <Check size={17} /> : <Save size={17} />}{saved ? 'Saved' : 'Save task'}</button><button type="button" onClick={discard} data-testid="button-review-discard" className="h-12 rounded-xl border border-border px-5 text-sm font-semibold text-muted-foreground hover:bg-muted">Discard</button></div></form>}</section>;
}

function SettingsPage() {
  const { theme, setTheme } = useLens();
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof getSettings>> | null>(null);
  const [progress, setProgress] = useState({ llm: 0, speech: 0, ocr: 0, combined: 0, label: 'Waiting for setup' });
  const [online, setOnline] = useState(() => navigator.onLine);
  const [storage, setStorage] = useState({ usage: 0, quota: 0 });
  const [selfTest, setSelfTest] = useState('');
  const { tasks } = useLens();
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    void getSettings().then((value) => {
      setSettings(value);
      setProgress({ ...value.setup_progress, combined: Math.round((value.setup_progress.llm + value.setup_progress.speech + value.setup_progress.ocr) / 3), label: value.models_ready ? 'Ready for offline processing' : 'Waiting for setup' });
      if (!value.persistent_storage_requested) void requestPersistentStorage();
    });
    void getStorageEstimate().then(setStorage);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const setup = async () => {
    const next = await ensureModelsLoaded(setProgress);
    setSettings(next);
    void getStorageEstimate().then(setStorage);
  };
  const runSelfTest = async () => {
    const startedAt = performance.now();
    const result = await extractTasks('Submit the project notes tomorrow, it is urgent.');
    setSelfTest(`${result[0]?.title ?? 'No proposal'} · ${(performance.now() - startedAt).toFixed(0)}ms`);
  };
  const clear = () => { if (window.confirm('Remove all locally saved tasks and capture history?')) void clearAllData().then(() => window.location.reload()); };
  const storageLabel = storage.quota ? `${(storage.usage / 1024 / 1024).toFixed(1)} MB of ${(storage.quota / 1024 / 1024).toFixed(0)} MB` : 'Storage estimate unavailable';
  return <section data-testid="page-settings"><Header eyebrow="Control room" title="Quiet settings." subtitle="TaskLens is yours. Keep it local, choose your look, and check what is ready." /><div className="space-y-4">
    <div className="rounded-[24px] border border-border bg-card p-5 md:p-6" data-testid="card-offline-status"><div className="flex items-start gap-4"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${online ? 'bg-accent text-primary' : 'bg-primary/15 text-primary'}`}>{online ? <WifiOff size={20} /> : <WifiOff size={20} />}</div><div className="flex-1"><div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Device status</h2><span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-semibold text-accent-foreground">{online ? 'Connected' : 'Airplane mode'}</span></div><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{online ? 'Everything you create is still processed and stored on this device.' : 'No connection needed. TaskLens continues to work normally.'}</p></div></div></div>
    <div className="rounded-[24px] border border-border bg-card p-5 md:p-6" data-testid="card-model-setup"><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Headphones size={17} className="text-primary" /><h2 className="font-semibold">On-device AI</h2></div><p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">One-time offline setup, not a per-use cloud call. Model files stay in this browser.</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${settings?.models_ready ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>{settings?.models_ready ? 'Airplane-mode ready' : 'Setting up'}</span></div><div className="mt-5 space-y-3">{[['LLM', progress.llm], ['Speech model', progress.speech], ['OCR data', progress.ocr]].map(([label, value]) => <div key={label as string}><div className="mb-1 flex justify-between text-[11px] text-muted-foreground"><span>{label}</span><span>{value}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${value}%` }} /></div></div>)}</div><div className="mt-4 flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>{progress.label} · {settings?.inference_backend ?? 'fallback'}</span><button type="button" onClick={() => void setup()} disabled={progress.combined > 0 && progress.combined < 100} data-testid="button-setup-model" className="rounded-xl bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-50">{settings?.models_ready ? 'Models ready' : 'Download on-device AI (~2 GB, one-time)'}</button></div></div>
    <div className="rounded-[24px] border border-border bg-card p-5 md:p-6"><div className="flex items-center gap-2"><Zap size={17} className="text-primary" /><h2 className="font-semibold">Inference model</h2></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Language model</span><select value={settings?.selected_llm ?? LLM_MODELS[0]} onChange={(event) => { const selected_llm = event.target.value; setSettings((current) => current ? { ...current, selected_llm } : current); void updateSettings({ selected_llm }); }} className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm">{LLM_MODELS.map((model) => <option key={model}>{model}</option>)}</select></label><div className="text-sm"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Backend</span><div className="flex h-11 items-center rounded-xl border border-input bg-background px-3.5">{settings?.inference_backend ?? 'fallback'}</div></div></div></div>
    <div className="rounded-[24px] border border-border bg-card p-5 md:p-6"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Self-test</h2><p className="mt-1.5 text-sm text-muted-foreground">Run a canned sentence through the local extraction path.</p></div><button type="button" onClick={() => void runSelfTest()} className="rounded-xl border border-border px-3.5 py-2 text-xs font-semibold">Run self-test</button></div>{selfTest && <p className="mt-3 rounded-xl bg-muted p-3 text-xs text-muted-foreground">{selfTest}</p>}<p className="mt-3 text-xs text-muted-foreground">Storage used: {storageLabel}</p></div>
    <div className="rounded-[24px] border border-border bg-card p-5 md:p-6"><div className="flex items-center gap-2"><Sun size={17} className="text-primary" /><h2 className="font-semibold">Appearance</h2></div><p className="mt-1.5 text-sm text-muted-foreground">Choose the view that feels easiest on your eyes.</p><div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-muted p-1"><button type="button" onClick={() => setTheme('light')} data-testid="button-theme-light" className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold ${theme === 'light' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}><Sun size={16} />Light</button><button type="button" onClick={() => setTheme('dark')} data-testid="button-theme-dark" className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold ${theme === 'dark' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}><Moon size={16} />Dark</button></div></div>
    <div className="rounded-[24px] border border-destructive/25 bg-card p-5 md:p-6"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">Local data</h2><p className="mt-1.5 text-sm text-muted-foreground">{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} stored on this device.</p></div><button type="button" onClick={clear} data-testid="button-clear-data" className="rounded-xl border border-destructive/30 px-3.5 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10">Clear tasks</button></div></div>
  </div></section>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch><Route path="/" component={DashboardPage} /><Route path="/voice"><CapturePage mode="voice" /></Route><Route path="/camera"><CapturePage mode="camera" /></Route><Route path="/review" component={ReviewPage} /><Route path="/settings" component={SettingsPage} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><LensProvider><Router /></LensProvider></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;