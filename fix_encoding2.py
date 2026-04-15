"""
Fix remaining mojibake in App.jsx.
Characters were UTF-8 bytes misread as cp1252, then re-encoded as UTF-8.
For each bad char: utf8_bytes -> cp1252_chars -> utf8_encoded_in_file
Fix: find the cp1252_chars sequence and replace with the original unicode char.
"""

def utf8_to_cp1252_mojibake(char):
    """Return the cp1252 mojibake string that represents this unicode char."""
    try:
        raw_bytes = char.encode('utf-8')
        return raw_bytes.decode('cp1252')
    except (UnicodeDecodeError, UnicodeEncodeError):
        return None

# Build replacement table for all chars we care about
targets = [
    '—',   # em dash U+2014
    '–',   # en dash U+2013
    '…',   # ellipsis U+2026
    '→',   # right arrow U+2192
    '←',   # left arrow U+2190
    '›',   # right guillemet U+203A
    '·',   # middle dot U+00B7
    '⚠',   # warning U+26A0
    '✔',   # check U+2714
    '✅',   # check box U+2705
    '✓',   # check U+2713
    '✖',   # x U+2716
    '≈',   # approx U+2248
    '●',   # bullet U+25CF
    '○',   # circle U+25CB
    '🎯',  # dart U+1F3AF
    '🎫',  # ticket U+1F3AB
    '📂',  # folder U+1F4C2
    '📁',  # folder U+1F4C1
    '🤖',  # robot U+1F916
    '⚙',   # gear U+2699
]

with open(r'c:\GapGuardAI\frontend\src\App.jsx', encoding='utf-8') as f:
    text = f.read()

total = 0
for char in targets:
    mojibake = utf8_to_cp1252_mojibake(char)
    if mojibake and mojibake != char:
        count = text.count(mojibake)
        if count:
            text = text.replace(mojibake, char)
            print(f'  Fixed {count}x: {repr(mojibake)} -> {repr(char)} ({char})')
            total += count

with open(r'c:\GapGuardAI\frontend\src\App.jsx', 'w', encoding='utf-8') as f:
    f.write(text)

print(f'\nTotal: {total} replacements. Done.')
