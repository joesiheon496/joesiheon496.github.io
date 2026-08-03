import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lookAt, intrinsics, projectPoint, cameraCenter, matMul, matVec, transpose, dot,
} from '../../static/js/mathviz/camera.js';
import {
  jacobiEig, smallestEigVec, svd3, skew, relativePose,
  essentialFromCameras, fundamentalFromCameras, epipoles,
  epipolarLineInSecond, epipolarLineInFirst, pointLineDistance,
  normalizeMatrix, frobenius, matDiffUpToScale,
} from '../../static/js/mathviz/epipolar.js';

const TOL = 1e-9;
const close = (a, b, tol = TOL, msg) => assert.ok(
  Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a} (허용 ${tol})`,
);
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// 스펙 §2 기준 설정 — 6편의 K 를 그대로 쓴다
const K = intrinsics({ f: 500, cx: 240, cy: 240 });
const UP = [0, 0, 1];
const TARGET = [0, 0, 0.8];
/** 좌우 스테레오 — 베이스라인 4 m, 에피폴이 화면 밖 */
const STEREO = () => [
  { K, ...lookAt({ eye: [-2, -6, 1.6], target: TARGET, up: UP }) },
  { K, ...lookAt({ eye: [2, -6, 1.6], target: TARGET, up: UP }) },
];
/** 전진 + 약간 좌우 — 데모 기본값, 에피폴 둘 다 화면 안 (스펙 §2-4) */
const FORWARD = () => [
  { K, ...lookAt({ eye: [-0.5, -8, 1.6], target: TARGET, up: UP }) },
  { K, ...lookAt({ eye: [0.5, -4, 1.6], target: TARGET, up: UP }) },
];
const PTS = [
  [0, 0, 0], [0.5, 0.5, 1], [-0.5, -0.5, 0], [3, 2, 0], [-3, 4, 0],
  [1, -1, 0.5], [2, 5, 1.5], [-2, 1, 2], [0.3, 0.7, 0], [4, -1, 0.2],
];
const correspond = (c1, c2, pts = PTS) => pts.map((X) => {
  const a = projectPoint(c1, X), b = projectPoint(c2, X);
  return [[a.u, a.v], [b.u, b.v]];
});

test('jacobiEig: 대칭행렬을 재구성한다 (V diag(λ) Vᵀ = A)', () => {
  const A = [[4, 1, -2], [1, 3, 0.5], [-2, 0.5, 6]];
  const { values, vectors } = jacobiEig(A);
  const D = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? values[i] : 0)));
  const back = matMul(vectors, matMul(D, transpose(vectors)));
  back.forEach((row, i) => row.forEach((v, j) => close(v, A[i][j], 1e-10, `[${i}][${j}]`)));
  // 고유벡터는 정규직교여야 한다
  const P = matMul(transpose(vectors), vectors);
  P.forEach((row, i) => row.forEach((v, j) => close(v, I3[i][j], 1e-10, `직교 [${i}][${j}]`)));
});

test('jacobiEig: 9×9 에서도 돈다 (8점 알고리즘이 이 크기를 쓴다)', () => {
  // 무작위 대신 재현 가능한 대칭행렬을 만든다
  const B = Array.from({ length: 9 }, (_, i) => (
    Array.from({ length: 9 }, (_, j) => Math.sin(i * 3 + j * 7) + (i === j ? 5 : 0))
  ));
  const A = B.map((row, i) => row.map((v, j) => (v + B[j][i]) / 2));
  const { values, vectors } = jacobiEig(A);
  assert.equal(values.length, 9);
  const D = values.map((l, i) => values.map((_, j) => (i === j ? l : 0)));
  const back = matMul(vectors, matMul(D, transpose(vectors)));
  back.forEach((row, i) => row.forEach((v, j) => close(v, A[i][j], 1e-9, `[${i}][${j}]`)));
});

test('smallestEigVec: AᵀA 의 널공간을 찾는다', () => {
  // 알려진 널공간을 가진 A: 세 번째 열이 앞 두 열의 합
  const A = [[1, 2, 3], [0, 1, 1], [2, 1, 3], [1, 1, 2]];
  const AtA = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (
    A.reduce((s, r) => s + r[i] * r[j], 0)
  )));
  const v = smallestEigVec(AtA);
  // A·v ≈ 0
  for (const row of A) close(dot(row, v), 0, 1e-9, 'A·v');
});

test('svd3: U diag(S) Vᵀ 가 원본을 재구성하고 S 가 내림차순이다', () => {
  const M = [[3, 1, 0.5], [-1, 2, 1], [0.5, 0, 1.5]];
  const { U, S, V } = svd3(M);
  assert.ok(S[0] >= S[1] && S[1] >= S[2], `내림차순이어야 한다: ${S}`);
  const D = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? S[i] : 0)));
  const back = matMul(U, matMul(D, transpose(V)));
  back.forEach((row, i) => row.forEach((v, j) => close(v, M[i][j], 1e-9, `[${i}][${j}]`)));
});

test('skew: [t]ₓ v = t × v 이고 [t]ₓ t = 0', () => {
  const t = [1, -2, 3], v = [0.5, 1, -1];
  const viaSkew = matVec(skew(t), v);
  const viaCross = [
    t[1] * v[2] - t[2] * v[1], t[2] * v[0] - t[0] * v[2], t[0] * v[1] - t[1] * v[0],
  ];
  viaSkew.forEach((x, i) => close(x, viaCross[i], TOL, `성분 ${i}`));
  matVec(skew(t), t).forEach((x, i) => close(x, 0, TOL, `[t]ₓt 성분 ${i}`));
});

test('relativePose: X₂ = R X₁ + t 가 실제 카메라 좌표를 맞춘다', () => {
  const [c1, c2] = STEREO();
  const { R, t } = relativePose(c1, c2);
  for (const X of PTS) {
    const X1 = matVec(c1.R, X).map((v, i) => v + c1.t[i]);
    const X2 = matVec(c2.R, X).map((v, i) => v + c2.t[i]);
    const pred = matVec(R, X1).map((v, i) => v + t[i]);
    pred.forEach((v, i) => close(v, X2[i], 1e-9, `점 ${X} 성분 ${i}`));
  }
});

test('🔑 에피폴라 제약 x₂ᵀ F x₁ = 0 (스펙 §2-1)', () => {
  const [c1, c2] = STEREO();
  const F = fundamentalFromCameras(c1, c2);
  let worst = 0;
  for (const [x1, x2] of correspond(c1, c2)) {
    worst = Math.max(worst, Math.abs(dot([...x2, 1], matVec(F, [...x1, 1]))));
  }
  assert.ok(worst < 1e-12, `최대 잔차 ${worst.toExponential(3)} (실측 4.441e-16)`);

  // 전진 배치에서도 같다
  const [f1, f2] = FORWARD();
  const Ff = fundamentalFromCameras(f1, f2);
  for (const [x1, x2] of correspond(f1, f2)) {
    close(dot([...x2, 1], matVec(Ff, [...x1, 1])), 0, 1e-12, '전진 배치');
  }
});

test('🔑 F 는 rank 2 다 — det = 0, σ3 = 0 (스펙 §2-2)', () => {
  for (const [c1, c2] of [STEREO(), FORWARD()].map((p) => p)) {
    const F = fundamentalFromCameras(c1, c2);
    const { S } = svd3(F);
    assert.ok(S[0] > 0, 'σ1 > 0');
    assert.ok(S[1] > 0, 'σ2 > 0 — rank 1 이 아니다');
    close(S[2] / S[0], 0, 1e-12, 'σ3/σ1');
  }
  // 스테레오 배치의 실측 특이값 (스펙 §2-2)
  const F = fundamentalFromCameras(...STEREO());
  const { S } = svd3(normalizeMatrix(F));
  close(S[1] / S[0], 3.14e-4, 1e-6, 'σ2/σ1 실측');
});

test('🔑 에피폴은 다른 카메라의 이미지다 — 6편 매듭 (스펙 §2-3)', () => {
  const [c1, c2] = STEREO();
  const F = fundamentalFromCameras(c1, c2);
  const { e1, e2 } = epipoles(F);

  // e1 은 카메라 2 의 광심을 카메라 1 에 투영한 것
  const p1 = projectPoint(c1, cameraCenter(c2));
  const p2 = projectPoint(c2, cameraCenter(c1));
  assert.equal(e1.atInfinity, false);
  assert.equal(e2.atInfinity, false);
  close(e1.u, p1.u, 1e-6, 'e1.u');
  close(e1.v, p1.v, 1e-6, 'e1.v');
  close(e2.u, p2.u, 1e-6, 'e2.u');
  close(e2.v, p2.v, 1e-6, 'e2.v');

  // 스펙 §2-3 의 실측값
  close(e1.u, 1751.9524, 1e-3, 'e1 실측 u');
  close(e1.v, 176.7544, 1e-3, 'e1 실측 v');
  close(e2.u, -1271.9524, 1e-3, 'e2 실측 u');
  close(e2.v, 176.7544, 1e-3, 'e2 실측 v');
});

test('에피폴라 직선은 전부 에피폴을 지난다 (스펙 §2-3)', () => {
  const [c1, c2] = STEREO();
  const F = fundamentalFromCameras(c1, c2);
  const { e1, e2 } = epipoles(F);
  let worst = 0;
  for (const [x1, x2] of correspond(c1, c2)) {
    worst = Math.max(
      worst,
      pointLineDistance(epipolarLineInSecond(F, x1), [e2.u, e2.v]),
      pointLineDistance(epipolarLineInFirst(F, x2), [e1.u, e1.v]),
    );
  }
  assert.ok(worst < 1e-6, `에피폴에서 벗어난 최대 거리 ${worst.toExponential(2)} px (실측 1.01e-9)`);
});

test('🔑 배치가 에피폴을 화면 안에 넣는다 — 데모 기본값 근거 (스펙 §2-4)', () => {
  const SIZE = 480;
  const inImage = (e) => !e.atInfinity && e.u >= 0 && e.u <= SIZE && e.v >= 0 && e.v <= SIZE;

  // 좌우 스테레오는 둘 다 화면 밖
  const s = epipoles(fundamentalFromCameras(...STEREO()));
  assert.equal(inImage(s.e1), false, '스테레오 e1 은 화면 밖이어야 한다');
  assert.equal(inImage(s.e2), false, '스테레오 e2 은 화면 밖이어야 한다');

  // 전진 + 약간 좌우는 둘 다 화면 안 — 그래서 이걸 기본값으로 쓴다
  const f = epipoles(fundamentalFromCameras(...FORWARD()));
  assert.ok(inImage(f.e1), `전진 e1 이 화면 안이어야 한다: (${f.e1.u}, ${f.e1.v})`);
  assert.ok(inImage(f.e2), `전진 e2 이 화면 안이어야 한다: (${f.e2.u}, ${f.e2.v})`);
  close(f.e1.u, 333, 1, '전진 e1 실측 u');
  close(f.e1.v, 190, 1, '전진 e1 실측 v');
  close(f.e2.u, 437, 1, '전진 e2 실측 u');
  close(f.e2.v, 141, 1, '전진 e2 실측 v');
});

test('E 와 F 의 관계, 그리고 스케일 무관 비교', () => {
  const [c1, c2] = STEREO();
  const E = essentialFromCameras(c1, c2);
  const F = fundamentalFromCameras(c1, c2);
  // E 도 rank 2
  close(svd3(E).S[2] / svd3(E).S[0], 0, 1e-12, 'E 의 σ3/σ1');
  // 스케일을 곱해도 같은 행렬로 취급된다
  const scaled = F.map((row) => row.map((v) => v * -7.3));
  close(matDiffUpToScale(F, scaled), 0, 1e-12, 'cF 는 F 와 같다');
  close(frobenius(normalizeMatrix(F)), 1, TOL, 'Frobenius 정규화');
  // 다른 행렬은 0 이 아니다 — 지표가 무의미하지 않은지 확인
  assert.ok(matDiffUpToScale(F, E) > 1e-3, 'F 와 E 는 다른 행렬이다');
});
