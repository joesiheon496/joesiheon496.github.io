# CV 수학 시리즈 2편 (SVD) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 슬라이더로 행렬을 만지면 원이 타원으로 변하는 과정을 회전-스케일-회전 단계별로 보여주는 데모와, 점을 끌어 SVD로 직선을 맞추는 데모, 그리고 그 둘을 설명하는 글을 만든다.

**Architecture:** 1편의 하니스(`core.js`, `demo.html` shortcode, `mathviz.css`)를 그대로 재사용한다. 순수 수학은 `transform.js` 에 추가해 Node 로 TDD 하고, 데모별 조립만 새 파일로 만든다. 하니스 확장은 `drawArrow` 하나뿐이다.

**Tech Stack:** Hugo 0.164 + PaperMod, 바닐라 ES 모듈 + Canvas 2D, KaTeX 0.18.1, Node 24 `node:test`

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-29-cv-math-svd-design.md`
- 1편 스펙/계획: `2026-07-29-cv-math-transform2d-design.md`, `2026-07-29-cv-math-transform2d.md`
- 데모 JS 의 외부 의존성은 **0**. 빌드 스텝 없음. 외부 CDN 은 KaTeX 뿐이다.
- 수식 구분자: 블록 `$$...$$` 와 `\[...\]`, 인라인 `\(...\)`. **인라인에 `$...$` 를 쓰지 않는다.**
- **블록 수식 안에 `=` 를 홀로 한 줄에 두지 않는다.** Markdown 이 setext 제목 밑줄로 해석해
  passthrough 보다 먼저 블록을 쪼갠다. 1편에서 수식 두 개가 이것 때문에 조용히 깨졌다
  (`&` → `&amp;`, `\\` → `\`, `x'` → `x&rsquo;`). `=` 는 앞 줄 끝에 붙인다.
- 캔버스 색은 하드코딩 금지. `themeColors()` 로 CSS 변수를 읽고 `onThemeChange` 로 재렌더한다.
- 글 날짜를 미래로 적지 않는다. 미래면 Hugo 가 빌드에서 제외한다.
- Hugo 빌드에는 `go` 가 PATH 에 필요하다: `export PATH="$PATH:/c/Program Files/Go/bin"`
- 테스트는 **인자 없이** `node --test` 로 돌린다. `node --test tests/` 는 Node 24 에서
  디렉토리를 모듈로 해석해 실패한다. `npm test` 가 이미 그렇게 설정돼 있다.
- SVD 수치 허용오차는 **1e-9**. 1e-12 로 잡으면 악조건 입력에서 간헐적으로 실패한다
  (정규직교 오차가 최대 2.7e-11 까지 나오는 것을 스펙 작성 중 실측했다).
- 커밋은 각 Task 끝에서. 푸시는 사람이 승인할 때만.
- 구현은 `main` 이 아니라 새 브랜치에서 한다.

## File Structure

| 파일 | 책임 |
|---|---|
| `static/js/mathviz/transform.js` | **수정** — `svd2x2`, `svdRotationForm`, `pseudoInverse2x2` 추가 |
| `static/js/mathviz/core.js` | **수정** — `drawArrow` 추가 |
| `static/js/mathviz/svd.js` | 신규 — 데모 1 (행렬 → 원/타원, 단계 애니메이션) |
| `static/js/mathviz/lsfit.js` | 신규 — 데모 2 (점 → 직선) |
| `tests/mathviz/transform.test.js` | **수정** — SVD 테스트 13개 추가 |
| `content/posts/svd/index.md` | 신규 — 글 |
| `tools/check-math.py` | 신규 — 렌더된 본문의 수식 손상 검사 (1편에서 손상 2건을 잡은 검사) |

`layouts/shortcodes/demo.html` 과 `static/css/mathviz.css` 는 **수정하지 않는다.**
shortcode 는 `{{< demo name="svd" >}}` / `{{< demo name="lsfit" >}}` 로 이미 동작하고,
CSS 는 1편 레이아웃을 그대로 쓴다.

원/타원은 새 도형 코드가 필요 없다 — 64각형을 기존 `drawPolygon` 에 넣으면 원으로 보이고
행렬을 곱하면 정확히 타원이 된다.

---

### Task 1: SVD 수학 코어

**Files:**
- Modify: `static/js/mathviz/transform.js` (파일 끝에 추가)
- Test: `tests/mathviz/transform.test.js` (파일 끝에 추가, import 줄도 수정)

**Interfaces:**
- Consumes: 1편의 `preservation(M)` (테스트 10번에서 씀)
- Produces: Task 2·3 이 아래 이름을 그대로 쓴다.
  - `svd2x2(A) -> {s1, s2, v1, v2, u1, u2}` — `A` 는 `[[a,b],[c,d]]` (2×2, 3×3 아님).
    `s1 >= s2 >= 0`. 벡터는 `[x, y]` 단위벡터.
  - `svdRotationForm(A) -> {s1, s2signed, thetaU, thetaV}` — `thetaU`/`thetaV` 는 라디안.
    `U`, `V` 가 모두 회전이 되도록 `s2signed` 에 부호를 준다.
  - `pseudoInverse2x2(A, tol = 1e-12) -> [[x,y],[z,w]]`
  - `linear2x2(M) -> [[a,b],[c,d]]` — 3×3 동차행렬에서 왼쪽 위 2×2 만 떼낸다

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/mathviz/transform.test.js` 의 import 줄을 아래로 바꾼다.

```javascript
import {
  identity, rigid, similarity, affine, homographyFromQuads,
  apply, applyAll, preservation, decomposeAffine, UNIT_SQUARE,
  svd2x2, svdRotationForm, pseudoInverse2x2, linear2x2,
} from '../../static/js/mathviz/transform.js';
```

그리고 파일 끝에 아래를 추가한다.

```javascript
// ---------------------------------------------------------------- SVD

const mul2 = (X, Y) => [
  [X[0][0] * Y[0][0] + X[0][1] * Y[1][0], X[0][0] * Y[0][1] + X[0][1] * Y[1][1]],
  [X[1][0] * Y[0][0] + X[1][1] * Y[1][0], X[1][0] * Y[0][1] + X[1][1] * Y[1][1]],
];
const tr2 = (X) => [[X[0][0], X[1][0]], [X[0][1], X[1][1]]];
const det2 = (X) => X[0][0] * X[1][1] - X[0][1] * X[1][0];
const rot2 = (t) => [[Math.cos(t), -Math.sin(t)], [Math.sin(t), Math.cos(t)]];
const maxErr2 = (X, Y) => Math.max(
  Math.abs(X[0][0] - Y[0][0]), Math.abs(X[0][1] - Y[0][1]),
  Math.abs(X[1][0] - Y[1][0]), Math.abs(X[1][1] - Y[1][1]));

// 결정적 케이스 목록. 무작위 대신 고정 목록을 쓴다 (실패를 재현할 수 있어야 한다).
const SVD_CASES = [
  [[1, 0], [0, 1]], [[3, 0], [0, 0.5]], [[0, -1], [1, 0]], [[1, 1], [1, 1]],
  [[2, 1], [1, 3]], [[1.2, 0.4], [0, 0.8]], [[-1, 0], [0, 1]], [[0.001, 0], [0, 1]],
  [[0, 0], [0, 0]], [[0, 1], [0, 0]], [[5, 0], [0, 0]], [[1, 2], [3, 1]],
  [[0, 1], [1, 0]], [[2, 0], [0, -3]],
];
for (let k = 0; k < 30; k++) {
  const g = (n) => ((k * 37 + n * 11) % 19) / 7 - 1.3;
  SVD_CASES.push([[g(1), g(2)], [g(3), g(4)]]);
}

test('svd2x2: U Σ Vᵀ 가 A 를 재구성한다', () => {
  for (const A of SVD_CASES) {
    const { s1, s2, u1, u2, v1, v2 } = svd2x2(A);
    const U = [[u1[0], u2[0]], [u1[1], u2[1]]];
    const V = [[v1[0], v2[0]], [v1[1], v2[1]]];
    const R = mul2(mul2(U, [[s1, 0], [0, s2]]), tr2(V));
    assert.ok(maxErr2(A, R) < 1e-9,
      `재구성 실패 ${JSON.stringify(A)} 오차 ${maxErr2(A, R)}`);
  }
});

test('svd2x2: U 와 V 가 정규직교다', () => {
  const I = [[1, 0], [0, 1]];
  for (const A of SVD_CASES) {
    const { u1, u2, v1, v2 } = svd2x2(A);
    const U = [[u1[0], u2[0]], [u1[1], u2[1]]];
    const V = [[v1[0], v2[0]], [v1[1], v2[1]]];
    assert.ok(maxErr2(mul2(tr2(U), U), I) < 1e-9, `U 직교 실패 ${JSON.stringify(A)}`);
    assert.ok(maxErr2(mul2(tr2(V), V), I) < 1e-9, `V 직교 실패 ${JSON.stringify(A)}`);
  }
});

test('svd2x2: σ1 >= σ2 >= 0', () => {
  for (const A of SVD_CASES) {
    const { s1, s2 } = svd2x2(A);
    assert.ok(s2 >= 0, `σ2 음수 ${JSON.stringify(A)}`);
    assert.ok(s1 >= s2 - 1e-12, `순서 위반 ${JSON.stringify(A)}`);
  }
});

test('svd2x2: 회전행렬은 σ1 = σ2 = 1', () => {
  const { s1, s2 } = svd2x2(rot2(0.7));
  near(s1, 1, 1e-9);
  near(s2, 1, 1e-9);
});

test('svd2x2: diag(3, 0.5) 는 σ = 3, 0.5', () => {
  const { s1, s2 } = svd2x2([[3, 0], [0, 0.5]]);
  near(s1, 3, 1e-9);
  near(s2, 0.5, 1e-9);
});

test('svd2x2: 특이행렬은 σ2 = 0', () => {
  const { s1, s2 } = svd2x2([[1, 1], [1, 1]]);
  near(s1, 2, 1e-9);
  near(s2, 0, 1e-9);
});

test('svd2x2: 영행렬은 예외 없이 σ = 0, 0 을 준다', () => {
  const r = svd2x2([[0, 0], [0, 0]]);
  near(r.s1, 0, 1e-12);
  near(r.s2, 0, 1e-12);
  near(Math.hypot(r.u1[0], r.u1[1]), 1, 1e-12);   // 방향은 여전히 단위벡터
  near(Math.hypot(r.v1[0], r.v1[1]), 1, 1e-12);
});

test('pseudoInverse2x2: 가역 행렬에서는 역행렬과 같다', () => {
  const A = [[2, 1], [1, 3]];
  const P = pseudoInverse2x2(A);
  assert.ok(maxErr2(mul2(A, P), [[1, 0], [0, 1]]) < 1e-9);
});

test('pseudoInverse2x2: 특이 행렬에서도 유한한 값을 준다', () => {
  const P = pseudoInverse2x2([[1, 1], [1, 1]]);
  assert.ok(P.flat().every(Number.isFinite), `유한하지 않다 ${JSON.stringify(P)}`);
});

test('1편 연결: keepsAngle 이면 σ1 = σ2 다', () => {
  const cases = [
    rigid({ theta: 0.6, tx: 1, ty: 2 }),
    similarity({ theta: -0.4, s: 1.8, tx: 0, ty: 0 }),
    affine({ theta: 0.3, sx: 1.4, sy: 0.6, shear: 0.5, tx: 0, ty: 0 }),
  ];
  for (const M of cases) {
    const { s1, s2 } = svd2x2(linear2x2(M));
    const keeps = preservation(M).keepsAngle;
    assert.equal(keeps, Math.abs(s1 - s2) < 1e-9,
      `불일치: keepsAngle=${keeps} σ1=${s1} σ2=${s2}`);
  }
});

test('svdRotationForm: U 와 V 가 항상 회전이다 (det = +1)', () => {
  for (const A of SVD_CASES) {
    const { thetaU, thetaV } = svdRotationForm(A);
    near(det2(rot2(thetaU)), 1, 1e-9);
    near(det2(rot2(thetaV)), 1, 1e-9);
  }
});

test('svdRotationForm: 부호 있는 σ2 로도 A 를 재구성한다', () => {
  for (const A of SVD_CASES) {
    const { s1, s2signed, thetaU, thetaV } = svdRotationForm(A);
    const R = mul2(mul2(rot2(thetaU), [[s1, 0], [0, s2signed]]), tr2(rot2(thetaV)));
    assert.ok(maxErr2(A, R) < 1e-9,
      `회전형 재구성 실패 ${JSON.stringify(A)} 오차 ${maxErr2(A, R)}`);
  }
});

test('svdRotationForm: det(A) 의 부호가 σ2 의 부호다', () => {
  for (const A of SVD_CASES) {
    const d = det2(A);
    if (Math.abs(d) < 1e-9) continue;            // 퇴화는 부호가 정해지지 않는다
    const { s2signed } = svdRotationForm(A);
    assert.equal(Math.sign(s2signed), Math.sign(d),
      `부호 불일치 ${JSON.stringify(A)} det=${d} σ2=${s2signed}`);
  }
});

test('linear2x2: 3×3 동차행렬에서 왼쪽 위 2×2 를 떼낸다', () => {
  const M = affine({ theta: 0, sx: 2, sy: 3, shear: 0.5, tx: 9, ty: -9 });
  assert.deepEqual(linear2x2(M), [[2, 0.5], [0, 3]]);
});
```

- [ ] **Step 2: 테스트가 실패하는 것 확인**

```bash
cd "D:/projects/joesiheon496.github.io"
npm test
```

Expected: FAIL. `svd2x2` 등이 export 되지 않아 import 단계에서 죽는다.

- [ ] **Step 3: 구현**

`static/js/mathviz/transform.js` 끝에 추가한다.

```javascript
/** 3×3 동차행렬에서 선형부(왼쪽 위 2×2)만 떼낸다. */
export function linear2x2(M) {
  return [[M[0][0], M[0][1]], [M[1][0], M[1][1]]];
}

/**
 * 2×2 SVD. A = U diag(s1, s2) Vᵀ, s1 >= s2 >= 0.
 *
 * 흔히 쓰이는 E/F/G/H + 두 각 닫힌 형식은 쓰지 않는다. 특이값은 맞지만
 * 각도 규약을 잘못 조합하기 쉽고, 그러면 재구성이 조용히 깨진다.
 * 대신 AᵀA 의 고윳값 분해로 V 와 σ 를 얻고 u_i = A v_i / σ_i 로 U 를 만든다.
 * 퇴화(σ2 = 0, A = 0)를 명시적으로 다룰 수 있다는 것도 이 경로의 장점이다.
 *
 * A 는 2×2 (`[[a,b],[c,d]]`). 3×3 동차행렬을 넣으려면 linear2x2 를 먼저 통과시킨다.
 */
export function svd2x2(A) {
  const [[a, b], [c, d]] = A;

  // B = AᵀA (대칭 준양정)
  const p = a * a + c * c;
  const q = a * b + c * d;
  const r = b * b + d * d;

  const disc = Math.sqrt(Math.max(0, (p - r) * (p - r) + 4 * q * q));
  const l1 = (p + r + disc) / 2;
  const l2 = Math.max(0, (p + r - disc) / 2);
  const s1 = Math.sqrt(Math.max(0, l1));
  const s2 = Math.sqrt(l2);

  // l1 에 대응하는 고유벡터. q ≈ 0 이면 B 가 이미 대각이므로 큰 쪽 축을 고른다.
  let v1;
  if (Math.abs(q) > 1e-14) v1 = [q, l1 - p];
  else v1 = p >= r ? [1, 0] : [0, 1];
  const n1 = Math.hypot(v1[0], v1[1]) || 1;
  v1 = [v1[0] / n1, v1[1] / n1];
  const v2 = [-v1[1], v1[0]];               // 직교 보완 — 이 구성 때문에 V 는 항상 회전이다

  const Av = (v) => [a * v[0] + b * v[1], c * v[0] + d * v[1]];
  const EPS = 1e-12;

  let u1;
  if (s1 > EPS) {
    const w = Av(v1);
    u1 = [w[0] / s1, w[1] / s1];
  } else {
    u1 = [1, 0];                            // A = 0
  }

  let u2;
  if (s2 > EPS) {
    const w = Av(v2);
    u2 = [w[0] / s2, w[1] / s2];
  } else {
    u2 = [-u1[1], u1[0]];                   // 퇴화: 직교 보완으로 채운다
  }

  return { s1, s2, v1, v2, u1, u2 };
}

/**
 * 단계 애니메이션용 형태. U 와 V 를 **모두 회전**으로 만든다.
 *
 * V 는 svd2x2 의 구성상 항상 회전이지만 U 는 det(A) < 0 이면 반사가 된다.
 * 그러면 회전만으로는 A 에 도달할 수 없다. u2 를 뒤집고 σ2 에 부호를 주면
 * 둘 다 회전이 되고 재구성은 그대로 정확하다.
 *
 * 데모에서 음수 σ2 는 "도형이 선분을 지나 뒤집힌다" 로 보인다 — 그게 반사다.
 */
export function svdRotationForm(A) {
  const { s1, s2, v1, u1, u2 } = svd2x2(A);
  const detU = u1[0] * u2[1] - u1[1] * u2[0];
  const flip = detU < 0;
  // u2 를 뒤집은 벡터는 따로 만들지 않는다 — 회전행렬의 두 번째 열은 첫 번째 열로
  // 정해지므로 thetaU 하나로 U 가 완전히 결정되고, flip 여부는 s2signed 의 부호에 담긴다.
  return {
    s1,
    s2signed: flip ? -s2 : s2,
    thetaU: Math.atan2(u1[1], u1[0]),
    thetaV: Math.atan2(v1[1], v1[0]),
  };
}

/**
 * 의사역행렬 A⁺ = V Σ⁺ Uᵀ. σ_i <= tol 인 성분은 0 으로 버린다.
 * 가역 행렬에서는 역행렬과 같고, 특이 행렬에서도 유한한 값을 준다.
 */
export function pseudoInverse2x2(A, tol = 1e-12) {
  const { s1, s2, v1, v2, u1, u2 } = svd2x2(A);
  const i1 = s1 > tol ? 1 / s1 : 0;
  const i2 = s2 > tol ? 1 / s2 : 0;
  // A⁺ = i1 (v1 u1ᵀ) + i2 (v2 u2ᵀ)
  return [
    [i1 * v1[0] * u1[0] + i2 * v2[0] * u2[0], i1 * v1[0] * u1[1] + i2 * v2[0] * u2[1]],
    [i1 * v1[1] * u1[0] + i2 * v2[1] * u2[0], i1 * v1[1] * u1[1] + i2 * v2[1] * u2[1]],
  ];
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd "D:/projects/joesiheon496.github.io"
npm test
```

Expected: 1편 15개 + 신규 13개 = **28개 PASS**.

실패 시 진단 순서:
- 재구성 실패 → `U`/`V` 의 열 구성(`[[u1x, u2x],[u1y, u2y]]`)을 확인한다
- 정규직교 실패가 1e-9 근처 → 허용오차를 낮추지 말고 악조건 케이스인지 본다
  (스펙 §2 에 실측 2.7e-11 기록)
- `svdRotationForm` 부호 실패 → `detU` 계산의 `u1[0]*u2[1] - u1[1]*u2[0]` 순서 확인

- [ ] **Step 5: 커밋**

```bash
cd "D:/projects/joesiheon496.github.io"
git add static/js/mathviz/transform.js tests/mathviz/transform.test.js
git commit -m "feat: add 2x2 SVD, rotation form and pseudo-inverse

Uses the A^T A eigen route rather than the E/F/G/H closed form, whose
angle convention is easy to miscombine into a silently broken
reconstruction. Degenerate cases (sigma2 = 0, zero matrix) are handled
explicitly.

svdRotationForm exists because V is always a rotation but U is a
reflection when det(A) < 0, so the stage animation cannot reach A with
rotations alone. Flipping u2 and signing sigma2 fixes that.

One test ties this post to the previous one: preservation().keepsAngle is
true exactly when sigma1 == sigma2."
```

---

### Task 2: drawArrow + 데모 1 (행렬이 원을 타원으로)

**Files:**
- Modify: `static/js/mathviz/core.js` (파일 끝에 추가)
- Create: `static/js/mathviz/svd.js`

**Interfaces:**
- Consumes: Task 1 의 `svd2x2`, `svdRotationForm`, `pseudoInverse2x2`.
  1편의 `themeColors`, `onThemeChange`, `createView`, `drawGrid`, `drawPolygon`,
  `makeSliders`, `renderMatrix`.
- Produces: `core.js` 가 `drawArrow(ctx, view, from, to, {color, width, head})` 를 export 한다.
  Task 3 이 그대로 쓴다. `svd.js` 는 `init(root)` 를 export 한다 (shortcode 규약).

- [ ] **Step 1: `core.js` 에 `drawArrow` 추가**

파일 끝에 추가한다.

```javascript
/** 월드좌표 from → to 화살표. head 는 머리 길이(픽셀). */
export function drawArrow(ctx, view, from, to, { color, width = 2, head = 9 }) {
  const [x0, y0] = view.toPixel(from);
  const [x1, y1] = view.toPixel(to);
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;                       // 너무 짧으면 그리지 않는다 (σ = 0)

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();

  const ux = dx / len, uy = dy / len;
  const h = Math.min(head, len * 0.5);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - h * ux - h * 0.45 * uy, y1 - h * uy + h * 0.45 * ux);
  ctx.lineTo(x1 - h * ux + h * 0.45 * uy, y1 - h * uy - h * 0.45 * ux);
  ctx.closePath();
  ctx.fill();
}
```

- [ ] **Step 2: `svd.js` 구현**

```javascript
// static/js/mathviz/svd.js
// 데모 1 — 행렬 원소 4개를 주면 원이 타원으로 변한다.
// 단계 슬라이더 t 가 회전 → 스케일 → 회전 을 하나씩 보여준다.

import { svd2x2, svdRotationForm, pseudoInverse2x2 } from './transform.js';
import {
  themeColors, onThemeChange, createView, drawGrid, drawPolygon,
  drawArrow, makeSliders, renderMatrix,
} from './core.js';

const WORLD = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
const TRUNC_TOL = 0.05;          // 절단 의사역행렬 임계값

// 단위원을 64각형으로 근사한다. 새 도형 코드가 필요 없다.
const CIRCLE = Array.from({ length: 64 }, (_, i) => {
  const a = (i / 64) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
});

const DEFS = [
  { key: 'a', label: 'a', min: -2, max: 2, step: 0.01, value: 1.2 },
  { key: 'b', label: 'b', min: -2, max: 2, step: 0.01, value: 0.8 },
  { key: 'c', label: 'c', min: -2, max: 2, step: 0.01, value: -0.3 },
  { key: 'd', label: 'd', min: -2, max: 2, step: 0.01, value: 1.0 },
  { key: 't', label: '단계', min: 0, max: 3, step: 0.01, value: 3,
    fmt: (v) => v.toFixed(2) },
];

/** 단계 t 에서의 2×2 행렬. t = 3 이면 A 와 정확히 같다. */
function stageMatrix(A, t) {
  const { s1, s2signed, thetaU, thetaV } = svdRotationForm(A);
  const rot = (th) => [[Math.cos(th), -Math.sin(th)], [Math.sin(th), Math.cos(th)]];
  const mul = (X, Y) => [
    [X[0][0] * Y[0][0] + X[0][1] * Y[1][0], X[0][0] * Y[0][1] + X[0][1] * Y[1][1]],
    [X[1][0] * Y[0][0] + X[1][1] * Y[1][0], X[1][0] * Y[0][1] + X[1][1] * Y[1][1]],
  ];
  const trp = (X) => [[X[0][0], X[1][0]], [X[0][1], X[1][1]]];

  // 1구간: Vᵀ 회전을 0 에서 전체로 보간
  const a1 = Math.min(1, t);
  let M = trp(rot(thetaV * a1));

  // 2구간: 스케일을 1 에서 σ 로 보간
  if (t > 1) {
    const b = Math.min(1, t - 1);
    const k1 = 1 + b * (s1 - 1);
    const k2 = 1 + b * (s2signed - 1);
    M = mul([[k1, 0], [0, k2]], M);
  }

  // 3구간: U 회전을 0 에서 전체로 보간
  if (t > 2) {
    const g = Math.min(1, t - 2);
    M = mul(rot(thetaU * g), M);
  }
  return M;
}

const applyLin = (M, [x, y]) => [M[0][0] * x + M[0][1] * y, M[1][0] * x + M[1][1] * y];

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = createView(canvas, WORLD);
  const state = { a: 1.2, b: 0.8, c: -0.3, d: 1.0, t: 3 };

  makeSliders(root.querySelector('.mv-sliders'), DEFS, (v) => {
    Object.assign(state, v);
    draw();
  });

  const matrixA = () => [[state.a, state.b], [state.c, state.d]];

  function draw() {
    const colors = themeColors();
    const A = matrixA();
    const M = stageMatrix(A, state.t);
    const { s1, s2, u1, u2, v1, v2 } = svd2x2(A);

    drawGrid(ctx, view, colors);

    // 입력 단위원 (흐림) + 입력 쪽 특이벡터
    drawPolygon(ctx, view, CIRCLE, { stroke: colors.muted, width: 1.2 });
    drawArrow(ctx, view, [0, 0], v1, { color: colors.muted, width: 1.5 });
    drawArrow(ctx, view, [0, 0], v2, { color: colors.muted, width: 1.5 });

    // 현재 단계의 도형
    drawPolygon(ctx, view, CIRCLE.map((p) => applyLin(M, p)),
      { stroke: colors.accent, fill: `${colors.accent}22`, width: 2 });

    // 출력 쪽 특이벡터 (길이가 σ) — t = 3 일 때 타원의 두 반축이다
    if (state.t > 2.99) {
      drawArrow(ctx, view, [0, 0], [u1[0] * s1, u1[1] * s1],
        { color: colors.accent2, width: 2.5 });
      drawArrow(ctx, view, [0, 0], [u2[0] * s2, u2[1] * s2],
        { color: colors.accent2, width: 2.5 });
    }

    renderMatrix(root.querySelector('.mv-matrix-host'),
      [[M[0][0], M[0][1], 0], [M[1][0], M[1][1], 0], [0, 0, 1]]);

    // readout
    const cond = s2 > 1e-12 ? (s1 / s2).toFixed(2) : '∞';
    const conformal = Math.abs(s1 - s2) < 1e-9;
    const inv = pseudoInverse2x2(A, 1e-12);
    const trunc = pseudoInverse2x2(A, TRUNC_TOL);
    const norm = (P) => Math.max(...P.flat().map(Math.abs));
    const { s2signed } = svdRotationForm(A);

    root.querySelector('.mv-readout').innerHTML = `
      σ₁ = <b>${s1.toFixed(3)}</b> &nbsp; σ₂ = <b>${s2.toFixed(3)}</b>
      &nbsp; 조건수 σ₁/σ₂ = <b>${cond}</b><br>
      각도 보존 ${conformal
        ? '<span class="ok">예</span> (σ₁ = σ₂)'
        : '<span class="no">아니오</span>'}
      ${s2signed < 0 ? '&nbsp; · <span class="no">뒤집힘 (det &lt; 0)</span>' : ''}<br>
      A⁻¹ 최대 원소 <b>${s2 > 1e-12 ? norm(inv).toFixed(1) : '발산'}</b>
      &nbsp; 절단 A⁺ (σ &le; ${TRUNC_TOL}) 최대 원소 <b>${norm(trunc).toFixed(1)}</b>`;

    root.querySelector('.mv-hint').textContent = state.t > 2.99
      ? 'a·b·c·d 를 아무 값으로나 놓아보세요. 빨간 화살표 두 개가 타원의 반축이고 '
      + '그 길이가 σ₁, σ₂ 입니다. σ₂ 를 0 에 가깝게 만들면 타원이 선분으로 붕괴합니다.'
      : '단계 슬라이더: 0→1 회전(Vᵀ), 1→2 축 방향 스케일(Σ), 2→3 회전(U). '
      + '3 에서의 결과가 A 를 한 번 곱한 것과 같습니다.';
  }

  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
```

- [ ] **Step 3: `t` = 3 이 `A` 와 일치하는지 브라우저 없이 확인**

이것이 데모 1 의 핵심 불변식이다. Node 로 직접 검증한다.

```bash
cd "D:/projects/joesiheon496.github.io"
node -e "
import('./static/js/mathviz/transform.js').then(T => {
  const rot = th => [[Math.cos(th), -Math.sin(th)], [Math.sin(th), Math.cos(th)]];
  const mul = (X,Y) => [
    [X[0][0]*Y[0][0]+X[0][1]*Y[1][0], X[0][0]*Y[0][1]+X[0][1]*Y[1][1]],
    [X[1][0]*Y[0][0]+X[1][1]*Y[1][0], X[1][0]*Y[0][1]+X[1][1]*Y[1][1]]];
  const trp = X => [[X[0][0],X[1][0]],[X[0][1],X[1][1]]];
  function stage(A, t) {
    const {s1, s2signed, thetaU, thetaV} = T.svdRotationForm(A);
    let M = trp(rot(thetaV * Math.min(1,t)));
    if (t > 1) { const b = Math.min(1, t-1);
      M = mul([[1+b*(s1-1),0],[0,1+b*(s2signed-1)]], M); }
    if (t > 2) { const g = Math.min(1, t-2); M = mul(rot(thetaU*g), M); }
    return M;
  }
  const cases = [[[1.2,0.8],[-0.3,1.0]], [[1,2],[3,1]], [[-1,0],[0,1]],
                 [[2,0],[0,-3]], [[1,1],[1,1]], [[0.001,0],[0,1]]];
  let worst = 0;
  for (const A of cases) {
    const M = stage(A, 3);
    const e = Math.max(Math.abs(M[0][0]-A[0][0]), Math.abs(M[0][1]-A[0][1]),
                       Math.abs(M[1][0]-A[1][0]), Math.abs(M[1][1]-A[1][1]));
    worst = Math.max(worst, e);
    console.log(JSON.stringify(A), 'err', e.toExponential(1));
  }
  console.log('worst', worst.toExponential(2), worst < 1e-9 ? 'OK' : 'FAIL');
});
"
```

Expected: 모든 케이스 오차 < 1e-9, 마지막 줄 `OK`.

FAIL 이면 `stageMatrix` 의 곱 순서를 본다 — \(A = U \Sigma V^\top\) 이므로
적용 순서는 \(V^\top\) 먼저, 그 다음 \(\Sigma\), 마지막 \(U\) 다.

- [ ] **Step 4: 문법·export 확인**

```bash
cd "D:/projects/joesiheon496.github.io"
node --check static/js/mathviz/core.js
node --check static/js/mathviz/svd.js
node -e "
globalThis.window = { devicePixelRatio: 1 };
import('./static/js/mathviz/core.js').then(m =>
  console.log('drawArrow:', typeof m.drawArrow));
"
npm test
```

Expected: `node --check` 무출력, `drawArrow: function`, 테스트 28개 PASS.

- [ ] **Step 5: 확인용 임시 글 만들고 서버 띄우기**

```bash
mkdir -p "D:/projects/joesiheon496.github.io/content/posts/_svdcheck"
cat > "D:/projects/joesiheon496.github.io/content/posts/_svdcheck/index.md" <<'EOF'
+++
title = "svd demo check"
date = 2026-01-01T00:00:00+09:00
math = true
+++

인라인 \(\sigma_1\) 과 블록:

$$ A = U \Sigma V^\top $$

{{< demo name="svd" >}}
EOF
export PATH="$PATH:/c/Program Files/Go/bin"
cd "D:/projects/joesiheon496.github.io"
hugo server --port 1313 --bind 127.0.0.1 --disableFastRender
```

- [ ] **Step 6: 브라우저에서 수동 검증**

`http://localhost:1313/posts/_svdcheck/` 에서 **직접 확인한다.**

1. 흐린 원과 진한 타원이 보이고, 흐린 화살표 2개(\(v_1, v_2\))와 빨간 화살표 2개가 있다
2. `a`·`b`·`c`·`d` 를 움직이면 타원의 모양과 방향이 바뀐다
3. 빨간 화살표 두 개가 **타원의 반축과 정확히 겹친다**
4. 단계 슬라이더를 0 → 3 으로 천천히 끌면 원 → 회전 → 늘어남 → 회전 순서가 보인다
5. `t` = 3 에서 타원이 `t` 를 건드리기 전과 같다
6. `d` 를 조절해 σ₂ 를 0 에 가깝게 만들면 타원이 **선분으로 붕괴**하고
   조건수가 큰 값 또는 `∞` 가 되며, `A⁻¹ 최대 원소` 가 폭발하는데
   `절단 A⁺` 는 유한하게 남는다
7. `a = -1, b = 0, c = 0, d = 1` (반사)에서 **뒤집힘 (det < 0)** 표시가 나오고,
   단계 슬라이더 1→2 구간에서 도형이 선분을 지나 뒤집힌다
8. 회전행렬 근처(`a = d`, `b = -c`)에서 `각도 보존 예 (σ₁ = σ₂)` 가 나온다
9. light / dark 양쪽에서 읽힌다
10. 콘솔에 에러가 없다

- [ ] **Step 7: 커밋**

```bash
cd "D:/projects/joesiheon496.github.io"
git add static/js/mathviz/core.js static/js/mathviz/svd.js
git commit -m "feat: add SVD demo - matrix turns a circle into an ellipse

The stage slider walks through rotate, scale, rotate; at t = 3 the result
equals multiplying by A once, verified numerically to 1e-9 including
reflection and ill-conditioned cases. The circle is a 64-gon fed to the
existing drawPolygon, so no new drawing primitive was needed beyond
drawArrow.

Readout carries the pseudo-inverse comparison: as sigma2 approaches zero
the inverse blows up while the truncated pseudo-inverse stays finite."
```

---

### Task 3: 데모 2 (점에서 직선을 뽑는다)

**Files:**
- Create: `static/js/mathviz/lsfit.js`

**Interfaces:**
- Consumes: Task 1 의 `svd2x2`. Task 2 의 `drawArrow`.
  1편의 `themeColors`, `onThemeChange`, `createView`, `drawGrid`, `drawHandles`, `attachDrag`.
- Produces: `init(root)` (shortcode 규약)

- [ ] **Step 1: `lsfit.js` 구현**

```javascript
// static/js/mathviz/lsfit.js
// 데모 2 — 점 6개를 끌면 SVD 가 직선을 맞춘다 (총최소자승 = 직교 회귀).
//
// 데이터는 2×N 이다. 2×2 공분산 C = D Dᵀ 의 SVD 를 쓰면 svd2x2 를 그대로
// 재사용할 수 있다. C 는 대칭 준양정이라 SVD 가 고윳값 분해와 같고,
// 방향벡터 u1, u2 는 데이터 D 의 특이벡터와 동일하다.
//
// ⚠️ C 의 특이값은 D 의 특이값의 제곱이다. readout 에는 제곱근을 쓴다.

import { svd2x2 } from './transform.js';
import {
  themeColors, onThemeChange, createView, drawGrid,
  drawHandles, drawArrow, attachDrag,
} from './core.js';

const WORLD = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };

const INITIAL = [
  [-2.2, -1.4], [-1.3, -0.7], [-0.4, -0.2],
  [0.5, 0.4], [1.4, 0.8], [2.3, 1.5],
];

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = createView(canvas, WORLD);
  const pts = INITIAL.map((p) => [...p]);

  root.querySelector('.mv-sliders').innerHTML = '';   // 이 데모는 슬라이더가 없다

  attachDrag(canvas, view, () => pts, (i, p) => {
    pts[i] = p;
    draw();
  });

  /** 중심화한 뒤 2×2 공분산의 SVD. sigma 는 데이터 기준(제곱근 취함). */
  function fit() {
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p[0], 0) / n;
    const my = pts.reduce((s, p) => s + p[1], 0) / n;
    let cxx = 0, cxy = 0, cyy = 0;
    for (const [x, y] of pts) {
      const dx = x - mx, dy = y - my;
      cxx += dx * dx; cxy += dx * dy; cyy += dy * dy;
    }
    const { s1, s2, u1, u2 } = svd2x2([[cxx, cxy], [cxy, cyy]]);
    return {
      center: [mx, my],
      dir: u1,                 // 직선 방향
      normal: u2,              // 법선
      sig1: Math.sqrt(s1),     // 데이터의 특이값
      sig2: Math.sqrt(s2),
    };
  }

  function draw() {
    const colors = themeColors();
    const { center, dir, normal, sig1, sig2 } = fit();

    drawGrid(ctx, view, colors);

    // 맞춘 직선을 화면 끝까지 늘려 그린다
    const L = 8;
    const p0 = [center[0] - dir[0] * L, center[1] - dir[1] * L];
    const p1 = [center[0] + dir[0] * L, center[1] + dir[1] * L];
    const [ax, ay] = view.toPixel(p0);
    const [bx, by] = view.toPixel(p1);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

    // 잔차 — 각 점에서 직선에 내린 수선
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1;
    for (const p of pts) {
      const d = (p[0] - center[0]) * normal[0] + (p[1] - center[1]) * normal[1];
      const foot = [p[0] - normal[0] * d, p[1] - normal[1] * d];
      const [fx, fy] = view.toPixel(foot);
      const [px, py] = view.toPixel(p);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(fx, fy); ctx.stroke();
    }

    // 특이벡터: 중심에서 σ 길이만큼
    drawArrow(ctx, view, center,
      [center[0] + dir[0] * sig1, center[1] + dir[1] * sig1],
      { color: colors.accent2, width: 2.5 });
    drawArrow(ctx, view, center,
      [center[0] + normal[0] * sig2, center[1] + normal[1] * sig2],
      { color: colors.accent2, width: 2.5 });

    drawHandles(ctx, view, pts, colors);

    const ratio = sig1 > 1e-12 ? sig2 / sig1 : 0;
    let verdict;
    if (ratio < 0.1) verdict = '<span class="ok">방향이 잘 정해졌다</span>';
    else if (ratio < 0.4) verdict = '방향이 어느 정도 정해졌다';
    else verdict = '<span class="no">방향이 정해지지 않는다</span>';

    root.querySelector('.mv-matrix-host').innerHTML = '';
    root.querySelector('.mv-readout').innerHTML = `
      σ₁ = <b>${sig1.toFixed(3)}</b> &nbsp; σ₂ = <b>${sig2.toFixed(3)}</b>
      &nbsp; σ₂/σ₁ = <b>${ratio.toFixed(3)}</b><br>${verdict}`;
    root.querySelector('.mv-hint').textContent =
      '점을 끌어보세요. 점들을 한 줄로 세우면 σ₂/σ₁ 이 0 에 가까워지고 직선이 잘 정해집니다. '
      + '한 곳에 뭉치면 1 에 가까워지고 어느 방향인지 알 수 없게 됩니다. '
      + '회색 선은 각 점에서 직선까지의 수직 거리입니다 — SVD 는 이 거리들의 제곱합을 최소화합니다.';
  }

  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
```

- [ ] **Step 2: 직교 회귀가 맞는지 브라우저 없이 확인**

정확히 직선 위의 점들에서는 σ₂ = 0 이 나와야 하고, 방향이 그 직선과 같아야 한다.

```bash
cd "D:/projects/joesiheon496.github.io"
node -e "
import('./static/js/mathviz/transform.js').then(T => {
  function fit(pts) {
    const n = pts.length;
    const mx = pts.reduce((s,p)=>s+p[0],0)/n, my = pts.reduce((s,p)=>s+p[1],0)/n;
    let cxx=0, cxy=0, cyy=0;
    for (const [x,y] of pts) { const dx=x-mx, dy=y-my;
      cxx+=dx*dx; cxy+=dx*dy; cyy+=dy*dy; }
    const {s1,s2,u1,u2} = T.svd2x2([[cxx,cxy],[cxy,cyy]]);
    return {dir:u1, normal:u2, sig1:Math.sqrt(s1), sig2:Math.sqrt(s2), center:[mx,my]};
  }
  // 1) 기울기 0.5 직선 위의 점들 -> sigma2 = 0, 방향 = (1,0.5) 정규화
  const line = [-2,-1,0,1,2].map(x => [x, 0.5*x]);
  const f1 = fit(line);
  const expect = [1/Math.hypot(1,0.5), 0.5/Math.hypot(1,0.5)];
  const align = Math.abs(Math.abs(f1.dir[0]*expect[0] + f1.dir[1]*expect[1]) - 1);
  console.log('완전 직선: sigma2 =', f1.sig2.toExponential(1),
              '| 방향 정렬 오차', align.toExponential(1),
              '| ratio', (f1.sig2/f1.sig1).toExponential(1));
  // 2) 정사각형 배치 -> 등방이므로 ratio = 1
  const sq = [[-1,-1],[1,-1],[1,1],[-1,1]];
  const f2 = fit(sq);
  console.log('정사각형: ratio =', (f2.sig2/f2.sig1).toFixed(6), '(1 이어야 함)');
  // 3) 한 점에 뭉침 -> sigma 둘 다 0, 예외 없음
  const blob = [[1,1],[1,1],[1,1],[1,1]];
  const f3 = fit(blob);
  console.log('한 점: sig1 =', f3.sig1.toExponential(1), 'sig2 =', f3.sig2.toExponential(1),
              '| 유한:', Number.isFinite(f3.dir[0]) && Number.isFinite(f3.dir[1]));
  // 4) 수직선 -> 방향 (0,1)
  const vert = [-2,-1,0,1,2].map(y => [0, y]);
  const f4 = fit(vert);
  console.log('수직선: 방향', f4.dir.map(n=>n.toFixed(3)), '| sigma2', f4.sig2.toExponential(1));
});
"
```

Expected:
- 완전 직선: σ₂ ≈ 0 (1e-8 이하), 방향 정렬 오차 ≈ 0, ratio ≈ 0
- 정사각형: ratio = 1.000000
- 한 점: σ 둘 다 ≈ 0, 방향이 `유한: true` (NaN 이 아니다)
- 수직선: 방향 ≈ `[0.000, 1.000]` 또는 `[0.000, -1.000]`, σ₂ ≈ 0

`한 점` 케이스가 NaN 이면 `svd2x2` 의 영행렬 처리를 확인한다 (Task 1 에서 테스트했다).

- [ ] **Step 3: 문법 확인**

```bash
cd "D:/projects/joesiheon496.github.io"
node --check static/js/mathviz/lsfit.js
npm test
```

Expected: 무출력, 테스트 28개 PASS.

- [ ] **Step 4: 임시 글에 데모 2 추가**

```bash
cat >> "D:/projects/joesiheon496.github.io/content/posts/_svdcheck/index.md" <<'EOF'

{{< demo name="lsfit" >}}
EOF
```

서버가 꺼졌으면 다시 띄운다.

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "D:/projects/joesiheon496.github.io"
hugo server --port 1313 --bind 127.0.0.1 --disableFastRender
```

- [ ] **Step 5: 브라우저에서 수동 검증**

`http://localhost:1313/posts/_svdcheck/` 에서 **직접 확인한다.**

1. 점 6개, 맞춘 직선, 각 점에서 직선으로 내린 회색 수선이 보인다
2. 점을 끌면 직선이 즉시 따라온다
3. 점들을 한 줄로 세우면 σ₂/σ₁ 이 0 에 가까워지고 `방향이 잘 정해졌다` 가 나온다
4. 점들을 한 곳에 뭉치면 σ₂/σ₁ 이 1 에 가까워지고 `방향이 정해지지 않는다` 가 나온다
5. 점을 정사각형으로 배치하면 σ₂/σ₁ ≈ 1
6. 빨간 화살표 두 개가 중심에서 나가고, 긴 쪽이 직선 방향이다
7. 두 데모가 같은 페이지에서 서로 간섭하지 않는다 (한쪽 슬라이더가 다른 쪽에 영향 없음)
8. light / dark 양쪽에서 읽힌다
9. 좁은 폭에서 터치로 점을 끌 수 있다
10. 콘솔에 에러가 없다

7번이 중요하다 — shortcode 가 `.Ordinal` 로 id 를 만들므로 두 데모의 id 가 달라야 한다.

- [ ] **Step 6: 커밋**

```bash
cd "D:/projects/joesiheon496.github.io"
git add static/js/mathviz/lsfit.js
git commit -m "feat: add SVD line-fit demo

Total least squares by SVD of the 2x2 covariance, which lets svd2x2 be
reused directly. Note the covariance's singular values are the data's
squared, so the readout takes square roots.

Grey perpendiculars show what is actually being minimised. The sigma2 to
sigma1 ratio is the point of the demo: collapse the points into a blob and
the fitted direction stops meaning anything."
```

---

### Task 4: 글 작성 및 검증

**Files:**
- Create: `content/posts/svd/index.md`
- Delete: `content/posts/_svdcheck/`

**Interfaces:**
- Consumes: Task 2·3 의 두 데모, 1편의 `math = true` 와 `{{< demo >}}` shortcode
- Produces: 발행 가능한 글

- [ ] **Step 1: 글 작성**

`content/posts/svd/index.md` 를 만든다. 날짜는 **작성 시점의 현재 시각**을 쓴다
(`date "+%Y-%m-%dT%H:%M:%S+09:00"` 로 얻는다). 미래면 Hugo 가 제외한다.

```toml
+++
title = "SVD — 모든 행렬은 회전하고 늘리고 다시 회전한다"
date = <현재 시각, +09:00>
draft = false
math = true
tags = ["컴퓨터비전", "선형대수", "SVD", "최소자승", "인터랙티브"]
categories = ["프로그램"]
summary = "임의의 숫자 네 개로 만든 행렬도 항상 회전-스케일-회전으로 쪼개진다. 특이값은 그 방향이 얼마나 잘 정해졌는지를 알려주고, 그것이 조건수·의사역행렬·최소자승을 하나로 묶는다. 직접 만지는 데모 두 개를 넣었다."
+++
```

본문 구성. **축은 하나다** — "특이값은 그 방향이 얼마나 잘 정해졌는지를 알려준다".

1. **한 줄 요약** + 1편으로 되돌아가는 고리:
   1편 데모에서 homography 네 점을 일직선에 모으면 `특이 행렬` 예외가 났다.
   이 글이 그 예외를 설명한다.
2. **원을 넣으면 타원이 나온다** — 2×2 행렬을 단위원에 먹이면 항상 타원이다.
   왜 항상 타원인지(선형변환은 직선을 직선으로, 원을 타원으로)
3. **데모 1** `{{< demo name="svd" >}}` — 단계 슬라이더를 0 → 3 으로 끌어보라고 안내
4. **회전-스케일-회전** — 수식과 각 인자의 뜻:

```
$$
A = U \Sigma V^\top, \qquad
\Sigma = \begin{bmatrix} \sigma_1 & 0 \\ 0 & \sigma_2 \end{bmatrix}
$$
```

   \(V^\top\) 이 먼저 돌려서 늘릴 축을 좌표축에 맞추고, \(\Sigma\) 가 그 축 방향으로
   늘리고, \(U\) 가 다시 돌려 제자리에 놓는다. 타원의 두 반축이 \(\sigma_1 u_1\), \(\sigma_2 u_2\) 다.
5. **1편과의 대응** — 1편의 "각도 보존"은 \(\sigma_1 = \sigma_2\) 다.
   원이 원으로 남는 것이 각도가 보존되는 것이다. 데모의 readout 이 이걸 표시한다.
6. **조건수와 퇴화** — \(\sigma_1/\sigma_2\) 가 크면 한 방향으로 심하게 납작하다.
   \(\sigma_2 = 0\) 이면 타원이 선분이 되고, 평면 전체가 직선으로 뭉개진다.
   **정보가 사라졌으므로 되돌릴 수 없다** — 이것이 "특이"의 뜻이고 1편 예외의 정체다.
7. **의사역행렬** — 되돌릴 수 없으면 "가장 그럴듯하게" 되돌린다.
   \(A^{+} = V \Sigma^{+} U^\top\), 작은 σ 는 버린다. 데모 1 의 readout 에서
   σ₂ 를 0 에 가깝게 만들면 \(A^{-1}\) 은 폭발하고 절단 \(A^{+}\) 는 유한하게 남는다.
   **작은 특이값을 나누는 것이 수치적 폭발의 정체다.**
8. **최소자승: 점에서 직선을 뽑는다** + **데모 2** `{{< demo name="lsfit" >}}`
   점들의 흩어짐을 두 방향으로 쪼개면 큰 쪽이 직선 방향이다.
   σ₂/σ₁ 이 곧 "이 답을 얼마나 믿을 수 있는가" 다.
9. **CV 에서 왜 중요한가** — 세 가지를 짧게:
   - homography·기본행렬을 네 점(여덟 점)에서 구할 때 점 배치가 나쁘면 σ 가 작아지고 답이 흔들린다.
     1편 데모의 예외가 정확히 이것이다
   - 카메라 캘리브레이션에서 체커보드를 여러 각도로 찍는 이유가 σ 를 키우는 것이다
   - 회전행렬을 다시 회전행렬로 정규화할 때 SVD 를 쓴다 (\(\Sigma\) 를 항등으로 바꿔치기)
10. **정리** + 다음 글 예고(경사하강법 / 최소자승 — 한 번에 구하는 방식과 반복해서 찾아가는 방식의 대비)

작성 규칙:
- **모든 수식 앞에 그 수식이 무슨 일을 하는지 한 문장을 먼저 둔다.**
  독자가 수식을 건너뛰어도 글이 이어져야 한다
- 블록 수식은 `$$...$$`, 인라인은 `\(...\)`
- **블록 수식 안에 `=` 를 홀로 한 줄에 두지 않는다** (Global Constraints 참조)

- [ ] **Step 2: 임시 글 삭제**

```bash
rm -rf "D:/projects/joesiheon496.github.io/content/posts/_svdcheck"
rm -rf "D:/projects/joesiheon496.github.io/public/posts/_svdcheck"
```

`public/` 도 지운다. Hugo server 가 `public/` 에서 서빙하므로 남겨두면
삭제한 글이 계속 200 으로 응답한다 (1편에서 실제로 겪었다).

- [ ] **Step 3: 빌드하고 글이 나오는지 확인**

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
SCRATCH="C:/Users/a/AppData/Local/Temp/claude/D--projects-new-paper-plan/675d4174-f855-48dc-a070-405423f32946/scratchpad"
cd "D:/projects/joesiheon496.github.io"
hugo --destination "$SCRATCH/svdfinal" --quiet > /d/tmp/hugo-svd.txt 2>&1
echo "hugo exit=$?"
grep -vE "deprecated|^$" /d/tmp/hugo-svd.txt | head -5
P="$SCRATCH/svdfinal/posts/svd/index.html"
ls "$P"
grep -c katex "$P"
grep -c "mv-demo" "$P"
grep -c "svd" "$SCRATCH/svdfinal/posts/index.html"
```

Expected: `hugo exit=0`, 경고 외 출력 없음, 파일 존재, `katex` > 0,
`mv-demo` = **2** (데모 두 개), 목록 페이지에 등장.

`hugo exit` 를 파이프 뒤에서 읽지 않는다 — 1편에서 `grep` 의 종료코드를
빌드 종료코드로 잘못 읽어 실패를 놓쳤다.

- [ ] **Step 4: 수식이 깨지지 않았는지 확인**

먼저 검사 스크립트를 저장소에 만든다. 1편에서 이 검사가 실제로 손상 두 건을 잡았고,
스크립트 블록(JSON-LD, KaTeX 설정)을 제거하지 않으면 손상을 **놓친다** —
1편에서 JSON-LD 를 본문으로 잡아 정상으로 오판했다.

`tools/check-math.py` 를 만든다.

```python
"""렌더된 글의 본문에서 수식이 깨지지 않았는지 확인한다.

사용법: python tools/check-math.py <rendered-index.html>

Goldmark 가 수식을 건드리면 & -> &amp;, \\ -> \, x' -> x&rsquo; 로 변형되고
블록 안에 </h1> 이 끼어든다. 원인은 대개 블록 수식 안의 홀로 있는 '=' 줄이다
(Markdown 이 setext 제목 밑줄로 해석한다).
"""
import re
import sys

path = sys.argv[1]
html = open(path, encoding="utf-8").read()

# script/style 을 먼저 제거한다. JSON-LD 와 KaTeX 설정이 본문으로 잡히면
# 손상을 놓치게 된다.
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
    flat = b.strip().replace("\n", " ")
    print("  [%d] %s" % (i, flat[:150]))
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
```

그리고 실행한다.

```bash
SCRATCH="C:/Users/a/AppData/Local/Temp/claude/D--projects-new-paper-plan/675d4174-f855-48dc-a070-405423f32946/scratchpad"
cd "D:/projects/joesiheon496.github.io"
python tools/check-math.py "$SCRATCH/svdfinal/posts/svd/index.html"
echo "exit=$?"
```

1편 글에도 돌려 회귀가 없는지 본다.

```bash
python tools/check-math.py "$SCRATCH/svdfinal/posts/2d-transform-matrix/index.html"
```

Expected: 두 글 모두 `OK — 수식 손상 없음`, `exit=0`.
`block formulas` 개수가 글에 쓴 개수와 일치하는지도 눈으로 확인한다.

`FAIL` 이 나오면 스크립트가 어느 블록의 무엇이 문제인지 알려준다. 원인은 대개
그 수식에 `=` 가 홀로 한 줄에 있는 것이다 — 앞 줄 끝에 붙인다.

- [ ] **Step 5: 기존 글 회귀 확인**

passthrough 는 1편에서 이미 켰으므로 이번엔 설정 변경이 없다. 그래도 확인한다.

```bash
SCRATCH="C:/Users/a/AppData/Local/Temp/claude/D--projects-new-paper-plan/675d4174-f855-48dc-a070-405423f32946/scratchpad"
grep -c katex "$SCRATCH/svdfinal/posts/pu-mask/index.html"
grep -c katex "$SCRATCH/svdfinal/posts/voxel-sampling-bench/index.html"
grep -c katex "$SCRATCH/svdfinal/posts/2d-transform-matrix/index.html"
ls "$SCRATCH/svdfinal/posts/_svdcheck" 2>&1 | head -1
```

Expected: 앞의 두 개는 **0**, 1편 글은 **> 0**, `_svdcheck` 는 `No such file`.

- [ ] **Step 6: 로컬 서버에서 최종 확인**

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "D:/projects/joesiheon496.github.io"
hugo server --port 1313 --bind 127.0.0.1 --disableFastRender
```

`http://localhost:1313/posts/svd/` 에서 확인한다.

1. 수식이 KaTeX 로 렌더된다 (`\sigma`, `\Sigma`, `U \Sigma V^\top` 이 글자로 남지 않는다)
2. 데모 두 개가 각각 동작하고 서로 간섭하지 않는다
3. light / dark 양쪽에서 수식과 두 데모가 모두 읽힌다
4. 좁은 폭에서 레이아웃이 깨지지 않는다
5. 1편 글 링크가 있으면 동작한다
6. 콘솔에 에러가 없다

- [ ] **Step 7: 커밋**

```bash
cd "D:/projects/joesiheon496.github.io"
git add content/posts/svd/ tools/check-math.py
git commit -m "post: SVD - every matrix rotates, stretches, rotates

Second post in the CV math series. One spine holds the wide scope
together: singular values tell you how well-determined a direction is,
which is what connects the ellipse, the condition number, the
pseudo-inverse and least squares.

Closes the loop opened in post 1, where dragging the four homography
points onto a line threw a singular-matrix error that post 1 could only
catch, not explain."
```

- [ ] **Step 8: 푸시는 사람의 승인을 받는다**

푸시하면 공개 발행된다. 자동으로 하지 않는다. 로컬 미리보기를 보여주고
명시적 승인을 받은 뒤에만 진행한다. 그 다음 `finishing-a-development-branch` 로
브랜치를 정리한다.

---

## 자체 검토

**스펙 커버리지**

| 스펙 항목 | 담당 |
|---|---|
| §글의 축 (특이값 = 방향이 얼마나 정해졌는가) | Task 4 Step 1, 본문 구성 전체 |
| §1편과의 연결 — homography 예외 | Task 4 Step 1 (1, 6, 9번 항목) |
| §1편과의 연결 — keepsAngle = σ₁=σ₂ | Task 1 테스트 10, Task 2 readout, Task 4 Step 1 (5번) |
| §1 재사용/추가 파일 목록 | File Structure 표 |
| §2 AᵀA 경로, 닫힌 형식 금지 | Task 1 Step 3 (`svd2x2` 주석에 이유 기록) |
| §2 퇴화 처리 (σ₂=0, A=0, q≈0) | Task 1 Step 3, 테스트 6·7 |
| §2 허용오차 1e-9 | Global Constraints, Task 1 테스트 전부 |
| §2 반사 / `svdRotationForm` | Task 1 Step 3, 테스트 11·12·13 |
| §3 슬라이더 a,b,c,d + 단계 t | Task 2 Step 2 `DEFS` |
| §3 단계 보간 규칙 (원소 보간 금지) | Task 2 Step 2 `stageMatrix`, 검증 Step 3 |
| §3 t=3 이 A 와 일치 | Task 2 Step 3 (Node 검증), Step 6-5 |
| §3 원/타원 64각형 | Task 2 Step 2 `CIRCLE` |
| §3 화살표 v₁,v₂ / σu₁,σu₂ | Task 2 Step 1 `drawArrow`, Step 2 `draw` |
| §3 readout σ·조건수·각도보존·A⁻¹ vs A⁺ | Task 2 Step 2 `draw` |
| §3 σ₂=0 붕괴 | Task 2 Step 6-6 |
| §4 점 6개 드래그, 직선, σ₂/σ₁ | Task 3 Step 1 |
| §4 공분산 특이값 제곱 함정 | Task 3 Step 1 (주석 + `Math.sqrt`), 검증 Step 2 |
| §5 테스트 1~13 | Task 1 Step 1 (13개 전부) |
| §6-1 npm test | Task 1 Step 4, Task 2 Step 4, Task 3 Step 3 |
| §6-2 빌드·목록 | Task 4 Step 3 |
| §6-3 KaTeX, `=` 함정 | Global Constraints, Task 4 Step 4 |
| §6-4 데모 1 동작 | Task 2 Step 6 |
| §6-5 데모 2 동작 | Task 3 Step 5 |
| §6-6 light/dark | Task 2 Step 6-9, Task 3 Step 5-8, Task 4 Step 6-3 |
| §6-7 모바일 | Task 3 Step 5-9, Task 4 Step 6-4 |
| §6-8 기존 글 회귀 | Task 4 Step 5 |
| §6-9 의존성 0 | Task 2·3 (import 는 상대 경로 ES 모듈만) |
| §7 후속 (3편 예고) | Task 4 Step 1 (10번 항목) |

빠진 항목 없음.

**타입 일관성**

- `svd2x2` 반환 필드 `{s1, s2, v1, v2, u1, u2}` 가 Task 1 정의·테스트,
  Task 2 `draw`, Task 3 `fit` 에서 일치
- `svdRotationForm` 반환 `{s1, s2signed, thetaU, thetaV}` 가 Task 1 정의·테스트,
  Task 2 `stageMatrix`·`draw` 에서 일치
- `pseudoInverse2x2(A, tol)` 시그니처가 정의와 Task 2 두 호출부에서 일치
- `linear2x2(M)` 은 Task 1 테스트 10·14 에서만 쓴다 (3×3 → 2×2)
- `drawArrow(ctx, view, from, to, {color, width, head})` 가 Task 2 정의,
  Task 2 `draw` 3회, Task 3 `draw` 2회 호출에서 일치
- `init(root)` 규약이 `svd.js`, `lsfit.js` 모두 동일하고 shortcode 가 기대하는 이름과 같다
- 슬라이더 `key` (`a,b,c,d,t`) 가 `DEFS` 와 `state`, `matrixA`, `stageMatrix` 인자에서 일치

**알려진 위험**

1. `svdRotationForm` 이 `_u2r` 을 반환하지만 아무도 쓰지 않는다. 회전각으로 U 가
   완전히 결정되므로 필요 없다. 남겨두면 죽은 코드이므로 **Task 1 구현 시 지운다.**
   → 아래 수정 반영: 반환에서 제외한다.
2. 데모 2 가 `.mv-matrix-host` 와 `.mv-sliders` 를 비우는데, shortcode 가 두 요소를
   항상 만들므로 안전하다. 다만 데모 1 과 같은 페이지에 있을 때 **서로의 DOM 을
   건드리지 않아야 한다** — 각 `init` 이 자기 `root` 안에서만 querySelector 하므로
   괜찮다. Task 3 Step 5-7 에서 확인한다.
3. 데모 1 의 `t` 기본값이 3 이다. 페이지를 열면 완성된 타원이 보이고, 단계는
   사용자가 슬라이더를 움직일 때만 나타난다. 의도된 동작이다.
4. `stageMatrix` 는 매 프레임 `svdRotationForm` 을 호출한다 (SVD 를 두 번 계산).
   2×2 이므로 비용이 무시할 수준이다. 최적화하지 않는다.
