"""One-shot probe: authenticate with XRAY Cloud, resolve SBPWC project ID,
then fetch the full folder tree (3 levels deep)."""
import httpx, json, asyncio, base64

import os

XRAY_AUTH_URL = "https://xray.cloud.getxray.app/api/v2/authenticate"
XRAY_GQL_URL  = "https://xray.cloud.getxray.app/api/v2/graphql"
CLIENT_ID     = os.environ["XRAY_CLIENT_ID"]
CLIENT_SECRET = os.environ["XRAY_CLIENT_SECRET"]
JIRA_BASE     = os.environ.get("JIRA_BASE_URL", "https://hyland.atlassian.net")
JIRA_EMAIL    = os.environ["JIRA_EMAIL"]
JIRA_TOKEN    = os.environ["JIRA_API_TOKEN"]

jira_b64 = base64.b64encode(f"{JIRA_EMAIL}:{JIRA_TOKEN}".encode()).decode()
JIRA_HEADERS = {"Authorization": f"Basic {jira_b64}", "Accept": "application/json"}


async def gql(client, token, query):
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    r = await client.post(XRAY_GQL_URL, json={"query": query}, headers=h, timeout=30)
    if r.status_code != 200:
        return None, f"HTTP {r.status_code}: {r.text[:200]}"
    d = r.json()
    if "errors" in d:
        return None, d["errors"][0]["message"]
    return d.get("data"), None


async def main():
    async with httpx.AsyncClient(timeout=30) as client:
        # ── 1. XRAY Auth ──────────────────────────────────────────────
        print("── 1. XRAY Authentication ──")
        r = await client.post(XRAY_AUTH_URL,
                              json={"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET})
        print(f"   Status: {r.status_code}")
        if r.status_code != 200:
            print(f"   FAILED: {r.text}"); return
        token = r.text.strip().strip('"')
        print(f"   Token OK (len={len(token)})")

        # ── 2. Resolve SBPWC project numeric ID ───────────────────────
        print("\n── 2. Resolve JIRA project ID for SBPWC ──")
        pj = await client.get(f"{JIRA_BASE}/rest/api/3/project/SBPWC", headers=JIRA_HEADERS)
        print(f"   Status: {pj.status_code}")
        if pj.status_code != 200:
            print(f"   FAILED: {pj.text[:200]}"); return
        pid = str(pj.json().get("id", ""))
        print(f"   Project numeric ID: {pid}")

        # ── 3. Top-level folders ───────────────────────────────────────
        print("\n── 3. Top-level XRAY folders ──")
        # Try v2 schema — folders field is JSON scalar, not nested object
        q = '{ getFolder(projectId: "' + pid + '", path: "/") { name path } }'
        data, err = await gql(client, token, q)
        if err:
            # Fallback: try without subfields at all
            print(f"   Folder query error: {err}")
            print("   Trying getTests project-wide instead...")
            data, err = None, None

        if data:
            root = data.get("getFolder", {})
            print(f"   Root folder name: {root.get('name')}  path: {root.get('path')}")
            folders_raw = root.get("folders", [])
            if isinstance(folders_raw, list):
                print(f"   Sub-folders: {folders_raw}")
                all_paths = [f.get("path", f) if isinstance(f, dict) else str(f)
                             for f in folders_raw]
            else:
                # folders is a JSON scalar — it may be a list of strings or dicts
                print(f"   folders raw type={type(folders_raw)}  value={str(folders_raw)[:200]}")
                all_paths = []
        else:
            all_paths = []

        # Always sample tests project-wide to understand folder distribution
        print("\n── 3b. Sample 20 tests project-wide to discover folders ──")
        q_all = (
            '{ getTests(projectId: "' + pid + '", limit: 20) '
            '{ results { jira(fields: ["key","summary"]) folder { path } } } }'
        )
        data_all, err_all = await gql(client, token, q_all)
        if err_all:
            print(f"   ERROR: {err_all}")
        else:
            tests_all = (data_all or {}).get("getTests", {}).get("results", [])
            print(f"   Total sampled: {len(tests_all)}")
            seen_folders = {}
            for t in tests_all:
                key     = t.get("jira", {}).get("key", "?")
                summary = t.get("jira", {}).get("summary", "?")
                folder  = (t.get("folder") or {}).get("path", "/")
                seen_folders.setdefault(folder, []).append(f"{key}: {summary}")

            print("\n   Folder → tests discovered:")
            for folder, items in sorted(seen_folders.items()):
                print(f"\n   📁 {folder}")
                for item in items:
                    print(f"      {item}")
        
        all_paths = list(seen_folders.keys()) if data_all else []

        # ── 4. Sample tests from first 3 discovered folders ──────────
        print("\n── 4. Sample tests from first 3 discovered folders ──")
        for fpath in all_paths[:3]:
            escaped = fpath.replace('"', '\\"')
            q2 = (
                '{ getTests(projectId: "' + pid + '", '
                'folder: { path: "' + escaped + '", includeDescendants: false }, '
                'limit: 5) { results { jira(fields: ["key","summary"]) folder { path } } } }'
            )
            data2, err2 = await gql(client, token, q2)
            if err2:
                print(f"   [{fpath}] ERROR: {err2}")
                continue
            tests = (data2 or {}).get("getTests", {}).get("results", [])
            print(f"\n   📁 {fpath} ({len(tests)} sampled):")
            for t in tests:
                key     = t.get("jira", {}).get("key", "?")
                summary = t.get("jira", {}).get("summary", "?")
                print(f"      {key}: {summary}")

        print("\n── Done ──")


asyncio.run(main())
