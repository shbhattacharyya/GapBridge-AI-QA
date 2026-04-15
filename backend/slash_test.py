import asyncio, json, os
os.chdir(r'C:\GapGuardAI\backend')
import main

async def check():
    token = await main._xray_authenticate()
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
    
    async def jql(q, limit=10):
        esc = q.replace('\\','\\\\').replace('"','\\"')
        gql = '{ getTests(jql: "' + esc + f'", limit:{limit}, start:0) {{ results {{ jira(fields: ["key","summary"]) folder {{ path }} }} }} }}'
        import httpx
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(main.XRAY_GQL_URL, json={'query': gql}, headers=headers)
        d = r.json()
        if 'errors' in d:
            return f"ERROR: {d['errors']}"
        return d.get('data',{}).get('getTests',{}).get('results',[])

    folder_with    = '/Miscellaneous/SBPWC-11045 - Recently Viewed items functionality'
    folder_without =  'Miscellaneous/SBPWC-11045 - Recently Viewed items functionality'

    r1 = await jql(f'project = SBPWC AND folder = "{folder_with}"', 5)
    r2 = await jql(f'project = SBPWC AND folder = "{folder_without}"', 5)

    out = {
        'with_leading_slash': len(r1) if isinstance(r1, list) else r1,
        'without_leading_slash': len(r2) if isinstance(r2, list) else r2,
        'sample': [{'key': t['jira']['key'], 'folder': (t.get('folder') or {}).get('path','/')} for t in (r2 if isinstance(r2, list) else [])[:3]],
    }
    with open('C:/GapGuardAI/backend/slash_test.json','w',encoding='utf-8') as f:
        json.dump(out, f, indent=2)
    print('Done → slash_test.json')

asyncio.run(check())
