import { z } from 'zod';

// The webview CSP forbids eval. Zod's JIT compiler probes `new Function` when a schema is *constructed*, so this
// must run before any schema module is evaluated: main.tsx imports this file first.
z.config({ jitless: true });
