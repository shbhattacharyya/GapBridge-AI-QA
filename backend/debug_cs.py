"""Debug: fetch all files in TFS changeset 404254 without limit."""
import asyncio, os, sys, base64
sys.path.insert(0, r"C:\GapGuardAI\backend")
os.chdir(r"C:\GapGuardAI\backend")
import httpx
from main import TFS_BASE_URL, TFS_COLLECTION_URL, TFS_PAT, _infer_modules

async def main():
    b64 = base64.b64encode(f":{TFS_PAT}".encode()).decode()
    headers = {"Authorization": f"Basic {b64}", "Accept": "application/json"}
    for cs in ["404254", "405438"]:
        async with httpx.AsyncClient(verify=False) as client:
            r = await client.get(
                f"{TFS_COLLECTION_URL}/_apis/tfvc/changesets/{cs}/changes?api-version=1.0",
                headers=headers, timeout=15.0
            )
        data = r.json()
        paths = [c["item"]["path"] for c in data.get("value", [])]
        print(f"\n=== Changeset {cs} — {len(paths)} files ===")
        for p in paths:
            print(f"  {p}")
        print(f"_infer_modules: {_infer_modules(paths)}")

asyncio.run(main())
