const majorNodeVersion = Number(process.versions.node.split(".")[0]);
if (majorNodeVersion < 24) {
  console.error(`kb: node >= 24 required (running node ${process.version}). Please switch to node 24 or later.`);
  process.exit(1);
}

import { parseArgs } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type * as Kit from "../../plugins/apphost/kit/kit.ts";
import type * as Launch from "../../plugins/apphost/kit/launch.ts";
import {
  safeSlug,
  SIZES,
  StoreError,
  archiveCard,
  createBoard,
  createCard,
  isBlocked,
  listBoards,
  moveCard,
  patchBoard,
  patchCard,
  promoteTask,
  readBoard,
  taskStats,
  toggleCardTask,
} from "./store.ts";
import type { Board, Card, CardPatch, Size } from "./store.ts";
import { readActivity } from "./activity.ts";
import type { ActivityEntry, Actor } from "./activity.ts";

const kitDir = process.env.APP_KIT ?? resolve(import.meta.dirname, "../../plugins/apphost/kit");
// The host passes the kit's location in APP_KIT; an app can live in any repo, so no static path reaches it.
const kit: typeof Kit = await import(`${kitDir}/kit.ts`);

function isSize(v: string): v is Size {
  return (SIZES as readonly string[]).includes(v);
}

function isActor(v: string): v is Actor {
  return v === "user" || v === "ai";
}

function fail(msg: string): never {
  console.error(`kb: ${msg}`);
  process.exit(1);
}

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    as: { type: "string" },
    alt: { type: "string" },
    column: { type: "string" },
    index: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
    "body-file": { type: "string" },
    labels: { type: "string" },
    size: { type: "string" },
    assignee: { type: "string" },
    color: { type: "string" },
    blocked: { type: "string" },
    slug: { type: "string" },
    accent: { type: "string" },
    template: { type: "string" },
    lines: { type: "string" },
    json: { type: "boolean" },
    archived: { type: "boolean" },
    review: { type: "boolean" },
    project: { type: "string" },
    "data-dir": { type: "string" },
  },
});

const [cmd, ...args] = positionals;
const actor: Actor = flags.as === undefined ? "ai" : isActor(flags.as) ? flags.as : fail("--as must be user or ai");

const relConfig = process.env.APP_CONFIG_PATH ?? ".omp/apps/kanban.json";
let configEntry = process.env.APP_CONFIG
  ? { root: process.env.APP_ROOT ?? dirname(dirname(dirname(process.env.APP_CONFIG))), config: process.env.APP_CONFIG }
  : kit.findConfig(relConfig, process.cwd());

if (!configEntry && cmd !== "init") {
  fail(`kanban is not enabled for this repository. Run "kb init" to initialize.`);
}

const repoRoot = configEntry?.root ?? process.cwd();
const configPath = configEntry?.config ?? join(repoRoot, relConfig);

let conf: { project?: string; dataDir?: string } = {};
if (configEntry && existsSync(configPath)) {
  try {
    conf = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    fail(`${configPath} is not valid JSON`);
  }
}

const project = conf.project ?? basename(repoRoot);
const dataRoot = resolve(repoRoot, conf.dataDir ?? "docs/kanban");

async function resolveCardTemplate(name: string): Promise<string> {
  const filename = name.endsWith(".md") ? name : `${name}.md`;
  const repoTemplate = join(dataRoot, "templates", filename);
  if (existsSync(repoTemplate)) {
    return await readFile(repoTemplate, "utf8");
  }
  const appTemplate = join(import.meta.dirname, "templates", filename);
  if (existsSync(appTemplate)) {
    return await readFile(appTemplate, "utf8");
  }
  fail(`template "${name}" not found in ${repoTemplate} or ${appTemplate}`);
}

function normCardId(s: string): string {
  return s.replace(/^#/, "");
}

function findCard(board: Board, ref: string): Card {
  const id = normCardId(ref);
  return (
    board.cards[id] ??
    Object.values(board.cards).find((c) => `${c.num}` === id) ??
    fail(`card ${ref} not found`)
  );
}

async function buildPatch(): Promise<CardPatch> {
  const patch: CardPatch = {};
  if (flags.title !== undefined) patch.title = flags.title;
  if (flags["body-file"] !== undefined) {
    if (existsSync(flags["body-file"])) {
      patch.body = await readFile(flags["body-file"], "utf8");
    } else {
      patch.body = await resolveCardTemplate(flags["body-file"]);
    }
  } else if (flags.template !== undefined && cmd !== "new-board") {
    patch.body = await resolveCardTemplate(flags.template);
  } else if (flags.body !== undefined) {
    patch.body = flags.body;
  }
  if (flags.labels !== undefined)
    patch.labels = flags.labels.split(",").map((s) => s.trim()).filter(Boolean);
  if (flags.size !== undefined) {
    if (flags.size === "none") patch.size = null;
    else if (isSize(flags.size)) patch.size = flags.size;
    else fail(`size must be one of ${SIZES.join("|")}|none`);
  }
  if (flags.assignee !== undefined) {
    if (flags.assignee === "none") patch.assignee = null;
    else if (flags.assignee === "ai" || flags.assignee === "user") patch.assignee = flags.assignee;
    else fail("assignee must be ai|user|none");
  }
  if (flags.color !== undefined) patch.color = flags.color === "none" ? null : flags.color;
  if (flags.blocked !== undefined) patch.blocked = flags.blocked === "none" ? null : flags.blocked;
  return patch;
}

function cardLine(board: Board, card: Card): string {
  const bits: string[] = [`#${card.num}`.padStart(4)];
  bits.push(card.completed ? "✓" : isBlocked(board, card) ? "⛔" : "·");
  bits.push(card.title);
  const meta: string[] = [];
  if (card.size) meta.push(card.size);
  if (card.assignee) meta.push(`@${card.assignee}`);
  if (card.labels.length) meta.push(card.labels.join(","));
  const t = taskStats(card.body);
  if (t.total) meta.push(`${t.done}/${t.total}`);
  if (meta.length) bits.push(`(${meta.join(" · ")})`);
  return bits.join(" ");
}

async function main(): Promise<void> {
  switch (cmd) {
    case "init": {
      const gitRoot = kit.findConfig(".git", process.cwd())?.root ?? process.cwd();
      const targetConfig = join(gitRoot, relConfig);
      if (existsSync(targetConfig)) {
        console.log(`kanban is already initialized for ${gitRoot} (${targetConfig})`);
        return;
      }
      const projectName = flags.project ?? basename(gitRoot);
      const dataDirRel = flags["data-dir"] ?? "docs/kanban";
      mkdirSync(dirname(targetConfig), { recursive: true });
      writeFileSync(targetConfig, JSON.stringify({ project: projectName, dataDir: dataDirRel }, null, 2) + "\n");
      mkdirSync(join(gitRoot, dataDirRel, "boards"), { recursive: true });
      console.log(`kanban initialized for ${projectName} at ${targetConfig}`);
      return;
    }

    case "up": {
      // The host passes launch helpers in APP_KIT/launch.ts.
      const { ensureAppServer }: typeof Launch = await import(`${kitDir}/launch.ts`);
      const launched = await ensureAppServer(process.cwd());
      let projectUrl = launched.url;
      try {
        const res = await fetch(`http://localhost:5174/_app/open?root=${encodeURIComponent(repoRoot)}`);
        if (res.ok) {
          const data = (await res.json()) as { url: string };
          if (data.url && data.url !== "http://localhost:5174/") {
            projectUrl = data.url;
          } else {
            projectUrl = `http://localhost:5174/${project}/`;
          }
        }
      } catch {
        projectUrl = `http://localhost:5174/${project}/`;
      }
      console.log(projectUrl);
      return;
    }

    case "digest": {
      const listing = await listBoards(dataRoot);
      const lines: string[] = [];

      for (const b of listing.boards) {
        if (b.archived) continue;
        const colSummary = b.columns
          .map((col) => `${col.name}: ${(b.order[col.id] ?? []).length}`)
          .join(", ");
        lines.push(`${b.name} (${b.slug}): ${colSummary}`);

        const reviewCols = b.columns.filter((c) => c.id.toLowerCase().includes("review") || c.name.toLowerCase().includes("review"));
        const reviewCards: Card[] = [];
        for (const rc of reviewCols) {
          for (const cardId of b.order[rc.id] ?? []) {
            const c = b.cards[cardId];
            if (c && !c.completed && !c.archived) reviewCards.push(c);
          }
        }
        if (reviewCards.length > 0) {
          lines.push(`  Review: ${reviewCards.map((c) => `#${c.num} (${c.title})`).join(", ")}`);
        }

        const blockedCards = Object.values(b.cards).filter((c) => !c.completed && !c.archived && isBlocked(b, c));
        const external = blockedCards.filter((c) => c.blocked);
        const waiting = blockedCards.length - external.length;
        if (waiting > 0) lines.push(`  Waiting on other cards: ${waiting}`);
        if (external.length > 0) {
          const shown = external.slice(0, 3).map((c) => `#${c.num} (${c.blocked!.length > 60 ? `${c.blocked!.slice(0, 57)}...` : c.blocked})`);
          const more = external.length > 3 ? `, +${external.length - 3} more` : "";
          lines.push(`  Blocked outside the board: ${shown.join(", ")}${more}`);
        }
      }

      const stateDir = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
      const digestStateFile = join(stateDir, "omp-apps", `kanban-digest-${project}.json`);
      let lastSessionAt = "";
      try {
        if (existsSync(digestStateFile)) {
          const parsed = JSON.parse(readFileSync(digestStateFile, "utf8")) as { lastAt?: string };
          lastSessionAt = parsed.lastAt ?? "";
        }
      } catch {
        /* ignore */
      }

      const userActivities: Array<{ slug: string; entry: ActivityEntry }> = [];
      for (const b of listing.boards) {
        const acts = await readActivity(dataRoot, b.slug, 30);
        for (const a of acts) {
          if (a.actor === "user") {
            if (!lastSessionAt || a.at > lastSessionAt) {
              userActivities.push({ slug: b.slug, entry: a });
            }
          }
        }
      }

      userActivities.sort((a, b) => a.entry.at.localeCompare(b.entry.at));
      if (userActivities.length > 0) {
        lines.push("User actions since last session:");
        for (const ua of userActivities.slice(-5)) {
          lines.push(`  - [${ua.slug}] ${ua.entry.summary}`);
        }
      }

      try {
        mkdirSync(dirname(digestStateFile), { recursive: true });
        writeFileSync(digestStateFile, JSON.stringify({ lastAt: new Date().toISOString() }) + "\n");
      } catch {
        /* non-fatal */
      }

      if (lines.length === 0) {
        console.log(`kanban: no active boards in ${project}`);
      } else {
        console.log(lines.join("\n"));
      }
      return;
    }

    case "template": {
      const name = args[0] ?? fail("usage: kb template <name>");
      const content = await resolveCardTemplate(name);
      process.stdout.write(content);
      return;
    }

    case "boards": {
      const listing = await listBoards(dataRoot);
      if (flags.json) return void console.log(JSON.stringify(listing, null, 2));
      if (listing.boards.length === 0 && listing.unreadable.length === 0)
        return void console.log("no boards yet — kb new-board <name>");
      for (const b of listing.boards) {
        const active = Object.values(b.cards).filter((c) => !c.archived);
        const done = active.filter((c) => c.completed).length;
        const flag = b.archived ? " [archived]" : "";
        console.log(`${b.slug}${flag} — ${b.name} (${done}/${active.length} done)`);
      }
      for (const u of listing.unreadable)
        console.error(`⚠ ${u.slug} — UNREADABLE (${u.error}) — fix docs/kanban/boards/${u.slug}.json`);
      return;
    }

    case "new-board": {
      const name = args[0] ?? fail("usage: kb new-board <name> [--slug s] [--accent #hex] [--template t] [--review]");
      const board = await createBoard(
        dataRoot,
        { name, slug: flags.slug, accent: flags.accent, template: flags.template, review: flags.review },
        actor,
      );
      console.log(`created board ${board.slug} (${board.columns.map((c) => c.id).join(" → ")})`);
      return;
    }

    case "show": {
      const board = await readBoard(dataRoot, args[0] ?? fail("usage: kb show <board>"));
      if (flags.json) return void console.log(JSON.stringify(board, null, 2));
      console.log(`${board.name} [${board.slug}] — labels: ${board.labels.map((l) => l.id).join(", ") || "none"}`);
      for (const col of board.columns) {
        const ids = board.order[col.id];
        const wip = col.wip ? ` (wip ${ids.length}/${col.wip})` : "";
        console.log(`\n${col.name} [${col.id}]${wip}${col.done ? " ✓done-column" : ""}`);
        for (const id of ids) console.log(`  ${cardLine(board, board.cards[id])}`);
        if (ids.length === 0) console.log("  (empty)");
      }
      if (flags.archived) {
        const archived = Object.values(board.cards).filter((c) => c.archived);
        if (archived.length) {
          console.log("\nArchived:");
          for (const c of archived) console.log(`  ${cardLine(board, c)}`);
        }
      }
      return;
    }

    case "card": {
      const [slug, ref] = [args[0], args[1] ?? fail("usage: kb card <board> <card>")];
      const board = await readBoard(dataRoot, slug);
      const card = findCard(board, ref);
      if (flags.json) return void console.log(JSON.stringify(card, null, 2));
      console.log(cardLine(board, card));
      if (card.blocked) console.log(`blocked: ${card.blocked}`);
      if (card.blockedBy.length)
        console.log(`blocked by: ${card.blockedBy.map((id) => `#${board.cards[id]?.num ?? id}`).join(", ")}`);
      console.log(`updated: ${card.updatedAt}\n`);
      console.log(card.body || "(no description)");
      return;
    }

    case "add": {
      const [slug, title] = [args[0], args[1] ?? fail("usage: kb add <board> <title> [flags]")];
      const patch = await buildPatch();
      const { card } = await createCard(
        dataRoot,
        slug,
        {
          ...patch,
          title,
          column: flags.column,
          index: flags.index !== undefined ? Number(flags.index) : undefined,
        },
        actor,
      );
      console.log(`added #${card.num} "${card.title}" to ${flags.column ?? "first column"}`);
      return;
    }

    case "edit": {
      const [slug, ref] = [args[0], args[1] ?? fail("usage: kb edit <board> <card> [flags]")];
      const { card } = await patchCard(dataRoot, slug, normCardId(ref), await buildPatch(), actor);
      console.log(`updated #${card.num} "${card.title}"`);
      return;
    }

    case "move": {
      const [slug, ref, column] = [args[0], args[1], args[2] ?? fail("usage: kb move <board> <card> <column>")];
      const { card } = await moveCard(
        dataRoot,
        slug,
        normCardId(ref),
        column,
        flags.index !== undefined ? Number(flags.index) : undefined,
        actor,
      );
      console.log(`moved #${card.num} → ${column}${card.completed ? " (completed)" : ""}`);
      return;
    }

    case "done":
    case "undone": {
      const slug = args[0] ?? fail(`usage: kb ${cmd} <board> <card...>`);
      for (const ref of args.slice(1)) {
        const { card } = await patchCard(dataRoot, slug, normCardId(ref), { completed: cmd === "done" }, actor);
        console.log(`${cmd === "done" ? "✓" : "·"} #${card.num} ${card.title}`);
      }
      return;
    }

    case "archive":
    case "restore": {
      const slug = args[0] ?? fail(`usage: kb ${cmd} <board> <card...>`);
      for (const ref of args.slice(1)) {
        const { card } = await archiveCard(dataRoot, slug, normCardId(ref), cmd === "archive", flags.column, actor);
        console.log(`${cmd}d #${card.num} ${card.title}`);
      }
      return;
    }

    case "label": {
      const [slug, id, name, color] = args;
      if (!color) fail("usage: kb label <board> <id> <name> <#color>");
      const board = await readBoard(dataRoot, slug);
      const labels = board.labels.filter((l) => l.id !== id);
      labels.push({ id, name, color });
      await patchBoard(dataRoot, slug, { labels }, actor);
      console.log(`label ${id} set`);
      return;
    }

    case "task": {
      const [slug, ref, index, state] = args;
      if (!state) fail("usage: kb task <board> <card> <index> <on|off>");
      const { card } = await toggleCardTask(dataRoot, slug, normCardId(ref), Number(index), state === "on", actor);
      const t = taskStats(card.body);
      console.log(`#${card.num} tasks: ${t.done}/${t.total}`);
      return;
    }

    case "attach": {
      const [slug, ref, srcPath] = args;
      if (!srcPath) fail("usage: kb attach <board> <card> <image-file> [--alt text]");
      const ext = srcPath.slice(srcPath.lastIndexOf(".")).toLowerCase();
      const okExt: Record<string, true> = { ".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".gif": true };
      if (!okExt[ext]) fail(`unsupported image type ${ext} (png/jpg/webp/gif)`);
      const board = await readBoard(dataRoot, slug);
      const card =
        board.cards[normCardId(ref)] ??
        Object.values(board.cards).find((c) => `${c.num}` === normCardId(ref)) ??
        fail(`card ${ref} not found`);
      const bytes = await readFile(srcPath);
      const hint = basename(srcPath)
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/, "")
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "shot";
      const file = `${hint}-${Date.now().toString(36)}${ext === ".jpeg" ? ".jpg" : ext}`;
      const dir = join(dataRoot, "images", board.slug);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, file), bytes);
      const alt = flags.alt ?? "";
      const md = `![${alt}](/${project}/images/${board.slug}/${file})`;
      const body = card.body.trim() ? `${card.body.replace(/\s+$/, "")}\n\n${md}\n` : `${md}\n`;
      await patchCard(dataRoot, slug, card.id, { body }, actor);
      console.log(`attached ${file} to #${card.num} (${(bytes.length / 1024).toFixed(0)}KB)`);
      return;
    }

    case "mockup": {
      const [slug, ref, srcPath] = args;
      if (!srcPath) fail("usage: kb mockup <board> <card> <file.html> [--title T]");
      const ext = srcPath.slice(srcPath.lastIndexOf(".")).toLowerCase();
      if (ext !== ".html" && ext !== ".htm") fail("mockups must be .html");
      const board = await readBoard(dataRoot, slug);
      const card =
        board.cards[normCardId(ref)] ??
        Object.values(board.cards).find((c) => `${c.num}` === normCardId(ref)) ??
        fail(`card ${ref} not found`);
      const html = await readFile(srcPath, "utf8");
      const name =
        basename(srcPath)
          .toLowerCase()
          .replace(/\.html?$/, "")
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 48) || "mockup";
      const dir = join(dataRoot, "mockups", board.slug);
      await mkdir(dir, { recursive: true });
      const file = `${name}.html`;
      await writeFile(join(dir, file), html);
      const title = flags.title ?? name;
      const md = `[${title}](/${project}/mockups/${board.slug}/${file})`;
      const body = card.body.trim() ? `${card.body.replace(/\s+$/, "")}\n\n${md}\n` : `${md}\n`;
      await patchCard(dataRoot, slug, card.id, { body }, actor);
      console.log(`mockup ${file} → #${card.num} (view it in the panel)`);
      return;
    }

    case "stats": {
      const slug = args[0] ?? fail("usage: kb stats <board> [--json]");
      const board = await readBoard(dataRoot, slug);
      const active = Object.values(board.cards).filter((c) => !c.archived);
      const labels = board.labels.map((label) => {
        const cards = active.filter((c) => c.labels.includes(label.id));
        const completed = cards.filter((c) => c.completed).length;
        const tasks = cards.reduce(
          (acc, c) => {
            const t = taskStats(c.body);
            return { total: acc.total + t.total, done: acc.done + t.done };
          },
          { total: 0, done: 0 },
        );
        return { id: label.id, name: label.name, active: cards.length, completed, tasks };
      });
      const columns = board.columns.map((col) => ({
        id: col.id,
        name: col.name,
        count: board.order[col.id].length,
      }));
      const done = active.filter((c) => c.completed).length;
      const blocked = active
        .filter((c) => isBlocked(board, c))
        .map((c) => {
          const bits: string[] = [];
          if (c.blocked) bits.push(c.blocked);
          const openBlockers = c.blockedBy.filter((id) => {
            const b = board.cards[id];
            return b && !b.completed && !b.archived;
          });
          if (openBlockers.length)
            bits.push(`blocked by ${openBlockers.map((id) => `#${board.cards[id].num}`).join(", ")}`);
          return { num: c.num, title: c.title, reason: bits.join("; ") || "unknown" };
        });
      const report = { board: board.slug, labels, columns, total: { done, total: active.length }, blocked };
      if (flags.json) return void console.log(JSON.stringify(report, null, 2));
      console.log(`${board.name} [${board.slug}] — ${done}/${active.length} done`);
      if (labels.length) {
        console.log("\nlabels:");
        for (const l of labels) {
          const taskBit = l.tasks.total ? ` tasks ${l.tasks.done}/${l.tasks.total}` : "";
          console.log(`  ${l.id.padEnd(16)} ${l.completed}/${l.active} done${taskBit}`);
        }
      }
      console.log("\ncolumns:");
      for (const c of columns) console.log(`  ${c.id.padEnd(16)} ${c.count}`);
      if (blocked.length) {
        console.log("\n⛔ blocked:");
        for (const b of blocked) console.log(`  #${b.num} ${b.title} (${b.reason})`);
      }
      return;
    }

    case "activity": {
      const slug = args[0] ?? fail("usage: kb activity <board> [--lines n] [--json]");
      const limit = flags.lines !== undefined ? Number(flags.lines) : 20;
      const entries = await readActivity(dataRoot, slug, limit);
      if (flags.json) return void console.log(JSON.stringify(entries, null, 2));
      for (const e of entries) {
        const d = new Date(e.at);
        console.log(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} ${e.actor} ${e.summary}`);
      }
      return;
    }

    case "find": {
      const query = args.join(" ").trim().toLowerCase();
      if (!query) fail("usage: kb find <query>");
      const { boards, unreadable } = await listBoards(dataRoot);
      const results: string[] = [];
      search: for (const board of boards) {
        for (const col of board.columns) {
          for (const id of board.order[col.id]) {
            const card = board.cards[id];
            const hay = `${card.title}\n${card.body}\n#${card.num}`.toLowerCase();
            if (!hay.includes(query)) continue;
            results.push(`${board.slug} #${card.num} [${col.id}] ${card.title}`);
            if (results.length >= 30) break search;
          }
        }
      }
      for (const line of results) console.log(line);
      for (const u of unreadable)
        console.error(`⚠ ${u.slug} — UNREADABLE (${u.error}) — fix docs/kanban/boards/${u.slug}.json`);
      return;
    }

    case "link":
    case "unlink": {
      const [slug, ref, ...blockerRefs] = args;
      if (blockerRefs.length === 0)
        fail(`usage: kb ${cmd} <board> <card> <blockerCard...${cmd === "unlink" ? "|all" : ""}>`);
      const board = await readBoard(dataRoot, slug);
      const card = findCard(board, ref);
      let blockedBy: string[];
      if (cmd === "link") {
        const add = blockerRefs.map((r) => findCard(board, r).id);
        blockedBy = [...new Set([...card.blockedBy, ...add])];
      } else if (blockerRefs.length === 1 && blockerRefs[0] === "all") {
        blockedBy = [];
      } else {
        const remove = new Set(blockerRefs.map((r) => findCard(board, r).id));
        blockedBy = card.blockedBy.filter((id) => !remove.has(id));
      }
      const { card: updated } = await patchCard(dataRoot, slug, card.id, { blockedBy }, actor);
      const list = updated.blockedBy.map((id) => `#${board.cards[id]?.num ?? id}`).join(", ");
      console.log(`#${updated.num} blockedBy: ${list || "none"}`);
      return;
    }

    case "brief": {
      const slug = args[0] ?? fail("usage: kb brief <board> [--body md | --body-file f]");
      if (flags["body-file"] !== undefined || flags.body !== undefined) {
        const body =
          flags["body-file"] !== undefined ? await readFile(flags["body-file"], "utf8") : (flags.body ?? "");
        const board = await patchBoard(dataRoot, slug, { brief: body }, actor);
        console.log(`brief updated (${board.brief.length} chars)`);
        return;
      }
      const board = await readBoard(dataRoot, slug);
      console.log(board.brief || "(no brief)");
      return;
    }

    case "promote": {
      const [slug, ref, indexStr] = args;
      if (indexStr === undefined) fail("usage: kb promote <board> <card> <taskIndex>");
      const { board, card } = await promoteTask(dataRoot, slug, normCardId(ref), Number(indexStr), actor);
      console.log(cardLine(board, card));
      return;
    }

    default:
      fail(`unknown command ${JSON.stringify(cmd ?? "")}`);
  }
}

main().catch((e: unknown) => {
  if (e instanceof StoreError) fail(e.message);
  throw e;
});
