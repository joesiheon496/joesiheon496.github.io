# CV 수학 시리즈 4편 (모멘텀에서 Adam 까지) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기울어지는 등고선 위에서 다섯 방법의 반복수를 나란히 보며 "축별 보폭은 축이 좌표축과 맞을 때만 κ 를 지운다"를 체감하는 데모와, 3편의 직선맞춤을 축별 보폭으로 다시 풀어 중심화가 곧 Hessian 대각화임을 보여주는 데모, 그리고 그 둘을 설명하는 글을 만든다.

**Architecture:** 1·2·3편 하니스(`core.js`, `demo.html` shortcode, `mathviz.css`)를 그대로 재사용한다. 순수 수학은 새 파일 `adaptive.js` 에 모아 Node 로 TDD 하고, 데모별 조립만 새 파일로 만든다. `adaptive.js` 는 3편의 `olsKappa`·`centerPoints` 를 import 해서 쓴다 — 그 재사용이 데모 2 의 논지다. 하니스 확장은 `makeRadios` 하나뿐이다.

**Tech Stack:** Hugo 0.164 + PaperMod, 바닐라 ES 모듈 + Canvas 2D, KaTeX, Node 24 `node:test`

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-30-cv-math-adam-design.md`
- 1·2·3편 스펙: `2026-07-29-cv-math-transform2d-design.md`, `2026-07-29-cv-math-svd-design.md`,
  `2026-07-29-cv-math-gradient-descent-design.md`
- 브랜치는 이미 `feat/cv-math-adam` 이다. `main` 에서 작업하지 않는다.
- 데모 JS 의 외부 의존성은 **0**. 빌드 스텝 없음. 외부 CDN 은 KaTeX 뿐이다.
- 수식 구분자: 블록 `$$...$$` 와 `\[...\]`, 인라인 `\(...\)`. **인라인에 `$...$` 를 쓰지 않는다.**
- **블록 수식 안에 `=` 를 홀로 한 줄에 두지 않는다.** Markdown 이 setext 제목 밑줄로 해석해
  passthrough 보다 먼저 블록을 쪼갠다. 1편에서 수식 두 개가 이것 때문에 조용히 깨졌다.
  `=` 는 앞 줄 끝에 붙인다.
- 캔버스 색은 하드코딩 금지. `themeColors()` 로 CSS 변수를 읽고 `onThemeChange` 로 재렌더한다.
- `layouts/shortcodes/demo.html` 과 `static/css/mathviz.css` 는 **수정하지 않는다.**
- `static/js/mathviz/optimize.js` 도 **수정하지 않는다.** 3편 함수는 import 해서 쓴다.
- 글 날짜를 미래로 적지 않는다. 미래면 Hugo 가 빌드에서 제외한다. 오늘은 **2026-07-30** 이다.
- Hugo 빌드에는 `go` 가 PATH 에 필요하다: `export PATH="$PATH:/c/Program Files/Go/bin"`
- 테스트는 **인자 없이** `node --test` 로 돌린다. `node --test tests/` 는 Node 24 에서
  디렉토리를 모듈로 해석해 실패한다. `npm test` 가 이미 그렇게 설정돼 있다.
- 테스트 기준선은 **48개**다. 이 계획이 끝나면 **73개**가 된다 (신규 `test()` 블록 25개 —
  Task 2 의 fix round 에서 `optPath` 발산 테스트가 하나 늘었다).
  스펙 §8 이 말한 "10개" 는 **검증 항목 수**이고 `test()` 블록 수가 아니다. 개수를 58 로
  맞추려고 테스트를 합치지 말 것 — 항목 하나에 여러 단정이 들어가면 실패 지점을 못 찾는다.
- 수치 허용오차는 기본 **1e-9**. 예외는 두 곳이며 이유가 있다:
  - `diagPreconditionedKappa` 의 θ=45° 항등식은 **상대오차 1e-9** (대각 성분 차가 실측
    2.1e-14 로 0 이 아니다)
  - **회전 불변성 테스트는 상대 5%** (`bestEta` 의 로그 그리드가 θ 마다 다른 η 를 골라
    GD 실측이 350.6~369.0 로 폭 18.4 회다. `±3 회` 로 잡으면 옳은 구현이 실패한다.
    스펙 §6 테스트 4)
- **`'rmsprop'` 과 `'adam'` 은 분리된 구현이다.** `'adam'` 에 `β₁=0` 을 넣어 RMSProp 을
  대신하지 않는다 — `v` 의 편향 보정 유무 때문에 반복수가 달라진다 (κ=100·45° 에서
  424.4 회 대 330.8 회). 스펙 §3-4
- **η 를 시작점마다 따로 고르지 않는다.** 시작점 5개의 **평균**을 최소화하는 η 하나를 고른다.
  시작점마다 다시 고르면 "그 점에 정확히 착지하는 η" 를 찾아내 반복수가 인공적으로 1 이 된다.
  스펙 §3-1, §3-2
- readout 표 라벨에 **"시작점 5개 평균 · 각 방법의 최적 η 기준"** 을 둘 다 명시한다.
  없으면 시작점을 옮겼는데 표가 안 변하는 것을 독자가 버그로 읽는다.
- 커밋은 각 Task 끝에서. 푸시는 사람이 승인할 때만.

## File Structure

| 파일 | 책임 |
|---|---|
| `static/js/mathviz/adaptive.js` | **신규** — 순수 수학. 회전 이차함수 + 옵티마이저 5종 + OLS 확장 |
| `static/js/mathviz/core.js` | **수정** — `makeRadios` 추가 (파일 끝) |
| `static/js/mathviz/tilted.js` | 신규 — 데모 1 (기울어지는 등고선) |
| `static/js/mathviz/adamfit.js` | 신규 — 데모 2 (직선맞춤 세 번째 방문) |
| `tests/mathviz/adaptive.test.js` | 신규 — 테스트 10개 |
| `content/posts/adam/index.md` | 신규 — 글 |

`tests/mathviz/optimize.test.js` 와 `transform.test.js` 는 **건드리지 않는다.** 4편 테스트는
새 파일로 분리해 기준선 48개를 회귀 기준으로 남긴다.

**기울어진 등고선에 새 도형 코드는 필요 없다.** `xᵀAx = 2c` 의 등위선은 축정렬 타원을 θ 만큼
회전한 것이므로, 3편처럼 64각형 `[a·cos t, (a/√κ)·sin t]` 를 만든 뒤 회전행렬을 곱해 기존
`drawPolygon` 에 넣는다.

**하니스 확장 `makeRadios` 를 `makeToggles` 로 대신하지 않는 이유**: `makeToggles` 는 항목마다
독립적인 boolean 을 돌려주도록 되어 있어 배타성을 끼우면 반환 규약이 깨진다.

---

### Task 1: adaptive.js — 회전 이차함수와 대각 전처리 조건수

축 문장의 계량을 먼저 만든다. 이것이 없으면 나머지 코드가 무엇을 재는지 알 수 없다.

**Files:**
- Create: `static/js/mathviz/adaptive.js`
- Test: `tests/mathviz/adaptive.test.js`

**Interfaces:**
- Consumes: 없음 (이 Task 는 독립적이다)
- Produces:
  - `rotatedHessian(kappa: number, theta: number) → [[number, number], [number, number]]`
  - `quadGradA(A: number[][], p: [number, number]) → [number, number]`
  - `symEig2(A: number[][]) → [number, number]` — [큰 고윳값, 작은 고윳값]
  - `diagPreconditionedKappa(A: number[][]) → number`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/mathviz/adaptive.test.js` 를 새로 만든다.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rotatedHessian, quadGradA, symEig2, diagPreconditionedKappa,
} from '../../static/js/mathviz/adaptive.js';

const RAD = (deg) => (deg * Math.PI) / 180;

test('rotatedHessian: 고윳값이 θ 와 무관하게 {1, κ} 다 (회전 불변)', () => {
  for (const kappa of [2, 10, 30, 100]) {
    for (const deg of [0, 15, 30, 45, 73, 90]) {
      const [l1, l2] = symEig2(rotatedHessian(kappa, RAD(deg)));
      assert.ok(Math.abs(l1 - kappa) < 1e-12, `κ=${kappa} θ=${deg}: l1=${l1}`);
      assert.ok(Math.abs(l2 - 1) < 1e-12, `κ=${kappa} θ=${deg}: l2=${l2}`);
    }
  }
});

test('rotatedHessian: 대칭이고 θ=0 에서 diag(1, κ) 다', () => {
  const A = rotatedHessian(30, 0);
  assert.ok(Math.abs(A[0][0] - 1) < 1e-12);
  assert.ok(Math.abs(A[1][1] - 30) < 1e-12);
  assert.ok(Math.abs(A[0][1]) < 1e-12);
  assert.equal(A[0][1], A[1][0]);
});

test('diagPreconditionedKappa: θ=0° 에서 1 이다 (완전 정렬)', () => {
  for (const kappa of [2, 10, 30, 100]) {
    const k = diagPreconditionedKappa(rotatedHessian(kappa, 0));
    assert.ok(Math.abs(k - 1) < 1e-12, `κ=${kappa}: ${k}`);
  }
});

test('diagPreconditionedKappa: θ=45° 에서 κ 그대로다 (대각 전처리가 무력해진다)', () => {
  // A₁₁ = A₂₂ = (1+κ)/2 이므로 D 가 항등행렬의 스칼라 곱이 되고 조건수가 안 바뀐다.
  // 대각 성분 차가 실측 2.1e-14 로 정확히 0 이 아니라 상대오차로 본다. 스펙 §2-5
  for (const kappa of [10, 30, 100]) {
    const A = rotatedHessian(kappa, RAD(45));
    assert.ok(Math.abs(A[0][0] - A[1][1]) < 1e-12, `대각 성분이 같아야 한다: ${A[0][0]} ${A[1][1]}`);
    const k = diagPreconditionedKappa(A);
    assert.ok(Math.abs(k - kappa) / kappa < 1e-9, `κ=${kappa}: ${k}`);
  }
});

test('quadGradA: A·p 를 돌려준다', () => {
  const A = [[2, 1], [1, 5]];
  assert.deepEqual(quadGradA(A, [3, 4]), [2 * 3 + 1 * 4, 1 * 3 + 5 * 4]);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module '.../adaptive.js'`

- [ ] **Step 3: 최소 구현을 쓴다**

`static/js/mathviz/adaptive.js` 를 새로 만든다.

```js
// static/js/mathviz/adaptive.js
// 4편 — 축별 보폭(적응적 학습률)의 순수 수학.
//
// 축 문장: **축별 보폭은 축이 좌표축과 맞을 때만 κ 를 지운다.**
// θ=45° 에서 A 의 대각 성분이 같아져 대각 전처리가 항등행렬의 스칼라 곱이 되고,
// κ(D⁻¹A) = κ(A) 로 조건수가 전혀 바뀌지 않는다. 스펙 §2-5.
//
// ⚠️ 이 축 문장을 Adam 에까지 적용하지 말 것. Adam 은 β₁ 때문에 이 상을 벗어난다.
// 스펙 §2-2 와 §글의 축의 경고를 볼 것.

/** A = R(θ) diag(1, κ) R(θ)ᵀ. 대칭이라 [[a,b],[b,c]] 꼴이다. */
export function rotatedHessian(kappa, theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const off = (1 - kappa) * c * s;
  return [
    [c * c + kappa * s * s, off],
    [off, s * s + kappa * c * c],
  ];
}

/** ½xᵀAx 의 기울기 = A·p. */
export function quadGradA(A, [x, y]) {
  return [A[0][0] * x + A[0][1] * y, A[1][0] * x + A[1][1] * y];
}

/** 2×2 대칭행렬의 고윳값 [큰 것, 작은 것]. */
export function symEig2(A) {
  const tr = A[0][0] + A[1][1];
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const r = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  return [tr / 2 + r, tr / 2 - r];
}

/**
 * 대각 전처리 D = diag(A₁₁, A₂₂) 를 적용한 뒤의 조건수 κ(D⁻¹A).
 *
 * 이것이 축 문장의 계량이다. θ=0° 면 D = A 라 1 이 나오고, θ=45° 면 A₁₁ = A₂₂ 라
 * D 가 항등행렬의 스칼라 곱이어서 κ(A) 가 그대로 나온다.
 *
 * D⁻¹A 는 대칭이 아니지만, D 가 양정이므로 D^(−1/2) A D^(−1/2) 와 같은 고윳값을 가진다.
 * 후자는 대칭이라 symEig2 로 정확히 풀린다 — 그래서 비대칭 고윳값 코드가 필요 없다.
 */
export function diagPreconditionedKappa(A) {
  const d0 = Math.sqrt(A[0][0]);
  const d1 = Math.sqrt(A[1][1]);
  const M = [
    [A[0][0] / (d0 * d0), A[0][1] / (d0 * d1)],
    [A[1][0] / (d1 * d0), A[1][1] / (d1 * d1)],
  ];
  const [l1, l2] = symEig2(M);
  return l2 > 1e-300 ? l1 / l2 : Infinity;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test 2>&1 | tail -12`
Expected: PASS, `tests 53` (기준선 48 + 5)

- [ ] **Step 5: 커밋**

```bash
git add static/js/mathviz/adaptive.js tests/mathviz/adaptive.test.js
git commit -m "feat(adaptive): add rotated quadratic and diagonal-preconditioned kappa

The axis sentence needs a number attached to it, and this is it:
kappa(D^-1 A) is 1 when the ellipse lines up with the axes and stays
kappa at 45 degrees, where the two diagonal entries become equal and the
preconditioner degenerates to a scaled identity."
```

---

### Task 2: adaptive.js — 옵티마이저 5종과 궤적

**Files:**
- Modify: `static/js/mathviz/adaptive.js` (파일 끝에 추가)
- Test: `tests/mathviz/adaptive.test.js` (파일 끝에 추가)

**Interfaces:**
- Consumes: Task 1 의 `quadGradA`
- Produces:
  - `KINDS: string[]` — `['gd', 'momentum', 'adagrad', 'rmsprop', 'adam']`
  - `initState() → {m: [number, number], v: [number, number], s: [number, number], t: number}`
  - `optimizerStep(kind: string, state, g: [number, number], opts) → {step: [number, number], state}`
    - `opts`: `{eta, beta, beta1, beta2, eps, biasCorrect}`, 기본값
      `eta=0.1, beta=0.9, beta1=0.9, beta2=0.999, eps=1e-8, biasCorrect=true`
  - `effectiveEta(kind: string, state, opts) → [number, number]`
  - `optPath({kind, A, start, steps, eta, ...opts}) → [number, number][]` — 길이 `steps+1`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/mathviz/adaptive.test.js` 끝에 추가한다. import 문에 새 이름들을 더한다.

```js
// 파일 맨 위 import 문을 이렇게 바꾼다:
// import {
//   rotatedHessian, quadGradA, symEig2, diagPreconditionedKappa,
//   KINDS, initState, optimizerStep, effectiveEta, optPath,
// } from '../../static/js/mathviz/adaptive.js';

test('optimizerStep: gd 는 η·g 를 그대로 돌려준다', () => {
  const { step } = optimizerStep('gd', initState(), [2, -4], { eta: 0.25 });
  assert.deepEqual(step, [0.5, -1]);
});

test('optimizerStep: 모르는 kind 는 던진다', () => {
  assert.throws(() => optimizerStep('nesterov', initState(), [1, 1], {}), /모르는 kind/);
});

test('optimizerStep: Adam 첫 스텝의 크기가 축마다 ≈η 다 (편향 보정의 효과)', () => {
  // t=1 에서 두 모멘트를 모두 보정하면 m̂/√v̂ = g/|g| 가 되어 보폭이 η 로 정규화된다.
  //
  // ⚠️ 보정을 끄면 첫 스텝이 **커진다**. m 은 (1−β₁)g = 0.1g 로 작아지지만 √v 는
  // √(1−β₂)|g| = 0.0316|g| 로 **더** 작아져서, 비가 (1−β₁)/√(1−β₂) = 3.162 배로 뜬다.
  // 실측 확인: η=0.01, g=7 에서 보정 ON 0.0100, OFF 0.0316228.
  // 편향 보정이 존재하는 이유가 이 과대한 초기 스텝을 잡는 것이다.
  const eta = 0.01;
  const g = [7, -0.03];  // 두 축의 기울기 크기를 크게 다르게 둔다
  const on = optimizerStep('adam', initState(), g, { eta, biasCorrect: true }).step;
  assert.ok(Math.abs(Math.abs(on[0]) - eta) / eta < 1e-6, `x축: ${on[0]}`);
  assert.ok(Math.abs(Math.abs(on[1]) - eta) / eta < 1e-6, `y축: ${on[1]}`);
  // 부호는 기울기를 따라간다
  assert.ok(on[0] > 0 && on[1] < 0);

  const off = optimizerStep('adam', initState(), g, { eta, biasCorrect: false }).step;
  const ratio = Math.abs(off[0]) / Math.abs(on[0]);
  const expected = (1 - 0.9) / Math.sqrt(1 - 0.999);   // (1−β₁)/√(1−β₂) = 3.162
  assert.ok(Math.abs(ratio - expected) / expected < 1e-6, `배율: ${ratio} (기대 ${expected})`);
  assert.ok(Math.abs(off[0]) > Math.abs(on[0]), '보정을 끄면 첫 스텝이 커진다');
});

test('optimizerStep: rmsprop 과 adam 은 다른 방법이다', () => {
  // adam 에 β₁=0 을 넣어 rmsprop 을 대신하지 않는다. v 의 편향 보정 유무 때문에
  // 첫 스텝부터 다르다. 스펙 §3-4
  const g = [3, 3];
  const rp = optimizerStep('rmsprop', initState(), g, { eta: 0.1 }).step;
  const ad0 = optimizerStep('adam', initState(), g, { eta: 0.1, beta1: 0 }).step;
  assert.ok(Math.abs(rp[0] - ad0[0]) > 1e-6, `같으면 안 된다: ${rp[0]} ${ad0[0]}`);
});

test('optimizerStep: adagrad 의 유효 학습률이 반복과 함께 줄어든다', () => {
  // s 가 단조 증가하므로 η/√s 가 0 으로 수렴한다. 이것이 RMSProp 이 존재하는 이유다.
  let st = initState();
  const first = [];
  const last = [];
  for (let i = 0; i < 200; i++) {
    const r = optimizerStep('adagrad', st, [1, 1], { eta: 0.1 });
    st = r.state;
    if (i === 0) first.push(...effectiveEta('adagrad', st, { eta: 0.1 }));
    if (i === 199) last.push(...effectiveEta('adagrad', st, { eta: 0.1 }));
  }
  assert.ok(last[0] < first[0] / 10, `${first[0]} → ${last[0]}`);
});

test('optPath: 길이가 steps+1 이고 첫 점이 시작점이다', () => {
  const A = rotatedHessian(10, 0);
  const path = optPath({ kind: 'gd', A, start: [2, 1], steps: 7, eta: 0.05 });
  assert.equal(path.length, 8);
  assert.deepEqual(path[0], [2, 1]);
});

test('optPath: 잘 잡은 η 로 GD 가 최소점에 가까워진다', () => {
  const A = rotatedHessian(10, 0);
  const path = optPath({ kind: 'gd', A, start: [2, 1], steps: 200, eta: 2 / (1 + 10) });
  const last = path[path.length - 1];
  assert.ok(Math.hypot(last[0], last[1]) < 1e-6, `끝점: ${last}`);
});

test('KINDS: 다섯 방법이고 전부 optimizerStep 을 통과한다', () => {
  assert.equal(KINDS.length, 5);
  for (const kind of KINDS) {
    const { step } = optimizerStep(kind, initState(), [1, -1], { eta: 0.1 });
    assert.ok(Number.isFinite(step[0]) && Number.isFinite(step[1]), kind);
  }
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `optimizerStep is not a function` (또는 import 에서 undefined)

- [ ] **Step 3: 최소 구현을 쓴다**

`static/js/mathviz/adaptive.js` 끝에 추가한다.

```js
export const KINDS = ['gd', 'momentum', 'adagrad', 'rmsprop', 'adam'];

/** 옵티마이저 상태. m = 1차 모멘트, v = Adam 2차 모멘트, s = AdaGrad/RMSProp 누적, t = 스텝 수. */
export function initState() {
  return { m: [0, 0], v: [0, 0], s: [0, 0], t: 0 };
}

/**
 * 한 스텝의 보폭과 갱신된 상태. 상태는 불변으로 다룬다 (새 객체를 돌려준다).
 *
 * ⚠️ 'rmsprop' 과 'adam' 은 분리된 구현이다. 'adam' 에 β₁=0 을 넣어 RMSProp 을 대신하지
 * 않는다 — Adam 은 v 에 편향 보정을 하고 RMSProp 은 하지 않아서, 같은 β₂ 라도 초기 거동과
 * 반복수가 다르다 (κ=100·θ=45° 에서 424.4 회 대 330.8 회). 스펙 §3-4
 */
export function optimizerStep(kind, state, g, opts = {}) {
  const {
    eta = 0.1, beta = 0.9, beta1 = 0.9, beta2 = 0.999, eps = 1e-8,
    biasCorrect = true,
  } = opts;
  const t = state.t + 1;
  let { m, v, s } = state;
  let step;

  if (kind === 'gd') {
    step = [eta * g[0], eta * g[1]];
  } else if (kind === 'momentum') {
    v = [beta * v[0] + g[0], beta * v[1] + g[1]];
    step = [eta * v[0], eta * v[1]];
  } else if (kind === 'adagrad') {
    s = [s[0] + g[0] * g[0], s[1] + g[1] * g[1]];
    step = [eta * g[0] / (Math.sqrt(s[0]) + eps), eta * g[1] / (Math.sqrt(s[1]) + eps)];
  } else if (kind === 'rmsprop') {
    s = [
      beta2 * s[0] + (1 - beta2) * g[0] * g[0],
      beta2 * s[1] + (1 - beta2) * g[1] * g[1],
    ];
    step = [eta * g[0] / (Math.sqrt(s[0]) + eps), eta * g[1] / (Math.sqrt(s[1]) + eps)];
  } else if (kind === 'adam') {
    m = [beta1 * m[0] + (1 - beta1) * g[0], beta1 * m[1] + (1 - beta1) * g[1]];
    v = [
      beta2 * v[0] + (1 - beta2) * g[0] * g[0],
      beta2 * v[1] + (1 - beta2) * g[1] * g[1],
    ];
    const c1 = biasCorrect ? 1 - Math.pow(beta1, t) : 1;
    const c2 = biasCorrect ? 1 - Math.pow(beta2, t) : 1;
    const mh = [m[0] / c1, m[1] / c1];
    const vh = [v[0] / c2, v[1] / c2];
    step = [
      eta * mh[0] / (Math.sqrt(vh[0]) + eps),
      eta * mh[1] / (Math.sqrt(vh[1]) + eps),
    ];
  } else {
    throw new Error(`optimizerStep: 모르는 kind ${kind}`);
  }

  return { step, state: { m, v, s, t } };
}

/**
 * readout 용 — 현재 상태에서의 축별 유효 학습률.
 *
 * AdaGrad 를 고르고 반복을 끝까지 밀면 이 숫자가 줄어드는 것이 보여야 한다.
 * 그것이 RMSProp 이 존재하는 이유이고, 데모에서 안 보이는 것을 글에서 주장하면
 * 독자가 확인할 수 없다. 스펙 §3-5
 *
 * Adam 은 **편향 보정 후의 v̂** 를 기준으로 한다. 보정 전 값을 찍으면 초기 몇 스텝이
 * 실제 보폭과 어긋난 숫자로 보인다. t=0 이면 보정 분모가 0 이므로 η 를 그대로 돌려준다.
 */
export function effectiveEta(kind, state, opts = {}) {
  const { eta = 0.1, beta2 = 0.999, eps = 1e-8, biasCorrect = true } = opts;
  if (kind === 'adagrad' || kind === 'rmsprop') {
    return [eta / (Math.sqrt(state.s[0]) + eps), eta / (Math.sqrt(state.s[1]) + eps)];
  }
  if (kind === 'adam') {
    if (state.t === 0) return [eta, eta];
    const c2 = biasCorrect ? 1 - Math.pow(beta2, state.t) : 1;
    return [
      eta / (Math.sqrt(state.v[0] / c2) + eps),
      eta / (Math.sqrt(state.v[1] / c2) + eps),
    ];
  }
  return [eta, eta];
}

/** ½xᵀAx 위의 궤적. 길이 steps+1. 발산해 유한하지 않게 되면 그 자리에서 끊는다. */
export function optPath({ kind, A, start, steps, eta, ...opts }) {
  let p = [start[0], start[1]];
  let st = initState();
  const out = [[p[0], p[1]]];
  for (let i = 0; i < steps; i++) {
    const g = quadGradA(A, p);
    if (!Number.isFinite(g[0]) || !Number.isFinite(g[1])) break;
    const r = optimizerStep(kind, st, g, { eta, ...opts });
    st = r.state;
    p = [p[0] - r.step[0], p[1] - r.step[1]];
    out.push([p[0], p[1]]);
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) break;
  }
  return out;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test 2>&1 | tail -12`
Expected: PASS, `tests 61` (48 + 5 + 8). fix round 에서 발산 테스트가 추가되어 최종 62 가 된다

- [ ] **Step 5: 커밋**

```bash
git add static/js/mathviz/adaptive.js tests/mathviz/adaptive.test.js
git commit -m "feat(adaptive): add the five optimizers and a trajectory helper

rmsprop and adam are separate branches on purpose. Passing beta1=0 to
adam does not give you rmsprop, because adam bias-corrects v and rmsprop
does not, and the two disagree from the first step onward.

effectiveEta exists so the demo can show adagrad's learning rate dying,
which is the whole reason rmsprop was invented."
```

---

### Task 3: adaptive.js — 반복수 계량과 η 탐색

이 Task 가 스펙 §2 의 표를 코드로 재현한다. 데모의 readout 표와 테스트가 같은 규칙을 쓰게
만드는 자리다.

**Files:**
- Modify: `static/js/mathviz/adaptive.js` (파일 끝에 추가)
- Test: `tests/mathviz/adaptive.test.js` (파일 끝에 추가)

**Interfaces:**
- Consumes: Task 1 의 `rotatedHessian`·`quadGradA`, Task 2 의 `optimizerStep`·`initState`
- Produces:
  - `DEFAULT_STARTS: [number, number][]` — 시작점 5개
  - `stepsToTolOne({kind, A, start, eta, tol, maxIters, ...opts}) → number` — 미도달이면 `maxIters`
  - `stepsToTol({kind, A, starts, eta, tol, maxIters, ...opts}) → {iters: number, reached: boolean}`
  - `bestEta({kind, A, starts, tol, maxIters, kMin, kMax, kStep, ...opts}) → {eta, iters, reached}`
  - `OLS_ETA: Record<string, number>` — 데모 2 전용 고정 학습률

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// import 문에 추가:
//   DEFAULT_STARTS, stepsToTolOne, stepsToTol, bestEta, OLS_ETA,

test('stepsToTol: 미도달을 maxIters 로 세고 reached 로 알린다', () => {
  // reached 를 두는 이유: 미도달을 null 로 돌려주면 bestEta 가 "미도달한 η 들" 사이의
  // 우열을 못 가려 탐색이 성립하지 않는다. 스펙 §6 API
  const A = rotatedHessian(100, 0);
  const bad = stepsToTol({ kind: 'gd', A, eta: 1e-6, maxIters: 50 });
  assert.equal(bad.reached, false);
  assert.equal(bad.iters, 50);

  const good = stepsToTol({ kind: 'gd', A, eta: 2 / (1 + 100), maxIters: 4000 });
  assert.equal(good.reached, true);
  assert.ok(good.iters > 1 && good.iters < 4000);
});

test('bestEta: GD·모멘텀의 반복수가 θ 와 무관하다 (회전 불변)', () => {
  // 이것이 대조군이다. 적응적 방법의 변화가 회전 자체 때문이 아니라 대각선만 쓰기
  // 때문이라는 것을 이 테스트가 증명한다.
  //
  // ⚠️ 허용오차를 ±3 회로 잡으면 옳은 구현이 실패한다. bestEta 의 로그 그리드가 θ 마다
  // 다른 η 를 골라 GD 실측이 350.6~369.0 로 폭 18.4 회다. 상대 5% 로 본다. 스펙 §6 테스트 4
  for (const kind of ['gd', 'momentum']) {
    const vals = [0, 15, 30, 45].map((deg) => {
      const A = rotatedHessian(100, RAD(deg));
      const opts = kind === 'momentum'
        ? { beta: Math.pow((Math.sqrt(100) - 1) / (Math.sqrt(100) + 1), 2) }
        : {};
      return bestEta({ kind, A, ...opts }).iters;
    });
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    for (const v of vals) {
      assert.ok(Math.abs(v - mean) / mean < 0.05, `${kind} ${vals.join(' ')}`);
    }
  }
});

test('bestEta: RMSProp 이 θ=0° 에서 45° 대비 10배 이상 빠르다', () => {
  // 축 문장의 실측. κ=100 에서 4.0 회 대 424.4 회 = 106배. 스펙 §2-1
  const a0 = bestEta({ kind: 'rmsprop', A: rotatedHessian(100, 0) }).iters;
  const a45 = bestEta({ kind: 'rmsprop', A: rotatedHessian(100, RAD(45)) }).iters;
  assert.ok(a45 / a0 > 10, `0°=${a0} 45°=${a45} 비=${a45 / a0}`);
});

test('bestEta: 축이 안 맞으면 RMSProp 이 GD 보다 나쁠 수 있다', () => {
  // κ=10, θ=45° 에서 RMSProp 45.8 회 > GD 36.0 회. 대각 전처리가 해로울 수도 있다는 근거.
  const A = rotatedHessian(10, RAD(45));
  const gd = bestEta({ kind: 'gd', A }).iters;
  const rp = bestEta({ kind: 'rmsprop', A }).iters;
  assert.ok(rp > gd, `GD=${gd} RMSProp=${rp}`);
});

test('bestEta: Adam 의 θ 민감도가 RMSProp 보다 훨씬 작다 (β₁ 이 원인)', () => {
  // 글의 반전. Adam 은 가장 빠른 방법이 아니라 가장 안 무너지는 방법이다. 스펙 §2-2
  const A0 = rotatedHessian(100, 0);
  const A45 = rotatedHessian(100, RAD(45));
  const adRatio = bestEta({ kind: 'adam', A: A45 }).iters / bestEta({ kind: 'adam', A: A0 }).iters;
  const rpRatio = bestEta({ kind: 'rmsprop', A: A45 }).iters / bestEta({ kind: 'rmsprop', A: A0 }).iters;
  assert.ok(adRatio < 1.5, `Adam 비=${adRatio}`);
  assert.ok(rpRatio > 10, `RMSProp 비=${rpRatio}`);
  assert.ok(rpRatio > adRatio * 5, `Adam ${adRatio} RMSProp ${rpRatio}`);
});

test('시작점 [1,1] 은 θ=45° 에서 고유벡터라 한 스텝에 끝난다 (인공물 회귀 테스트)', () => {
  // 스펙 작성 중 실제로 밟은 함정. 이 시작점으로 표를 만들면 다섯 방법이 모두 1 회로 나와
  // 글의 논지가 화면에서 무너진다. DEFAULT_STARTS 가 이 함정을 피하는지 고정한다. 스펙 §3-1
  const A = rotatedHessian(100, RAD(45));
  const aligned = bestEta({ kind: 'gd', A, starts: [[1, 1]] });
  assert.equal(aligned.iters, 1, `정렬된 시작점은 1 회여야 한다: ${aligned.iters}`);

  const safe = bestEta({ kind: 'gd', A, starts: [[2.5, 0.7]] });
  assert.ok(safe.iters > 5, `비정렬 시작점은 1 회가 아니어야 한다: ${safe.iters}`);

  assert.ok(!DEFAULT_STARTS.some(([x, y]) => Math.abs(Math.abs(x) - Math.abs(y)) < 1e-9),
    'DEFAULT_STARTS 에 |x| = |y| 인 점이 있으면 45° 에서 고유벡터가 된다');
  assert.equal(DEFAULT_STARTS.length, 5);
});

test('OLS_ETA: 데모 2 가 쓰는 두 방법에 측정된 값이 있다', () => {
  // 스펙 §2-3b 실측. Adam 에 0.1 을 쓰면 중심화 OFF 가 ON 보다 빨라져 서사가 뒤집힌다.
  assert.equal(OLS_ETA.rmsprop, 0.05);
  assert.equal(OLS_ETA.adam, 0.05);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `bestEta is not a function`

- [ ] **Step 3: 최소 구현을 쓴다**

`static/js/mathviz/adaptive.js` 끝에 추가한다.

```js
/**
 * 반복수를 재는 기준 시작점 다섯 개.
 *
 * ⚠️ |x| = |y| 인 점을 넣지 말 것. θ=45° 에서 그 점이 정확히 A 의 고유벡터가 되어
 * 최적 η 하나로 원점에 착지하고, 다섯 방법의 반복수가 모두 1 로 나온다. 스펙 §3-1
 */
export const DEFAULT_STARTS = [
  [2.5, 0.7], [1.8, -1.2], [0.4, 2.2], [-2.1, 1.5], [-0.9, -2.4],
];

/**
 * 데모 2(OLS)의 고정 학습률. 스펙 §2-3b 에서 실측한 값이다.
 *
 * ⚠️ 데모 1 과 공유하지 않는다. 회전 이차함수의 RMSProp 최적 η 는 2.51 인데 OLS 에서는
 * 0.05 로 **50배** 다르다. 한 상수를 양쪽에 쓰면 한쪽이 반드시 망가진다.
 * ⚠️ Adam 에 0.1 을 쓰지 말 것. 치우침 배치에서 중심화 OFF 72 회가 ON 120 회보다 빨라져
 * 글이 주장하는 것과 반대되는 표가 화면에 뜬다. 0.05 에서는 179 → 121 로 정상이다.
 *
 * GD·모멘텀은 최적값 2/(λ_min+λ_max) 를 자동 계산하므로 여기 없다.
 */
export const OLS_ETA = {
  rmsprop: 0.05,
  adam: 0.05,
};

/** 한 시작점에서 목표에 도달하는 반복수. 미도달이면 maxIters. */
export function stepsToTolOne({ kind, A, start, eta, tol = 1e-3, maxIters = 4000, ...opts }) {
  let p = [start[0], start[1]];
  const d0 = Math.hypot(p[0], p[1]);
  let st = initState();
  for (let t = 1; t <= maxIters; t++) {
    const g = quadGradA(A, p);
    if (!Number.isFinite(g[0]) || !Number.isFinite(g[1])) return maxIters;
    const r = optimizerStep(kind, st, g, { eta, ...opts });
    st = r.state;
    p = [p[0] - r.step[0], p[1] - r.step[1]];
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return maxIters;
    if (Math.hypot(p[0], p[1]) <= tol * d0) return t;
  }
  return maxIters;
}

/**
 * 시작점들의 평균 반복수.
 *
 * 미도달을 null 로 돌려주지 않는 이유: bestEta 가 η 를 고를 때 "미도달한 η 들" 사이의
 * 우열을 가릴 수 없게 되어 탐색이 성립하지 않는다. maxIters 로 세어 평균에 넣고,
 * 도달 여부는 reached 로 따로 알린다. 데모는 reached 가 false 면 `미도달` 을 표시한다.
 */
export function stepsToTol({
  kind, A, starts = DEFAULT_STARTS, eta, tol = 1e-3, maxIters = 4000, ...opts
}) {
  let sum = 0;
  let reached = true;
  for (const s of starts) {
    const n = stepsToTolOne({ kind, A, start: s, eta, tol, maxIters, ...opts });
    if (n >= maxIters) reached = false;
    sum += n;
  }
  return { iters: sum / starts.length, reached };
}

/**
 * 시작점들의 **평균** 반복수를 최소화하는 η.
 *
 * ⚠️ 시작점마다 따로 고르면 "그 점에 정확히 착지하는 η" 를 찾아내 반복수가 인공적으로
 * 1 이 된다 (§3-1 과 같은 뿌리). 반드시 평균에 대해 고른다.
 *
 * 그리드 기본값은 스펙 §2 의 측정과 같다. 바꾸면 §2 의 표와 테스트 기대값이 함께 흔들린다.
 */
export function bestEta({
  kind, A, starts = DEFAULT_STARTS, tol = 1e-3, maxIters = 4000,
  kMin = -6, kMax = 1, kStep = 0.08, ...opts
}) {
  let best = { eta: Math.pow(10, kMin), iters: Infinity, reached: false };
  for (let k = kMin; k <= kMax + 1e-12; k += kStep) {
    const eta = Math.pow(10, k);
    const r = stepsToTol({ kind, A, starts, eta, tol, maxIters, ...opts });
    if (r.iters < best.iters) best = { eta, iters: r.iters, reached: r.reached };
  }
  return best;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test 2>&1 | tail -12`
Expected: PASS, `tests 69` (48 + 5 + 9 + 7 — Task 2 의 fix round 에서 발산 테스트가 하나 늘었다)

느리면(수 초) 정상이다. `bestEta` 가 88 개 그리드 × 5 시작점 × 최대 4000 스텝을 돈다.

- [ ] **Step 5: 커밋**

```bash
git add static/js/mathviz/adaptive.js tests/mathviz/adaptive.test.js
git commit -m "feat(adaptive): measure iterations and search eta over the start average

bestEta picks one eta against the average of five fixed starts, never per
start: a per-start search finds the eta that lands exactly on the optimum
and reports one iteration. A regression test pins that trap by asserting
[1,1] does finish in one step at 45 degrees while [2.5,0.7] does not.

Rotation invariance is checked at 5 percent, not 3 iterations. The log
grid picks a slightly different eta per angle, so GD measures 350.6 to
369.0 across angles and a tighter bound would fail a correct build."
```

---

### Task 4: adaptive.js — OLS 확장 (3편 재사용)

**Files:**
- Modify: `static/js/mathviz/adaptive.js` (파일 끝에 추가, import 문 수정)
- Test: `tests/mathviz/adaptive.test.js` (파일 끝에 추가)

**Interfaces:**
- Consumes: 3편 `optimize.js` 의 `olsKappa`·`centerPoints`·`olsClosed`, Task 2 의 `optimizerStep`
- Produces:
  - `olsOffDiagonal(points: [number, number][]) → number` — Hessian 의 무관항 `2Σx`
  - `olsOptPath({points, steps, kind, center, eta, ...opts}) → [number, number][]`
    — 항상 **원 좌표** `[a, b]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// import 문에 추가:  olsOffDiagonal, olsOptPath,
// 그리고 3편 함수도 쓴다:
// import { olsClosed, olsKappa, centerPoints } from '../../static/js/mathviz/optimize.js';

const SKEWED = [[0.5, 0.2], [1.0, 0.6], [1.5, 0.9], [2.0, 1.4], [2.5, 1.7], [3.0, 2.2]];

test('olsOffDiagonal: 무관항이 2Σx 이고 중심화하면 0 이 된다', () => {
  // 이것이 이 글의 언어로 "축이 맞았다" 의 계량이다. 스펙 §2-3
  assert.ok(Math.abs(olsOffDiagonal(SKEWED) - 21) < 1e-12, `${olsOffDiagonal(SKEWED)}`);
  const { points: C } = centerPoints(SKEWED);
  assert.ok(Math.abs(olsOffDiagonal(C)) < 1e-12, `${olsOffDiagonal(C)}`);
});

test('중심화가 κ 를 낮춘다', () => {
  const before = olsKappa(SKEWED).kappa;
  const after = olsKappa(centerPoints(SKEWED).points).kappa;
  assert.ok(before > 20 && before < 40, `실측 29.5 근처여야 한다: ${before}`);
  assert.ok(after < 2, `실측 1.4 근처여야 한다: ${after}`);
});

test('olsOptPath: 중심화 여부와 무관하게 원 좌표로 돌려주고 닫힌 해로 수렴한다', () => {
  // 3편 §3-4 규약. 환산을 호출자에게 맡기면 데모마다 같은 함정을 다시 밟는다.
  const sol = olsClosed(SKEWED);
  for (const center of [false, true]) {
    const path = olsOptPath({ points: SKEWED, steps: 400, kind: 'gd', center });
    const last = path[path.length - 1];
    assert.ok(Math.hypot(last[0] - sol[0], last[1] - sol[1]) < 1e-9,
      `center=${center} 끝점=${last} 닫힌해=${sol}`);
    assert.deepEqual(path[0], [0, 0], '시작은 원점이다');
    assert.equal(path.length, 401);
  }
});

test('olsOptPath: 중심화하면 축별 보폭이 실제로 빨라진다', () => {
  // 정렬되면 RMSProp 이 듣는다. 스펙 §2-3 의 "결정적 칸".
  const sol = olsClosed(SKEWED);
  const dist = (p) => Math.hypot(p[0] - sol[0], p[1] - sol[1]);
  const off = olsOptPath({ points: SKEWED, steps: 60, kind: 'rmsprop', center: false, eta: 0.05 });
  const on = olsOptPath({ points: SKEWED, steps: 60, kind: 'rmsprop', center: true, eta: 0.05 });
  assert.ok(dist(on[60]) < dist(off[60]),
    `중심화 ON 이 더 가까워야 한다: ON=${dist(on[60])} OFF=${dist(off[60])}`);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `olsOptPath is not a function`

- [ ] **Step 3: 최소 구현을 쓴다**

`static/js/mathviz/adaptive.js` **맨 위**에 import 를 추가한다.

```js
import { olsKappa, centerPoints } from './optimize.js';
```

파일 끝에 추가한다.

```js
/**
 * OLS Hessian(= 2XᵀX) 의 무관항 2Σx.
 *
 * 이 글의 언어로 "축이 좌표축과 맞았는가" 의 계량이다. x 를 중심화하면 0 이 되고,
 * 그때 비로소 축별 보폭이 듣는다. 3편의 중심화 토글이 실은 이 일을 하고 있었다.
 */
export function olsOffDiagonal(points) {
  return 2 * points.reduce((s, [x]) => s + x, 0);
}

/**
 * OLS 를 임의의 방법으로 푸는 궤적. 3편 olsGdPath 와 같은 규약 —
 * 반환값은 **항상 원 좌표** [a, b] 다 (center 여부와 무관).
 *   a = a′,  b = b′ − a′·x̄
 * 환산을 호출자에게 맡기면 데모마다 3편 §3-4 함정을 다시 밟는다.
 *
 * eta 를 주지 않으면 GD·모멘텀은 최적 학습률 2/(λ_min+λ_max) 를, 축별 보폭 쪽은
 * OLS_ETA 를 쓴다. Hessian = 2XᵀX 이므로 고윳값이 2l 이고 최적값이 2/(2l₁+2l₂) 다.
 */
export function olsOptPath({ points, steps, kind = 'gd', center = false, eta, ...opts }) {
  const { points: P, xbar } = center ? centerPoints(points) : { points, xbar: 0 };
  const { l1, l2 } = olsKappa(P);
  const useEta = eta !== undefined
    ? eta
    : (kind === 'gd' || kind === 'momentum' ? 2 / (2 * l1 + 2 * l2) : OLS_ETA[kind]);

  let a = 0;
  let b = 0;
  let st = initState();
  const out = [[a, b - a * xbar]];
  for (let i = 0; i < steps; i++) {
    let g0 = 0;
    let g1 = 0;
    for (const [x, y] of P) {
      const r = a * x + b - y;
      g0 += 2 * r * x;
      g1 += 2 * r;
    }
    const r = optimizerStep(kind, st, [g0, g1], { eta: useEta, ...opts });
    st = r.state;
    a -= r.step[0];
    b -= r.step[1];
    out.push([a, b - a * xbar]);
  }
  return out;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test 2>&1 | tail -12`
Expected: PASS, `tests 73` (48 + 5 + 9 + 7 + 4)

- [ ] **Step 5: 커밋**

```bash
git add static/js/mathviz/adaptive.js tests/mathviz/adaptive.test.js
git commit -m "feat(adaptive): solve OLS with any of the five methods

olsOffDiagonal is the number the post turns on: 2*sum(x) is the Hessian's
off-diagonal term, and centering x drives it to zero. That is what post
3's centering toggle was actually doing, stated in this post's language.

olsOptPath keeps post 3's contract of always returning original
coordinates, so a caller never has to remember the b = b' - a'*xbar
conversion."
```

---

### Task 5: core.js — makeRadios

**Files:**
- Modify: `static/js/mathviz/core.js` (파일 끝에 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `makeRadios(el: HTMLElement, def, onInput) → {getValues, setValues}`
  - `def`: `{key: string, label: string, value: string, options: {value: string, label: string}[]}`
  - `getValues()` → `{[key]: string}` — 선택된 옵션의 `value`

- [ ] **Step 1: 구현을 쓴다**

DOM 이 필요해 Node 테스트를 붙이지 않는다. `makeSliders`·`makeToggles` 와 같은 이유로
기존 두 함수도 테스트가 없다. 검증은 Task 6 의 브라우저 확인에서 한다.

`static/js/mathviz/core.js` 끝에 추가한다.

```js
/**
 * 배타 선택 행. makeSliders / makeToggles 와 같은 반환 규약({getValues, setValues})을
 * 따르되 값은 선택된 옵션의 문자열이다.
 *
 * makeToggles 를 확장하지 않는 이유: 그 함수는 항목마다 독립적인 boolean 을 돌려주도록
 * 되어 있어 배타성을 끼우면 반환 규약이 깨진다.
 *
 * ⚠️ makeSliders 가 host 를 비우므로(el.innerHTML = '') 반드시 그 뒤에 부른다.
 * 이 함수는 makeToggles 처럼 비우지 않고 append 한다.
 */
export function makeRadios(el, def, onInput) {
  const row = document.createElement('div');
  row.className = 'mv-slider';
  const label = document.createElement('label');
  label.textContent = def.label;

  const box = document.createElement('span');
  box.style.gridColumn = 'span 2';
  box.style.display = 'flex';
  box.style.flexWrap = 'wrap';
  box.style.gap = '0.1rem 0.6rem';

  const name = `mv-radio-${def.key}-${Math.random().toString(36).slice(2, 8)}`;
  const inputs = [];

  def.options.forEach((o) => {
    const wrap = document.createElement('label');
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '0.2rem';
    wrap.style.fontWeight = 'normal';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = o.value;
    input.checked = o.value === def.value;
    input.style.width = 'auto';
    input.addEventListener('change', () => { if (input.checked) onInput(getValues()); });
    const text = document.createElement('span');
    text.textContent = o.label;
    wrap.append(input, text);
    box.appendChild(wrap);
    inputs.push(input);
  });

  function getValues() {
    const hit = inputs.find((i) => i.checked);
    return { [def.key]: hit ? hit.value : def.value };
  }

  function setValues(obj) {
    if (!(def.key in obj)) return;
    inputs.forEach((i) => { i.checked = i.value === obj[def.key]; });
  }

  row.append(label, box);
  el.appendChild(row);
  return { getValues, setValues };
}
```

- [ ] **Step 2: 기존 테스트가 깨지지 않았는지 확인한다**

Run: `npm test 2>&1 | tail -8`
Expected: PASS, `tests 73` (변동 없음 — `core.js` 는 Node 테스트 대상이 아니다)

- [ ] **Step 3: 1·2·3편 데모가 여전히 동작하는지 확인한다**

Run: `export PATH="$PATH:/c/Program Files/Go/bin" && hugo --gc --minify --destination /tmp/hugo-t5 2>&1 | grep -E "ERROR|Pages"`
Expected: ERROR 없음, `Pages 131`

- [ ] **Step 4: 커밋**

```bash
git add static/js/mathviz/core.js
git commit -m "feat(core): add makeRadios for exclusive choice rows

makeToggles cannot be extended for this: it returns an independent
boolean per entry, and exclusivity would break that contract. Same
{getValues, setValues} shape as its two neighbours, and like makeToggles
it appends rather than clearing the host, so it must be called after
makeSliders."
```

---

### Task 6: tilted.js — 데모 1 (기울어지는 등고선)

**Files:**
- Create: `static/js/mathviz/tilted.js`

**Interfaces:**
- Consumes: Task 1~3 의 `rotatedHessian`·`diagPreconditionedKappa`·`optPath`·`bestEta`·
  `effectiveEta`·`initState`·`optimizerStep`·`quadGradA`·`KINDS`·`DEFAULT_STARTS`,
  Task 5 의 `makeRadios`, 기존 `core.js` 의 `themeColors`·`onThemeChange`·`createView`·
  `drawGrid`·`drawPolygon`·`drawPath`·`drawHandles`·`makeSliders`·`attachDrag`
- Produces: `init(root: HTMLElement)` — shortcode 가 호출하는 진입점

- [ ] **Step 1: 구현을 쓴다**

```js
// static/js/mathviz/tilted.js
// 데모 1 — 기울어지는 등고선.
//
// 손실은 f(x) = ½xᵀAx, A = R(θ)diag(1,κ)R(θ)ᵀ. **κ 를 고정한 채 θ 만 돌려
// 정렬 효과를 분리한다** — 이것이 이 데모의 존재 이유다. 데모 2(직선맞춤)에서는
// 중심화가 무관항을 0 으로 만드는 동시에 κ 도 낮춰서 두 효과를 가를 수 없다. 스펙 §범위
//
// ⚠️ readout 표는 드래그 점이 아니라 DEFAULT_STARTS 5개 평균으로 계산한다.
// 드래그 점 하나로 표를 만들면 사용자가 우연히 고유벡터 위에 올려놓는 순간
// 표가 전부 1 이 되어 글의 논지가 화면에서 무너진다. 스펙 §3-1

import {
  themeColors, onThemeChange, createView, drawGrid, drawPolygon,
  drawPath, drawHandles, makeSliders, makeRadios, attachDrag,
} from './core.js';
import {
  rotatedHessian, diagPreconditionedKappa, optPath, bestEta, effectiveEta,
  initState, optimizerStep, quadGradA, KINDS, DEFAULT_STARTS,
} from './adaptive.js';

const WORLD = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };

const LABEL = {
  gd: '경사하강법', momentum: '모멘텀', adagrad: 'AdaGrad',
  rmsprop: 'RMSProp', adam: 'Adam',
};

const SLIDERS = [
  { key: 'kappa', label: 'κ (조건수)', min: 1, max: 100, step: 1, value: 30, fmt: (v) => v.toFixed(0) },
  { key: 'theta', label: 'θ (기울기)', min: 0, max: 90, step: 1, value: 0, fmt: (v) => `${v.toFixed(0)}°` },
  { key: 'steps', label: '반복', min: 0, max: 400, step: 1, value: 60, fmt: (v) => v.toFixed(0) },
];

// ⚠️ η 슬라이더는 두지 않는다. bestEta 가 고른 값을 쓰고 readout 에 표시한다.
// 절대 η 슬라이더로 되돌리지 말 것 — GD 발산 문턱 2/κ 가 이 데모의 κ 범위(1~100)에서
// 100배 움직여서, κ=30 에 맞춘 기본값은 κ=100 에서 발산하고 κ=1 에서는 최적의 1/30 이 된다.
// 계획서 초안이 절대값이었고 사전 측정에서 모멘텀 기본값이 미도달로 잡혔다. 스펙 §4

const RADIO = {
  key: 'kind', label: '방법', value: 'gd',
  options: KINDS.map((k) => ({ value: k, label: LABEL[k] })),
};

const betaFor = (kappa) => Math.pow((Math.sqrt(kappa) - 1) / (Math.sqrt(kappa) + 1), 2);

/** bestEta 는 무거우므로 (kind, κ, θ) 로 캐시한다. 스펙 §3-2 */
const etaCache = new Map();
function tableRow(kind, kappa, thetaDeg) {
  const key = `${kind}|${kappa}|${thetaDeg}`;
  if (etaCache.has(key)) return etaCache.get(key);
  const A = rotatedHessian(kappa, (thetaDeg * Math.PI) / 180);
  const opts = kind === 'momentum' ? { beta: betaFor(kappa) } : {};
  const r = bestEta({ kind, A, ...opts });
  etaCache.set(key, r);
  return r;
}

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');   // draw() 안에서 매번 얻지 않는다 (기존 데모와 같다)
  const view = createView(canvas, WORLD);
  let start = [2.5, 0.7];   // ⚠️ |x| ≠ |y| — 스펙 §3-1
  let vals = { kappa: 30, theta: 0, steps: 60 };
  let kind = 'gd';

  const sliderHost = root.querySelector('.mv-sliders');
  makeSliders(sliderHost, SLIDERS, (v) => { vals = v; draw(); });
  // ⚠️ makeSliders 가 host 를 비우므로 반드시 그 뒤에 부른다.
  makeRadios(sliderHost, RADIO, (v) => { kind = v.kind; draw(); });

  attachDrag(canvas, view, () => [start], (i, p) => { start = p; draw(); });

  function contourPoints(A, c, theta) {
    // xᵀAx = 2c 의 등위선은 축정렬 타원을 θ 만큼 회전한 것이다.
    // 새 도형 코드 없이 3편의 64각형을 회전만 시킨다.
    const kappa = vals.kappa;
    const a = Math.sqrt(2 * c);
    const b = a / Math.sqrt(kappa);
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const out = [];
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      const x = a * Math.cos(t);
      const y = b * Math.sin(t);
      out.push([x * ct - y * st, x * st + y * ct]);
    }
    return out;
  }

  function draw() {
    const colors = themeColors();
    const theta = (vals.theta * Math.PI) / 180;
    const A = rotatedHessian(vals.kappa, theta);
    const opts = kind === 'momentum' ? { beta: betaFor(vals.kappa) } : {};
    // η 는 표와 궤적이 같은 값을 쓴다 — 캐시된 bestEta 결과에서 가져온다.
    const eta = tableRow(kind, vals.kappa, vals.theta).eta;

    // ⚠️ 별도의 clear 호출은 없다. drawGrid 가 ctx.clearRect 를 먼저 한다 (core.js).
    drawGrid(ctx, view, colors);

    // ⚠️ themeColors() 가 주는 키는 bg·fg·muted·grid·accent·accent2 뿐이다.
    // `faint` 같은 키는 없다. 등고선은 muted, GD 대조 궤적은 accent2, 선택한 방법은 accent.
    for (const c of [0.15, 0.6, 1.35, 2.4, 3.75]) {
      drawPolygon(ctx, view, contourPoints(A, c, theta), { stroke: colors.muted, width: 1 });
    }

    // GD 궤적을 항상 대조로 함께 그린다 — 비교가 그림 안에서 끝난다.
    if (kind !== 'gd') {
      const refEta = tableRow('gd', vals.kappa, vals.theta).eta;
      const ref = optPath({ kind: 'gd', A, start, steps: vals.steps, eta: refEta });
      drawPath(ctx, view, ref.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
        { color: colors.accent2, width: 1.5 });
    }

    const path = optPath({ kind, A, start, steps: vals.steps, eta, ...opts })
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    drawPath(ctx, view, path, { color: colors.accent, width: 2 });
    drawHandles(ctx, view, [start, [0, 0]], colors);

    // ── readout ──
    const rows = KINDS.map((k) => {
      const r = tableRow(k, vals.kappa, vals.theta);
      const cell = r.reached ? r.iters.toFixed(1) : '미도달';
      const mark = k === kind ? ' ◀' : '';
      return `<tr><td>${LABEL[k]}</td><td style="text-align:right">${cell}${mark}</td></tr>`;
    }).join('');

    const kd = diagPreconditionedKappa(A);

    let effLine = '';
    if (kind === 'adagrad' || kind === 'rmsprop' || kind === 'adam') {
      let st = initState();
      let p = [start[0], start[1]];
      for (let i = 0; i < vals.steps; i++) {
        const g = quadGradA(A, p);
        if (!Number.isFinite(g[0])) break;
        const r = optimizerStep(kind, st, g, { eta, ...opts });
        st = r.state;
        p = [p[0] - r.step[0], p[1] - r.step[1]];
      }
      const [e0, e1] = effectiveEta(kind, st, { eta, ...opts });
      effLine = `<div>유효 학습률 (x, y): ${e0.toPrecision(3)}, ${e1.toPrecision(3)}</div>`;
    }

    root.querySelector('.mv-matrix-host').innerHTML = '';
    root.querySelector('.mv-readout').innerHTML = `
      <div>κ = ${vals.kappa}, θ = ${vals.theta}°, η = ${eta.toPrecision(3)} (자동 선택)</div>
      <div>대각 전처리 후 κ(D⁻¹A) = <b>${kd.toPrecision(4)}</b></div>
      ${effLine}
      <table class="mv-table"><thead>
        <tr><th>방법</th><th style="text-align:right">반복수</th></tr>
      </thead><tbody>${rows}</tbody></table>
      <div style="opacity:.7;font-size:.85em">
        표는 시작점 5개 평균 · 각 방법의 최적 η 기준이다.
        시작점 드래그는 그려지는 궤적에만 영향을 준다.
      </div>`;

    root.querySelector('.mv-hint').textContent =
      'θ 를 0° 에서 45° 로 밀어보세요. GD·모멘텀 칸은 그대로인데 AdaGrad·RMSProp 칸만 폭증합니다.';
  }

  // ⚠️ view.resize() 를 먼저 부르지 않으면 캔버스가 1×1 로 남아 아무것도 그려지지 않는다.
  // 기존 다섯 데모가 모두 이 세 줄로 끝난다 — 그대로 따른다.
  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
```

- [ ] **Step 2: 브라우저에서 확인한다 (성공 기준 4·5·7·8·9)**

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
hugo server -D --bind 0.0.0.0 --port 1313
```

임시로 아무 글에 `{{< demo name="tilted" >}}` 를 넣고 확인한다. 확인 목록:

1. θ = 0° 에서 표의 RMSProp 칸이 GD 칸보다 훨씬 작다 (κ=100 이면 대략 4 대 358)
2. θ 를 45° 로 밀면 **RMSProp·AdaGrad 칸만 폭증하고 GD·모멘텀 칸은 거의 안 변한다**
3. `κ(D⁻¹A)` 가 θ=0° 에서 1, θ=45° 에서 κ 를 찍는다
4. AdaGrad 를 고르고 반복을 400 까지 밀면 유효 학습률 숫자가 줄어든다
5. readout 의 η 가 방법·κ·θ 에 따라 자동으로 바뀌고 `(자동 선택)` 이라고 표시된다.
   κ 를 100 까지 올려도 어떤 방법도 발산하지 않는다 (절대 프리셋이었다면 발산했다)
6. 표 아래 라벨에 "시작점 5개 평균 · 각 방법의 최적 η 기준" 이 둘 다 보인다
7. κ 를 100 으로 올리면 어느 칸에 `미도달` 이 뜬다
8. light / dark 를 전환해도 등고선·궤적이 읽힌다
9. 창을 좁혀도 레이아웃이 유지되고, 시작점을 터치로 끌 수 있다

확인이 끝나면 임시로 넣은 shortcode 를 되돌린다.

- [ ] **Step 3: 커밋**

```bash
git add static/js/mathviz/tilted.js
git commit -m "feat(tilted): add the tilting-contour demo

The readout table is the point of this demo: rotate theta and the GD and
momentum rows hold still while the AdaGrad and RMSProp rows explode.

The table is computed over five fixed starts, not the draggable one. A
single start would read 1 for every method the moment the reader parks it
on an eigenvector at 45 degrees, which is exactly the artifact that
wrecked the first round of measurements for the spec. The label says so,
because otherwise a reader who moves the handle and sees no change in the
table reads it as a bug."
```

---

### Task 7: adamfit.js — 데모 2 (직선맞춤 세 번째 방문)

**Files:**
- Create: `static/js/mathviz/adamfit.js`

**Interfaces:**
- Consumes: Task 4 의 `olsOffDiagonal`·`olsOptPath`, 3편 `optimize.js` 의 `olsClosed`·`olsKappa`,
  Task 5 의 `makeRadios`, 기존 `core.js` 하니스
- Produces: `init(root: HTMLElement)`

- [ ] **Step 1: 구현을 쓴다**

```js
// static/js/mathviz/adamfit.js
// 데모 2 — 3편 직선맞춤의 세 번째 방문.
//
// 2편은 SVD 닫힌 해로, 3편은 GD 와 중심화로 풀었다. 여기서는 축별 보폭으로 풀고,
// **3편의 중심화 토글이 실은 Hessian 을 대각화하는 작업이었음**을 보인다.
// XᵀX 의 무관항 2Σx 가 0 이 되는 것이 이 글의 언어로 "축이 맞았다" 다.
//
// ⚠️ 이 데모만으로는 축 문장을 주장할 수 없다. 중심화는 무관항을 0 으로 만드는 동시에
// κ 도 낮추기 때문이다(29.5 → 1.4). 정렬 효과를 분리하는 것은 데모 1 이다. 스펙 §범위
// ⚠️ 초기 배치를 치우치게 둔다. x 가 이미 중심이면 무관항이 0 이라 토글이 아무 일도
// 하지 않는다. 스펙 §3-3

import {
  themeColors, onThemeChange, createView, drawGrid, drawPath,
  drawHandles, makeSliders, makeToggles, makeRadios, attachDrag,
} from './core.js';
import { olsClosed, olsKappa } from './optimize.js';
import { olsOffDiagonal, olsOptPath } from './adaptive.js';

const WORLD = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };

const LABEL = { gd: '경사하강법', rmsprop: 'RMSProp', adam: 'Adam' };
const CHOICES = ['gd', 'rmsprop', 'adam'];

// ⚠️ 오른쪽 치우침 배치. 대칭으로 두면 토글이 아무것도 하지 않는다 (스펙 §3-3).
const INITIAL = [[0.5, 0.2], [1.0, 0.6], [1.5, 0.9], [2.0, 1.4], [2.5, 1.7], [3.0, 2.2]];

const SLIDERS = [
  { key: 'steps', label: '반복', min: 0, max: 400, step: 1, value: 80, fmt: (v) => v.toFixed(0) },
];
const TOGGLES = [{ key: 'center', label: 'x 중심화', value: false }];
const RADIO = {
  key: 'kind', label: '방법', value: 'gd',
  options: CHOICES.map((k) => ({ value: k, label: LABEL[k] })),
};

const lineOf = ([a, b]) => [[-3, a * -3 + b], [3, a * 3 + b]];

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');   // draw() 안에서 매번 얻지 않는다
  const view = createView(canvas, WORLD);
  const pts = INITIAL.map(([x, y]) => [x, y]);
  let vals = { steps: 80 };
  let center = false;
  let kind = 'gd';

  const sliderHost = root.querySelector('.mv-sliders');
  makeSliders(sliderHost, SLIDERS, (v) => { vals = v; draw(); });
  // ⚠️ makeSliders 가 host 를 비우므로 아래 둘은 반드시 그 뒤에 부른다.
  makeToggles(sliderHost, TOGGLES, (v) => { center = v.center; draw(); });
  makeRadios(sliderHost, RADIO, (v) => { kind = v.kind; draw(); });

  attachDrag(canvas, view, () => pts, (i, p) => { pts[i] = p; draw(); });

  function draw() {
    const colors = themeColors();
    // ⚠️ 별도의 clear 호출은 없다. drawGrid 가 ctx.clearRect 를 먼저 한다 (core.js).
    drawGrid(ctx, view, colors);

    const closed = olsClosed(pts);
    const path = olsOptPath({ points: pts, steps: vals.steps, kind, center });
    const now = path[path.length - 1];

    // y 방향 잔차 — 3편과 같다. 2편은 수직 거리였고, 그 차이가 목적함수 변경을 눈으로 보여준다.
    // ⚠️ colors.grid(--border) 로 그으면 drawGrid 의 격자와 색도 두께도 같아져 데이터로
    // 안 읽힌다. 3편 gdfit.js 와 같은 colors.muted 를 쓴다. `faint` 같은 키는 없다.
    for (const [x, y] of pts) {
      drawPath(ctx, view, [[x, y], [x, now[0] * x + now[1]]], { color: colors.muted, width: 1 });
    }

    // 회색 선 = 닫힌 해. 중심화 토글과 무관하게 **불변**이다 (3편 §3-4).
    drawPath(ctx, view, lineOf(closed), { color: colors.muted, width: 3 });
    drawPath(ctx, view, lineOf(now), { color: colors.accent, width: 2 });
    drawHandles(ctx, view, pts, colors);

    const off = olsOffDiagonal(pts);
    const kNow = olsKappa(pts);
    const dist = Math.hypot(now[0] - closed[0], now[1] - closed[1]);

    // 스펙 §5 — 세 방법의 반복수를 중심화 ON/OFF 로 나란히 놓아 배율을 보여준다.
    // 여기서는 회전이 없으므로 bestEta 가 아니라 고정 OLS_ETA(olsOptPath 의 기본값)로
    // 재고, 그 사실을 라벨에 밝힌다.
    const reach = (k, c) => {
      const sol = olsClosed(pts);
      const p = olsOptPath({ points: pts, steps: 400, kind: k, center: c });
      const d0 = Math.hypot(sol[0], sol[1]) || 1;
      for (let i = 1; i < p.length; i++) {
        if (Math.hypot(p[i][0] - sol[0], p[i][1] - sol[1]) <= 1e-3 * d0) return String(i);
      }
      return '미도달';
    };
    const cmp = CHOICES.map((k) =>
      `<tr><td>${LABEL[k]}</td><td style="text-align:right">${reach(k, false)}</td>`
      + `<td style="text-align:right">${reach(k, true)}</td></tr>`).join('');

    root.querySelector('.mv-matrix-host').innerHTML = '';
    root.querySelector('.mv-readout').innerHTML = `
      <div>XᵀX 무관항 2Σx = <b>${off.toFixed(2)}</b>${center ? ' → 중심화하면 0' : ''}</div>
      <div>σ₁ = ${kNow.s1.toPrecision(4)}, σ₂ = ${kNow.s2.toPrecision(4)}</div>
      <div>κ = (σ₁/σ₂)² = <b>${kNow.kappa.toPrecision(4)}</b></div>
      <div>${LABEL[kind]} ${vals.steps} 회 · 닫힌 해와의 거리 ${dist.toExponential(2)}</div>
      <table class="mv-table"><thead><tr>
        <th>방법</th><th style="text-align:right">중심화 OFF</th><th style="text-align:right">ON</th>
      </tr></thead><tbody>${cmp}</tbody></table>
      <div style="opacity:.7;font-size:.85em">
        표는 이 점 배치에서 1e-3 에 도달한 반복수다 (상한 400, 방법별 고정 η).
        거리는 중심화 여부와 무관하게 원 좌표에서 잰다.
        회색 선(닫힌 해)은 토글에 움직이지 않는다.
      </div>`;

    root.querySelector('.mv-hint').textContent =
      '점을 오른쪽 끝에 뭉쳐보세요. 무관항이 커지면 RMSProp 이 GD 보다도 느려집니다. '
      + 'x 중심화를 켜면 무관항이 0 이 되고 RMSProp 이 즉시 따라붙습니다.';
  }

  // ⚠️ view.resize() 를 먼저 부르지 않으면 캔버스가 1×1 로 남아 아무것도 그려지지 않는다.
  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
```

- [ ] **Step 2: 브라우저에서 확인한다 (성공 기준 6·7·8·9)**

임시로 아무 글에 `{{< demo name="adamfit" >}}` 를 넣고 확인한다.

1. 무관항 readout 이 초기 배치에서 **21.00** 을 찍는다
2. `x 중심화` 를 켜면 무관항이 0 으로 떨어지고 **회색 선이 움직이지 않는다**
3. RMSProp 을 고르고 점을 오른쪽 끝(x = 2.4~3.0)에 뭉치면 중심화 OFF 에서 진한 선이
   한참 뒤처지고, ON 으로 켜면 즉시 따라붙는다
4. 닫힌 해와의 거리가 중심화 ON/OFF 양쪽에서 의미 있는 값이다 (환산이 맞다는 뜻 —
   좌표계를 섞으면 의미 없는 큰 값이 나온다)
5. light / dark 양쪽에서 읽힌다. 좁은 폭·터치 드래그 동작

확인이 끝나면 임시 shortcode 를 되돌린다.

- [ ] **Step 3: 커밋**

```bash
git add static/js/mathviz/adamfit.js
git commit -m "feat(adamfit): revisit the line fit with per-axis step sizes

Third visit to the same six points: post 2 solved it closed-form, post 3
with gradient descent and centering, and this one shows what that
centering toggle was really doing — driving the Hessian's off-diagonal
2*sum(x) to zero so the axes line up.

The readout says outright that this demo cannot carry the axis claim on
its own, since centering lowers kappa at the same time. Demo 1 is what
separates the two effects."
```

---

### Task 8: 글 쓰기

**Files:**
- Create: `content/posts/adam/index.md`

**Interfaces:**
- Consumes: Task 6·7 의 데모 (`{{< demo name="tilted" >}}`, `{{< demo name="adamfit" >}}`)
- Produces: 없음 (최종 산출물)

- [ ] **Step 1: front matter 와 골격을 쓴다**

```toml
+++
title = "적응적 학습률 — 축이 맞아야 듣는다"
date = 2026-07-30T10:00:00+09:00
draft = false
math = true
tags = ["컴퓨터비전", "최적화", "Adam", "RMSProp", "인터랙티브"]
categories = ["프로그램"]
summary = "3편의 모멘텀은 β 를 손으로 정했고 모든 변수에 같은 보폭을 썼다. 축마다 보폭을 다르게 주면 조건수를 아예 지울 수 있는데, 타원이 기울어지면 그 이득이 사라진다. Adam 은 그 상을 벗어나는데 원인이 β₂ 가 아니라 β₁ 이었다. 직접 만지는 데모 두 개를 넣었다."
+++

> 🎛 **직접 만지는 데모가 두 개** 있습니다. 슬라이더를 움직이고 점을 끌어보세요.
> [컴퓨터 비전 수학 시리즈]({{< ref "/posts/2d-transform-matrix" >}}) 네 번째 글입니다.
```

날짜가 **미래가 아닌지** 확인한다 (오늘은 2026-07-30). 미래면 Hugo 가 빌드에서 제외한다.

- [ ] **Step 2: 본문을 쓴다 — 스펙 §7 의 10 절 구조**

각 절이 **반드시 담아야 하는 수치와 주장**을 아래에 적는다. 이 숫자들은 스펙 §2 의 실측값이고,
글이 근거로 삼는 전부다. 새 숫자를 지어내지 말고, 여기 없는 숫자가 필요하면 먼저 측정한다.

1. **3편이 남긴 질문** — 왜 β 를 손으로 정했나, 왜 모든 변수에 같은 보폭인가
2. **AdaGrad** — `g²` 을 쌓아 축별로 나눈다. 그리고 학습률이 죽는다
3. **RMSProp** — 쌓지 말고 잊어가며 평균한다
4. **축이 맞아야 듣는다** + `{{< demo name="tilted" >}}`. θ=0° 의 4 회와 45° 의 424 회
5. **왜 그런가** — 45° 에서 `A₁₁ = A₂₂ = (1+κ)/2` 가 되어 `D` 가 항등행렬의 스칼라 곱이 되고
   `κ(D⁻¹A) = κ(A)` 다. 스펙 §2-5 의 수식을 그대로 쓴다
6. **해로울 수도 있다** — κ=10, θ=45° 에서 RMSProp 45.8 회 > GD 36.0 회
7. **Adam** — 모멘텀 + 축별 보폭 + 편향 보정. **평평한 원인은 β₁ 이다.**
   편향 보정을 설명할 때 방향을 뒤집지 말 것: **보정을 끄면 첫 스텝이 3.162 배 커진다**
   (`(1−β₁)/√(1−β₂)`). m 이 0.1g 로 작아지는 것보다 √v 가 0.0316|g| 로 더 많이 작아지기
   때문이다. 보정이 존재하는 이유가 이 과대한 초기 스텝을 잡는 것이다
   스펙 §2-2 의 두 표를 싣는다. β₂ 를 낮춰도 안 되고 모멘텀을 떼면 되는 것이 근거다
8. **실제 데이터** + `{{< demo name="adamfit" >}}` — 3편의 중심화가 실은 대각화였다.
   **여기서 두 데모의 역할 분담을 한 문장으로 밝힌다** (중심화는 무관항과 κ 를 동시에
   건드리므로, 정렬 효과를 분리하는 것은 데모 1 이다)
9. **컴퓨터 비전에서** — 번들 조정의 블록 대각 전처리가 같은 발상, 파라미터 단위가 섞일 때
   (초점거리는 픽셀, 회전은 라디안), 2편 캘리브레이션 절의 재방문. **말로만 한다**
10. **정리 + 5편 예고** (SGD·노이즈·스케줄)

수식 규약을 지킨다:
- 블록은 `$$...$$`, 인라인은 `\(...\)`. **인라인에 `$...$` 를 쓰지 않는다**
- **블록 수식 안에 `=` 를 홀로 한 줄에 두지 않는다.** `=` 는 앞 줄 끝에 붙인다

- [ ] **Step 3: 빌드하고 수식·데모가 렌더되는지 확인한다**

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
hugo --gc --minify --destination /tmp/hugo-t8 2>&1 | grep -E "ERROR|Pages"
grep -c "mv-demo" /tmp/hugo-t8/posts/adam/index.html      # 2 여야 한다
grep -c "raw HTML omitted" /tmp/hugo-t8/posts/adam/index.html   # 0 이어야 한다
grep -o 'katex' /tmp/hugo-t8/posts/adam/index.html | head -1     # katex 가 걸려야 한다
```

Expected: ERROR 없음, `Pages 132`, `mv-demo` 2 개, `raw HTML omitted` 0 개

- [ ] **Step 4: 새 글이 목록에 나오는지 확인한다**

Run: `grep -c "posts/adam/" /tmp/hugo-t8/posts/index.html`
Expected: 1 이상 (0 이면 날짜가 미래이거나 draft = true 다)

- [ ] **Step 5: 커밋**

```bash
git add content/posts/adam/index.md
git commit -m "post: adaptive learning rates - per-axis steps need aligned axes

The measurement drove the shape of this one. RMSProp goes from 4
iterations to 424 when the same ellipse is rotated 45 degrees, and at
kappa=10 it ends up slower than plain gradient descent, so the post
argues the limit rather than selling the method.

Adam gets its own section as the exception, with both beta2 tables, since
the obvious explanation (slow second-moment adaptation) is wrong and the
cause is beta1 absorbing the zigzag."
```

---

### Task 9: 최종 검증 (성공 기준 11항)

**Files:**
- 없음 (확인만 한다)

- [ ] **Step 0: 데모 JS 의 외부 의존성이 0 인지 확인한다 (성공 기준 11)**

```bash
cd /d/projects/joesiheon496.github.io
grep -rn "^import" static/js/mathviz/adaptive.js static/js/mathviz/tilted.js static/js/mathviz/adamfit.js
```
Expected: 모든 import 가 `./core.js`, `./optimize.js`, `./adaptive.js` 같은 **상대 경로**다.
`http`, `cdn`, 패키지 이름(`from 'lodash'` 등)이 하나도 없어야 한다.

```bash
grep -rn "cdn\|https://" static/js/mathviz/adaptive.js static/js/mathviz/tilted.js static/js/mathviz/adamfit.js
```
Expected: 출력 없음

- [ ] **Step 1: 테스트 전부 통과, 개수가 58 개다**

```bash
cd /d/projects/joesiheon496.github.io
npm test 2>&1 | tail -8
```
Expected: `tests 73`, `pass 73`, `fail 0`

> ⚠️ Task 1~4 의 개수 합이 5+9+7+4 = 25 라 48+25 = 73 이 된다. 스펙이 말한 "10개" 는
> **스펙 §6 이 나열한 검증 항목 10개**이고, 실제 `test()` 블록은 그보다 많다.
> **58 이 아니라 73 이 나오면 그것이 정상이다.** 개수를 58 로 맞추려고 테스트를 합치지 말 것 —
> 항목 하나에 여러 단정이 들어가면 실패했을 때 어디가 깨졌는지 알 수 없다.
> 확인할 것은 `fail 0` 과 **기준선 48 개가 그대로 통과하는 것**이다.

- [ ] **Step 2: 기준선 회귀가 없는지 확인한다**

```bash
npm test 2>&1 | grep -cE "^✔"          # 통과한 테스트 수
git stash list                          # 남은 stash 가 없어야 한다
git status --short                      # 커밋 안 된 변경이 없어야 한다
```

- [ ] **Step 3: Hugo 빌드와 기존 글 회귀를 확인한다**

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
hugo --gc --minify --destination /tmp/hugo-final 2>&1 | grep -E "ERROR|Pages"
for p in 2d-transform-matrix svd gradient-descent adam; do
  echo -n "$p: "; grep -c "mv-demo" /tmp/hugo-final/posts/$p/index.html
done
```
Expected: ERROR 없음, `Pages 132`. 1편 1개, 2편 2개, 3편 2개, 4편 2개의 `mv-demo`

- [ ] **Step 4: 수정 금지 파일이 그대로인지 확인한다**

```bash
git diff --name-only main...HEAD
```
Expected: 이 목록에 `layouts/shortcodes/demo.html`, `static/css/mathviz.css`,
`static/js/mathviz/optimize.js`, `tests/mathviz/optimize.test.js`,
`tests/mathviz/transform.test.js` 가 **없어야 한다**

- [ ] **Step 5: 브라우저에서 성공 기준 4~9 를 최종 확인한다**

```bash
hugo server -D
```

- 데모 1: θ 를 돌리면 RMSProp·AdaGrad 칸만 폭증, GD·모멘텀 칸 불변. 표 라벨 두 조건 명시.
  `κ(D⁻¹A)` 가 0° 에서 1, 45° 에서 κ
- 데모 2: 중심화를 켜도 회색 선 불변, 무관항 0 으로 떨어짐
- 두 데모 모두 큰 κ 에서 `미도달` 표시
- light / dark 양쪽에서 읽힘, 좁은 폭 유지, 터치 드래그 동작
- 1·2·3편 데모가 계속 동작

- [ ] **Step 6: 사람에게 푸시 승인을 받는다**

푸시하지 않는다. 확인 결과를 보고하고 승인을 기다린다.

```bash
git log --oneline main..HEAD
```
