"""Debug script: fetch TFS changeset files for SBPWC-10443 and show _infer_modules output."""
import asyncio, os, sys, json
sys.path.insert(0, r"C:\GapGuardAI\backend")
os.chdir(r"C:\GapGuardAI\backend")

from main import _infer_modules, _get_tfs_changeset_for_jira, JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, TFS_BASE_URL, TFS_PAT
import httpx, base64

async def main():
    card = "SBPWC-10443"
    # Step 1: get TFS data via existing helper
    tfs = await _get_tfs_changeset_for_jira(card)
    print(f"\n=== TFS for {card} ===")
    print(f"changeset: {tfs.get('changeset_id')}")
    print(f"files ({len(tfs.get('changed_files', []))}):")
    for f in tfs.get("changed_files", []):
        print(f"  {f}")
    
    print(f"\nimpacted_modules: {tfs.get('impacted_modules')}")
    print(f"impacted_features: {tfs.get('impacted_features')}")
    
    # Step 2: manually run _infer_modules on the paths to show output
    paths = tfs.get("changed_files", [])
    result = _infer_modules(paths)
    print(f"\n_infer_modules result: {result}")

asyncio.run(main())
