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
