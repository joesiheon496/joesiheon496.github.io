import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  identity, rigid, similarity, affine, homographyFromQuads,
  apply, applyAll, preservation, decomposeAffine, UNIT_SQUARE,
  svd2x2, svdRotationForm, pseudoInverse2x2, linear2x2,
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

test('decomposeAffine 은 affine 의 왕복이다', () => {
  const p = { theta: 0.6, sx: 1.4, sy: 0.7, shear: -0.3, tx: 1.2, ty: -0.8 };
  const got = decomposeAffine(affine(p));
  for (const k of Object.keys(p)) near(got[k], p[k], 1e-12);
});

test('decomposeAffine: rigid 는 스케일 1, 전단 0 으로 분해된다', () => {
  const got = decomposeAffine(rigid({ theta: -0.9, tx: 3, ty: 4 }));
  near(got.theta, -0.9, 1e-12);
  near(got.sx, 1, 1e-12);
  near(got.sy, 1, 1e-12);
  near(got.shear, 0, 1e-12);
  near(got.tx, 3); near(got.ty, 4);
});

test('decomposeAffine: similarity 는 sx = sy = s 로 분해된다', () => {
  const got = decomposeAffine(similarity({ theta: 0.4, s: 1.7, tx: 0, ty: 0 }));
  near(got.sx, 1.7, 1e-12);
  near(got.sy, 1.7, 1e-12);
  near(got.shear, 0, 1e-12);
});

test('decomposeAffine 은 homography 의 원근항을 버리고 선형부만 본다', () => {
  // 원근이 있어도 예외 없이 선형부를 돌려준다 (클래스 전환 시 필요)
  const dst = [[0, 0], [1, 0], [0.7, 1], [0.3, 1]];
  const got = decomposeAffine(homographyFromQuads(UNIT_SQUARE, dst));
  assert.ok(Number.isFinite(got.theta) && Number.isFinite(got.sx));
  assert.ok(got.sx > 0);
});

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
  near(Math.hypot(r.u1[0], r.u1[1]), 1, 1e-12);
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
    if (Math.abs(d) < 1e-9) continue;
    const { s2signed } = svdRotationForm(A);
    assert.equal(Math.sign(s2signed), Math.sign(d),
      `부호 불일치 ${JSON.stringify(A)} det=${d} σ2=${s2signed}`);
  }
});

test('linear2x2: 3×3 동차행렬에서 왼쪽 위 2×2 를 떼낸다', () => {
  const M = affine({ theta: 0, sx: 2, sy: 3, shear: 0.5, tx: 9, ty: -9 });
  assert.deepEqual(linear2x2(M), [[2, 0.5], [0, 3]]);
});
