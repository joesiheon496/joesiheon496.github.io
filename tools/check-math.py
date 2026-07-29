r"""렌더된 글의 본문에서 수식이 깨지지 않았는지 확인한다.

사용법: python tools/check-math.py <rendered-index.html>

Goldmark 가 수식을 건드리면 & -> &amp;, \\ -> \, x' -> x&rsquo; 로 변형되고
블록 안에 </h1> 이 끼어든다. 원인은 대개 블록 수식 안의 홀로 있는 '=' 줄이다
(Markdown 이 setext 제목 밑줄로 해석한다).

script/style 을 먼저 제거하는 것이 중요하다. JSON-LD 와 KaTeX 설정이 본문으로
잡히면 손상을 놓치고 정상으로 오판한다 — 1편에서 실제로 그랬다.
"""
import re
import sys

# Windows 콘솔 기본 인코딩(cp949)에는 em-dash 같은 문자가 없어 출력이 죽는다.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except AttributeError:
    pass

if len(sys.argv) < 2:
    print("사용법: python tools/check-math.py <rendered-index.html>")
    sys.exit(2)

path = sys.argv[1]
html = open(path, encoding="utf-8").read()

clean = re.sub(r"<script\b.*?</script>", "", html, flags=re.S)
clean = re.sub(r"<style\b.*?</style>", "", clean, flags=re.S)

m = re.search(r'class="post-content"[^>]*>(.*)', clean, re.S)
body = m.group(1) if m else clean

blocks = re.findall(r"\$\$(.*?)\$\$", body, re.S)
inline = re.findall(r"\\\((.*?)\\\)", body)
print("block formulas: %d" % len(blocks))
print("inline formulas: %d" % len(inline))

problems = []
for i, b in enumerate(blocks):
    print("  [%d] %s" % (i, b.strip().replace("\n", " ")[:150]))
    if "&amp;" in b:
        problems.append("block %d: & 가 &amp; 로 이스케이프됐다" % i)
    if "</h1>" in b or "<p>" in b:
        problems.append("block %d: 블록이 쪼개졌다 (홀로 있는 = 줄을 찾아라)" % i)
    if "&rsquo;" in b or "&lsquo;" in b:
        problems.append("block %d: 따옴표가 스마트쿼트로 바뀌었다" % i)

bad_em = re.findall(r"<em>[^<]{1,4}</em>", body)
if bad_em:
    problems.append("본문에 의심스러운 <em>: %r" % (bad_em[:8],))

if problems:
    print("\nFAIL")
    for p in problems:
        print("  - " + p)
    sys.exit(1)
print("\nOK — 수식 손상 없음")
