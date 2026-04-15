import asyncio
import sys
import os
sys.stdout.reconfigure(encoding='utf-8')
os.chdir(os.path.dirname(os.path.abspath(__file__)))

import main

async def test():
    jira = {
        'title': 'WorkView Recently Viewed items does not respect reduction of maximum value',
        'description': 'When setting Maximum Number of Recently Viewed Items to 0, users still see items.',
        'test_recommendation': 'Verify recently viewed list is empty when max set to 0.'
    }
    tfs  = {
        'comment': 'Fixed recently viewed item queue behavior',
        'impacted_modules': ['WorkView'],
        'impacted_features': ['Recently Viewed Items']
    }
    mrg = 'Recently Viewed Items: configurable via OnBase Studio. If max is 0, feature is disabled.'

    print("Calling _directline_converse directly...")
    raw = await main._directline_converse(
        "Generate exactly 6 test cases for Recently Viewed Items. Format: TC-001 | title | steps | expected | priority",
        "TEST"
    )
    print(f"Raw reply ({len(raw)} chars):")
    print(repr(raw[:500]))
    print()
    print("Calling _generate_test_cases...")
    tcs = await main._generate_test_cases(jira, tfs, mrg)
    print(f"TC count: {len(tcs)}")
    for tc in tcs:
        print(f"  {tc.get('id')} | {tc.get('title')} | {tc.get('priority')}")
    return tcs

asyncio.run(test())
