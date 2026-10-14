// Shapes shared by the API routes and the UI.

export type Speaker = "cliente" | "voce";

export type TranscriptLine = { speaker: Speaker; text: string; at: string };

/** quick: low latency; deep: web, documents, MCP and code; auto: decided from the live transcript. */
export type AnswerMode = "auto" | "quick" | "deep";

export type AnswerRecord = {
  id: string;
  mode: AnswerMode;
  question?: string;
  text: string;
  at: string;
};

export type Meeting = {
  id: string;
  title: string;
  client: string;
  goal: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  docIds: string[];
  mcpServerIds: string[];
  briefing?: string;
  summary?: string;
  transcript: TranscriptLine[];
  answers: AnswerRecord[];
};

export type MeetingListItem = Pick<
  Meeting,
  "id" | "title" | "client" | "createdAt" | "startedAt" | "endedAt"
> & { answers: number; docs: number };

export type Doc = {
  id: string;
  name: string;
  kind: "file" | "link";
  url?: string;
  size?: number;
  openaiFileId?: string;
  status: "processing" | "ready" | "error";
  error?: string;
  createdAt: string;
};

export type McpServer = {
  id: string;
  label: string;
  description?: string;
  /** Remote MCP server URL, or empty when a built-in OpenAI connector is used. */
  url?: string;
  connectorId?: string;
  /** Sent as the Authorization bearer token (OAuth access token or API token). */
  token?: string;
  enabled: boolean;
  /** Off by default: only tools whose names look read-only are exposed. */
  allowWrites?: boolean;
  /** Tool names last listed from the server, used to build the read-only list. */
  toolNames?: string[];
};

/** McpServer as sent to the browser: the token never leaves the server. */
export type PublicMcpServer = Omit<McpServer, "token" | "toolNames"> & {
  hasToken: boolean;
  toolCount?: number;
  readOnlyCount?: number;
};

export type Settings = {
  vectorStoreId?: string;
  mcpServers: McpServer[];
};

/** One line of the NDJSON stream returned by the agent routes. */
export type AgentEvent =
  | { t: "status"; text: string }
  | { t: "delta"; text: string }
  | { t: "error"; text: string }
  | { t: "done" };
