const majorNodeVersion = Number(process.versions.node.split(".")[0]);
if (majorNodeVersion < 24) {
  console.error(`kb: node >= 24 required (running node ${process.version}). Please switch to node 24 or later.`);
  process.exit(1);
}

import { parseArgs } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import type * as Kit from "../../plugins/apphost/kit/kit.ts";
import type * as Launch from "../../plugins/apphost/kit/launch.ts";
import * as kb from "./client.ts";
import { SIZES, isBlocked, taskStats } from "./store.ts";
import type { Board, Card, CardPatch, Size } from "./store.ts";
import type { Actor } from "./activity.ts";

const kitDir = process.env.APP_KIT ?? resolve(import.meta.dirname, "../../plugins/apphost/kit");
// The host passes the kit's location in APP_KIT; an app can live in any repo, so no static path reaches it.
const kit: typeof Kit = await import(`${kitDir}/kit.ts`);
const launch: typeof Launch = await import(`${kitDir}/launch.ts`);

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

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
    session: { type: "boolean" },
    project: { type: "string" },
    "data-dir": { type: "string" },
  },
});

const [cmd, ...args] = positionals;
const actor: Actor =
  flags.as === undefined ? "ai" : flags.as === "user" || flags.as === "ai" ? flags.as : fail("--as must be user or ai");
const as = { actor };
const relConfig = process.env.APP_CONFIG_PATH ?? ".omp/apps/kanban.json";

/** Starts the server if needed, records this repo's opt-in, and points the client at its project. */
async function connect(): Promise<string> {
  const launched = await launch.ensureAppServer(process.cwd());
  const project = await kb.projectIdFor(launched.root);
  kb.setProject(project);
  return project;
}

async function buildPatch(): Promise<CardPatch> {
  const patch: CardPatch = {};
  if (flags.title !== undefined) patch.title = flags.title;
  if (flags["body-file"] !== undefined) {
    const file = flags["body-file"];
    patch.body = existsSync(file) ? await readFile(file, "utf8") : await kb.template(file);
  } else if (flags.template !== undefined && cmd !== "new-board") {
    patch.body = await kb.template(flags.template);
  } else if (flags.body !== undefined) {
    patch.body = flags.body;
  }
  if (flags.labels !== undefined)
    patch.labels = flags.labels.split(",").map((s) => s.trim()).filter(Boolean);
  if (flags.size !== undefined) {
    if (flags.size === "none") patch.size = null;
    else if ((SIZES as readonly string[]).includes(flags.size)) patch.size = flags.size as Size;
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

function findCard(board: Board, ref: string): Card {
  const id = ref.replace(/^#/, "");
  return board.cards[id] ?? Object.values(board.cards).find((c) => `${c.num}` === id) ?? fail(`card ${ref} not found`);
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

async function digest(): Promise<void> {
  const project = await connect();
  const stateDir = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  const markerFile = join(stateDir, "omp-apps", `kanban-digest-${project}.json`);
  let since = "";
  try {
    const marker: unknown = JSON.parse(readFileSync(markerFile, "utf8"));
    if (marker && typeof marker === "object" && "lastAt" in marker && typeof marker.lastAt === "string") since = marker.lastAt;
  } catch {
    /* an unreadable marker means no previous session */
  }

  const d = await kb.digest(since);
  const lines: string[] = [];
  for (const b of d.boards) {
    lines.push(`${b.name} (${b.slug}): ${b.columns.map((c) => `${c.name}: ${c.count}`).join(", ")}`);
    if (b.review.length) lines.push(`  Review: ${b.review.map((c) => `#${c.num} (${c.title})`).join(", ")}`);
    if (b.waiting > 0) lines.push(`  Waiting on other cards: ${b.waiting}`);
    if (b.external.length) {
      const shown = b.external
        .slice(0, 3)
        .map((c) => `#${c.num} (${c.blocked.length > 60 ? `${c.blocked.slice(0, 57)}...` : c.blocked})`);
      const more = b.external.length > 3 ? `, +${b.external.length - 3} more` : "";
      lines.push(`  Blocked outside the board: ${shown.join(", ")}${more}`);
    }
  }
  if (d.userActions.length) {
    lines.push("User actions since last session:");
    for (const a of d.userActions) lines.push(`  - [${a.slug}] ${a.summary}`);
  }

  // Only the host's session-start call advances the marker, so agents running `kb digest` cannot hide your changes.
  if (flags.session) {
    mkdirSync(dirname(markerFile), { recursive: true });
    writeFileSync(markerFile, JSON.stringify({ lastAt: new Date().toISOString() }) + "\n");
  }
  console.log(lines.length ? lines.join("\n") : `kanban: no active boards in ${project}`);
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
      mkdirSync(dirname(targetConfig), { recursive: true });
      writeFileSync(targetConfig, JSON.stringify({ project: projectName, dataDir: flags["data-dir"] ?? "docs/kanban" }, null, 2) + "\n");
      console.log(`kanban initialized for ${projectName} at ${targetConfig}`);
      return;
    }

    case "up": {
      console.log(`http://localhost:5174/${await connect()}/`);
      return;
    }

    case "digest":
      return digest();
  }

  await connect();
  switch (cmd) {
    case "template": {
      process.stdout.write(await kb.template(args[0] ?? fail("usage: kb template <name>")));
      return;
    }

    case "boards": {
      const listing = await kb.boards();
      if (flags.json) return void console.log(JSON.stringify(listing, null, 2));
      if (listing.boards.length === 0 && listing.unreadable.length === 0)
        return void console.log("no boards yet — kb new-board <name>");
      for (const b of listing.boards)
        console.log(`${b.slug}${b.archived ? " [archived]" : ""} — ${b.name} (${b.doneCount}/${b.cardCount} done)`);
      for (const u of listing.unreadable) console.error(`⚠ ${u.slug} — UNREADABLE (${u.error}) — fix boards/${u.slug}.json`);
      return;
    }

    case "new-board": {
      const name = args[0] ?? fail("usage: kb new-board <name> [--slug s] [--accent #hex] [--template t] [--review]");
      const board = await kb.createBoard(name, {
        slug: flags.slug,
        accent: flags.accent,
        template: flags.template,
        review: flags.review,
        actor,
      });
      console.log(`created board ${board.slug} (${board.columns.map((c) => c.id).join(" → ")})`);
      return;
    }

    case "show": {
      const board = await kb.board(args[0] ?? fail("usage: kb show <board>"));
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
      const ref = args[1] ?? fail("usage: kb card <board> <card>");
      const board = await kb.board(args[0]);
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
      const title = args[1] ?? fail("usage: kb add <board> <title> [flags]");
      const card = await kb.add(args[0], title, {
        ...(await buildPatch()),
        column: flags.column,
        index: flags.index !== undefined ? Number(flags.index) : undefined,
        actor,
      });
      console.log(`added #${card.num} "${card.title}" to ${flags.column ?? "first column"}`);
      return;
    }

    case "edit": {
      const ref = args[1] ?? fail("usage: kb edit <board> <card> [flags]");
      const card = await kb.edit(args[0], ref, { ...(await buildPatch()), actor });
      console.log(`updated #${card.num} "${card.title}"`);
      return;
    }

    case "move": {
      const column = args[2] ?? fail("usage: kb move <board> <card> <column>");
      const card = await kb.move(args[0], args[1], column, {
        index: flags.index !== undefined ? Number(flags.index) : undefined,
        actor,
      });
      console.log(`moved #${card.num} → ${column}${card.completed ? " (completed)" : ""}`);
      return;
    }

    case "done":
    case "undone": {
      const slug = args[0] ?? fail(`usage: kb ${cmd} <board> <card...>`);
      for (const ref of args.slice(1)) {
        const card = await kb.complete(slug, ref, cmd === "done", as);
        console.log(`${cmd === "done" ? "✓" : "·"} #${card.num} ${card.title}`);
      }
      return;
    }

    case "archive":
    case "restore": {
      const slug = args[0] ?? fail(`usage: kb ${cmd} <board> <card...>`);
      for (const ref of args.slice(1)) {
        const card = await kb.archiveCard(slug, ref, cmd === "archive", { restoreColumn: flags.column, actor });
        console.log(`${cmd}d #${card.num} ${card.title}`);
      }
      return;
    }

    case "label": {
      const [slug, id, name, color] = args;
      if (!color) fail("usage: kb label <board> <id> <name> <#color>");
      await kb.label(slug, id, name, color, as);
      console.log(`label ${id} set`);
      return;
    }

    case "task": {
      const [slug, ref, index, state] = args;
      if (!state) fail("usage: kb task <board> <card> <index> <on|off>");
      const card = await kb.toggleTask(slug, ref, Number(index), state === "on", as);
      const t = taskStats(card.body);
      console.log(`#${card.num} tasks: ${t.done}/${t.total}`);
      return;
    }

    case "attach": {
      const [slug, ref, srcPath] = args;
      if (!srcPath) fail("usage: kb attach <board> <card> <image-file> [--alt text]");
      const type = IMAGE_TYPES[srcPath.slice(srcPath.lastIndexOf(".")).toLowerCase()];
      if (!type) fail(`unsupported image type ${srcPath} (png/jpg/webp/gif)`);
      const bytes = await readFile(srcPath);
      const { card, url } = await kb.attach(
        slug,
        ref,
        { name: basename(srcPath), type, data: bytes.toString("base64"), alt: flags.alt },
        as,
      );
      console.log(`attached ${basename(url)} to #${card.num} (${(bytes.length / 1024).toFixed(0)}KB)`);
      return;
    }

    case "mockup": {
      const [slug, ref, srcPath] = args;
      if (!srcPath) fail("usage: kb mockup <board> <card> <file.html> [--title T]");
      if (!/\.html?$/i.test(srcPath)) fail("mockups must be .html");
      const { card, url } = await kb.mockup(
        slug,
        ref,
        { name: basename(srcPath), html: await readFile(srcPath, "utf8"), title: flags.title },
        as,
      );
      console.log(`mockup ${basename(url)} → #${card.num} (view it in the panel)`);
      return;
    }

    case "stats": {
      const board = await kb.board(args[0] ?? fail("usage: kb stats <board> [--json]"));
      const active = Object.values(board.cards).filter((c) => !c.archived);
      const labels = board.labels.map((label) => {
        const cards = active.filter((c) => c.labels.includes(label.id));
        const tasks = cards.reduce(
          (acc, c) => {
            const t = taskStats(c.body);
            return { total: acc.total + t.total, done: acc.done + t.done };
          },
          { total: 0, done: 0 },
        );
        return { id: label.id, name: label.name, active: cards.length, completed: cards.filter((c) => c.completed).length, tasks };
      });
      const columns = board.columns.map((col) => ({ id: col.id, name: col.name, count: board.order[col.id].length }));
      const done = active.filter((c) => c.completed).length;
      const blocked = active
        .filter((c) => isBlocked(board, c))
        .map((c) => {
          const bits: string[] = [];
          if (c.blocked) bits.push(c.blocked);
          const open = c.blockedBy.filter((id) => board.cards[id] && !board.cards[id].completed && !board.cards[id].archived);
          if (open.length) bits.push(`blocked by ${open.map((id) => `#${board.cards[id].num}`).join(", ")}`);
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
      const entries = await kb.activity(slug, flags.lines !== undefined ? Number(flags.lines) : 20);
      if (flags.json) return void console.log(JSON.stringify(entries, null, 2));
      for (const e of entries) {
        const d = new Date(e.at);
        console.log(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} ${e.actor} ${e.summary}`);
      }
      return;
    }

    case "find": {
      const query = args.join(" ").trim();
      if (!query) fail("usage: kb find <query>");
      for (const r of (await kb.search(query)).slice(0, 30)) console.log(`${r.slug} #${r.num} [${r.column}] ${r.title}`);
      return;
    }

    case "link":
    case "unlink": {
      const [slug, ref, ...blockerRefs] = args;
      if (blockerRefs.length === 0)
        fail(`usage: kb ${cmd} <board> <card> <blockerCard...${cmd === "unlink" ? "|all" : ""}>`);
      const updated =
        cmd === "link"
          ? await kb.link(slug, ref, blockerRefs, as)
          : await kb.unlink(slug, ref, blockerRefs.length === 1 && blockerRefs[0] === "all" ? "all" : blockerRefs, as);
      const board = await kb.board(slug);
      const list = updated.blockedBy.map((id) => `#${board.cards[id]?.num ?? id}`).join(", ");
      console.log(`#${updated.num} blockedBy: ${list || "none"}`);
      return;
    }

    case "append": {
      const ref = args[1] ?? fail("usage: kb append <board> <card> --body md | --body-file f");
      const text = flags["body-file"] !== undefined ? await readFile(flags["body-file"], "utf8") : flags.body;
      if (!text?.trim()) fail("kb append needs --body or --body-file");
      const card = await kb.appendBody(args[0], ref, text, as);
      console.log(`appended to #${card.num} "${card.title}"`);
      return;
    }

    case "brief": {
      const slug = args[0] ?? fail("usage: kb brief <board> [--body md | --body-file f]");
      if (flags["body-file"] !== undefined || flags.body !== undefined) {
        const text = flags["body-file"] !== undefined ? await readFile(flags["body-file"], "utf8") : (flags.body ?? "");
        const board = await kb.setBrief(slug, text, as);
        console.log(`brief updated (${board.brief.length} chars)`);
        return;
      }
      console.log((await kb.board(slug)).brief || "(no brief)");
      return;
    }

    case "promote": {
      const [slug, ref, indexStr] = args;
      if (indexStr === undefined) fail("usage: kb promote <board> <card> <taskIndex>");
      const card = await kb.promote(slug, ref, Number(indexStr), as);
      console.log(cardLine(await kb.board(slug), card));
      return;
    }

    default:
      fail(`unknown command ${JSON.stringify(cmd ?? "")}`);
  }
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
