import asyncio
import sys
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Write all output to a file to bypass encoding issues
_log = open("C:/GapGuardAI/backend/xray_debug_out.txt", "w", encoding="utf-8")

def p(msg=""):
    _log.write(str(msg) + "\n")
    _log.flush()

import main

async def test():
    p("Getting XRAY token...")
    token = await main._xray_authenticate()
    p(f"Token OK ({len(token)} chars)")

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    async def run_jql(jql, limit=20):
        gql_q = (
            '{ getTests(jql: "'
            + jql.replace("\\", "\\\\").replace('"', '\\"')
            + f'", limit: {limit}, start: 0) '
            + '{ results { jira(fields: ["key","summary"]) folder { path } } } }'
        )
        import httpx
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(main.XRAY_GQL_URL, json={"query": gql_q}, headers=headers)
        if r.status_code != 200:
            p(f"HTTP {r.status_code}: {r.text[:200]}")
            return []
        d = r.json()
        if "errors" in d:
            p(f"GQL errors: {d['errors']}")
            return []
        return d.get("data", {}).get("getTests", {}).get("results", [])

    p("\n=== Tier-1a: folder ~ SBPWC-11045 ===")
    r1a = await run_jql('project = SBPWC AND folder ~ "SBPWC-11045"', 20)
    p(f"Count: {len(r1a)}")
    for t in r1a[:5]:
        key = t.get("jira", {}).get("key", "?")
        folder = (t.get("folder") or {}).get("path", "/")
        summary = t.get("jira", {}).get("summary", "")[:60]
        p(f"  {key} | {folder} | {summary}")

    p("\n=== Tier-1b: issue = SBPWC-11045 ===")
    r1b = await run_jql('project = SBPWC AND issue = SBPWC-11045', 20)
    p(f"Count: {len(r1b)}")

    p("\n=== Check SBPWC-12703 folder ===")
    r12703 = await run_jql('key = SBPWC-12703', 5)
    for t in r12703:
        key = t.get("jira", {}).get("key", "?")
        folder = (t.get("folder") or {}).get("path", "/")
        summary = t.get("jira", {}).get("summary", "")[:80]
        p(f"  {key} | folder={folder!r} | {summary}")

    p("\n=== Try folder = exact path ===\n")
    # Try the exact folder path from the screenshot
    r_exact = await run_jql('project = SBPWC AND folder = "/Miscellaneous/SBPWC-11045 - Recently Viewed Items functionality"', 20)
    p(f"Exact path count: {len(r_exact)}")
    for t in r_exact[:3]:
        key = t.get("jira", {}).get("key", "?")
        folder = (t.get("folder") or {}).get("path", "/")
        p(f"  {key} | {folder}")

    p("\n=== Try broader keyword: recently viewed ===\n")
    r_kw = await run_jql('project = SBPWC AND summary ~ "recently viewed" AND summary ~ "maximum"', 10)
    p(f"Keyword count: {len(r_kw)}")
    for t in r_kw[:5]:
        key = t.get("jira", {}).get("key", "?")
        folder = (t.get("folder") or {}).get("path", "/")
        summary = t.get("jira", {}).get("summary", "")[:80]
        p(f"  {key} | folder={folder!r} | {summary}")

    p("\n=== Try folder = /Miscellaneous ===\n")
    r_misc = await run_jql('project = SBPWC AND folder = "/Miscellaneous"', 30)
    p(f"Miscellaneous count: {len(r_misc)}")
    for t in r_misc[:5]:
        key = t.get("jira", {}).get("key", "?")
        folder = (t.get("folder") or {}).get("path", "/")
        summary = t.get("jira", {}).get("summary", "")[:60]
        p(f"  {key} | folder={folder!r} | {summary}")

    p("\n=== List top-level folders in SBPWC project ===\n")
    r_all = await run_jql('project = SBPWC', 20)
    folders_seen = set()
    p(f"Sample tests (first 20):")
    for t in r_all:
        key = t.get("jira", {}).get("key", "?")
        folder = (t.get("folder") or {}).get("path", "/")
        summary = t.get("jira", {}).get("summary", "")[:60]
        folders_seen.add(folder)
        p(f"  {key} | folder={folder!r} | {summary}")
    p(f"Unique folders: {folders_seen}")    

