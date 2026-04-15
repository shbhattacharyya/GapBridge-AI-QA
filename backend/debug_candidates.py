import asyncio, json, os
os.chdir(r'C:\GapGuardAI\backend')
import main

async def check():
    # Simulate the exact call that _xray_search_candidates would make for SBPWC-11045
    jira_data = {'id': 'SBPWC-11045', 'title': 'WorkView Recently Viewed items does not respect reduction of maximum value or 0 setting'}
    generated_tcs = [
        {'id': 'TC-001', 'title': 'Verify Recently Viewed respects default max value', 'module': 'WorkView'},
        {'id': 'TC-002', 'title': 'Verify Recently Viewed updates when max value reduced', 'module': 'WorkView'},
        {'id': 'TC-003', 'title': 'Verify Recently Viewed clears when max value set to 0', 'module': 'WorkView'},
    ]

    token = await main._xray_authenticate()
    candidates = await main._xray_search_candidates(token, 'SBPWC-11045', generated_tcs, jira_data=jira_data)

    with open('C:/GapGuardAI/backend/candidates_out.json', 'w', encoding='utf-8') as f:
        json.dump(candidates, f, indent=2, ensure_ascii=False)
    print(f'Candidates: {len(candidates)}')
    for c in candidates[:10]:
        print(f"  {c['key']} | folder={c['folder']!r} | {c['summary'][:60]}")

asyncio.run(check())
