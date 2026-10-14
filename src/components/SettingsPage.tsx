"use client";

import { ArrowLeft, Plug, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { PublicMcpServer } from "@/lib/types";
import { Badge, Button, Card, EmptyState, Field, inputClass, Logo, Spinner } from "./ui";

type Preset = {
  label: string;
  url?: string;
  connectorId?: string;
  description: string;
  tokenHint: string;
};

// Only endpoints confirmed in each vendor's docs; anything else goes in "Outro".
const PRESETS: Preset[] = [
  {
    label: "GitHub",
    url: "https://api.githubcopilot.com/mcp/",
    description: "Repositorios, issues, pull requests e codigo",
    tokenHint: "Personal access token do GitHub (Settings > Developer settings > Tokens).",
  },
  {
    label: "Notion",
    url: "https://mcp.notion.com/mcp",
    description: "Paginas e bases de conhecimento do Notion",
    tokenHint: "O servidor da Notion usa OAuth: cole um access token OAuth valido.",
  },
  {
    label: "Google Drive",
    connectorId: "connector_googledrive",
    description: "Documentos, planilhas e apresentacoes do Drive",
    tokenHint: "Conector da OpenAI: cole um access token OAuth do Google com escopo de leitura do Drive.",
  },
  {
    label: "Outro (HubSpot, Salesforce, Jira...)",
    description: "",
    tokenHint: "URL do servidor MCP remoto da plataforma e o token que ela fornecer.",
  },
];

export function SettingsPage() {
  const [servers, setServers] = useState<PublicMcpServer[] | null>(null);
  const [preset, setPreset] = useState(0);
  const [form, setForm] = useState({
    label: PRESETS[0].label,
    url: PRESETS[0].url ?? "",
    token: "",
    description: PRESETS[0].description,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PublicMcpServer[]>("/api/settings/mcp").then(setServers).catch((e: Error) => setError(e.message));
  }, []);

  const p = PRESETS[preset];
  const isCustom = !p.url && !p.connectorId;

  const choose = (i: number) => {
    setPreset(i);
    const next = PRESETS[i];
    const custom = !next.url && !next.connectorId;
    setForm({ label: custom ? "" : next.label, url: next.url ?? "", token: "", description: next.description });
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const server = await api<PublicMcpServer>("/api/settings/mcp", "POST", {
        ...form,
        connectorId: p.connectorId,
      });
      setServers((prev) => [...(prev ?? []), server]);
      choose(preset);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (s: PublicMcpServer) => {
    const updated = await api<PublicMcpServer>("/api/settings/mcp", "PATCH", { id: s.id, enabled: !s.enabled });
    setServers((prev) => prev?.map((x) => (x.id === s.id ? updated : x)) ?? null);
  };

  const remove = async (s: PublicMcpServer) => {
    if (!confirm(`Remover ${s.label}?`)) return;
    await api(`/api/settings/mcp?id=${s.id}`, "DELETE");
    setServers((prev) => prev?.filter((x) => x.id !== s.id) ?? null);
  };

  return (
    <div className="min-h-dvh">
      <header className="border-b border-ink-700/70">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-5">
          <Link href="/">
            <Button variant="ghost" size="sm" aria-label="Voltar">
              <ArrowLeft size={14} />
            </Button>
          </Link>
          <Logo />
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-5 py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Conexoes MCP</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Sistemas que o copiloto consulta no briefing e nas respostas profundas. Em cada reuniao voce escolhe quais usar.
            Tokens ficam so neste computador.
          </p>
        </div>

        <Card className="divide-y divide-ink-700">
          {servers === null ? (
            <div className="flex justify-center py-8 text-zinc-500">
              <Spinner />
            </div>
          ) : servers.length === 0 ? (
            <EmptyState icon={<Plug size={18} />} title="Nenhuma conexao">
              Adicione GitHub, Notion, Google Drive ou qualquer servidor MCP remoto abaixo.
            </EmptyState>
          ) : (
            servers.map((s) => (
              <div key={s.id} className="flex items-center gap-3 p-4">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-ink-800 text-zinc-400">
                  <Plug size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.label}</span>
                    {s.enabled ? <Badge tone="emerald">Ativo</Badge> : <Badge>Pausado</Badge>}
                    {!s.hasToken && <Badge tone="amber">Sem token</Badge>}
                  </div>
                  <p className="truncate text-xs text-zinc-500">{s.connectorId ?? s.url}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => toggle(s)}>
                  {s.enabled ? "Pausar" : "Ativar"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(s)} aria-label="Remover">
                  <Trash2 size={14} />
                </Button>
              </div>
            ))
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">Adicionar conexao</h2>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((x, i) => (
              <button
                key={x.label}
                onClick={() => choose(i)}
                className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                  i === preset
                    ? "border-violet-500/60 bg-violet-500/10 text-violet-200"
                    : "border-ink-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                }`}
              >
                {x.label}
              </button>
            ))}
          </div>
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome">
              <input
                required
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Ex.: HubSpot"
                className={inputClass}
              />
            </Field>
            {p.connectorId ? (
              <Field label="Conector">
                <input disabled value={p.connectorId} className={`${inputClass} opacity-60`} />
              </Field>
            ) : (
              <Field label="URL do servidor MCP">
                <input
                  required
                  type="url"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://..."
                  className={inputClass}
                  readOnly={!isCustom}
                />
              </Field>
            )}
            <div className="sm:col-span-2">
              <Field label="Token de acesso" hint={p.tokenHint}>
                <input
                  type="password"
                  value={form.token}
                  onChange={(e) => setForm({ ...form, token: e.target.value })}
                  placeholder="Opcional se o servidor for publico"
                  className={inputClass}
                  autoComplete="off"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Para que serve" hint="Ajuda o agente a decidir quando usar esta conexao.">
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Ex.: CRM com contatos, empresas e negocios"
                  className={inputClass}
                />
              </Field>
            </div>
            {error && <p className="text-sm text-rose-300 sm:col-span-2">{error}</p>}
            <div className="sm:col-span-2">
              <Button variant="ai" disabled={saving}>
                {saving ? <Spinner /> : <Plus size={15} />} Adicionar
              </Button>
            </div>
          </form>
        </Card>
      </main>
    </div>
  );
}
