const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const tokenPattern =
  /(?<comment>(--|\/\/).*?$)|(?<string>"([^"\\]|\\.)*")|(?<keyword>\b(if|else|match|from|import|export|let|mut|rec|and|type|record|carrier|as|infix|infixl|infixr|prefix|infectious|domain|op|policy|annotate)\b)|(?<type>\b[A-Z][a-zA-Z0-9_]*\b)|(?<number>\b\d+\b)|(?<operator>(=>|->|=|:|\||<=|>=|==|!=|&&|\|\||[+\-*/%<>!&^~#$?]))/gm;

// Simple syntax highlighting for Workman based on the VSCode extension
export function highlightWorkman(code: string): string {
  let html = "";
  let lastIndex = 0;

  for (const match of code.matchAll(tokenPattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start > lastIndex) {
      html += escapeHtml(code.slice(lastIndex, start));
    }

    const groups = match.groups ?? {};
    let klass = "";
    if (groups.comment) klass = "hl-comment";
    else if (groups.string) klass = "hl-string";
    else if (groups.keyword) klass = "hl-keyword";
    else if (groups.type) klass = "hl-type";
    else if (groups.number) klass = "hl-number";
    else if (groups.operator) klass = "hl-operator";

    const tokenText = escapeHtml(match[0]);
    html += klass ? `<span class="${klass}">${tokenText}</span>` : tokenText;
    lastIndex = end;
  }

  if (lastIndex < code.length) {
    html += escapeHtml(code.slice(lastIndex));
  }

  return html;
}

const ebnfTokenPattern =
  /(?<comment>(?:--|\/\/).*?$)|(?<literal>'[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*")|(?<rule>\b[A-Za-z_][A-Za-z0-9_-]*\b)(?=\s*::=)|(?<operator>(::=|\||\(|\)|\[|\]|\{|\}|\*|\+|\?|=))/gm;

export function highlightEbnf(code: string): string {
  let html = "";
  let lastIndex = 0;

  for (const match of code.matchAll(ebnfTokenPattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start > lastIndex) {
      html += escapeHtml(code.slice(lastIndex, start));
    }

    const groups = match.groups ?? {};
    let klass = "";
    if (groups.comment) klass = "hl-ebnf-comment";
    else if (groups.literal) klass = "hl-ebnf-literal";
    else if (groups.rule) klass = "hl-ebnf-rule";
    else if (groups.operator) klass = "hl-ebnf-operator";

    const tokenText = escapeHtml(match[0]);
    html += klass ? `<span class="${klass}">${tokenText}</span>` : tokenText;
    lastIndex = end;
  }

  if (lastIndex < code.length) {
    html += escapeHtml(code.slice(lastIndex));
  }

  return html;
}
