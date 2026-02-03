import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import "./App.css";
import { CodeEditor } from "./components/CodeEditor";
import { ASTTreeView } from "./components/ASTTreeView";
import { NodeInspector } from "./components/NodeInspector";
import { LexerView } from "./components/LexerView";
import { compileWorkman, type Stage } from "./lib/api";

interface CompilationResult {
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

interface ErrorLocation {
  line: number;
  col: number;
}

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
  const [code, setCode] = useState(defaultCode);
  const [result, setResult] = useState<CompilationResult | null>(null);
  const [activeTab, setActiveTab] = useState<"lexer" | "parser">(() => {
    const saved = localStorage.getItem("activeTab");
    return (saved === "lexer" || saved === "parser") ? saved : "parser";
  });
  const [loading, setLoading] = useState(false);
  const [errorLocation, setErrorLocation] = useState<ErrorLocation | null>(
    null,
  );
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [astView, setAstView] = useState<"surface" | "lowered">("surface");
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1, offset: 0 });
  const [highlightedSpan, setHighlightedSpan] = useState<
    { start: number; end: number } | null
  >(null);
  const [surfaceCache, setSurfaceCache] = useState<Map<number, any>>(new Map());
  const [loweredCache, setLoweredCache] = useState<Map<number, any>>(new Map());
  const debounceTimer = useRef<number | null>(null);
  const editorRef = useRef<any>(null);

  // Persist active tab to localStorage
  useEffect(() => {
    localStorage.setItem("activeTab", activeTab);
  }, [activeTab]);

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
        console.log(
          `[Resolve] Field: ${child.field}, Child ID: ${child.id}, Kind: ${resolvedChild.kind}`,
        );
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
    try {
      const res = await compileWorkman(sourceCode, "all");
      console.log("[Playground] Compilation result:", res);
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

  return (
    <div className="app">
      <header className="header">
        <h1>🗿 Workmangr Playground</h1>
        <p>Interactive compiler inspection for Workman Canonical</p>
      </header>

      <div className="controls">
        <div className="tabs">
          <button
            className={`tab ${activeTab === "lexer" ? "active" : ""}`}
            onClick={() => setActiveTab("lexer")}
          >
            Lexer
          </button>
          <button
            className={`tab ${activeTab === "parser" ? "active" : ""}`}
            onClick={() => setActiveTab("parser")}
          >
            Parser
          </button>
        </div>
        <div className="status">
          {loading ? "⏳ Compiling..." : "✓ Ready"}
        </div>
      </div>

      <div className="main-content">
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
          />
        </div>

        {activeTab === "lexer"
          ? (
            <div className="panel lexer-panel">
              <LexerView tokens={result?.tokens || []} sourceCode={code} />
            </div>
          )
          : (
            <>
              <div className="panel tree-panel">
                <div className="panel-header">
                  <h3>AST Tree</h3>
                  <div className="ast-controls">
                    <div className="ast-view-toggle">
                      <button
                        className={`toggle-btn ${astView === "surface" ? "active" : ""
                          }`}
                        onClick={() => setAstView("surface")}
                      >
                        Surface
                      </button>
                      <button
                        className={`toggle-btn ${astView === "lowered" ? "active" : ""
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
                  </div>
                </div>
                <div className="tree-content">
                  {(() => {
                    const currentNodeStore = astView === "surface"
                      ? result?.surfaceNodeStore
                      : result?.loweredNodeStore;
                    const currentCache = astView === "surface"
                      ? surfaceCache
                      : loweredCache;

                    console.log("[AST Tree] Render check:", {
                      astView,
                      hasNodeStore: !!currentNodeStore,
                      cacheSize: currentCache.size,
                      roots: currentNodeStore?.roots,
                    });

                    if (!currentNodeStore || currentCache.size === 0) {
                      console.log("[AST Tree] Showing empty state");
                      return (
                        <div className="tree-empty">
                          Compile code to see AST
                        </div>
                      );
                    }

                    console.log(
                      "[AST Tree] NodeStore roots:",
                      currentNodeStore.roots,
                    );
                    console.log("[AST Tree] Cache size:", currentCache.size);

                    // Resolve all root nodes and their children
                    const resolvedRoots = currentNodeStore.roots
                      .map((id) => {
                        console.log("[AST Tree] Resolving root node:", id);
                        const resolved = resolveNode(id, currentCache);
                        console.log("[AST Tree] Resolved node:", resolved);
                        return resolved;
                      })
                      .filter(Boolean);

                    console.log(
                      "[AST Tree] All resolved roots:",
                      resolvedRoots,
                    );

                    const rootNode = {
                      kind: "Program",
                      id: 0,
                      span: { start: 0, end: code.length },
                      children: resolvedRoots,
                    };

                    console.log(
                      "[AST Tree] Final root node for rendering:",
                      rootNode,
                    );

                    return (
                      <ASTTreeView
                        node={rootNode}
                        onNodeClick={handleNodeClick}
                        selectedNode={selectedNode}
                      />
                    );
                  })()}
                </div>
              </div>

              <div className="panel inspector-panel">
                <NodeInspector node={selectedNode} sourceCode={code} />
              </div>
            </>
          )}
      </div>
    </div>
  );
}

export default App;
