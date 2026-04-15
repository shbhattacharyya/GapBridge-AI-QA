"""Paginate through ALL tests in SBPWC and collect every unique folder path."""
import httpx, asyncio, base64

XRAY_AUTH_URL = "https://xray.cloud.getxray.app/api/v2/authenticate"
XRAY_GQL_URL  = "https://xray.cloud.getxray.app/api/v2/graphql"
CLIENT_ID     = "1D67F94019664D8FA62CD8D6B288EA31"
CLIENT_SECRET = "c8cf0ef7b6307b5cd957fff44c8a181f60b98ee3878a6959c78c931f69678699"
PROJECT_ID    = "11636"   # SBPWC
PAGE_SIZE     = 100


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
        # Authenticate
        r = await client.post(XRAY_AUTH_URL,
                              json={"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET})
        if r.status_code != 200:
            print("Auth failed:", r.text); return
        token = r.text.strip().strip('"')
        print(f"Authenticated OK\n")

        # Paginate through all tests
        folders: dict[str, list[str]] = {}   # folder_path -> [test keys]
        start = 0
        total_fetched = 0

        while True:
            q = (
                '{ getTests(projectId: "' + PROJECT_ID + '", '
                'limit: ' + str(PAGE_SIZE) + ', start: ' + str(start) + ') '
                '{ total results { jira(fields: ["key","summary"]) folder { path } } } }'
            )
            data, err = await gql(client, token, q)
            if err:
                print(f"Error at start={start}: {err}"); break

            batch = data.get("getTests", {})
            total = batch.get("total", 0)
            results = batch.get("results", [])
            if not results:
                break

            for t in results:
                key     = (t.get("jira") or {}).get("key", "?")
                summary = (t.get("jira") or {}).get("summary", "")
                folder  = ((t.get("folder") or {}).get("path") or "/")
                folders.setdefault(folder, []).append(f"{key}: {summary}")

            total_fetched += len(results)
            print(f"  Fetched {total_fetched}/{total} tests...", end="\r")

            if total_fetched >= total:
                break
            start += PAGE_SIZE

        print(f"\n\nTotal tests: {total_fetched}")
        print(f"Unique folders: {len(folders)}\n")
        print("=" * 70)
        print("FULL FOLDER LIST (sorted):")
        print("=" * 70)
        for folder in sorted(folders.keys()):
            count = len(folders[folder])
            print(f"  [{count:3d} tests]  {folder}")

        print("\n" + "=" * 70)
        print("FOLDER TREE:")
        print("=" * 70)
        # Build tree display
        all_paths = sorted(folders.keys())
        for path in all_paths:
            depth = path.count("/") - (1 if path != "/" else 0)
            indent = "  " * max(0, depth)
            name = path.split("/")[-1] if path != "/" else "(root)"
            count = len(folders[path])
            print(f"{indent}📁 {name}  [{count}]")

asyncio.run(main())
