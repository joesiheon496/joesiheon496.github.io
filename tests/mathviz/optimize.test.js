import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  quadGrad, quadLoss, optimalEta, divergenceEta, contractionRate,
  momentumRate, optimalBeta, optimalMomentumEta, stepsToTarget,
  gdPath, isFinitePoint, firstIndexBelow,
  olsDesign, olsKappa, olsClosed, centerPoints, olsGdPath,
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
