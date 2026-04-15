import asyncio, httpx, os
from dotenv import load_dotenv
load_dotenv()
XRAY_CLIENT_ID = os.getenv("XRAY_CLIENT_ID")
XRAY_CLIENT_SECRET = os.getenv("XRAY_CLIENT_SECRET")

async def test():
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post("https://xray.cloud.getxray.app/api/v2/authenticate",
            json={"client_id": XRAY_CLIENT_ID, "client_secret": XRAY_CLIENT_SECRET})
        print("Auth status:", r.status_code)
        if r.status_code != 200:
            print("Auth error:", r.text[:300])
            return
        token = r.text.strip().strip('"')
        print("Token len:", len(token))
        gql = '{ getTests(jql: "project = SBPWC AND summary ~ \\"filter\\"", limit: 5, start: 0) { results { jira(fields: ["key","summary"]) folder { path } } } }'
        r2 = await c.post("https://xray.cloud.getxray.app/api/v2/graphql",
            json={"query": gql},
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        print("GQL status:", r2.status_code)
        d = r2.json()
        if "errors" in d:
            print("GQL errors:", d["errors"])
        results = d.get("data",{}).get("getTests",{}).get("results",[])
        print("Results:", len(results))
        for t in results[:3]:
            print(" -", t.get("jira",{}).get("key"), "|", t.get("jira",{}).get("summary","")[:60], "|", (t.get("folder") or {}).get("path",""))

asyncio.run(test())
