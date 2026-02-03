interface ASTNode {
  id?: number;
  kind: string;
  span?: { start: number; end: number; line?: number; col?: number };
  children?: ASTNode[];
  [key: string]: any;
}

interface NodeInspectorProps {
  node: ASTNode | null;
  sourceCode: string;
}

export function NodeInspector({ node, sourceCode }: NodeInspectorProps) {
  if (!node) {
    return (
      <div className="node-inspector">
        <div className="inspector-empty">
          Click on a node in the tree to inspect it
        </div>
      </div>
    );
  }
  
  const getText = () => {
    if (node.span && sourceCode) {
      return sourceCode.substring(node.span.start, node.span.end);
    }
    return '';
  };
  
  const text = getText();
  
  return (
    <div className="node-inspector">
      <h3>Node Inspector</h3>
      
      <div className="inspector-section">
        <div className="inspector-label">Kind</div>
        <div className="inspector-value">{node.kind}</div>
      </div>
      
      {node.id !== undefined && (
        <div className="inspector-section">
          <div className="inspector-label">ID</div>
          <div className="inspector-value">{node.id}</div>
        </div>
      )}
      
      {node.span && (
        <>
          <div className="inspector-section">
            <div className="inspector-label">Position</div>
            <div className="inspector-value">
              {node.span.line !== undefined && `Line ${node.span.line}, Col ${node.span.col}`}
            </div>
          </div>
          
          <div className="inspector-section">
            <div className="inspector-label">Span</div>
            <div className="inspector-value">
              start: {node.span.start}, end: {node.span.end}
            </div>
          </div>
        </>
      )}
      
      {node.children && (
        <div className="inspector-section">
          <div className="inspector-label">Children</div>
          <div className="inspector-value">{node.children.length} nodes</div>
        </div>
      )}
      
      {text && (
        <div className="inspector-section">
          <div className="inspector-label">Text</div>
          <div className="inspector-value inspector-text">
            <pre>{text}</pre>
          </div>
        </div>
      )}
      
      <div className="inspector-section">
        <div className="inspector-label">Properties</div>
        <div className="inspector-value">
          <pre className="inspector-json">
            {JSON.stringify(
              Object.fromEntries(
                Object.entries(node).filter(([key]) => 
                  !['children', 'span', 'id', 'kind'].includes(key)
                )
              ),
              null,
              2
            )}
          </pre>
        </div>
      </div>
    </div>
  );
}
