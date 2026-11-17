import { Buffer } from 'buffer'

// src/main calls the global Buffer (ids.ts), which browsers lack.
;(globalThis as { Buffer?: unknown }).Buffer ??= Buffer
