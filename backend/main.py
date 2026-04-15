from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import base64
import httpx
import json
import logging
import os
import re
import time
import websockets
from dotenv import load_dotenv

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  [%(levelname)s]  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("gapguard")

load_dotenv()

app = FastAPI(title="GapGuard QA Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

JIRA_BASE_URL  = os.getenv("JIRA_BASE_URL", "").rstrip("/")
JIRA_EMAIL     = os.getenv("JIRA_EMAIL", "")
JIRA_API_TOKEN = os.getenv("JIRA_API_TOKEN", "")

TFS_BASE_URL      = os.getenv("TFS_BASE_URL", "").rstrip("/")
# Collection-scoped URL = TFS_BASE_URL with the project segment stripped
# e.g. http://dev-tfs:8080/tfs/HylandCollection/OnBase -> http://dev-tfs:8080/tfs/HylandCollection
TFS_COLLECTION_URL = "/".join(TFS_BASE_URL.split("/")[:-1]) if "/" in TFS_BASE_URL else TFS_BASE_URL
TFS_PAT           = os.getenv("TFS_PAT", "")
ONBASE_LOCAL_PATH = os.getenv("ONBASE_LOCAL_PATH", "")
DIRECTLINE_SECRET = os.getenv("DIRECTLINE_SECRET", "")
DIRECTLINE_BASE   = "https://directline.botframework.com/v3/directline"

XRAY_CLIENT_ID     = os.getenv("XRAY_CLIENT_ID", "")
XRAY_CLIENT_SECRET = os.getenv("XRAY_CLIENT_SECRET", "")
XRAY_AUTH_URL      = "https://xray.cloud.getxray.app/api/v2/authenticate"
XRAY_GQL_URL       = "https://xray.cloud.getxray.app/api/v2/graphql"
_xray_token_cache: dict = {"token": None, "expiry": 0.0}


# ── JIRA helper ──────────────────────────────────────────────────────

def _extract_adf_text(node) -> str:
    """Recursively pull plain text out of an Atlassian Document Format node."""
    if not node:
        return ""
    if isinstance(node, str):
        return node
    parts = []
    if node.get("type") == "text":
        parts.append(node.get("text", ""))
    for child in node.get("content", []):
        parts.append(_extract_adf_text(child))
    return " ".join(p for p in parts if p)


# ── TFS helpers ──────────────────────────────────────────────────────

# Structural folder names that are NOT meaningful module identifiers
_SKIP_SEGMENTS = {
    "dev", "core", "rel", "src", "bin", "obj",
    "properties", "packages", "debug", "release",
    # OnBase.NET top-level structural folders — not feature modules
    "libraries", "tests", "tools", "setup", "scripts",
    "thirdparty", "third_party", "externals", "shared",
    "foundation", "common", "platform",
    # Third-party JS / vendor libraries that may appear as TFS path segments
    "jquery", "jqueryui", "angular", "angularjs", "bootstrap", "react",
    "knockout", "lodash", "underscore", "moment", "mustache", "handlebars",
    "backbone", "ember", "vue", "polymer", "vendor", "bower_components",
    "infragistics", "telerik", "devexpress", "kendo", "syncfusion",
    "artifacts", "generated", "migrations", "dist", "build", "output",
}

# File extensions that should be IGNORED when inferring modules from TFS paths
# (only analyse code files, not assets / vendor scripts)
_SKIP_EXTENSIONS = {
    ".js", ".ts", ".jsx", ".tsx", ".css", ".less", ".scss", ".sass",
    ".html", ".htm", ".min", ".map", ".json", ".lock",
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
    ".woff", ".woff2", ".ttf", ".eot",
}

# Namespace prefixes to strip when building a clean display name
_NS_PREFIXES = ("Hyland.", "OnBase.", "hyland.", "onbase.")

# ── Module map (loaded from module_map.json) ─────────────────────────
_MODULE_MAP: dict = {}
_MODULE_MAP_PATH = os.path.join(os.path.dirname(__file__), "module_map.json")
if os.path.exists(_MODULE_MAP_PATH):
    try:
        with open(_MODULE_MAP_PATH, encoding="utf-8") as _mf:
            _MODULE_MAP = json.load(_mf)
    except Exception as _me:
        pass  # non-fatal: fall back to empty map

# Pre-build lookup: lowercased-no-separator keyword → module name
# Keywords are sorted longest-first so more specific ones win
_KW_TO_MODULE: dict[str, str] = {}
for _entry in _MODULE_MAP.get("path_keywords", []):
    _mod = _entry.get("module", "")
    for _kw in _entry.get("keywords", []):
        _KW_TO_MODULE[_kw.lower().replace(".", "").replace("_", "").replace("-", "")] = _mod


def _clean_assembly_name(name: str) -> str:
    """Turn 'Hyland.WorkView.InterfaceServices' → 'WorkView.InterfaceServices'."""
    for p in _NS_PREFIXES:
        if name.startswith(p):
            name = name[len(p):]
            break
    return name


def _infer_modules(paths: list) -> list:
    """
    Extract meaningful module/component names from TFS server paths.

    Strategy (in priority order for each path):
    1. Assembly name — the segment that looks like a dotted namespace
       (e.g. 'Hyland.Core.Workview.Services', 'Hyland.WorkView.InterfaceServices')
       stripped of the 'Hyland.' prefix.
    2. First non-structural folder after 'onbase.net/' that isn't in _SKIP_SEGMENTS.

    Example inputs → outputs:
      $/OnBase/DEV/Core/OnBase.NET/Libraries/Hyland.Core.Workview.Services/Canvas/ObjectService.cs
        → 'Core.Workview.Services'
      $/OnBase/DEV/Core/OnBase.NET/WorkView/Hyland.WorkView.InterfaceServices/Services/ItemListEntryService.cs
        → 'WorkView.InterfaceServices'
    """
    modules = set()
    for path in paths:
        normalized = path.replace("\\", "/")
        marker = "onbase.net/"
        idx = normalized.lower().find(marker)
        if idx == -1:
            # Fallback: use the last meaningful directory segment
            parts = [s for s in normalized.split("/") if s and not s.lower().endswith(
                (".cs", ".xml", ".config", ".sln", ".csproj", ".json", ".md", ".resx"))]
            if parts:
                modules.add(parts[-1])
            continue

        segments = [s for s in normalized[idx + len(marker):].split("/") if s]

        # Pass 1 — find the first dotted-namespace assembly segment
        assembly_found = False
        for seg in segments:
            if seg.endswith((".cs", ".xml", ".config", ".sln", ".csproj",
                             ".json", ".md", ".txt", ".resx")):
                break
            if "." in seg and not seg.startswith("."):
                modules.add(_clean_assembly_name(seg))
                assembly_found = True
                break

        if assembly_found:
            continue

        # Pass 2 — fall back to first non-structural non-file folder
        for seg in segments:
            low = seg.lower()
            if low in _SKIP_SEGMENTS:
                continue
            if seg.endswith((".cs", ".xml", ".config", ".sln", ".csproj",
                             ".json", ".md", ".txt", ".resx")):
                break
            modules.add(seg)
            break

    return sorted(modules)


def _tfs_to_local(tfs_path: str, local_base: str):
    """Map a TFS server path to the local OnBase.NET workspace path."""
    normalized = tfs_path.replace("\\", "/")
    marker = "onbase.net/"
    idx = normalized.lower().find(marker)
    if idx == -1:
        return None
    relative = normalized[idx + len(marker):].replace("/", os.sep)
    return os.path.join(local_base, relative)


# PascalCase / camelCase word splitter
_PASCAL_RE = re.compile(r'(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])')

# Words that mean nothing on their own (structural / plumbing)
_CODE_STOPWORDS = {
    # generic OOP plumbing
    "service", "services", "provider", "providers", "interface", "interfaces",
    "manager", "factory", "handler", "helper", "base", "impl", "implementation",
    "controller", "repository", "data", "access", "entry", "model", "models",
    "object", "objects", "class", "type", "item", "items", "list", "result",
    "request", "response", "event", "args", "info", "context", "config",
    "serializer", "deserializer", "builder", "element", "node", "value",
    "session", "folder", "keyword", "legacy",
    # OnBase / Hyland namespace words that aren't feature names on their own
    "hyland", "onbase", "core", "common", "shared", "canvas", "workview",
    "client", "unity", "web", "api", "rest",
    # assembly/namespace structural suffixes that leak through
    "interfaceservices", "legacyworkview", "applicationprovider",
    # short generic words that are fine inside compound labels but not on their own
    "work", "view", "form", "page", "tab", "row", "col", "key", "val",
    "app", "ext", "num", "max", "min", "log", "msg", "err", "sql",
    "get", "set", "add", "put", "post", "delete", "remove", "create", "update",
    "record", "save", "load", "build", "init", "initialize", "reset", "clear",
    "send", "read", "write", "fetch", "push", "pop", "check", "validate",
    "is", "has", "can", "try", "run", "execute", "process", "handle",
}


def _split_pascal(name: str) -> list:
    """Split 'RecentlyViewed' → ['Recently', 'Viewed']; 'IItemListEntry' → ['Item', 'List', 'Entry']."""
    # strip leading 'I' for interfaces, leading '_' for private fields
    name = name.lstrip('_')
    if name.startswith('I') and len(name) > 1 and name[1].isupper():
        name = name[1:]
    return _PASCAL_RE.split(name)


def _infer_features_from_snippets(files: list) -> list:
    """
    Analyse C# code snippets to surface human-readable feature/domain names.

    Sources parsed (in priority order):
    1. namespace declarations  → e.g. 'namespace Hyland.WorkView.InterfaceServices.Services'
    2. class / interface names → e.g. 'class ItemListEntryService'
    3. Field / method identifiers that contain multi-word domain concepts
       → e.g. '_recentlyViewedSerializer', 'RecordAsRecentlyViewed'

    The function splits PascalCase/camelCase tokens into words, strips stopwords,
    and re-joins consecutive meaningful words into a feature label:
       ['Recently', 'Viewed'] → 'Recently Viewed'
       ['Item', 'List', 'Entry'] → 'Item List Entry'
    """
    namespace_re  = re.compile(r'\bnamespace\s+([\w.]+)')
    class_re      = re.compile(r'\b(?:class|interface|enum)\s+(\w+)')
    identifier_re = re.compile(r'\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b')

    features: dict[str, int] = {}   # label → occurrence count

    def _register(words: list):
        """Filter stopwords and register a label if ≥2 meaningful words remain."""
        meaningful = [w for w in words if w.lower() not in _CODE_STOPWORDS and len(w) > 2]
        if len(meaningful) >= 2:
            label = " ".join(meaningful)
            features[label] = features.get(label, 0) + 1
        elif len(meaningful) == 1 and len(meaningful[0]) > 8:  # e.g. 'Favorites' but not 'Canvas'
            label = meaningful[0]
            features[label] = features.get(label, 0) + 1

    for f in files:
        snippet = f.get("snippet") or ""
        if not snippet:
            continue

        # 1. Namespace → e.g. 'Hyland.WorkView.InterfaceServices.Services'
        for m in namespace_re.finditer(snippet):
            ns = m.group(1)
            for p in _NS_PREFIXES:
                if ns.startswith(p):
                    ns = ns[len(p):]
                    break
            parts = ns.split(".")
            # Take last 2 non-stopword segments as module label
            meaningful = [p for p in parts if p.lower() not in _CODE_STOPWORDS]
            if meaningful:
                label = ".".join(meaningful[-2:]) if len(meaningful) >= 2 else meaningful[-1]
                features[label] = features.get(label, 0) + 3  # weight namespaces higher

        # 2. Class / interface names
        for m in class_re.finditer(snippet):
            _register(_split_pascal(m.group(1)))

        # 3. All PascalCase compound identifiers (fields, methods, properties)
        for m in identifier_re.finditer(snippet):
            _register(_split_pascal(m.group(1)))

    # Return labels sorted by occurrence (most frequent first), deduplicated
    seen_lower: set = set()
    result = []
    for label, _ in sorted(features.items(), key=lambda x: -x[1]):
        key = label.lower().replace(" ", "").replace(".", "")
        if key not in seen_lower:
            seen_lower.add(key)
            result.append(label)
    return result


def _extract_delimited(text: str, tag: str) -> str:
    """Extract content between ---TAG_START--- and ---TAG_END--- delimiters."""
    start_marker = f"---{tag}_START---"
    end_marker   = f"---{tag}_END---"
    s = text.find(start_marker)
    e = text.find(end_marker)
    if s == -1 or e == -1:
        return ""
    return text[s + len(start_marker):e].strip()


# ── Test Case Generation helpers ───────────────────────────────────

def _parse_tc_pipe(text: str) -> list:
    """
    Parse pipe-delimited test cases returned by Copilot Studio.

    Expected format (one per line):
      TC-001 | Test case title | Step 1;Step 2;Step 3 | Expected result | High

    Tolerates minor variations: extra whitespace, lowercase tc, missing priority.
    """
    results = []
    for line in text.splitlines():
        line = line.strip()
        if not re.match(r'(?i)^tc-?\d+\s*\|', line):
            continue
        parts = [p.strip() for p in line.split('|')]
        if len(parts) < 4:
            continue
        tc_id    = re.sub(r'\s+', '', parts[0]).upper()          # "TC-001"
        title    = parts[1]
        steps    = [s.strip() for s in parts[2].split(';') if s.strip()] or [parts[2]]
        expected = parts[3]
        raw_pri  = (parts[4] if len(parts) > 4 else 'Medium').lower()
        priority = 'High' if 'high' in raw_pri else 'Low' if 'low' in raw_pri else 'Medium'
        # Skip obviously malformed / header rows
        if len(title) < 5 or title.lower() in ('title', 'test case title', 'test title', ''):
            continue
        results.append({
            'id':       tc_id,
            'title':    title,
            'steps':    steps,
            'expected': expected,
            'priority': priority,
            'module':   '',   # filled in by caller
        })
    return results


async def _directline_converse(prompt: str, label: str) -> str:
    """
    DirectLine helper using WebSocket streaming (required for Copilot Studio bots).
    Start conversation → connect WebSocket → send prompt via HTTP → receive reply on WS.
    Raises HTTPException on hard failures, returns "" on timeout.
    """
    if not DIRECTLINE_SECRET:
        raise HTTPException(status_code=500, detail="DIRECTLINE_SECRET not configured")

    dl_headers = {
        "Authorization": f"Bearer {DIRECTLINE_SECRET}",
        "Content-Type":  "application/json",
    }
    # ── Step 1: Start conversation ──────────────────────────────────────────
    async with httpx.AsyncClient() as client:
        try:
            conv_r = await client.post(
                f"{DIRECTLINE_BASE}/conversations",
                headers=dl_headers, timeout=15.0,
            )
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"[{label}] Cannot reach DirectLine: {exc}")

        if conv_r.status_code not in (200, 201):
            raise HTTPException(status_code=conv_r.status_code,
                                detail=f"[{label}] Failed to start conversation: {conv_r.text}")

        conv_data = conv_r.json()
        conv_id   = conv_data["conversationId"]
        token     = conv_data.get("token", DIRECTLINE_SECRET)
        stream_url = conv_data.get("streamUrl", "")
        dl_headers["Authorization"] = f"Bearer {token}"
        log.info("[%s] Conversation started: %s  streamUrl=%s", label, conv_id,
                 "yes" if stream_url else "no")

    # ── Step 2: Connect WebSocket + send prompt concurrently ────────────────
    reply_future: asyncio.Future = asyncio.get_event_loop().create_future()

    async def _listen_ws():
        """Connect to the DirectLine WebSocket stream and wait for a bot message."""
        ws_url = stream_url or (
            f"wss://directline.botframework.com/v3/directline/conversations/{conv_id}/stream"
            f"?watermark=-&t={token}"
        )
        try:
            async with websockets.connect(
                ws_url,
                additional_headers={"Authorization": f"Bearer {token}"},
                open_timeout=15,
                ping_interval=20,
            ) as ws:
                log.info("[%s] WebSocket connected", label)
                async for raw in ws:
                    if not raw:  # keep-alive empty frame
                        continue
                    try:
                        payload = json.loads(raw)
                    except Exception:
                        continue
                    for act in payload.get("activities", []):
                        atype = act.get("type", "")
                        role  = act.get("from", {}).get("role", "")
                        aname = act.get("name", "")
                        log.info("[%s] WS activity: type=%s role=%s name=%s text_len=%d",
                                 label, atype, role, aname, len(act.get("text") or ""))

                        # Detect connection manager card (OAuth required)
                        if aname == "connectors/connectionManagerCard" or (
                            atype == "message" and role == "bot" and not act.get("text") and
                            any("connectionManagerCard" in str(a)
                                for a in act.get("attachments") or [])
                        ):
                            if not reply_future.done():
                                reply_future.set_exception(
                                    HTTPException(
                                        status_code=424,
                                        detail=(
                                            "Copilot Studio requires OAuth sign-in for its knowledge source. "
                                            "Fix in Copilot Studio: Knowledge → remove connected source → "
                                            "upload MRG files directly → Save → Publish."
                                        ),
                                    )
                                )
                            return

                        if atype == "message" and role == "bot":
                            text = act.get("text") or ""
                            if text and not reply_future.done():
                                log.info("[%s] WS bot reply received (%d chars)", label, len(text))
                                reply_future.set_result(text)
                                return
        except Exception as ws_exc:
            log.warning("[%s] WebSocket error: %s", label, ws_exc)
            if not reply_future.done():
                reply_future.set_exception(
                    HTTPException(status_code=502, detail=f"[{label}] WebSocket error: {ws_exc}")
                )

    async def _send_msg():
        """Send the user prompt via HTTP after a brief delay (let WS connect first)."""
        await asyncio.sleep(1.5)
        async with httpx.AsyncClient() as client:
            msg_r = await client.post(
                f"{DIRECTLINE_BASE}/conversations/{conv_id}/activities",
                headers=dl_headers,
                json={"type": "message", "from": {"id": "gapguard-backend"}, "text": prompt},
                timeout=15.0,
            )
            if msg_r.status_code not in (200, 201):
                if not reply_future.done():
                    reply_future.set_exception(
                        HTTPException(status_code=msg_r.status_code,
                                      detail=f"[{label}] Failed to send message")
                    )
                return
            log.info("[%s] Prompt sent via HTTP (%d chars)", label, len(prompt))

    # Run WS listener + HTTP send concurrently; timeout after 45s
    ws_task   = asyncio.create_task(_listen_ws())
    send_task = asyncio.create_task(_send_msg())
    try:
        await asyncio.wait_for(asyncio.shield(reply_future), timeout=45.0)
    except asyncio.TimeoutError:
        log.warning("[%s] No bot reply after 45s", label)
        ws_task.cancel()
        send_task.cancel()
        return ""
    finally:
        ws_task.cancel()
        send_task.cancel()
        await asyncio.gather(ws_task, send_task, return_exceptions=True)

    # Propagate exceptions (e.g. HTTPException for connectionManagerCard)
    if reply_future.exception():
        raise reply_future.exception()
    return reply_future.result()


def _generate_tcs_fallback(jira: dict, tfs: dict, existing_summaries: list | None = None) -> list:
    """
    Local fallback TC generator used when Copilot Studio is unavailable.

    Strategy:
    1. Parse numbered/bulleted scenarios from jira['test_recommendation'] if present.
    2. If too few were found, synthesise generic smoke + regression TCs from the
       JIRA title and impacted modules list.

    Targets 10 TCs (from 6) to match the enriched Copilot-generated set.
    """
    modules_list  = tfs.get("impacted_modules",  []) or []
    features_list = tfs.get("impacted_features", []) or []
    module_label  = modules_list[0] if modules_list else "General"
    jira_title    = jira.get("title", "").strip()
    rec_raw       = (jira.get("test_recommendation") or "").strip()

    # ── Step 1: extract actual test scenarios from test_recommendation ──────
    # Skip document section headers like [Overview of Change], [Setup Notes],
    # [Detailed Description] — these are structural labels, not test cases.
    _header_re = re.compile(
        r'^(\[.*?\]|overview|setup\s*notes?|detailed\s*description|testing\s*scenarios?'
        r'|impacts?|unaffected|architectural|other\s*affected|background)',
        re.IGNORECASE,
    )
    # Only treat colon-style lines as TCs when the rest contains an action verb
    _action_re = re.compile(
        r'\b(verify|confirm|ensure|check|assert|validate|test|observe)\b',
        re.IGNORECASE,
    )

    scenarios: list[str] = []

    # Pass 1: bullet/numbered lines — the most reliable test scenario format
    for line in rec_raw.splitlines():
        line = line.strip()
        m = re.match(r'^(?:\d+[\.\)\s]|[-•*]\s)', line)
        if m:
            text = line[m.end():].strip()
            if len(text) > 15 and not _header_re.match(text):
                scenarios.append(text)

    # Pass 2: colon-style lines "Configured Max Value = 0: Verify..."
    # Only capture when REST part contains an actionable verb.
    for line in re.split(r'(?<=[.!?])\s+|\n', rec_raw):
        line = line.strip()
        if ':' not in line or len(line) < 20:
            continue
        label, _, rest = line.partition(':')
        label = label.strip()
        rest  = rest.strip()
        if _header_re.match(label) or len(label) > 70 or len(rest) < 10:
            continue
        if not _action_re.search(rest):
            continue
        combined = f"{label} — {rest}"
        if not any(combined[:40] in s for s in scenarios) and len(scenarios) < 12:
            scenarios.append(combined)

    # ── Step 2: convert scenarios → TC dicts ──────────────────────────────
    priorities = ["High", "High", "Medium", "Medium", "Medium", "Medium", "Low", "Low", "Low", "Low"]
    tcs: list[dict] = []
    for i, scenario in enumerate(scenarios[:10]):
        tc_id = f"TC-{i+1:03d}"
        title = scenario[:120]
        tcs.append({
            "id":       tc_id,
            "title":    title,
            "steps":    [
                f"Navigate to the {module_label} module",
                f"Set up the test condition: {title[:60]}",
                "Perform the action under test",
                "Observe the result",
            ],
            "expected": f"System behaves as per requirement: {title[:80]}",
            "priority": priorities[i % len(priorities)],
            "module":   modules_list[i % len(modules_list)] if modules_list else "General",
            "source":   "fallback",
        })

    # ── Step 3: pad to 10 with templated TCs if fewer scenarios were found ─
    generic_templates = [
        ("[EDGE CASE] Verify behavior with no summaries configured",               "High"),
        ("[BOUNDARY] Verify summary with maximum number of columns",               "High"),
        ("[NEGATIVE] Verify invalid filter state is gracefully rejected",          "Medium"),
        ("[PERSISTENCE] Verify summary state persists after session logout/login", "Medium"),
        ("[REGRESSION] Verify filter sorting is unaffected by summary changes",    "Medium"),
        ("[EDGE CASE] Verify summary toggle with a single-column filter",          "Medium"),
        ("[NEGATIVE] Verify that Reset Filter clears all saved summaries",         "High"),
        ("[BOUNDARY] Verify behavior when all summary types are enabled at once",  "Low"),
        ("[PERSISTENCE] Verify summary settings survive application restart",      "Low"),
        ("[REGRESSION] Verify existing functionality unaffected by this change",   "Low"),
    ]
    while len(tcs) < 10:
        idx = len(tcs)
        label, pri = generic_templates[idx]
        tcs.append({
            "id":       f"TC-{idx+1:03d}",
            "title":    f"{label}: {jira_title[:60]}",
            "steps":    [
                f"Set up the {module_label} environment",
                "Trigger the scenario",
                "Observe outcome",
            ],
            "expected": "Outcome matches expected behavior per JIRA specification",
            "priority": pri,
            "module":   modules_list[idx % len(modules_list)] if modules_list else "General",
            "source":   "fallback",
        })

    log.info("[TC-GEN] Fallback generated %d TCs from local data", len(tcs))
    return tcs


async def _generate_test_cases(
    jira: dict,
    tfs: dict,
    mrg_content: str,
    existing_summaries: list | None = None,
) -> list:
    """
    Send a structured generation prompt to Copilot Studio and parse the response
    into a list of test case dicts: {id, title, steps[], expected, priority, module}.

    Prompt strategy:
      - Cap MRG at 1200 chars (gives the bot richer documentation context)
      - Cap test_recommendation at 600 chars (captures detailed scenario steps)
      - Cap TFS comment at 200 chars
      - Pass existing XRAY test summaries so the bot does NOT duplicate them
      - Ask for EXACTLY 10 TCs covering edge/boundary/negative/persistence/regression
      - Ground every TC in the MRG content (reduces hallucination)
    """
    modules_list  = tfs.get("impacted_modules",  []) or []
    features_list = tfs.get("impacted_features", []) or []
    modules_str   = ", ".join(modules_list)  or "N/A"
    features_str  = ", ".join(features_list[:8]) if features_list else ""
    test_rec      = (jira.get("test_recommendation") or "").strip()[:600]
    tfs_comment   = (tfs.get("comment") or "").strip()[:200]
    mrg_cap       = (mrg_content or "").strip()[:1200]

    # Build the "do not duplicate" section from XRAY-linked summaries
    existing_block = ""
    if existing_summaries:
        lines = "\n".join(f"  - {s}" for s in existing_summaries[:15])
        existing_block = (
            "\n--- EXISTING TESTS ALREADY IN XRAY (DO NOT DUPLICATE) ---\n"
            + lines + "\n"
        )

    prompt = (
        "You are a senior QA engineer for the OnBase (Hyland) product.\n\n"
        "--- CHANGE CONTEXT ---\n"
        f"JIRA: {jira.get('title', '')}\n"
        f"Description: {(jira.get('description') or '')[:300]}\n"
        f"Code change: {tfs_comment}\n"
        f"Impacted modules: {modules_str}\n"
        + (f"Code features: {features_str}\n" if features_str else "")
        + (f"QA engineer recommendation:\n{test_rec}\n" if test_rec else "")
        + "\n--- PRODUCT DOCUMENTATION (MRG) ---\n"
        + mrg_cap
        + existing_block
        + "\n\n--- TASK ---\n"
        "Generate exactly 10 NEW test cases that COMPLEMENT (do not duplicate) "
        "the existing tests listed above.\n"
        "Distribute across these categories (2 per category):\n"
        "  EDGE CASE    — unusual value combinations, empty states, single-item states\n"
        "  BOUNDARY     — min/max configured values, zero counts, maximum limits\n"
        "  NEGATIVE     — invalid operations, error recovery, rejected inputs\n"
        "  PERSISTENCE  — state across sessions, after Reset Filter, mixed save/clear\n"
        "  REGRESSION   — adjacent features that could be inadvertently broken\n\n"
        "Each test case must:\n"
        "  - Be directly traceable to the MRG documentation and/or QA recommendation\n"
        "  - Test a scenario NOT covered by any existing test listed\n"
        "  - Include concrete steps grounded in the OnBase Unity Client UI\n"
        "  - Be labelled with its category in the title prefix, e.g. '[EDGE CASE] ...'\n\n"
        "Return ONLY the test cases in this EXACT format, one per line, no extra text:\n"
        "TC-001 | Test case title | Step 1;Step 2;Step 3 | Expected result | High\n"
        "TC-002 | Test case title | Step 1;Step 2 | Expected result | Medium\n"
    )

    log.info("[TC-GEN] Generation prompt: %d chars  modules=%s  existing=%d",
             len(prompt), modules_str, len(existing_summaries or []))

    try:
        reply = await _directline_converse(prompt, "TC-GEN")
    except HTTPException as exc:
        log.warning("[TC-GEN] DirectLine error: %s — using fallback", exc.detail)
        return _generate_tcs_fallback(jira, tfs, existing_summaries)
    except Exception as exc:
        log.warning("[TC-GEN] Unexpected error: %s — using fallback", exc)
        return _generate_tcs_fallback(jira, tfs, existing_summaries)

    if not reply:
        log.warning("[TC-GEN] Empty reply from Copilot Studio")
        return _generate_tcs_fallback(jira, tfs, existing_summaries)

    # Detect bot quota/availability errors — fall back to local generation
    _bot_errors = ("usage limit", "currently unavailable", "try again later", "not available")
    if any(phrase in reply.lower() for phrase in _bot_errors):
        log.warning("[TC-GEN] Bot unavailable (%r). Using local fallback.", reply[:120])
        return _generate_tcs_fallback(jira, tfs, existing_summaries)

    parsed = _parse_tc_pipe(reply)
    log.info("[TC-GEN] Parsed %d test cases", len(parsed))

    if not parsed:
        log.warning("[TC-GEN] Pipe parse returned 0 — using local fallback")
        return _generate_tcs_fallback(jira, tfs, existing_summaries)

    # Assign impacted module to each TC round-robin
    for i, tc in enumerate(parsed):
        tc["module"] = modules_list[i % len(modules_list)] if modules_list else "General"

    return parsed


# ── XRAY gap analysis ────────────────────────────────────────────────

async def _xray_authenticate() -> str:
    """Return a cached XRAY Cloud bearer token (valid ~50 min)."""
    now = time.time()
    if _xray_token_cache["token"] and now < _xray_token_cache["expiry"]:
        return _xray_token_cache["token"]
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            XRAY_AUTH_URL,
            json={"client_id": XRAY_CLIENT_ID, "client_secret": XRAY_CLIENT_SECRET},
        )
        r.raise_for_status()
        token = r.text.strip().strip('"')
        _xray_token_cache.update({"token": token, "expiry": now + 3000})
        log.info("[XRAY] Authenticated OK (token len=%d)", len(token))
        return token


async def _xray_search_candidates(
    token: str, jira_id: str, generated_tcs: list, jira_data: dict | None = None,
    tfs_data: dict | None = None,
) -> list:
    """
    Folder-detection search strategy:

    Phase 1 — Broad keyword search using JIRA title + TC titles.
               Finds ~10-30 candidate tests across the project.

    Phase 2 — Folder detection: find the most common non-root folder
               in Phase-1 results. In SBPWC, XRAY folders are typically
               named "SBPWC-XXXXX - Feature Description" so the correct
               folder naturally floats to the top.

    Phase 3 — Folder expansion: if a dominant folder was found, fetch ALL
               tests in that exact folder (up to 100) so no tests are missed.

    Phase 4 — JIRA-linked fallback: also check 'issue = <jira_id>' for
               directly linked tests (rarely populated but cheap to check).

    Returns Tier-1 (folder tests) first, then keyword extras.
    """
    from collections import Counter

    _stop = {
        "verify", "check", "ensure", "test", "that", "when", "the", "a", "an",
        "is", "are", "not", "with", "for", "in", "on", "of", "to", "and", "or",
        "does", "should", "will", "can", "then", "if", "be", "after", "before",
        "user", "users", "item", "items", "value", "values", "list", "object",
        "negative", "accessibility", "keyboard", "navigation", "multiple",
        "default", "confirm", "attempt", "validate", "persist", "persists",
        "setting", "settings", "option", "options", "button", "window", "page",
        # Product/platform names — too general to be useful in XRAY JQL
        "workview", "onbase", "unity", "hyland",
    }
    project = jira_id.split("-")[0] if "-" in jira_id else "SBPWC"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # ── Helper: run a JQL string against XRAY GraphQL ─────────────────────────
    async def _gql_tests(jql: str, limit: int = 50) -> list:
        gql_q = (
            '{ getTests(jql: "'
            + jql.replace("\\", "\\\\").replace('"', '\\"')
            + f'", limit: {limit}, start: 0) '
            + '{ results { jira(fields: ["key","summary"]) folder { path } } } }'
        )
        log.info("[XRAY] JQL: %s", jql)
        async with httpx.AsyncClient(timeout=60) as client:
            try:
                r = await client.post(XRAY_GQL_URL, json={"query": gql_q}, headers=headers)
            except Exception as exc:
                log.warning("[XRAY] Request failed: %s", exc)
                return []
        if r.status_code != 200:
            log.warning("[XRAY] HTTP %d: %s", r.status_code, r.text[:200])
            return []
        d = r.json()
        if "errors" in d:
            log.warning("[XRAY] GQL errors: %s", d["errors"])
            return []
        results = d.get("data", {}).get("getTests", {}).get("results", [])
        out: list = []
        seen: set = set()
        for t in results:
            ji = t.get("jira") or {}
            key = ji.get("key", "")
            if key and key not in seen:
                seen.add(key)
                raw_folder = (t.get("folder") or {}).get("path", "/")
                out.append({
                    "key":     key,
                    "summary": ji.get("summary", ""),
                    "folder":  raw_folder if raw_folder and raw_folder != "/" else "",
                })
        return out

    # ── Phase 0: JIRA-directly-linked XRAY tests (highest-confidence ground truth) ──
    # Fetch test cases that are explicitly linked to this JIRA card via "is tested by".
    # These bypass keyword-based search entirely and are placed first in candidates.
    jira_linked_keys = (jira_data.get("xray_test_keys") or []) if jira_data else []
    phase0: list = []
    if jira_linked_keys:
        keys_list = ", ".join(jira_linked_keys[:50])
        phase0 = await _gql_tests(f"project = {project} AND key in ({keys_list})", limit=50)
        log.info("[XRAY] Phase-0 (JIRA-linked %d keys): %d tests found", len(jira_linked_keys), len(phase0))

    # ── Phase 1: Keyword search ────────────────────────────────────────────────
    # Build keyword and phrase sets from JIRA title (highest signal) and TC titles.
    # Bigrams (2-word phrases) provide far more specific phrase searches than
    # individual words, e.g. summary ~ "recently viewed" vs summary ~ "recently".
    jira_title = (jira_data.get("title") or "") if jira_data else ""
    jira_words_raw = re.sub(r"[^\w\s]", " ", jira_title.lower()).split()

    # Single keywords from JIRA title (len > 4, not in stop)
    jira_title_kws: list = [w for w in jira_words_raw if len(w) > 4 and w not in _stop]

    # Bigrams: consecutive word pairs where BOTH are non-stop and len > 3.
    # e.g. "recently viewed items does not respect reduction of maximum value"
    #      → ["recently viewed", "respect reduction", "reduction maximum"]
    bigrams: list = []
    for i in range(len(jira_words_raw) - 1):
        w1, w2 = jira_words_raw[i], jira_words_raw[i + 1]
        if len(w1) > 3 and len(w2) > 3 and w1 not in _stop and w2 not in _stop:
            bigrams.append(f"{w1} {w2}")

    # TC-title bigrams: generated TCs capture domain-specific phrases the JIRA
    # title may miss (e.g. 'filter summary' → finds /Filters/Filter Runtime
    # even when JIRA title bigrams only surface an unrelated folder).
    tc_bigrams: list = []
    _bigrams_set = set(bigrams)
    for _tc in generated_tcs:
        _tc_words = re.sub(r"[^\w\s]", " ", _tc.get("title", "").lower()).split()
        for i in range(len(_tc_words) - 1):
            w1, w2 = _tc_words[i], _tc_words[i + 1]
            if (len(w1) > 3 and len(w2) > 3
                    and w1 not in _stop and w2 not in _stop):
                _bg = f"{w1} {w2}"
                if _bg not in _bigrams_set and _bg not in tc_bigrams:
                    tc_bigrams.append(_bg)

    # All keywords: JIRA title + TC titles + TC modules + TFS impacted features
    all_kws: set = set(jira_title_kws)
    for tc in generated_tcs:
        all_kws.update(w for w in re.sub(r"[^\w\s]", "", tc.get("title", "").lower()).split()
                       if len(w) > 4 and w not in _stop)
        all_kws.update(w for w in re.sub(r"[^\w\s]", " ", tc.get("module", "").lower()).split()
                       if len(w) > 4 and w not in _stop)
    # TFS impacted features add domain-specific words (e.g. 'filter', 'column', 'presenter')
    tfs_feature_words: list = []
    if tfs_data:
        for feat in (tfs_data.get("impacted_features") or []):
            words = [w for w in re.sub(r"[^\w\s]", " ", feat.lower()).split()
                     if len(w) > 3 and w not in _stop]
            all_kws.update(words)
            tfs_feature_words.extend(words)
        for mod in (tfs_data.get("impacted_modules") or []):
            all_kws.update(w for w in re.sub(r"[^\w\s]", " ", mod.lower()).split()
                           if len(w) > 3 and w not in _stop)

    top_jira_kws = sorted(jira_title_kws, key=lambda w: -len(w))[:3]
    top_all_kws  = sorted(all_kws,        key=lambda w: -len(w))[:6]
    log.info("[XRAY] Bigrams: %s  JIRA-kws: %s  all-kws: %s  tfs-feat-words: %s",
             bigrams, top_jira_kws, top_all_kws, tfs_feature_words[:6])

    phase1: list = []

    # Phase 1a — try each bigram (+ support kw AND) until one returns results.
    # e.g. "recently viewed" AND "maximum" beats "workview recently" AND ...
    # Expanded to 6 bigrams so domain-specific ones like "save filter" aren't skipped.
    winning_bigram: str | None = None
    for bg in bigrams[:6]:
        bg_words   = set(bg.split())
        support_kw = next((k for k in top_jira_kws if k not in bg_words), None)
        jql1a = (f'project = {project} AND summary ~ "{bg}"'
                 + (f' AND summary ~ "{support_kw}"' if support_kw else ""))
        res = await _gql_tests(jql1a, limit=40)
        log.info("[XRAY] Phase-1a (bigram '%s' + kw '%s'): %d tests", bg, support_kw, len(res))
        if res:
            phase1 = res
            winning_bigram = bg
            break

    # Phase 1b — try each bigram alone (no AND), wider net
    if len(phase1) < 5:
        for bg in bigrams[:6]:
            res = await _gql_tests(f'project = {project} AND summary ~ "{bg}"', limit=40)
            log.info("[XRAY] Phase-1b (bigram '%s' alone): %d tests", bg, len(res))
            if res:
                seen1 = {t["key"] for t in phase1}
                phase1 += [t for t in res if t["key"] not in seen1]
                if not winning_bigram:
                    winning_bigram = bg
                if len(phase1) >= 5:
                    break

    # Phase 1c — top-2 single JIRA keywords AND (when no bigrams found anything)
    if len(phase1) < 5 and len(top_jira_kws) >= 2:
        and_jql = " AND ".join(f'summary ~ "{k}"' for k in top_jira_kws[:2])
        phase1_c = await _gql_tests(f"project = {project} AND ({and_jql})", limit=30)
        seen1 = {t["key"] for t in phase1}
        phase1 += [t for t in phase1_c if t["key"] not in seen1]
        log.info("[XRAY] Phase-1c (kw AND): now %d tests", len(phase1))

    # Phase 1d — OR across top_all_kws (widest net as last resort)
    if len(phase1) < 5 and top_all_kws:
        or_jql = " OR ".join(f'summary ~ "{k}"' for k in top_all_kws[:5])
        phase1_d = await _gql_tests(f"project = {project} AND ({or_jql})", limit=30)
        seen1 = {t["key"] for t in phase1}
        phase1 += [t for t in phase1_d if t["key"] not in seen1]
        log.info("[XRAY] Phase-1d (OR fallback): now %d tests", len(phase1))

    # Phase 1e — TFS feature words (always run: module/path names are ground-truth
    # domain signals independent of JIRA title vocabulary, e.g. 'filter' → /Filters/...)
    if tfs_feature_words:
        # Deduplicate and take top 4 shortest (most precise domain words)
        feat_kws = sorted(set(tfs_feature_words), key=len)[:4]
        or_jql_e = " OR ".join(f'summary ~ "{k}"' for k in feat_kws)
        phase1_e = await _gql_tests(f"project = {project} AND ({or_jql_e})", limit=30)
        seen1 = {t["key"] for t in phase1}
        phase1 += [t for t in phase1_e if t["key"] not in seen1]
        log.info("[XRAY] Phase-1e (TFS feature words %s): now %d tests", feat_kws, len(phase1))

    # Phase 1f — TC-title bigrams (generated TC phrases often match XRAY test summaries
    # better than the JIRA title; e.g. 'filter summary' from
    # 'Verify filter summary persists...' correctly surfaces /Filters/Filter Runtime)
    if len(phase1) < 15 and tc_bigrams:
        for _bg in tc_bigrams[:6]:
            if len(phase1) >= 15:
                break
            _res1f = await _gql_tests(f'project = {project} AND summary ~ "{_bg}"', limit=40)
            log.info("[XRAY] Phase-1f (TC bigram '%s'): %d tests", _bg, len(_res1f))
            if _res1f:
                seen1 = {t["key"] for t in phase1}
                phase1 += [t for t in _res1f if t["key"] not in seen1]

    log.info("[XRAY] Phase-1 total: %d tests", len(phase1))

    # ── Phase 2: Folder detection ─────────────────────────────────────────────
    best_folder: str | None = None

    # Strategy 0: most common folder among JIRA-directly-linked tests.
    # These tests were put there by a human so their folder is the strongest signal.
    if phase0:
        _p0_folders = [t.get("folder") for t in phase0
                       if t.get("folder") and t["folder"] not in ("/", "")]
        if _p0_folders:
            best_folder = Counter(_p0_folders).most_common(1)[0][0]
            log.info("[XRAY] Phase-2 via JIRA-linked tests folder: %r", best_folder)

    # Strategy 1: folder path contains the JIRA card ID
    if not best_folder:
        for t in phase1:
            folder = t.get("folder", "")
            if folder and jira_id in folder:
                best_folder = folder
                log.info("[XRAY] Phase-2 via JIRA ID in path: %r", best_folder)
                break

    # Strategy 2 (works even when folders have no JIRA ID):
    # Score each unique non-root folder by keyword-coverage — how many distinct
    # reference keywords (from JIRA title + TC titles) appear across all tests
    # in that folder. The 'right' folder's tests will mention the most feature-
    # specific words, even if the folder itself has a different name.
    if not best_folder:
        # Build reference keyword set (same stop list as above)
        ref_kws: set = set()
        if jira_data:
            ref_kws.update(
                w for w in re.sub(r"[^\w\s]", "", (jira_data.get("title") or "").lower()).split()
                if len(w) > 3 and w not in _stop
            )
        for tc in generated_tcs:
            ref_kws.update(
                w for w in re.sub(r"[^\w\s]", "", tc.get("title", "").lower()).split()
                if len(w) > 3 and w not in _stop
            )

        # Group phase-1 tests by folder
        from collections import defaultdict
        folder_groups: dict = defaultdict(list)
        for t in phase1:
            if t.get("folder") and t["folder"] not in ("/", ""):
                folder_groups[t["folder"]].append(t)

        # Score = keyword_coverage × match_density
        #   keyword_coverage: how many distinct ref keywords appear in the folder's
        #     combined test text (feature specificity)
        #   match_density: fraction of the folder's tests that contain ≥1 ref keyword
        #     (prevents a large generic folder swamping a small focused one)
        folder_scores: dict = {}
        for folder, tests in folder_groups.items():
            combined_text = " ".join(t.get("summary", "") for t in tests).lower()
            folder_kws = {w for w in re.sub(r"[^\w\s]", "", combined_text).split()
                          if len(w) > 3 and w not in _stop}
            kw_coverage = len(ref_kws & folder_kws)
            # density: share of tests whose summary contains at least one ref keyword
            matching_tests = sum(
                1 for t in tests
                if ref_kws & {w for w in re.sub(r"[^\w\s]", "",
                              t.get("summary", "").lower()).split()
                              if len(w) > 3 and w not in _stop}
            )
            density = matching_tests / max(len(tests), 1)
            folder_scores[folder] = kw_coverage * density

        if folder_scores:
            best_folder = max(folder_scores, key=lambda f: folder_scores[f])
            log.info("[XRAY] Phase-2 via keyword-coverage: %r  scores=%s",
                     best_folder,
                     {f: round(s, 2) for f, s in
                      sorted(folder_scores.items(), key=lambda x: -x[1])[:5]})
        else:
            log.info("[XRAY] Phase-2: no non-root folder found — skipping expansion")

    # ── Phase 3: Feature-phrase expansion ─────────────────────────────────────
    # XRAY Cloud 'folder = "..."' JQL is unreliable (doesn't map to folder.path
    # returned by GraphQL). Instead, derive a phrase from the detected folder's
    # last path segment and do a fresh summary-based search to pick up any tests
    # missed by Phase 1 (e.g. tests whose summaries use a slightly different term
    # from the JIRA title keywords).
    extras3: list = []
    _jira_id_re = re.compile(r'^[A-Z]+-\d+', re.IGNORECASE)
    if best_folder:
        last_seg  = best_folder.rstrip("/").split("/")[-1]
        # Strip any leading JIRA-ID token (e.g. "SBPWC-11045 - Recently Viewed..."
        # → "Recently Viewed...") so the bigram is feature-based, not ticket-based.
        seg_clean = re.sub(r'^[A-Z]+-\d+\s*[-–]?\s*', '', last_seg, flags=re.IGNORECASE)
        seg_words = re.sub(r"[^\w\s]", " ", seg_clean.lower()).split()
        seg_bigrams = [
            f"{seg_words[i]} {seg_words[i+1]}"
            for i in range(len(seg_words) - 1)
            if len(seg_words[i]) > 3 and len(seg_words[i+1]) > 3
            and seg_words[i] not in _stop and seg_words[i+1] not in _stop
        ]
        seg_kws = [w for w in seg_words if len(w) > 4 and w not in _stop]

        if seg_bigrams:
            extras3 = await _gql_tests(
                f'project = {project} AND summary ~ "{seg_bigrams[0]}"', limit=50
            )
            log.info("[XRAY] Phase-3 (segment bigram '%s'): %d tests",
                     seg_bigrams[0], len(extras3))
        elif seg_kws:
            extras3 = await _gql_tests(
                f'project = {project} AND summary ~ "{seg_kws[0]}"', limit=30
            )
            log.info("[XRAY] Phase-3 (segment kw '%s'): %d tests",
                     seg_kws[0], len(extras3))

    # ── Phase 4: JIRA-linked fallback ─────────────────────────────────────────
    linked = await _gql_tests(f"project = {project} AND issue = {jira_id}", limit=50)
    log.info("[XRAY] Phase-4 (issue = %s): %d tests", jira_id, len(linked))

    # ── Merge: JIRA-linked first, then best-folder tests, then rest ───────────
    best_folder_tests = [t for t in phase1 if t.get("folder") == best_folder]
    other_phase1      = [t for t in phase1 if t.get("folder") != best_folder]

    seen_keys: set = set()
    candidates: list = []
    for t in phase0 + best_folder_tests + other_phase1 + extras3 + linked:
        if t["key"] not in seen_keys:
            seen_keys.add(t["key"])
            candidates.append(t)

    log.info("[XRAY] Total unique candidates: %d  (phase0: %d  best-folder: %d)",
             len(candidates), len(phase0), len(best_folder_tests))
    return candidates, best_folder




def _build_suggested_folders(
    best_folder: str | None,
    candidates: list,
    generated_tcs: list,
    jira_id: str,
) -> list:
    """
    Build a refined, ranked list of suggested XRAY folders for the Publish page.

    Tier 1 — Folders whose path directly contains the JIRA card ID.
             These are the most precise: XRAY often auto-creates
             'SBPWC-1234 - <Title>' subfolders for each ticket.
             We include these BUT also their parent so users aren't
             forced into a JIRA-locked subfolder.
    Tier 2 — The best keyword-scored folder identified during Phase-2
             detection (if different from tier-1).
    Tier 3 — Parent folder(s) of tier-1/tier-2 picks, i.e. 1 level up.
             If the XRAY folder is '/Miscellaneous/SBPWC-11045 - X',
             we also suggest '/Miscellaneous' so the user can put the
             new tests at the feature level, not under an old ticket.
    Tier 4 — Candidate folders whose name segments contain words from
             the TC modules (e.g. module='Filter Context Menu' →
             '/Filters/Filter Context Menu (Unity Client)' scores high).

    Returns at most 5 unique folders, most relevant first.
    """
    _stop = {
        "verify", "check", "ensure", "test", "that", "when", "the", "a", "an",
        "is", "are", "not", "with", "for", "in", "on", "of", "to", "and", "or",
        "does", "should", "will", "can", "then", "if", "be", "after", "before",
        "user", "users", "item", "items", "value", "values", "list", "object",
        "workview", "onbase", "unity", "hyland", "miscellaneous", "sbpwc",
    }

    all_candidate_folders = sorted({
        c["folder"] for c in candidates
        if c.get("folder") and c["folder"] not in ("/", "")
    })

    # Tier 1 — path contains JIRA ID (e.g. SBPWC-11045 anywhere in path)
    jira_upper = jira_id.upper()
    tier1 = [f for f in all_candidate_folders if jira_upper in f.upper()]

    # Tier 2 — best_folder from keyword density scoring
    tier2 = [best_folder] if best_folder and best_folder not in tier1 else []

    # Tier 3 — parent folder (1 level up) of tier-1/tier-2 picks
    tier3: list = []
    for f in (tier1[:1] + tier2[:1]):
        parts = f.rstrip("/").rsplit("/", 1)
        if len(parts) == 2 and parts[0] and parts[0] not in ("/", ""):
            parent = parts[0]
            if parent not in tier1 and parent not in tier2:
                tier3.append(parent)

    # Tier 4 — candidate folders whose path matches TC module name words
    #  Score: count of module words that appear in folder path segment text
    modules = list({tc.get("module", "") for tc in generated_tcs if tc.get("module")})
    module_words: set = set()
    for m in modules:
        module_words.update(
            w for w in re.sub(r"[^\w\s]", " ", m.lower()).split()
            if len(w) > 3 and w not in _stop
        )

    def _mod_score(folder: str) -> int:
        # Only score against the last 2 path segments (closer to the feature level)
        segs = folder.rstrip("/").split("/")[-2:]
        seg_text = re.sub(r"[^\w\s]", " ", " ".join(segs).lower())
        return sum(1 for w in module_words if w in seg_text)

    already = set(tier1 + tier2 + tier3)
    remaining = [f for f in all_candidate_folders if f not in already]
    tier4 = sorted(
        [f for f in remaining if _mod_score(f) > 0],
        key=_mod_score, reverse=True
    )[:3]

    # Combine and deduplicate, preserving tier order
    suggested: list = []
    seen: set = set()
    for f in tier3 + tier2 + tier1 + tier4:   # tier3 (parent) first, then specific
        if f and f not in seen:
            seen.add(f)
            suggested.append(f)

    log.info("[XRAY] Suggested folders: %s", suggested)
    return suggested[:5]


def _compute_regression_meta(tc: dict) -> dict:
    """Enrich a generated TC with automation feasibility score and regression recommendation."""
    title = (tc.get("title") or "").lower()
    cat   = "OTHER"
    for _c in ("REGRESSION", "PERSISTENCE", "BOUNDARY", "EDGE CASE", "NEGATIVE"):
        if f"[{_c.lower()}]" in title:
            cat = _c
            break
    base_scores = {
        "REGRESSION": 95, "PERSISTENCE": 90, "BOUNDARY": 85,
        "EDGE CASE":  75, "NEGATIVE":    70, "OTHER":    65,
    }
    priority_bonus = {"High": 5, "Low": -10}.get(tc.get("priority", "Medium"), 0)
    score = max(0, min(100, base_scores.get(cat, 65) + priority_bonus))
    reason_map = {
        "REGRESSION":  ["Deterministic logic", "Frequent issue area"],
        "PERSISTENCE": ["Deterministic logic", "High impact module"],
        "BOUNDARY":    ["Deterministic logic", "High impact module", "Stable API/UI flow"],
        "EDGE CASE":   ["Edge case coverage", "High impact module"],
        "NEGATIVE":    ["Frequent issue area", "Edge case coverage"],
        "OTHER":       ["Standard coverage"],
    }
    return {
        **tc,
        "automation_score":     score,
        "automation_feasible":  score >= 70,
        "automation_reasons":   reason_map.get(cat, ["Standard coverage"]),
        "regression_candidate": score >= 70,
        "_tc_category":         cat,
    }


def _classify_gap(generated_tcs: list, candidates: list, linked_keys: set = None) -> tuple:
    """
    Classify generated TCs as 'missing' or 'existing' by Jaccard similarity
    on title keywords vs. candidate summary keywords.

    Thresholds:
      - 0.15 for JIRA-directly-linked tests (human confirmed they belong to this card)
      - 0.18 for general XRAY candidates

    Returns (missing_list, existing_list).
    Existing entries gain match_key, match_summary, match_folder, similarity, jira_linked fields.
    """
    linked_keys = linked_keys or set()

    # Extended stop list: includes project-generic nouns that appear in almost
    # every XRAY test summary and would produce false-positive matches.
    _stop = {
        # English filler
        "verify", "check", "ensure", "test", "that", "when", "the", "a", "an",
        "is", "are", "not", "with", "for", "in", "on", "of", "to", "and", "or",
        "does", "should", "will", "can", "then", "if", "be", "after", "before",
        "user", "users", "item", "items", "value", "values", "list", "object",
        # Project-domain generics (appear in nearly every OnBase/WorkView test)
        "attribute", "attributes", "summary", "keyword", "keywords",
        "mapping", "alphanumeric", "encrypted", "encryption", "verifying",
        "workview", "onbase", "column", "columns", "using", "result", "results",
        "identity", "security", "configuration", "mixed", "fixed", "dynamic",
    }

    def _kw(text: str) -> set:
        words = re.sub(r"[^\w\s]", "", text.lower()).split()
        return {w for w in words if len(w) > 3 and w not in _stop}

    missing, existing = [], []
    for tc in generated_tcs:
        tc_kw = _kw(tc.get("title", ""))
        best        = None
        best_score  = 0.0
        best_linked = None
        best_linked_score = 0.0
        for cand in candidates:
            cand_kw = _kw(cand.get("summary", ""))
            if not tc_kw or not cand_kw:
                continue
            inter = len(tc_kw & cand_kw)
            union = len(tc_kw | cand_kw)
            score = inter / union if union else 0.0
            if score > best_score:
                best_score = score
                best = cand
            if cand["key"] in linked_keys and score > best_linked_score:
                best_linked_score = score
                best_linked = cand
        # Prefer JIRA-linked match (lower threshold 0.15) over general match (0.18)
        if best_linked and best_linked_score >= 0.15:
            existing.append({
                **tc,
                "match_key":     best_linked["key"],
                "match_summary": best_linked["summary"],
                "match_folder":  best_linked["folder"],
                "similarity":    round(best_linked_score, 2),
                "jira_linked":   True,
            })
        elif best and best_score >= 0.18:
            existing.append({
                **tc,
                "match_key":     best["key"],
                "match_summary": best["summary"],
                "match_folder":  best["folder"],
                "similarity":    round(best_score, 2),
                "jira_linked":   False,
            })
        else:
            # Attach nearest candidate only if similarity is meaningful (≥ 12%)
            has_near = best is not None and best_score >= 0.12
            missing.append({
                **tc,
                "nearest_key":     best["key"]     if has_near else None,
                "nearest_summary": best["summary"] if has_near else None,
                "nearest_folder":  best["folder"]  if has_near else None,
                "nearest_sim":     round(best_score, 2) if has_near else 0.0,
            })

    return missing, existing


async def _run_xray_gap_analysis(jira: dict, tfs: dict, generated_tcs: list) -> dict:
    """
    Full XRAY gap analysis pipeline:
      authenticate → search candidates → classify → return {missing, existing, folders}.
    Falls back gracefully (all TCs marked missing) if XRAY is unavailable.
    """
    if not XRAY_CLIENT_ID or not XRAY_CLIENT_SECRET:
        log.warning("[XRAY] Credentials not configured — returning all TCs as missing")
        return {
            "missing": generated_tcs, "existing": [], "folders": [],
            "error": "XRAY credentials not configured",
        }
    if not generated_tcs:
        return {"missing": [], "existing": [], "folders": [], "candidates_count": 0}

    try:
        token = await _xray_authenticate()
    except Exception as exc:
        log.error("[XRAY] Auth failed: %s", exc)
        return {
            "missing": generated_tcs, "existing": [], "folders": [],
            "error": f"XRAY auth failed: {exc}",
        }

    candidates, best_folder = await _xray_search_candidates(
        token, jira.get("id", ""), generated_tcs, jira_data=jira, tfs_data=tfs
    )
    linked_keys = set(jira.get("xray_test_keys", []))
    missing, existing = _classify_gap(generated_tcs, candidates, linked_keys)
    jira_id  = jira.get("id", "")
    suggested_folders = _build_suggested_folders(best_folder, candidates, generated_tcs, jira_id)

    log.info("[XRAY] Gap analysis — missing=%d  existing=%d  candidates=%d  suggested_folders=%d",
             len(missing), len(existing), len(candidates), len(suggested_folders))
    return {
        "missing":          missing,
        "existing":         existing,
        "folders":          suggested_folders,
        "candidates_count": len(candidates),
    }


# ── Pydantic request models ──────────────────────────────────────────

class MrgRequest(BaseModel):
    jira: dict
    tfs:  dict


class AnalyzeRequest(BaseModel):
    jira_id:          str
    tfs_changeset_id: str


class TestCaseRequest(BaseModel):
    jira:        dict
    tfs:         dict
    mrg_content: str = ""


# ── Auth endpoint ────────────────────────────────────────────────────

@app.post("/api/auth")
async def authenticate_user(request: Request):
    """Validate user email against the configured JIRA credentials."""
    body  = await request.json()
    email = (body.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    if not JIRA_EMAIL:
        raise HTTPException(status_code=503, detail="Auth not configured on server")
    if email != JIRA_EMAIL.strip().lower():
        raise HTTPException(
            status_code=401,
            detail="Email not recognised. Access is restricted to authorised QA engineers."
        )
    # Fetch real user profile from JIRA
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{JIRA_BASE_URL}/rest/api/3/myself",
                auth=(JIRA_EMAIL, JIRA_API_TOKEN)
            )
            if r.status_code == 200:
                u = r.json()
                return {
                    "name":       u.get("displayName", email.split("@")[0]),
                    "email":      email,
                    "avatar":     (u.get("avatarUrls") or {}).get("48x48", ""),
                    "account_id": u.get("accountId", ""),
                }
    except Exception:
        pass
    return {
        "name":       email.split("@")[0].replace(".", " ").title(),
        "email":      email,
        "avatar":     "",
        "account_id": "",
    }


# ── JIRA endpoint ────────────────────────────────────────────────────

@app.get("/api/jira/search")
async def search_jira_by_description(q: str, project: str = "", fallback: str = ""):
    """Search JIRA issues whose text contains the given query string."""
    if not JIRA_BASE_URL or not JIRA_EMAIL or not JIRA_API_TOKEN:
        raise HTTPException(status_code=500, detail="JIRA credentials are not configured.")
    if not q or len(q.strip()) < 3:
        raise HTTPException(status_code=400, detail="Query must be at least 3 characters.")

    safe_q = q.strip().replace('"', '\\"')
    # Use phrase match for multi-word queries (more precise), word match for single words
    # If fallback=1, force word-based search (called after phrase match returned nothing)
    words = safe_q.split()
    if len(words) > 1 and fallback != "1":
        text_clause = f'text ~ "\\"{safe_q}\\""'   # phrase match: text ~ "\"exact phrase\""
    else:
        text_clause = f'text ~ "{safe_q}"'
    jql_parts = [text_clause]
    if project.strip():
        jql_parts.insert(0, f'project = "{project.strip()}"')
    jql = " AND ".join(jql_parts) + " ORDER BY updated DESC"

    url = f"{JIRA_BASE_URL}/rest/api/3/search/jql"
    params = {"jql": jql, "maxResults": 8, "fields": "summary,status,priority,issuetype"}

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                url,
                params=params,
                auth=(JIRA_EMAIL, JIRA_API_TOKEN),
                headers={"Accept": "application/json"},
                timeout=15.0,
            )
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="JIRA search timed out")
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Cannot reach JIRA: {exc}")

    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Invalid JIRA credentials")
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="JIRA search error")

    issues = resp.json().get("issues", [])
    results = []
    for iss in issues:
        fields = iss.get("fields", {})
        results.append({
            "id":       iss.get("key", ""),
            "summary":  fields.get("summary", ""),
            "status":   (fields.get("status") or {}).get("name", ""),
            "priority": (fields.get("priority") or {}).get("name", ""),
        })
    return {"results": results, "total": len(results)}


@app.get("/api/jira/{card_id}")
async def get_jira_issue(card_id: str):
    log.info("[JIRA] Fetching issue: %s", card_id)
    if not JIRA_BASE_URL or not JIRA_EMAIL or not JIRA_API_TOKEN:
        raise HTTPException(
            status_code=500,
            detail="JIRA credentials are not configured. Check your .env file.",
        )

    url = f"{JIRA_BASE_URL}/rest/api/3/issue/{card_id}?expand=names"

    async with httpx.AsyncClient() as client:
        try:
            response, remotelinks_response = await asyncio.gather(
                client.get(url, auth=(JIRA_EMAIL, JIRA_API_TOKEN), headers={"Accept": "application/json"}, timeout=15.0),
                client.get(f"{JIRA_BASE_URL}/rest/api/3/issue/{card_id}/remotelink", auth=(JIRA_EMAIL, JIRA_API_TOKEN), headers={"Accept": "application/json"}, timeout=15.0),
            )
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="JIRA request timed out")
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Cannot reach JIRA: {exc}")

    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="Invalid JIRA credentials — check email and API token")
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail=f"JIRA card '{card_id}' not found")
    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail="JIRA API error")

    log.info("[JIRA] HTTP %s — parsing fields", response.status_code)
    data   = response.json()
    fields = data.get("fields", {})

    description_text = _extract_adf_text(fields.get("description")) or "No description provided."

    # Extract TFS Changeset numbers from remote links (e.g. "Changeset 401643")
    tfs_changesets = []
    if remotelinks_response.status_code == 200:
        for link in remotelinks_response.json():
            title = link.get("object", {}).get("title", "")
            if "changeset" in title.lower():
                # Extract number from "Changeset 401643"
                parts = title.split()
                number = next((p for p in parts if p.isdigit()), None)
                if number:
                    tfs_changesets.append(number)

    tfs_id = ", ".join(tfs_changesets) if tfs_changesets else "N/A"

    priority  = (fields.get("priority") or {}).get("name", "Medium")
    status    = (fields.get("status")   or {}).get("name", "Open")
    component = ((fields.get("components") or [{}])[0]).get("name", "N/A")

    # Dynamically locate the "Test Recommendation" custom field via the ?expand=names map
    # JIRA returns  {"names": {"customfield_XXXXX": "Test Recommendation", ...}}
    names_map = data.get("names", {})
    test_rec_field_id = next(
        (fid for fid, fname in names_map.items()
         if "test" in fname.lower() and "recommend" in fname.lower()),
        None,
    )
    test_recommendation = ""
    if test_rec_field_id:
        raw = fields.get(test_rec_field_id)
        if isinstance(raw, str):
            test_recommendation = raw
        elif isinstance(raw, dict):
            test_recommendation = _extract_adf_text(raw)
        elif raw is not None:
            test_recommendation = str(raw)
        log.info("[JIRA] test_recommendation field=%s  len=%d", test_rec_field_id, len(test_recommendation))
    else:
        log.info("[JIRA] no 'test recommendation' custom field found in names map")

    # Extract XRAY test keys linked via JIRA "is tested by" issue links
    xray_test_keys: list = []
    for _link in fields.get("issuelinks", []):
        _ltype     = _link.get("type") or {}
        _inward    = _link.get("inwardIssue")  or {}
        _outward   = _link.get("outwardIssue") or {}
        if "test" in _ltype.get("inward", "").lower() and _inward.get("key"):
            xray_test_keys.append(_inward["key"])
        if "test" in _ltype.get("outward", "").lower() and _outward.get("key"):
            xray_test_keys.append(_outward["key"])
    log.info("[JIRA] %d XRAY test keys from issue links: %s", len(xray_test_keys), xray_test_keys[:10])

    result = {
        "id":                  data.get("key", card_id),
        "title":               fields.get("summary", ""),
        "description":         description_text,
        "priority":            priority,
        "status":              status,
        "component":           component,
        "tfs_id":              tfs_id,
        "test_recommendation": test_recommendation,
        "xray_test_keys":      xray_test_keys,
    }
    log.info("[JIRA] Done — title=%r  priority=%s  tfs_ids=%s  test_rec=%d chars",
             result["title"][:60], priority, tfs_id, len(test_recommendation))
    return result


# ── TFS changeset endpoint ───────────────────────────────────────────

@app.get("/api/tfs/{changeset_id}")
async def get_tfs_changeset(changeset_id: str):
    log.info("[TFS] Fetching changeset: %s", changeset_id)
    if not TFS_PAT or not TFS_BASE_URL:
        raise HTTPException(status_code=500,
                            detail="TFS credentials not configured. Check TFS_PAT and TFS_BASE_URL in .env.")
    b64     = base64.b64encode(f":{TFS_PAT}".encode()).decode()
    headers = {"Authorization": f"Basic {b64}", "Accept": "application/json"}

    async with httpx.AsyncClient(verify=False) as client:
        try:
            meta_r, changes_r = await asyncio.gather(
                client.get(
                    f"{TFS_BASE_URL}/_apis/tfvc/changesets/{changeset_id}?api-version=1.0",
                    headers=headers, timeout=15.0,
                ),
                client.get(
                    # Changes must be collection-scoped (no project segment)
                    f"{TFS_COLLECTION_URL}/_apis/tfvc/changesets/{changeset_id}/changes?api-version=1.0",
                    headers=headers, timeout=15.0,
                ),
            )
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="TFS request timed out")
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Cannot reach TFS server: {exc}")

    if meta_r.status_code == 401:
        raise HTTPException(status_code=401, detail="TFS authentication failed — check TFS_PAT")
    if meta_r.status_code == 404:
        raise HTTPException(status_code=404, detail=f"TFS changeset {changeset_id} not found")
    if meta_r.status_code != 200:
        raise HTTPException(status_code=meta_r.status_code, detail="TFS API error")

    log.info("[TFS] Metadata HTTP %s, changes HTTP %s", meta_r.status_code, changes_r.status_code)
    meta  = meta_r.json()
    files = []

    if changes_r.status_code == 200:
        for change in changes_r.json().get("value", [])[:10]:
            item        = change.get("item", {})
            server_path = item.get("path", "")
            change_type = change.get("changeType", "edit")
            local_path  = _tfs_to_local(server_path, ONBASE_LOCAL_PATH) if ONBASE_LOCAL_PATH else None
            exists      = bool(local_path and os.path.isfile(local_path))
            snippet     = None
            if exists:
                try:
                    with open(local_path, "r", encoding="utf-8", errors="ignore") as f:
                        snippet = "".join(f.readlines()[:50])
                except Exception:
                    pass
            files.append({
                "server_path":    server_path,
                "change_type":    change_type,
                "local_path":     local_path,
                "exists_locally": exists,
                "snippet":        snippet,
            })

    author = (
        (meta.get("author") or {}).get("displayName")
        or (meta.get("checkedInBy") or {}).get("displayName", "")
    )
    date             = (meta.get("createdDate") or "")[:10]
    comment          = meta.get("comment", "")
    server_paths      = [f["server_path"] for f in files]
    # Path-based: assembly/namespace name (e.g. 'WorkView.InterfaceServices')
    impacted_modules  = _infer_modules(server_paths)
    # Code-based: feature names derived from C# snippets (e.g. 'Recently Viewed')
    impacted_features = _infer_features_from_snippets(files)
    purpose           = comment or (
        f"Changes to {', '.join(impacted_modules)}" if impacted_modules else "Code changes"
    )
    log.info("[TFS] Done — author=%s  date=%s  files=%d  modules=%s  features=%s",
             author, date, len(files), impacted_modules, impacted_features[:5])

    return {
        "changeset_id":      changeset_id,
        "author":            author,
        "date":              date,
        "comment":           comment,
        "changed_files":     files,
        "impacted_modules":  impacted_modules,
        "impacted_features": impacted_features,
        "purpose":           purpose,
    }


# ── Copilot Studio MRG endpoint ──────────────────────────────────────

@app.post("/api/copilot/mrg")
async def get_mrg(request: MrgRequest):
    log.info("[MRG] Starting Copilot Studio conversation for jira=%s tfs=%s",
             request.jira.get("id"), request.tfs.get("changeset_id"))
    if not DIRECTLINE_SECRET:
        raise HTTPException(status_code=500,
                            detail="DIRECTLINE_SECRET not configured in .env")
    jira        = request.jira
    tfs         = request.tfs

    jira_title = jira.get("title", "")
    modules_str  = ", ".join(tfs.get("impacted_modules",  []) or []) or "Unknown"
    features_str = ", ".join(tfs.get("impacted_features", []) or [])
    feature_hint = f" (features: {features_str})" if features_str else ""

    # Include Test Recommendation from JIRA (capped to avoid token limit)
    test_rec     = (jira.get("test_recommendation") or "").strip()
    test_rec_str = test_rec[:300] + ("…" if len(test_rec) > 300 else "")
    test_rec_hint = f"\nTest Recommendation: {test_rec_str}" if test_rec_str else ""

    prompt = (
        f'Module: {modules_str}{feature_hint}\n'
        f'Feature: {jira_title}{test_rec_hint}\n\n'
        f'Please retrieve the OnBase MRG (Module Reference Guide) section that documents '
        f'this feature. Return only the relevant MRG section with its configuration steps, '
        f'notes, and expected behavior. Keep the response concise.'
    )

    log.info("[MRG] Prompt:\n%s", prompt)

    # Delegate to shared WebSocket-based DirectLine helper
    bot_reply = await _directline_converse(prompt, "MRG")
    conv_id   = "ws"   # conversation ID not surfaced from helper; placeholder only

    if not bot_reply:
        log.warning("[MRG] No bot reply — using JIRA test_recommendation fallback")
        raise HTTPException(status_code=504,
                            detail="Copilot Studio did not respond within 45 seconds")

    # Detect bot quota / service-unavailable messages → return minimal fallback
    _bot_errors = ("usage limit", "currently unavailable", "try again later", "not available")
    if any(phrase in (bot_reply or "").lower() for phrase in _bot_errors):
        log.warning("[MRG] Bot unavailable: %r — returning fallback MRG stub", bot_reply[:120])
        modules_list = tfs.get("impacted_modules", []) or []
        features_list = tfs.get("impacted_features", []) or []
        fallback_mrg = (
            f"[MRG unavailable — Copilot Studio usage limit reached]\n"
            f"Module: {', '.join(modules_list) or 'N/A'}\n"
            f"Feature: {jira_title}\n"
            + ((f"Features: {', '.join(features_list)}\n") if features_list else "")
            + (f"\nQA Recommendation:\n{test_rec}\n" if test_rec else "")
        )
        return {
            "mrg_content":        fallback_mrg,
            "modules_from_agent": modules_list,
            "test_cases":         [],
            "conversation_id":    conv_id,
        }

    mrg_content        = _extract_delimited(bot_reply, "MRG") or bot_reply
    log.info("[MRG] Done — mrg_content=%d chars  test_cases to parse", len(mrg_content))
    modules_raw        = _extract_delimited(bot_reply, "MODULES")
    modules_from_agent = [m.strip() for m in modules_raw.split(",") if m.strip()] if modules_raw else []
    testcases_raw      = _extract_delimited(bot_reply, "TESTCASES")
    test_cases         = [
        re.sub(r"^\d+[\.\)]\s*", "", line).strip()
        for line in testcases_raw.splitlines()
        if line.strip()
    ] if testcases_raw else []

    return {
        "mrg_content":        mrg_content,
        "modules_from_agent": modules_from_agent,
        "test_cases":         test_cases,
        "conversation_id":    conv_id,
    }


# ── DirectLine debug endpoint ────────────────────────────────────────

@app.get("/api/debug/directline")
async def debug_directline():
    """Tests DirectLine connectivity and returns the raw response for diagnosis."""
    if not DIRECTLINE_SECRET:
        return {"error": "DIRECTLINE_SECRET is empty — check .env"}
    dl_headers = {
        "Authorization": f"Bearer {DIRECTLINE_SECRET}",
        "Content-Type":  "application/json",
    }
    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(f"{DIRECTLINE_BASE}/conversations",
                                  headers=dl_headers, timeout=15.0)
            return {
                "status_code": r.status_code,
                "response":    r.json() if "application/json" in r.headers.get("content-type","") else r.text,
            }
        except httpx.RequestError as exc:
            return {"error": f"Network error: {exc}"}


@app.post("/api/debug/bot-reply")
async def debug_bot_reply():
    """Sends a minimal test message to Copilot Studio and returns ALL raw activities — use this to diagnose empty MRG responses."""
    if not DIRECTLINE_SECRET:
        return {"error": "DIRECTLINE_SECRET is empty"}
    dl_headers = {"Authorization": f"Bearer {DIRECTLINE_SECRET}", "Content-Type": "application/json"}

    async with httpx.AsyncClient() as client:
        conv_r = await client.post(f"{DIRECTLINE_BASE}/conversations", headers=dl_headers, timeout=15.0)
        if conv_r.status_code not in (200, 201):
            return {"error": f"Could not start conversation: {conv_r.text}"}

        conv_data = conv_r.json()
        conv_id   = conv_data["conversationId"]
        token     = conv_data.get("token", DIRECTLINE_SECRET)
        dl_headers["Authorization"] = f"Bearer {token}"

        test_prompt = (
            'I am analyzing JIRA card SBPWC-10999: "Enable Revision Prefix Display".\n'
            'Description: Revision prefix missing in title bar for revisable document types.\n'
            'Priority: High | Status: In Progress | Component: WorkView\n'
            'TFS Changeset: 401643 — Fix revision prefix display\n'
            'Impacted Modules: WorkView, WebClient\n\n'
            'Please retrieve the MRG (product feature documentation) most relevant to this JIRA card '
            'and its impacted modules, and return the full MRG content.'
        )

        await client.post(
            f"{DIRECTLINE_BASE}/conversations/{conv_id}/activities",
            headers=dl_headers,
            json={"type": "message", "from": {"id": "gapguard-debug"}, "text": test_prompt},
            timeout=15.0,
        )

        # Poll and collect ALL activities for 30 seconds
        all_activities = []
        watermark = "0"
        for i in range(15):
            await asyncio.sleep(2)
            poll_r = await client.get(
                f"{DIRECTLINE_BASE}/conversations/{conv_id}/activities?watermark={watermark}",
                headers=dl_headers, timeout=15.0,
            )
            if poll_r.status_code == 200:
                poll_data  = poll_r.json()
                watermark  = poll_data.get("watermark", watermark)
                activities = poll_data.get("activities", [])
                all_activities.extend(activities)
                # Stop early once bot sends a message
                if any(a.get("type") == "message" and a.get("from", {}).get("role") == "bot"
                       for a in activities):
                    break

        # Return everything — type, role, text, attachments for each activity
        return {
            "conversation_id": conv_id,
            "polls_done":      i + 1,
            "activities": [
                {
                    "type":        a.get("type"),
                    "role":        a.get("from", {}).get("role"),
                    "name":        a.get("name"),
                    "text":        a.get("text"),
                    "value":       a.get("value"),
                    "attachments": a.get("attachments"),
                }
                for a in all_activities
            ],
        }


# ── Unified analyze pipeline ─────────────────────────────────────────

# ── Test case generation endpoint ───────────────────────────────────────

@app.post("/api/testcases")
async def generate_test_cases_endpoint(request: TestCaseRequest):
    """
    Standalone endpoint: given jira + tfs + mrg_content, generate structured test cases.
    Returns: {test_cases: [{id, title, steps, expected, priority, module}]}
    """
    log.info("[TESTCASES] Standalone generation for jira=%s", request.jira.get("id"))
    t0 = time.perf_counter()
    test_cases = await _generate_test_cases(request.jira, request.tfs, request.mrg_content)
    log.info("[TESTCASES] Done — %d TCs in %.2fs", len(test_cases), time.perf_counter() - t0)
    return {"test_cases": test_cases}


@app.get("/api/xray/folders/{project_key}")
async def get_xray_folders(project_key: str):
    """Return all unique XRAY folder paths for a project using parallel page fetching."""
    try:
        token = await _xray_authenticate()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"XRAY auth failed: {exc}")

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    limit   = 100

    def _gql(start: int) -> str:
        return ('{ getTests(jql: "project = ' + project_key
                + f'", limit: {limit}, start: {start}) '
                + '{ results { folder { path } } total } }')

    async def _fetch(start: int) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                r = await client.post(XRAY_GQL_URL, json={"query": _gql(start)}, headers=headers)
                if r.status_code == 200:
                    return r.json()
            except Exception:
                pass
        return {}

    # ── First page to discover total ──────────────────────────────────────────
    first   = await _fetch(0)
    gt0     = first.get("data", {}).get("getTests", {})
    total   = gt0.get("total", 0)
    results = gt0.get("results", [])

    all_folders: set = set()

    def _collect(results_list):
        for t in results_list:
            fp = (t.get("folder") or {}).get("path", "")
            if fp and fp not in ("/", ""):
                all_folders.add(fp)
                # Also add every intermediate path so users can select parent folders
                parts = fp.strip("/").split("/")
                for i in range(1, len(parts)):
                    all_folders.add("/" + "/".join(parts[:i]))

    _collect(results)

    # ── Fetch remaining pages in parallel batches of 15 ──────────────────────
    if total > limit:
        remaining = list(range(limit, total, limit))
        batch_size = 15
        for i in range(0, len(remaining), batch_size):
            batch   = remaining[i : i + batch_size]
            pages   = await asyncio.gather(*[_fetch(s) for s in batch])
            for page in pages:
                _collect((page.get("data", {}).get("getTests", {}).get("results")) or [])

    folders_sorted = sorted(all_folders, key=lambda p: (p.count("/"), p.lower()))
    log.info("[XRAY] Folders for %s: %d (from %d tests)", project_key, len(folders_sorted), total)
    return {"folders": folders_sorted, "project": project_key, "total": len(folders_sorted)}


@app.get("/api/xray/testplans/{project_key}")
async def get_xray_testplans(project_key: str):
    """
    Return all XRAY Test Plans for a project, ordered by most recently updated.
    Uses getTestPlans GraphQL query (XRAY Cloud API v2).
    """
    if not XRAY_CLIENT_ID or not XRAY_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="XRAY credentials not configured")
    try:
        token = await _xray_authenticate()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"XRAY auth failed: {exc}")

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    # getTestPlans uses a JQL filter — limit to 50 most recent
    gql = (
        '{ getTestPlans(jql: "project = ' + project_key + ' ORDER BY updated DESC", '
        'limit: 50) { results { issueId jira(fields: ["key","summary","updated"]) } total } }'
    )
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            r = await client.post(XRAY_GQL_URL, json={"query": gql}, headers=headers)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"XRAY request failed: {exc}")

    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail=f"XRAY returned HTTP {r.status_code}")

    data = r.json()
    if "errors" in data:
        raise HTTPException(status_code=502, detail=str(data["errors"])[:300])

    plans = []
    for item in (data.get("data", {}).get("getTestPlans", {}).get("results") or []):
        jira_fields = item.get("jira") or {}
        key     = jira_fields.get("key", "")
        summary = jira_fields.get("summary", "")
        updated = jira_fields.get("updated", "")
        issue_id = item.get("issueId", "")
        if key:
            plans.append({"key": key, "summary": summary, "updated": updated, "issue_id": issue_id})

    log.info("[XRAY] Test plans for %s: %d", project_key, len(plans))
    return {"plans": plans, "project": project_key}


@app.post("/api/xray/publish")
async def publish_to_xray(request: Request):
    """
    Create test cases in XRAY Cloud for a given JIRA card.
    Body: {
      jira_id, jira_title,
      test_cases: [{id,title,steps,expected,priority,module}],
      folder_path,           # existing folder path (used when create_folder=false)
      create_folder,         # bool — create a new folder first
      new_folder_name,       # name of the new folder (leaf)
      new_folder_parent,     # parent path for the new folder (default "/")
    }
    Returns: { created, errors, summary, impact_analysis, jira_base_url }
    """
    body             = await request.json()
    jira_id          = body.get("jira_id", "")
    jira_title       = body.get("jira_title", "")
    test_cases       = body.get("test_cases", [])
    folder_path      = (body.get("folder_path") or "").strip()
    create_folder    = bool(body.get("create_folder", False))
    new_folder_name  = (body.get("new_folder_name") or "").strip()
    new_folder_parent= (body.get("new_folder_parent") or "/").rstrip("/")
    project          = jira_id.split("-")[0] if "-" in jira_id else "SBPWC"

    if not test_cases:
        raise HTTPException(status_code=400, detail="No test cases provided")
    if not XRAY_CLIENT_ID or not XRAY_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="XRAY credentials not configured")

    token   = await _xray_authenticate()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def _esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "")

    # ── Create new folder if requested ────────────────────────────────────────
    if create_folder and new_folder_name:
        parent_clean = new_folder_parent or "/"
        folder_path  = f"{parent_clean}/{new_folder_name}"
        create_fm = (
            'mutation {'
            f'  createTestRepositoryFolder(projectKey: "{project}", '
            f'    path: "{_esc(folder_path)}") {{'
            '    folder { path } warnings'
            '  }'
            '}'
        )
        log.info("[PUBLISH] Creating folder: %s", folder_path)
        async with httpx.AsyncClient(timeout=20) as client:
            try:
                cfr = await client.post(XRAY_GQL_URL, json={"query": create_fm}, headers=headers)
                if cfr.status_code == 200:
                    cfd = cfr.json()
                    folder_path = (
                        (cfd.get("data", {}).get("createTestRepositoryFolder", {}).get("folder") or {})
                        .get("path", folder_path)
                    )
                    log.info("[PUBLISH] Folder created: %s", folder_path)
            except Exception as cf_exc:
                log.warning("[PUBLISH] Folder creation failed: %s — will use path as-is", cf_exc)

    # ── Create test cases ─────────────────────────────────────────────────────
    created: list = []
    errors:  list = []

    for tc in test_cases:
        summary_txt = _esc(tc.get("title", ""))
        steps       = tc.get("steps", [])
        expected    = _esc(tc.get("expected", ""))

        steps_gql_parts = []
        for i, s in enumerate(steps[:15]):
            action = _esc(str(s))
            result = _esc(expected) if i == len(steps) - 1 else ""
            steps_gql_parts.append(f'{{action: "{action}", data: "", result: "{result}"}}')
        steps_arg = f'steps: [{", ".join(steps_gql_parts)}],' if steps_gql_parts else ""

        mutation = (
            'mutation {'
            '  createTest('
            f'    jira: {{ fields: {{ summary: "{summary_txt}", '
            f'      project: {{ key: "{project}" }} }} }},'
            f'    testType: {{ name: "Manual" }},'
            f'    {steps_arg}'
            '  ) {'
            '    test { issueId jira(fields: ["key","summary"]) }'
            '    warnings'
            '  }'
            '}'
        )

        log.info("[PUBLISH] Creating: %s", tc.get("title", "")[:80])
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                r = await client.post(XRAY_GQL_URL, json={"query": mutation}, headers=headers)
            except Exception as exc:
                errors.append({"tc_id": tc.get("id"), "error": str(exc)})
                continue

        if r.status_code != 200:
            errors.append({"tc_id": tc.get("id"), "error": f"HTTP {r.status_code}: {r.text[:200]}"})
            continue

        d = r.json()
        if "errors" in d:
            errors.append({"tc_id": tc.get("id"), "error": str(d["errors"])[:200]})
            continue

        test_node = d.get("data", {}).get("createTest", {}).get("test") or {}
        xray_key  = (test_node.get("jira") or {}).get("key", "")
        issue_id  = test_node.get("issueId", "")

        # Assign to folder
        assigned_folder = folder_path
        if folder_path and issue_id:
            fm = (
                'mutation {'
                f'  addTestsToFolder(projectKey: "{project}", path: "{_esc(folder_path)}", '
                f'    issueIds: ["{issue_id}"]) {{'
                '    folder { path } warnings'
                '  }'
                '}'
            )
            async with httpx.AsyncClient(timeout=15) as client:
                try:
                    fr = await client.post(XRAY_GQL_URL, json={"query": fm}, headers=headers)
                    if fr.status_code == 200:
                        assigned_folder = (
                            ((fr.json().get("data", {}).get("addTestsToFolder", {})
                              .get("folder")) or {}).get("path", folder_path)
                        )
                except Exception:
                    pass

        created.append({
            "tc_id":    tc.get("id"),
            "title":    tc.get("title"),
            "module":   tc.get("module", "General"),
            "priority": tc.get("priority", "Medium"),
            "xray_key": xray_key,
            "issue_id": issue_id,
            "folder":   assigned_folder,
        })
        log.info("[PUBLISH] Created %s → XRAY %s  folder=%s", tc.get("id"), xray_key, assigned_folder)

    # ── Link created tests back to the JIRA card ──────────────────────────────
    # XRAY "Tests"/"Is Tested By" link type direction:
    #   outwardIssue = XRAY test (it "tests" the requirement)
    #   inwardIssue  = JIRA card  (it "is tested by" the test)
    xray_keys = [t["xray_key"] for t in created if t.get("xray_key")]
    issue_ids = [t["issue_id"] for t in created if t.get("issue_id")]

    if xray_keys and jira_id and JIRA_BASE_URL and JIRA_EMAIL and JIRA_API_TOKEN:
        # Step 1 — JIRA issue link (shows "is tested by" on the JIRA card)
        async with httpx.AsyncClient(timeout=20) as client:
            for xk in xray_keys:
                try:
                    lr = await client.post(
                        f"{JIRA_BASE_URL}/rest/api/3/issueLink",
                        json={
                            "type":          {"name": "Tests"},
                            "outwardIssue":  {"key": xk},       # XRAY test "tests"
                            "inwardIssue":   {"key": jira_id},  # JIRA card "is tested by"
                        },
                        auth=(JIRA_EMAIL, JIRA_API_TOKEN),
                        headers={"Accept": "application/json", "Content-Type": "application/json"},
                    )
                    if lr.status_code not in (200, 201, 204):
                        log.warning("[PUBLISH] JIRA link %s → %s: HTTP %d  body=%s",
                                    xk, jira_id, lr.status_code, lr.text[:300])
                    else:
                        log.info("[PUBLISH] JIRA linked XRAY %s → JIRA %s", xk, jira_id)
                except Exception as link_exc:
                    log.warning("[PUBLISH] JIRA link error for %s: %s", xk, link_exc)

        # Step 2 — XRAY Cloud GraphQL: associate tests with requirement
        # This creates the native XRAY coverage link (visible in XRAY Test Details)
        if issue_ids:
            try:
                xray_token = await _xray_authenticate()
                xray_hdrs  = {"Authorization": f"Bearer {xray_token}", "Content-Type": "application/json"}
                # Fetch the internal issueId of the JIRA requirement card
                async with httpx.AsyncClient(timeout=15) as client:
                    ji_resp = await client.get(
                        f"{JIRA_BASE_URL}/rest/api/3/issue/{jira_id}?fields=id",
                        auth=(JIRA_EMAIL, JIRA_API_TOKEN),
                        headers={"Accept": "application/json"},
                    )
                    req_issue_id = ji_resp.json().get("id", "") if ji_resp.status_code == 200 else ""

                if req_issue_id:
                    ids_str = ", ".join(f'"{iid}"' for iid in issue_ids)
                    gql_link = (
                        'mutation {'
                        f'  addRequirementsToTest(issueId: "{issue_ids[0]}", '
                        f'    requirementIssueIds: ["{req_issue_id}"]) {{'
                        '    addedRequirements warnings'
                        '  }'
                        '}'
                    )
                    # Link each test to the requirement via XRAY GraphQL
                    async with httpx.AsyncClient(timeout=20) as client:
                        for iid in issue_ids:
                            gql = (
                                'mutation {'
                                f'  addRequirementsToTest(issueId: "{iid}", '
                                f'    requirementIssueIds: ["{req_issue_id}"]) {{'
                                '    addedRequirements warnings'
                                '  }'
                                '}'
                            )
                            xr = await client.post(XRAY_GQL_URL, json={"query": gql}, headers=xray_hdrs)
                            if xr.status_code == 200 and "errors" not in xr.json():
                                log.info("[PUBLISH] XRAY GraphQL linked issueId=%s → req=%s", iid, req_issue_id)
                            else:
                                log.warning("[PUBLISH] XRAY GraphQL link failed issueId=%s: %s",
                                            iid, xr.text[:200])
            except Exception as xgql_exc:
                log.warning("[PUBLISH] XRAY GraphQL requirement link error: %s", xgql_exc)


    # ── Impact analysis ───────────────────────────────────────────────────────
    high_count   = sum(1 for t in created if t.get("priority") == "High")
    medium_count = sum(1 for t in created if t.get("priority") == "Medium")
    low_count    = sum(1 for t in created if t.get("priority") == "Low")
    total        = len(created)
    regression_score  = (high_count * 3 + medium_count) / max(total, 1)
    add_to_regression = regression_score >= 1.5 or high_count >= 1

    reasons: list = []
    if high_count >= 1:
        reasons.append(f"{high_count} high-priority TC{'s cover' if high_count > 1 else ' covers'} core functionality — regression risk is elevated")
    if medium_count >= 2:
        reasons.append(f"{medium_count} medium-priority TCs provide broader scenario coverage")
    if low_count >= 1 and not (high_count or medium_count >= 2):
        reasons.append("All TCs are low priority — smoke test plan is sufficient")
    if not reasons:
        reasons.append("Standard fix — include in next regression cycle")

    modules = sorted({t["module"] for t in created if t.get("module")})

    return {
        "created": created,
        "errors":  errors,
        "summary": {
            "total_published": total,
            "failed":          len(errors),
            "project":         project,
            "folder":          folder_path,
            "modules":         modules,
            "jira_id":         jira_id,
            "jira_title":      jira_title,
        },
        "impact_analysis": {
            "add_to_regression":     add_to_regression,
            "regression_score":      round(regression_score, 2),
            "high_priority_count":   high_count,
            "medium_priority_count": medium_count,
            "low_priority_count":    low_count,
            "recommendation": "Add to Regression Test Plan" if add_to_regression else "Add to Smoke Test Plan only",
            "reasons": reasons,
        },
        "jira_base_url": JIRA_BASE_URL,
    }


@app.post("/api/regression/sync")
async def regression_sync(request: Request):
    """
    Regression suite sync:
      1. Create selected TCs in XRAY
      2. Add "regression" label to the JIRA issue
      3. Link XRAY tests to JIRA card
      4. Optionally add tests to a regression test plan
    Body: { jira_id, jira_title, test_cases, folder_path, test_plan_key }
    """
    body          = await request.json()
    jira_id       = body.get("jira_id", "")
    jira_title    = body.get("jira_title", "")
    test_cases    = body.get("test_cases", [])
    folder_path   = (body.get("folder_path") or "").strip()
    test_plan_key = (body.get("test_plan_key") or "").strip()
    project       = jira_id.split("-")[0] if "-" in jira_id else "SBPWC"

    if not test_cases:
        raise HTTPException(status_code=400, detail="No test cases provided")
    if not XRAY_CLIENT_ID or not XRAY_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="XRAY credentials not configured")

    token   = await _xray_authenticate()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def _esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "")

    # ── 1. Create TCs in XRAY ────────────────────────────────────────────────
    created: list = []
    errors:  list = []

    for tc in test_cases:
        summary_txt = _esc(tc.get("title", ""))
        steps       = tc.get("steps", [])
        expected    = _esc(tc.get("expected", ""))

        steps_gql_parts = []
        for i, s in enumerate(steps[:15]):
            action = _esc(str(s))
            result = _esc(expected) if i == len(steps) - 1 else ""
            steps_gql_parts.append(f'{{action: "{action}", data: "", result: "{result}"}}')
        steps_arg = f'steps: [{" ".join(steps_gql_parts)}],' if steps_gql_parts else ""

        mutation = (
            'mutation {'
            '  createTest('
            f'    jira: {{ fields: {{ summary: "{summary_txt}", '
            f'      project: {{ key: "{project}" }} }} }},'
            f'    testType: {{ name: "Manual" }},'
            f'    {steps_arg}'
            '  ) {'
            '    test { issueId jira(fields: ["key","summary"]) }'
            '    warnings'
            '  }'
            '}'
        )

        log.info("[REGRESSION] Creating: %s", tc.get("title", "")[:80])
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                r = await client.post(XRAY_GQL_URL, json={"query": mutation}, headers=headers)
            except Exception as exc:
                errors.append({"tc_id": tc.get("id"), "error": str(exc)})
                continue

        if r.status_code != 200:
            errors.append({"tc_id": tc.get("id"), "error": f"HTTP {r.status_code}: {r.text[:200]}"})
            continue

        d = r.json()
        if "errors" in d:
            errors.append({"tc_id": tc.get("id"), "error": str(d["errors"])[:200]})
            continue

        test_node = d.get("data", {}).get("createTest", {}).get("test") or {}
        xray_key  = (test_node.get("jira") or {}).get("key", "")
        issue_id  = test_node.get("issueId", "")

        assigned_folder = folder_path
        if folder_path and issue_id:
            fm = (
                'mutation {'
                f'  addTestsToFolder(projectKey: "{project}", path: "{_esc(folder_path)}", '
                f'    issueIds: ["{issue_id}"]) {{'
                '    folder { path } warnings'
                '  }'
                '}'
            )
            async with httpx.AsyncClient(timeout=15) as client:
                try:
                    fr = await client.post(XRAY_GQL_URL, json={"query": fm}, headers=headers)
                    if fr.status_code == 200:
                        assigned_folder = (
                            ((fr.json().get("data", {}).get("addTestsToFolder", {})
                              .get("folder")) or {}).get("path", folder_path)
                        )
                except Exception:
                    pass

        created.append({
            "tc_id":    tc.get("id"),
            "title":    tc.get("title"),
            "module":   tc.get("module", "General"),
            "priority": tc.get("priority", "Medium"),
            "xray_key": xray_key,
            "issue_id": issue_id,
            "folder":   assigned_folder,
        })
        log.info("[REGRESSION] Created %s → XRAY %s", tc.get("id"), xray_key)

    xray_keys   = [t["xray_key"] for t in created if t.get("xray_key")]
    xray_issues = [t["issue_id"] for t in created if t.get("issue_id")]

    # ── 2. Add "regression" label to JIRA issue ──────────────────────────────
    jira_label_added = False
    if jira_id and JIRA_BASE_URL and JIRA_EMAIL and JIRA_API_TOKEN:
        async with httpx.AsyncClient(timeout=20) as client:
            try:
                lr = await client.put(
                    f"{JIRA_BASE_URL}/rest/api/3/issue/{jira_id}",
                    json={"update": {"labels": [{"add": "regression"}]}},
                    auth=(JIRA_EMAIL, JIRA_API_TOKEN),
                    headers={"Accept": "application/json", "Content-Type": "application/json"},
                )
                jira_label_added = lr.status_code in (200, 204)
                if not jira_label_added:
                    log.warning("[REGRESSION] JIRA label HTTP %d for %s", lr.status_code, jira_id)
                else:
                    log.info("[REGRESSION] Added 'regression' label to %s", jira_id)
            except Exception as exc:
                errors.append(f"JIRA label error: {exc}")

    # ── 3. Link XRAY tests to JIRA card ──────────────────────────────────────
    linked_keys: list = []
    if xray_keys and jira_id and JIRA_BASE_URL and JIRA_EMAIL and JIRA_API_TOKEN:
        async with httpx.AsyncClient(timeout=20) as client:
            for xk in xray_keys:
                try:
                    link_r = await client.post(
                        f"{JIRA_BASE_URL}/rest/api/3/issueLink",
                        json={
                            "type":         {"name": "Tests"},
                            "outwardIssue": {"key": jira_id},
                            "inwardIssue":  {"key": xk},
                        },
                        auth=(JIRA_EMAIL, JIRA_API_TOKEN),
                        headers={"Accept": "application/json", "Content-Type": "application/json"},
                    )
                    if link_r.status_code in (200, 201, 204):
                        linked_keys.append(xk)
                    else:
                        log.warning("[REGRESSION] Link %s → %s: HTTP %d", xk, jira_id, link_r.status_code)
                except Exception as le:
                    errors.append(f"Link {xk} error: {le}")

    # ── 4. Add to regression test plan (if provided) ─────────────────────────
    test_plan_added = False
    if test_plan_key and xray_issues and XRAY_CLIENT_ID and XRAY_CLIENT_SECRET:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                plan_r = await client.get(
                    f"{JIRA_BASE_URL}/rest/api/3/issue/{test_plan_key}?fields=id",
                    auth=(JIRA_EMAIL, JIRA_API_TOKEN),
                    headers={"Accept": "application/json"},
                )
                if plan_r.status_code == 200:
                    plan_jira_id = plan_r.json().get("id", "")
                    if plan_jira_id:
                        ids_gql = ", ".join(f'"{i}"' for i in xray_issues)
                        plan_mutation = (
                            'mutation {'
                            f'  addTestsToTestPlan(issueId: "{plan_jira_id}", testIssueIds: [{ids_gql}]) {{'
                            '    addedTests warning'
                            '  }'
                            '}'
                        )
                        async with httpx.AsyncClient(timeout=20) as xcl:
                            pr = await xcl.post(XRAY_GQL_URL, json={"query": plan_mutation}, headers=headers)
                            if pr.status_code == 200 and "errors" not in pr.json():
                                test_plan_added = True
                                log.info("[REGRESSION] Added %d tests to plan %s", len(xray_issues), test_plan_key)
                            else:
                                log.warning("[REGRESSION] Test plan mutation failed: %s", pr.text[:200])
                else:
                    log.warning("[REGRESSION] Could not fetch plan %s: HTTP %d", test_plan_key, plan_r.status_code)
        except Exception as exc:
            log.warning("[REGRESSION] Test plan error: %s", exc)
            errors.append(f"Test plan error: {exc}")

    return {
        "created":          created,
        "errors":           errors,
        "summary": {
            "total_published": len(created),
            "failed":          len([e for e in errors if isinstance(e, dict)]),
            "project":         project,
            "folder":          folder_path,
            "jira_id":         jira_id,
        },
        "jira_label_added": jira_label_added,
        "xray_linked":      linked_keys,
        "test_plan_added":  test_plan_added,
        "jira_base_url":    JIRA_BASE_URL,
    }


@app.post("/api/regression/link")
async def regression_link(request: Request):
    """
    Lightweight post-publish regression link:
      - Adds 'regression' label to the JIRA issue
      - Adds already-created XRAY tests to a regression test plan (if provided)
    Body: { jira_id, issue_ids: [str], xray_keys: [str], test_plan_key }
    Returns: { jira_label_added, test_plan_added, linked_count }
    """
    body               = await request.json()
    jira_id            = body.get("jira_id", "")
    issue_ids          = body.get("issue_ids", [])    # XRAY internal issue IDs
    test_plan_key      = (body.get("test_plan_key") or "").strip()
    test_plan_issue_id = (body.get("test_plan_issue_id") or "").strip()  # pre-resolved from dropdown

    result = {"jira_label_added": False, "test_plan_added": False, "linked_count": len(issue_ids)}

    # ── 1. Add "regression" label to JIRA ─────────────────────────────────
    if jira_id and JIRA_BASE_URL and JIRA_EMAIL and JIRA_API_TOKEN:
        async with httpx.AsyncClient(timeout=20) as client:
            try:
                lr = await client.put(
                    f"{JIRA_BASE_URL}/rest/api/3/issue/{jira_id}",
                    json={"update": {"labels": [{"add": "regression"}]}},
                    auth=(JIRA_EMAIL, JIRA_API_TOKEN),
                    headers={"Accept": "application/json", "Content-Type": "application/json"},
                )
                result["jira_label_added"] = lr.status_code in (200, 204)
                log.info("[REGRESSION LINK] JIRA label for %s: HTTP %d", jira_id, lr.status_code)
            except Exception as exc:
                log.warning("[REGRESSION LINK] JIRA label error: %s", exc)

    # ── 2. Add to XRAY regression test plan ───────────────────────────────
    if test_plan_key and issue_ids and XRAY_CLIENT_ID and XRAY_CLIENT_SECRET:
        try:
            token = await _xray_authenticate()
            headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
            # Use pre-resolved issue ID from dropdown, or fall back to JIRA REST lookup
            plan_jira_id = test_plan_issue_id
            if not plan_jira_id and JIRA_BASE_URL and JIRA_EMAIL and JIRA_API_TOKEN:
                async with httpx.AsyncClient(timeout=15) as client:
                    plan_r = await client.get(
                        f"{JIRA_BASE_URL}/rest/api/3/issue/{test_plan_key}?fields=id",
                        auth=(JIRA_EMAIL, JIRA_API_TOKEN),
                        headers={"Accept": "application/json"},
                    )
                    if plan_r.status_code == 200:
                        plan_jira_id = plan_r.json().get("id", "")
            if plan_jira_id:
                ids_gql = ", ".join(f'"{i}"' for i in issue_ids)
                mutation = (
                    'mutation {'
                    f'  addTestsToTestPlan(issueId: "{plan_jira_id}", testIssueIds: [{ids_gql}]) {{'
                    '    addedTests warning'
                    '  }'
                    '}'
                )
                async with httpx.AsyncClient(timeout=20) as xcl:
                    pr = await xcl.post(XRAY_GQL_URL, json={"query": mutation}, headers=headers)
                    if pr.status_code == 200 and "errors" not in pr.json():
                        result["test_plan_added"] = True
                        log.info("[REGRESSION LINK] Added %d tests to plan %s", len(issue_ids), test_plan_key)
                    else:
                        log.warning("[REGRESSION LINK] Test plan mutation: %s", pr.text[:200])
        except Exception as exc:
            log.warning("[REGRESSION LINK] Test plan error: %s", exc)

    return {**result, "jira_base_url": JIRA_BASE_URL}


@app.post("/api/analyze")
async def analyze(request: AnalyzeRequest):
    t0 = time.perf_counter()
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    log.info("[ANALYZE] START  jira=%s  tfs=%s", request.jira_id, request.tfs_changeset_id)
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    log.info("[Phase 1/5] Fetching JIRA data...")
    jira_data = await get_jira_issue(request.jira_id)
    log.info("[Phase 1/5] JIRA complete (%.2fs)", time.perf_counter() - t0)

    if request.tfs_changeset_id and request.tfs_changeset_id != "N/A":
        first_id = request.tfs_changeset_id.split(",")[0].strip()
        log.info("[Phase 2/5] Fetching TFS changeset %s...", first_id)
        try:
            tfs_data = await get_tfs_changeset(first_id)
            log.info("[Phase 2/5] TFS complete (%.2fs)", time.perf_counter() - t0)
        except HTTPException as exc:
            log.warning("[Phase 2/5] TFS FAILED: %s", exc.detail)
            tfs_data = {
                "changeset_id": first_id,
                "author": "", "date": "", "comment": "",
                "changed_files": [], "impacted_modules": [],
                "impacted_features": [],
                "purpose": "TFS data unavailable — check TFS server connectivity",
            }
    else:
        log.info("[Phase 2/5] No TFS changeset ID provided — skipping")
        tfs_data = {
            "changeset_id": "N/A",
            "author": "", "date": "", "comment": "",
            "changed_files": [], "impacted_modules": [],
            "impacted_features": [],
            "purpose": "No TFS changeset linked to this JIRA card",
        }

    log.info("[Phase 3/5] Calling Copilot Studio MRG...")
    try:
        mrg_data = await get_mrg(MrgRequest(jira=jira_data, tfs=tfs_data))
    except Exception as mrg_exc:
        log.warning("[Phase 3/5] MRG failed (%s) — using JIRA test_recommendation as fallback", mrg_exc)
        # Build a useful MRG stub from the JIRA test_recommendation so TC generation
        # still has domain context even when Copilot Studio is offline.
        test_rec  = (jira_data.get("test_recommendation") or "").strip()
        jira_title_fb = jira_data.get("title", "")
        modules_fb  = ", ".join(tfs_data.get("impacted_modules",  []) or []) or "N/A"
        features_fb = ", ".join(tfs_data.get("impacted_features", []) or [])
        fallback_content = (
            f"[MRG — Auto-generated from JIRA test recommendation]\n"
            f"Feature: {jira_title_fb}\n"
            f"Module: {modules_fb}\n"
            + (f"Impacted areas: {features_fb}\n" if features_fb else "")
            + (f"\nTesting Guidance:\n{test_rec}" if test_rec else "")
        )
        mrg_data = {
            "mrg_content":        fallback_content,
            "modules_from_agent": tfs_data.get("impacted_modules", []),
            "test_cases":         [],
        }
    log.info("[Phase 3/5] MRG complete (%.2fs)", time.perf_counter() - t0)

    # ── Fetch existing XRAY test summaries before generation ─────────────────
    # These are the tests already linked to this JIRA card ("is tested by").
    # We pass them into the TC generator so it avoids duplicating them and
    # instead produces complementary edge/boundary/regression scenarios.
    existing_summaries: list = []
    linked_xray_keys = jira_data.get("xray_test_keys") or []
    if linked_xray_keys and XRAY_CLIENT_ID and XRAY_CLIENT_SECRET:
        try:
            _token = await _xray_authenticate()
            _hdrs  = {"Authorization": f"Bearer {_token}", "Content-Type": "application/json"}
            _keys  = ", ".join(linked_xray_keys[:50])
            _project = request.jira_id.split("-")[0] if "-" in request.jira_id else "SBPWC"
            _gql_q = (
                '{ getTests(jql: "project = ' + _project + ' AND key in (' + _keys + ')", '
                'limit: 50, start: 0) { results { jira(fields: ["summary"]) } } }'
            )
            async with httpx.AsyncClient(timeout=15) as _cl:
                _r = await _cl.post(XRAY_GQL_URL, json={"query": _gql_q}, headers=_hdrs)
                if _r.status_code == 200:
                    for _t in (_r.json().get("data", {}).get("getTests", {})
                               .get("results", [])):
                        _s = (_t.get("jira") or {}).get("summary", "")
                        if _s:
                            existing_summaries.append(_s)
            log.info("[Phase 4/5] Fetched %d existing test summaries from XRAY",
                     len(existing_summaries))
        except Exception as _exc:
            log.warning("[Phase 4/5] Could not fetch existing XRAY summaries: %s", _exc)

    log.info("[Phase 4/5] Generating test cases via Copilot Studio...")
    generated_tcs = await _generate_test_cases(
        jira_data, tfs_data, mrg_data.get("mrg_content", ""), existing_summaries
    )
    # Enrich each TC with automation/regression feasibility meta
    generated_tcs = [_compute_regression_meta(tc) for tc in generated_tcs]
    log.info("[Phase 4/5] Test case generation complete — %d TCs (%.2fs)",
             len(generated_tcs), time.perf_counter() - t0)

    log.info("[Phase 5/5] Running XRAY gap analysis...")
    xray_data = await _run_xray_gap_analysis(jira_data, tfs_data, generated_tcs)
    log.info("[Phase 5/5] XRAY gap analysis complete — missing=%d existing=%d (%.2fs)",
             len(xray_data.get("missing", [])), len(xray_data.get("existing", [])),
             time.perf_counter() - t0)

    t_total = time.perf_counter() - t0
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    log.info("[ANALYZE] COMPLETE in %.2fs  TCs=%d  missing=%d  existing=%d",
             t_total, len(generated_tcs),
             len(xray_data.get("missing", [])), len(xray_data.get("existing", [])))
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    return {
        "jira":                 jira_data,
        "tfs":                  tfs_data,
        "mrg":                  mrg_data,
        "generated_test_cases": generated_tcs,
        "xray":                 xray_data,
        "jira_base_url":        JIRA_BASE_URL,
    }

