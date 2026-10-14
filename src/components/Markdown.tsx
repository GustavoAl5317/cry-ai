"use client";

import { Check, Copy } from "lucide-react";
import { useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: unknown } }).props.children);
  }
  return "";
}

function CodeBlock({ children, ...rest }: ComponentProps<"pre">) {
  const [copied, setCopied] = useState(false);
  const code = textOf(children);
  const lang = /language-(\w+)/.exec(
    (children as { props?: { className?: string } })?.props?.className ?? "",
  )?.[1];

  const copy = async () => {
    await navigator.clipboard.writeText(code.replace(/\n$/, ""));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-ink-700 bg-[#0b0b10]">
      <div className="flex items-center justify-between border-b border-ink-700 px-3 py-1.5 font-mono text-[11px] text-zinc-500">
        <span>{lang ?? "codigo"}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-400 hover:bg-ink-800 hover:text-zinc-100"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre {...rest} className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-answer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true }]]}
        components={{
          pre: CodeBlock,
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
