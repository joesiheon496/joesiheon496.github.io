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
