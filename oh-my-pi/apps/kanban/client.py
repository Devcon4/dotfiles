"""kb client shim: drive the kanban board from python (eval workflows).

Zero deps (urllib). Every read and write goes through the HTTP API, like the
`kb` CLI. The server is the one process holding the per-board write lock, and
compound edits (blockers, attachments, mockups, labels) run inside that lock,
so parallel workers can share one board without losing updates.

Usage (eval py):
    import sys; sys.path.insert(0, "<path-to-app>")
    import client as kb
    kb.ensure_up()
    c = kb.add("my-board", "Title", body="- [ ] step")
    kb.move("my-board", c["num"], "doing")

Card refs accept an id (`c12`), a number (`12`) or `#12`. Every mutation sends
`x-kb-actor: ai` unless actor="user" is passed.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

BASE = os.environ.get("KANBAN_URL", "http://localhost:5174")
CONFIG = Path(os.environ.get("APP_CONFIG_PATH", ".omp/apps/kanban.json"))
_CONFIGURED_PROJECT: str | None = None


class KbError(RuntimeError):
    """API error (message comes from the server)."""


def set_project(project: str) -> None:
    global _CONFIGURED_PROJECT
    _CONFIGURED_PROJECT = project


def find_root(cwd: Path | None = None) -> Path | None:
    d = (cwd or Path.cwd()).resolve()
    while True:
        if (d / CONFIG).exists():
            return d
        if d.parent == d:
            return None
        d = d.parent


def project_id_for(root: Path | str, timeout: float = 3.0) -> str:
    """The server's project id for an opted-in repo root; waits for a new opt-in to reach the server."""
    deadline = time.time() + timeout
    while True:
        with urllib.request.urlopen(f"{BASE}/_app/open?root={quote(str(root))}", timeout=5) as res:
            url = json.loads(res.read() or b"{}").get("url", "")
        parts = [p for p in urlparse(url).path.split("/") if p]
        if parts:
            return parts[0]
        if time.time() > deadline:
            raise KbError(f'the kanban server does not list {root}; run "kb up" from that repo')
        time.sleep(0.25)


def find_project() -> str:
    global _CONFIGURED_PROJECT
    if _CONFIGURED_PROJECT:
        return _CONFIGURED_PROJECT
    env_p = os.environ.get("KANBAN_PROJECT")
    if env_p:
        return env_p
    root = find_root()
    if root is None:
        raise KbError(f"kanban is not enabled here: no {CONFIG} at or above {Path.cwd()}")
    _CONFIGURED_PROJECT = project_id_for(root)
    return _CONFIGURED_PROJECT


def _req(method: str, path: str, body: dict | None = None, actor: str = "ai", project: str | None = None) -> Any:
    url = f"{BASE}/{project or find_project()}/api/{path}"
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


def _ref(card_id: Any) -> str:
    return quote(str(card_id).lstrip("#"))


def _clean(payload: dict) -> dict:
    return {k: v for k, v in payload.items() if v is not None}


def up() -> bool:
    try:
        with urllib.request.urlopen(f"{BASE}/_app/health", timeout=5) as res:
            return json.loads(res.read() or b"{}").get("app") == "kanban"
    except Exception:
        return False


def ensure_up(timeout: float = 30.0) -> None:
    if up():
        return
    res = subprocess.run(["kb", "up"], capture_output=True)
    if res.returncode != 0:
        raise KbError(f"failed to start kanban server: {res.stderr.decode()}")
    deadline = time.time() + timeout
    while time.time() < deadline:
        if up():
            return
        time.sleep(0.3)
    raise KbError("kanban server did not come up")


def boards(*, project: str | None = None) -> dict:
    return _req("GET", "boards", project=project)


def board(slug: str, *, project: str | None = None) -> dict:
    return _req("GET", f"board/{slug}", project=project)


def card(slug: str, card_id: Any, *, project: str | None = None) -> dict:
    b = board(slug, project=project)
    cid = str(card_id).lstrip("#")
    for c in b["cards"].values():
        if c["id"] == cid or str(c["num"]) == cid:
            return c
    raise KbError(f"card {card_id} not found in {b['slug']}")


def activity(slug: str, limit: int = 30, *, project: str | None = None) -> list[dict]:
    return _req("GET", f"board/{slug}/activity?limit={limit}", project=project)["activity"]


def search(q: str, *, project: str | None = None) -> list[dict]:
    return _req("GET", f"search?q={quote(q)}", project=project)["results"]


def template(name: str, *, project: str | None = None) -> str:
    return _req("GET", f"template/{quote(name)}", project=project)["body"]


def create_board(name: str, *, slug: str | None = None, accent: str | None = None, template: str | None = None,
                 review: bool | None = None, actor: str = "ai", project: str | None = None) -> dict:
    body = _clean({"name": name, "slug": slug, "accent": accent, "template": template, "review": review})
    return _req("POST", "boards", body, actor, project=project)["board"]


def add(slug: str, title: str, *, column: str | None = None, index: int | None = None,
        actor: str = "ai", project: str | None = None, **fields: Any) -> dict:
    payload = _clean({"title": title, "column": column, "index": index, **fields})
    return _req("POST", f"board/{slug}/cards", payload, actor, project=project)["card"]


def edit(slug: str, card_id: Any, *, actor: str = "ai", project: str | None = None, **fields: Any) -> dict:
    return _req("PATCH", f"board/{slug}/card/{_ref(card_id)}", fields, actor, project=project)["card"]


def move(slug: str, card_id: Any, column: str, index: int | None = None, *, actor: str = "ai", project: str | None = None) -> dict:
    payload = _clean({"column": column, "index": index})
    return _req("POST", f"board/{slug}/card/{_ref(card_id)}/move", payload, actor, project=project)["card"]


def complete(slug: str, card_id: Any, done: bool = True, *, actor: str = "ai", project: str | None = None) -> dict:
    return edit(slug, card_id, completed=done, actor=actor, project=project)


def archive(slug: str, card_id: Any, archived: bool = True, *,
            restore_column: str | None = None, actor: str = "ai", project: str | None = None) -> dict:
    payload = _clean({"archived": archived, "restoreColumn": restore_column})
    return _req("POST", f"board/{slug}/card/{_ref(card_id)}/archive", payload, actor, project=project)["card"]


def link(slug: str, card_id: Any, *blockers: Any, actor: str = "ai", project: str | None = None) -> dict:
    add_refs = [str(b).lstrip("#") for b in blockers]
    return _req("POST", f"board/{slug}/card/{_ref(card_id)}/blockers", {"add": add_refs}, actor, project=project)["card"]


def unlink(slug: str, card_id: Any, *blockers: Any, actor: str = "ai", project: str | None = None) -> dict:
    """Removes the given blockers; pass "all" alone to clear every blocker."""
    remove: Any = "all" if blockers == ("all",) else [str(b).lstrip("#") for b in blockers]
    return _req("POST", f"board/{slug}/card/{_ref(card_id)}/blockers", {"remove": remove}, actor, project=project)["card"]


def toggle_task(slug: str, card_id: Any, index: int, checked: bool, *, actor: str = "ai", project: str | None = None) -> dict:
    payload = {"index": index, "checked": checked}
    return _req("POST", f"board/{slug}/card/{_ref(card_id)}/task", payload, actor, project=project)["card"]


def promote(slug: str, card_id: Any, index: int, *, actor: str = "ai", project: str | None = None) -> dict:
    return _req("POST", f"board/{slug}/card/{_ref(card_id)}/promote-task", {"index": index}, actor, project=project)["card"]


def append_body(slug: str, card_id: Any, text: str, *, actor: str = "ai", project: str | None = None) -> dict:
    return _req("POST", f"board/{slug}/card/{_ref(card_id)}/append", {"text": text}, actor, project=project)["card"]


def set_brief(slug: str, text: str, *, actor: str = "ai", project: str | None = None) -> dict:
    return _req("PATCH", f"board/{slug}", {"brief": text}, actor, project=project)["board"]


def label(slug: str, label_id: str, name: str, color: str, *, actor: str = "ai", project: str | None = None) -> dict:
    return _req("PUT", f"board/{slug}/label/{quote(label_id)}", {"name": name, "color": color}, actor, project=project)["board"]


_IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}


def attach(slug: str, card_id: Any, image: str | Path, alt: str = "", *, actor: str = "ai", project: str | None = None) -> dict:
    """Uploads an image file and appends it to the card body in one server-side step. Returns {card, url}."""
    path = Path(image)
    kind = _IMAGE_TYPES.get(path.suffix.lower())
    if kind is None:
        raise KbError(f"unsupported image type {path.suffix} (png/jpg/webp/gif)")
    payload = {"name": path.name, "type": kind, "data": base64.b64encode(path.read_bytes()).decode(), "alt": alt}
    return _req("POST", f"board/{slug}/card/{_ref(card_id)}/attach", payload, actor, project=project)


def mockup(slug: str, card_id: Any, name: str, html: str, title: str | None = None, *,
           actor: str = "ai", project: str | None = None) -> dict:
    """Uploads an HTML mockup and appends a link to it on the card in one server-side step. Returns {card, url}."""
    payload = _clean({"name": name, "html": html, "title": title})
    return _req("POST", f"board/{slug}/card/{_ref(card_id)}/mockup", payload, actor, project=project)
