import { forwardRef, useImperativeHandle, useRef, useState } from "react";

interface ErrorLocation {
  line: number;
  col: number;
}

interface Token {
  kind: string;
  text?: string;
  span: { start: number; end: number };
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  errorLocation?: ErrorLocation | null;
  onCursorChange?: (pos: { line: number; col: number; offset: number }) => void;
  highlightedSpan?: { start: number; end: number } | null;
  tokens?: Token[];
  readOnly?: boolean;
  placeholder?: string;
  insertedSpans?: Array<{ start: number; end: number; className: string }>;
  cursorOffset?: number;
}

export interface CodeEditorRef {
  scrollToOffset: (offset: number) => void;
}

export const CodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>(
  (
    {
      value,
      onChange,
      errorLocation,
      onCursorChange,
      highlightedSpan,
      tokens,
      readOnly,
      placeholder,
      insertedSpans,
      cursorOffset,
    },
    ref,
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const highlightRef = useRef<HTMLDivElement>(null);
    const lineNumbersRef = useRef<HTMLDivElement>(null);
    const [isFocused, setIsFocused] = useState(false);

    // Expose scrollToOffset method
    useImperativeHandle(ref, () => ({
      scrollToOffset: (offset: number) => {
        if (!textareaRef.current) return;

        // Set cursor position
        textareaRef.current.setSelectionRange(offset, offset);
        textareaRef.current.focus();

        // Calculate line number to scroll to
        const textBefore = value.substring(0, offset);
        const lineNumber = textBefore.split("\n").length;

        // Scroll to make the line visible
        const lineHeight = 20; // Approximate line height in pixels
        const targetScroll = (lineNumber - 1) * lineHeight - 100; // Center with some offset

        textareaRef.current.scrollTop = Math.max(0, targetScroll);
      },
    }), [value]);

    const handleScroll = () => {
      if (textareaRef.current && highlightRef.current) {
        highlightRef.current.scrollTop = textareaRef.current.scrollTop;
        highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;

        // Sync line numbers vertical scroll only
        if (lineNumbersRef.current) {
          lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
        }
      }
    };

    const handleCursorChange = () => {
      if (!textareaRef.current || !onCursorChange) return;

      const offset = textareaRef.current.selectionStart;
      console.log("[CodeEditor] selectionStart:", offset);
      console.log(
        "[CodeEditor] selectionEnd:",
        textareaRef.current.selectionEnd,
      );
      const textBeforeCursor = value.substring(0, offset);
      const lines = textBeforeCursor.split("\n");
      const line = lines.length;
      const col = lines[lines.length - 1].length + 1;

      console.log("[CodeEditor] Calculated position:", { line, col, offset });
      onCursorChange({ line, col, offset });
    };

    const highlighted = highlightCode(
      value,
      errorLocation,
      highlightedSpan,
      tokens,
      insertedSpans,
      !readOnly && !isFocused ? cursorOffset ?? null : null,
    );

    const lineCount = value.split("\n").length;
    const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);

    return (
      <div className="code-editor-container">
        <div
          ref={lineNumbersRef}
          className="line-numbers"
        >
          {lineNumbers.map((num) => (
            <div key={num} className="line-number">{num}</div>
          ))}
        </div>
        <div className="code-content">
          <div
            ref={highlightRef}
            className="code-highlight"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
          <textarea
            ref={textareaRef}
            className="code-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onScroll={handleScroll}
            onSelect={handleCursorChange}
            onClick={handleCursorChange}
            onKeyUp={handleCursorChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            readOnly={readOnly}
            spellCheck={false}
            placeholder={placeholder ?? "Enter Workman code here..."}
          />
        </div>
      </div>
    );
  },
);

function highlightCode(
  code: string,
  errorLocation?: ErrorLocation | null,
  highlightedSpan?: { start: number; end: number } | null,
  tokens?: Token[],
  insertedSpans?: Array<{ start: number; end: number; className: string }>,
  ghostCursorOffset?: number | null,
): string {
  const escapeHtml = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const keywordSet = new Set([
    "if",
    "else",
    "match",
    "from",
    "import",
    "export",
    "let",
    "mut",
    "rec",
    "and",
    "type",
    "record",
    "carrier",
    "as",
    "infix",
    "infixl",
    "infixr",
    "prefix",
    "infectious",
    "domain",
    "op",
    "policy",
    "annotate",
  ]);

  const getOffsetFromLineCol = (
    text: string,
    line: number,
    col: number,
  ): number | null => {
    if (line < 1 || col < 1) return null;
    let currentLine = 1;
    let currentCol = 1;
    for (let i = 0; i < text.length; i++) {
      if (currentLine === line && currentCol === col) return i;
      const ch = text[i];
      if (ch === "\n") {
        currentLine++;
        currentCol = 1;
      } else {
        currentCol++;
      }
    }
    if (currentLine === line && currentCol === col) return text.length;
    return null;
  };

  const errorStart = errorLocation
    ? getOffsetFromLineCol(code, errorLocation.line, errorLocation.col)
    : null;
  const errorEnd = errorStart !== null
    ? Math.min(code.length, errorStart + 100)
    : null;

  const getTokenClass = (token: Token): string | null => {
    switch (token.kind) {
      case "KwVar":
      case "KwAllErrors":
        return "hl-keyword";
      case "LitBool":
        return "hl-keyword";
      case "LitNum":
        return "hl-number";
      case "LitString":
      case "LitChar":
        return "hl-string";
      case "ConstructorTok":
        return "hl-type";
      case "LitName":
        return token.text && keywordSet.has(token.text) ? "hl-keyword" : null;
      default:
        return null;
    }
  };

  const orderedTokens = (tokens ?? [])
    .filter((token) =>
      token &&
      token.kind !== "EOF" &&
      token.span &&
      typeof token.span.start === "number" &&
      typeof token.span.end === "number" &&
      token.span.end >= token.span.start
    )
    .sort((a, b) => a.span.start - b.span.start);

  let result = "";

  const appendSegment = (text: string, className?: string) => {
    if (!text) return;
    const escaped = escapeHtml(text);
    if (!className) {
      result += escaped;
      return;
    }
    result += `<span class="${className}">${escaped}</span>`;
  };

  const appendRange = (start: number, end: number, baseClass?: string) => {
    if (start >= end) return;
    const boundaries = [start, end];
    if (highlightedSpan) {
      if (highlightedSpan.start > start && highlightedSpan.start < end) {
        boundaries.push(highlightedSpan.start);
      }
      if (highlightedSpan.end > start && highlightedSpan.end < end) {
        boundaries.push(highlightedSpan.end);
      }
    }
    if (errorStart !== null && errorEnd !== null) {
      if (errorStart > start && errorStart < end) boundaries.push(errorStart);
      if (errorEnd > start && errorEnd < end) boundaries.push(errorEnd);
    }
    if (insertedSpans) {
      for (const span of insertedSpans) {
        if (span.start > start && span.start < end) boundaries.push(span.start);
        if (span.end > start && span.end < end) boundaries.push(span.end);
      }
    }
    if (
      ghostCursorOffset !== null && ghostCursorOffset !== undefined &&
      ghostCursorOffset >= start && ghostCursorOffset <= end
    ) {
      boundaries.push(ghostCursorOffset);
    }
    boundaries.sort((a, b) => a - b);
    const unique = boundaries.filter((v, i, arr) =>
      i === 0 || arr[i - 1] !== v
    );

    for (let i = 0; i < unique.length - 1; i++) {
      const segStart = unique[i];
      const segEnd = unique[i + 1];
      if (segStart >= segEnd) continue;
      if (
        ghostCursorOffset !== null && ghostCursorOffset !== undefined &&
        segStart === ghostCursorOffset
      ) {
        result += `<span class="hl-ghost-caret"></span>`;
      }
      const classes: string[] = [];
      if (baseClass) classes.push(baseClass);
      if (
        highlightedSpan &&
        segStart >= highlightedSpan.start &&
        segEnd <= highlightedSpan.end
      ) {
        classes.push("hl-highlight");
      }
      if (
        errorStart !== null &&
        errorEnd !== null &&
        segStart >= errorStart &&
        segEnd <= errorEnd
      ) {
        classes.push("hl-error");
      }
      if (insertedSpans) {
        for (const span of insertedSpans) {
          if (segStart >= span.start && segEnd <= span.end) {
            classes.push(span.className);
          }
        }
      }
      appendSegment(code.slice(segStart, segEnd), classes.join(" "));
    }

    if (
      ghostCursorOffset !== null && ghostCursorOffset !== undefined &&
      ghostCursorOffset === end
    ) {
      result += `<span class="hl-ghost-caret"></span>`;
    }
  };

  let cursor = 0;

  for (const token of orderedTokens) {
    const start = Math.max(0, Math.min(code.length, token.span.start));
    const end = Math.max(0, Math.min(code.length, token.span.end));
    if (end <= start) continue;
    if (start > cursor) {
      appendRange(cursor, start);
    }
    const tokenClass = getTokenClass(token) ?? undefined;
    appendRange(start, end, tokenClass);
    cursor = end;
  }

  if (cursor < code.length) {
    appendRange(cursor, code.length);
  }
  if (
    code.length === 0 && ghostCursorOffset !== null &&
    ghostCursorOffset !== undefined && ghostCursorOffset === 0
  ) {
    result += `<span class="hl-ghost-caret"></span>`;
  }

  return result;
}
