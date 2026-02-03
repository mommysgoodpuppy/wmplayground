import "./LexerView.css";

interface Token {
  kind: string;
  span: { start: number; end: number };
  text?: string;
  mate?: number; // Bracket mate information
}

interface LexerViewProps {
  tokens: Token[];
  sourceCode: string;
}

export function LexerView({ tokens, sourceCode }: LexerViewProps) {
  // Preprocess tokens to add bidirectional mate information
  // mate is source position (char offset), not token index
  const processedTokens = tokens.map((token) => ({ ...token }));

  // Build map from source position to token index
  const positionToIndex = new Map<number, number>();
  processedTokens.forEach((token, index) => {
    positionToIndex.set(token.span.start, index);
  });

  // For each right bracket with mate (source position of left bracket),
  // find the left bracket's token index and add reverse mate
  processedTokens.forEach((token, index) => {
    if (typeof token.mate === "number") {
      const leftPosition = token.mate;
      const leftIndex = positionToIndex.get(leftPosition);
      if (leftIndex !== undefined) {
        // Add reverse mate: left bracket's mate = right bracket's source position
        processedTokens[leftIndex].mate = token.span.start;
      }
    }
  });

  // Rainbow colors for token highlighting
  const rainbowColors = [
    "#ff6b6b", // red
    "#ffa500", // orange
    "#ff1493", // magenta (replaced yellow to avoid identifier conflict)
    "#6bcf7f", // green
    "#4ecdc4", // cyan
    "#45b7d1", // blue
    "#a78bfa", // purple
    "#ec4899", // pink
  ];

  // Bracket token kinds that should use rainbow bracket colorization
  const bracketKinds = new Set([
    "LParen",
    "RParen",
    "LBrace",
    "RBrace",
    "DotBrace", // .{ can be a mate
    "LBracket",
    "RBracket",
  ]);

  const getColorForToken = (token: Token, index: number): string => {
    // Make "Other" tokens bright red to highlight lexer bugs
    if (token.kind === "Other") {
      return "#ff0000";
    }

    // Identifiers vs Constructors - different colors
    if (token.kind === "LitName") {
      return "#ffd93d"; // yellow for identifiers
    }
    if (token.kind === "ConstructorTok") {
      return "#4ec9b0"; // teal/cyan for constructors
    }

    // For brackets with mate information, use rainbow bracket colors
    // Use min(mate, position) so both brackets in a pair get the same color
    if (bracketKinds.has(token.kind) && typeof token.mate === "number") {
      const pairId = Math.min(token.mate, token.span.start);
      return rainbowColors[pairId % rainbowColors.length];
    }

    // For other tokens, use hash of kind string for consistent colors
    let hash = 0;
    for (let i = 0; i < token.kind.length; i++) {
      hash = token.kind.charCodeAt(i) + ((hash << 5) - hash);
    }
    return rainbowColors[Math.abs(hash) % rainbowColors.length];
  };

  // Build highlighted HTML with rainbow-colored tokens
  const buildHighlightedCode = () => {
    if (!processedTokens || processedTokens.length === 0) {
      return sourceCode;
    }

    let result = "";
    let lastEnd = 0;

    processedTokens.forEach((token, index) => {
      // Add any text between tokens (whitespace, etc.)
      if (token.span.start > lastEnd) {
        result += escapeHtml(sourceCode.substring(lastEnd, token.span.start));
      }

      // Add the token with color
      const color = getColorForToken(token, index);
      const tokenText = sourceCode.substring(token.span.start, token.span.end);

      // Build tooltip with token info
      let tooltip = token.kind;
      if (typeof token.mate === "number") {
        tooltip += ` (mate: ${token.mate})`;
      }

      result +=
        `<span class="token" style="color: ${color}; font-weight: 500;" title="${tooltip}">${escapeHtml(tokenText)
        }</span>`;

      lastEnd = token.span.end;
    });

    // Add any remaining text after the last token
    if (lastEnd < sourceCode.length) {
      result += escapeHtml(sourceCode.substring(lastEnd));
    }

    return result;
  };

  const escapeHtml = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const highlighted = buildHighlightedCode();

  return (
    <div className="lexer-view">
      <div className="lexer-header">
        <h3>Token Stream</h3>
        <div className="token-count">
          {tokens?.length || 0} tokens
        </div>
      </div>
      <div className="lexer-content">
        <div
          className="lexer-highlight"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </div>
    </div>
  );
}
