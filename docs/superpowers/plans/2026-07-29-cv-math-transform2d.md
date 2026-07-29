# CV 수학 시리즈 1편 (2D 변환 행렬) + 인터랙티브 데모 하니스 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수학을 모르는 독자가 슬라이더와 드래그로 2D 변환 행렬을 직접 만져보는 블로그 글 1편과, 후속 글이 재사용할 데모 하니스를 만든다.

**Architecture:** 순수 수학은 의존성 없는 ES 모듈(`transform.js`)로 분리해 Node 내장 테스트 러너로 TDD 한다. 캔버스·드래그·슬라이더는 `core.js`, 1편 전용 조립은 `transform2d.js`. Hugo shortcode 가 이들을 글에 삽입한다. 수식은 KaTeX 를 `math = true` 인 글에서만 로드한다.

**Tech Stack:** Hugo 0.164 + PaperMod, 바닐라 ES 모듈 + Canvas 2D, KaTeX(CDN), Node 24 `node:test`

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-29-cv-math-transform2d-design.md`
- 데모 JS 의 외부 의존성은 **0**. 빌드 스텝 없음. 외부 CDN 은 KaTeX 뿐이다.
- 수식 구분자: 블록 `$$...$$` 와 `\[...\]`, 인라인 `\(...\)`. **인라인에 `$...$` 를 쓰지 않는다** (기존 12편 회귀 방지).
- 캔버스 색은 하드코딩 금지. CSS 변수를 읽고 테마 변경 시 재렌더한다. PaperMod 에 light/dark 토글이 있다.
- 글 날짜를 미래로 적지 않는다. 미래 날짜면 Hugo 가 글을 빌드에서 제외한다.
- Hugo 빌드에는 `go` 가 PATH 에 필요하다 (PaperMod 가 Hugo 모듈). 설치 위치: `C:\Program Files\Go\bin`.
  Bash 에서: `export PATH="$PATH:/c/Program Files/Go/bin"`
- 커밋은 각 Task 끝에서 한다. 푸시는 사람이 승인할 때만 한다.

## File Structure

| 파일 | 책임 |
|---|---|
| `hugo.toml` | Goldmark passthrough 설정 추가 |
| `layouts/partials/extend_head.html` | KaTeX 조건부 로드 추가 (기존 Pretendard 설정 유지) |
| `package.json` | `{"type":"module"}` — `node --test` 가 `.js` 를 ES 모듈로 읽게 함 |
| `static/js/mathviz/transform.js` | 순수 수학. 행렬 합성, homography 해법, 보존량 판정. DOM 접근 없음 |
| `static/js/mathviz/core.js` | 캔버스 좌표계, 격자, 폴리곤, 슬라이더 UI, 드래그, 행렬 표시, 테마 |
| `static/js/mathviz/transform2d.js` | 1편 데모 조립. 위 둘을 씀 |
| `static/css/mathviz.css` | 데모 레이아웃 |
| `layouts/shortcodes/demo.html` | `{{< demo name="transform2d" >}}` |
| `tests/mathviz/transform.test.js` | `transform.js` 테스트 |
| `content/posts/2d-transform-matrix/index.md` | 글 |

`transform.js` 와 `core.js` 를 나누는 이유: 수학은 브라우저 없이 테스트할 수 있고 후속 글에서 그대로 재사용된다. DOM 을 섞으면 둘 다 못 한다.

---

### Task 1: KaTeX 수식 렌더링

**Files:**
- Modify: `hugo.toml` (`[markup]` 섹션 추가)
- Modify: `layouts/partials/extend_head.html` (파일 끝에 추가)

**Interfaces:**
- Consumes: 없음
- Produces: 글 front matter 에 `math = true` 를 넣으면 `$$...$$` 와 `\(...\)` 가 렌더된다.

- [ ] **Step 1: 회귀 기준선 만들기**

passthrough 를 켜기 **전에** 기존 글의 렌더 결과를 저장한다. 나중에 비교할 기준선이다.

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "D:/projects/joesiheon496.github.io"
hugo --destination /tmp/base --quiet
find /tmp/base/posts -name index.html | sort | xargs md5sum > /tmp/base-hashes.txt
wc -l < /tmp/base-hashes.txt
```

Expected: 13 내외 (기존 글 수). 이 숫자를 기억한다.

- [ ] **Step 2: `hugo.toml` 에 passthrough 추가**

`[markup.highlight]` 블록이 이미 있다. `[markup]` 아래에 형제로 `goldmark` 를 넣는다.
기존 `[markup.highlight]` 를 지우지 말 것.

```toml
[markup]
  [markup.highlight]
    noClasses = false
    codeFences = true
    guessSyntax = true
    lineNos = false
    tabWidth = 2

  [markup.goldmark]
    [markup.goldmark.extensions]
      [markup.goldmark.extensions.passthrough]
        enable = true
        [markup.goldmark.extensions.passthrough.delimiters]
          block = [['\[', '\]'], ['$$', '$$']]
          inline = [['\(', '\)']]
```

- [ ] **Step 3: `extend_head.html` 에 KaTeX 조건부 로드 추가**

기존 Pretendard `<style>` 블록 **뒤에** 붙인다. 앞 내용은 건드리지 않는다.

```html
{{/* KaTeX — math = true 인 글에서만 로드 */}}
{{ if .Param "math" }}
<link rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/katex@0.18.1/dist/katex.min.css"
      integrity="sha384-1vdNCNel6Tx/NQa8IR1mGOGKsbGreCkOPfbtPPnUURJ5Tu2PRVfQ/7KLZC+Pi1p1"
      crossorigin="anonymous">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.18.1/dist/katex.min.js"
        integrity="sha384-ycJ6GAwiS15LoUPipwJOrWTvkUHl/YqELValBwI5I4awP1EeEQJYarj+w85ntcz7"
        crossorigin="anonymous"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.18.1/dist/contrib/auto-render.min.js"
        integrity="sha384-bjyGPfbij8/NDKJhSGZNP/khQVgtHUE5exjm4Ydllo42FwIgYsdLO2lXGmRBf5Mz"
        crossorigin="anonymous"
        onload="renderMathInElement(document.body, {
          delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '\\[', right: '\\]', display: true},
            {left: '\\(', right: '\\)', display: false}
          ],
          throwOnError: false
        });"></script>
{{ end }}
```

`delimiters` 는 Step 2 의 passthrough 설정과 **정확히 일치해야 한다.** 어긋나면 한쪽만 렌더된다.

- [ ] **Step 4: 수식 테스트용 임시 글 만들기**

```bash
mkdir -p "D:/projects/joesiheon496.github.io/content/posts/_mathcheck"
cat > "D:/projects/joesiheon496.github.io/content/posts/_mathcheck/index.md" <<'EOF'
+++
title = "math check"
date = 2026-01-01T00:00:00+09:00
math = true
+++

블록:

$$ M = \begin{bmatrix} a & b \\ c & d \end{bmatrix} $$

인라인: 회전각 \(\theta\) 와 스케일 \(s_x\).

밑줄 함정: \(h_{21}\) 이 이탤릭으로 깨지지 않아야 한다.
EOF
```

- [ ] **Step 5: 빌드하고 수식 렌더 확인**

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "D:/projects/joesiheon496.github.io"
hugo --destination /tmp/mathtest --quiet
grep -c "katex" /tmp/mathtest/posts/_mathcheck/index.html
grep -o 'class="katex[^"]*"' /tmp/mathtest/posts/_mathcheck/index.html | head -3
echo "--- 밑줄이 <em> 으로 깨졌는지 ---"
grep -c "<em>21</em>" /tmp/mathtest/posts/_mathcheck/index.html
```

Expected:
- `katex` 등장 횟수 > 0 (CSS/JS 링크가 들어갔다)
- `<em>21</em>` 은 **0** — 0 이 아니면 passthrough 가 안 걸린 것이므로 Step 2 를 다시 본다

- [ ] **Step 6: 수식 없는 글에 KaTeX 가 안 들어갔는지 확인**

```bash
grep -c "katex" /tmp/mathtest/posts/pu-mask/index.html
```

Expected: **0**. 0 이 아니면 `{{ if .Param "math" }}` 가드가 안 걸린 것이다.

- [ ] **Step 7: 기존 글 회귀 확인**

```bash
find /tmp/mathtest/posts -name index.html | grep -v _mathcheck | sort | xargs md5sum > /tmp/after-hashes.txt
diff <(sed 's|/tmp/base/||' /tmp/base-hashes.txt) <(sed 's|/tmp/mathtest/||' /tmp/after-hashes.txt)
echo "exit=$?"
```

Expected: 차이 없음(`exit=0`). 차이가 나면 그 글을 열어 무엇이 바뀌었는지 확인한다.
passthrough 가 코드블록 안의 `$` 를 건드렸을 가능성이 가장 크다.

- [ ] **Step 8: 임시 글 삭제**

```bash
rm -rf "D:/projects/joesiheon496.github.io/content/posts/_mathcheck"
```

- [ ] **Step 9: 커밋**

```bash
cd "D:/projects/joesiheon496.github.io"
git add hugo.toml layouts/partials/extend_head.html
git commit -m "feat: enable KaTeX math rendering for posts with math = true

Goldmark passthrough is required or LaTeX underscores get parsed as
emphasis. Inline delimiter is \\(...\\) rather than \$...\$ to avoid
affecting existing posts. Verified existing 13 posts render byte-identical."
```

---

### Task 2: 변환 수학 코어

**Files:**
- Create: `package.json`
- Create: `static/js/mathviz/transform.js`
- Test: `tests/mathviz/transform.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `transform.js` 가 아래를 named export 한다. Task 3·4 가 이 이름들을 그대로 쓴다.
  - `identity() -> number[3][3]`
  - `rigid({theta, tx, ty}) -> number[3][3]`
  - `similarity({theta, s, tx, ty}) -> number[3][3]`
  - `affine({theta, sx, sy, shear, tx, ty}) -> number[3][3]`
  - `homographyFromQuads(src, dst) -> number[3][3]` — `src`/`dst` 는 `[[x,y],...]` 4개
  - `apply(M, p) -> [x, y]` — `p` 는 `[x, y]`
  - `applyAll(M, pts) -> [[x,y],...]`
  - `preservation(M) -> {lengthRatio, angleDeg, perspective, keepsLength, keepsAngle, keepsParallel}`
  - `UNIT_SQUARE` — `[[0,0],[1,0],[1,1],[0,1]]`

- [ ] **Step 1: `package.json` 만들기**

`node --test` 가 `.js` 를 ES 모듈로 읽게 하려면 필요하다. 의존성은 없다.
Hugo 는 `static/` 밖의 파일을 발행하지 않으므로 사이트에 노출되지 않는다.

```json
{
  "name": "joesiheon496-blog-tests",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

```javascript
// tests/mathviz/transform.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  identity, rigid, similarity, affine, homographyFromQuads,
  apply, applyAll, preservation, UNIT_SQUARE,
} from '../../static/js/mathviz/transform.js';

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b} (eps ${eps})`);
const nearPt = (p, q, eps = 1e-9) => { near(p[0], q[0], eps); near(p[1], q[1], eps); };

test('identity 는 점을 그대로 둔다', () => {
  nearPt(apply(identity(), [3, -7]), [3, -7]);
});

test('rigid: 90도 회전은 (1,0) 을 (0,1) 로 보낸다', () => {
  const M = rigid({ theta: Math.PI / 2, tx: 0, ty: 0 });
  nearPt(apply(M, [1, 0]), [0, 1], 1e-12);
});

test('rigid: 평행이동이 더해진다', () => {
  const M = rigid({ theta: 0, tx: 2, ty: -3 });
  nearPt(apply(M, [1, 1]), [3, -2]);
});

test('rigid 는 길이와 각도를 보존한다', () => {
  const p = preservation(rigid({ theta: 0.7, tx: 5, ty: 1 }));
  assert.ok(p.keepsLength);
  assert.ok(p.keepsAngle);
  assert.ok(p.keepsParallel);
});

test('similarity 는 각도는 보존하고 길이는 s 배로 바꾼다', () => {
  const p = preservation(similarity({ theta: 0.3, s: 2, tx: 0, ty: 0 }));
  assert.ok(!p.keepsLength);
  assert.ok(p.keepsAngle);
  near(p.angleDeg, 90, 1e-9);
  near(p.lengthRatio, 1, 1e-9);   // sx/sy 비율은 1 (등방)
});

test('전단이 든 affine 은 각도를 깨지만 평행은 보존한다', () => {
  const p = preservation(affine({ theta: 0, sx: 1, sy: 1, shear: 0.8, tx: 0, ty: 0 }));
  assert.ok(!p.keepsAngle);
  assert.ok(p.keepsParallel);
  assert.ok(Math.abs(p.angleDeg - 90) > 1);
});

test('affine 은 평행사변형을 만든다 — 마주보는 변이 평행', () => {
  const M = affine({ theta: 0.4, sx: 1.3, sy: 0.7, shear: 0.5, tx: 1, ty: 2 });
  const [a, b, c, d] = applyAll(M, UNIT_SQUARE);
  const ab = [b[0] - a[0], b[1] - a[1]];
  const dc = [c[0] - d[0], c[1] - d[1]];
  near(ab[0] * dc[1] - ab[1] * dc[0], 0, 1e-9);   // 외적 0 = 평행
});

test('homographyFromQuads 는 네 대응점을 정확히 보낸다', () => {
  const dst = [[0.2, 0.1], [1.4, -0.2], [1.1, 1.3], [-0.3, 0.9]];
  const H = homographyFromQuads(UNIT_SQUARE, dst);
  applyAll(H, UNIT_SQUARE).forEach((p, i) => nearPt(p, dst[i], 1e-9));
});

test('같은 사각형끼리의 homography 는 항등이다', () => {
  const H = homographyFromQuads(UNIT_SQUARE, UNIT_SQUARE);
  nearPt(apply(H, [0.37, 0.62]), [0.37, 0.62], 1e-9);
});

test('원근이 든 homography 는 평행을 깬다', () => {
  const dst = [[0, 0], [1, 0], [0.7, 1], [0.3, 1]];   // 사다리꼴
  const p = preservation(homographyFromQuads(UNIT_SQUARE, dst));
  assert.ok(!p.keepsParallel);
  assert.ok(p.perspective > 1e-6);
});

test('apply 는 원근 나눗셈을 한다', () => {
  const M = [[1, 0, 0], [0, 1, 0], [1, 0, 1]];   // w = x + 1
  nearPt(apply(M, [1, 2]), [0.5, 1]);
});
```

- [ ] **Step 3: 테스트가 실패하는 것 확인**

```bash
cd "D:/projects/joesiheon496.github.io"
node --test tests/
```

Expected: FAIL — `Cannot find module .../transform.js`

- [ ] **Step 4: `transform.js` 구현**

```javascript
// static/js/mathviz/transform.js
// 2D 동차좌표 변환. DOM 접근 없음 — 브라우저와 Node 양쪽에서 돈다.

export const UNIT_SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1]];

export function identity() {
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
}

/** 회전 후 평행이동. 자유도 3. 길이·각도 보존. */
export function rigid({ theta, tx, ty }) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [[c, -s, tx], [s, c, ty], [0, 0, 1]];
}

/** rigid + 등방 스케일. 자유도 4. 각도 보존, 길이는 s 배. */
export function similarity({ theta, s, tx, ty }) {
  const c = Math.cos(theta), sn = Math.sin(theta);
  return [[s * c, -s * sn, tx], [s * sn, s * c, ty], [0, 0, 1]];
}

/**
 * 자유도 6. 선형부를 회전 × 상삼각으로 둔다 (QR 분해 형태).
 *   A = R(theta) · [[sx, shear], [0, sy]]
 * 이 매개화는 모든 가역 2x2 를 덮으면서 슬라이더마다 의미를 준다.
 */
export function affine({ theta, sx, sy, shear, tx, ty }) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const a = c * sx,            b = c * shear - s * sy;
  const d = s * sx,            e = s * shear + c * sy;
  return [[a, b, tx], [d, e, ty], [0, 0, 1]];
}

/** 부분 피벗 가우스 소거. A 는 n×n, b 는 길이 n. A·x = b 의 x 반환. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-14) throw new Error('특이 행렬 — 네 점이 퇴화했다');
    [M[col], M[piv]] = [M[piv], M[col]];
    const p = M[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / p;
      if (f === 0) continue;
      for (let c2 = col; c2 <= n; c2++) M[r][c2] -= f * M[col][c2];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

/**
 * 네 대응점에서 homography. 자유도 8 (h22 = 1 로 고정).
 * 각 대응 (x,y)->(u,v) 가 두 식을 준다:
 *   h00 x + h01 y + h02 - h20 x u - h21 y u = u
 *   h10 x + h11 y + h12 - h20 x v - h21 y v = v
 */
export function homographyFromQuads(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  const h = solve(A, b);
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

/** 동차좌표로 올려 곱하고 w 로 나눈다. */
export function apply(M, [x, y]) {
  const w = M[2][0] * x + M[2][1] * y + M[2][2];
  return [
    (M[0][0] * x + M[0][1] * y + M[0][2]) / w,
    (M[1][0] * x + M[1][1] * y + M[1][2]) / w,
  ];
}

export function applyAll(M, pts) {
  return pts.map((p) => apply(M, p));
}

/**
 * 무엇이 보존되는가.
 * 기저벡터 e1, e2 의 상(image)으로 판정한다 — 특잇값보다 직관적이고 표시하기 쉽다.
 *  lengthRatio : |A e1| / |A e2|  (1 이면 등방)
 *  angleDeg    : A e1 과 A e2 사이 각 (90 이면 각도 보존)
 *  perspective : |h20| + |h21|    (0 이면 affine = 평행 보존)
 */
export function preservation(M) {
  const e1 = [M[0][0], M[1][0]];
  const e2 = [M[0][1], M[1][1]];
  const n1 = Math.hypot(e1[0], e1[1]);
  const n2 = Math.hypot(e2[0], e2[1]);
  const dot = e1[0] * e2[0] + e1[1] * e2[1];
  const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot / (n1 * n2)))) * 180 / Math.PI;
  const perspective = Math.abs(M[2][0]) + Math.abs(M[2][1]);

  const EPS = 1e-9;
  const keepsAngle = Math.abs(angleDeg - 90) < 1e-7 && Math.abs(n1 - n2) < EPS;
  return {
    lengthRatio: n1 / n2,
    angleDeg,
    perspective,
    keepsLength: keepsAngle && Math.abs(n1 - 1) < EPS,
    keepsAngle,
    keepsParallel: perspective < EPS,
  };
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd "D:/projects/joesiheon496.github.io"
node --test tests/
```

Expected: 11개 테스트 전부 PASS.

`similarity` 테스트가 `keepsAngle` 에서 실패하면 `preservation` 의 `n1 - n2` 비교를 본다.
`homography` 테스트가 실패하면 `solve` 의 행 구성(부호)을 본다.

- [ ] **Step 6: 커밋**

```bash
cd "D:/projects/joesiheon496.github.io"
git add package.json static/js/mathviz/transform.js tests/mathviz/transform.test.js
git commit -m "feat: add 2D transform math core with tests

Pure ES module, no DOM access, so it runs in both browser and Node.
Covers rigid/similarity/affine composition, homography from 4 point
correspondences via Gaussian elimination, and a preservation readout
(length ratio, angle, perspective) that drives the demo's conclusion."
```

---

### Task 3: 캔버스 하니스 + Rigid 데모만 동작

이 Task 의 목적은 **하니스를 실제 화면에서 검증**하는 것이다. 4개 클래스를 다 만들기 전에
캔버스·드래그·슬라이더·테마가 도는 것을 먼저 확인한다.

**Files:**
- Create: `static/js/mathviz/core.js`
- Create: `static/js/mathviz/transform2d.js`
- Create: `static/css/mathviz.css`
- Create: `layouts/shortcodes/demo.html`

**Interfaces:**
- Consumes: Task 2 의 `transform.js` (`rigid`, `apply`, `applyAll`, `preservation`, `UNIT_SQUARE`, `identity`)
- Produces: `core.js` 가 아래를 export 한다. Task 4 가 그대로 쓴다.
  - `themeColors() -> {fg, muted, accent, accent2, grid, bg}`
  - `onThemeChange(cb) -> void`
  - `createView(canvas, {xmin, xmax, ymin, ymax}) -> {toPixel(p), toWorld(px), resize()}`
  - `drawGrid(ctx, view, colors) -> void`
  - `drawPolygon(ctx, view, pts, {stroke, fill, width, firstEdge}) -> void`
  - `drawHandles(ctx, view, pts, colors) -> void`
  - `makeSliders(el, defs, onInput) -> {setValues(obj), getValues()}` — `defs` 는 `[{key,label,min,max,step,value,fmt}]`
  - `attachDrag(canvas, view, getPoints, onDrag) -> void` — `onDrag(index, worldPoint)`
  - `renderMatrix(el, M) -> void`

- [ ] **Step 1: `core.js` 구현**

```javascript
// static/js/mathviz/core.js
// 캔버스 · 입력 · 표시. 수학은 transform.js 에 있다.

export function themeColors() {
  const s = getComputedStyle(document.body);
  const pick = (v, fb) => (s.getPropertyValue(v).trim() || fb);
  return {
    bg:      pick('--theme', '#fff'),
    fg:      pick('--primary', '#222'),
    muted:   pick('--secondary', '#888'),
    grid:    pick('--border', '#ddd'),
    accent:  '#4c72b0',
    accent2: '#c44e52',
  };
}

export function onThemeChange(cb) {
  // PaperMod 는 <body> 의 class 를 토글한다.
  new MutationObserver(cb).observe(document.body, {
    attributes: true, attributeFilter: ['class'],
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', cb);
}

export function createView(canvas, world) {
  const st = { w: 1, h: 1, dpr: 1 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    st.dpr = window.devicePixelRatio || 1;
    st.w = rect.width;
    st.h = rect.width;               // 정사각 유지
    canvas.style.height = `${st.h}px`;
    canvas.width = Math.round(st.w * st.dpr);
    canvas.height = Math.round(st.h * st.dpr);
    canvas.getContext('2d').setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
  }

  const sx = () => st.w / (world.xmax - world.xmin);
  const sy = () => st.h / (world.ymax - world.ymin);

  return {
    resize,
    get size() { return { w: st.w, h: st.h }; },
    world,
    toPixel: ([x, y]) => [
      (x - world.xmin) * sx(),
      st.h - (y - world.ymin) * sy(),          // y 축 뒤집기
    ],
    toWorld: ([px, py]) => [
      px / sx() + world.xmin,
      (st.h - py) / sy() + world.ymin,
    ],
  };
}

export function drawGrid(ctx, view, colors) {
  const { w, h } = view.size;
  const { xmin, xmax, ymin, ymax } = view.world;
  ctx.clearRect(0, 0, w, h);

  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.grid;
  for (let x = Math.ceil(xmin); x <= xmax; x++) {
    const [px] = view.toPixel([x, 0]);
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
  }
  for (let y = Math.ceil(ymin); y <= ymax; y++) {
    const [, py] = view.toPixel([0, y]);
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
  }

  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1.5;
  const [ox, oy] = view.toPixel([0, 0]);
  ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(w, oy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, h); ctx.stroke();
}

export function drawPolygon(ctx, view, pts, { stroke, fill, width = 2, firstEdge }) {
  const px = pts.map((p) => view.toPixel(p));
  ctx.beginPath();
  px.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }

  // 방향 표시: 첫 변만 다른 색. 반사와 회전을 구분하려면 필요하다.
  if (firstEdge) {
    ctx.beginPath();
    ctx.moveTo(px[0][0], px[0][1]);
    ctx.lineTo(px[1][0], px[1][1]);
    ctx.strokeStyle = firstEdge;
    ctx.lineWidth = width + 2;
    ctx.stroke();
  }
}

export function drawHandles(ctx, view, pts, colors) {
  pts.forEach((p) => {
    const [x, y] = view.toPixel(p);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = colors.accent2;
    ctx.fill();
    ctx.strokeStyle = colors.bg;
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

export function makeSliders(el, defs, onInput) {
  el.innerHTML = '';
  const rows = {};
  defs.forEach((d) => {
    const row = document.createElement('div');
    row.className = 'mv-slider';
    const label = document.createElement('label');
    label.textContent = d.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = d.min; input.max = d.max; input.step = d.step; input.value = d.value;
    const out = document.createElement('span');
    out.className = 'mv-val';
    const fmt = d.fmt || ((v) => v.toFixed(2));
    out.textContent = fmt(d.value);
    input.addEventListener('input', () => {
      out.textContent = fmt(parseFloat(input.value));
      onInput(getValues());
    });
    row.append(label, input, out);
    el.appendChild(row);
    rows[d.key] = { input, out, fmt };
  });

  function getValues() {
    const v = {};
    for (const k in rows) v[k] = parseFloat(rows[k].input.value);
    return v;
  }
  function setValues(obj) {
    for (const k in obj) {
      if (!rows[k]) continue;
      rows[k].input.value = obj[k];
      rows[k].out.textContent = rows[k].fmt(obj[k]);
    }
  }
  return { setValues, getValues };
}

export function attachDrag(canvas, view, getPoints, onDrag) {
  let active = -1;

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  canvas.addEventListener('pointerdown', (e) => {
    const [px, py] = local(e);
    const pts = getPoints();
    let best = -1, bestD = 14;            // 14px 안쪽만 잡는다
    pts.forEach((p, i) => {
      const [hx, hy] = view.toPixel(p);
      const d = Math.hypot(hx - px, hy - py);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) {
      active = best;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (active < 0) return;
    onDrag(active, view.toWorld(local(e)));
    e.preventDefault();
  });

  const end = (e) => {
    if (active < 0) return;
    active = -1;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

export function renderMatrix(el, M) {
  const cell = (v, isId) =>
    `<span class="mv-cell${isId ? '' : ' mv-changed'}">${v.toFixed(3)}</span>`;
  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  el.innerHTML = `<div class="mv-matrix">${
    M.map((row, i) => row.map(
      (v, j) => cell(v, Math.abs(v - I[i][j]) < 1e-6)
    ).join('')).join('')
  }</div>`;
}
```

- [ ] **Step 2: `mathviz.css` 구현**

```css
/* static/css/mathviz.css */
.mv-demo {
  margin: 1.5rem 0;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.mv-body { display: flex; gap: 1rem; align-items: flex-start; }
.mv-left { flex: 1 1 55%; min-width: 0; }
.mv-right { flex: 1 1 45%; min-width: 0; }
.mv-demo canvas { width: 100%; display: block; touch-action: none; cursor: grab; }

.mv-tabs { display: flex; gap: .4rem; flex-wrap: wrap; margin-bottom: .75rem; }
.mv-tabs button {
  padding: .3rem .7rem; font-size: .85rem; cursor: pointer;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--theme); color: var(--primary);
}
.mv-tabs button[aria-pressed="true"] {
  background: var(--primary); color: var(--theme); font-weight: 600;
}

.mv-slider { display: grid; grid-template-columns: 3.2rem 1fr 3.2rem; gap: .5rem;
             align-items: center; font-size: .85rem; margin: .3rem 0; }
.mv-slider input { width: 100%; }
.mv-val { text-align: right; font-variant-numeric: tabular-nums; color: var(--secondary); }

.mv-matrix {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: .2rem .5rem;
  font-family: ui-monospace, monospace; font-size: .85rem;
  margin: .75rem 0; padding: .5rem;
  border-left: 2px solid var(--border); border-right: 2px solid var(--border);
}
.mv-cell { text-align: right; font-variant-numeric: tabular-nums; color: var(--secondary); }
.mv-cell.mv-changed { color: var(--primary); font-weight: 600; }

.mv-readout { font-size: .85rem; line-height: 1.7; }
.mv-readout .ok { color: #55a868; font-weight: 600; }
.mv-readout .no { color: #c44e52; font-weight: 600; }
.mv-hint { font-size: .8rem; color: var(--secondary); margin-top: .5rem; }

@media (max-width: 720px) {
  .mv-body { flex-direction: column; }
  .mv-left, .mv-right { flex: 1 1 100%; width: 100%; }
}
```

- [ ] **Step 3: shortcode 만들기**

```html
{{/* layouts/shortcodes/demo.html */}}
{{ $name := .Get "name" }}
{{ $id := printf "mv-%s-%d" $name .Ordinal }}
<link rel="stylesheet" href="{{ "css/mathviz.css" | relURL }}">
<div class="mv-demo" id="{{ $id }}">
  <div class="mv-tabs"></div>
  <div class="mv-body">
    <div class="mv-left"><canvas></canvas></div>
    <div class="mv-right">
      <div class="mv-sliders"></div>
      <div class="mv-matrix-host"></div>
      <div class="mv-readout"></div>
      <div class="mv-hint"></div>
    </div>
  </div>
</div>
<script type="module">
  import { init } from '{{ printf "js/mathviz/%s.js" $name | relURL }}';
  init(document.getElementById('{{ $id }}'));
</script>
```

- [ ] **Step 4: `transform2d.js` — Rigid 만 구현**

```javascript
// static/js/mathviz/transform2d.js
import { rigid, applyAll, preservation, UNIT_SQUARE } from './transform.js';
import {
  themeColors, onThemeChange, createView, drawGrid, drawPolygon,
  drawHandles, makeSliders, attachDrag, renderMatrix,
} from './core.js';

const WORLD = { xmin: -2, xmax: 2, ymin: -2, ymax: 2 };

const RIGID_DEFS = [
  { key: 'theta', label: 'θ', min: -180, max: 180, step: 1, value: 30,
    fmt: (v) => `${v.toFixed(0)}°` },
  { key: 'tx', label: 'tx', min: -2, max: 2, step: 0.01, value: 0 },
  { key: 'ty', label: 'ty', min: -2, max: 2, step: 0.01, value: 0 },
];

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = createView(canvas, WORLD);

  const state = { theta: 30, tx: 0, ty: 0 };

  const sliders = makeSliders(root.querySelector('.mv-sliders'), RIGID_DEFS, (v) => {
    Object.assign(state, v);
    draw();
  });

  const matrix = () => rigid({
    theta: state.theta * Math.PI / 180, tx: state.tx, ty: state.ty,
  });

  // 드래그 핸들: [0] 평행이동, [1] 회전
  const handles = () => {
    const q = applyAll(matrix(), UNIT_SQUARE);
    return [q[0], q[1]];
  };

  attachDrag(canvas, view, handles, (i, p) => {
    if (i === 0) {
      state.tx = p[0]; state.ty = p[1];
    } else {
      const dx = p[0] - state.tx, dy = p[1] - state.ty;
      state.theta = Math.atan2(dy, dx) * 180 / Math.PI;
    }
    sliders.setValues(state);
    draw();
  });

  function draw() {
    const colors = themeColors();
    const M = matrix();
    drawGrid(ctx, view, colors);
    drawPolygon(ctx, view, UNIT_SQUARE, { stroke: colors.muted, width: 1.5 });
    drawPolygon(ctx, view, applyAll(M, UNIT_SQUARE),
      { stroke: colors.accent, fill: `${colors.accent}22`, firstEdge: colors.accent2 });
    drawHandles(ctx, view, handles(), colors);
    renderMatrix(root.querySelector('.mv-matrix-host'), M);

    const p = preservation(M);
    const mark = (ok) => (ok ? '<span class="ok">보존</span>' : '<span class="no">깨짐</span>');
    root.querySelector('.mv-readout').innerHTML = `
      길이 ${mark(p.keepsLength)} &nbsp; 각도 ${mark(p.keepsAngle)} &nbsp;
      평행 ${mark(p.keepsParallel)}<br>
      변 길이비 ${p.lengthRatio.toFixed(3)} · 사잇각 ${p.angleDeg.toFixed(1)}°`;
    root.querySelector('.mv-hint').textContent =
      '빨간 점을 끌어보세요 — 왼쪽 아래는 평행이동, 오른쪽 아래는 회전입니다.';
  }

  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
```

- [ ] **Step 5: 로컬 서버에서 확인용 임시 글 만들기**

```bash
mkdir -p "D:/projects/joesiheon496.github.io/content/posts/_demcheck"
cat > "D:/projects/joesiheon496.github.io/content/posts/_demcheck/index.md" <<'EOF'
+++
title = "demo check"
date = 2026-01-01T00:00:00+09:00
math = true
+++

{{< demo name="transform2d" >}}
EOF
export PATH="$PATH:/c/Program Files/Go/bin"
cd "D:/projects/joesiheon496.github.io"
hugo server --port 1313 --bind 127.0.0.1
```

- [ ] **Step 6: 브라우저에서 수동 검증**

`http://localhost:1313/posts/_demcheck/` 를 열고 아래를 **직접 확인한다.**

1. 격자와 두 도형(흐린 원본 + 진한 변환)이 보인다
2. θ 슬라이더를 움직이면 도형이 돈다
3. tx/ty 슬라이더로 도형이 움직인다
4. 빨간 점을 끌면 도형이 따라오고 **슬라이더 값과 행렬 숫자가 같이 갱신된다**
5. 행렬에서 1·0 이 아닌 원소만 진하게 표시된다
6. readout 이 `길이 보존 · 각도 보존 · 평행 보존` 을 표시한다
7. **PaperMod 테마 토글(우측 상단)을 눌러 light/dark 양쪽에서 데모가 읽힌다**
8. 브라우저 창을 좁혀 720px 이하로 만들면 슬라이더가 캔버스 아래로 내려간다
9. 개발자 콘솔에 에러가 없다

실패하면 콘솔 에러를 먼저 본다. `import` 경로 문제면 shortcode 의 `relURL` 을 확인한다.

- [ ] **Step 7: 커밋**

```bash
cd "D:/projects/joesiheon496.github.io"
git add static/js/mathviz/core.js static/js/mathviz/transform2d.js \
        static/css/mathviz.css layouts/shortcodes/demo.html
git commit -m "feat: add interactive demo harness with rigid transform

Canvas 2D, zero dependencies. Slider and drag stay in sync both ways.
Colors are read from CSS variables and redrawn on theme change so the
demo stays legible in both light and dark."
```

---

### Task 4: 나머지 세 클래스 + 클래스 전환

**Files:**
- Modify: `static/js/mathviz/transform2d.js` (Task 3 에서 만든 파일 전체 교체)

**Interfaces:**
- Consumes: Task 2 의 `transform.js` 전체, Task 3 의 `core.js` 전체
- Produces: 없음 (최종 데모)

- [ ] **Step 1: `transform2d.js` 를 4클래스 버전으로 교체**

Task 3 의 `init` 을 아래로 바꾼다. `WORLD` 와 import 는 유지하고 `homographyFromQuads`,
`similarity`, `affine`, `identity` 를 import 에 추가한다.

```javascript
// static/js/mathviz/transform2d.js
import {
  rigid, similarity, affine, homographyFromQuads,
  applyAll, preservation, UNIT_SQUARE,
} from './transform.js';
import {
  themeColors, onThemeChange, createView, drawGrid, drawPolygon,
  drawHandles, makeSliders, attachDrag, renderMatrix,
} from './core.js';

const WORLD = { xmin: -2, xmax: 2, ymin: -2, ymax: 2 };
const deg = (v) => `${v.toFixed(0)}°`;

const CLASSES = {
  rigid: {
    label: 'Rigid (3)',
    defs: [
      { key: 'theta', label: 'θ', min: -180, max: 180, step: 1, value: 30, fmt: deg },
      { key: 'tx', label: 'tx', min: -2, max: 2, step: 0.01, value: 0 },
      { key: 'ty', label: 'ty', min: -2, max: 2, step: 0.01, value: 0 },
    ],
    hint: '길이와 각도가 모두 남습니다. 도형의 모양은 절대 바뀌지 않습니다.',
    matrix: (s) => rigid({ theta: s.theta * Math.PI / 180, tx: s.tx, ty: s.ty }),
  },
  similarity: {
    label: 'Similarity (4)',
    defs: [
      { key: 'theta', label: 'θ', min: -180, max: 180, step: 1, value: 30, fmt: deg },
      { key: 's', label: 's', min: 0.2, max: 2, step: 0.01, value: 1 },
      { key: 'tx', label: 'tx', min: -2, max: 2, step: 0.01, value: 0 },
      { key: 'ty', label: 'ty', min: -2, max: 2, step: 0.01, value: 0 },
    ],
    hint: '크기는 바뀌지만 각도는 그대로입니다 — 정사각형이 계속 정사각형입니다.',
    matrix: (s) => similarity({ theta: s.theta * Math.PI / 180, s: s.s, tx: s.tx, ty: s.ty }),
  },
  affine: {
    label: 'Affine (6)',
    defs: [
      { key: 'theta', label: 'θ', min: -180, max: 180, step: 1, value: 20, fmt: deg },
      { key: 'sx', label: 'sx', min: 0.2, max: 2, step: 0.01, value: 1.2 },
      { key: 'sy', label: 'sy', min: 0.2, max: 2, step: 0.01, value: 0.8 },
      { key: 'shear', label: 'sh', min: -1.5, max: 1.5, step: 0.01, value: 0.4 },
      { key: 'tx', label: 'tx', min: -2, max: 2, step: 0.01, value: 0 },
      { key: 'ty', label: 'ty', min: -2, max: 2, step: 0.01, value: 0 },
    ],
    hint: '각도는 깨지지만 마주보는 변은 여전히 평행합니다. 세 점만 끌 수 있고 '
        + '네 번째 점은 평행사변형 제약으로 따라옵니다.',
    matrix: (s) => affine({
      theta: s.theta * Math.PI / 180, sx: s.sx, sy: s.sy,
      shear: s.shear, tx: s.tx, ty: s.ty,
    }),
  },
  homography: {
    label: 'Homography (8)',
    defs: [],
    hint: '슬라이더가 없습니다 — 8자유도는 네 점의 (x, y) 여덟 개 숫자와 같기 때문입니다. '
        + '네 꼭짓점을 자유롭게 끌어보세요. 평행마저 깨집니다.',
    matrix: null,   // quad 에서 직접 계산
  },
};

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = createView(canvas, WORLD);

  let kind = 'rigid';
  let params = {};
  // homography 전용 상태. 다른 클래스에서 전환해 들어올 때 현재 도형으로 초기화한다.
  let quad = UNIT_SQUARE.map((p) => [...p]);
  let sliders = null;

  const matrix = () => (kind === 'homography'
    ? homographyFromQuads(UNIT_SQUARE, quad)
    : CLASSES[kind].matrix(params));

  function currentQuad() {
    return applyAll(matrix(), UNIT_SQUARE);
  }

  // 드래그 핸들 개수가 클래스마다 다르다.
  //  rigid       : [0] 평행이동, [1] 회전
  //  similarity  : [0] 평행이동, [1] 회전+스케일
  //  affine      : 앞의 세 점 (네 번째는 따라온다)
  //  homography  : 네 점 전부
  function handleCount() {
    return { rigid: 2, similarity: 2, affine: 3, homography: 4 }[kind];
  }
  const handles = () => currentQuad().slice(0, handleCount());

  function onDrag(i, p) {
    if (kind === 'homography') {
      quad[i] = p;
    } else if (kind === 'affine') {
      // 세 점에서 affine 을 역산한다. 원본 (0,0) (1,0) (1,1) 의 상이 q0 q1 q2.
      const q = currentQuad();
      q[i] = p;
      const [q0, q1, q2] = q;
      // e1 = q1 - q0, 그리고 q2 = q0 + e1 + e2 이므로 e2 = q2 - q1
      const e1 = [q1[0] - q0[0], q1[1] - q0[1]];
      const e2 = [q2[0] - q1[0], q2[1] - q1[1]];
      // A = [e1 e2] 를 회전 × 상삼각으로 분해 (QR)
      const theta = Math.atan2(e1[1], e1[0]);
      const c = Math.cos(theta), s = Math.sin(theta);
      params.theta = theta * 180 / Math.PI;
      params.sx = c * e1[0] + s * e1[1];
      params.shear = c * e2[0] + s * e2[1];
      params.sy = -s * e2[0] + c * e2[1];
      params.tx = q0[0];
      params.ty = q0[1];
      sliders.setValues(params);
    } else if (i === 0) {
      params.tx = p[0]; params.ty = p[1];
      sliders.setValues(params);
    } else {
      const dx = p[0] - params.tx, dy = p[1] - params.ty;
      params.theta = Math.atan2(dy, dx) * 180 / Math.PI;
      if (kind === 'similarity') params.s = Math.hypot(dx, dy);
      sliders.setValues(params);
    }
    draw();
  }

  function selectClass(next) {
    // 전환 시 현재 도형을 이어받아 튀지 않게 한다.
    const before = currentQuad();
    kind = next;
    const spec = CLASSES[kind];

    params = {};
    spec.defs.forEach((d) => { params[d.key] = d.value; });

    if (kind === 'homography') quad = before.map((p) => [...p]);

    sliders = makeSliders(root.querySelector('.mv-sliders'), spec.defs, (v) => {
      Object.assign(params, v);
      draw();
    });

    root.querySelectorAll('.mv-tabs button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.kind === kind));
    });
    draw();
  }

  // 탭 만들기
  const tabs = root.querySelector('.mv-tabs');
  tabs.innerHTML = '';
  Object.entries(CLASSES).forEach(([key, spec]) => {
    const b = document.createElement('button');
    b.textContent = spec.label;
    b.dataset.kind = key;
    b.setAttribute('aria-pressed', String(key === kind));
    b.addEventListener('click', () => selectClass(key));
    tabs.appendChild(b);
  });

  attachDrag(canvas, view, handles, onDrag);

  function draw() {
    const colors = themeColors();
    const M = matrix();
    drawGrid(ctx, view, colors);
    drawPolygon(ctx, view, UNIT_SQUARE, { stroke: colors.muted, width: 1.5 });
    drawPolygon(ctx, view, applyAll(M, UNIT_SQUARE),
      { stroke: colors.accent, fill: `${colors.accent}22`, firstEdge: colors.accent2 });
    drawHandles(ctx, view, handles(), colors);
    renderMatrix(root.querySelector('.mv-matrix-host'), M);

    const p = preservation(M);
    const mark = (ok) => (ok ? '<span class="ok">보존</span>' : '<span class="no">깨짐</span>');
    root.querySelector('.mv-readout').innerHTML = `
      길이 ${mark(p.keepsLength)} &nbsp; 각도 ${mark(p.keepsAngle)} &nbsp;
      평행 ${mark(p.keepsParallel)}<br>
      변 길이비 ${p.lengthRatio.toFixed(3)} · 사잇각 ${p.angleDeg.toFixed(1)}°
      · 원근항 ${p.perspective.toFixed(3)}`;
    root.querySelector('.mv-hint').textContent = CLASSES[kind].hint;
  }

  const redraw = () => { view.resize(); draw(); };
  selectClass('rigid');
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
```

- [ ] **Step 2: 수학 코어 회귀 확인**

`transform.js` 는 안 건드렸지만 확인한다.

```bash
cd "D:/projects/joesiheon496.github.io"
node --test tests/
```

Expected: 11개 PASS.

- [ ] **Step 3: 브라우저에서 네 클래스 수동 검증**

Task 3 의 임시 글(`/posts/_demcheck/`)에서 확인한다. 서버가 꺼졌으면 다시 띄운다.

각 탭을 눌러 아래를 **직접 확인한다.**

| 탭 | 확인할 것 |
|---|---|
| Rigid | 길이·각도·평행 전부 `보존`. 핸들 2개 |
| Similarity | `s` 를 키우면 길이는 `깨짐`, 각도는 `보존` 유지. 사잇각 90.0° 고정 |
| Affine | `sh` 를 올리면 각도 `깨짐`, 평행은 `보존`. 핸들 3개, **네 번째 점이 따라온다** |
| Homography | 슬라이더 없음. 핸들 4개. 사다리꼴로 끌면 평행 `깨짐`, 원근항 > 0 |

추가 확인:
1. 탭을 전환할 때 도형이 튀지 않는다 (직전 모양을 이어받는다)
2. Homography 에서 네 점을 한 직선에 가깝게 모으면 예외가 나도 **콘솔 에러로 죽지 않고** 이전 그림이 남는다
3. light/dark 양쪽에서 네 탭 모두 읽힌다
4. 모바일 폭에서 터치로 핸들을 끌 수 있다

2번에서 데모가 멈추면 `draw()` 의 `matrix()` 호출을 `try/catch` 로 감싸고 실패 시 직전 행렬을 쓰도록 고친다.

- [ ] **Step 4: 커밋**

```bash
cd "D:/projects/joesiheon496.github.io"
git add static/js/mathviz/transform2d.js
git commit -m "feat: add similarity, affine and homography to the transform demo

Switching class changes the degrees of freedom: sliders appear and drag
constraints loosen. Affine exposes three handles and derives the fourth
from the parallelogram constraint, which is what makes 'parallel lines
survive' something you feel rather than read. Homography has no sliders
because 8 DOF equals the four corner coordinates."
```

---

### Task 5: 글 작성 및 검증

**Files:**
- Create: `content/posts/2d-transform-matrix/index.md`
- Delete: `content/posts/_demcheck/` (임시 확인용)

**Interfaces:**
- Consumes: Task 1 의 `math = true`, Task 3 의 `{{< demo >}}` shortcode, Task 4 의 완성 데모
- Produces: 발행 가능한 글

- [ ] **Step 1: 글 작성**

`content/posts/2d-transform-matrix/index.md` 를 만든다. 구성은 스펙 §4 를 따른다.

Front matter (날짜는 **작성 시점의 현재 시각**으로 넣는다 — 미래면 Hugo 가 제외한다):

```toml
+++
title = "2D 변환 행렬 — 무엇이 보존되고 무엇이 깨지는가"
date = <현재 시각, +09:00>
draft = false
math = true
tags = ["컴퓨터비전", "선형대수", "기하학", "인터랙티브"]
categories = ["프로그램"]
summary = "회전·평행이동부터 Homography 까지, 변환의 계층을 자유도와 '무엇이 보존되는가'로 정리한다. 슬라이더와 드래그로 직접 만져보는 데모를 넣었다."
+++
```

본문 구성:

1. **한 줄 요약** — 변환의 계층은 "무엇을 포기하느냐"의 순서다
2. **왜 숫자 9개인가** — 좌표를 옮기는 규칙을 말로 적는 대신 행렬로 적는 이유
3. **동차좌표: 왜 3×3 인가** — 2×2 로는 평행이동이 안 되는 것을 먼저 보인 뒤,
   좌표에 1 을 붙여 평행이동을 곱셈으로 바꾸는 것을 설명
4. **데모** — `{{< demo name="transform2d" >}}` 를 여기에 넣고, 탭을 순서대로 눌러보라고 안내
5. **계층 표** — 스펙 §4 의 보존/상실/자유도 표
6. **각 클래스 설명** — 각각 수식 + "이게 화면에서 무슨 일인지" 한 문장
7. **CV 에서 homography 가 계속 나오는 이유** — 평면을 다른 평면으로 보내는 것이 카메라가 하는 일.
   책 표지 스캔, 파노라마 이어붙이기, 바닥 평면 기준 좌표 계산
8. **다음 글 예고** — SVD

작성 규칙:
- **모든 수식 앞에 그 수식이 무슨 일을 하는지 한 문장을 먼저 둔다.** 독자가 수식을 건너뛰어도 글이 이어져야 한다
- 블록 수식은 `$$...$$`, 인라인은 `\(...\)`
- 예시 수식 (Rigid):

```
$$
\begin{bmatrix} x' \\ y' \\ 1 \end{bmatrix}
=
\begin{bmatrix}
\cos\theta & -\sin\theta & t_x \\
\sin\theta & \cos\theta & t_y \\
0 & 0 & 1
\end{bmatrix}
\begin{bmatrix} x \\ y \\ 1 \end{bmatrix}
$$
```

- [ ] **Step 2: 임시 확인용 글 삭제**

```bash
rm -rf "D:/projects/joesiheon496.github.io/content/posts/_demcheck"
```

- [ ] **Step 3: 빌드하고 글이 나오는지 확인**

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "D:/projects/joesiheon496.github.io"
hugo --destination /tmp/final --quiet
ls /tmp/final/posts/2d-transform-matrix/index.html
grep -c "katex" /tmp/final/posts/2d-transform-matrix/index.html
grep -c "mv-demo" /tmp/final/posts/2d-transform-matrix/index.html
grep -c "2d-transform-matrix" /tmp/final/posts/index.html
```

Expected: 파일 존재, `katex` > 0, `mv-demo` = 1, 목록 페이지에 1회 등장.
목록에 안 나오면 날짜가 미래인지 확인한다.

- [ ] **Step 4: 로컬 서버에서 최종 확인**

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "D:/projects/joesiheon496.github.io"
hugo server --port 1313 --bind 127.0.0.1
```

`http://localhost:1313/posts/2d-transform-matrix/` 에서 확인한다.

1. 수식이 KaTeX 로 렌더된다 (블록·인라인 모두). `\theta` 가 글자로 남아있지 않다
2. 데모가 글 중간에서 동작한다
3. 네 탭 전부 동작하고 readout 이 맞다
4. light / dark 양쪽에서 수식과 데모가 모두 읽힌다
5. 모바일 폭에서 레이아웃이 깨지지 않는다
6. 콘솔에 에러가 없다

- [ ] **Step 5: 기존 글 최종 회귀 확인**

```bash
grep -c "katex" /tmp/final/posts/pu-mask/index.html
grep -c "katex" /tmp/final/posts/putpfs/index.html
```

Expected: 둘 다 **0**.

- [ ] **Step 6: 커밋**

```bash
cd "D:/projects/joesiheon496.github.io"
git add content/posts/2d-transform-matrix/
git commit -m "post: 2D transform matrices, what survives and what breaks

First post in the CV math series. Frames the transform hierarchy by what
each class preserves rather than by listing matrix forms, with one unified
interactive demo where switching class changes the degrees of freedom."
```

- [ ] **Step 7: 푸시는 사람의 승인을 받는다**

푸시하면 공개 발행된다. 자동으로 하지 않는다. 사람에게 로컬 미리보기를 보여주고
명시적 승인을 받은 뒤에만 `git push origin main` 을 실행한다.

---

## 자체 검토

**스펙 커버리지**

| 스펙 항목 | 담당 Task |
|---|---|
| §1 KaTeX passthrough 설정 | Task 1 Step 2 |
| §1 조건부 로드 (`math = true`) | Task 1 Step 3, 검증 Step 6 |
| §2 파일 구조 | Task 2·3 (File Structure 표와 일치) |
| §2 의존성 0 | Task 3 (import 는 상대 경로 ES 모듈만) |
| §2 다크모드 | Task 3 `themeColors`/`onThemeChange`, 검증 Step 6-7 |
| §2 모바일 | Task 3 `mathviz.css` 미디어쿼리 + `touch-action: none`, 검증 Step 6-8 |
| §3 캔버스 사양 (월드좌표, 원본 표시, 방향 표시) | Task 3 `WORLD`, `drawPolygon` 의 `firstEdge` |
| §3 클래스별 자유도·슬라이더·핸들 | Task 4 `CLASSES`, `handleCount` |
| §3 Affine 네 번째 점 따라오기 | Task 4 `onDrag` 의 affine 분기 (핸들 3개, `currentQuad` 로 4번째 생성) |
| §3 Homography 슬라이더 없음 | Task 4 `CLASSES.homography.defs = []` |
| §3 양방향 동기화 | Task 4 `onDrag` 의 `sliders.setValues` |
| §3 3×3 행렬 실시간 + 변경 원소 강조 | Task 3 `renderMatrix` 의 `mv-changed` |
| §3 보존량 readout | Task 2 `preservation`, Task 4 `draw` |
| §4 글 구성 | Task 5 Step 1 |
| §5 성공 기준 1 (빌드·목록) | Task 5 Step 3 |
| §5 성공 기준 2 (기존 글 회귀) | Task 1 Step 7, Task 5 Step 5 |
| §5 성공 기준 3 (블록·인라인 수식) | Task 1 Step 5, Task 5 Step 4-1 |
| §5 성공 기준 4 (데모 동작) | Task 4 Step 3 |
| §5 성공 기준 5 (light/dark) | Task 3 Step 6-7, Task 4 Step 3-3 |
| §5 성공 기준 6 (모바일) | Task 3 Step 6-8, Task 4 Step 3-4 |
| §5 성공 기준 7 (의존성 0) | Task 3 Step 1 (import 없음), Task 2 Step 1 (deps 없는 package.json) |

빠진 항목 없음.

**타입 일관성**

- `transform.js` export 이름이 Task 2 Interfaces, Task 3 import, Task 4 import 에서 일치한다
- `core.js` export 이름이 Task 3 Interfaces, Task 3 Step 4 import, Task 4 Step 1 import 에서 일치한다
- `makeSliders` 는 `{setValues, getValues}` 를 반환하고 Task 3·4 모두 `setValues` 만 쓴다
- `attachDrag(canvas, view, getPoints, onDrag)` 시그니처가 정의와 두 호출부에서 일치한다
- 슬라이더 `key` (`theta, s, sx, sy, shear, tx, ty`) 가 `CLASSES.defs` 와 `matrix()` 인자에서 일치한다
- `preservation` 반환 필드(`lengthRatio, angleDeg, perspective, keepsLength, keepsAngle, keepsParallel`)가 테스트와 `draw()` 에서 일치한다

**알려진 위험**

1. Task 1 Step 7 의 회귀 비교에서 기존 글이 바뀔 수 있다. 코드블록 안의 `$` 가 원인일 가능성이 가장 크다.
   그 경우 block 구분자에서 `$$` 를 빼고 `\[...\]` 만 쓰는 것으로 후퇴한다.
2. Task 4 Step 3-2 의 퇴화 사각형에서 `solve` 가 예외를 던진다. `try/catch` 처방이 같은 Step 에 적혀 있다.
3. KaTeX CDN 의 `integrity` 해시는 **0.18.1 기준이고, 계획 작성 시 실제로 다운로드해 sha384 를
   계산해 검증했다** (KaTeX 공식 문서 값과 일치). 버전을 바꾸면 해시도 다시 계산해야 한다:

   ```bash
   curl -sL https://cdn.jsdelivr.net/npm/katex@<버전>/dist/katex.min.js \
     | openssl dgst -sha384 -binary | openssl base64 -A
   ```

   해시 불일치 시 브라우저가 **조용히** 로드를 거부하므로 Task 1 Step 5 에서 잡힌다.
