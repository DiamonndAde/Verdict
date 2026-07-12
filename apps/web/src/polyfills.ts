// Must be imported BEFORE any Solana/Anchor code. ES module imports are evaluated
// depth-first in order, so this file's side effect runs before later imports' module
// bodies — which reference `Buffer` at module scope (e.g. Buffer.from seeds).
import { Buffer } from "buffer";

const g = globalThis as unknown as { Buffer?: typeof Buffer; global?: unknown };
g.Buffer = g.Buffer ?? Buffer;
g.global = g.global ?? globalThis;
