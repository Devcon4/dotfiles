import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type Actor = "user" | "ai";

export interface ActivityEntry {
  at: string;
  actor: Actor;
  verb: string;
  card?: string;
  num?: number;
  summary: string;
}

export async function appendActivity(dataRoot: string, slug: string, entry: ActivityEntry): Promise<void> {
  try {
    const dir = join(dataRoot, "activity");
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, `${slug}.jsonl`), JSON.stringify(entry) + "\n");
  } catch {
    // Logging must never break the mutation itself.
  }
}

export async function readActivity(dataRoot: string, slug: string, limit = 50): Promise<ActivityEntry[]> {
  try {
    const raw = await readFile(join(dataRoot, "activity", `${slug}.jsonl`), "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const out: ActivityEntry[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        const parsed: unknown = JSON.parse(line);
        if (parsed && typeof parsed === "object" && "at" in parsed && "summary" in parsed)
          out.push(parsed as ActivityEntry);
      } catch {
        /* skip torn line */
      }
    }
    return out;
  } catch {
    return [];
  }
}
