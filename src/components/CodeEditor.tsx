import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

interface ErrorLocation {
  line: number;
  col: number;
}

interface Token {
  kind: string;
  span: { start: number; end: number };
}

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  errorLocation?: ErrorLocation | null;
  onCursorChange?: (pos: { line: number; col: number; offset: number }) => void;
  highlightedSpan?: { start: number; end: number } | null;
  tokens?: Token[];
}

export interface CodeEditorRef {
  scrollToOffset: (offset: number) => void;
}

export const CodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>(
  (
    { value, onChange, errorLocation, onCursorChange, highlightedSpan, tokens },
    ref,
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const highlightRef = useRef<HTMLDivElement>(null);
    const lineNumbersRef = useRef<HTMLDivElement>(null);

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
            spellCheck={false}
            placeholder="Enter Workman code here..."
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
): string {
  const escapeHtml = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const keywords =
    /\b(if|else|match|from|import|export|let|mut|rec|and|type|record|carrier|as|infix|infixl|infixr|prefix|infectious|domain|op|policy|annotate)\b/;
  // Only match constructors at word boundaries - uppercase at START of identifier only
  const types = /(?<![a-zA-Z_])[A-Z][a-zA-Z0-9_]*/;
  const numbers = /\b\d+\b/;
  const stringPattern = /"(?:[^"\\]|\\.)*"/;
  const commentPattern = /(--|\/\/)[^\n]*/;

  let result = "";
  let i = 0;
  let currentLine = 1;
  let currentCol = 0;
  let inError = false;
  let inHighlight = false;

  while (i < code.length) {
    // Check if we should start highlighting
    if (highlightedSpan && i === highlightedSpan.start && !inHighlight) {
      result += '<span class="hl-highlight">';
      inHighlight = true;
    }

    // Check if we should end highlighting
    if (highlightedSpan && i === highlightedSpan.end && inHighlight) {
      result += "</span>";
      inHighlight = false;
    }

    // Track position for error highlighting
    if (
      errorLocation && currentLine === errorLocation.line &&
      currentCol === errorLocation.col && !inError
    ) {
      result += '<span class="hl-error">';
      inError = true;
    }

    // End error span after ~100 chars
    if (inError && currentCol >= errorLocation!.col + 100) {
      result += "</span>";
      inError = false;
    }

    // Check for strings
    const stringMatch = code.slice(i).match(stringPattern);
    if (stringMatch && stringMatch.index === 0) {
      result += `<span class="hl-string">${escapeHtml(stringMatch[0])}</span>`;
      i += stringMatch[0].length;
      currentCol += stringMatch[0].length;
      continue;
    }

    // Check for comments
    const commentMatch = code.slice(i).match(commentPattern);
    if (commentMatch && commentMatch.index === 0) {
      result += `<span class="hl-comment">${escapeHtml(commentMatch[0])
        }</span>`;
      i += commentMatch[0].length;
      currentCol += commentMatch[0].length;
      continue;
    }

    // Check for keywords
    const keywordMatch = code.slice(i).match(keywords);
    if (keywordMatch && keywordMatch.index === 0) {
      result += `<span class="hl-keyword">${escapeHtml(keywordMatch[0])
        }</span>`;
      i += keywordMatch[0].length;
      currentCol += keywordMatch[0].length;
      continue;
    }

    // Check for types
    const typeMatch = code.slice(i).match(types);
    if (typeMatch && typeMatch.index === 0) {
      result += `<span class="hl-type">${escapeHtml(typeMatch[0])}</span>`;
      i += typeMatch[0].length;
      currentCol += typeMatch[0].length;
      continue;
    }

    // Check for numbers
    const numberMatch = code.slice(i).match(numbers);
    if (numberMatch && numberMatch.index === 0) {
      result += `<span class="hl-number">${escapeHtml(numberMatch[0])}</span>`;
      i += numberMatch[0].length;
      currentCol += numberMatch[0].length;
      continue;
    }

    // Regular character
    const char = code[i];
    if (char === "\n") {
      if (inError) {
        result += "</span>";
        inError = false;
      }
      result += "\n";
      currentLine++;
      currentCol = 0;
    } else {
      result += escapeHtml(char);
      currentCol++;
    }
    i++;
  }

  // Close highlight span if still open
  if (inHighlight) {
    result += "</span>";
  }

  // Close error span if still open
  if (inError) {
    result += "</span>";
  }

  return result;
}
