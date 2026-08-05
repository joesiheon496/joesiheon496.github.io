import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matMul, transpose, det3, norm, sub, scale, dot, normalize, rotZ,
} from '../../static/js/mathviz/camera.js';
import {
  I3, madd, msub, mscale, trace, orthError, angleBetween, matDistance, vee,
  eulerToR, rToEuler, eulerKappa, eulerJacDet, eulerJacobian, dofCollapse,
  expSO3, expKappa, expJacDet, logSO3, logSO3Naive,
  nearestRotation, meanRotation,
  quatFromR, rFromQuat, slerp, interpolate, pathMetrics,
  makeRng, gaussian, perturb,
} from '../../static/js/mathviz/so3.js';
import { svd3, skew, frobenius } from '../../static/js/mathviz/epipolar.js';

const close = (a, b, tol, msg) => assert.ok(
  Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a} (허용 ${tol})`,
);
const rel = (a, b, frac, msg) => assert.ok(
  Math.abs(a - b) <= frac * Math.abs(b),
  `${msg ?? ''} expected ${b}, got ${a} (상대허용 ${frac})`,
);
const D = 180 / Math.PI;
const rad = (deg) => deg / D;
const kappaOf = (A) => { const S = svd3(A).S; return S[0] / S[2]; };
const randR = (r) => expSO3(scale(
  normalize([gaussian(r), gaussian(r), gaussian(r)]), r() * Math.PI,
));

// ================= §2-1. 회전은 더할 수 없다 =================

test('§2-1 두 회전의 합은 회전이 아니다 — det 가 8.0 에서 0.0006 까지', () => {
  const r = makeRng(1);
  const expect = {
    1: [7.9994, 0.999924], 45: [6.8284, 0.853553],
    90: [4.0, 0.5], 179: [0.0006, 0.000076],
  };
  for (const [degStr, [detSum, detHalf]] of Object.entries(expect)) {
    const deg = Number(degStr);
    const R1 = randR(r);
    const axis = normalize([gaussian(r), gaussian(r), gaussian(r)]);
    const R2 = matMul(expSO3(scale(axis, rad(deg))), R1);
    const S = madd(R1, R2);
    close(det3(S), detSum, 5e-3, `${deg}° det(R1+R2)`);
    close(det3(mscale(S, 0.5)), detHalf, 5e-4, `${deg}° det((R1+R2)/2)`);
    assert.ok(orthError(S) > 3, `${deg}° 직교이탈 ${orthError(S)}`);
  }
});

test('§2-1 🔑 두 회전에 한해 투영한 산술평균 = 측지선 중점', () => {
  const r = makeRng(1);
  for (const deg of [1, 10, 45, 90, 150, 179]) {
    const R1 = randR(r);
    const axis = normalize([gaussian(r), gaussian(r), gaussian(r)]);
    const R2 = matMul(expSO3(scale(axis, rad(deg))), R1);
    const proj = nearestRotation(mscale(madd(R1, R2), 0.5));
    const mid = matMul(expSO3(scale(logSO3(matMul(R2, transpose(R1))), 0.5)), R1);
    assert.ok(angleBetween(proj, mid) * D < 1e-4,
      `${deg}° 일치오차 ${angleBetween(proj, mid) * D}°`);
  }
});

// ================= §2-2. 평균 =================

test('§2-2 산술평균 행렬은 회전이 아니다 (σ=15° 에서 det 0.857)', () => {
  const expect = { 1: 0.99918, 5: 0.97643, 15: 0.85686, 45: 0.10740, 90: 0.00986 };
  for (const [sigStr, detExp] of Object.entries(expect)) {
    const sig = Number(sigStr);
    const r = makeRng(2 + sig);
    const R0 = eulerToR([0.3, 0.2, -0.4]);
    const Rs = Array.from({ length: 20 }, () => perturb(R0, rad(sig), r));
    const A = meanRotation(Rs, 'raw');
    close(det3(A), detExp, 1e-3, `σ=${sig}° det(산술평균)`);
  }
});

test('§2-2 σ=90° 에서는 cos 항이 범위를 벗어난다 — acos 에 넣을 수 없다', () => {
  const r = makeRng(92);
  const R0 = eulerToR([0.3, 0.2, -0.4]);
  const Rs = Array.from({ length: 20 }, () => perturb(R0, rad(90), r));
  const A = meanRotation(Rs, 'raw');
  const c = (trace(matMul(A, transpose(R0))) - 1) / 2;
  close(c, -0.1790, 5e-3, 'cos 항');
  assert.ok(c < 0, `회전이면 불가능한 값이어야 한다: ${c}`);
});

test('§2-2 🚨 SVD 투영이 σ ≤ 15° 에서 Karcher 와 사실상 같다', () => {
  const expect = { 1: [0.447, 0.447], 5: [3.268, 3.258], 15: [5.348, 5.286] };
  for (const [sigStr, [pExp, kExp]] of Object.entries(expect)) {
    const sig = Number(sigStr);
    const r = makeRng(2 + sig);
    const R0 = eulerToR([0.3, 0.2, -0.4]);
    const Rs = Array.from({ length: 20 }, () => perturb(R0, rad(sig), r));
    const proj = angleBetween(meanRotation(Rs, 'proj'), R0) * D;
    const kar = angleBetween(meanRotation(Rs, 'karcher'), R0) * D;
    rel(proj, pExp, 0.02, `σ=${sig}° 투영`);
    rel(kar, kExp, 0.02, `σ=${sig}° Karcher`);
    // 둘의 차이가 2% 안쪽 — "Karcher 를 써야 한다" 가 성립하지 않는다
    rel(proj, kar, 0.02, `σ=${sig}° 투영 vs Karcher`);
  }
});

test('§2-2 σ=90° 에서는 투영이 Karcher 보다 오히려 낫다', () => {
  const r = makeRng(92);
  const R0 = eulerToR([0.3, 0.2, -0.4]);
  const Rs = Array.from({ length: 20 }, () => perturb(R0, rad(90), r));
  const proj = angleBetween(meanRotation(Rs, 'proj'), R0) * D;
  const kar = angleBetween(meanRotation(Rs, 'karcher'), R0) * D;
  rel(proj, 23.421, 0.03, '투영');
  rel(kar, 25.729, 0.03, 'Karcher');
  assert.ok(proj < kar, `투영 ${proj}° 이 Karcher ${kar}° 보다 작아야 한다`);
});

// ================= §2-3. 🔑 짐벌락 = κ 발산 =================

test('§2-3 오일러 κ 의 닫힌형이 실측 야코비안과 일치한다 (9개 pitch)', () => {
  const expect = {
    0: 1.000, 30: 1.732, 45: 2.414, 60: 3.732, 80: 11.43,
    85: 22.90, 89: 114.6, 89.9: 1146, 89.99: 1.146e4,
  };
  for (const [degStr, kExp] of Object.entries(expect)) {
    const deg = Number(degStr);
    const J = eulerJacobian([0.4, rad(deg), -0.7]);
    const measured = kappaOf(J);
    const closed = eulerKappa(rad(deg));
    rel(measured, closed, 1e-3, `pitch=${deg}° 실측 vs 닫힌형`);
    rel(measured, kExp, 5e-3, `pitch=${deg}° 스펙값`);
  }
});

test('§2-3 det(J) = cos(pitch) 이고 짐벌락에서 0 이다', () => {
  for (const deg of [0, 30, 60, 85, 89.99]) {
    const J = eulerJacobian([0.4, rad(deg), -0.7]);
    close(Math.abs(det3(J)), Math.abs(eulerJacDet(rad(deg))), 1e-6, `pitch=${deg}°`);
  }
  close(eulerJacDet(rad(90)), 0, 1e-15, 'pitch=90° 에서 det=0');
  assert.equal(eulerKappa(rad(90)), Infinity, 'pitch=90° 에서 κ=∞');
});

test('§2-3 점근형은 2/cos(pitch) 다 — 계수 2 를 빠뜨리면 안 된다', () => {
  for (const deg of [89, 89.9, 89.99]) {
    const ratio = eulerKappa(rad(deg)) / (1 / Math.cos(rad(deg)));
    close(ratio, 2, 1e-3, `pitch=${deg}° 의 κ/(1/cos)`);
  }
});

test('§2-3 pitch=90° 에서 yaw 와 roll 이 같은 회전을 만든다 (정확히 0°)', () => {
  for (const d of [0.1, 0.01]) {
    close(dofCollapse([0.4, Math.PI / 2, -0.7], d) * D, 0, 1e-9, `d=${d}`);
  }
  // pitch 가 90° 가 아니면 자유도가 살아 있다
  assert.ok(dofCollapse([0.4, rad(60), -0.7], 0.1) * D > 1,
    'pitch=60° 에서는 자유도가 있다');
});

// ================= §2-4. 🔑 회전벡터는 순방향이 멀쩡하다 =================

test('§2-4 지수사상 κ 의 닫힌형이 실측과 일치하고 π/2 에서 유계다', () => {
  const expect = { 10: 1.001, 90: 1.111, 170: 1.489, 179: 1.562, 179.9: 1.5707 };
  for (const [degStr, kExp] of Object.entries(expect)) {
    const deg = Number(degStr);
    const w0 = scale(normalize([1, 0.3, -0.2]), rad(deg));
    const h = 1e-6;
    const R = expSO3(w0);
    const cols = [0, 1, 2].map((i) => {
      const wp = [...w0], wm = [...w0];
      wp[i] += h; wm[i] -= h;
      const dR = mscale(msub(expSO3(wp), expSO3(wm)), 1 / (2 * h));
      return vee(matMul(dR, transpose(R)));
    });
    const J = [0, 1, 2].map((rw) => cols.map((c) => c[rw]));
    rel(kappaOf(J), expKappa(rad(deg)), 2e-3, `θ=${deg}° 실측 vs 닫힌형`);
    rel(kappaOf(J), kExp, 5e-3, `θ=${deg}° 스펙값`);
    rel(Math.abs(det3(J)), expJacDet(rad(deg)), 5e-3, `θ=${deg}° det`);
  }
});

test('§2-4 🔑 지수사상 κ 는 θ=π 에서 정확히 π/2 다 — 오일러와의 대비', () => {
  close(expKappa(Math.PI), Math.PI / 2, 1e-12, 'θ=π 의 κ');
  close(expJacDet(Math.PI), (2 / Math.PI) ** 2, 1e-12, 'θ=π 의 det');
  // 전 구간에서 유계
  for (let deg = 0; deg <= 180; deg += 5) {
    assert.ok(expKappa(rad(deg)) <= Math.PI / 2 + 1e-12,
      `θ=${deg}° 에서 κ=${expKappa(rad(deg))} 가 π/2 를 넘었다`);
  }
  // 오일러는 같은 자리에서 발산한다 — 이것이 축이다
  assert.ok(eulerKappa(rad(89.99)) / expKappa(Math.PI) > 7000,
    '오일러 κ 가 지수사상 κ 보다 4자리 크다');
});

test('expSO3 가 회전을 만든다 (det=1, 직교)', () => {
  const r = makeRng(5);
  for (let k = 0; k < 30; k++) {
    const R = randR(r);
    close(det3(R), 1, 1e-12);
    assert.ok(orthError(R) < 1e-12, `직교이탈 ${orthError(R)}`);
  }
});

// ================= §2-5. log 가 π 에서 무너진다 =================

test('§2-5 순진한 log 는 정확히 180° 에서 무너지고 안전한 log 는 살아남는다', () => {
  const axis = normalize([0.3, -0.5, 0.81]);
  const R = expSO3(scale(axis, Math.PI));
  const wn = logSO3Naive(R), ws = logSO3(R);
  // 순진한 쪽: θ 가 11.5 rad 쯤 어긋나고 축도 5.5° 틀린다
  assert.ok(Math.abs(norm(wn) - Math.PI) > 1, `순진한 θ 오차 ${Math.abs(norm(wn) - Math.PI)}`);
  const axErr = Math.acos(Math.min(1, Math.abs(dot(normalize(wn), axis)))) * D;
  assert.ok(axErr > 1, `순진한 축 오차 ${axErr}°`);
  // 안전한 쪽: 정확
  close(norm(ws), Math.PI, 1e-12, '안전한 θ');
  close(Math.acos(Math.min(1, Math.abs(dot(normalize(ws), axis)))) * D, 0, 1e-6, '안전한 축');
});

test('§2-5 순진한 log 의 θ 오차가 10배 접근마다 100배씩 커진다', () => {
  const axis = normalize([0.3, -0.5, 0.81]);
  const errs = [170, 179, 179.9, 179.99, 179.999].map((deg) => {
    const th = rad(deg);
    return Math.abs(norm(logSO3Naive(expSO3(scale(axis, th)))) - th);
  });
  for (let i = 1; i < errs.length; i++) {
    const ratio = errs[i] / errs[i - 1];
    assert.ok(ratio > 20 && ratio < 500,
      `단계 ${i} 의 증가율 ${ratio} (100배 근처여야 한다)`);
  }
  assert.ok(errs[0] < 1e-13, `170° 오차 ${errs[0]}`);
  assert.ok(errs[4] > 1e-6, `179.999° 오차 ${errs[4]}`);
});

test('§2-5 ⚠️ 축은 179.999° 까지 정확하다 — θ 만 틀리므로 조용하다', () => {
  const axis = normalize([0.3, -0.5, 0.81]);
  for (const deg of [170, 179, 179.9, 179.99, 179.999]) {
    const w = logSO3Naive(expSO3(scale(axis, rad(deg))));
    const axErr = Math.acos(Math.min(1, Math.abs(dot(normalize(w), axis)))) * D;
    close(axErr, 0, 1e-3, `θ=${deg}° 의 축 오차`);
  }
});

test('log 와 exp 가 왕복한다 (안전한 log, 전 구간)', () => {
  // ⚠️ angleBetween 이 아니라 matDistance 로 잰다 — acos 증폭 때문에 angleBetween 의
  // 분해능이 1e-6° 뿐이다 (스펙 §3-11). Frobenius 는 1e-15 까지 분해한다.
  const r = makeRng(7);
  for (let k = 0; k < 50; k++) {
    const R = randR(r);
    assert.ok(matDistance(expSO3(logSO3(R)), R) < 1e-11, `왕복 실패 ${k}`);
  }
});

// ================= §2-6. 보간 세 방법 =================

test('§2-6 🔑 오일러는 경로가 틀리고, 행렬투영은 속도가 틀리고, SLERP 만 둘 다 맞다', () => {
  const expect = {
    30: { euler: [1.0002, 0.084], matrix: [1.0573, 0], slerp: [1.0, 0] },
    90: { euler: [1.5227, 11.655], matrix: [1.7838, 0], slerp: [1.0, 0] },
    150: { euler: [1.0590, 82.497], matrix: [10.44, 0], slerp: [1.0, 0] },
    179: { euler: [1.0586, 21.115], matrix: [700.1, 0], slerp: [1.0, 0] },
  };
  for (const [degStr, exp] of Object.entries(expect)) {
    const deg = Number(degStr);
    const R0 = eulerToR([0.2, 0.3, -0.1]);
    const R1 = matMul(expSO3(scale(normalize([0.4, 0.8, -0.3]), rad(deg))), R0);
    for (const mode of ['euler', 'matrix', 'slerp']) {
      const m = pathMetrics(interpolate(R0, R1, 10, mode));
      const [uniExp, excessExp] = exp[mode];
      rel(m.uniformity, uniExp, 0.03, `Δ=${deg}° ${mode} 균일성`);
      close(m.excess * D, excessExp, Math.max(0.05, excessExp * 0.03),
        `Δ=${deg}° ${mode} 측지선 초과`);
    }
  }
});

test('§2-6 SLERP 은 균일성이 정확히 1 이고 측지선을 지난다', () => {
  for (const deg of [30, 90, 150, 179]) {
    const R0 = eulerToR([0.2, 0.3, -0.1]);
    const R1 = matMul(expSO3(scale(normalize([0.4, 0.8, -0.3]), rad(deg))), R0);
    const m = pathMetrics(interpolate(R0, R1, 10, 'slerp'));
    close(m.uniformity, 1, 1e-9, `Δ=${deg}° 균일성`);
    close(m.excess * D, 0, 1e-9, `Δ=${deg}° 초과`);
    close(m.geodesic * D, deg, 1e-6, `Δ=${deg}° 측지선`);
  }
});

test('§2-6 행렬투영은 측지선을 정확히 지나면서 속도만 어긋난다', () => {
  const R0 = eulerToR([0.2, 0.3, -0.1]);
  const R1 = matMul(expSO3(scale(normalize([0.4, 0.8, -0.3]), rad(179))), R0);
  const m = pathMetrics(interpolate(R0, R1, 10, 'matrix'));
  close(m.excess * D, 0, 1e-6, '경로는 측지선과 같다');
  assert.ok(m.uniformity > 100, `속도는 크게 어긋난다: ${m.uniformity}`);
});

test('§2-6 q 와 −q 는 같은 회전이고, 부호를 안 맞추면 긴 길로 간다', () => {
  const expect = { 90: [90, 270], 179: [179, 181] };
  for (const [degStr, [alignedExp, rawExp]] of Object.entries(expect)) {
    const deg = Number(degStr);
    const R0 = eulerToR([0.2, 0.3, -0.1]);
    const R1 = matMul(expSO3(scale(normalize([0.4, 0.8, -0.3]), rad(deg))), R0);
    const q1 = quatFromR(R1);
    const q1neg = q1.map((v) => -v);
    // 같은 회전이다
    close(angleBetween(rFromQuat(q1), rFromQuat(q1neg)) * D, 0, 1e-9, '이중덮개');
    const len = (align) => {
      const q0 = quatFromR(R0);
      const path = Array.from({ length: 41 }, (_, i) => rFromQuat(
        slerp(q0, q1neg, i / 40, { align }),
      ));
      return pathMetrics(path).total * D;
    };
    rel(len(true), alignedExp, 1e-3, `Δ=${deg}° 부호 맞춤`);
    rel(len(false), rawExp, 1e-3, `Δ=${deg}° 부호 안 맞춤`);
  }
});

test('보간의 끝점이 정확히 R0 과 R1 이다 (세 방법 모두)', () => {
  const R0 = eulerToR([0.2, 0.3, -0.1]);
  const R1 = matMul(expSO3(scale(normalize([0.4, 0.8, -0.3]), rad(120))), R0);
  for (const mode of ['euler', 'matrix', 'slerp']) {
    const path = interpolate(R0, R1, 8, mode);
    assert.ok(matDistance(path[0], R0) < 1e-12, `${mode} 시작점`);
    assert.ok(matDistance(path[path.length - 1], R1) < 1e-12, `${mode} 끝점`);
  }
});

// ================= §2-7. 8편 빚 =================

test('§2-7 det=+1 에서 −1 로 가려면 det=0 을 지난다', () => {
  const R = eulerToR([0.3, 0.4, 0.5]);
  const F = matMul(R, [[1, 0, 0], [0, 1, 0], [0, 0, -1]]);
  close(det3(R), 1, 1e-12, 'det(R)');
  close(det3(F), -1, 1e-12, 'det(반사 섞은 것)');
  const expect = { 0: 1, 0.25: 0.5, 0.5: 0, 0.75: -0.5, 1: -1 };
  for (const [tStr, dExp] of Object.entries(expect)) {
    const t = Number(tStr);
    const Mt = madd(mscale(R, 1 - t), mscale(F, t));
    close(det3(Mt), dExp, 1e-9, `t=${t}`);
  }
  // t=0.5 는 가역조차 아니다
  const half = madd(mscale(R, 0.5), mscale(F, 0.5));
  close(det3(half), 0, 1e-12, 't=0.5 는 특이행렬');
  close(orthError(half), 1, 1e-9, 't=0.5 의 직교이탈');
});

test('§2-7 twisted pair 는 정확히 180° 다 (8편 실측 재확인)', () => {
  const Ra = eulerToR([0.3, 0.4, 0.5]);
  const axis = normalize([1, 0, 0]);
  const Rb = matMul(Ra, expSO3(scale(axis, Math.PI)));
  close(angleBetween(Ra, Rb) * D, 180, 1e-6, '두 회전의 각차');
  close(angleBetween(expSO3(scale(axis, Math.PI)), I3()) * D, 180, 1e-6, 'Rot(axis,180°)');
});

test('§2-7 Procrustes 는 회전을 주고 det<0 도 고친다', () => {
  const bad = [[0.9, 0.1, 0], [0, 0.8, 0.2], [0.1, 0, 1.1]];
  close(det3(bad), 0.79400, 1e-4, '원본 det');
  const good = nearestRotation(bad);
  close(det3(good), 1, 1e-9, '투영 det');
  assert.ok(orthError(good) < 1e-12, `투영 직교이탈 ${orthError(good)}`);
  close(frobenius(msub(bad, good)), 0.29384, 1e-4, '원본과의 거리');

  const refl = [[0.9, 0.1, 0], [0, 0.8, 0.2], [0.1, 0, -1.1]];
  assert.ok(det3(refl) < 0, `원본 det ${det3(refl)}`);
  const fixed = nearestRotation(refl);
  close(det3(fixed), 1, 1e-9, 'det<0 을 투영해도 +1 이 나온다');
});

// ================= 규약과 기본기 =================

test('오일러 왕복 — pitch ∈ (−90°,90°) 에서만 성립한다', () => {
  const r = makeRng(11);
  for (let k = 0; k < 40; k++) {
    const ang = [
      (r() * 2 - 1) * Math.PI,
      (r() * 2 - 1) * rad(85),          // 짐벌락 근처를 피한다
      (r() * 2 - 1) * Math.PI,
    ];
    const R = eulerToR(ang);
    const back = rToEuler(R);
    assert.ok(matDistance(eulerToR(back), R) < 1e-14, `왕복 ${k}`);
  }
});

test('vee 와 skew 가 서로 역이다', () => {
  const w = [0.3, -1.2, 0.7];
  const back = vee(skew(w));
  for (let i = 0; i < 3; i++) close(back[i], w[i], 1e-15);
});

test('quatFromR / rFromQuat 왕복 — 대각합이 음수인 경우 포함', () => {
  const r = makeRng(13);
  for (let k = 0; k < 60; k++) {
    const R = randR(r);
    assert.ok(matDistance(rFromQuat(quatFromR(R)), R) < 1e-14, `왕복 ${k}`);
  }
  // tr < 0 인 것을 일부러 만든다 (180° 근처 회전)
  const R180 = expSO3(scale(normalize([1, 1, 0]), Math.PI * 0.98));
  assert.ok(trace(R180) < 0, `대각합 ${trace(R180)}`);
  assert.ok(matDistance(rFromQuat(quatFromR(R180)), R180) < 1e-14, 'tr<0 왕복');
});

test('eulerKappa 는 pitch 부호에 무관하다', () => {
  for (const deg of [30, 60, 85]) {
    close(eulerKappa(rad(deg)), eulerKappa(rad(-deg)), 1e-15, `±${deg}°`);
  }
});
