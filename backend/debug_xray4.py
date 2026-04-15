import asyncio, httpx, os, json
os.chdir(r'C:\GapGuardAI\backend')
import main

async def check():
    token = await main._xray_authenticate()
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

    tests = {
        'folder_tilde':     'project = SBPWC AND folder ~ "SBPWC-11045"',
        'folder_exact_misc':'project = SBPWC AND folder = "/Miscellaneous/SBPWC-11045 - Recently Viewed Items functionality"',
        'keyword_recent':   'project = SBPWC AND summary ~ "recently viewed" AND summary ~ "maximum"',
        'folder_misc_top':  'project = SBPWC AND folder = "/Miscellaneous"',
    }
    out = {}
    for name, jql in tests.items():
        escaped = jql.replace('\\', '\\\\').replace('"', '\\"')
        gql = '{ getTests(jql: "' + escaped + '", limit:10, start:0) { results { jira(fields: ["key","summary"]) folder { path } } } }'
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(main.XRAY_GQL_URL, json={'query': gql}, headers=headers)
        data = r.json()
        if 'errors' in data:
            out[name] = {'error': str(data['errors'])}
            continue
        results = data.get('data', {}).get('getTests', {}).get('results', [])
        out[name] = [
            {'key': x['jira']['key'], 'folder': (x.get('folder') or {}).get('path', '/'), 'summary': x['jira']['summary'][:60]}
            for x in results
        ]

    with open('C:/GapGuardAI/backend/xray_check.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print('Written to xray_check.json')

asyncio.run(check())
