import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Doc, Meeting, MeetingListItem, Settings } from "./types";

// Everything lives in ./data on this machine (git-ignored).
const DATA_DIR = path.join(process.cwd(), "data");
const MEETINGS_DIR = path.join(DATA_DIR, "meetings");
const DOCS_DIR = path.join(DATA_DIR, "docs");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

export const newId = () => randomUUID().slice(0, 8);
export const now = () => new Date().toISOString();

// Serializes writes per file so concurrent appends never clobber each other.
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(file) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    file,
    next.catch(() => {}),
  );
  return next;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

async function listJson<T>(dir: string): Promise<T[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const items = await Promise.all(
    names.filter((n) => n.endsWith(".json")).map((n) => readJson<T>(path.join(dir, n))),
  );
  return items.filter((x): x is Awaited<T> => x !== null) as T[];
}

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "");
const meetingFile = (id: string) => path.join(MEETINGS_DIR, `${safeId(id)}.json`);
const docFile = (id: string) => path.join(DOCS_DIR, `${safeId(id)}.json`);

// Meetings

export async function listMeetings(): Promise<MeetingListItem[]> {
  const meetings = await listJson<Meeting>(MEETINGS_DIR);
  return meetings
    .map((m) => ({
      id: m.id,
      title: m.title,
      client: m.client,
      createdAt: m.createdAt,
      startedAt: m.startedAt,
      endedAt: m.endedAt,
      answers: m.answers.length,
      docs: m.docIds.length,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const getMeeting = (id: string) => readJson<Meeting>(meetingFile(id));

export async function createMeeting(input: Partial<Meeting>): Promise<Meeting> {
  const meeting: Meeting = {
    id: newId(),
    title: input.title?.trim() || "Nova reuniao",
    client: input.client?.trim() ?? "",
    goal: input.goal ?? "",
    createdAt: now(),
    docIds: [],
    mcpServerIds: [],
    transcript: [],
    answers: [],
  };
  await writeJson(meetingFile(meeting.id), meeting);
  return meeting;
}

/** Applies `change` to the stored meeting under a lock and saves it. */
export function updateMeeting(
  id: string,
  change: (meeting: Meeting) => void,
): Promise<Meeting | null> {
  const file = meetingFile(id);
  return withLock(file, async () => {
    const meeting = await readJson<Meeting>(file);
    if (!meeting) return null;
    change(meeting);
    await writeJson(file, meeting);
    return meeting;
  });
}

export const deleteMeeting = (id: string) => rm(meetingFile(id), { force: true });

// Documents

export async function listDocs(): Promise<Doc[]> {
  const docs = await listJson<Doc>(DOCS_DIR);
  return docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const getDoc = (id: string) => readJson<Doc>(docFile(id));

export const saveDoc = (doc: Doc) => withLock(docFile(doc.id), () => writeJson(docFile(doc.id), doc));

export const deleteDocRecord = (id: string) => rm(docFile(id), { force: true });

// Settings

export async function getSettings(): Promise<Settings> {
  return (await readJson<Settings>(SETTINGS_FILE)) ?? { mcpServers: [] };
}

export function updateSettings(change: (s: Settings) => void): Promise<Settings> {
  return withLock(SETTINGS_FILE, async () => {
    const settings = (await readJson<Settings>(SETTINGS_FILE)) ?? { mcpServers: [] };
    change(settings);
    await writeJson(SETTINGS_FILE, settings);
    return settings;
  });
}
