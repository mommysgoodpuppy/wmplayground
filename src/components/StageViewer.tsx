import { useState } from "react";

interface CompilationResult {
  success: boolean;
  data?: {
    tokens?: unknown;
    parsed?: unknown;
    lowered?: unknown;
    types?: unknown;
    note?: string;
  };
  error?: string;
}

interface StageViewerProps {
  result: CompilationResult | null;
  stage: string;
}

export function StageViewer({ result, stage }: StageViewerProps) {
  if (!result) {
    return (
      <div className="stage-viewer empty">
        <h3>👋 Welcome to Workman Playground</h3>
        <p>Start typing code in the editor to see compilation stages:</p>
        <ul>
          <li>
            <strong>Tokens</strong> - Lexical analysis output
          </li>
          <li>
            <strong>Parsed AST</strong> - Abstract syntax tree
          </li>
          <li>
            <strong>Lowered AST</strong> - Simplified representation
          </li>
        </ul>
        <p>The compiler will auto-run as you type!</p>
      </div>
    );
  }

  if (!result.success) {
    return (
      <div className="stage-viewer error">
        <h3>Compilation Error</h3>
        <pre className="error-output">{result.error}</pre>
      </div>
    );
  }

  return (
    <div className="stage-viewer">
      {result.data?.note && (
        <div className="info-note">
          ℹ️ {result.data.note}
        </div>
      )}

      <div className="stage-section">
        <h3>🔤 Tokens</h3>
        {result.data?.tokens
          ? (
            <div className="tokens-table-container">
              <table className="tokens-table">
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Text</th>
                    <th>Span</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.data.tokens as any[]).map((token, i) => (
                    <tr key={i}>
                      <td className="token-kind">{token.kind}</td>
                      <td className="token-text">{token.text}</td>
                      <td className="token-span">
                        {token.span.line}:{token.span.col}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
          : <div className="no-data">No token data</div>}
      </div>

      <div className="stage-section">
        <h3>🌳 Parsed AST</h3>
        {result.data?.parsed
          ? (
            <pre className="json-output">
            {JSON.stringify(result.data.parsed, null, 2)}
            </pre>
          )
          : <div className="no-data">No AST data</div>}
      </div>

      {result.data?.lowered && (
        <div className="stage-section">
          <h4>Lowered AST</h4>
          {(result.data as any)?.loweringError
            ? (
              <div className="error-output">
                <div className="error-message">
                  ⚠️ {(result.data as any).loweringError}
                </div>
                <div className="error-hint">
                  This shows where the lowering stage crashes. The AST node type
                  that caused the crash needs to be implemented in the lowering
                  pass.
                </div>
              </div>
            )
            : (
              <div className="json-output">
                <pre>{JSON.stringify(result.data.lowered, null, 2)}</pre>
              </div>
            )}
        </div>
      )}

      {result.data?.types && (
        <div className="stage-section">
          <h3>🏷️ Type Information</h3>
          <pre className="json-output">
            {JSON.stringify(result.data.types, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
