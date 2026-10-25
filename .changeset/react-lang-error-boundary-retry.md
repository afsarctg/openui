---
"@openuidev/react-lang": patch
---

Stop retrying a broken component on every ancestor re-render. The per-element error boundary reset whenever its `children` changed, and those are a new element on every parent render, so a component that kept throwing was re-rendered (and threw again) each time anything above it re-rendered, without end when something kept re-rendering. It now retries only when the element it renders changes: new streamed props, or new store or query data. Recovery mid-stream works as before.
