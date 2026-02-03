// Simple syntax highlighting for Workman based on the VSCode extension
export function highlightWorkman(code: string): string {
  let html = code;
  
  // Keywords
  const keywords = /\b(if|else|match|from|import|export|let|mut|rec|and|type|record|carrier|as|infix|infixl|infixr|prefix|infectious|domain|op|policy|annotate)\b/g;
  html = html.replace(keywords, '<span class="keyword">$1</span>');
  
  // Types (capitalized words)
  const types = /\b([A-Z][a-zA-Z0-9_]*)\b/g;
  html = html.replace(types, '<span class="type">$1</span>');
  
  // Numbers
  const numbers = /\b(\d+)\b/g;
  html = html.replace(numbers, '<span class="number">$1</span>');
  
  // Strings
  const strings = /"([^"\\]|\\.)*"/g;
  html = html.replace(strings, '<span class="string">$&</span>');
  
  // Comments
  const comments = /(--|\/\/).*$/gm;
  html = html.replace(comments, '<span class="comment">$&</span>');
  
  // Operators
  const operators = /(=>|->|=|:|\||<=|>=|==|!=|&&|\|\||[+\-*/%<>!&^~#$?])/g;
  html = html.replace(operators, '<span class="operator">$1</span>');
  
  return html;
}
