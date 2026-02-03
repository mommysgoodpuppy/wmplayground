import { WASI, MemFS, init } from "@wasmer/wasi";
import { Buffer } from "buffer";

const API_WASM_URL = "/api.gr.wasm";

let wasiInitPromise: Promise<void> | null = null;
let wasmModulePromise: Promise<WebAssembly.Module> | null = null;

function ensureWasiInit(): Promise<void> {
  if (!wasiInitPromise) {
    // @wasmer/wasi requires init in browser environments.
    wasiInitPromise = init();
  }
  return wasiInitPromise;
}

function getWasmModule(): Promise<WebAssembly.Module> {
  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      const res = await fetch(API_WASM_URL);
      if (!res.ok) {
        throw new Error(`Failed to load compiler wasm: ${res.status}`);
      }
      const bytes = await res.arrayBuffer();
      return await WebAssembly.compile(bytes);
    })();
  }
  return wasmModulePromise;
}

export type Stage = 'parse' | 'lower' | 'infer' | 'all';

export interface CompileRequest {
  source: string;
  stage?: Stage;
}

export interface ASTNode {
  id: number;
  kind: string;
  span: { start: number; end: number };
  preview?: string;
  children: Array<{ field: string; id: number }>;
}

export interface NodeStore {
  roots: number[];
  nodes: { [id: number]: ASTNode };
}

export interface CompilationResult {
  success: boolean;
  tokens?: any[];
  surfaceNodeStore?: {
    roots: number[];
    nodes: { [id: number]: any };
  };
  loweredNodeStore?: {
    roots: number[];
    nodes: { [id: number]: any };
  };
  error?: string;
}

export async function compileWorkman(
  source: string,
  stage: string = 'all'
): Promise<CompilationResult> {
  // Stage is currently ignored by the browser runner but preserved for API parity.
  void stage;

  globalThis.Buffer = Buffer;
  await ensureWasiInit();

  const wasmModule = await getWasmModule();
  const memfs = new MemFS();
  const inputPath = "/input.wm";
  const file = memfs.open(inputPath, { read: true, write: true, create: true });
  file.writeString(source);
  file.seek(0);

  const wasi = new WASI({
    args: ["api.gr.wasm", inputPath],
    env: {},
    fs: memfs,
  });

  try {
    const instance = await wasi.instantiate(wasmModule, {});
    wasi.start(instance as WebAssembly.Instance);
  } catch (err) {
    const wasiStderr = typeof (wasi as typeof WASI & {
      getStderrString?: () => string;
    }).getStderrString === "function"
      ? (wasi as typeof WASI & { getStderrString: () => string })
          .getStderrString()
      : "";
    const stderr = wasiStderr;
    return {
      success: false,
      error: stderr || (err instanceof Error ? err.message : String(err)),
    };
  }

  try {
    const wasiStdout = typeof (wasi as typeof WASI & {
      getStdoutString?: () => string;
    }).getStdoutString === "function"
      ? (wasi as typeof WASI & { getStdoutString: () => string })
          .getStdoutString()
      : "";
    const wasiStderr = typeof (wasi as typeof WASI & {
      getStderrString?: () => string;
    }).getStderrString === "function"
      ? (wasi as typeof WASI & { getStderrString: () => string })
          .getStderrString()
      : "";
    const stdout = wasiStdout;
    const stderr = wasiStderr;
    const output = stdout.trim();
    if (!output) {
      return {
        success: false,
        error: stderr
          ? `Compiler produced no output. Stderr: ${stderr}`
          : "Compiler produced no output.",
      };
    }
    const data = JSON.parse(output);
    return { success: true, ...(data ?? {}) } as CompilationResult;
  } catch (e) {
    const wasiStdout = typeof (wasi as typeof WASI & {
      getStdoutString?: () => string;
    }).getStdoutString === "function"
      ? (wasi as typeof WASI & { getStdoutString: () => string })
          .getStdoutString()
      : "";
    const wasiStderr = typeof (wasi as typeof WASI & {
      getStderrString?: () => string;
    }).getStderrString === "function"
      ? (wasi as typeof WASI & { getStderrString: () => string })
          .getStderrString()
      : "";
    const stdout = wasiStdout;
    const stderr = wasiStderr;
    console.error("[API] Failed to parse JSON:", e);
    console.error("[API] Output:", stdout.substring(0, 500));
    if (stderr) {
      console.error("[API] Stderr:", stderr.substring(0, 500));
    }
    
    // Extract position from error message
    const posMatch = e instanceof Error ? e.message.match(/position (\d+)/) : null;
    let errorContext = "";
    if (posMatch) {
      const pos = parseInt(posMatch[1]);
      const start = Math.max(0, pos - 50);
      const end = Math.min(stdout.length, pos + 50);
      const before = stdout.substring(start, pos);
      const at = stdout.charAt(pos);
      const after = stdout.substring(pos + 1, end);
      errorContext = `\n\nAt position ${pos}:\n...${before}[HERE→'${at}']${after}...`;
    }
    
    return {
      success: false,
      error:
        `Failed to parse JSON: ${
          e instanceof Error ? e.message : String(e)
        }\nOutput: ${stdout.substring(0, 200)}${errorContext}`,
    };
  }
}

export async function checkHealth(): Promise<{ status: string }> {
  return { status: "ok" };
}
