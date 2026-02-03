const API_BASE = 'http://localhost:3001/api';

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
  const response = await fetch(`${API_BASE}/compile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ source, stage }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  try {
    const data = await response.json();
    if (data && typeof data === "object" && "success" in data) {
      if (data.success) {
        return { success: true, ...(data.data ?? {}) } as CompilationResult;
      }
      return { success: false, error: data.error ?? "Compilation failed" };
    }
    return { success: false, error: "Invalid response from compiler" };
  } catch (e) {
    const stdout = await response.text();
    console.error("[API] Failed to parse JSON:", e);
    console.error("[API] Output:", stdout.substring(0, 500));
    
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
    
    throw new Error(
      `Failed to parse JSON: ${e instanceof Error ? e.message : String(e)}\nOutput: ${stdout.substring(0, 200)}${errorContext}`,
    );
  }
}

export async function checkHealth(): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE}/health`);
  return await response.json();
}
