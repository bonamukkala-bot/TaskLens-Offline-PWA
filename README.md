# TaskLens — Offline AI Capture & Task Assistant

**iQOO Hackathon 2026 · City Battle, Hyderabad · Sept 26–27, 2026**
Track: Productivity · Built by Bonamukkala Charan Reddy

Speak a thought, or point your camera at a whiteboard or handwritten note — TaskLens turns it into a structured, prioritised task list, entirely on-device, with **zero internet connection required**.

---

## Table of Contents

- [Problem](#problem)
- [What TaskLens Does](#what-tasklens-does)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Data Model](#data-model)
- [MVP Scope](#mvp-scope)
- [Screens & Flows](#screens--flows)
- [Task Extraction Contract](#task-extraction-contract)
- [Reminders — Design Philosophy](#reminders--design-philosophy)
- [Getting Started](#getting-started)
- [Deploy](#deploy)
- [Testing Offline (Airplane Mode)](#testing-offline-airplane-mode)
- [Risk Register](#risk-register)
- [Roadmap](#roadmap)

---

## Problem

Knowledge workers, students and freelancers lose real time turning unstructured input — spoken reminders, meeting chatter, whiteboard sketches, handwritten to-do lists — into something actionable. Existing tools (Notion AI, Todoist, Otter.ai) are cloud-dependent: they need a live connection and send voice/photo data to a third-party server, which makes them unreliable exactly when capture matters most — in a classroom with patchy wifi, on a client site, on a factory floor, on a train.

## What TaskLens Does

1. **Voice capture** — record a spoken reminder → on-device transcription → on-device LLM extracts structured tasks.
2. **Camera capture** — photograph a whiteboard, printed note, or handwritten list → on-device OCR → same LLM extraction pipeline.
3. **Task dashboard** — a fast, offline-first mobile UI to review, edit, complete, filter and manage the resulting tasks, grouped by Overdue / Today / Tomorrow / This week / Later.
4. **Due-date and due-time awareness** — tasks can carry an optional specific time, not just a date, and the dashboard surfaces what's overdue or due today the instant the app is opened.
5. **100% on-device** — no audio, photo, or extracted text ever leaves the device. No account, no login, no cloud sync.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| UI framework | React + Vite + TypeScript | Fast HMR, familiar stack, lean build |
| Styling | Tailwind CSS | Fast mobile-first layout, no custom CSS overhead |
| PWA | vite-plugin-pwa (Workbox) | Service worker + manifest → installable, offline app-shell caching |
| On-device LLM | [WebLLM](https://github.com/mlc-ai/web-llm) (MLC-LLM), running `gemma-2-2b-it-q4f16_1-MLC` by default, with `Phi-3-mini-4k-instruct-q4f16_1-MLC` and `Llama-3.2-1B-Instruct-q4f16_1-MLC` as alternatives | Runs fully in-browser via WebGPU; no server round-trip |
| On-device speech-to-text | [transformers.js](https://github.com/xenova/transformers.js) running Whisper-tiny (quantised, ONNX) | WASM/WebGPU backend, cached after first load |
| On-device OCR | [Tesseract.js](https://github.com/naptha/tesseract.js) | Mature, WASM, no server round-trip |
| Local storage | IndexedDB via [Dexie.js](https://dexie.org/) | Structured, queryable, offline-durable task store |
| Reminders | Browser `Notification` API + Badging API (`navigator.setAppBadge`) | On-open due-date checks and an offline-capable home-screen badge — no server involved |
| Optional bridge demo | iQOO Office Kit | Screen-mirror phone → laptop for the Green Light demo |
| Optional stretch backend | FastAPI + Twilio WhatsApp API | Only for opt-in high-priority WhatsApp nudges; never on the critical path |

**No required backend.** The core loop (capture → transcribe/OCR → extract → store → display → remind) runs entirely in the browser.

---

## Architecture

```
Browser UI (React + Vite + Tailwind)
        │
        ▼
Capture Layer
  ├─ audio-capture.ts   (mic, live waveform via AnalyserNode)
  └─ camera-capture.ts  (camera viewfinder, downscale/greyscale/contrast)
        │
        ▼
On-Device Model Layer  (runs in Web Workers to keep UI at 60fps)
  ├─ stt.ts             → transformers.js / Whisper-tiny
  ├─ ocr.ts              → Tesseract.js
  └─ task-extractor.ts  → WebLLM (Gemma-2B / Phi-3-mini / Llama-3.2-1B)
        │  (strict JSON contract, validated; rule-based fallback if the
        │   LLM output is invalid or unavailable — the flow never dead-ends)
        ▼
db.ts → Dexie.js → IndexedDB
        │
        ▼
reminders.ts → classifyTasks(tasks, now) → Overdue / Due today / Due soon
        │
        ▼
UI re-render (Home dashboard banner, Review/Edit screen, Settings)
```

**No network hop anywhere in that chain.** The only network call anywhere in the product is the optional, opt-in WhatsApp reminder stretch feature.

Supporting modules:

| Module | Responsibility |
|---|---|
| `model-manager.ts` | Detects `navigator.gpu`, downloads/caches all three models with progress reporting, verifies offline-readiness, exposes WebGPU-vs-fallback backend status |
| `db.ts` | Dexie wrapper — `saveTask`, `listTasks`, `updateTask`, `deleteTask`, `saveCaptureSession`, settings read/write |
| `reminders.ts` | Pure `classifyTasks(tasks, now)` function — compares each task's due date/time against the current moment; drives the Home banner, section grouping, and Notification text |

---

## Data Model

**`tasks`**

| Field | Type | Description |
|---|---|---|
| `id` | string (uuid), PK | Unique task identifier |
| `title` | string | Task text, LLM-extracted or user-edited |
| `due_date` | string (ISO date, optionally with time) \| null | Optional deadline. Tasks may be "all-day" (date only) or carry a specific time (e.g. `2026-09-22T18:00`) |
| `priority` | enum: `low` \| `medium` \| `high` | Set by the LLM, editable by the user |
| `source_type` | enum: `voice` \| `camera` \| `manual` | Drives the mic/camera/pencil icon on the card |
| `source_session_id` | string (FK) \| null | Links back to the raw capture for debugging/demo |
| `completed` | boolean | Default `false` |
| `created_at` / `updated_at` | timestamp | Sorting and edit tracking |

**`capture_sessions`**

| Field | Type | Description |
|---|---|---|
| `id` | string (uuid), PK | Unique capture identifier |
| `type` | enum: `voice` \| `camera` | Which flow produced this capture |
| `raw_text` | string | Whisper transcript or Tesseract OCR output |
| `model_used` | string | e.g. `gemma-2-2b-it-q4f16_1-MLC` |
| `processing_time_ms` | integer | On-device processing time, shown in the UI |
| `created_at` | timestamp | — |

**`settings`** (single row) — `models_ready`, `model_versions`, `inference_backend` (`webgpu` \| `fallback`), `selected_llm`, `due_date_alerts_enabled`, `last_reminder_check_at`.

Relationship: one `capture_session` → many `tasks` (a single photo or voice note can contain several to-dos). No user table, no auth — intentionally out of MVP scope. All data belongs to whoever holds the device.

---

## MVP Scope

**In scope**
- Flow 1 — Voice capture → on-device STT → on-device LLM extraction → task list.
- Flow 2 — Camera capture → on-device OCR → same LLM extraction → task list.
- Task dashboard: list, complete, edit, delete, filter by priority/date, grouped by Overdue/Today/Tomorrow/Later.
- Due-date and optional due-time on every task, editable on the Review screen.
- On-open reminder check: Overdue/Due-today banner and (with permission) a browser Notification, computed entirely from on-device data.
- Fully offline after first load: installable PWA, models cached locally, IndexedDB storage.
- Visible "model thinking on-device" processing states, proving nothing round-trips to a server.

**In scope — stretch (after MVP is solid)**
- Offline home-screen app badge (Badging API) showing overdue/due-today count without opening the app.
- iQOO Office Kit–bridged laptop dashboard mirror for the Green Light demo.
- WhatsApp reminder nudge for high-priority tasks (reuses an existing Twilio integration) — the one explicitly optional/online-only step.

**Out of scope (deferred)**
- Multi-user accounts, login, cloud sync/backup.
- Automatic Google Calendar account sync (would require OAuth + a backend, breaking the on-device privacy guarantee). A one-tap "add to calendar" hand-off (`.ics` export) remains a candidate lightweight addition, since it needs no login and no network call.
- Team/shared task lists.
- Native Android/iOS packaging beyond an installable PWA.
- Custom OCR model training beyond what Tesseract.js delivers out of the box.
- A guaranteed background push notification system — deliberately not built; see [Reminders — Design Philosophy](#reminders--design-philosophy).

---

## Screens & Flows

Five screens, kept deliberately minimal for a solo build and a sub-minute pitch:

1. **Home / Task Dashboard** — task list grouped by Overdue/Today/Tomorrow/This week/Later/Completed, reminder banner, floating capture button; where the demo starts and ends.
2. **Voice Capture** — record → live waveform → on-device transcribe → review extracted task(s).
3. **Camera Capture** — point at a note/whiteboard → on-device OCR → review extracted task(s).
4. **Task Detail / Edit** — confirm or correct title, due date, due time, and priority before saving. AI output is always a proposal, never auto-saved.
5. **Model Status / Settings** — download progress, offline-ready badge, active inference backend, storage usage, self-test, due-date alert toggle, app-badge status.

**Voice flow:** tap capture → choose Voice → record with live waveform → "Transcribing (on-device)…" → "Understanding (on-device)…" → editable Review screen → Save → task appears on Home.

**Camera flow:** tap capture → choose Camera → shutter → pre-process (crop/contrast) → "Reading (on-device)…" → "Understanding (on-device)…" → editable Review screen (supports multiple task cards from one photo) → Save.

**Edge cases handled:** no speech detected, mic/camera permission denied, blurry/near-empty OCR text (prompts a retake instead of extracting from nothing), malformed LLM JSON (silent fallback to a usable raw-text task).

---

## Task Extraction Contract

Input: raw transcript or OCR text.
Output: strict JSON array of `{ title: string, due_date: string | null, due_time: string | null, priority: "low" | "medium" | "high" }`.

- The system prompt instructs the model to resolve relative dates ("tomorrow", "next Friday") and explicit times ("at 6pm") against the real current date, and to map words like *urgent / asap / important* to `high` priority. Vague time references ("before lunch") are deliberately left as all-day, not guessed.
- The response is stripped of markdown fences, `JSON.parse`d, then validated field-by-field.
- If parsing or validation fails, or the LLM is unavailable (no WebGPU / model not loaded), a **deterministic rule-based extractor** takes over — the flow never dead-ends and never crashes.
- The user always sees an editable confirmation step before anything is saved. The model proposes; it never silently commits.

---

## Reminders — Design Philosophy

TaskLens is deliberately honest about a real constraint of the open web: **a browser tab cannot wake itself from a fully closed state at an exact scheduled time without a server.** Building a "reminds you even when closed" feature the normal way (Web Push) would mean adding a backend and an account system — which breaks the product's core claim that nothing ever leaves the device.

Instead of faking that guarantee, TaskLens ships three layers that are all genuinely offline and honestly scoped:

1. **On-open check (the primary mechanism).** The instant the app is opened or brought to the foreground, it compares every task's due date/time against now and surfaces an Overdue/Due-today banner, plus a browser Notification if permission is granted. This is instant, accurate to the minute, and needs no network.
2. **Home-screen app badge.** Once installed, the app icon can show a live count of overdue/due-today tasks via the Badging API — a glanceable signal that persists on the icon while the app is closed, computed entirely from on-device data.
3. **Calendar hand-off (optional, not yet built).** For anything that truly needs an OS-level alarm while the app is fully closed, the plan is a one-tap "Add to Calendar" export (`.ics` file) that lets the phone's native calendar app — which already has a reliable background alarm system — own that reminder instead of TaskLens trying to reinvent it.

This trade-off is presented as a deliberate design decision, not a limitation to hide.

---

## Getting Started

```bash
git clone https://github.com/bonamukkala-bot/TaskLens-Offline-PWA.git
cd TaskLens-Offline-PWA/artifacts/tasklens
npm install
npm run dev
```

Open the printed local URL in **Chrome on Android** for full functionality (WebGPU + microphone + camera + Notifications). Desktop Chrome works for UI development but is not the target demo device.

```bash
npm run build      # production build → dist/
npm run preview    # serve the production build locally
npm run typecheck  # TypeScript check
```

---

## Deploy

**Live app:** https://tasklens-wheat.vercel.app/

Deployed on Vercel from this repository.

- **Framework Preset:** Vite
- **Root Directory:** `artifacts/tasklens`
- **Install Command:** `npm install` *(explicitly overridden — do not let Vercel auto-detect pnpm)*
- **Build Command:** `npm run build`
- **Output Directory:** `dist`

`vercel.json` handles SPA routing (all non-file routes rewrite to `index.html`) and sets no-cache headers on the service worker and manifest so PWA updates are picked up correctly.

---

## Testing Offline (Airplane Mode)

This is the single test that matters most for the demo:

1. Open the deployed URL **directly in Chrome on Android** (not an embedded in-app browser).
2. Go to **Settings** → tap **Download on-device AI** on good wifi, and wait for all models to finish (~2 GB, one-time).
3. Confirm the **inference backend** shows `webgpu`.
4. Turn on **Due-date alerts** in Settings and grant Notification permission.
5. **Add to Home Screen** to install as a PWA (required for the app badge to work).
6. Turn on **Airplane Mode**.
7. Reopen the installed app and run:
   - one voice capture end-to-end,
   - one camera capture end-to-end,
   - add a task with a due date/time a few minutes in the past, close and reopen the app, and confirm the Overdue banner and notification are accurate.
8. Confirm all of the above work with no network activity.

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| WebGPU unsupported/disabled on the event device | Blocks the whole on-device LLM story | Verify on the actual device early; fallback runtime path for non-WebGPU devices |
| Model download too slow/large for venue wifi | No product without models loaded | Pre-download and cache models the moment the device is handed over, before the event start |
| OCR misreads messy handwriting | Degraded demo | Demo with a clearly printed/marker-written note, not an ambiguous handwriting stress-test |
| LLM returns malformed JSON / hallucinated date | Wrong task shown | Strict prompt contract + JSON validation + always-editable confirm step |
| Mic/camera permissions blocked in installed-PWA context | High if it happens live | Test the installed app specifically, not just the browser tab, well before the event |
| A judge asks "does it remind me if the app is closed?" | Could read as a gap if answered defensively | Answer directly with the design philosophy above — it's a deliberate trade-off in service of the privacy claim, not an oversight |
| Solo build runs out of time | High | MVP scope is deliberately two flows only; stretch items are cut first, never the core loop |

---

## Roadmap

- [x] Client-only PWA scaffold, Dexie schema, five-screen routing
- [x] Model manager + Settings screen with real progress and WebGPU detection
- [x] Voice capture with live waveform + on-device STT
- [x] Camera capture with pre-processing + on-device OCR
- [x] Task extractor with validation + rule-based fallback, Review screen
- [x] Home dashboard: list, complete, edit, delete, filters
- [x] Due-date-aware reminder banner (Overdue/Today grouping) + on-open Notification
- [x] Due-time field on tasks, time-aware reminder classification
- [ ] Offline home-screen app badge (Badging API) + best-effort Periodic Background Sync
- [ ] "Verify offline readiness" checklist tied to the offline-ready badge
- [ ] One-tap "Add to Calendar" (`.ics`) export for OS-level alarms
- [ ] Judge-visible "Under the hood" timing/network-proof panel
- [ ] Capture History screen and Demo Mode
- [ ] Undo, export/share
- [ ] Office Kit laptop-mirror polish, PWA install prompt, maskable icons

---

**Track:** Productivity · **Event:** iQOO Hackathon 2026, City Battle Hyderabad, Sept 26–27, 2026
**Builder:** Solo — Bonamukkala Charan Reddy
