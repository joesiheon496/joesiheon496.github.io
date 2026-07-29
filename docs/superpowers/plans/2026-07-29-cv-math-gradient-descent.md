# CV 수학 시리즈 3편 (경사하강법) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 등고선 위에서 공이 내려가는 것을 만지며 "조건수 κ 가 반복 횟수를 정한다"를 체감하는 데모와, 2편의 직선맞춤을 경사하강법으로 다시 풀어 닫힌 해와 나란히 보여주는 데모, 그리고 그 둘을 설명하는 글을 만든다.

**Architecture:** 1·2편의 하니스(`core.js`, `demo.html` shortcode, `mathviz.css`)를 그대로 재사용한다. 순수 수학은 새 파일 `optimize.js` 에 모아 Node 로 TDD 하고, 데모별 조립만 새 파일로 만든다. 하니스 확장은 `drawPath` 와 `makeToggles` 둘뿐이다. `optimize.js` 는 2편의 `svd2x2`·`pseudoInverse2x2` 를 import 해서 쓴다 — 그 재사용이 이 글의 논지다.

**Tech Stack:** Hugo 0.164 + PaperMod, 바닐라 ES 모듈 + Canvas 2D, KaTeX 0.18.1, Node 24 `node:test`

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-29-cv-math-gradient-descent-design.md`
- 1·2편 스펙/계획: `2026-07-29-cv-math-transform2d-design.md`, `2026-07-29-cv-math-svd-design.md`,
  `2026-07-29-cv-math-transform2d.md`, `2026-07-29-cv-math-svd.md`
- 데모 JS 의 외부 의존성은 **0**. 빌드 스텝 없음. 외부 CDN 은 KaTeX 뿐이다.
- 수식 구분자: 블록 `$$...$$` 와 `\[...\]`, 인라인 `\(...\)`. **인라인에 `$...$` 를 쓰지 않는다.**
- **블록 수식 안에 `=` 를 홀로 한 줄에 두지 않는다.** Markdown 이 setext 제목 밑줄로 해석해
  passthrough 보다 먼저 블록을 쪼갠다. 1편에서 수식 두 개가 이것 때문에 조용히 깨졌다
  (`&` → `&amp;`, `\\` → `\`, `x'` → `x&rsquo;`). `=` 는 앞 줄 끝에 붙인다.
- 캔버스 색은 하드코딩 금지. `themeColors()` 로 CSS 변수를 읽고 `onThemeChange` 로 재렌더한다.
- `layouts/shortcodes/demo.html` 과 `static/css/mathviz.css` 는 **수정하지 않는다.**
- 글 날짜를 미래로 적지 않는다. 미래면 Hugo 가 빌드에서 제외한다.
- Hugo 빌드에는 `go` 가 PATH 에 필요하다: `export PATH="$PATH:/c/Program Files/Go/bin"`
- 테스트는 **인자 없이** `node --test` 로 돌린다. `node --test tests/` 는 Node 24 에서
  디렉토리를 모듈로 해석해 실패한다. `npm test` 가 이미 그렇게 설정돼 있다.
- 수치 허용오차는 기본 **1e-9**. 예외는 두 곳뿐이며 이유가 있다:
  - 모멘텀 점근율은 **상대오차 1%** (임계감쇠라 고윳값이 복소수가 되어 한 스텝 비에
    미세 진동이 남는다. 스펙 §3-5, 실측 편차 0.2%)
  - GD → 닫힌 해 수렴은 **1e-12** (잘 조건화된 배치에서 실측 1.11e-16)
- **수축률 `(κ−1)/(κ+1)` 은 최적 학습률에서만 성립한다.** readout 에 그 라벨을 반드시 붙인다
  (스펙 §4). 라벨이 없으면 독자가 학습률을 움직였는데 숫자가 안 변하는 것을 버그로 읽는다.
- 커밋은 각 Task 끝에서. 푸시는 사람이 승인할 때만.
- 구현은 `main` 이 아니라 새 브랜치에서 한다.

## File Structure

| 파일 | 책임 |
|---|---|
| `static/js/mathviz/optimize.js` | **신규** — 순수 수학. 이차함수 묶음 + OLS 묶음 |
| `static/js/mathviz/core.js` | **수정** — `drawPath`, `makeToggles` 추가 (파일 끝) |
| `static/js/mathviz/descent.js` | 신규 — 데모 1 (등고선 위의 하강) |
| `static/js/mathviz/gdfit.js` | 신규 — 데모 2 (2편 직선맞춤 재방문) |
| `tests/mathviz/optimize.test.js` | 신규 — 테스트 10개 |
| `content/posts/gradient-descent/index.md` | 신규 — 글 |

`tests/mathviz/transform.test.js` 는 **건드리지 않는다.** 3편 테스트는 새 파일로 분리한다 —
`optimize.js` 가 별 모듈이므로 테스트도 별 파일이 맞고, 2편 테스트 29개를 회귀 기준으로
그대로 남겨둘 수 있다.

**등고선은 새 도형 코드가 필요 없다.** `½(x² + κy²) = c` 의 반축은 `√(2c)` 와 `√(2c/κ)` 이므로
`a = √(2c)` 로 두고 64각형을 `[a·cos t, (a/√κ)·sin t]` 로 만들면 등위선이 된다.
기존 `drawPolygon` 에 그대로 넣는다 (2편에서 원→타원에 쓴 방식과 같다).

---

### Task 1: optimize.js — 이차함수 코어

**Files:**
- Create: `static/js/mathviz/optimize.js`
- Test: `tests/mathviz/optimize.test.js` (신규)

**Interfaces:**
- Consumes: 없음 (이 Task 는 순수 함수만 만든다)
- Produces: Task 2·3 이 아래 이름을 그대로 쓴다.
  - `quadGrad(kappa, [x, y]) -> [number, number]`
  - `quadLoss(kappa, [x, y]) -> number`
  - `optimalEta(kappa) -> number` — `2/(1+κ)`
  - `divergenceEta(kappa) -> number` — `2/κ`
  - `contractionRate(kappa) -> number` — `(κ−1)/(κ+1)`
  - `momentumRate(kappa) -> number` — `(√κ−1)/(√κ+1)`
  - `optimalBeta(kappa) -> number`
  - `optimalMomentumEta(kappa) -> number`
  - `stepsToTarget(kappa, tol = 1e-3) -> number` (정수)
  - `gdPath({kappa, eta, beta = 0, start, steps}) -> Array<[number, number]>` (길이 `steps+1`)
  - `isFinitePoint([x, y]) -> boolean`
  - `firstIndexBelow(path, tol = 1e-3, target = [0, 0]) -> number | null`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/mathviz/optimize.test.js` 를 새로 만든다.

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  quadGrad, quadLoss, optimalEta, divergenceEta, contractionRate,
  momentumRate, optimalBeta, optimalMomentumEta, stepsToTarget,
  gdPath, isFinitePoint, firstIndexBelow,
} from '../../static/js/mathviz/optimize.js';

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b} (eps ${eps})`);
const nearPt = (p, q, eps = 1e-9) => { near(p[0], q[0], eps); near(p[1], q[1], eps); };
const norm = (p) => Math.hypot(p[0], p[1]);

// 스펙 §2 에서 실측한 κ 목록. 이 값들이 기대값의 근거다.
const KAPPAS = [2, 10, 30, 50, 100];
const START = [1, 1];       // 스펙 §2 의 실측이 쓴 시작점. 바꾸면 기대값이 달라진다.

test('수축률: 최적 학습률에서 (κ−1)/(κ+1) 과 일치한다', () => {
  for (const kappa of KAPPAS) {
    const path = gdPath({ kappa, eta: optimalEta(kappa), start: START, steps: 200 });
    const measured = norm(path[200]) / norm(path[199]);
    near(measured, contractionRate(kappa), 1e-9);
  }
});

test('수축률: 최적 학습률에서는 매 스텝이 정확히 같은 비로 줄어든다', () => {
  // 최적 η 에서 |1−η| 와 |1−ηκ| 가 같다. 그래서 점근이 아니라 첫 스텝부터 정확하다.
  const kappa = 30;
  const path = gdPath({ kappa, eta: optimalEta(kappa), start: START, steps: 20 });
  for (let i = 1; i <= 20; i++) {
    near(norm(path[i]) / norm(path[i - 1]), contractionRate(kappa), 1e-9);
  }
});

test('κ=1 특수: NaN 이 나오지 않고 한 스텝에 도달한다', () => {
  assert.ok(Number.isFinite(contractionRate(1)), 'contractionRate(1) 이 유한하지 않다');
  near(contractionRate(1), 0, 1e-12);
  assert.equal(stepsToTarget(1), 1);
  assert.ok(Number.isFinite(stepsToTarget(1)), 'stepsToTarget(1) 이 유한하지 않다');
  const path = gdPath({ kappa: 1, eta: optimalEta(1), start: START, steps: 3 });
  nearPt(path[1], [0, 0], 1e-12);
});

test('발산 문턱: 정확히 문턱이면 발산이 아니라 영원히 진동한다', () => {
  const kappa = 30;
  const path = gdPath({
    kappa, eta: divergenceEta(kappa), start: START, steps: 400,
  });
  const last = norm(path[400]);
  // y 성분이 |1−ηκ| = 1 로 크기를 유지하고 x 성분만 줄어든다 → 오차가 |y0| 로 수렴한다
  assert.ok(last > 0.9 && last < 1.1, `문턱에서 오차가 1 근처가 아니다: ${last}`);
  assert.ok(path.every(isFinitePoint), '문턱에서 발산했다');
});

test('발산 문턱: 문턱의 1.01 배면 발산한다', () => {
  const kappa = 30;
  const path = gdPath({
    kappa, eta: divergenceEta(kappa) * 1.01, start: START, steps: 400,
  });
  assert.ok(norm(path[400]) > 1e3, `발산하지 않았다: ${norm(path[400])}`);
});

test('예상 반복수가 궤적 실측과 정확히 일치한다', () => {
  for (const kappa of KAPPAS) {
    const path = gdPath({ kappa, eta: optimalEta(kappa), start: START, steps: 5000 });
    assert.equal(firstIndexBelow(path, 1e-3), stepsToTarget(kappa, 1e-3),
      `κ=${kappa} 에서 예측과 실측이 다르다`);
  }
});

test('모멘텀 점근율이 (√κ−1)/(√κ+1) 과 상대오차 1% 이내다', () => {
  // 1e-9 로 잡으면 실패한다 — 임계감쇠라 한 스텝 비에 미세 진동이 남는다 (스펙 §3-5).
  for (const kappa of [10, 30, 50, 100]) {
    const path = gdPath({
      kappa,
      eta: optimalMomentumEta(kappa),
      beta: optimalBeta(kappa),
      start: START,
      steps: 400,
    });
    const measured = norm(path[400]) / norm(path[399]);
    const theory = momentumRate(kappa);
    const rel = Math.abs(measured - theory) / theory;
    assert.ok(rel < 0.01, `κ=${kappa}: 실측 ${measured} vs 이론 ${theory} (상대 ${rel})`);
    // 그리고 생 GD 보다 확실히 빠르다
    assert.ok(theory < contractionRate(kappa) - 1e-6,
      `κ=${kappa}: 모멘텀이 생 GD 보다 빠르지 않다`);
  }
});

test('모멘텀이 같은 κ 에서 반복 횟수를 줄인다', () => {
  // 스펙 §2 실측: κ=30 에서 104회 → 29회 (3.59배)
  const kappa = 30;
  const plain = gdPath({
    kappa, eta: optimalEta(kappa), start: START, steps: 20000,
  });
  const mom = gdPath({
    kappa, eta: optimalMomentumEta(kappa), beta: optimalBeta(kappa),
    start: START, steps: 20000,
  });
  const nP = firstIndexBelow(plain, 1e-3);
  const nM = firstIndexBelow(mom, 1e-3);
  assert.equal(nP, 104);
  assert.ok(nM !== null && nM < 40, `모멘텀 반복수가 40 미만이 아니다: ${nM}`);
  assert.ok(nP / nM > 3, `배율이 3배 미만이다: ${nP / nM}`);
});

test('손실이 단조 감소한다 (β = 0, η < 문턱)', () => {
  // 모멘텀에서는 성립하지 않는다 — heavy ball 은 오버슛한다. β 를 넣으면 옳은 구현이 실패한다.
  for (const kappa of [2, 10, 30]) {
    for (const r of [0.3, 0.7, 0.95]) {
      const path = gdPath({
        kappa, eta: r * divergenceEta(kappa), beta: 0, start: START, steps: 100,
      });
      for (let i = 1; i < path.length; i++) {
        const prev = quadLoss(kappa, path[i - 1]);
        const cur = quadLoss(kappa, path[i]);
        assert.ok(cur <= prev + 1e-15,
          `κ=${kappa} r=${r} 스텝 ${i}: 손실이 늘었다 ${prev} → ${cur}`);
      }
    }
  }
});

test('quadGrad 와 quadLoss 가 정의대로다', () => {
  nearPt(quadGrad(1, [3, -4]), [3, -4]);
  nearPt(quadGrad(30, [3, -4]), [3, -120]);
  near(quadLoss(1, [3, 4]), 12.5);
  near(quadLoss(30, [1, 1]), 15.5);
});

test('firstIndexBelow: 목표점을 옮길 수 있고, 도달 못 하면 null 이다', () => {
  const path = [[10, 0], [5, 0], [1, 0], [0.005, 0]];
  assert.equal(firstIndexBelow(path, 1e-3), 3);       // 10 의 1e-3 배 = 0.01 미만
  assert.equal(firstIndexBelow(path, 1e-9), null);    // 도달 못 함
  // target 을 [0.005, 0] 으로 두면 마지막 점이 정확히 목표라 거리 0 이다
  assert.equal(firstIndexBelow(path, 1e-3, [0.005, 0]), 3);
  assert.equal(firstIndexBelow([[1, 1], [Infinity, 0]], 1e-3), null);   // 발산
});
```

- [ ] **Step 2: 테스트가 실패하는 것 확인**

```bash
cd "D:/projects/joesiheon496.github.io"
npm test
```

Expected: FAIL. `optimize.js` 가 없어서 import 단계에서 죽는다
(`Cannot find module ... optimize.js`). 2편 테스트 29개는 계속 통과한다.

- [ ] **Step 3: 구현**

`static/js/mathviz/optimize.js` 를 만든다. (OLS 묶음은 Task 2 에서 이 파일 끝에 추가한다.)

```javascript
// static/js/mathviz/optimize.js
// 경사하강법의 순수 수학. 캔버스도 DOM 도 모르고, Node 로 테스트된다.
//
// 이 파일의 논지: 조건수 κ 가 반복 횟수를 정한다.
//
// 합성 이차함수는 f(x, y) = ½(x² + κy²) 를 쓴다. Hessian 이 diag(1, κ) 라서
// 조건수가 정확히 κ 이고, 슬라이더 값이 곧 κ 다 — 다른 파라미터에서 역산하지 않는다.

// ------------------------------------------------------------ 이차함수

/** f = ½(x² + κy²) 의 기울기. */
export function quadGrad(kappa, [x, y]) {
  return [x, kappa * y];
}

/** f = ½(x² + κy²) 의 값. */
export function quadLoss(kappa, [x, y]) {
  return 0.5 * (x * x + kappa * y * y);
}

/**
 * 최적 학습률 2/(λ_min + λ_max) = 2/(1+κ).
 *
 * 이 값에서 |1−η| 와 |1−ηκ| 가 정확히 같아진다. 그래서 두 축이 같은 비로 줄고,
 * 수축률이 점근값이 아니라 첫 스텝부터 정확히 (κ−1)/(κ+1) 이 된다.
 */
export function optimalEta(kappa) {
  return 2 / (1 + kappa);
}

/**
 * 발산 문턱 2/λ_max = 2/κ.
 *
 * 이 값을 **넘으면** 발산한다. 정확히 같으면 발산이 아니라 영원히 진동한다 —
 * y 성분의 배율이 |1 − ηκ| = 1 로 크기를 유지하기 때문이다.
 * 그래서 데모의 경고 판정은 `>` 여야 한다. `>=` 로 하면 진동을 발산으로 잘못 표시한다.
 */
export function divergenceEta(kappa) {
  return 2 / kappa;
}

/** 최적 학습률에서의 수축률 (κ−1)/(κ+1). 다른 학습률에서는 성립하지 않는다. */
export function contractionRate(kappa) {
  return (kappa - 1) / (kappa + 1);
}

/** 최적 모멘텀에서의 점근 수축률 (√κ−1)/(√κ+1). κ 의존성이 √κ 로 줄어든다. */
export function momentumRate(kappa) {
  const s = Math.sqrt(kappa);
  return (s - 1) / (s + 1);
}

/** heavy ball 의 최적 β = ((√κ−1)/(√κ+1))². */
export function optimalBeta(kappa) {
  return momentumRate(kappa) ** 2;
}

/** heavy ball 의 최적 학습률 4/(1+√κ)². */
export function optimalMomentumEta(kappa) {
  return 4 / (1 + Math.sqrt(kappa)) ** 2;
}

/**
 * 목표(초기 오차의 tol 배)까지 필요한 반복수. **최적 학습률을 가정한 값이다.**
 *
 * κ=1 이면 한 스텝에 정확히 최소점에 도달한다. 그때 수축률이 0 이고 log(0) = −∞ 라
 * 일반식이 0 을 주므로 따로 1 을 돌려준다.
 */
export function stepsToTarget(kappa, tol = 1e-3) {
  if (kappa <= 1 + 1e-12) return 1;
  return Math.ceil(Math.log(tol) / Math.log(contractionRate(kappa)));
}

/**
 * 경사하강법 / heavy ball 궤적. 길이 steps+1 의 점 배열.
 * beta = 0 이면 생 경사하강법이다.
 *
 * 발산하면 좌표가 Infinity 또는 NaN 이 된다. 걸러내지 않고 그대로 돌려주므로
 * 그리는 쪽에서 isFinitePoint 로 확인해야 한다 — 발산 자체가 이 데모의 볼거리다.
 */
export function gdPath({ kappa, eta, beta = 0, start, steps }) {
  let prev = [start[0], start[1]];
  let cur = [start[0], start[1]];
  const path = [[cur[0], cur[1]]];
  for (let i = 0; i < steps; i++) {
    const g = quadGrad(kappa, cur);
    const next = [
      cur[0] - eta * g[0] + beta * (cur[0] - prev[0]),
      cur[1] - eta * g[1] + beta * (cur[1] - prev[1]),
    ];
    prev = cur;
    cur = next;
    path.push([cur[0], cur[1]]);
  }
  return path;
}

export const isFinitePoint = ([x, y]) => Number.isFinite(x) && Number.isFinite(y);

/**
 * 궤적에서 목표점까지의 거리가 초기 거리의 tol 배 아래로 처음 내려간 반복수.
 * 도달하지 못하거나 발산하면 null 이다 — 호출자가 '미도달' 로 표시한다.
 *
 * 데모 1 은 target 이 최소점(원점), 데모 2 는 닫힌 해다.
 */
export function firstIndexBelow(path, tol = 1e-3, target = [0, 0]) {
  const dist = (p) => Math.hypot(p[0] - target[0], p[1] - target[1]);
  const e0 = dist(path[0]);
  if (e0 === 0) return 0;
  for (let i = 0; i < path.length; i++) {
    if (!isFinitePoint(path[i])) return null;
    if (dist(path[i]) < tol * e0) return i;
  }
  return null;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd "D:/projects/joesiheon496.github.io"
npm test
```

Expected: 2편 29개 + 신규 11개 = **40개 PASS**.

실패 시 진단 순서:
- 수축률 불일치 → `optimalEta` 가 `2/(1+κ)` 인지 확인. `1/κ` 나 `2/κ` 를 쓰면 안 맞는다
- 예상 반복수 불일치 → `Math.ceil` 인지 확인 (`round`·`floor` 는 실측과 1 씩 어긋난다)
- 모멘텀 실패 → `gdPath` 의 모멘텀 항이 `beta * (cur − prev)` 인지 확인.
  `beta * prev` 로 쓰면 전혀 다른 점화식이 된다
- κ=1 에서 NaN → `stepsToTarget` 의 조기 반환이 있는지 확인

- [ ] **Step 5: 커밋**

```bash
cd "D:/projects/joesiheon496.github.io"
git add static/js/mathviz/optimize.js tests/mathviz/optimize.test.js
git commit -m "feat: add gradient descent core for quadratics

The contraction rate (k-1)/(k+1) holds exactly from the first step at the
optimal learning rate, not just asymptotically, because |1-eta| and
|1-eta*k| coincide there. Tests assert that per-step rather than only in
the limit.

Two behaviours needed explicit handling. At kappa = 1 the iteration lands
on the minimum in one step, so the measured rate is 0/0; stepsToTarget
returns 1 instead of dividing by log(0). At exactly eta = 2/lambda_max the
iteration does not diverge, it oscillates forever with constant magnitude,
so the divergence predicate must be strict."
```

---

### Task 2: optimize.js — OLS 묶음 (2편과의 연결)

**Files:**
- Modify: `static/js/mathviz/optimize.js` (파일 끝에 추가, import 줄도 추가)
- Modify: `tests/mathviz/optimize.test.js` (import 줄 수정 + 파일 끝에 추가)

**Interfaces:**
- Consumes: 2편의 `svd2x2`, `pseudoInverse2x2` (`./transform.js`).
  Task 1 의 `firstIndexBelow` (같은 파일 안이므로 import 불필요)
- Produces: Task 4 가 아래 이름을 그대로 쓴다.
  - `olsDesign(points) -> {X: Array<[number, number]>, y: number[]}`
  - `olsKappa(points) -> {s1, s2, kappa, l1, l2}` — `s1`/`s2` 는 **설계행렬 X 의**
    특이값(제곱근을 취한 값), `l1`/`l2` 는 `XᵀX` 의 고윳값, `kappa = l1/l2 = (s1/s2)²`
  - `olsClosed(points) -> [a, b]` — `y = a x + b`
  - `centerPoints(points) -> {points, xbar}`
  - `olsGdPath({points, steps, center = false}) -> Array<[a, b]>` (길이 `steps+1`,
    **원 좌표로 환산된 값**)

`points` 는 어디서나 `[[x, y], …]` 다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/mathviz/optimize.test.js` 의 import 줄을 아래로 바꾼다.

```javascript
import {
  quadGrad, quadLoss, optimalEta, divergenceEta, contractionRate,
  momentumRate, optimalBeta, optimalMomentumEta, stepsToTarget,
  gdPath, isFinitePoint, firstIndexBelow,
  olsDesign, olsKappa, olsClosed, centerPoints, olsGdPath,
} from '../../static/js/mathviz/optimize.js';
```

그리고 파일 끝에 아래를 추가한다.

```javascript
// ------------------------------------------------------------------- OLS

// 스펙 §2 에서 실측한 배치들. 세계좌표 x ∈ [−3, 3] 안이다.
const SPREAD = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5];
const SKEWED = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
const withY = (xs) => xs.map((x) => [x, 0.8 * x + 0.3 + 0.06 * Math.sin(x * 9)]);

/** 정규방정식을 Cramer 로 직접 푼다. olsClosed 와 독립적인 경로다. */
function closedByCramer(points) {
  let xx = 0, x1 = 0, n = 0, r0 = 0, r1 = 0;
  for (const [x, y] of points) {
    xx += x * x; x1 += x; n += 1; r0 += x * y; r1 += y;
  }
  const det = xx * n - x1 * x1;
  return [(n * r0 - x1 * r1) / det, (xx * r1 - x1 * r0) / det];
}

test('olsDesign: 설계행렬이 [[x, 1], …] 이고 y 가 분리된다', () => {
  const { X, y } = olsDesign([[2, 5], [-1, 0.5]]);
  assert.deepEqual(X, [[2, 1], [-1, 1]]);
  assert.deepEqual(y, [5, 0.5]);
});

test('2편 연결: olsKappa 의 σ 가 설계행렬 X 의 특이값이다 (제곱이 아니다)', () => {
  // svd2x2 는 2×2 만 받으므로 X(n×2) 에 직접 못 쓴다. 대신 특이값을 유일하게
  // 결정하는 두 항등식으로 독립 검증한다.
  //   σ₁² + σ₂² = ‖X‖_F² = Σ(x² + 1)
  //   σ₁² · σ₂² = det(XᵀX)
  // 이 둘을 만족하면서 σ₁ ≥ σ₂ ≥ 0 인 쌍은 하나뿐이다.
  for (const xs of [SPREAD, SKEWED, [1, 1, 1, 1]]) {
    const pts = withY(xs);
    const { s1, s2, kappa, l1, l2 } = olsKappa(pts);

    let xx = 0, x1 = 0, n = 0;
    for (const [x] of pts) { xx += x * x; x1 += x; n += 1; }
    const frob2 = xx + n;                    // ‖X‖_F²
    const detG = xx * n - x1 * x1;           // det(XᵀX)

    near(s1 * s1 + s2 * s2, frob2, 1e-9);
    near(s1 * s1 * s2 * s2, detG, 1e-9);
    assert.ok(s1 >= s2 - 1e-12, `σ 순서 위반 ${s1} ${s2}`);

    // 그리고 이 글의 등식: κ(XᵀX) = (σ₁/σ₂)²
    if (s2 > 1e-12) near(kappa, (s1 / s2) ** 2, 1e-12 * Math.max(1, kappa));
    near(l1, s1 * s1, 1e-9);
    near(l2, s2 * s2, 1e-9);
  }
});

test('olsKappa: 스펙 §2 의 실측값을 재현한다', () => {
  near(olsKappa(withY(SPREAD)).kappa, 2.9, 0.1);
  near(olsKappa(withY(SKEWED)).kappa, 29.5, 0.5);
  near(olsKappa(centerPoints(withY(SKEWED)).points).kappa, 1.37, 0.05);
});

test('2편 연결: olsClosed 가 정규방정식의 해와 같다', () => {
  for (const xs of [SPREAD, SKEWED]) {
    const pts = withY(xs);
    nearPt(olsClosed(pts), closedByCramer(pts), 1e-9);
  }
});

test('olsClosed: x 가 모두 같으면(퇴화) 유한한 값을 준다', () => {
  // XᵀX 가 특이하다. pseudoInverse2x2 가 작은 특이값을 버리므로 발산하지 않는다.
  const w = olsClosed([[1, 2], [1, 3], [1, 4]]);
  assert.ok(w.every(Number.isFinite), `유한하지 않다 ${JSON.stringify(w)}`);
});

test('GD 가 닫힌 해로 수렴한다', () => {
  const pts = withY(SPREAD);
  const target = olsClosed(pts);
  const path = olsGdPath({ points: pts, steps: 2000 });
  nearPt(path[2000], target, 1e-12);
  assert.equal(path.length, 2001);
});

test('중심화: 답인 직선은 그대로이고 조건수만 낮아진다', () => {
  const pts = withY(SKEWED);
  const target = olsClosed(pts);

  // 중심화해서 풀어도 원 좌표로 환산하면 같은 직선이다
  const { points: cen, xbar } = centerPoints(pts);
  const wc = olsClosed(cen);
  nearPt([wc[0], wc[1] - wc[0] * xbar], target, 1e-9);

  // 조건수는 크게 낮아진다
  assert.ok(olsKappa(cen).kappa < olsKappa(pts).kappa / 10,
    '중심화가 조건수를 10배 이상 낮추지 못했다');

  // olsGdPath 는 center 여부와 무관하게 원 좌표로 환산된 값을 준다
  const slow = olsGdPath({ points: pts, steps: 400, center: false });
  const fast = olsGdPath({ points: pts, steps: 400, center: true });
  const dist = (p) => Math.hypot(p[0] - target[0], p[1] - target[1]);
  assert.ok(dist(fast[400]) < dist(slow[400]),
    `중심화가 더 빠르지 않다: ${dist(fast[400])} vs ${dist(slow[400])}`);
  assert.ok(dist(fast[400]) < 1e-9, `중심화 쪽이 수렴하지 않았다: ${dist(fast[400])}`);
});

test('중심화: 반복수가 스펙 §2 실측대로 줄어든다', () => {
  // 스펙 §2: 오른쪽 치우침에서 102회 → 4회
  const pts = withY(SKEWED);
  const target = olsClosed(pts);
  const nSlow = firstIndexBelow(
    olsGdPath({ points: pts, steps: 5000, center: false }), 1e-3, target);
  const nFast = firstIndexBelow(
    olsGdPath({ points: pts, steps: 5000, center: true }), 1e-3, target);
  assert.ok(nSlow > 50, `중심화 없이 너무 빨리 끝났다: ${nSlow}`);
  assert.ok(nFast !== null && nFast < 15, `중심화가 15회 미만이 아니다: ${nFast}`);
});
```

- [ ] **Step 2: 테스트가 실패하는 것 확인**

```bash
cd "D:/projects/joesiheon496.github.io"
npm test
```

Expected: FAIL. `olsDesign` 등이 export 되지 않아 import 단계에서 죽는다.

- [ ] **Step 3: 구현**

`static/js/mathviz/optimize.js` 의 **첫 줄 주석 블록 다음**에 import 를 추가한다.

```javascript
import { svd2x2, pseudoInverse2x2 } from './transform.js';
```

그리고 파일 끝에 추가한다.

```javascript
// ------------------------------------------------------------------ OLS
//
// 2편의 직선맞춤은 직교 회귀(수직 거리)였고 그 손실은 각도에 대해 주기적이라
// 볼록하지 않다. 위의 수축률 이론이 안 맞는다. 그래서 3편은 보통최소자승으로 바꾼다.
//
//   L(a, b) = Σ (y_i − a x_i − b)²
//
// 이러면 Hessian 이 2XᵀX 라는 **상수 행렬**이 되어 조건수가 데이터만으로 정해진다.

/** 점 배열 → 설계행렬 X = [[x, 1], …] 과 관측 y. */
export function olsDesign(points) {
  return { X: points.map(([x]) => [x, 1]), y: points.map(([, y]) => y) };
}

/** XᵀX (2×2 대칭 준양정). Hessian 은 이것의 2배다. */
function gramOf(points) {
  let xx = 0, x1 = 0, n = 0;
  for (const [x] of points) { xx += x * x; x1 += x; n += 1; }
  return [[xx, x1], [x1, n]];
}

/**
 * 설계행렬의 특이값과 Hessian 의 조건수.
 *
 * κ(XᵀX) = (σ₁/σ₂)² — 2편의 σ 가 **제곱되어** 들어오는 지점이고, 이 글의 논지다.
 *
 * XᵀX 는 대칭 준양정이라 그 SVD 가 고윳값 분해와 같다. 그래서 2편의 svd2x2 를
 * 그대로 재사용할 수 있다.
 *
 * ⚠️ svd2x2(XᵀX) 가 주는 값은 **XᵀX 의** 고윳값이고, 이는 X 의 특이값의 제곱이다.
 * 2편 데모 2 에서 공분산에 대해 똑같은 함정을 만났다. σ 로 쓸 값은 제곱근이다.
 */
export function olsKappa(points) {
  const { s1: l1, s2: l2 } = svd2x2(gramOf(points));
  return {
    s1: Math.sqrt(l1),
    s2: Math.sqrt(l2),
    kappa: l2 > 1e-300 ? l1 / l2 : Infinity,
    l1,
    l2,
  };
}

/**
 * 닫힌 해. 2편의 pseudoInverse2x2 로 (XᵀX)⁺ 를 만들어 Xᵀy 에 적용한다.
 * 의사역행렬을 쓰므로 x 가 모두 같은 퇴화 배치에서도 발산하지 않는다.
 */
export function olsClosed(points) {
  const P = pseudoInverse2x2(gramOf(points), 1e-12);
  let r0 = 0, r1 = 0;
  for (const [x, y] of points) { r0 += x * y; r1 += y; }
  return [P[0][0] * r0 + P[0][1] * r1, P[1][0] * r0 + P[1][1] * r1];
}

/** x 를 평균 0 으로 옮긴다. 답인 직선은 바뀌지 않고 조건수만 낮아진다. */
export function centerPoints(points) {
  const xbar = points.reduce((s, [x]) => s + x, 0) / points.length;
  return { points: points.map(([x, y]) => [x - xbar, y]), xbar };
}

/**
 * OLS 를 경사하강법으로 푸는 궤적. 길이 steps+1 의 [a, b] 배열.
 *
 * 학습률은 최적값을 쓴다. Hessian = 2XᵀX 이므로 고윳값이 2l 이고,
 * 2/(λ_min + λ_max) = 2/(2l₁ + 2l₂) 다. 데모 1 이 이미 학습률을 다루므로
 * 여기서는 κ 만이 변수여야 한다.
 *
 * center: true 면 x 를 중심화해 풀고 **원 좌표로 환산해서** 돌려준다:
 *   a = a′,  b = b′ − a′·x̄
 * 환산을 호출자에게 맡기면 데모마다 같은 함정을 다시 밟는다. 반환값은 항상
 * 원 좌표이므로 호출자는 center 를 신경쓰지 않고 닫힌 해와 직접 비교할 수 있다.
 */
export function olsGdPath({ points, steps, center = false }) {
  const { points: P, xbar } = center
    ? centerPoints(points)
    : { points, xbar: 0 };
  const { l1, l2 } = olsKappa(P);
  const eta = 2 / (2 * l1 + 2 * l2);

  let a = 0, b = 0;
  const out = [[a, b - a * xbar]];
  for (let i = 0; i < steps; i++) {
    let g0 = 0, g1 = 0;
    for (const [x, y] of P) {
      const r = a * x + b - y;
      g0 += 2 * r * x;
      g1 += 2 * r;
    }
    a -= eta * g0;
    b -= eta * g1;
    out.push([a, b - a * xbar]);
  }
  return out;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd "D:/projects/joesiheon496.github.io"
npm test
```

Expected: 2편 29개 + Task 1 의 11개 + 신규 8개 = **48개 PASS**.

실패 시 진단 순서:
- `σ 가 X 의 특이값이다` 실패 → `Math.sqrt` 를 빼먹었는지 확인 (2편과 같은 함정)
- 실측값 재현 실패 → `withY` 의 잔차항까지 테스트와 같은지 확인.
  y 값이 다르면 κ 는 그대로여야 한다 (κ 는 x 만의 함수다) — κ 가 다르면 `gramOf` 를 본다
- 중심화 환산 실패 → `b − a·x̄` 인지 확인. `b + a·x̄` 는 부호가 반대다
- GD 수렴 실패 → `eta` 가 `2/(2l₁ + 2l₂)` 인지 확인. Hessian 의 2배를 빼먹으면 2배 커진다

- [ ] **Step 5: 커밋**

```bash
cd "D:/projects/joesiheon496.github.io"
git add static/js/mathviz/optimize.js tests/mathviz/optimize.test.js
git commit -m "feat: add OLS gradient descent tied to post 2's SVD

kappa(X'X) = (sigma1/sigma2)^2 is the hinge between the two posts: the
number post 2 used for trustworthiness is the number that sets iteration
count here, squared. Verified by the two identities that pin the singular
values (Frobenius norm and determinant) rather than by re-running the same
eigen code, and against a Cramer solve of the normal equations.

Ordinary least squares replaces post 2's orthogonal regression because
the orthogonal loss is periodic in angle and not convex, so the
contraction rate would not apply.

olsGdPath returns coefficients in original coordinates even when solving
centred, so callers never redo the b - a*xbar conversion."
```

---

### Task 3: core.js 확장 + 데모 1 (등고선 위의 하강)

**Files:**
- Modify: `static/js/mathviz/core.js` (파일 끝에 추가)
- Create: `static/js/mathviz/descent.js`

**Interfaces:**
- Consumes: Task 1 의 `quadLoss`, `gdPath`, `optimalEta`, `divergenceEta`,
  `contractionRate`, `momentumRate`, `optimalBeta`, `stepsToTarget`,
  `firstIndexBelow`, `isFinitePoint`.
  1·2편의 `themeColors`, `onThemeChange`, `createView`, `drawGrid`, `drawPolygon`,
  `drawHandles`, `makeSliders`, `attachDrag`.
- Produces: `core.js` 가 두 함수를 export 한다. Task 4 가 그대로 쓴다.
  - `drawPath(ctx, view, pts, {color, width = 2})`
  - `makeToggles(el, defs, onInput) -> {getValues, setValues}` —
    `defs` 는 `[{key, label, value: boolean}]`, `getValues()` 는 boolean 맵
  - `descent.js` 는 `init(root)` 를 export 한다 (shortcode 규약)

- [ ] **Step 1: `core.js` 에 `drawPath` 와 `makeToggles` 추가**

파일 끝에 추가한다.

```javascript
/**
 * 열린 폴리라인. GD 궤적용이다.
 * drawPolygon 은 closePath() 를 호출하므로 궤적에 쓸 수 없다 —
 * 마지막 점과 시작점이 이어져 버린다.
 */
export function drawPath(ctx, view, pts, { color, width = 2 }) {
  if (pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = view.toPixel(p);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.stroke();
}

/**
 * 체크박스 행. makeSliders 와 같은 반환 규약이지만 값이 boolean 이다.
 *
 * ⚠️ 이 함수는 el 을 비우지 않는다. makeSliders 가 `el.innerHTML = ''` 를 하므로
 * **makeSliders 를 먼저 호출한 뒤** 이 함수를 불러야 한다. 순서를 바꾸면 슬라이더가 지워진다.
 *
 * makeSliders 를 확장하지 않는 이유: 그 함수는 parseFloat 와 min/max/step 에 묶여
 * 있어서 boolean 을 끼우면 clamp 의 의미가 깨진다.
 *
 * CSS 를 건드리지 않기 위해 기존 .mv-slider 그리드 행을 재사용한다. 다만
 * `.mv-slider input { width: 100% }` 가 체크박스를 늘리므로 인라인으로 되돌린다.
 */
export function makeToggles(el, defs, onInput) {
  const rows = {};

  function getValues() {
    const v = {};
    for (const k in rows) v[k] = rows[k].checked;
    return v;
  }

  defs.forEach((d) => {
    const row = document.createElement('div');
    row.className = 'mv-slider';
    const label = document.createElement('label');
    label.textContent = d.label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!d.value;
    input.style.width = 'auto';
    input.style.justifySelf = 'start';
    const out = document.createElement('span');
    out.className = 'mv-val';
    const show = () => { out.textContent = input.checked ? '켜짐' : '꺼짐'; };
    show();
    input.addEventListener('change', () => { show(); onInput(getValues()); });
    row.append(label, input, out);
    el.appendChild(row);
    rows[d.key] = input;
  });

  function setValues(obj) {
    for (const k in obj) {
      if (!rows[k]) continue;
      rows[k].checked = !!obj[k];
    }
  }

  return { getValues, setValues };
}
```

- [ ] **Step 2: `descent.js` 구현**

```javascript
// static/js/mathviz/descent.js
// 데모 1 — 등고선 위의 경사하강법.
//
// 손실은 f(x, y) = ½(x² + κy²). Hessian 이 diag(1, κ) 라 조건수가 정확히 κ 이고
// 슬라이더 값이 곧 κ 다.
//
// 학습률은 절대값이 아니라 **발산 문턱에 대한 비율** r 로 준다. 문턱 2/κ 는 κ 에 따라
// 2.0 에서 0.033 까지 60배 움직여서 절대 슬라이더 하나로는 두 끝을 담을 수 없다.
// 비율로 주면 문턱이 항상 r = 1 에 오고, 정확히 1 로 맞춰 "영원히 진동" 을 볼 수 있다.

import {
  quadLoss, gdPath, optimalEta, divergenceEta, contractionRate,
  momentumRate, optimalBeta, stepsToTarget, firstIndexBelow, isFinitePoint,
} from './optimize.js';
import {
  themeColors, onThemeChange, createView, drawGrid, drawPolygon,
  drawPath, drawHandles, makeSliders, makeToggles, attachDrag,
} from './core.js';

const WORLD = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
const OUTER_X = 2.6;        // 가장 바깥 등고선의 x 반축 — 어떤 κ 에서도 화면에 들어온다
const LEVEL_Q = 0.72;       // 등고선 간 반축 비
const LEVELS = 5;
const MAX_STEPS = 300;      // 스펙 §3-3: κ 가 크면 안 끝나는 게 정상이다

// 단위원 64각형. 축마다 반축을 곱하면 등고선이 된다.
const UNIT = Array.from({ length: 64 }, (_, i) => {
  const a = (i / 64) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
});

const SLIDERS = [
  { key: 'kappa', label: 'κ', min: 1, max: 60, step: 0.5, value: 12,
    fmt: (v) => v.toFixed(1) },
  { key: 'ratio', label: 'η/문턱', min: 0.05, max: 1.3, step: 0.01, value: 0.9,
    fmt: (v) => v.toFixed(2) },
  { key: 'steps', label: '반복', min: 0, max: MAX_STEPS, step: 1, value: 40,
    fmt: (v) => String(Math.round(v)) },
  { key: 'beta', label: 'β', min: 0, max: 0.95, step: 0.01, value: 0.9,
    fmt: (v) => v.toFixed(2) },
];

const TOGGLES = [{ key: 'momentum', label: '모멘텀', value: false }];

/** 그 κ 에서 화면에 맞는 기본 시작점. 바깥 등고선 위의 60° 지점. */
const defaultStart = (kappa) => [
  OUTER_X * Math.cos(Math.PI / 3),
  (OUTER_X / Math.sqrt(kappa)) * Math.sin(Math.PI / 3),
];

/** 반축 a 인 등고선(64각형). f = ½a² 인 등위선이다. */
const contour = (a, kappa) =>
  UNIT.map(([c, s]) => [a * c, (a / Math.sqrt(kappa)) * s]);

/** 궤적에서 실측한 수축률. 마지막 유의미한 두 스텝의 비. */
function measuredRate(path) {
  const n = (p) => Math.hypot(p[0], p[1]);
  for (let i = path.length - 1; i >= 1; i--) {
    if (!isFinitePoint(path[i]) || !isFinitePoint(path[i - 1])) continue;
    const cur = n(path[i]), prev = n(path[i - 1]);
    if (prev > 1e-12 && cur > 1e-14) return cur / prev;
  }
  return null;
}

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = createView(canvas, WORLD);

  const state = { kappa: 12, ratio: 0.9, steps: 40, beta: 0.9, momentum: false };
  let start = defaultStart(state.kappa);

  const sliderHost = root.querySelector('.mv-sliders');
  makeSliders(sliderHost, SLIDERS, (v) => {
    if (v.kappa !== state.kappa) {
      // κ 가 바뀌면 시작점의 y 를 같은 등고선 위에 남긴다. 그러지 않으면
      // κ 를 키울 때 시작점이 등고선 바깥으로 튀어 화면을 벗어난다.
      start = [start[0], start[1] * Math.sqrt(state.kappa / v.kappa)];
    }
    Object.assign(state, v);
    draw();
  });
  // ⚠️ makeSliders 가 host 를 비우므로 반드시 그 뒤에 부른다.
  makeToggles(sliderHost, TOGGLES, (v) => {
    Object.assign(state, v);
    draw();
  });

  attachDrag(canvas, view, () => [start], (_, p) => {
    start = p;
    draw();
  });

  function draw() {
    const colors = themeColors();
    const { kappa, ratio } = state;
    const steps = Math.round(state.steps);
    const threshold = divergenceEta(kappa);
    const eta = ratio * threshold;
    const beta = state.momentum ? state.beta : 0;

    drawGrid(ctx, view, colors);

    // 등고선 — 바깥에서 안으로 등비로 좁힌다
    for (let j = 0; j < LEVELS; j++) {
      drawPolygon(ctx, view, contour(OUTER_X * LEVEL_Q ** j, kappa),
        { stroke: colors.grid, width: 1.2 });
    }

    // 최소점
    const [ox, oy] = view.toPixel([0, 0]);
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(ox - 6, oy); ctx.lineTo(ox + 6, oy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ox, oy - 6); ctx.lineTo(ox, oy + 6); ctx.stroke();

    const path = gdPath({ kappa, eta, beta, start, steps });
    const finite = path.filter(isFinitePoint);
    const diverged = finite.length < path.length
      || finite.some((p) => Math.abs(p[0]) > 1e6 || Math.abs(p[1]) > 1e6);

    drawPath(ctx, view, finite, { color: colors.accent, width: 2 });
    ctx.fillStyle = colors.accent;
    for (const p of finite) {
      const [px, py] = view.toPixel(p);
      ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill();
    }

    drawHandles(ctx, view, [start], colors);
    root.querySelector('.mv-matrix-host').innerHTML = '';

    // ---- readout
    const optRatio = kappa / (1 + kappa);          // 최적 η 에 해당하는 비율
    const rate = contractionRate(kappa);
    const predSteps = stepsToTarget(kappa);
    const measured = measuredRate(path);
    const reached = firstIndexBelow(path, 1e-3);

    let verdict;
    if (ratio > 1) {
      verdict = '<span class="no">발산 — 학습률이 문턱을 넘었다</span>';
    } else if (Math.abs(ratio - 1) < 1e-9) {
      verdict = '<span class="no">영원히 진동 — 정확히 문턱이다 (발산은 아니다)</span>';
    } else if (reached === null) {
      verdict = `<span class="no">미도달</span> — ${steps}회로는 목표에 못 간다`;
    } else {
      verdict = `<span class="ok">${reached}회에 도달</span>`;
    }

    const kappaOne = kappa <= 1 + 1e-9;
    root.querySelector('.mv-readout').innerHTML = `
      κ = <b>${kappa.toFixed(1)}</b>
      &nbsp; η = <b>${eta.toFixed(4)}</b>
      &nbsp; 문턱 = ${threshold.toFixed(4)}
      &nbsp; 최적 = ${optimalEta(kappa).toFixed(4)} (비율 ${optRatio.toFixed(2)})<br>
      <b>최적 η 기준</b> 수축률 ${kappaOne ? '—' : rate.toFixed(4)}
      · 예상 ${kappaOne ? '한 번에 도달' : `${predSteps}회`}<br>
      현재 η 의 실측 수축률 <b>${
        diverged ? '발산' : measured === null ? '—' : measured.toFixed(4)}</b><br>
      ${verdict}
      ${state.momentum && !kappaOne
        ? `<br>모멘텀 이론 수축률 <b>${momentumRate(kappa).toFixed(4)}</b>`
          + ` (생 GD ${rate.toFixed(4)}) · 최적 β = ${optimalBeta(kappa).toFixed(2)}`
        : ''}`;

    root.querySelector('.mv-hint').textContent = state.momentum
      ? 'β 를 올리면 지그재그가 펴집니다. 최적 β 에서 κ 의존성이 κ 에서 √κ 로 줄어듭니다. '
      + 'readout 의 최적 β 값과 비교해 보세요.'
      : 'κ 를 키우면 등고선이 납작해지고 궤적이 지그재그가 됩니다. η/문턱 을 1 로 밀면 '
      + '진동이 멈추지 않고, 1 을 넘으면 터집니다. 점을 끌어 시작 위치를 바꿀 수 있습니다. '
      + '수축률은 최적 학습률에서의 값이라 η 를 움직여도 바뀌지 않습니다.';
  }

  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
```

- [ ] **Step 3: 문법·export 확인**

```bash
cd "D:/projects/joesiheon496.github.io"
node --check static/js/mathviz/core.js
node --check static/js/mathviz/optimize.js
node --check static/js/mathviz/descent.js
node -e "
globalThis.window = { devicePixelRatio: 1 };
import('./static/js/mathviz/core.js').then(m =>
  console.log('drawPath:', typeof m.drawPath, '| makeToggles:', typeof m.makeToggles));
"
npm test
```

Expected: `node --check` 무출력, `drawPath: function | makeToggles: function`,
테스트 **48개 PASS**.

- [ ] **Step 4: 데모의 핵심 불변식을 브라우저 없이 확인**

readout 이 주장하는 것이 실제로 맞는지 Node 로 검산한다.

```bash
cd "D:/projects/joesiheon496.github.io"
node -e "
import('./static/js/mathviz/optimize.js').then(O => {
  const start = k => [2.6*Math.cos(Math.PI/3), (2.6/Math.sqrt(k))*Math.sin(Math.PI/3)];
  console.log('r=1 이 진동인가 (발산 아님):');
  for (const k of [6, 12, 30, 60]) {
    const p = O.gdPath({kappa:k, eta:O.divergenceEta(k), start:start(k), steps:300});
    const n = q => Math.hypot(q[0],q[1]);
    console.log('  k='+k, 'norm300='+n(p[300]).toFixed(4),
                'norm299='+n(p[299]).toFixed(4),
                p.every(O.isFinitePoint) ? 'finite OK' : 'DIVERGED');
  }
  console.log('r=1.05 는 발산인가:');
  for (const k of [6, 12, 30, 60]) {
    const p = O.gdPath({kappa:k, eta:1.05*O.divergenceEta(k), start:start(k), steps:300});
    const last = Math.hypot(p[300][0], p[300][1]);
    console.log('  k='+k, 'norm300=' + (Number.isFinite(last) ? last.toExponential(1) : 'Inf'),
                last > 1e3 || !Number.isFinite(last) ? 'DIVERGED OK' : 'NOT DIVERGED');
  }
  console.log('기본 설정(k=12, r=0.9, 40회)이 화면 안에서 수렴하는가:');
  const p = O.gdPath({kappa:12, eta:0.9*O.divergenceEta(12), start:start(12), steps:40});
  console.log('  도달 반복수', O.firstIndexBelow(p, 1e-3),
              '| 최대 |x|', Math.max(...p.map(q=>Math.abs(q[0]))).toFixed(2),
              '| 최대 |y|', Math.max(...p.map(q=>Math.abs(q[1]))).toFixed(2));
  console.log('κ 변경 시 y 재조정이 시작점을 등고선 위에 남기는가:');
  let s = start(12);
  for (const k of [20, 40, 60]) { s = [s[0], s[1]*Math.sqrt(12/k)]; }
  console.log('  k=60 으로 옮긴 뒤', s.map(v=>v.toFixed(3)),
              '| 기대', start(60).map(v=>v.toFixed(3)));
});
"
```

Expected:
- `r=1`: 네 κ 모두 `finite OK`, `norm300` 이 `norm299` 와 거의 같다 (진동)
- `r=1.05`: 네 κ 모두 `DIVERGED OK`
- 기본 설정: 도달 반복수가 **40 이하의 정수** (null 이면 기본값이 나쁘다 — 그러면
  `ratio` 기본값을 최적 비율 `κ/(1+κ)` = 0.92 에 더 가깝게 올린다)
- κ 재조정: 옮긴 뒤 값이 `기대` 와 소수 셋째 자리까지 같다

- [ ] **Step 5: 확인용 임시 글 만들고 서버 띄우기**

```bash
mkdir -p "D:/projects/joesiheon496.github.io/content/posts/_gdcheck"
cat > "D:/projects/joesiheon496.github.io/content/posts/_gdcheck/index.md" <<'EOF'
+++
title = "gd demo check"
date = 2026-01-01T00:00:00+09:00
math = true
+++

인라인 \(\kappa = \sigma_1/\sigma_2\) 과 블록:

$$ \kappa(X^\top X) = \left(\frac{\sigma_1}{\sigma_2}\right)^2 $$

{{< demo name="descent" >}}
EOF
export PATH="$PATH:/c/Program Files/Go/bin"
cd "D:/projects/joesiheon496.github.io"
hugo server --port 1313 --bind 127.0.0.1 --disableFastRender
```

- [ ] **Step 6: 브라우저에서 수동 검증**

`http://localhost:1313/posts/_gdcheck/` 에서 **직접 확인한다.**

1. 등고선 5개(타원)와 최소점 십자, 궤적(선 + 점), 시작점 핸들이 보인다
2. `κ` 를 1 → 60 으로 올리면 등고선이 납작해지고 궤적이 **지그재그**가 된다.
   등고선이 화면 밖으로 나가지 않는다
3. `η/문턱` 을 올리면 궤적이 커지고, **정확히 1.00** 에서
   `영원히 진동 — 정확히 문턱이다 (발산은 아니다)` 가 뜬다
4. `1.01` 이상에서 `발산 — 학습률이 문턱을 넘었다` 가 뜨고 궤적이 화면을 벗어난다
5. `반복` 을 0 으로 내리면 궤적이 점 하나만 남는다
6. κ 를 크게(예: 60) 하고 반복을 작게(예: 10) 하면 `미도달` 이 뜬다
7. **`최적 η 기준` 라벨이 붙은 수축률은 `η/문턱` 을 움직여도 바뀌지 않는다.**
   그 아래 `현재 η 의 실측 수축률` 은 바뀐다
8. κ = 1.0 에서 수축률이 `—`, 예상이 `한 번에 도달` 로 나오고 NaN 이 보이지 않는다
9. `모멘텀` 을 켜면 β 슬라이더가 효과를 내고 지그재그가 펴진다.
   readout 에 모멘텀 이론 수축률과 최적 β 가 나온다
10. 시작점을 끌면 궤적이 따라온다. κ 를 바꿔도 시작점이 등고선 위에 남는다
11. light / dark 양쪽에서 읽힌다. 좁은 폭에서 터치로 시작점을 끌 수 있다
12. 콘솔에 에러가 없다

- [ ] **Step 7: 커밋**

```bash
cd "D:/projects/joesiheon496.github.io"
git add static/js/mathviz/core.js static/js/mathviz/descent.js
git commit -m "feat: add gradient descent demo on elliptical contours

The learning rate slider is a ratio against the divergence threshold, not
an absolute value. The threshold 2/kappa spans 2.0 down to 0.033 over the
kappa range, so no single absolute slider can reach it at small kappa
while keeping it usable at large kappa. As a ratio the threshold always
sits at 1.0, which makes the oscillate-forever case directly reachable.

The contraction rate readout is labelled as holding at the optimal
learning rate only. Without that label a reader moves the slider, sees the
number stay put, and reads it as a bug.

drawPath exists because drawPolygon closes the path, which would join the
last trajectory point back to the first."
```

---

### Task 4: 데모 2 (2편 직선맞춤 재방문)

**Files:**
- Create: `static/js/mathviz/gdfit.js`

**Interfaces:**
- Consumes: Task 2 의 `olsKappa`, `olsClosed`, `olsGdPath`, `centerPoints`.
  Task 1 의 `firstIndexBelow`. Task 3 의 `makeToggles`.
  1·2편의 `themeColors`, `onThemeChange`, `createView`, `drawGrid`, `drawHandles`,
  `attachDrag`, `makeSliders`.
- Produces: `init(root)` (shortcode 규약)

- [ ] **Step 1: `gdfit.js` 구현**

```javascript
// static/js/mathviz/gdfit.js
// 데모 2 — 2편의 직선맞춤을 경사하강법으로 다시 푼다.
//
// 회색 선은 닫힌 해(2편의 의사역행렬), 진한 선은 현재 반복수에서의 GD 해다.
// 목적함수는 2편의 직교 회귀가 아니라 보통최소자승이다 — 그래야 볼록 이차함수가 되고
// 데모 1 의 수축률 이론이 그대로 적용된다. 잔차를 **세로** 선분으로 그려서
// 2편의 수직 거리와 다르다는 것을 눈으로 보이게 한다.
//
// x 중심화 토글은 답을 바꾸지 않는다 — 회색 선은 꿈쩍하지 않고 진한 선만 빨라진다.
// 그것이 이 데모의 요점이다.

import {
  olsKappa, olsClosed, olsGdPath, centerPoints, firstIndexBelow,
} from './optimize.js';
import {
  themeColors, onThemeChange, createView, drawGrid,
  drawHandles, attachDrag, makeSliders, makeToggles,
} from './core.js';

const WORLD = { xmin: -3, xmax: 3, ymin: -3, ymax: 3 };
const MAX_STEPS = 400;      // 스펙 §3-3

// 스펙 §2 의 "오른쪽 치우침" 배치 (원본 κ ≈ 29.5, 중심화 후 ≈ 1.37).
// 토글의 효과가 첫 화면에서 바로 보이도록 이 계열로 시작한다.
const INITIAL = [
  [0.5, 0.55], [1.0, 1.20], [1.5, 1.40],
  [2.0, 1.95], [2.5, 2.15], [3.0, 2.75],
];

const SLIDERS = [
  { key: 'steps', label: '반복', min: 0, max: MAX_STEPS, step: 1, value: 30,
    fmt: (v) => String(Math.round(v)) },
];

const TOGGLES = [{ key: 'center', label: 'x 중심화', value: false }];

/** y = a x + b 를 화면 폭 전체에 그린다. */
function drawLine(ctx, view, [a, b], color, width) {
  const x0 = WORLD.xmin, x1 = WORLD.xmax;
  const [px0, py0] = view.toPixel([x0, a * x0 + b]);
  const [px1, py1] = view.toPixel([x1, a * x1 + b]);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px1, py1); ctx.stroke();
}

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = createView(canvas, WORLD);
  const pts = INITIAL.map((p) => [...p]);
  const state = { steps: 30, center: false };

  const sliderHost = root.querySelector('.mv-sliders');
  makeSliders(sliderHost, SLIDERS, (v) => {
    Object.assign(state, v);
    draw();
  });
  // ⚠️ makeSliders 가 host 를 비우므로 반드시 그 뒤에 부른다.
  makeToggles(sliderHost, TOGGLES, (v) => {
    Object.assign(state, v);
    draw();
  });

  attachDrag(canvas, view, () => pts, (i, p) => {
    pts[i] = p;
    draw();
  });

  function draw() {
    const colors = themeColors();
    const steps = Math.round(state.steps);

    const closed = olsClosed(pts);
    const path = olsGdPath({ points: pts, steps, center: state.center });
    const current = path[path.length - 1];

    const rawK = olsKappa(pts).kappa;
    const { s1, s2 } = olsKappa(pts);
    const cenK = olsKappa(centerPoints(pts).points).kappa;

    drawGrid(ctx, view, colors);

    // 닫힌 해 — 중심화 토글과 무관하게 불변이다
    drawLine(ctx, view, closed, colors.muted, 3);
    // 현재 GD 해
    drawLine(ctx, view, current, colors.accent, 2);

    // y 방향 잔차 (2편은 수직 거리였다 — 이 차이가 목적함수 변경이다)
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    for (const [x, y] of pts) {
      const [px, py] = view.toPixel([x, y]);
      const [, fy] = view.toPixel([x, current[0] * x + current[1]]);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, fy); ctx.stroke();
    }

    drawHandles(ctx, view, pts, colors);
    root.querySelector('.mv-matrix-host').innerHTML = '';

    // ---- readout
    const gap = Math.hypot(current[0] - closed[0], current[1] - closed[1]);
    const full = olsGdPath({ points: pts, steps: MAX_STEPS, center: state.center });
    const reached = firstIndexBelow(full, 1e-3, closed);
    const activeK = state.center ? cenK : rawK;

    const fmtK = (k) => (Number.isFinite(k) ? k.toFixed(1) : '∞');
    root.querySelector('.mv-readout').innerHTML = `
      σ₁ = <b>${s1.toFixed(3)}</b> &nbsp; σ₂ = <b>${s2.toFixed(3)}</b>
      &nbsp; <b>κ = (σ₁/σ₂)² = ${fmtK(rawK)}</b><br>
      중심화 없이 κ = ${fmtK(rawK)} &nbsp;·&nbsp; 중심화하면 κ = ${fmtK(cenK)}
      ${Number.isFinite(rawK / cenK) ? `(<b>${(rawK / cenK).toFixed(1)}배</b>)` : ''}<br>
      현재 ${steps}회 · 닫힌 해와의 거리 <b>${gap.toExponential(1)}</b><br>
      ${reached === null
        ? `<span class="no">미도달</span> — κ = ${fmtK(activeK)} 에서는`
          + ` ${MAX_STEPS}회로도 목표에 못 간다`
        : `<span class="ok">${reached}회면 도달</span>`}`;

    root.querySelector('.mv-hint').textContent =
      '회색 선이 닫힌 해(2편의 의사역행렬), 진한 선이 현재 반복수의 경사하강법 해입니다. '
      + '점을 오른쪽으로 몰면 κ 가 뛰고 진한 선이 뒤처집니다. x 중심화 를 켜면 '
      + '회색 선은 그대로인데 진한 선만 즉시 따라붙습니다 — 같은 답인데 '
      + '반복 횟수만 줄어드는 것입니다. 회색 세로선은 y 방향 잔차이고, '
      + '2편의 수직 거리와 다릅니다.';
  }

  const redraw = () => { view.resize(); draw(); };
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
```

- [ ] **Step 2: 데모 2 의 핵심 불변식을 브라우저 없이 확인**

**회색 선이 토글과 무관하게 불변**이라는 것이 이 데모의 요점이다. 검산한다.

```bash
cd "D:/projects/joesiheon496.github.io"
node -e "
import('./static/js/mathviz/optimize.js').then(O => {
  const pts = [[0.5,0.55],[1.0,1.20],[1.5,1.40],[2.0,1.95],[2.5,2.15],[3.0,2.75]];
  const closed = O.olsClosed(pts);
  console.log('닫힌 해', closed.map(v=>v.toFixed(6)));
  console.log('원본 kappa', O.olsKappa(pts).kappa.toFixed(1),
              '| 중심화 kappa', O.olsKappa(O.centerPoints(pts).points).kappa.toFixed(2));
  const d = p => Math.hypot(p[0]-closed[0], p[1]-closed[1]);
  for (const c of [false, true]) {
    const path = O.olsGdPath({points: pts, steps: 400, center: c});
    console.log('center='+c,
      '| 30회 거리', d(path[30]).toExponential(2),
      '| 400회 거리', d(path[400]).toExponential(2),
      '| 도달', O.firstIndexBelow(path, 1e-3, closed));
  }
  // 화면 밖으로 나가는 배치에서도 유한한가
  const blob = [[2.9,1],[2.9,1.1],[2.9,0.9],[2.9,1.05],[2.9,0.95],[2.9,1.02]];
  const w = O.olsClosed(blob);
  console.log('x 가 모두 같은 퇴화 배치: 닫힌 해', w.map(v=>v.toFixed(3)),
              '| 유한', w.every(Number.isFinite),
              '| kappa', O.olsKappa(blob).kappa.toExponential(1));
});
"
```

Expected:
- `원본 kappa` ≈ **29.5**, `중심화 kappa` ≈ **1.37** (스펙 §2 실측값)
- `center=false` 의 30회 거리가 `center=true` 의 30회 거리보다 **훨씬 크다**
- `center=true` 의 도달 반복수가 **15 미만**, `center=false` 는 **50 이상**
- 퇴화 배치에서 닫힌 해가 `유한 true` (NaN 이 아니다)

- [ ] **Step 3: 문법 확인**

```bash
cd "D:/projects/joesiheon496.github.io"
node --check static/js/mathviz/gdfit.js
npm test
```

Expected: 무출력, 테스트 48개 PASS.

- [ ] **Step 4: 임시 글에 데모 2 추가**

```bash
cat >> "D:/projects/joesiheon496.github.io/content/posts/_gdcheck/index.md" <<'EOF'

{{< demo name="gdfit" >}}
EOF
```

서버가 꺼졌으면 다시 띄운다.

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "D:/projects/joesiheon496.github.io"
hugo server --port 1313 --bind 127.0.0.1 --disableFastRender
```

- [ ] **Step 5: 브라우저에서 수동 검증**

`http://localhost:1313/posts/_gdcheck/` 에서 **직접 확인한다.**

1. 점 6개, 회색 선(닫힌 해), 진한 선(GD), 회색 **세로** 잔차선이 보인다
2. `반복` 을 0 → 400 으로 올리면 진한 선이 회색 선으로 다가간다
3. **`x 중심화` 를 켜도 회색 선이 움직이지 않는다.** 진한 선만 즉시 따라붙는다
   — 이것이 틀리면 구현이 잘못됐다 (스펙 §3-4)
4. readout 의 `중심화 없이 κ` ≈ 29.5, `중심화하면 κ` ≈ 1.4, 배율 ≈ 21배
5. 점을 왼쪽·오른쪽 고르게 퍼뜨리면 κ 가 3 근처로 떨어지고 배율이 1배에 가까워진다
6. 점을 한 곳(같은 x)에 몰면 κ 가 매우 커지고 `미도달` 이 뜨는데 **NaN 이나 빈 화면이 없다**
7. 반복을 올릴 때 `닫힌 해와의 거리` 가 단조로 줄어든다
8. 데모 1 과 같은 페이지에서 서로 간섭하지 않는다 (한쪽 슬라이더가 다른 쪽에 영향 없음)
9. light / dark 양쪽에서 읽힌다. 좁은 폭에서 터치로 점을 끌 수 있다
10. 콘솔에 에러가 없다

8번이 중요하다 — shortcode 가 `.Ordinal` 로 id 를 만들므로 두 데모의 id 가 달라야 한다.

- [ ] **Step 6: 커밋**

```bash
cd "D:/projects/joesiheon496.github.io"
git add static/js/mathviz/gdfit.js
git commit -m "feat: add demo revisiting post 2's line fit with gradient descent

The grey closed-form line and the dark iterative line share one canvas, so
the two posts sit side by side. Residuals are drawn vertically rather than
perpendicular, which is what changing from orthogonal regression to
ordinary least squares looks like.

The centring toggle is the point: the answer does not move, only the
iteration count. Verified that the closed-form line is identical either
way, so a grey line that twitches when the toggle flips means the
coordinate conversion is wrong."
```

---

### Task 5: 글 작성 및 검증

**Files:**
- Create: `content/posts/gradient-descent/index.md`
- Delete: `content/posts/_gdcheck/`

**Interfaces:**
- Consumes: Task 3·4 의 두 데모, 1·2편의 `math = true` 와 `{{< demo >}}` shortcode,
  2편이 만든 `tools/check-math.py`
- Produces: 발행 가능한 글

- [ ] **Step 1: 글 작성**

`content/posts/gradient-descent/index.md` 를 만든다. 날짜는 **작성 시점의 현재 시각**을
쓴다 (`date "+%Y-%m-%dT%H:%M:%S+09:00"` 로 얻는다). 미래면 Hugo 가 제외한다.

```toml
+++
title = "경사하강법 — 조건수가 반복 횟수를 정한다"
date = <현재 시각, +09:00>
draft = false
math = true
tags = ["컴퓨터비전", "선형대수", "최적화", "경사하강법", "인터랙티브"]
categories = ["프로그램"]
summary = "2편에서 답을 한 번에 구했던 문제를 반복해서 풀어본다. 어떤 문제는 열 번에 끝나고 어떤 문제는 오천 번을 굴려도 안 끝나는데, 그 차이를 정하는 것이 2편에서 신뢰도로 썼던 바로 그 조건수다. 직접 만지는 데모 두 개를 넣었다."
+++
```

본문 구성. **축은 하나다** — "κ = σ₁/σ₂ 가 몇 번 반복해야 하는지를 정한다".

1. **한 줄 요약** + 2편으로 되돌아가는 고리: 2편은 σ₂/σ₁ 로 "답을 얼마나 믿을 수 있나"를
   재었다. 이번 글은 같은 수가 "몇 번 반복해야 하나"를 정한다는 것이다
2. **닫힌 해가 있는데 왜 반복하나** — 2편 직선맞춤은 한 번에 끝났다. 변수가 수백만 개면,
   또는 방정식이 선형이 아니면 그 길이 막힌다. 그때 남는 것이 반복이다
3. **목적함수를 바꾼 이유** (§목적함수를 바꾸는 이유, 스펙) — 2편은 수직 거리(직교 회귀)였고
   그 손실은 각도에 대해 주기적이라 볼록하지 않다. 이 글의 수축률 식은 볼록 이차함수에서만
   성립하므로 y 방향 잔차로 바꾼다. 데모 2 의 잔차선이 세로인 것이 그 차이다
4. **경사하강법이란** — 기울기의 반대로 조금씩 간다. 식 하나:

```
$$
w_{k+1} = w_k - \eta \nabla L(w_k)
$$
```

5. **데모 1** `{{< demo name="descent" >}}` — κ 를 키워 지그재그를 만들어 보라고 안내
6. **학습률** — 문턱이 `2/λ_max` 다. 넘으면 발산하고, **정확히 그 값이면 영원히 진동한다**
   (y 성분의 배율이 정확히 −1 이 되어 부호만 뒤집힌다). 데모에서 비율을 1.00 에 맞춰 확인
7. **κ 가 속도를 정한다** — 최적 학습률에서 오차가 매 스텝 `(κ−1)/(κ+1)` 배로 줄어든다.
   스펙 §2 의 검증 표를 옮긴다 (κ 2·10·30·50·100 의 수축률과 반복수).
   κ 가 커지면 이 값이 1 에 붙고, 반복수가 κ 에 거의 비례해 늘어난다
8. **2편의 σ 가 제곱되어 돌아온다** — 최소자승의 Hessian 이 `2XᵀX` 이므로:

```
$$
\kappa(\nabla^2 L) = \kappa(X^\top X) = \left(\frac{\sigma_1}{\sigma_2}\right)^2
$$
```

   2편에서 "작은 특이값을 나누는 것이 수치적 폭발의 정체"라고 했던 그 σ₂ 가 여기서는
   제곱된 채로 반복 횟수를 정한다. + **데모 2** `{{< demo name="gdfit" >}}`
9. **κ 를 줄이는 두 가지**
   - 데이터를 고친다: x 중심화·정규화. 데모 2 의 토글로 κ 29.5 → 1.4.
     **답은 같은데 반복 횟수만 줄어든다** — 회색 선이 움직이지 않는 것이 그 증거다
   - 계산을 고친다: 모멘텀. 의존성이 κ 에서 √κ 로 줄어든다.
     데모 1 의 모멘텀 토글. κ=100 에서 346회 → 56회(실측)
10. **컴퓨터 비전에서 왜 중요한가** — 세 가지를 짧게. **말로만 하고 구현하지 않는다**:
    - 번들 조정은 변수가 수만~수백만 개라 닫힌 해가 없다. 반복이 유일한 길이다
    - 2편에서 "체커보드를 여러 각도로 찍으라"고 한 것이 여기서는 **수렴 속도** 이야기가 된다.
      비슷한 각도만 찍으면 σ₂ 가 작아지고 κ 가 제곱으로 커진다
    - Levenberg–Marquardt 가 경사하강법과 가우스-뉴턴 사이를 오가는 이유가 이것이다 —
      곡률 정보를 넣어 유효 κ 를 낮추는 것
11. **정리** + 4편 예고 (모멘텀에서 Adam 까지: 적응적 학습률과 SGD 노이즈)

작성 규칙:
- **모든 수식 앞에 그 수식이 무슨 일을 하는지 한 문장을 먼저 둔다.**
  독자가 수식을 건너뛰어도 글이 이어져야 한다
- 블록 수식은 `$$...$$`, 인라인은 `\(...\)`
- **블록 수식 안에 `=` 를 홀로 한 줄에 두지 않는다** (Global Constraints 참조)
- 데모 1 을 소개할 때 **수축률이 최적 학습률 기준이라는 것을 본문에서도 한 번 말한다**.
  readout 라벨만으로는 놓치는 독자가 있다

- [ ] **Step 2: 임시 글 삭제**

```bash
rm -rf "D:/projects/joesiheon496.github.io/content/posts/_gdcheck"
rm -rf "D:/projects/joesiheon496.github.io/public/posts/_gdcheck"
```

`public/` 도 지운다. Hugo server 가 `public/` 에서 서빙하므로 남겨두면
삭제한 글이 계속 200 으로 응답한다 (1편에서 실제로 겪었다).

- [ ] **Step 3: 빌드하고 글이 나오는지 확인**

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
SCRATCH="C:/Users/a/AppData/Local/Temp/claude/D--projects-new-paper-plan/02e6be85-0170-4bdb-ab54-45d929bf847e/scratchpad"
cd "D:/projects/joesiheon496.github.io"
hugo --destination "$SCRATCH/gdfinal" --quiet > /d/tmp/hugo-gd.txt 2>&1
echo "hugo exit=$?"
grep -vE "deprecated|^$" /d/tmp/hugo-gd.txt | head -5
P="$SCRATCH/gdfinal/posts/gradient-descent/index.html"
ls "$P"
grep -c katex "$P"
grep -c "mv-demo" "$P"
grep -c "gradient-descent" "$SCRATCH/gdfinal/posts/index.html"
```

Expected: `hugo exit=0`, 경고 외 출력 없음, 파일 존재, `katex` > 0,
`mv-demo` = **2** (데모 두 개), 목록 페이지에 등장.

`hugo exit` 를 파이프 뒤에서 읽지 않는다 — 1편에서 `grep` 의 종료코드를
빌드 종료코드로 잘못 읽어 실패를 놓쳤다.

- [ ] **Step 4: 수식이 깨지지 않았는지 확인**

`tools/check-math.py` 는 2편에서 이미 만들었다. 그대로 쓴다.

```bash
SCRATCH="C:/Users/a/AppData/Local/Temp/claude/D--projects-new-paper-plan/02e6be85-0170-4bdb-ab54-45d929bf847e/scratchpad"
cd "D:/projects/joesiheon496.github.io"
python tools/check-math.py "$SCRATCH/gdfinal/posts/gradient-descent/index.html"
echo "exit=$?"
python tools/check-math.py "$SCRATCH/gdfinal/posts/svd/index.html"
python tools/check-math.py "$SCRATCH/gdfinal/posts/2d-transform-matrix/index.html"
```

Expected: 세 글 모두 `OK — 수식 손상 없음`, `exit=0`.
`block formulas` 개수가 글에 쓴 개수와 일치하는지도 눈으로 확인한다.

`FAIL` 이 나오면 스크립트가 어느 블록의 무엇이 문제인지 알려준다. 원인은 대개
그 수식에 `=` 가 홀로 한 줄에 있는 것이다 — 앞 줄 끝에 붙인다.

- [ ] **Step 5: 기존 글 회귀 확인**

설정 변경이 없으므로 회귀는 없어야 한다. 그래도 확인한다.

```bash
SCRATCH="C:/Users/a/AppData/Local/Temp/claude/D--projects-new-paper-plan/02e6be85-0170-4bdb-ab54-45d929bf847e/scratchpad"
grep -c katex "$SCRATCH/gdfinal/posts/pu-mask/index.html"
grep -c katex "$SCRATCH/gdfinal/posts/voxel-sampling-bench/index.html"
grep -c katex "$SCRATCH/gdfinal/posts/2d-transform-matrix/index.html"
grep -c katex "$SCRATCH/gdfinal/posts/svd/index.html"
grep -c "mv-demo" "$SCRATCH/gdfinal/posts/svd/index.html"
ls "$SCRATCH/gdfinal/posts/_gdcheck" 2>&1 | head -1
```

Expected: 앞의 두 개는 **0**, 1·2편 글은 **> 0**, 2편의 `mv-demo` 는 여전히 **2**,
`_gdcheck` 는 `No such file`.

2편의 `mv-demo` 가 2 인 것을 확인하는 이유: `core.js` 를 수정했으므로 1·2편 데모가
깨질 수 있다. 파일 끝에만 추가했으면 안전하다.

- [ ] **Step 6: 로컬 서버에서 최종 확인**

```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "D:/projects/joesiheon496.github.io"
hugo server --port 1313 --bind 127.0.0.1 --disableFastRender
```

`http://localhost:1313/posts/gradient-descent/` 에서 확인한다.

1. 수식이 KaTeX 로 렌더된다 (`\kappa`, `\nabla`, `\sigma` 가 글자로 남지 않는다)
2. 데모 두 개가 각각 동작하고 서로 간섭하지 않는다
3. light / dark 양쪽에서 수식과 두 데모가 모두 읽힌다
4. 좁은 폭에서 레이아웃이 깨지지 않는다
5. 1·2편 링크가 동작한다
6. **1·2편 글의 데모가 여전히 동작한다** (`/posts/2d-transform-matrix/`, `/posts/svd/`)
   — `core.js` 를 수정했으므로 반드시 본다
7. 콘솔에 에러가 없다

- [ ] **Step 7: 커밋**

```bash
cd "D:/projects/joesiheon496.github.io"
git add content/posts/gradient-descent/
git commit -m "post: gradient descent - the condition number sets the iteration count

Third post in the CV math series. It reuses post 2's number for a
different purpose: sigma2/sigma1 measured how much to trust an answer,
and kappa = sigma1/sigma2 measures how long it takes to find one. For
least squares the Hessian is 2X'X, so post 2's sigma enters squared.

Two ways to shrink kappa close the post: fix the data (centring, which
leaves the answer untouched and only cuts the iteration count) or fix the
computation (momentum, which trades kappa for sqrt(kappa))."
```

- [ ] **Step 8: 푸시는 사람의 승인을 받는다**

푸시하면 공개 발행된다. 자동으로 하지 않는다. 로컬 미리보기를 보여주고
명시적 승인을 받은 뒤에만 진행한다. 그 다음 `finishing-a-development-branch` 로
브랜치를 정리한다.

승인 후 사이드 작업이 대기 중이다 (스펙 §9): PaperMod `socialIcons`(GitHub·이메일)
추가와 `params.giscus` 플레이스홀더 점검. 별도 스펙 없이 `hugo.toml` 만 바꾸는 작업이다.

---

## 자체 검토

**스펙 커버리지**

| 스펙 항목 | 담당 |
|---|---|
| §글의 축 (κ 가 반복 횟수를 정한다) | Task 5 Step 1, 본문 구성 전체 |
| §2편과의 연결 — κ(XᵀX) = (σ₁/σ₂)² | Task 2 구현·테스트 2번, Task 4 readout, Task 5 Step 1 (8번) |
| §2편과의 연결 — 닫힌 해가 A⁺ | Task 2 `olsClosed`, Task 4 회색 선, Task 5 Step 1 (8번) |
| §목적함수를 바꾸는 이유 (볼록성) | Task 2 구현 주석, Task 4 세로 잔차, **Task 5 Step 1 (3번)** |
| §범위 — 모멘텀은 토글 + 한 절 | Task 3 `TOGGLES`·readout, Task 5 Step 1 (9번) |
| §범위 제외 (Adam·SGD·LM 구현) | Task 5 Step 1 (10번: 말로만), 11번(4편 예고) |
| §1 재사용/추가 파일 목록 | File Structure 표 |
| §1 `drawPath` 이유 (closePath) | Task 3 Step 1 주석 |
| §1 `makeToggles` 이유 (clamp 충돌) | Task 3 Step 1 주석 |
| §1 등고선 = 64각형 | Task 3 Step 2 `UNIT`·`contour` |
| §2 수축률 실측 표 | Task 1 테스트 1·2, Task 5 Step 1 (7번) |
| §2 발산 문턱 표 | Task 1 테스트 4·5, Task 3 Step 4 |
| §2 모멘텀 실측 표 | Task 1 테스트 7·8 |
| §2 OLS 일치 오차 | Task 2 테스트 2·4·6 |
| §2 중심화 실측 표 | Task 2 테스트 3·7·8, Task 4 Step 2 |
| §2 초기 배치 = 오른쪽 치우침 | Task 4 `INITIAL` |
| §3-1 κ=1 NaN | Task 1 `stepsToTarget` 조기반환, 테스트 3, Task 3 readout `kappaOne` |
| §3-2 문턱 = 진동, 판정은 `>` | Task 1 `divergenceEta` 주석, 테스트 4·5, Task 3 `verdict` |
| §3-3 미수렴이 정상 / 상한·미도달 | Task 1 `firstIndexBelow` null, Task 3 `MAX_STEPS`·`verdict`, Task 4 동일 |
| §3-4 중심화 = 같은 직선, 환산 | Task 2 `olsGdPath` 규약·테스트 7, Task 4 Step 5-3 |
| §3-5 모멘텀 허용오차 1% | Global Constraints, Task 1 테스트 7 |
| §4 학습률을 비율로 (이유) | Task 3 Step 2 파일 머리 주석, `SLIDERS` |
| §4 데모 1 컨트롤·그리기·readout | Task 3 Step 2 |
| §4 "최적 η 기준" 라벨 | Global Constraints, Task 3 readout, Task 3 Step 6-7 |
| §5 데모 2 컨트롤·그리기·readout | Task 4 Step 1 |
| §5 학습률 노출 안 함 | Task 4 `SLIDERS` (반복만), Task 2 `olsGdPath` 가 최적값 고정 |
| §6 API 목록 | Task 1·2 Interfaces |
| §6 테스트 10개 | Task 1 테스트 11개 + Task 2 테스트 8개 = 19개 (아래 주석 참조) |
| §7 글 구조 9절 | Task 5 Step 1 (1~11 항목이 스펙 9절을 덮는다) |
| §8-1 npm test | Task 1 Step 4, Task 2 Step 4, Task 3 Step 3, Task 4 Step 3 |
| §8-2 빌드·목록·날짜 | Task 5 Step 3 |
| §8-3 KaTeX, `=` 함정 | Global Constraints, Task 5 Step 4 |
| §8-4 데모 1 동작 | Task 3 Step 6 |
| §8-5 데모 2 회색 선 불변 | Task 4 Step 5-3 |
| §8-6 미도달 명시 | Task 3 Step 6-6, Task 4 Step 5-6 |
| §8-7 light/dark, 하드코딩 금지 | Task 3 Step 6-11, Task 4 Step 5-9, Task 5 Step 6-3 |
| §8-8 좁은 폭·터치 | Task 3 Step 6-11, Task 4 Step 5-9, Task 5 Step 6-4 |
| §8-9 기존 글 회귀 | Task 5 Step 5, Step 6-6 |
| §8-10 의존성 0 | Task 3·4 (import 는 상대 경로 ES 모듈만) |
| §9 후속 (4편, 소셜 아이콘) | Task 5 Step 1 (11번), Step 8 |

빠진 항목 없음.

**스펙에서 의도적으로 벗어난 곳 — 테스트 6·7**

스펙 §6 은 테스트 6 을 "`olsKappa().kappa` 가 `svd2x2(X)` 의 `(σ₁/σ₂)²` 와 일치",
테스트 7 을 "`olsClosed()` 가 `pseudoInverse2x2` 로 구한 해와 일치" 로 적었다.
**둘 다 그대로 쓰면 순환 검증이 된다** — 구현이 바로 그 두 함수를 쓰기 때문이다.
게다가 `svd2x2` 는 2×2 만 받으므로 `n×2` 설계행렬 `X` 에 직접 쓸 수도 없다.

그래서 독립 경로로 바꿨다. 검증 대상(2편↔3편 등식)은 그대로다.

- 테스트 6 → 특이값을 유일하게 결정하는 두 항등식으로 확인한다:
  `σ₁² + σ₂² = ‖X‖_F²` 와 `σ₁²σ₂² = det(XᵀX)`. 같은 고윳값 코드를 다시 돌리지 않는다.
  그리고 `κ = (σ₁/σ₂)²` 를 별도로 확인한다
- 테스트 7 → 정규방정식을 Cramer 로 직접 푼 값과 대조한다 (`closedByCramer`)

또 스펙이 "테스트 10개" 라고 한 것을 **19개**로 나눴다. 항목을 늘린 게 아니라 한 테스트에
뭉쳐 있던 주장을 쪼갠 것이다 (예: 스펙의 3번 하나가 "문턱=진동" 과 "1.01배=발산" 두 개로).
실패했을 때 어느 주장이 깨졌는지 바로 보이게 하려는 것이다.

**타입 일관성**

- `gdPath({kappa, eta, beta, start, steps})` 인자 이름이 Task 1 정의·테스트,
  Task 3 `draw` 호출에서 일치. `beta` 는 기본값 0
- `firstIndexBelow(path, tol, target)` 3인자 형태가 Task 1 정의·테스트,
  Task 3(`target` 생략 = 원점), Task 4(`target` = `closed`)에서 일치
- `olsKappa` 반환 `{s1, s2, kappa, l1, l2}` 가 Task 2 정의·테스트,
  Task 2 `olsGdPath` 내부(`l1, l2`), Task 4 `draw`(`s1, s2, kappa`)에서 일치
- `olsGdPath({points, steps, center})` 가 Task 2 정의·테스트, Task 4 두 호출부에서 일치.
  반환은 항상 **원 좌표** `[a, b]` 배열
- `centerPoints(points)` 반환 `{points, xbar}` 가 Task 2 정의·테스트,
  Task 2 `olsGdPath`, Task 4 `draw` 에서 일치
- `olsClosed(points)` 반환 `[a, b]` 가 Task 2 정의·테스트, Task 4 `draw` 에서 일치
- `drawPath(ctx, view, pts, {color, width})` 가 Task 3 정의, Task 3 `draw` 1회 호출에서 일치
- `makeToggles(el, defs, onInput)` 가 Task 3 정의, Task 3·4 각 1회 호출에서 일치.
  `defs` 는 `{key, label, value}` 형태로 두 곳 모두 동일
- `init(root)` 규약이 `descent.js`, `gdfit.js` 모두 동일하고 shortcode 가 기대하는 이름과 같다
- 슬라이더 `key` 가 `SLIDERS`/`TOGGLES` 정의와 `state` 필드에서 일치
  (데모 1: `kappa, ratio, steps, beta, momentum` / 데모 2: `steps, center`)

**알려진 위험**

1. **`makeSliders` → `makeToggles` 호출 순서.** `makeSliders` 가 `el.innerHTML = ''` 를
   하므로 순서를 바꾸면 슬라이더가 사라진다. Task 3·4 양쪽 코드에 경고 주석을 달았고
   Task 3 Step 6-9, Task 4 Step 5-3 의 브라우저 확인에서 걸린다.
2. **`.mv-slider input { width: 100% }` 가 체크박스를 늘린다.** CSS 를 수정하지 않는
   제약 때문에 인라인 `style.width = 'auto'` 로 되돌린다. Task 3 Step 1 에 있다.
   시각적으로 어긋나면 CSS 수정 대신 인라인 스타일을 조정한다.
3. **데모 1 의 기본값(κ=12, r=0.9, 40회)이 화면 안에서 수렴하지 않을 수 있다.**
   Task 3 Step 4 가 이것을 미리 검산하고, 실패 시 `ratio` 기본값을 최적 비율
   0.92 에 가깝게 올리라는 지시를 담았다.
4. **κ 를 바꿀 때 시작점 y 를 재조정하는 것**은 UX 판단이다. 재조정하지 않으면 κ 를
   키울 때 시작점이 등고선 바깥으로 튀어 화면을 벗어난다. Task 3 Step 4 가 재조정이
   시작점을 같은 등고선 위에 남기는지 확인한다.
5. `olsKappa` 를 `draw` 한 번에 세 번 호출한다(원본·중심화·구조분해). 6점 2×2 이므로
   비용이 무시할 수준이다. 최적화하지 않는다.
6. Task 4 의 readout 이 `MAX_STEPS` 궤적을 매 프레임 다시 계산한다(도달 반복수 표시용).
   400스텝 × 6점이라 무시할 수준이다. 느려지면 그때 캐시한다.
7. **`core.js` 수정이 1·2편 데모를 깨뜨릴 수 있다.** 파일 끝에만 추가하므로 안전하지만
   Task 5 Step 5(2편 `mv-demo` = 2 확인)와 Step 6-6(브라우저에서 1·2편 데모 확인)에서
   반드시 본다.
