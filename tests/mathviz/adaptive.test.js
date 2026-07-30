import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rotatedHessian, quadGradA, symEig2, diagPreconditionedKappa,
  KINDS, initState, optimizerStep, effectiveEta, optPath,
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
