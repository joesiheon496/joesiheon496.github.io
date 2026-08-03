import test from 'node:test';
import assert from 'node:assert/strict';
import {
  add, sub, scale, dot, norm, normalize, cross,
  matMul, matVec, transpose, det3, inv3,
  rotX, rotY, rotZ, lookAt, cameraCenter,
  intrinsics, fovFromF, fFromFov, projectPoint, cameraMatrix, groundFromImage,
  NEAR, depthOf, clipSegmentNear, projectPolyline,
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
  // 위 검사만으로는 rotX = () => I3 같은 스텁도 통과한다 (항등행렬도 정규직교이고
  // det = 1). 각 축의 회전 "방향"을 기저벡터로 못 박는다 — 오른손 규칙:
  // rotX(90°): y → z, rotY(90°): z → x, rotZ(90°): x → y.
  closeVec(matVec(rotZ(Math.PI / 2), [1, 0, 0]), [0, 1, 0], TOL, 'rotZ(90°): x→y');
  closeVec(matVec(rotX(Math.PI / 2), [0, 1, 0]), [0, 0, 1], TOL, 'rotX(90°): y→z');
  closeVec(matVec(rotY(Math.PI / 2), [0, 0, 1]), [1, 0, 0], TOL, 'rotY(90°): z→x');
  // 90도 배수만으로는 R(-a) 부호 오류를 못 잡는다 (예: 180° 근방 대칭). 임의각으로
  // 비대각 성분의 부호가 뒤집힘을 확인한다.
  close(rotX(0.3)[1][2], -Math.sin(0.3), TOL, 'rotX(0.3)[1][2] 부호');
  close(rotX(-0.3)[1][2], Math.sin(0.3), TOL, 'rotX(-0.3)[1][2] 부호 반전');
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

const SIZE = 480, CX = 240, CY = 240, F0 = 500;
const K0 = () => intrinsics({ f: F0, cx: CX, cy: CY });
const BASE = () => ({ K: K0(), ...lookAt({ eye: [0, -6, 1.6], target: [0, 0, 0.8], up: [0, 0, 1] }) });
/** 카메라 좌표를 그대로 넣기 위한 항등 자세. */
const IDENT = (f = F0) => ({ K: intrinsics({ f, cx: CX, cy: CY }), R: I3, t: [0, 0, 0] });

test('projectPoint: 카메라 좌표에서 u - cx = f·X/Z 가 정확하다', () => {
  // ⚠️ 거리를 바꾸며 lookAt 을 다시 부르면 target 재조준으로 R 이 바뀌어 비가
  // 0.5 가 아니라 0.501665 가 된다. 스펙 §3-4. 그래서 R=I, t=0 으로 직접 검사한다.
  const cam = IDENT();
  for (const Z of [1, 2, 4, 8]) {
    const p = projectPoint(cam, [0.5, 0.25, Z]);
    close(p.u - CX, F0 * 0.5 / Z, TOL, `u (Z=${Z})`);
    close(p.v - CY, F0 * 0.25 / Z, TOL, `v (Z=${Z})`);
    close(p.z, Z, TOL, `z (Z=${Z})`);
  }
  // 깊이 2배 → 변위 정확히 절반
  const a = projectPoint(cam, [0.5, 0.25, 2]);
  const b = projectPoint(cam, [0.5, 0.25, 4]);
  close((b.u - CX) / (a.u - CX), 0.5, TOL, '깊이 2배');
});

test('projectPoint: f 를 2배 하면 주점 기준 변위가 2배다', () => {
  const X = [0.5, 0.25, 3];
  const one = projectPoint(IDENT(F0), X);
  const two = projectPoint(IDENT(2 * F0), X);
  close((two.u - CX) / (one.u - CX), 2, TOL, 'u 배율');
  close((two.v - CY) / (one.v - CY), 2, TOL, 'v 배율');
});

test('projectPoint: 광축 위의 점은 주점에 찍힌다', () => {
  const cam = BASE();
  const C = cameraCenter(cam);
  const zc = cam.R[2];                       // 시선 방향
  for (const s of [1, 5, 20]) {
    const p = projectPoint(cam, add(C, scale(zc, s)));
    close(p.u, CX, 1e-9, `u (s=${s})`);
    close(p.v, CY, 1e-9, `v (s=${s})`);
  }
});

test('cameraMatrix: P 의 동차 나눗셈이 projectPoint 와 같다', () => {
  const cam = BASE();
  const P = cameraMatrix(cam);
  assert.equal(P.length, 3);
  assert.equal(P[0].length, 4);
  for (const X of [[0, 0, 0], [1, 2, 0.5], [-3, 4, 2], [0.3, -1, 1]]) {
    const h = matVec(P, [...X, 1]);
    const p = projectPoint(cam, X);
    close(h[0] / h[2], p.u, TOL, 'u');
    close(h[1] / h[2], p.v, TOL, 'v');
  }
});

test('fovFromF 와 fFromFov 는 서로 역이다', () => {
  for (const f of [200, 300, 500, 800, 1600]) {
    close(fFromFov({ fov: fovFromF({ f, size: SIZE }), size: SIZE }), f, 1e-9, `f=${f}`);
  }
  for (const deg of [20, 45, 60, 90, 100]) {
    const fov = deg * Math.PI / 180;
    close(fovFromF({ f: fFromFov({ fov, size: SIZE }), size: SIZE }), fov, 1e-12, `${deg}°`);
  }
});

test('fovFromF: f = size/2 에서 FOV 가 정확히 90° 다', () => {
  close(fovFromF({ f: SIZE / 2, size: SIZE }), Math.PI / 2, 1e-15, '90도');
  // 스펙 §2-2 의 표
  const deg = (r) => r * 180 / Math.PI;
  close(deg(fovFromF({ f: 500, size: SIZE })), 51.28, 5e-3, 'f=500');
  close(deg(fovFromF({ f: 200, size: SIZE })), 100.39, 5e-3, 'f=200');
  close(deg(fovFromF({ f: 1600, size: SIZE })), 17.06, 5e-3, 'f=1600');
});

test('groundFromImage: 지면점 → 이미지 → 지면점 왕복, 지평선 위는 null', () => {
  // 데모의 드래그가 이 역투영을 쓴다 (장면 뷰 클릭 → 지면 좌표).
  const cam = { K: intrinsics({ f: 300, cx: CX, cy: CY }),
                ...lookAt({ eye: [5, -7, 20], target: [0, 0, 0.9], up: [0, 0, 1] }) };
  for (const P of [[0, 0, 0], [3, -2, 0], [-5, 4, 0], [7, 7, 0], [-8, -8, 0]]) {
    const p = projectPoint(cam, P);
    closeVec(groundFromImage(cam, [p.u, p.v]), P, 1e-9, `왕복 (${P})`);
  }
  // 지평선 위(하늘)를 클릭하면 지면과 만나지 않는다
  const level = { K: K0(), ...lookAt({ eye: [0, -6, 1.6], target: [0, 1, 1.6], up: [0, 0, 1] }) };
  assert.equal(groundFromImage(level, [CX, 10]), null, '지평선 위는 null');
});

test('clipSegmentNear: 앞앞은 그대로, 뒤뒤는 null, 앞뒤는 근평면에서 자른다', () => {
  const cam = BASE();
  const A = [0, 2, 0.5], B = [0, -20, 0.5];
  close(depthOf(cam, A), 8.0752, 1e-4, 'za');
  close(depthOf(cam, B), -13.7318, 1e-4, 'zb');

  // 둘 다 앞
  const both = clipSegmentNear([0, 2, 0.5], [0, 4, 0.5], cam);
  assert.deepEqual(both, { a: [0, 2, 0.5], b: [0, 4, 0.5] }, '앞앞은 원본 그대로');

  // 둘 다 뒤
  assert.equal(clipSegmentNear([0, -30, 0], [0, -40, 0], cam), null, '뒤뒤는 null');

  // 앞뒤 — 자른 점의 깊이가 정확히 NEAR
  const cut = clipSegmentNear(A, B, cam);
  assert.notEqual(cut, null);
  closeVec(cut.a, A, TOL, '앞 끝점은 그대로');
  close(depthOf(cam, cut.b), NEAR, 1e-12, '자른 점 깊이');

  // 뒤앞 (순서 반대) — 자른 쪽이 a 가 된다
  const rev = clipSegmentNear(B, A, cam);
  close(depthOf(cam, rev.a), NEAR, 1e-12, '반대 순서에서 자른 점 깊이');
  closeVec(rev.b, A, TOL, '반대 순서의 앞 끝점');
});

test('clipSegmentNear: 자른 점은 원래 선분 위에 있다', () => {
  const cam = BASE();
  const A = [0, 2, 0.5], B = [0, -20, 0.5];
  const cut = clipSegmentNear(A, B, cam);
  // 공선성: (B-A) × (cut-A) = 0
  close(norm(cross(sub(B, A), sub(cut.b, A))), 0, 1e-9, '공선성');
  closeVec(cut.b, [0, -6.145658, 0.5], 1e-6, '자른 점 실측값');
});

test('projectPolyline: 근평면을 지나는 폴리라인이 조각으로 나뉜다', () => {
  const cam = BASE();
  // 앞 → 뒤 → 앞. 가운데 점이 카메라 뒤라 두 조각이 나와야 한다.
  const pts = [[0, 2, 0.5], [0, -20, 0.5], [0, 2, 1.5]];
  const runs = projectPolyline(cam, pts);
  assert.equal(runs.length, 2, '두 조각으로 나뉜다');
  for (const run of runs) {
    assert.ok(run.length >= 2, '조각마다 점이 둘 이상');
    for (const [u, v] of run) {
      assert.ok(Number.isFinite(u) && Number.isFinite(v), `유한해야 한다: ${u},${v}`);
    }
  }

  // 🔑 클리핑이 고치는 것은 좌표의 **크기**가 아니라 **방향**이다.
  //
  // 근평면에서 자른 점은 깊이가 정확히 NEAR(1e-3) 이므로 u = cx + f·Xc/Zc 에서
  // v 가 55만 px 로 커지는 것이 **정상이다.** 그 선은 실제로 이미지에서 무한을 향해
  // 물러나므로 캔버스가 알아서 자른다. 크기 상한(|v| < 1e5)을 걸면 옳은 구현이 실패한다.
  //
  // 진짜 버그는 자르지 않았을 때 뒤쪽 점이 **반대편으로 뒤집혀** 화면을 가로지르는
  // 선이 생기는 것이다. 그래서 뒤집힘을 직접 검사한다.
  const vFront = projectPoint(cam, pts[0]).v;
  const vClipped = runs[0][runs[0].length - 1][1];
  const vNaive = projectPoint(cam, pts[1]).v;
  close(vFront, 242.05, 1e-2, '앞 끝점 v');
  close(vNaive, 132.93, 1e-2, '자르지 않은 뒤쪽 점 v (뒤집힌 값)');
  assert.ok(vClipped > 1e5, `자른 점은 깊이가 NEAR 라 v 가 크다: ${vClipped}`);
  assert.ok((vClipped - vFront) * (vNaive - vFront) < 0,
    '자른 점과 자르지 않은 점은 앞 끝점 기준 반대편이어야 한다 — '
    + `그게 클리핑이 막는 버그다 (clipped ${vClipped}, naive ${vNaive})`);

  // 전부 앞이면 한 조각, 점 개수 유지
  const allFront = projectPolyline(cam, [[0, 2, 0], [1, 3, 0], [2, 4, 0]]);
  assert.equal(allFront.length, 1);
  assert.equal(allFront[0].length, 3);

  // 전부 뒤면 빈 배열
  assert.deepEqual(projectPolyline(cam, [[0, -30, 0], [1, -35, 0]]), []);

  // closed: 마지막→처음 변까지 그린다
  const sq = [[-1, 2, 0], [1, 2, 0], [1, 4, 0], [-1, 4, 0]];
  assert.equal(projectPolyline(cam, sq, { closed: true })[0].length, 5, '닫으면 점이 하나 늘어난다');
  assert.equal(projectPolyline(cam, sq)[0].length, 4, '열면 그대로');
});
