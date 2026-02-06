import {
  WASI,
  File,
  OpenFile,
  PreopenDirectory,
  ConsoleStdout,
  type Fd,
  type Inode,
} from "@bjorn3/browser_wasi_shim";

const API_WASM_URL = "/api.gr.wasm";
const WMC_WASM_URL = "/wmc_api.gr.wasm";
const API_BASE = "http://localhost:3001/api";
const USE_CLI_SERVER = import.meta.env.VITE_USE_CLI_SERVER === "1";

let wasmModulePromise: Promise<WebAssembly.Module> | null = null;
let wmcModulePromise: Promise<WebAssembly.Module> | null = null;

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

function getWmcModule(): Promise<WebAssembly.Module> {
  if (!wmcModulePromise) {
    wmcModulePromise = (async () => {
      const res = await fetch(WMC_WASM_URL);
      if (!res.ok) {
        throw new Error(`Failed to load WMC wasm: ${res.status}`);
      }
      const bytes = await res.arrayBuffer();
      return await WebAssembly.compile(bytes);
    })();
  }
  return wmcModulePromise;
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
  marks?: {
    topLevel?: Array<{
      kind: string;
      text: string;
      expected?: string;
      span: { line: number; col: number; start: number; end: number };
    }>;
    entries?: Array<{
      mark: {
        kind: string;
        text: string;
        expected?: string;
        span: { line: number; col: number; start: number; end: number };
      };
      diagnostic: {
        stage: string;
        message: string;
        span: { line: number; col: number; start: number; end: number };
        clues?: Array<{ kind: string; text: string }>;
      };
    }>;
    diagnostics?: Array<{
      stage: string;
      message: string;
      span: { line: number; col: number; start: number; end: number };
      clues?: Array<{ kind: string; text: string }>;
    }>;
  };
  recovery?: {
    topLevel?: Array<{
      kind: string;
      text: string;
      expected?: string;
      span: { line: number; col: number; start: number; end: number };
    }>;
    entries?: Array<{
      mark: {
        kind: string;
        text: string;
        expected?: string;
        span: { line: number; col: number; start: number; end: number };
      };
      diagnostic: {
        stage: string;
        message: string;
        span: { line: number; col: number; start: number; end: number };
        clues?: Array<{ kind: string; text: string }>;
      };
    }>;
    diagnostics?: Array<{
      stage: string;
      message: string;
      span: { line: number; col: number; start: number; end: number };
      clues?: Array<{ kind: string; text: string }>;
    }>;
  };
  formatted?: string;
  formattedTokens?: any[];
  formattedVirtual?: string;
  formattedVirtualTokens?: any[];
  formattedFix?: string;
  formattedFixTokens?: any[];
  formattedVirtualArtifacts?: Array<{
    kind: string;
    text: string;
    start: number;
    end: number;
    reason: string;
  }>;
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

  const wasmModule = await getWasmModule();

  // Set up virtual filesystem with the input file
  const inputFile = new File(new TextEncoder().encode(source));
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];

  const fds: Fd[] = [
    new OpenFile(new File([])),                          // 0: stdin
    new ConsoleStdout((buf) => stdoutChunks.push(new Uint8Array(buf))),  // 1: stdout
    new ConsoleStdout((buf) => stderrChunks.push(new Uint8Array(buf))),  // 2: stderr
    new PreopenDirectory(".", new Map<string, Inode>([
      ["input.wm", inputFile],
    ])),                                                  // 3: preopened cwd
  ];

  const wasi = new WASI(
    ["api.gr.wasm", "input.wm"],
    [],
    fds,
  );

  const dec = new TextDecoder();
  const collectOutput = (chunks: Uint8Array[]) =>
    chunks.map((c) => dec.decode(c, { stream: true })).join("");

  try {
    const instance = await WebAssembly.instantiate(wasmModule, {
      wasi_snapshot_preview1: wasi.wasiImport,
    });
    wasi.start(instance as unknown as { exports: { memory: WebAssembly.Memory; _start: () => unknown } });
  } catch (err) {
    const stderr = collectOutput(stderrChunks);
    return {
      success: false,
      error: stderr || (err instanceof Error ? err.message : String(err)),
    };
  }

  const stdout = collectOutput(stdoutChunks);
  const stderr = collectOutput(stderrChunks);

  try {
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

export interface WmcResult {
  success: boolean;
  zigSource?: string;
  error?: string;
}

export async function compileWmc(source: string): Promise<WmcResult> {
  const wasmModule = await getWmcModule();

  const inputFile = new File(new TextEncoder().encode(source));
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];

  const fds: Fd[] = [
    new OpenFile(new File([])),
    new ConsoleStdout((buf) => stdoutChunks.push(new Uint8Array(buf))),
    new ConsoleStdout((buf) => stderrChunks.push(new Uint8Array(buf))),
    new PreopenDirectory(".", new Map<string, Inode>([
      ["input.wm", inputFile],
    ])),
  ];

  const wasi = new WASI(
    ["wmc_api.gr.wasm", "input.wm"],
    [],
    fds,
  );

  const dec = new TextDecoder();
  const collectOutput = (chunks: Uint8Array[]) =>
    chunks.map((c) => dec.decode(c, { stream: true })).join("");

  try {
    const instance = await WebAssembly.instantiate(wasmModule, {
      wasi_snapshot_preview1: wasi.wasiImport,
    });
    wasi.start(instance as unknown as { exports: { memory: WebAssembly.Memory; _start: () => unknown } });
  } catch (err) {
    const stderr = collectOutput(stderrChunks);
    return {
      success: false,
      error: stderr || (err instanceof Error ? err.message : String(err)),
    };
  }

  const stdout = collectOutput(stdoutChunks);

  try {
    const data = JSON.parse(stdout.trim());
    return data as WmcResult;
  } catch (e) {
    return {
      success: false,
      error: `Failed to parse WMC output: ${e instanceof Error ? e.message : String(e)}\nOutput: ${stdout.substring(0, 200)}`,
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
