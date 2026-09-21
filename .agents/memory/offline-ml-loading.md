---
name: Offline ML loading
description: Durable guidance for browser-only on-device inference in TaskLens.
---

Heavy browser ML dependencies should be loaded lazily and isolated in workers; core task capture must still have a deterministic local fallback when a model is unavailable or not cached.

**Why:** Mobile browsers can run out of memory or lose connectivity while model assets are loading, and a blank or blocked capture flow breaks the product's primary promise.

**How to apply:** Keep model imports out of the first paint, report every loading stage in the UI, reuse initialized workers, and route parse/model failures through the rule-based extractor.