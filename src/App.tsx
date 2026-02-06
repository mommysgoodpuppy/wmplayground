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
  recovery?: {
    missingSemicolons?: Array<{
      kind: string;
      text: string;
      start: number;
      end: number;
      line: number;
      col: number;
      reason: string;
    }>;
    topLevel?: Array<{
      kind: string;
      text: string;
      span: { line: number; col: number; start: number; end: number };
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

interface ErrorLocation {
  line: number;
  col: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeToken = (tok: any) => `${tok.kind}:${tok.text ?? ""}`;
const isIgnorableToken = (tok: any) =>
  tok.kind === "LineComment" || tok.kind === "EOF";

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
  let i = 0;
  const spans: Array<{ start: number; end: number; className: string }> = [];
  for (let j = 0; j < formatted.length; j++) {
    const f = formatted[j];
    const s = source[i];
    if (s && normalizeToken(s) === normalizeToken(f)) {
      i++;
      continue;
    }
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

const defaultCode = `let input = "L1, R3, R1, L5, L2, L5";

export type GenericError =
  | Error;

record Location = { x: Int, y: Int };
record Operation = { direction: Direction, distance: Int };
type Direction = L | R;
type Orientation = N | E | S | W;
let start: Location = .{ x= 0, y= 0 };

// Function to parse a string into an Operation
let produceOp = (in) => {
  let intL = 'L' :> charToInt;
  let intR = 'R' :> charToInt;
  let val = (in, 0) :> list.at :> stripErr;
  let direction = stripErr(
    match(val) {
      intL => { IOk(L) },
      intR => { IOk(R) },
      _ => { IErr(Error) }
    }
  );
  let distance = (isDigit, in) 
    :> list.filter 
    :> posIntStringToInt;
  let yoink = match(direction, distance) {
    (direction, Some(distance)) => { 
      IOk(Operation{ direction, distance }) 
    },
    (direction, None) => { 
      IErr((direction, distance)) 
    }
  };
  yoink
};

// Function to create a movement function based on orientation and distance
let move = (orient, distance) => {
  (pos) => {
    match(orient) {
      N => { .{ x= pos.x, y= pos.y + distance } },
      E => { .{ x= pos.x + distance, y= pos.y } },
      S => { .{ x= pos.x, y= pos.y - distance } },
      W => { .{ x= pos.x - distance, y= pos.y } }
    }
  }
};
let rec walker = (opList, orient, location) => {
  let (opx, opList2) = stripErr(list.uncons(opList));
  let newOrient = match((opx.direction, orient)) {
    (L, N) => { W },
    (L, E) => { N },
    (L, S) => { E },
    (L, W) => { S },
    (R, N) => { E },
    (R, E) => { S },
    (R, S) => { W },
    (R, W) => { N }
  };
  let amount = opx.distance;
  let newLoc = move(newOrient, amount)(location);
  if (list.length(opList2) > 0) { 
    walker(opList2, newOrient, newLoc) 
  } else {
    newLoc
  }
};

let rec yoink = (infectedList) => {
  match(list.uncons(infectedList)) {
    IOk((head, tail)) => {
      match(head, yoink(tail)) {
        (IOk(value), IOk(restList)) => { IOk(Link(value, restList)) },
        (IErr(err), _) => { IErr(err) },
        (_, IErr(err)) => { IErr(err) }
      }
    },
    IErr(_) => { IOk(Empty) }
  }
};

let process = (in) => {
  let str = stringToList(in);
  let cleanedStr = list.remove(char(" "), str);
  let opStrList = list.splitBy(cleanedStr, char(","));
  let opList = list.map(produceOp, opStrList);
  let cleanOpList = stripErr(yoink(opList));
  let finalLoc = walker(cleanOpList, N, start);
  abs(finalLoc.x) + abs(finalLoc.y)
};

let main = => {
  print(process(input));
}
`.trim();

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
  const [highlightedSpan, setHighlightedSpan] = useState<
    { start: number; end: number } | null
  >(null);
  const [rightPane, setRightPane] = useState<"inspector" | "docs">(
    "inspector",
  );
  const [middleView, setMiddleView] = useState<
    "ast" | "tokens" | "recovery" | "formatter" | "execution"
  >(() => {
    const saved = localStorage.getItem("middleView");
    return saved === "tokens" || saved === "formatter" ||
        saved === "recovery" || saved === "execution"
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
              <div className="panel-tabs">
                <button
                  className={`panel-tab ${
                    middleView === "ast" ? "active" : ""
                  }`}
                  onClick={() => setMiddleView("ast")}
                >
                  AST Tree
                </button>
                <button
                  className={`panel-tab ${
                    middleView === "tokens" ? "active" : ""
                  }`}
                  onClick={() => setMiddleView("tokens")}
                >
                  Token Stream
                </button>
                <button
                  className={`panel-tab ${
                    middleView === "recovery" ? "active" : ""
                  }`}
                  onClick={() => setMiddleView("recovery")}
                >
                  Recovery
                </button>
                <button
                  className={`panel-tab ${
                    middleView === "formatter" ? "active" : ""
                  }`}
                  onClick={() => setMiddleView("formatter")}
                >
                  Formatter
                </button>
                <button
                  className={`panel-tab ${
                    middleView === "execution" ? "active" : ""
                  }`}
                  onClick={() => setMiddleView("execution")}
                >
                  Execution
                </button>
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
              : middleView === "recovery"
              ? (
                <div className="tree-content recovery-content">
                  {(() => {
                    const semis = result?.recovery?.missingSemicolons || [];
                    const top = result?.recovery?.topLevel || [];
                    const diagnostics = result?.recovery?.diagnostics || [];
                    const hasAny = semis.length > 0 || top.length > 0 ||
                      diagnostics.length > 0;
                    if (!hasAny) {
                      return (
                        <div className="tree-empty">
                          No parser recovery events.
                        </div>
                      );
                    }
                    return (
                      <div className="recovery-list">
                        {semis.map((event, idx) => (
                          <button
                            key={`semi-${idx}`}
                            className="recovery-item"
                            onClick={() =>
                              setHighlightedSpan({
                                start: event.start,
                                end: event.end,
                              })}
                          >
                            <div className="recovery-item-kind">
                              missingSemicolon
                            </div>
                            <div className="recovery-item-msg">
                              {event.reason}
                            </div>
                            <div className="recovery-item-span">
                              Ln {event.line}, Col {event.col} (offset{" "}
                              {event.start})
                            </div>
                          </button>
                        ))}
                        {top.map((event, idx) => (
                          <button
                            key={`top-${idx}`}
                            className="recovery-item"
                            onClick={() =>
                              setHighlightedSpan({
                                start: event.span.start,
                                end: event.span.end,
                              })}
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
                          </button>
                        ))}
                        {diagnostics.map((diag, idx) => (
                          <button
                            key={`diag-${idx}`}
                            className="recovery-item"
                            onClick={() =>
                              setHighlightedSpan({
                                start: diag.span.start,
                                end: diag.span.end,
                              })}
                          >
                            <div className="recovery-item-kind">
                              {diag.stage}
                            </div>
                            <div className="recovery-item-msg">
                              {diag.message}
                            </div>
                            <div className="recovery-item-span">
                              Ln {diag.span.line}, Col {diag.span.col}
                            </div>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )
              : middleView === "formatter"
              ? (
                <div className="tree-content">
                  {(() => {
                    const formattedText = formatterView === "real"
                      ? result?.formatted || ""
                      : formatterView === "structural"
                      ? result?.formattedVirtual || ""
                      : result?.formattedFix || "";
                    const formattedTokens = formatterView === "real"
                      ? result?.formattedTokens
                      : formatterView === "structural"
                      ? result?.formattedVirtualTokens
                      : result?.formattedFixTokens;
                    const insertedSpans = formatterView === "fix"
                      ? computeInsertedSpans(
                        result?.tokens,
                        formattedTokens,
                        (t) => t.kind === "SemiColon",
                        "hl-inserted-semicolon",
                      )
                      : formatterView === "structural"
                      ? computeInsertedSpans(
                        result?.tokens,
                        formattedTokens,
                        (_t) => true,
                        "hl-virtual",
                      )
                      : [];
                    return (
                      <CodeEditor
                        value={formattedText}
                        tokens={formattedTokens}
                        insertedSpans={insertedSpans}
                        onChange={() => {}}
                        readOnly
                        placeholder="Compile code to see formatter output"
                      />
                    );
                  })()}
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
