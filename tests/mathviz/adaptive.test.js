import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rotatedHessian, quadGradA, symEig2, diagPreconditionedKappa,
  KINDS, initState, optimizerStep, effectiveEta, optPath,
  DEFAULT_STARTS, stepsToTolOne, stepsToTol, bestEta, OLS_ETA,
  olsOffDiagonal, olsOptPath,
} from '../../static/js/mathviz/adaptive.js';
import { olsClosed, olsKappa, centerPoints } from '../../static/js/mathviz/optimize.js';

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

test('optPath: 발산해도 유한하지 않은 점을 돌려주지 않는다', () => {
  // η 를 발산 문턱 2/κ 훨씬 위로 밀면 궤적이 터진다. 그때도 마지막 점이 유한해야 한다 —
  // 호출자가 path[path.length-1] 을 "현재 위치" 로 읽기 때문이다.
  const A = rotatedHessian(30, 0);
  const path = optPath({ kind: 'gd', A, start: [2, 1], steps: 200, eta: 5 });
  assert.ok(path.length >= 1, '적어도 시작점은 있어야 한다');
  assert.ok(path.length < 201, '발산했으면 끝까지 가지 않는다');
  for (const [x, y] of path) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y), `유한하지 않은 점: ${x}, ${y}`);
  }
});

test('KINDS: 다섯 방법이고 전부 optimizerStep 을 통과한다', () => {
  assert.equal(KINDS.length, 5);
  for (const kind of KINDS) {
    const { step } = optimizerStep(kind, initState(), [1, -1], { eta: 0.1 });
    assert.ok(Number.isFinite(step[0]) && Number.isFinite(step[1]), kind);
  }
});

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

  // ⚠️ 위 두 단정은 시작점이 하나뿐이라 "평균에 대해 η 를 고른다" 와 "시작점마다 고른다" 를
  // 구별하지 못한다 — 하나짜리 배열에서는 두 전략이 같은 연산이다. 서로 다른 고윳값의
  // 고유벡터 둘을 함께 넣으면 갈린다. θ=45° 에서 [1,1] 은 λ=1, [1,-1] 은 λ=100 의
  // 고유벡터라, 공유 η 하나로는 둘을 한 스텝에 없앨 수 없다.
  // 실측: 공유 η 는 209 회, 시작점마다 고르면 각각 1 회(평균 1)다.
  const mixed = bestEta({ kind: 'gd', A, starts: [[1, 1], [1, -1]] });
  assert.ok(mixed.iters > 5,
    `서로 다른 고유벡터 둘에는 공유 η 하나로 한 스텝에 도달할 수 없다: ${mixed.iters}`);
  assert.equal(bestEta({ kind: 'gd', A, starts: [[1, -1]] }).iters, 1,
    '각 고유벡터 단독으로는 1 회여야 한다 — 위 단정이 그 대비다');

  assert.ok(!DEFAULT_STARTS.some(([x, y]) => Math.abs(Math.abs(x) - Math.abs(y)) < 1e-9),
    'DEFAULT_STARTS 에 |x| = |y| 인 점이 있으면 45° 에서 고유벡터가 된다');
  assert.equal(DEFAULT_STARTS.length, 5);
});

test('OLS_ETA: 데모 2 가 쓰는 두 방법에 측정된 값이 있다', () => {
  // 스펙 §2-3b 실측. Adam 에 0.1 을 쓰면 중심화 OFF 가 ON 보다 빨라져 서사가 뒤집힌다.
  assert.equal(OLS_ETA.rmsprop, 0.05);
  assert.equal(OLS_ETA.adam, 0.05);
});

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
