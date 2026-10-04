"""kb client shim — drive the kanban board from python (eval workflows).

Zero deps (urllib). ALL writes go through the HTTP API on purpose: the
server is the single process holding the per-board write lock, so parallel
workflow workers can hammer one board safely. NEVER have parallel workers
write board JSON directly or via kb.ts — cross-process read-modify-write
loses updates (in-process locks don't serialize across processes).

Usage (eval py):
    import sys; sys.path.insert(0, "<path-to-app>")
    import client as kb
    kb.ensure_up()
    c = kb.add("my-board", "Title #art !M", body="- [ ] step")
    kb.move("my-board", c["id"], "doing")

Every mutation sends `x-kb-actor: ai` unless actor="user" is passed.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

BASE = os.environ.get("KANBAN_URL", "http://localhost:5174")
_APP_DIR = Path(__file__).parent
_CONFIGURED_PROJECT: str | None = None


class KbError(RuntimeError):
    """API error (message comes from the server)."""


def set_project(project: str) -> None:
    global _CONFIGURED_PROJECT
    _CONFIGURED_PROJECT = project


def find_project(cwd: Path | None = None) -> str:
    if _CONFIGURED_PROJECT:
        return _CONFIGURED_PROJECT
    env_p = os.environ.get("KANBAN_PROJECT")
    if env_p:
        return env_p
    d = (cwd or Path.cwd()).resolve()
    while True:
        conf_file = d / ".omp" / "apps" / "kanban.json"
        if conf_file.exists():
            try:
                data = json.loads(conf_file.read_text(encoding="utf-8"))
                if "project" in data:
                    return str(data["project"])
                return d.name
            except Exception:
                return d.name
        if d.parent == d:
            break
        d = d.parent
    return "varia"


def _req(method: str, path: str, body: dict | None = None, actor: str = "ai", project: str | None = None) -> Any:
    proj = project or find_project()
    url = f"{BASE}/{proj}{path if path.startswith('/') else '/' + path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"content-type": "application/json", "x-kb-actor": actor},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            message = json.loads(e.read()).get("error", str(e))
        except Exception:
            message = str(e)
        raise KbError(message) from None


def up() -> bool:
    try:
        req = urllib.request.Request(f"{BASE}/_app/health")
        with urllib.request.urlopen(req, timeout=5) as res:
            return json.loads(res.read() or b"{}").get("app") == "kanban"
    except Exception:
        return False


def ensure_up(timeout: float = 30.0) -> None:
    if up():
        return
    res = subprocess.run(["kb", "up"], capture_output=True)
    if res.returncode != 0:
        alt = subprocess.run(["node", str(_APP_DIR / "kb.ts"), "up"], capture_output=True)
        if alt.returncode != 0:
            err = res.stderr.decode() or alt.stderr.decode()
            raise KbError(f"failed to start kanban server: {err}")
    deadline = time.time() + timeout
    while time.time() < deadline:
        if up():
            return
        time.sleep(0.3)
    raise KbError("kanban server did not come up")


def boards(*, project: str | None = None) -> dict:
    return _req("GET", "/api/boards", project=project)


def board(slug: str, *, project: str | None = None) -> dict:
    return _req("GET", f"/api/board/{slug}", project=project)


def card(slug: str, card_id: str | int, *, project: str | None = None) -> dict:
    b = board(slug, project=project)
    cid = _resolve(b, card_id)
    return b["cards"][cid]


def activity(slug: str, limit: int = 30, *, project: str | None = None) -> list[dict]:
    return _req("GET", f"/api/board/{slug}/activity?limit={limit}", project=project)["activity"]


def search(q: str, *, project: str | None = None) -> list[dict]:
    from urllib.parse import quote
    return _req("GET", f"/api/search?q={quote(q)}", project=project)["results"]


def _resolve(b: dict, card_id: Any) -> str:
    cid = str(card_id).lstrip("#")
    if cid in b["cards"]:
        return cid
    for c in b["cards"].values():
        if str(c["num"]) == cid:
            return c["id"]
    raise KbError(f"card {card_id} not found in {b['slug']}")


def create_board(name: str, *, slug: str | None = None, accent: str | None = None,
                 template: str | None = None, actor: str = "ai", project: str | None = None) -> dict:
    body = {"name": name, "slug": slug, "accent": accent, "template": template}
    return _req("POST", "/api/boards", {k: v for k, v in body.items() if v is not None}, actor, project=project)["board"]


def add(slug: str, title: str, *, column: str | None = None, index: int | None = None,
        actor: str = "ai", project: str | None = None, **fields: Any) -> dict:
    payload = {"title": title, "column": column, "index": index, **fields}
    payload = {k: v for k, v in payload.items() if v is not None}
    return _req("POST", f"/api/board/{slug}/cards", payload, actor, project=project)["card"]


def edit(slug: str, card_id: Any, *, actor: str = "ai", project: str | None = None, **fields: Any) -> dict:
    cid = _resolve(board(slug, project=project), card_id)
    return _req("PATCH", f"/api/board/{slug}/card/{cid}", fields, actor, project=project)["card"]


def move(slug: str, card_id: Any, column: str, index: int | None = None, *, actor: str = "ai", project: str | None = None) -> dict:
    cid = _resolve(board(slug, project=project), card_id)
    payload = {"column": column, "index": index}
    return _req("POST", f"/api/board/{slug}/card/{cid}/move", {k: v for k, v in payload.items() if v is not None}, actor, project=project)["card"]


def complete(slug: str, card_id: Any, done: bool = True, *, actor: str = "ai", project: str | None = None) -> dict:
    return edit(slug, card_id, completed=done, actor=actor, project=project)


def archive(slug: str, card_id: Any, archived: bool = True, *,
            restore_column: str | None = None, actor: str = "ai", project: str | None = None) -> dict:
    cid = _resolve(board(slug, project=project), card_id)
    payload = {"archived": archived, "restoreColumn": restore_column}
    return _req("POST", f"/api/board/{slug}/card/{cid}/archive", {k: v for k, v in payload.items() if v is not None}, actor, project=project)["card"]


def link(slug: str, card_id: Any, *blockers: Any, actor: str = "ai", project: str | None = None) -> dict:
    b = board(slug, project=project)
    cid = _resolve(b, card_id)
    target = b["cards"][cid]
    new_refs = [_resolve(b, blk) for blk in blockers]
    merged = list(dict.fromkeys(target["blockedBy"] + new_refs))
    return _req("PATCH", f"/api/board/{slug}/card/{cid}", {"blockedBy": merged}, actor, project=project)["card"]


def toggle_task(slug: str, card_id: Any, index: int, checked: bool, *, actor: str = "ai", project: str | None = None) -> dict:
    cid = _resolve(board(slug, project=project), card_id)
    return _req("POST", f"/api/board/{slug}/card/{cid}/task", {"index": index, "checked": checked}, actor, project=project)["card"]


def promote(slug: str, card_id: Any, index: int, *, actor: str = "ai", project: str | None = None) -> dict:
    cid = _resolve(board(slug, project=project), card_id)
    return _req("POST", f"/api/board/{slug}/card/{cid}/promote-task", {"index": index}, actor, project=project)["card"]


def set_brief(slug: str, text: str, *, actor: str = "ai", project: str | None = None) -> None:
    _req("PATCH", f"/api/board/{slug}", {"brief": text}, actor, project=project)


def mockup(slug: str, card_id: Any, name: str, title: str | None = None, *, actor: str = "ai", project: str | None = None) -> str:
    proj = project or find_project()
    file = name if name.endswith((".html", ".htm")) else f"{name}.html"
    url = f"/{proj}/mockups/{slug}/{file}"
    label = title or file[:-5]
    c = card(slug, card_id, project=project)
    md = f"[{label}]({url})"
    body = f"{c['body'].rstrip()}\n\n${md}\n" if c["body"].strip() else f"{md}\n"
    edit(slug, card_id, body=body, actor=actor, project=project)
    return url
