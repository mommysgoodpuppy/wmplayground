import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import "./App.css";
import { CodeEditor } from "./components/CodeEditor";
import { ASTTreeView } from "./components/ASTTreeView";
import { NodeInspector } from "./components/NodeInspector";
import { LexerView } from "./components/LexerView";
import { DocsViewer } from "./components/DocsViewer";
import { ZigSourceView } from "./components/ZigSourceView";
import { checkCliHealth, compileWmc, compileWorkman } from "./lib/api";
import { useTheme } from "./hooks/useTheme";
// @ts-ignore
import ZigCompilerWorker from "./workers/zig-compiler.ts?worker";
// @ts-ignore
import ZigRunnerWorker from "./workers/zig-runner.ts?worker";

const SunIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </svg>
);

const MoonIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);

interface CompilationResult {
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
  typeDebug?: {
    layer1?: {
      constraints?: Array<{
        kind: string;
        left?: string;
        right?: string;
        label?: string;
        origin?: { nodeId: number; description: string };
      }>;
      nodeTypes?: Array<{ id: number; type: string }>;
      marks?: Array<{
        reason: string;
        message: string;
        origin: { nodeId: number; description: string };
        related?: Array<{ nodeId: number; description: string }>;
        mark?: { kind: string; text?: string };
      }>;
    };
    layer2?: {
      constraints?: Array<{
        kind: string;
        left?: string;
        right?: string;
        label?: string;
        origin?: { nodeId: number; description: string };
      }>;
      nodeTypes?: Array<{ id: number; type: string }>;
      topBindings?: Array<{
        name: string;
        type: string;
        quantifiers?: number[];
      }>;
      marks?: Array<{
        reason: string;
        message: string;
        origin: { nodeId: number; description: string };
        related?: Array<{ nodeId: number; description: string }>;
        mark?: { kind: string; text?: string };
      }>;
    };
  };
  error?: string;
}

interface ErrorLocation {
  line: number;
  col: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeToken = (tok: any) => `${tok.kind}:${tok.text ?? ""}`;
const isIgnorableToken = (tok: any) =>
  tok.kind === "LineComment" || tok.kind === "EOF";
const isDepthSensitiveToken = (tok: any) =>
  tok.kind === "LParen" ||
  tok.kind === "RParen" ||
  tok.kind === "LBrace" ||
  tok.kind === "DotBrace" ||
  tok.kind === "RBrace" ||
  tok.kind === "LBracket" ||
  tok.kind === "RBracket" ||
  tok.kind === "Comma" ||
  tok.kind === "SemiColon";

const nextDepth = (tok: any, depth: { paren: number; brace: number; bracket: number }) => {
  switch (tok.kind) {
    case "LParen":
      return { ...depth, paren: depth.paren + 1 };
    case "RParen":
      return { ...depth, paren: Math.max(0, depth.paren - 1) };
    case "LBrace":
    case "DotBrace":
      return { ...depth, brace: depth.brace + 1 };
    case "RBrace":
      return { ...depth, brace: Math.max(0, depth.brace - 1) };
    case "LBracket":
      return { ...depth, bracket: depth.bracket + 1 };
    case "RBracket":
      return { ...depth, bracket: Math.max(0, depth.bracket - 1) };
    default:
      return depth;
  }
};

const computeInsertedSpans = (
  sourceTokens: any[] | undefined,
  formattedTokens: any[] | undefined,
  shouldHighlight: (tok: any) => boolean,
  className: string,
) => {
  const source = (sourceTokens ?? []).filter((t) => !isIgnorableToken(t));
  const formatted = (formattedTokens ?? []).filter((t) =>
    !isIgnorableToken(t)
  );
  const sourceProfiles = source.map((tok) => ({ tok, depth: { paren: 0, brace: 0, bracket: 0 } }));
  const formattedProfiles = formatted.map((tok) => ({ tok, depth: { paren: 0, brace: 0, bracket: 0 } }));
  let srcDepth = { paren: 0, brace: 0, bracket: 0 };
  for (let i = 0; i < sourceProfiles.length; i++) {
    sourceProfiles[i].depth = srcDepth;
    srcDepth = nextDepth(sourceProfiles[i].tok, srcDepth);
  }
  let fmtDepth = { paren: 0, brace: 0, bracket: 0 };
  for (let i = 0; i < formattedProfiles.length; i++) {
    formattedProfiles[i].depth = fmtDepth;
    fmtDepth = nextDepth(formattedProfiles[i].tok, fmtDepth);
  }

  const profileMatches = (a: { tok: any; depth: any }, b: { tok: any; depth: any }) => {
    if (normalizeToken(a.tok) !== normalizeToken(b.tok)) return false;
    if (!isDepthSensitiveToken(a.tok)) return true;
    return a.depth.paren === b.depth.paren &&
      a.depth.brace === b.depth.brace &&
      a.depth.bracket === b.depth.bracket;
  };

  const n = sourceProfiles.length;
  const m = formattedProfiles.length;
  const cols = m + 1;
  const dp = new Array((n + 1) * (m + 1)).fill(0);
  const idx = (ii: number, jj: number) => ii * cols + jj;
  for (let ii = n - 1; ii >= 0; ii--) {
    for (let jj = m - 1; jj >= 0; jj--) {
      if (profileMatches(sourceProfiles[ii], formattedProfiles[jj])) {
        dp[idx(ii, jj)] = 1 + dp[idx(ii + 1, jj + 1)];
      } else {
        dp[idx(ii, jj)] = Math.max(dp[idx(ii + 1, jj)], dp[idx(ii, jj + 1)]);
      }
    }
  }

  let i = 0;
  let j = 0;
  const spans: Array<{ start: number; end: number; className: string }> = [];
  while (i < n && j < m) {
    if (profileMatches(sourceProfiles[i], formattedProfiles[j])) {
      i++;
      j++;
      continue;
    }
    const dropSource = dp[idx(i + 1, j)];
    const dropFormatted = dp[idx(i, j + 1)];
    if (dropSource >= dropFormatted) {
      i++;
    } else {
      const f = formattedProfiles[j].tok;
      if (shouldHighlight(f) && f.span) {
        spans.push({
          start: f.span.start,
          end: f.span.end,
          className,
        });
      }
      j++;
    }
  }

  for (let t = j; t < m; t++) {
    const f = formattedProfiles[t].tok;
    if (shouldHighlight(f) && f.span) {
      spans.push({
        start: f.span.start,
        end: f.span.end,
        className,
      });
    }
  }
  return spans;
};

const structuralDebugText = (
  text: string,
  spans: Array<{ start: number; end: number; className: string }>,
) => {
  const virtual = spans
    .filter((span) => span.className === "hl-virtual")
    .map((span) => ({
      start: Math.max(0, Math.min(text.length, span.start)),
      end: Math.max(0, Math.min(text.length, span.end)),
    }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);

  if (virtual.length === 0) return text;

  const merged: Array<{ start: number; end: number }> = [];
  for (const span of virtual) {
    const last = merged[merged.length - 1];
    if (!last || span.start >= last.end) {
      merged.push({ start: span.start, end: span.end });
    } else {
      last.end = Math.max(last.end, span.end);
    }
  }

  let output = "";
  let cursor = 0;
  for (const span of merged) {
    output += text.slice(cursor, span.start);
    output += `*${text.slice(span.start, span.end)}*`;
    cursor = span.end;
  }
  output += text.slice(cursor);
  return output;
};

const defaultCode = `
type List<T> = Empty | Link<T, List<T>>;

let rec length = match(list) => {
  Empty => { 0 },
  Link(_, rest) => { length(rest) }
};

let rec isEven = (n) => { isOdd(n) } and isOdd = (n) => { isEven(n) };
`.trim();

const middleViewOptions = [
  { value: "ast", label: "AST Tree" },
  { value: "types", label: "Types" },
  { value: "tokens", label: "Token Stream" },
  { value: "marks", label: "Marks" },
  { value: "formatter", label: "Formatter" },
  { value: "execution", label: "Execution" },
] as const;

function App() {
  const isCliMode = import.meta.env.MODE === "development" &&
    import.meta.env.VITE_USE_CLI_SERVER === "1";
  const [code, setCode] = useState(defaultCode);
  const [result, setResult] = useState<CompilationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [compileMs, setCompileMs] = useState<number | null>(null);
  const [errorLocation, setErrorLocation] = useState<ErrorLocation | null>(
    null,
  );
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [astView, setAstView] = useState<"surface" | "lowered">("surface");
  const [collapseSignal, setCollapseSignal] = useState(0);
  const [expandSignal, setExpandSignal] = useState(0);
  const [toggleSignal, setToggleSignal] = useState(0);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1, offset: 0 });
  const [editorScroll, setEditorScroll] = useState({ top: 0, left: 0 });
  const [highlightedSpan, setHighlightedSpan] = useState<
    { start: number; end: number } | null
  >(null);
  const [rightPane, setRightPane] = useState<"inspector" | "docs">(
    "inspector",
  );
  const [middleView, setMiddleView] = useState<
    "ast" | "types" | "tokens" | "marks" | "formatter" | "execution"
  >(() => {
    const saved = localStorage.getItem("middleView");
    if (saved === "recovery") {
      return "marks";
    }
    if (saved === "parsemarks") {
      return "marks";
    }
    return saved === "types" || saved === "tokens" || saved === "formatter" ||
        saved === "marks" || saved === "execution"
      ? saved
      : "ast";
  });
  const [formatterView, setFormatterView] = useState<
    "real" | "structural" | "fix"
  >(
    () => {
      const saved = localStorage.getItem("formatterView");
      return saved === "structural" || saved === "fix" ? saved : "real";
    },
  );
  const [panelRatios, setPanelRatios] = useState(() => {
    const saved = localStorage.getItem("panelRatios");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as {
          left: number;
          middle: number;
          right: number;
        };
        if (parsed.left && parsed.middle && parsed.right) {
          return parsed;
        }
      } catch {
        // Ignore invalid saved layout.
      }
    }
    return { left: 0.36, middle: 0.34, right: 0.3 };
  });
  const [containerWidth, setContainerWidth] = useState(0);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<
    {
      handle: "left" | "right";
      startX: number;
      startLeft: number;
      startMiddle: number;
      startRight: number;
      usableWidth: number;
    } | null
  >(null);
  const [surfaceCache, setSurfaceCache] = useState<Map<number, any>>(new Map());
  const [loweredCache, setLoweredCache] = useState<Map<number, any>>(new Map());
  const debounceTimer = useRef<number | null>(null);
  const editorRef = useRef<any>(null);
  const isTreeClickRef = useRef(false);
  const [cliStatus, setCliStatus] = useState<
    { ok: boolean; latencyMs: number; error?: string } | null
  >(null);

  // Execution state
  const [execOutput, setExecOutput] = useState<string>("");
  const [execZigSource, setExecZigSource] = useState<string>("");
  const [execRunning, setExecRunning] = useState(false);
  const zigWorkerRef = useRef<Worker | null>(null);
  const runnerWorkerRef = useRef<Worker | null>(null);

  const runZigSource = useCallback((zigSource: string) => {
    setExecOutput((prev) => prev + "Compiling Zig → WASM...\n");

    // Terminate previous workers
    zigWorkerRef.current?.terminate();
    runnerWorkerRef.current?.terminate();

    const zigWorker = new ZigCompilerWorker() as Worker;
    zigWorkerRef.current = zigWorker;

    zigWorker.onmessage = (ev) => {
      if (ev.data.stderr) {
        setExecOutput((prev) => prev + ev.data.stderr);
      } else if (ev.data.failed) {
        setExecOutput((prev) => prev + "\n❌ Zig compilation failed\n");
        setExecRunning(false);
        zigWorker.terminate();
      } else if (ev.data.compiled) {
        setExecOutput((prev) => prev + "✓ WASM compiled\nRunning...\n\n");

        const runnerWorker = new ZigRunnerWorker() as Worker;
        runnerWorkerRef.current = runnerWorker;

        runnerWorker.postMessage({ run: ev.data.compiled });

        runnerWorker.onmessage = (rev) => {
          if (rev.data.stderr) {
            setExecOutput((prev) => prev + rev.data.stderr);
          } else if (rev.data.done) {
            setExecRunning(false);
            runnerWorker.terminate();
          }
        };

        zigWorker.terminate();
      }
    };

    zigWorker.postMessage({ run: zigSource });
  }, []);

  const handleCompileWm = useCallback(async () => {
    if (execRunning) return;
    setExecRunning(true);
    setExecOutput("Compiling Workman → Zig...\n");
    setMiddleView("execution");

    try {
      const wmcResult = await compileWmc(code);
      if (!wmcResult.success || !wmcResult.zigSource) {
        setExecOutput((prev) =>
          prev + `\n❌ WMC Error: ${wmcResult.error || "Unknown error"}\n`
        );
        setExecRunning(false);
        return;
      }

      setExecZigSource(wmcResult.zigSource);
      setExecOutput((prev) => prev + "✓ Zig source generated\n");
      runZigSource(wmcResult.zigSource);
    } catch (err) {
      setExecOutput((prev) =>
        prev +
        `\n❌ Error: ${err instanceof Error ? err.message : String(err)}\n`
      );
      setExecRunning(false);
    }
  }, [code, execRunning, runZigSource]);

  const handleRunZig = useCallback(() => {
    if (execRunning || !execZigSource) return;
    setExecRunning(true);
    setExecOutput("");
    runZigSource(execZigSource);
  }, [execZigSource, execRunning, runZigSource]);

  // Persist middle view to localStorage
  useEffect(() => {
    localStorage.setItem("middleView", middleView);
  }, [middleView]);

  useEffect(() => {
    localStorage.setItem("formatterView", formatterView);
  }, [formatterView]);

  useEffect(() => {
    localStorage.setItem("panelRatios", JSON.stringify(panelRatios));
  }, [panelRatios]);

  useEffect(() => {
    if (!contentRef.current) return;
    const updateWidth = () => {
      if (contentRef.current) {
        setContainerWidth(contentRef.current.clientWidth);
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);

  const beginResize = useCallback((
    handle: "left" | "right",
    startX: number,
  ) => {
    const gap = 8;
    const resizerWidth = 6;
    const totalGap = gap * 4 + resizerWidth * 2;
    const usableWidth = Math.max(containerWidth - totalGap, 0);
    const startLeft = panelRatios.left * usableWidth;
    const startMiddle = panelRatios.middle * usableWidth;
    const startRight = panelRatios.right * usableWidth;
    resizeStateRef.current = {
      handle,
      startX,
      startLeft,
      startMiddle,
      startRight,
      usableWidth,
    };
  }, [containerWidth, panelRatios]);

  const onResizeMove = useCallback((event: MouseEvent) => {
    const state = resizeStateRef.current;
    if (!state) return;
    const minPanel = 220;
    const dx = event.clientX - state.startX;
    let left = state.startLeft;
    let middle = state.startMiddle;
    let right = state.startRight;

    if (state.handle === "left") {
      left = clamp(
        state.startLeft + dx,
        minPanel,
        state.usableWidth - 2 * minPanel,
      );
      middle = state.usableWidth - left - right;
      middle = clamp(middle, minPanel, state.usableWidth - left - minPanel);
    } else {
      right = clamp(
        state.startRight - dx,
        minPanel,
        state.usableWidth - 2 * minPanel,
      );
      middle = state.usableWidth - left - right;
      middle = clamp(middle, minPanel, state.usableWidth - left - minPanel);
    }

    const total = left + middle + right;
    if (total <= 0) return;
    setPanelRatios({
      left: left / total,
      middle: middle / total,
      right: right / total,
    });
  }, []);

  const endResize = useCallback(() => {
    resizeStateRef.current = null;
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => onResizeMove(event);
    const onUp = () => endResize();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [endResize, onResizeMove]);

  // Poll CLI server health in dev mode
  useEffect(() => {
    if (!isCliMode) {
      setCliStatus(null);
      return;
    }

    let cancelled = false;
    const tick = async () => {
      const status = await checkCliHealth();
      if (!cancelled) {
        setCliStatus(status);
      }
    };

    tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isCliMode]);

  // Helper to resolve child IDs to actual node objects recursively
  const resolveNode = (
    nodeId: number,
    cache: Map<number, any>,
    visited = new Set<number>(),
  ): any => {
    if (visited.has(nodeId)) return null; // Prevent cycles
    visited.add(nodeId);

    const node = cache.get(nodeId);
    if (!node) return null;

    // Resolve children from {field, id} to actual nodes with field labels
    const resolvedChildren = node.children
      .map((child: any) => {
        const resolvedChild = resolveNode(child.id, cache, visited);
        if (!resolvedChild) return null;
        //console.log(
        //  `[Resolve] Field: ${child.field}, Child ID: ${child.id}, Kind: ${resolvedChild.kind}`,
        //);
        return {
          ...resolvedChild,
          fieldName: child.field, // Preserve field name for display
        };
      })
      .filter(Boolean);

    return {
      ...node,
      children: resolvedChildren,
    };
  };

  // When a node is clicked in the tree, highlight it in the code
  const handleNodeClick = (node: any) => {
    console.log("[Node Click] Clicked node:", node);
    console.log("[Node Click] Node ID:", node.id, "Kind:", node.kind);

    // Set flag to prevent cursor change from overriding this selection
    isTreeClickRef.current = true;
    setTimeout(() => {
      isTreeClickRef.current = false;
    }, 100);

    setSelectedNode(node);
    if (node.span) {
      console.log("[Node Click] Setting highlight span:", node.span);
      setHighlightedSpan({ start: node.span.start, end: node.span.end });

      // Scroll editor to show the selected node
      if (editorRef.current) {
        editorRef.current.scrollToOffset(node.span.start);
      }
    } else {
      console.log("[Node Click] No span on node");
      setHighlightedSpan(null);
    }
  };

  // Find AST node at cursor position - returns the most specific (deepest) node
  const findNodeAtPosition = (node: any, offset: number, depth = 0): any => {
    if (!node) return null;

    const indent = "  ".repeat(depth);
    console.log(
      `${indent}[Find] Checking ${node.kind} #${node.id} at depth ${depth}`,
    );
    console.log(`${indent}[Find] Span:`, node.span, "Offset:", offset);

    // First check if this node's span contains the cursor
    const nodeContainsCursor = node.span &&
      node.span.start <= offset &&
      offset <= node.span.end;

    console.log(`${indent}[Find] Contains cursor:`, nodeContainsCursor);

    if (!nodeContainsCursor) {
      return null;
    }

    // If this node contains the cursor, search children for a more specific match
    if (node.children && node.children.length > 0) {
      console.log(`${indent}[Find] Searching ${node.children.length} children`);
      for (const child of node.children) {
        const childNode = findNodeAtPosition(child, offset, depth + 1);
        if (childNode) {
          // Found a child that contains the cursor - return it (more specific)
          console.log(
            `${indent}[Find] Found in child, returning ${childNode.kind} #${childNode.id}`,
          );
          return childNode;
        }
      }
      console.log(`${indent}[Find] No children matched, returning this node`);
    }

    // No children contain the cursor, so this is the most specific node
    return node;
  };

  const handleCursorChange = (
    pos: { line: number; col: number; offset: number },
  ) => {
    setCursorPos(pos);

    // Skip if selection came from tree click
    if (isTreeClickRef.current) {
      return;
    }

    // Use the appropriate cache and nodeStore based on current view
    const currentNodeStore = astView === "surface"
      ? result?.surfaceNodeStore
      : result?.loweredNodeStore;
    const currentCache = astView === "surface" ? surfaceCache : loweredCache;

    // Find node at cursor position
    if (currentNodeStore && currentCache.size > 0) {
      console.log("[Cursor] Looking for node at offset:", pos.offset);

      // Resolve all root nodes and their children
      const resolvedRoots = currentNodeStore.roots
        .map((id) => resolveNode(id, currentCache))
        .filter(Boolean);

      const rootNode = {
        kind: "Program",
        id: 0,
        span: { start: 0, end: code.length },
        children: resolvedRoots,
      };

      const nodeAtCursor = findNodeAtPosition(rootNode, pos.offset);
      console.log("[Cursor] Found node:", nodeAtCursor);
      if (nodeAtCursor) {
        setSelectedNode(nodeAtCursor);
        if (nodeAtCursor.span) {
          setHighlightedSpan({
            start: nodeAtCursor.span.start,
            end: nodeAtCursor.span.end,
          });
        }
      }
    }
  };

  const jumpToSpan = (span: { start: number; end: number }) => {
    const safeStart = Math.max(0, Math.min(code.length, span.start));
    const safeEnd = Math.max(safeStart, Math.min(code.length, span.end));
    setHighlightedSpan({
      start: safeStart,
      end: safeEnd > safeStart ? safeEnd : Math.min(code.length, safeStart + 1),
    });
    editorRef.current?.scrollToOffset(safeStart);
  };

  const markBundle = result?.marks ?? result?.recovery;
  const groupedDiagnostics = (() => {
    const entries = markBundle?.entries || [];
    const diagnostics = entries.length > 0
      ? entries.map((entry) => ({
        ...entry.diagnostic,
        markKind: entry.mark.kind,
        markText: entry.mark.text,
      }))
      : (markBundle?.diagnostics || []);
    type Diag = {
      stage: string;
      message: string;
      span: {
        line: number;
        col: number;
        start: number;
        end: number;
      };
      clues?: Array<{ kind: string; text: string }>;
      markKind?: string;
      markText?: string;
    };
    type Group = { primary: Diag; also: Diag[] };
    const groups: Group[] = [];
    const normalizeStart = (offset: number) => {
      if (code.length === 0) return offset;
      let idx = Math.min(Math.max(offset - 1, 0), code.length - 1);
      while (idx >= 0 && /\s/.test(code[idx])) {
        idx -= 1;
      }
      return idx >= 0 ? idx : offset;
    };
    const containsStart = (outer: Diag, inner: Diag) =>
      inner.span.start >= outer.span.start &&
      inner.span.start <= outer.span.end;
    const anchorOf = (diag: Diag) => normalizeStart(diag.span.start);
    diagnostics.forEach((diag) => {
      const diagAnchor = anchorOf(diag);
      const host = groups.find((group) =>
        anchorOf(group.primary) === diagAnchor ||
        containsStart(group.primary, diag)
      );
      if (host) {
        host.also.push(diag);
      } else {
        groups.push({ primary: diag, also: [] });
      }
    });
    return groups;
  })();

  const parsemarkSpans = (() => {
    if (!groupedDiagnostics.length) return [];
    const spans: Array<{ start: number; end: number; className: string }> = [];
    const clamp = (value: number, min: number, max: number) =>
      Math.min(max, Math.max(min, value));
    const findVisibleStart = (offset: number) => {
      if (code.length === 0) return 0;
      let idx = clamp(offset, 0, code.length - 1);
      if (idx > 0 && code[idx] === "\n") idx -= 1;
      while (idx > 0 && /\s/.test(code[idx])) {
        idx -= 1;
      }
      return idx;
    };
    const pushSpan = (start: number, end: number) => {
      const safeStart = clamp(start, 0, code.length);
      const safeEnd = clamp(end, 0, code.length);
      let finalStart = safeStart;
      let finalEnd = safeEnd;
      if (finalEnd <= finalStart) {
        finalStart = findVisibleStart(finalStart);
        finalEnd = Math.min(code.length, finalStart + 1);
      } else if (finalStart < code.length && /\s/.test(code[finalStart])) {
        finalStart = findVisibleStart(finalStart);
      }
      spans.push({
        start: finalStart,
        end: finalEnd,
        className: "hl-error",
      });
    };
    groupedDiagnostics.forEach((group) => {
      pushSpan(group.primary.span.start, group.primary.span.end);
    });
    return spans;
  })();

  const formatterText = formatterView === "real"
    ? result?.formatted || ""
    : formatterView === "structural"
    ? result?.formattedVirtual || ""
    : result?.formattedFix || "";
  const formatterTokens = formatterView === "real"
    ? result?.formattedTokens
    : formatterView === "structural"
    ? result?.formattedVirtualTokens
    : result?.formattedFixTokens;
  const formatterInsertedSpans = formatterView === "fix"
    ? computeInsertedSpans(
      result?.tokens,
      formatterTokens,
      (t) => t.kind === "SemiColon",
      "hl-inserted-semicolon",
    )
    : formatterView === "structural"
    ? (result?.formattedVirtualArtifacts ?? []).map((artifact) => ({
      start: Math.max(0, Math.min(formatterText.length, artifact.start)),
      end: Math.max(0, Math.min(formatterText.length, artifact.end)),
      className: "hl-virtual",
    })).filter((span) => span.end > span.start)
    : [];
  const formatterDebugText = structuralDebugText(
    formatterText,
    formatterInsertedSpans,
  );

  const handleCompile = async (sourceCode: string) => {
    console.log(
      "[Playground] Compiling code:",
      sourceCode.substring(0, 50) + "...",
    );
    setLoading(true);
    const start = performance.now();
    try {
      const res = await compileWorkman(sourceCode, "all");
      //console.log("[Playground] Compilation result:", res);
      console.log("[Playground] res.success:", res.success);
      console.log("[Playground] Surface roots:", res.surfaceNodeStore?.roots);
      console.log("[Playground] Lowered roots:", res.loweredNodeStore?.roots);

      // Build both surface and lowered caches
      if (res.surfaceNodeStore && res.surfaceNodeStore.nodes) {
        const cache = new Map();
        Object.entries(res.surfaceNodeStore.nodes).forEach(([id, node]) => {
          cache.set(parseInt(id), node);
        });
        console.log("[Playground] Loaded", cache.size, "surface nodes");
        flushSync(() => {
          setSurfaceCache(cache);
        });
      } else {
        flushSync(() => {
          setSurfaceCache(new Map());
        });
      }

      if (res.loweredNodeStore && res.loweredNodeStore.nodes) {
        const cache = new Map();
        Object.entries(res.loweredNodeStore.nodes).forEach(([id, node]) => {
          cache.set(parseInt(id), node);
        });
        console.log("[Playground] Loaded", cache.size, "lowered nodes");

        // Debug: Check for duplicate node kinds in lowered AST roots
        //const roots = res.loweredNodeStore.roots;
        //console.log("[DEBUG Lowered] Root count:", roots.length);
        //console.log("[DEBUG Lowered] Root IDs:", roots);

        // Check if roots have duplicate kinds
        //const rootKinds = roots.map((id: number) => {
        //  const node = res.loweredNodeStore!.nodes[id];
        //  return node ? node.kind : "unknown";
        //});
        //console.log("[DEBUG Lowered] Root kinds:", rootKinds);

        // Check for potential duplicates by comparing node content
        const kindCount: Record<string, number> = {};
        Object.values(res.loweredNodeStore.nodes).forEach((node: any) => {
          kindCount[node.kind] = (kindCount[node.kind] || 0) + 1;
        });
        //console.log("[DEBUG Lowered] Node kind counts:", kindCount);

        flushSync(() => {
          setLoweredCache(cache);
        });
      } else {
        flushSync(() => {
          setLoweredCache(new Map());
        });
      }

      // Set result AFTER cache is populated
      setResult(res);

      if (res.error) {
        // Extract error location from message like "at line 39, col 12"
        const locationMatch = res.error.match(/at line (\d+), col (\d+)/);
        if (locationMatch) {
          setErrorLocation({
            line: parseInt(locationMatch[1]),
            col: parseInt(locationMatch[2]),
          });
        } else {
          setErrorLocation(null);
        }
        console.error("[Playground] Compilation failed:", res.error);
      } else {
        setErrorLocation(null);
      }
    } catch (error) {
      console.error("[Playground] Compilation error:", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      setResult({
        success: false,
        error: errorMsg,
      });
      setErrorLocation(null);
    } finally {
      setCompileMs(Math.max(0, Math.round(performance.now() - start)));
      setLoading(false);
    }
  };

  // Auto-compile on code change with debounce
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = window.setTimeout(() => {
      handleCompile(code);
    }, 500); // 500ms debounce

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [code]);

  // Initial compile
  useEffect(() => {
    handleCompile(code);
  }, []);

  const { theme, toggleTheme } = useTheme();

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>🗿 Workman Playground</h1>
          <span className="header-badge">alpha</span>
          {isCliMode && (
            <>
              <span className="header-badge">CLI server</span>
              <span
                className={`header-badge cli-status ${
                  cliStatus?.ok ? "ok" : "bad"
                }`}
                title={cliStatus?.error || ""}
              >
                {cliStatus?.ok
                  ? `Connected ${cliStatus.latencyMs}ms`
                  : "Disconnected"}
              </span>
            </>
          )}
        </div>
        <div className="header-right">
          <a
            className="github-link"
            href="https://github.com/mommysgoodpuppy/workmangr"
            target="_blank"
            rel="noreferrer"
            aria-label="Workmangr on GitHub"
            title="Workmangr on GitHub"
          >
            GitHub
          </a>
          <div className={`status ${loading ? "loading" : "ready"}`}>
            {loading
              ? "Compiling..."
              : `Ready${compileMs !== null ? ` (${compileMs}ms)` : ""}`}
          </div>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <div className="main-card">
        <div
          className="main-content resizable-grid"
          ref={contentRef}
          style={{
            gridTemplateColumns: (() => {
              const gap = 8;
              const resizerWidth = 6;
              const gapTotal = gap * 4 + resizerWidth * 2;
              const usableWidth = Math.max(containerWidth - gapTotal, 0);
              const left = Math.max(220, panelRatios.left * usableWidth);
              const middle = Math.max(220, panelRatios.middle * usableWidth);
              const right = Math.max(220, panelRatios.right * usableWidth);
              return `${left}px ${resizerWidth}px ${middle}px ${resizerWidth}px ${right}px`;
            })(),
          }}
        >
          <div className="panel editor-panel">
            <div className="panel-header">
              <h3>Code Editor</h3>
              <div className="cursor-info">
                Pos {cursorPos.offset}, Ln {cursorPos.line}, Col {cursorPos.col}
              </div>
            </div>
            <CodeEditor
              ref={editorRef}
              value={code}
              onChange={setCode}
              errorLocation={errorLocation}
              onCursorChange={handleCursorChange}
              highlightedSpan={highlightedSpan}
              tokens={result?.tokens || []}
              insertedSpans={parsemarkSpans}
              cursorOffset={cursorPos.offset}
              onScrollChange={setEditorScroll}
            />
          </div>

          <div
            className="panel-resizer"
            onMouseDown={(event) => beginResize("left", event.clientX)}
            role="separator"
            aria-orientation="vertical"
          />

          <div className="panel tree-panel">
            <div className="panel-header">
              <div className="panel-view-picker">
                <label className="panel-view-label" htmlFor="middle-view-select">
                  View
                </label>
                <select
                  id="middle-view-select"
                  className="panel-view-select"
                  value={middleView}
                  onChange={(event) =>
                    setMiddleView(
                      event.target.value as
                        "ast" | "types" | "tokens" | "marks" | "formatter" |
                          "execution",
                    )}
                >
                  {middleViewOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {middleView === "ast" && (
                <div className="ast-controls">
                  <div
                    className={`ast-view-toggle ${
                      astView === "lowered" ? "lowered" : ""
                    }`}
                  >
                    <button
                      className={`toggle-btn ${
                        astView === "surface" ? "active" : ""
                      }`}
                      onClick={() => setAstView("surface")}
                    >
                      Surface
                    </button>
                    <button
                      className={`toggle-btn ${
                        astView === "lowered" ? "active" : ""
                      }`}
                      onClick={() => setAstView("lowered")}
                    >
                      Lowered
                    </button>
                  </div>
                  <button
                    className="copy-ast-btn"
                    onClick={() => {
                      const currentNodeStore = astView === "surface"
                        ? result?.surfaceNodeStore
                        : result?.loweredNodeStore;
                      const currentCache = astView === "surface"
                        ? surfaceCache
                        : loweredCache;
                      if (currentNodeStore) {
                        const roots = currentNodeStore.roots.map((id) =>
                          resolveNode(id, currentCache, new Set())
                        );
                        navigator.clipboard.writeText(
                          JSON.stringify(roots, null, 2),
                        );
                      }
                    }}
                    disabled={!(result?.surfaceNodeStore ||
                      result?.loweredNodeStore)}
                  >
                    Copy AST
                  </button>
                  <button
                    className="copy-ast-btn"
                    onClick={() => {
                      const newSignal = toggleSignal + 1;
                      setToggleSignal(newSignal);
                      if (newSignal % 2 === 1) {
                        setCollapseSignal((s) => s + 1);
                      } else {
                        setExpandSignal((s) => s + 1);
                      }
                    }}
                    title={toggleSignal % 2 === 0
                      ? "Collapse all nodes"
                      : "Expand all nodes"}
                  >
                    {toggleSignal % 2 === 0 ? "⊟" : "⊕"}
                  </button>
                </div>
              )}
              {middleView === "formatter" && (
                <div className="ast-controls">
                  <div
                    className={`ast-view-toggle three pos-${formatterView}`}
                  >
                    <button
                      className={`toggle-btn ${
                        formatterView === "real" ? "active" : ""
                      }`}
                      onClick={() => setFormatterView("real")}
                    >
                      Real
                    </button>
                    <button
                      className={`toggle-btn ${
                        formatterView === "structural" ? "active" : ""
                      }`}
                      onClick={() => setFormatterView("structural")}
                    >
                      Structural
                    </button>
                    <button
                      className={`toggle-btn ${
                        formatterView === "fix" ? "active" : ""
                      }`}
                      onClick={() => setFormatterView("fix")}
                    >
                      Fix
                    </button>
                  </div>
                  {formatterView === "structural" && (
                    <button
                      className="copy-ast-btn"
                      onClick={async () => {
                        await navigator.clipboard.writeText(formatterDebugText);
                      }}
                      disabled={!formatterText}
                      title="Copy structural output with virtual tokens wrapped in *...*"
                    >
                      Copy debug
                    </button>
                  )}
                </div>
              )}
              {middleView === "execution" && (
                <div className="ast-controls">
                  <button
                    className="copy-ast-btn"
                    onClick={handleCompileWm}
                    disabled={execRunning}
                    style={{ fontWeight: "bold" }}
                  >
                    {execRunning ? "Running..." : "▶ Compile WM"}
                  </button>
                  <button
                    className="copy-ast-btn"
                    onClick={handleRunZig}
                    disabled={execRunning || !execZigSource}
                  >
                    ▶ Run Zig
                  </button>
                </div>
              )}
            </div>
            {middleView === "tokens"
              ? (
                <div className="lexer-panel">
                  <LexerView tokens={result?.tokens || []} sourceCode={code} />
                </div>
              )
              : middleView === "types"
              ? (
                <div className="tree-content recovery-content">
                  {(() => {
                    const layer1 = result?.typeDebug?.layer1;
                    const layer2 = result?.typeDebug?.layer2;
                    const hasData = Boolean(layer1 || layer2);
                    if (!hasData) {
                      return <div className="tree-empty">Compile code to inspect types</div>;
                    }

                    const layer1NodeTypes = [...(layer1?.nodeTypes || [])].sort((a, b) => a.id - b.id);
                    const layer2NodeTypes = [...(layer2?.nodeTypes || [])].sort((a, b) => a.id - b.id);
                    const bindings = [...(layer2?.topBindings || [])].sort((a, b) =>
                      a.name.localeCompare(b.name)
                    );

                    const renderConstraint = (constraint: {
                      kind: string;
                      left?: string;
                      right?: string;
                      label?: string;
                      origin?: { nodeId: number; description: string };
                    }) => {
                      if (constraint.kind === "Equality") {
                        return `${constraint.left || "?"} ~ ${constraint.right || "?"} (${constraint.origin?.description || "unknown origin"})`;
                      }
                      return `${constraint.label || "domain"} (${constraint.origin?.description || "unknown origin"})`;
                    };

                    return (
                      <div className="type-debug">
                        <section className="type-block">
                          <h4>Top Bindings (Layer 2)</h4>
                          {bindings.length === 0
                            ? <div className="type-empty">No top-level bindings inferred yet.</div>
                            : (
                              <div className="type-list">
                                {bindings.map((binding) => (
                                  <div key={binding.name} className="type-item">
                                    <code>{binding.name}</code>
                                    <span> : </span>
                                    <code>{binding.type}</code>
                                    {binding.quantifiers && binding.quantifiers.length > 0 && (
                                      <span className="type-subtle">
                                        {" "}forall[{binding.quantifiers.join(", ")}]
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                        </section>

                        <section className="type-block">
                          <h4>Node Types (Layer 2)</h4>
                          {layer2NodeTypes.length === 0
                            ? <div className="type-empty">No solved node types.</div>
                            : (
                              <div className="type-list">
                                {layer2NodeTypes.map((item) => (
                                  <button
                                    key={`layer2-${item.id}`}
                                    className="type-item type-jump"
                                    onClick={() => {
                                      const node = loweredCache.get(item.id);
                                      if (node?.span) {
                                        jumpToSpan(node.span);
                                      }
                                    }}
                                  >
                                    <code>#{item.id}</code>
                                    <span> : </span>
                                    <code>{item.type}</code>
                                  </button>
                                ))}
                              </div>
                            )}
                        </section>

                        <section className="type-block">
                          <h4>Layer 1 Constraints</h4>
                          {!(layer1?.constraints || []).length
                            ? <div className="type-empty">No constraints recorded.</div>
                            : (
                              <div className="type-list">
                                {(layer1?.constraints || []).map((constraint, idx) => (
                                  <div key={`l1-constraint-${idx}`} className="type-item">
                                    <code>{renderConstraint(constraint)}</code>
                                  </div>
                                ))}
                              </div>
                            )}
                        </section>

                        <section className="type-block">
                          <h4>Layer 2 Deferred Constraints</h4>
                          {!(layer2?.constraints || []).length
                            ? <div className="type-empty">No deferred constraints remaining.</div>
                            : (
                              <div className="type-list">
                                {(layer2?.constraints || []).map((constraint, idx) => (
                                  <div key={`l2-constraint-${idx}`} className="type-item">
                                    <code>{renderConstraint(constraint)}</code>
                                  </div>
                                ))}
                              </div>
                            )}
                        </section>

                        <section className="type-block">
                          <h4>Type Marks (Layer 2)</h4>
                          {!(layer2?.marks || []).length
                            ? <div className="type-empty">No type marks.</div>
                            : (
                              <div className="type-list">
                                {(layer2?.marks || []).map((mark, idx) => (
                                  <div key={`l2-mark-${idx}`} className="type-item">
                                    <div>
                                      <strong>{mark.reason}</strong>: {mark.message}
                                    </div>
                                    <div className="type-subtle">
                                      {mark.origin.description}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                        </section>

                        <section className="type-block">
                          <h4>Node Types (Layer 1 Snapshot)</h4>
                          {layer1NodeTypes.length === 0
                            ? <div className="type-empty">No layer 1 node types.</div>
                            : (
                              <div className="type-list">
                                {layer1NodeTypes.map((item) => (
                                  <div key={`layer1-${item.id}`} className="type-item">
                                    <code>#{item.id}</code>
                                    <span> : </span>
                                    <code>{item.type}</code>
                                  </div>
                                ))}
                              </div>
                            )}
                        </section>
                      </div>
                    );
                  })()}
                </div>
              )
              : middleView === "marks"
              ? (
                <div className="tree-content recovery-content">
                  {(() => {
                    const top = markBundle?.topLevel || [];
                    const hasAny = top.length > 0 || groupedDiagnostics.length > 0;
                    if (!hasAny) {
                      return (
                        <div className="tree-empty">
                          No marks yet.
                        </div>
                      );
                    }
                    const shouldJump = (target: HTMLElement) => {
                      const selection = window.getSelection();
                      if (!selection || selection.toString().length === 0) {
                        return true;
                      }
                      const anchor = selection.anchorNode;
                      const focus = selection.focusNode;
                      return !(
                        (anchor && target.contains(anchor)) ||
                        (focus && target.contains(focus))
                      );
                    };
                    return (
                      <div className="recovery-list">
                        {top.map((event, idx) => (
                          <div
                            key={`top-${idx}`}
                            className="recovery-item"
                            role="button"
                            tabIndex={0}
                            onMouseUp={(e) => {
                              if (shouldJump(e.currentTarget)) {
                                jumpToSpan({
                                  start: event.span.start,
                                  end: event.span.end,
                                });
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                jumpToSpan({
                                  start: event.span.start,
                                  end: event.span.end,
                                });
                              }
                            }}
                          >
                            <div className="recovery-item-kind">
                              {event.kind}
                            </div>
                            <div className="recovery-item-msg">
                              {event.text}
                            </div>
                            <div className="recovery-item-span">
                              Ln {event.span.line}, Col {event.span.col}
                            </div>
                          </div>
                        ))}
                        {groupedDiagnostics.map((group, idx) => (
                          <div
                            key={`diag-${idx}`}
                            className="recovery-item"
                            role="button"
                            tabIndex={0}
                            onMouseUp={(e) => {
                              if (shouldJump(e.currentTarget)) {
                                jumpToSpan({
                                  start: group.primary.span.start,
                                  end: group.primary.span.end,
                                });
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                jumpToSpan({
                                  start: group.primary.span.start,
                                  end: group.primary.span.end,
                                });
                              }
                            }}
                          >
                            <div className="recovery-item-kind">
                              {group.primary.markKind || group.primary.stage}
                            </div>
                            <div className="recovery-item-msg">
                              {group.primary.markText && group.primary.markText.trim().length > 0
                                ? `${group.primary.message}\n${group.primary.markText}`
                                : group.primary.message}
                            </div>
                            <div className="recovery-item-span">
                              Ln {group.primary.span.line}, Col{" "}
                              {group.primary.span.col}
                            </div>
                            {group.also.length > 0 && (
                              <div className="recovery-item-also">
                                <div className="recovery-item-also-label">
                                  Also missing:
                                </div>
                                <ul className="recovery-item-also-list">
                                  {group.also.map((diag, alsoIdx) => (
                                    <li key={`diag-${idx}-also-${alsoIdx}`}>
                                      {diag.message}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )
              : middleView === "formatter"
              ? (
                <div className="tree-content tree-content-formatter">
                  <CodeEditor
                    value={formatterText}
                    tokens={formatterTokens}
                    insertedSpans={formatterInsertedSpans}
                    onChange={() => {}}
                    readOnly
                    placeholder="Compile code to see formatter output"
                    syncScroll={editorScroll}
                  />
                </div>
              )
              : middleView === "execution"
              ? (
                <div className="tree-content exec-panel">
                  <div className="exec-console-label">Console Output</div>
                  <div className="exec-console">
                    {execOutput || "Click ▶ Run to execute your program."}
                  </div>
                  <div className="exec-zig-label">Generated Zig Source</div>
                  <div className="exec-zig-panel">
                    <ZigSourceView
                      source={execZigSource}
                      onChange={setExecZigSource}
                      placeholder="No Zig source generated yet."
                    />
                  </div>
                </div>
              )
              : (
                <div className="tree-content" key={`tree-${astView}`}>
                  {(() => {
                    const currentNodeStore = astView === "surface"
                      ? result?.surfaceNodeStore
                      : result?.loweredNodeStore;
                    const currentCache = astView === "surface"
                      ? surfaceCache
                      : loweredCache;

                    if (!currentNodeStore || currentCache.size === 0) {
                      return (
                        <div className="tree-empty">
                          Compile code to see AST
                        </div>
                      );
                    }

                    // Resolve all root nodes and their children
                    const resolvedRoots = currentNodeStore.roots
                      .map((id) => resolveNode(id, currentCache, new Set()))
                      .filter(Boolean);

                    const rootNode = {
                      kind: "Program",
                      id: 0,
                      span: { start: 0, end: code.length },
                      children: resolvedRoots,
                    };

                    return (
                      <ASTTreeView
                        key={`ast-${astView}`}
                        node={rootNode}
                        onNodeClick={handleNodeClick}
                        selectedNode={selectedNode}
                        collapseSignal={collapseSignal}
                        expandSignal={expandSignal}
                      />
                    );
                  })()}
                </div>
              )}
          </div>

          <div
            className="panel-resizer"
            onMouseDown={(event) => beginResize("right", event.clientX)}
            role="separator"
            aria-orientation="vertical"
          />

          <div className="panel inspector-panel">
            <div className="panel-header">
              <div className="panel-tabs">
                <button
                  className={`panel-tab ${
                    rightPane === "inspector" ? "active" : ""
                  }`}
                  onClick={() => setRightPane("inspector")}
                >
                  Inspector
                </button>
                <button
                  className={`panel-tab ${
                    rightPane === "docs" ? "active" : ""
                  }`}
                  onClick={() => setRightPane("docs")}
                >
                  Docs
                </button>
              </div>
            </div>
            {rightPane === "docs"
              ? <DocsViewer />
              : <NodeInspector node={selectedNode} sourceCode={code} />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
