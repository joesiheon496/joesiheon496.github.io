import test from 'node:test';
import assert from 'node:assert/strict';
import {
  add, sub, scale, dot, norm, normalize, cross,
  matMul, matVec, transpose, det3, inv3,
  rotX, rotY, rotZ, lookAt, cameraCenter,
} from '../../static/js/mathviz/camera.js';

const TOL = 1e-9;
const close = (a, b, tol = TOL, msg) => assert.ok(
  Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a} (허용 ${tol})`,
);
const closeVec = (a, b, tol = TOL, msg) => {
  assert.equal(a.length, b.length, `${msg ?? ''} 길이 불일치`);
  a.forEach((v, i) => close(v, b[i], tol, `${msg ?? ''} [${i}]`));
};
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
/** 정규직교 검사: M Mᵀ = I */
const isOrthonormal = (M, tol = TOL) => {
  const P = matMul(M, transpose(M));
  return P.every((row, i) => row.every((v, j) => Math.abs(v - I3[i][j]) <= tol));
};

test('matMul / matVec: 항등원과 결합법칙', () => {
  const A = [[1, 2, 3], [4, 5, 6], [7, 8, 10]];
  const B = [[2, 0, 1], [1, 3, 0], [0, 1, 4]];
  const C = [[1, 1, 0], [0, 2, 1], [3, 0, 1]];
  assert.deepEqual(matMul(A, I3), A);
  assert.deepEqual(matMul(I3, A), A);
  const v = [1, -2, 3];
  closeVec(matVec(I3, v), v, TOL, 'matVec 항등원');
  // (AB)C = A(BC)
  matMul(matMul(A, B), C).forEach((row, i) => closeVec(
    row, matMul(A, matMul(B, C))[i], TOL, '결합법칙',
  ));
  // (AB)v = A(Bv)
  closeVec(matVec(matMul(A, B), v), matVec(A, matVec(B, v)), TOL, 'matVec 결합');
});

test('rotX / rotY / rotZ 는 회전이다 — 정규직교이고 det = +1', () => {
  for (const rot of [rotX, rotY, rotZ]) {
    for (const a of [0, 0.3, -1.2, Math.PI / 2, 2.9]) {
      const R = rot(a);
      assert.ok(isOrthonormal(R), `정규직교 실패 (a=${a})`);
      close(det3(R), 1, TOL, `det (a=${a})`);
    }
  }
});

test('inv3 는 역행렬이다', () => {
  const A = [[2, 0, 1], [1, 3, 0], [0, 1, 4]];
  matMul(A, inv3(A)).forEach((row, i) => closeVec(row, I3[i], TOL, 'A·A⁻¹'));
  matMul(inv3(A), A).forEach((row, i) => closeVec(row, I3[i], TOL, 'A⁻¹·A'));
});

test('lookAt: R 은 정규직교이고 det = +1', () => {
  const cases = [
    { eye: [0, -6, 1.6], target: [0, 0, 0.8] },
    { eye: [5, -7, 20], target: [0, 0, 0.9] },
    { eye: [-3, 4, 2], target: [1, 1, 0] },
  ];
  for (const { eye, target } of cases) {
    const { R } = lookAt({ eye, target, up: [0, 0, 1] });
    assert.ok(isOrthonormal(R), `정규직교 실패 (eye=${eye})`);
    close(det3(R), 1, TOL, `det (eye=${eye})`);
  }
});

test('lookAt: 카메라 y 축은 아래를 향한다 (OpenCV 규약)', () => {
  // 규약을 코드로 못 박는다. y-down 이 아니면 이미지가 상하 반전된다.
  const up = [0, 0, 1];
  for (const eye of [[0, -6, 1.6], [5, -7, 20], [-3, 4, 2]]) {
    const { R } = lookAt({ eye, target: [0, 0, 0.8], up });
    assert.ok(dot(R[1], up) < 0, `y_cam·up = ${dot(R[1], up)} 이 음수여야 한다 (eye=${eye})`);
  }
});

test('cameraCenter 는 eye 를 복원하고, t 는 eye 가 아니다', () => {
  // 흔한 혼동: t 를 카메라 위치로 읽는 것. 스펙 §2-1
  const eye = [0, -6, 1.6];
  const cam = lookAt({ eye, target: [0, 0, 0.8], up: [0, 0, 1] });
  closeVec(cameraCenter(cam), eye, TOL, 'cameraCenter');
  closeVec(cam.t, [0, 0.7930, 6.1588], 1e-4, 't 실측값');
  assert.ok(norm(sub(cam.t, eye)) > 1, 't 와 eye 는 전혀 다른 벡터다');
});
