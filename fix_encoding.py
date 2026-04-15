import re

with open(r'c:\GapGuardAI\frontend\src\App.jsx', encoding='utf-8') as f:
    text = f.read()

# Fix all remaining mojibake by doing the cp1252 round-trip on just the bad sequences.
# These are all the windows-1252 two-byte sequences that snuck in through PowerShell Add-Content.

fixes = [
    # middle dot Â· -> ·
    ('\u00c2\u00b7', '\u00b7'),
    # em dash â€" -> —
    ('\u00e2\u0080\u0094', '\u2014'),
    # en dash â€" -> –
    ('\u00e2\u0080\u0093', '\u2013'),
    # horizontal ellipsis â€¦ -> …
    ('\u00e2\u0080\u00a6', '\u2026'),
    # right arrow â†' -> →
    ('\u00e2\u0086\u0092', '\u2192'),
    # check mark âœ" -> ✔
    ('\u00e2\u009c\u0094', '\u2714'),
    # check mark âœ… -> ✅
    ('\u00e2\u009c\u0085', '\u2705'),
    # warning â›  / âš  -> ⚠
    ('\u00e2\u009a\u00a0', '\u26a0'),
    # 🎯 ðŸŽ¯
    ('\u00f0\u009f\u008e\u00af', '\U0001f3af'),
    # 🎫 ðŸŽ«
    ('\u00f0\u009f\u008e\u00ab', '\U0001f3ab'),
    # 📂 ðŸ"‚
    ('\u00f0\u009f\u0093\u0082', '\U0001f4c2'),
    # 🤖 ðŸ¤–
    ('\u00f0\u009f\u00a4\u0096', '\U0001f916'),
    # 📁 ðŸ"
    ('\u00f0\u009f\u0093\u0081', '\U0001f4c1'),
    # right guillemet â€º -> ›
    ('\u00e2\u0080\u00ba', '\u203a'),
]

count = 0
for bad, good in fixes:
    n = text.count(bad)
    if n:
        text = text.replace(bad, good)
        print(f'  Fixed {n}x: {repr(bad)} -> {repr(good)}')
        count += n

with open(r'c:\GapGuardAI\frontend\src\App.jsx', 'w', encoding='utf-8') as f:
    f.write(text)

print(f'\nTotal replacements: {count}')
print('Done.')
