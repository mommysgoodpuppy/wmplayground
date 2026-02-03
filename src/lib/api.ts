import { WASI, MemFS, init } from "@wasmer/wasi";
import { Buffer } from "buffer";

const API_WASM_URL = "/api.gr.wasm";
const API_BASE = "http://localhost:3001/api";
const USE_CLI_SERVER = import.meta.env.VITE_USE_CLI_SERVER === "1";

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
  if (USE_CLI_SERVER) {
    return await compileWorkmanServer(source, stage);
  }

  // Stage is currently ignored by the browser runner but preserved for API parity.
  void stage;

  (globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer = Buffer;
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
    const wasiStderr =
      typeof (wasi as WASI & { getStderrString?: () => string })
        .getStderrString === "function"
        ? (wasi as WASI & { getStderrString: () => string }).getStderrString()
        : "";
    const stderr = wasiStderr;
    return {
      success: false,
      error: stderr || (err instanceof Error ? err.message : String(err)),
    };
  }

  try {
    const wasiStdout =
      typeof (wasi as WASI & { getStdoutString?: () => string })
        .getStdoutString === "function"
        ? (wasi as WASI & { getStdoutString: () => string }).getStdoutString()
        : "";
    const wasiStderr =
      typeof (wasi as WASI & { getStderrString?: () => string })
        .getStderrString === "function"
        ? (wasi as WASI & { getStderrString: () => string }).getStderrString()
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
    const wasiStdout =
      typeof (wasi as WASI & { getStdoutString?: () => string })
        .getStdoutString === "function"
        ? (wasi as WASI & { getStdoutString: () => string }).getStdoutString()
        : "";
    const wasiStderr =
      typeof (wasi as WASI & { getStderrString?: () => string })
        .getStderrString === "function"
        ? (wasi as WASI & { getStderrString: () => string }).getStderrString()
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
  if (USE_CLI_SERVER) {
    const response = await fetch(`${API_BASE}/health`);
    return await response.json();
  }
  return { status: "ok" };
}

export async function checkCliHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const start = performance.now();
  try {
    const response = await fetch(`${API_BASE}/health`, {
      cache: "no-store",
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!response.ok) {
      return {
        ok: false,
        latencyMs,
        error: `HTTP ${response.status}`,
      };
    }
    const data = await response.json().catch(() => null);
    const ok = data && typeof data === "object" && data.status === "ok";
    return {
      ok,
      latencyMs,
      error: ok ? undefined : "Bad response",
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function compileWorkmanServer(
  source: string,
  stage: string = "all",
): Promise<CompilationResult> {
  const response = await fetch(`${API_BASE}/compile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source, stage }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  try {
    const data = await response.json();
    if (data && typeof data === "object") {
      if ("success" in data) {
        if (data.success) {
          return { success: true, ...(data.data ?? {}) } as CompilationResult;
        }
        return { success: false, error: data.error ?? "Compilation failed" };
      }
      // Accept raw compiler output (tokens/surface/lowered) from api.gr
      return { success: true, ...(data ?? {}) } as CompilationResult;
    }
    return { success: false, error: "Invalid response from compiler" };
  } catch (e) {
    const stdout = await response.text();
    console.error("[API] Failed to parse JSON:", e);
    console.error("[API] Output:", stdout.substring(0, 500));

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
