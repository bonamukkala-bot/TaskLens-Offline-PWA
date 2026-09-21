# TaskLens

TaskLens is a client-only, offline-first PWA that turns spoken thoughts and photographed notes into structured tasks. Tasks, capture sessions, and settings are stored in IndexedDB with Dexie. No account, server, analytics, or API key is required.

## How to test on a phone

1. Open the deployed URL directly in Chrome on Android, not the preview pane.
2. Install TaskLens with **Add to Home screen**.
3. Open Settings and use **Download on-device AI (~2 GB, one-time)**.
4. Test voice capture and camera capture once while online so the browser can cache the app and model assets.
5. Turn on Airplane Mode and repeat the capture, review, save, edit, complete, and delete flows.

The app includes gallery and sample-capture fallbacks when browser permissions or device hardware are unavailable.