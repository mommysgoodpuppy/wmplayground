import { useRef } from "react";

interface ZigSourceViewProps {
  source: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}

const ZIG_KEYWORDS = new Set([
  "const",
  "var",
  "fn",
  "pub",
  "return",
  "if",
  "else",
  "switch",
  "while",
  "for",
  "break",
  "continue",
  "struct",
  "enum",
  "union",
  "error",
  "try",
  "catch",
  "unreachable",
  "undefined",
  "null",
  "true",
  "false",
  "void",
  "comptime",
  "inline",
  "extern",
  "export",
  "anytype",
  "self",
  "defer",
  "errdefer",
  "orelse",
  "and",
  "or",
  "not",
]);

const ZIG_BUILTINS = /^@[a-zA-Z_]\w*/;

function highlightZig(code: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const tokens: { start: number; end: number; cls: string }[] = [];
  const re =
    /\/\/[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)'|@[a-zA-Z_]\w*|[a-zA-Z_]\w*|\d+(?:\.\d+)?|./g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(code)) !== null) {
    const text = m[0];
    const start = m.index;
    const end = start + text.length;
    let cls = "";

    if (text.startsWith("//")) {
      cls = "zig-comment";
    } else if (text.startsWith('"')) {
      cls = "zig-string";
    } else if (text.startsWith("'")) {
      cls = "zig-string";
    } else if (ZIG_BUILTINS.test(text)) {
      cls = "zig-builtin";
    } else if (ZIG_KEYWORDS.has(text)) {
      cls = "zig-keyword";
    } else if (/^\d/.test(text)) {
      cls = "zig-number";
    } else if (/^[A-Z]/.test(text)) {
      cls = "zig-type";
    }

    if (cls) {
      tokens.push({ start, end, cls });
    }
  }

  let result = "";
  let cursor = 0;
  for (const tok of tokens) {
    if (tok.start > cursor) {
      result += esc(code.slice(cursor, tok.start));
    }
    result += `<span class="${tok.cls}">${
      esc(code.slice(tok.start, tok.end))
    }</span>`;
    cursor = tok.end;
  }
  if (cursor < code.length) {
    result += esc(code.slice(cursor));
  }
  return result;
}

export function ZigSourceView(
  { source, onChange, placeholder }: ZigSourceViewProps,
) {
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleScroll = () => {
    const el = textareaRef.current || highlightRef.current;
    if (el && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = el.scrollTop;
    }
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  if (!source) {
    return (
      <div className="zig-source-view zig-source-empty">
        {placeholder || "No Zig source generated yet."}
      </div>
    );
  }

  const lineCount = source.split("\n").length;
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);
  const highlighted = highlightZig(source);

  return (
    <div className="zig-source-view">
      <div ref={lineNumbersRef} className="zig-line-numbers">
        {lineNumbers.map((num) => (
          <div key={num} className="zig-line-number">{num}</div>
        ))}
      </div>
      <div className="zig-code-content">
        <pre
          ref={highlightRef}
          className="zig-source-code zig-highlight-layer"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
        {onChange && (
          <textarea
            ref={textareaRef}
            className="zig-source-code zig-input-layer"
            value={source}
            onChange={(e) => onChange(e.target.value)}
            onScroll={handleScroll}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        )}
      </div>
    </div>
  );
}
