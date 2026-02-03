import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightEbnf, highlightWorkman } from "../lib/workmanHighlight";

type DocKey = "syntax" | "infection" | "full";

type DocEntry = {
  label: string;
  path: string;
};

const docs: Record<DocKey, DocEntry> = {
  syntax: {
    label: "Syntax",
    path: "docs/workmansyntaxguide.md",
  },
  infection: {
    label: "Infection",
    path: "docs/workmaninfectionguide.md",
  },
  full: {
    label: "Full Reference",
    path: "docs/reference/canonical_full_generated.md",
  },
};

const buildDocUrl = (path: string) => {
  const baseUrl = import.meta.env.BASE_URL || "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return new URL(`${normalizedBase}${normalizedPath}`, window.location.origin)
    .toString();
};

type DocState = {
  content?: string;
  error?: string;
};

export function DocsViewer() {
  const [activeDoc, setActiveDoc] = useState<DocKey>("syntax");
  const [docState, setDocState] = useState<Record<DocKey, DocState>>({
    syntax: {},
    infection: {},
    full: {},
  });
  const [loadingDoc, setLoadingDoc] = useState<DocKey | null>(null);

  useEffect(() => {
    const current = docState[activeDoc];
    if (current.content || current.error) return;

    const url = buildDocUrl(docs[activeDoc].path);
    let cancelled = false;
    setLoadingDoc(activeDoc);

    fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load (${res.status})`);
        }
        return res.text();
      })
      .then((text) => {
        if (cancelled) return;
        setDocState((prev) => ({
          ...prev,
          [activeDoc]: { content: text },
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Unknown error";
        setDocState((prev) => ({
          ...prev,
          [activeDoc]: { error: message },
        }));
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDoc((currentDoc) =>
            currentDoc === activeDoc ? null : currentDoc
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeDoc, docState]);

  const currentDoc = docs[activeDoc];
  const currentState = docState[activeDoc];
  const isLoading = loadingDoc === activeDoc;
  const codeComponents = useMemo(
    () => ({
      code(
        { inline, className, children, ...props }: {
          inline?: boolean;
          className?: string;
          children?: React.ReactNode;
        },
      ) {
        const raw = String(children ?? "");
        if (inline) {
          const highlighted = highlightWorkman(raw);
          return (
            <code
              className={className}
              dangerouslySetInnerHTML={{ __html: highlighted }}
              {...props}
            />
          );
        }

        const language =
          typeof className === "string"
            ? className.replace("language-", "").trim().toLowerCase()
            : "";
        if (language === "workman" || language === "wm") {
          const highlighted = highlightWorkman(raw.replace(/\n$/, ""));
          return (
            <code
              className={className}
              dangerouslySetInnerHTML={{ __html: highlighted }}
              {...props}
            />
          );
        }

        if (language === "ebnf") {
          const highlighted = highlightEbnf(raw.replace(/\n$/, ""));
          return (
            <code
              className={className}
              dangerouslySetInnerHTML={{ __html: highlighted }}
              {...props}
            />
          );
        }

        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
    }),
    [],
  );

  return (
    <div className="docs-viewer">
      <div className="docs-tabs" role="tablist" aria-label="Documentation">
        {(Object.keys(docs) as DocKey[]).map((key) => (
          <button
            key={key}
            className={`docs-tab ${activeDoc === key ? "active" : ""}`}
            onClick={() => setActiveDoc(key)}
            role="tab"
            aria-selected={activeDoc === key}
          >
            {docs[key].label}
          </button>
        ))}
      </div>
      <div className="docs-content">
        {isLoading && (
          <div className="docs-loading">Loading {currentDoc.label}...</div>
        )}
        {!isLoading && currentState.error && (
          <div className="docs-error">
            <strong>Unable to load {currentDoc.label}.</strong>
            <div>{currentState.error}</div>
            <div className="docs-error-path">
              {buildDocUrl(currentDoc.path)}
            </div>
          </div>
        )}
        {!isLoading && !currentState.error && currentState.content && (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={codeComponents}>
            {currentState.content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
