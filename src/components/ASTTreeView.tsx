import { useEffect, useRef, useState } from "react";
import "./ASTTree.css";

interface ASTNode {
  id?: number;
  kind: string;
  span?: { start: number; end: number; line?: number; col?: number };
  children?: ASTNode[];
  [key: string]: any;
}

interface ASTTreeViewProps {
  node: ASTNode;
  onNodeClick: (node: ASTNode) => void;
  selectedNode?: ASTNode;
  depth?: number;
  collapseSignal?: number; // Increment to trigger collapse-all
  expandSignal?: number; // Increment to trigger expand-all
}

export function ASTTreeView(
  { node, onNodeClick, selectedNode, depth = 0, collapseSignal = 0, expandSignal = 0 }:
    ASTTreeViewProps,
) {
  const nodeRef = useRef<HTMLDivElement>(null);
  // Check if this node or any descendant is selected
  const isDescendantSelected = (
    n: ASTNode,
    target: ASTNode | undefined,
  ): boolean => {
    if (!target) return false;
    if (n.id === target.id) return true;
    if (n.children) {
      return n.children.some((child) => isDescendantSelected(child, target));
    }
    return false;
  };

  const [isExpanded, setIsExpanded] = useState(depth < 1);
  const prevCollapseSignal = useRef(collapseSignal);
  const prevExpandSignal = useRef(expandSignal);

  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedNode?.id === node.id;

  // Collapse all when signal changes (except root)
  useEffect(() => {
    if (collapseSignal > prevCollapseSignal.current) {
      prevCollapseSignal.current = collapseSignal;
      if (depth > 0) {
        setIsExpanded(false);
      }
    }
  }, [collapseSignal, depth]);

  // Expand all when signal changes
  useEffect(() => {
    if (expandSignal > prevExpandSignal.current) {
      prevExpandSignal.current = expandSignal;
      setIsExpanded(true);
    }
  }, [expandSignal]);

  // Auto-expand when a descendant becomes selected
  useEffect(() => {
    if (selectedNode && isDescendantSelected(node, selectedNode)) {
      setIsExpanded(true);
    }
  }, [selectedNode?.id]);

  // Scroll selected node into view
  useEffect(() => {
    if (isSelected && nodeRef.current) {
      nodeRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [isSelected]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onNodeClick(node);
  };

  return (
    <div
      ref={nodeRef}
      className="ast-tree-node"
      style={{ paddingLeft: depth > 0 ? "12px" : "0" }}
    >
      <div
        className={`ast-node-header ${isSelected ? "selected" : ""}`}
        onClick={handleClick}
      >
        {hasChildren
          ? (
            <span className="ast-toggle" onClick={handleToggle}>
              {isExpanded ? "−" : "+"}
            </span>
          )
          : <span className="ast-toggle-spacer" />}
        <span className="ast-node-kind">{node.kind}</span>
        {node.preview && (
          <span className="ast-node-preview">[{node.preview}]</span>
        )}
        {node.id !== undefined && (
          <span className="ast-node-id">#{node.id}</span>
        )}
        {node.span && (
          <span className="ast-node-span">
            {node.span.start}-{node.span.end}
          </span>
        )}
      </div>

      {hasChildren && (
        <div className="ast-node-children" style={{ display: isExpanded ? 'block' : 'none' }}>
          {node.children!.map((child, i) => (
            <div key={i}>
              {child.fieldName && (
                <div
                  className="ast-field-label"
                  style={{ paddingLeft: "12px" }}
                >
                  {child.fieldName}:
                </div>
              )}
              <ASTTreeView
                node={child}
                onNodeClick={onNodeClick}
                selectedNode={selectedNode}
                depth={depth + 1}
                collapseSignal={collapseSignal}
                expandSignal={expandSignal}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
