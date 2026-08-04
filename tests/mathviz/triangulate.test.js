import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lookAt, intrinsics, projectPoint, cameraCenter, depthOf,
  add, sub, scale, dot, norm, normalize, matVec, matMul, transpose, det3,
} from '../../static/js/mathviz/camera.js';
import {
  relativePose, essentialFromCameras, svd3, jacobiEig,
} from '../../static/js/mathviz/epipolar.js';
import {
  rayFromImage, triangulateMidpoint, triangulateDLT, triangulateGN,
  reprojResidual, reprojRms, projJacobian, jacobian, normalMatrix, gradient,
  solve3, descentPath, gdStepsPredicted, errorEllipsoid, rayAngle,
  decomposeEssential, chooseByCheirality, makeRng, gaussian,
} from '../../static/js/mathviz/triangulate.js';

const close = (a, b, tol, msg) => assert.ok(
  Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a} (허용 ${tol})`,
);
/** 상대오차. 스펙 §2 의 표는 유효숫자 3\~4 자리라 절대 허용치가 무의미하다. */
const rel = (a, b, frac, msg) => assert.ok(
  Math.abs(a - b) <= frac * Math.abs(b),
  `${msg ?? ''} expected ${b}, got ${a} (상대허용 ${frac})`,
);

// ---------- 스펙 §2 기준 배치 ----------
const K = intrinsics({ f: 500, cx: 240, cy: 240 });
const UP = [0, 0, 1];
const TARGET = [0, 0, 0.8];

/** 좌우 스테레오. 베이스라인 bx m. 스펙 §2 의 기준 배치 */
const stereo = (bx = 4) => ({
  cam1: { K, ...lookAt({ eye: [-bx / 2, -6, 1.6], target: TARGET, up: UP }) },
  cam2: { K, ...lookAt({ eye: [bx / 2, -6, 1.6], target: TARGET, up: UP }) },
});
/** 점 A — 두 깊이가 같은 6.375 m 지점 */
const POINT_A = [0, 0, 0.8];
/** 두 카메라 중점에서 시선방향 dist m. 점 B 는 dist=8 */
function pointAt(cam1, cam2, dist) {
  const mid = scale(add(cameraCenter(cam1), cameraCenter(cam2)), 0.5);
  return add(mid, scale(normalize(sub(TARGET, mid)), dist));
}
const project2 = (cam1, cam2, X) => {
  const a = projectPoint(cam1, X), b = projectPoint(cam2, X);
  return [[a.u, a.v], [b.u, b.v]];
};
/** 잡음 대응쌍 하나. */
const noisy = (cam1, cam2, X, sigma, rand) => {
  const [[u1, v1], [u2, v2]] = project2(cam1, cam2, X);
  return [
    [u1 + sigma * gaussian(rand), v1 + sigma * gaussian(rand)],
    [u2 + sigma * gaussian(rand), v2 + sigma * gaussian(rand)],
  ];
};
/** 세 방법의 3D 오차 RMS (mm) 를 잡음 스윕으로 잰다. */
function sweep(cam1, cam2, X, sigma, trials, seed) {
  const rand = makeRng(seed);
  const acc = { mid: 0, dlt: 0, gn: 0 };
  const steps = [];
  let gapSum = 0, n = 0;
  for (let k = 0; k < trials; k++) {
    const [x1, x2] = noisy(cam1, cam2, X, sigma, rand);
    const m = triangulateMidpoint(cam1, cam2, x1, x2);
    const d = triangulateDLT(cam1, cam2, x1, x2);
    if (!m || !d) continue;
    const g = triangulateGN(cam1, cam2, x1, x2, d.X);
    acc.mid += norm(sub(m.X, X)) ** 2;
    acc.dlt += norm(sub(d.X, X)) ** 2;
    acc.gn += norm(sub(g.X, X)) ** 2;
    gapSum += m.gap;
    steps.push(g.iters);
    n++;
  }
  const mm = (s) => Math.sqrt(s / n) * 1000;
  steps.sort((a, b) => a - b);
  return {
    n,
    mid: mm(acc.mid),
    dlt: mm(acc.dlt),
    gn: mm(acc.gn),
    gapMean: (gapSum / n) * 1000,
    stepMedian: steps[Math.floor(n / 2)],
    stepMax: steps[n - 1],
  };
}

/**
 * 오차를 **시선 방향과 그 수직 성분으로 분해**해 RMS (mm) 를 낸다.
 *
 * ⚠️ 이것은 errorEllipsoid 의 축과 다른 양이다. 타원체의 최장축은 시선과 최대
 * 13.9° 기울어 있으므로(스펙 §2-7), 최장축 길이와 "깊이 방향 성분" 은 같지 않다.
 * 스펙 §2-4·§2-5 의 표는 **이 분해**로 잰 것이라, 그 숫자를 고정하려면 여기서도
 * 같은 방식으로 재야 한다. 지수도 조금 다르게 나온다 (B 지수 −0.983 대 −0.950).
 */
function sweepDecomposed(cam1, cam2, X, sigma, trials, seed) {
  const [x1c] = project2(cam1, cam2, X);
  const { d: view } = rayFromImage(cam1, x1c);
  const rand = makeRng(seed);
  let accDepth = 0, accLat = 0, n = 0;
  for (let k = 0; k < trials; k++) {
    const [x1, x2] = noisy(cam1, cam2, X, sigma, rand);
    const d = triangulateDLT(cam1, cam2, x1, x2);
    if (!d) continue;
    const err = sub(triangulateGN(cam1, cam2, x1, x2, d.X).X, X);
    const along = dot(err, view);
    accDepth += along ** 2;
    accLat += norm(sub(err, scale(view, along))) ** 2;
    n++;
  }
  return {
    depth: Math.sqrt(accDepth / n) * 1000,
    lateral: Math.sqrt(accLat / n) * 1000,
  };
}

/** 로그-로그 최소자승 기울기. */
function logSlope(xs, ys) {
  const mx = xs.reduce((a, b) => a + b) / xs.length;
  const my = ys.reduce((a, b) => a + b) / ys.length;
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  return num / den;
}

// ================= §2-1. 잡음 0 에서 세 방법이 일치한다 =================

test('§2-1 잡음 0 이면 두 광선이 만나고 세 방법이 같은 점을 준다', () => {
  const { cam1, cam2 } = stereo();
  // 스펙은 6.3750 m 로 적혀 있다 — 4자리 표시값이고 실제는 6.374951 이다
  close(depthOf(cam1, POINT_A), 6.375, 1e-4, 'cam1 깊이');
  close(depthOf(cam2, POINT_A), 6.375, 1e-4, 'cam2 깊이');
  close(depthOf(cam1, POINT_A), depthOf(cam2, POINT_A), 1e-12, '두 깊이가 같다');
  const [x1, x2] = project2(cam1, cam2, POINT_A);
  close(x1[0], 240, 1e-9); close(x2[0], 240, 1e-9);

  const m = triangulateMidpoint(cam1, cam2, x1, x2);
  const d = triangulateDLT(cam1, cam2, x1, x2);
  const g = triangulateGN(cam1, cam2, x1, x2, d.X);
  assert.ok(m.gap < 1e-12, `gap ${m.gap}`);
  assert.ok(norm(sub(m.X, POINT_A)) < 1e-12, '중점법');
  assert.ok(norm(sub(d.X, POINT_A)) < 1e-14, 'DLT');
  assert.ok(norm(sub(g.X, POINT_A)) < 1e-14, 'MLE');
  assert.equal(g.iters, 1, '이미 최적이라 한 스텝');
});

test('§2-1 베이스라인이 정확히 4 m 다', () => {
  const { cam1, cam2 } = stereo();
  close(norm(sub(cameraCenter(cam2), cameraCenter(cam1))), 4, 1e-12);
});

// ================= §2-2. 잡음이 있으면 광선이 만나지 않는다 =================

test('§2-2 gap 이 σ 에 비례한다 (점 A, 200회)', () => {
  const { cam1, cam2 } = stereo();
  // 스펙 §2-2: σ=1 에서 평균 13.823 mm, σ=5 에서 69.181 mm
  const s1 = sweep(cam1, cam2, POINT_A, 1, 200, 12345);
  const s5 = sweep(cam1, cam2, POINT_A, 5, 200, 12345);
  rel(s1.gapMean, 13.823, 0.02, 'σ=1 gap 평균 (mm)');
  rel(s5.gapMean, 69.181, 0.02, 'σ=5 gap 평균 (mm)');
  // 25배 잡음에 25배 gap — 선형
  rel(s5.gapMean / s1.gapMean, 5.0, 0.02, 'gap 비');
});

// ================= §2-3. 🚨 대칭 배치에서 세 방법이 같다 =================

test('§2-3 대칭 배치에서 중점법·DLT·MLE 가 셋째 자리까지 같다 — 원래 축이 무너진 곳', () => {
  const { cam1, cam2 } = stereo();
  for (const [sigma, expect] of [[0.2, 6.191], [1, 30.965], [2, 61.959]]) {
    const s = sweep(cam1, cam2, POINT_A, sigma, 200, 999);
    rel(s.mid, expect, 0.03, `σ=${sigma} 중점법`);
    // 셋이 서로 0.5% 안쪽 — 방법 선택이 답을 바꾸지 않는다
    rel(s.dlt, s.mid, 0.005, `σ=${sigma} DLT vs 중점법`);
    rel(s.gn, s.mid, 0.005, `σ=${sigma} MLE vs 중점법`);
  }
});

test('§2-3 거리를 64배 밀어도 DLT/MLE 비가 1.000 이다', () => {
  const { cam1, cam2 } = stereo();
  for (const dist of [1, 8, 64]) {
    const s = sweep(cam1, cam2, pointAt(cam1, cam2, dist), 1, 200, 4242);
    rel(s.dlt / s.gn, 1, 0.01, `거리 ${dist} m 의 DLT/MLE`);
  }
});

// ================= §2-4. 오차는 시선 방향으로 z² 로 늘어난다 =================

test('§2-4 점근 구간에서 깊이오차 ∝ z^2.01, 횡오차 ∝ z^0.99', () => {
  const { cam1, cam2 } = stereo(4);
  // 점근 구간만 본다 — 스펙 §2-4 의 경고대로 1\~4 m 는 단조가 아니다.
  // 전체 구간을 적합하면 1.953 / 1.033 이 나오는데, 배제한 구간을 포함한 값이라
  // 인용하면 자기모순이다. 글은 점근값을 쓴다.
  const dists = [8, 16, 32, 64, 128];
  const rows = dists.map((dist) => {
    const X = pointAt(cam1, cam2, dist);
    return { z: depthOf(cam1, X), ...sweepDecomposed(cam1, cam2, X, 1, 400, 1000 + dist) };
  });
  const zs = rows.map((r) => Math.log(r.z));
  close(logSlope(zs, rows.map((r) => Math.log(r.depth))), 2.014, 0.03, '깊이방향 지수');
  close(logSlope(zs, rows.map((r) => Math.log(r.lateral))), 0.989, 0.03, '횡방향 지수');
  // 깊이/횡 이 커진다 — 공에서 시가로
  const ratio = (r) => r.depth / r.lateral;
  rel(ratio(rows[0]), 2.5, 0.15, '거리 8 m 의 깊이/횡');
  assert.ok(ratio(rows[4]) > 30, `거리 128 m 의 깊이/횡 = ${ratio(rows[4])}`);
});

test('§2-4 타원체 최장축은 깊이 방향 성분과 같지 않다 (스펙 §3 의 혼동 지점)', () => {
  const { cam1, cam2 } = stereo(4);
  const X = pointAt(cam1, cam2, 8);
  const { axes } = errorEllipsoid(cam1, cam2, X, 1);
  const { depth } = sweepDecomposed(cam1, cam2, X, 1, 800, 4711);
  // 최장축 47.8 mm, 깊이 성분 47.5 mm — 가깝지만 같은 양이 아니다.
  // 최장축이 시선에서 13.9° 기울어 있기 때문이다 (§2-7)
  assert.ok(Math.abs(axes[0] * 1000 - depth) > 0.05,
    `우연히 같으면 이 구분이 무의미해진다: ${axes[0] * 1000} vs ${depth}`);
  rel(axes[0] * 1000, depth, 0.05, '그래도 5% 안쪽으로는 가깝다');
});

test('§2-4 GN 스텝은 거리 1\~128 m 전 구간에서 4 회 이하다', () => {
  const { cam1, cam2 } = stereo(4);
  for (const dist of [1, 8, 32, 128]) {
    const s = sweep(cam1, cam2, pointAt(cam1, cam2, dist), 1, 100, 1000 + dist);
    assert.ok(s.stepMax <= 4, `거리 ${dist} m 최대 스텝 ${s.stepMax}`);
  }
});

// ================= §2-5. 베이스라인 =================

test('§2-5 깊이오차 ∝ B^-0.98 이고 횡오차는 B 와 무관하다 (19\~21 mm)', () => {
  const rows = [0.25, 0.5, 1, 2, 4, 8].map((B) => {
    const { cam1, cam2 } = stereo(B);
    const X = pointAt(cam1, cam2, 8);
    return { B, ...sweepDecomposed(cam1, cam2, X, 1, 400, 2000 + Math.round(B * 100)) };
  });
  close(
    logSlope(rows.map((r) => Math.log(r.B)), rows.map((r) => Math.log(r.depth))),
    -0.983, 0.05, '깊이오차의 B 지수',
  );
  // 베이스라인이 고치는 것은 깊이뿐이다 — 횡은 32배 B 변화에도 19~21 mm
  for (const r of rows) rel(r.lateral, 20, 0.12, `B=${r.B} 횡오차 (mm)`);
});

test('§2-5 광선 사잇각이 베이스라인과 함께 커진다 (1.79° → 53.13°)', () => {
  const ang = (B) => {
    const { cam1, cam2 } = stereo(B);
    const X = pointAt(cam1, cam2, 8);
    const [x1, x2] = project2(cam1, cam2, X);
    return rayAngle(cam1, cam2, x1, x2) * 180 / Math.PI;
  };
  close(ang(0.25), 1.790, 1e-2, 'B=0.25');
  close(ang(4), 28.072, 1e-2, 'B=4');
  close(ang(8), 53.130, 1e-2, 'B=8');
});

// ================= §2-6. 🔑 Cramér–Rao: 절대 크기가 예측된다 =================

test('§2-6 σ²(JᵀJ)⁻¹ 이 오차 타원체의 축을 밀리미터까지 예측한다', () => {
  const { cam1, cam2 } = stereo(4);
  for (const dist of [8, 32]) {
    const X = pointAt(cam1, cam2, dist);
    const { axes } = errorEllipsoid(cam1, cam2, X, 1);
    // 실측 — MLE 를 5000회
    const rand = makeRng(20260804);
    const errs = [];
    for (let k = 0; k < 3000; k++) {
      const [x1, x2] = noisy(cam1, cam2, X, 1, rand);
      const d = triangulateDLT(cam1, cam2, x1, x2);
      if (!d) continue;
      errs.push(sub(triangulateGN(cam1, cam2, x1, x2, d.X).X, X));
    }
    const C = [0, 1, 2].map((i) => [0, 1, 2].map(
      (j) => errs.reduce((s, v) => s + v[i] * v[j], 0) / errs.length,
    ));
    const meas = jacobiEig(C).values
      .map((v) => Math.sqrt(Math.max(0, v))).sort((a, b) => b - a);
    rel(meas[0], axes[0], 0.06, `거리 ${dist} m 최장축`);
    rel(meas[2], axes[2], 0.06, `거리 ${dist} m 최단축`);
  }
});

// ================= §2-7. 🔑 축비 = √κ =================

test('§2-7 오차 타원체의 축비가 √κ(JᵀJ) 다', () => {
  const { cam1, cam2 } = stereo(4);
  for (const dist of [2, 8, 32, 128]) {
    const X = pointAt(cam1, cam2, dist);
    const { axes, kappa, ratio } = errorEllipsoid(cam1, cam2, X, 1);
    // ratio 는 정의상 √κ — 축 길이에서 다시 계산해도 같아야 한다
    close(axes[0] / axes[2], ratio, 1e-9, `거리 ${dist} m`);
    close(ratio, Math.sqrt(kappa), 1e-12, '√κ');
  }
});

test('§2-7 점 B 의 값이 스펙과 일치한다 (κ=16.907, √κ=4.1118, 최장축 47.819 mm)', () => {
  const { cam1, cam2 } = stereo(4);
  const B = pointAt(cam1, cam2, 8);
  close(depthOf(cam1, B), 8.2236, 1e-3, '점 B 깊이');
  const [x1, x2] = project2(cam1, cam2, B);
  close(x1[0], 202.90, 0.01); close(x2[0], 277.10, 0.01);
  close(rayAngle(cam1, cam2, x1, x2) * 180 / Math.PI, 28.072, 1e-2, '광선 사잇각');
  const { axes, kappa, ratio } = errorEllipsoid(cam1, cam2, B, 1);
  close(kappa, 16.907, 1e-2, 'κ(JᵀJ)');
  close(ratio, 4.1118, 1e-3, '√κ');
  close(axes[0] * 1000, 47.819, 1e-2, '최장축 (mm)');
  close(axes[2] * 1000, 11.630, 1e-2, '최단축 (mm)');
});

test('§2-7 멀어지면 최장축이 시선과 정렬한다', () => {
  const { cam1, cam2 } = stereo(4);
  const angleToView = (dist) => {
    const X = pointAt(cam1, cam2, dist);
    const [x1] = project2(cam1, cam2, X);
    const { d } = rayFromImage(cam1, x1);
    const { dirs } = errorEllipsoid(cam1, cam2, X, 1);
    return Math.acos(Math.min(1, Math.abs(dot(normalize(dirs[0]), d)))) * 180 / Math.PI;
  };
  assert.ok(angleToView(128) < angleToView(8), '멀수록 정렬');
  assert.ok(angleToView(128) < 2, `거리 128 m 에서 ${angleToView(128)}°`);
});

// ================= §2-8. 🔑 κ 가 6만 배 커져도 GN 스텝은 1→3 =================

test('§2-8 κ 를 6만 배 키워도 GN 은 3 스텝, 경사하강은 수십만 스텝', () => {
  const { cam1, cam2 } = stereo(4);
  const kappas = [];
  for (const dist of [2, 32, 512]) {
    const X = pointAt(cam1, cam2, dist);
    const rand = makeRng(77);
    const [x1, x2] = noisy(cam1, cam2, X, 1, rand);
    const d = triangulateDLT(cam1, cam2, x1, x2);
    const g = triangulateGN(cam1, cam2, x1, x2, d.X);
    kappas.push(g.kappa);
    assert.ok(g.iters <= 3, `거리 ${dist} m 에서 GN ${g.iters} 스텝`);
    assert.ok(!g.diverged);
  }
  // κ 가 1.6 → 5e4 로 커진다 (4자리)
  assert.ok(kappas[0] < 3, `가까운 곳 κ=${kappas[0]}`);
  assert.ok(kappas[2] > 3e4, `먼 곳 κ=${kappas[2]}`);
  assert.ok(kappas[2] / kappas[0] > 1e4, `κ 배율 ${kappas[2] / kappas[0]}`);
});

test('§2-8 경사하강은 같은 예산에서 GN 을 따라가지 못한다', () => {
  const { cam1, cam2 } = stereo(4);
  const X = pointAt(cam1, cam2, 512);
  const rand = makeRng(77);
  const [x1, x2] = noisy(cam1, cam2, X, 1, rand);
  const start = triangulateMidpoint(cam1, cam2, x1, x2).X;
  // 수렴한 해
  const star = triangulateGN(cam1, cam2, x1, x2, start, { maxIter: 80 }).X;
  const gn3 = triangulateGN(cam1, cam2, x1, x2, start, { maxIter: 3 }).X;
  const gd = descentPath(cam1, cam2, x1, x2, start, { steps: 1000 });
  const eGn = norm(sub(gn3, star));
  const eGd = norm(sub(gd.X, star));
  // 거리 512 m (κ≈5e4) 에서 GN 3 스텝은 나노미터, GD 1000 스텝은 20 cm 대다
  assert.ok(eGn < 1e-7, `GN 3 스텝 오차 ${eGn} m`);
  assert.ok(eGd > 0.1, `GD 1000 스텝 오차 ${eGd} m — 사실상 멈춰 있다`);
  assert.ok(eGd / eGn > 1e6, `비 ${eGd / eGn}`);
});

test('§2-8 3편 공식의 예측 스텝 수가 κ 에 비례해 늘어난다 (예측값이다)', () => {
  // 예측이지 실측이 아니다 — 스펙 §3-7
  assert.ok(gdStepsPredicted(1.6) < 10);
  const a = gdStepsPredicted(253), b = gdStepsPredicted(2530);
  rel(b / a, 10, 0.05, 'κ 10배 → 예측 스텝 10배');
});

// ================= §2-9. 2차 수렴 =================

test('§2-9 GN 이 2차 수렴한다 (스텝 1\~2 만 본다)', () => {
  const { cam1, cam2 } = stereo(4);
  const X = pointAt(cam1, cam2, 32);
  const rand = makeRng(555);
  const [x1, x2] = noisy(cam1, cam2, X, 1, rand);
  const start = triangulateMidpoint(cam1, cam2, x1, x2).X;
  const star = triangulateGN(cam1, cam2, x1, x2, start, { maxIter: 80 }).X;
  const { path } = triangulateGN(cam1, cam2, x1, x2, start, { maxIter: 6 });
  const e = path.map((p) => norm(sub(p, star)));
  // e₁/e₀² 와 e₂/e₁² 가 유계 — 2차
  assert.ok(e[1] / e[0] ** 2 < 1, `e1/e0² = ${e[1] / e[0] ** 2}`);
  assert.ok(e[2] / e[1] ** 2 < 1, `e2/e1² = ${e[2] / e[1] ** 2}`);
  // 그리고 1차보다 훨씬 빠르다
  assert.ok(e[2] / e[1] < e[1] / e[0], '수축률이 스텝마다 좋아진다');
  // ⚠️ 스텝 3 이후는 부동소수 바닥이라 비를 보지 않는다 (스펙 §3-3)
});

test('§2-9 초기값이 중점법이든 DLT 든 같은 해로 간다', () => {
  const { cam1, cam2 } = stereo(4);
  const X = pointAt(cam1, cam2, 8);
  const rand = makeRng(31337);
  for (let k = 0; k < 40; k++) {
    const [x1, x2] = noisy(cam1, cam2, X, 2, rand);
    const m = triangulateMidpoint(cam1, cam2, x1, x2);
    const d = triangulateDLT(cam1, cam2, x1, x2);
    const g1 = triangulateGN(cam1, cam2, x1, x2, m.X);
    const g2 = triangulateGN(cam1, cam2, x1, x2, d.X);
    assert.ok(norm(sub(g1.X, g2.X)) < 1e-8, `시행 ${k}: ${norm(sub(g1.X, g2.X))}`);
    // σ=2 px 에서 최대 6 스텝 — 잡음이 클수록 조금 늘지만 κ 와는 무관하다
    assert.ok(g1.iters <= 6 && g2.iters <= 6, `시행 ${k}: ${g1.iters}/${g2.iters} 스텝`);
  }
});

test('§2-9 MLE 가 세 방법 중 재투영오차를 가장 작게 만든다', () => {
  const { cam1, cam2 } = stereo(4);
  const X = pointAt(cam1, cam2, 8);
  const rand = makeRng(7);
  for (let k = 0; k < 20; k++) {
    const [x1, x2] = noisy(cam1, cam2, X, 2, rand);
    const m = triangulateMidpoint(cam1, cam2, x1, x2);
    const d = triangulateDLT(cam1, cam2, x1, x2);
    const g = triangulateGN(cam1, cam2, x1, x2, d.X);
    const rms = (Y) => reprojRms(cam1, cam2, x1, x2, Y);
    assert.ok(rms(g.X) <= rms(m.X) + 1e-9, `중점법보다 작아야 한다 (시행 ${k})`);
    assert.ok(rms(g.X) <= rms(d.X) + 1e-9, `DLT 보다 작아야 한다 (시행 ${k})`);
  }
});

// ================= §2-10. 🚨 잡음이 크면 MLE 가 발산한다 =================

test('§2-10 σ ≤ 10 px 에서 발산 0% — 데모 상한의 근거', () => {
  const { cam1, cam2 } = stereo(4);
  const X = pointAt(cam1, cam2, 8);
  const refDist = norm(sub(X, cameraCenter(cam1)));
  for (const sigma of [1, 5, 10]) {
    const rand = makeRng(8888);
    let div = 0, n = 0;
    for (let k = 0; k < 200; k++) {
      const [x1, x2] = noisy(cam1, cam2, X, sigma, rand);
      const d = triangulateDLT(cam1, cam2, x1, x2);
      if (!d) continue;
      const g = triangulateGN(cam1, cam2, x1, x2, d.X, { refDist });
      n++;
      if (g.diverged || norm(sub(g.X, X)) > 10 * refDist) div++;
    }
    assert.equal(div, 0, `σ=${sigma} px 에서 ${div}/${n} 발산`);
  }
});

test('§2-10 σ 를 60 px 까지 올리면 발산이 나타난다', () => {
  const { cam1, cam2 } = stereo(4);
  const X = pointAt(cam1, cam2, 8);
  const refDist = norm(sub(X, cameraCenter(cam1)));
  const rand = makeRng(8888);
  let div = 0, n = 0;
  for (let k = 0; k < 300; k++) {
    const [x1, x2] = noisy(cam1, cam2, X, 60, rand);
    const d = triangulateDLT(cam1, cam2, x1, x2);
    if (!d) continue;
    const g = triangulateGN(cam1, cam2, x1, x2, d.X, { refDist });
    n++;
    if (g.diverged || norm(sub(g.X, X)) > 10 * refDist) div++;
  }
  assert.ok(div / n > 0.05, `σ=60 px 발산율 ${(100 * div / n).toFixed(1)}% — 5% 넘어야 한다`);
});

// ================= §2-11. 비대칭에서만 갈린다 =================

test('§2-11 초점거리가 다르면 중점법만 나빠지고 DLT 는 MLE 를 따라간다', () => {
  const cam1 = { K, ...lookAt({ eye: [-2, -6, 1.6], target: POINT_A, up: UP }) };
  const K16 = intrinsics({ f: 500 * 16, cx: 240, cy: 240 });
  const cam2 = { K: K16, ...lookAt({ eye: [2, -6, 1.6], target: POINT_A, up: UP }) };
  const s = sweep(cam1, cam2, POINT_A, 1, 300, 4016);
  // DLT 는 화소에서 세우므로 가중이 자동으로 맞는다
  rel(s.dlt, s.gn, 0.005, 'DLT vs MLE');
  // 중점법은 3D 에서 대칭 평균하므로 4% 나빠진다
  assert.ok(s.mid / s.gn > 1.02, `중점법/MLE = ${s.mid / s.gn} — 2% 넘게 나빠야 한다`);
});

test('§2-11 깊이가 비대칭이면 DLT 와 중점법이 함께 나빠진다', () => {
  const cam1 = { K, ...lookAt({ eye: [-2, -6, 1.6], target: POINT_A, up: UP }) };
  const cam2 = { K, ...lookAt({ eye: [0.5, -1.5, 0.95], target: POINT_A, up: UP }) };
  const s = sweep(cam1, cam2, POINT_A, 1, 300, 3004);
  assert.ok(s.gn <= s.dlt + 1e-9, 'MLE 가 DLT 보다 좋거나 같다');
  assert.ok(s.gn <= s.mid + 1e-9, 'MLE 가 중점법보다 좋거나 같다');
});

// ================= §2-12. E → R,t 4겹 모호성 =================

test('§2-12 E 는 특이값 두 개가 같고 세 번째가 0 이다', () => {
  const { cam1, cam2 } = stereo(4);
  const E = essentialFromCameras(cam1, cam2);
  const { S } = decomposeEssential(E);
  close(S[1] / S[0], 1, 1e-9, 'σ₂/σ₁ — F 와 달리 정확히 1 이다');
  assert.ok(S[2] / S[0] < 1e-12, `σ₃/σ₁ = ${S[2] / S[0]}`);
});

test('§2-12 분해는 ‖t‖=1 만 준다 — 스케일이 미지다', () => {
  const { cam1, cam2 } = stereo(4);
  const E = essentialFromCameras(cam1, cam2);
  const { t: tTrue } = relativePose(cam1, cam2);
  close(norm(tTrue), 4, 1e-9, '참 ‖t‖ = 베이스라인');
  for (const cand of decomposeEssential(E).candidates) {
    close(norm(cand.t), 1, 1e-9, `${cand.label} 의 ‖t‖`);
  }
});

test('§2-12 네 후보가 모두 회전이고, 두 R 이 180° 차이다 (twisted pair)', () => {
  const { cam1, cam2 } = stereo(4);
  const E = essentialFromCameras(cam1, cam2);
  const { R: Rtrue } = relativePose(cam1, cam2);
  const { candidates } = decomposeEssential(E);
  const angle = (A, B) => {
    const M = matMul(A, transpose(B));
    return Math.acos(Math.max(-1, Math.min(1, (M[0][0] + M[1][1] + M[2][2] - 1) / 2)))
      * 180 / Math.PI;
  };
  for (const cand of candidates) close(det3(cand.R), 1, 1e-9, `det ${cand.label}`);
  const [Ra, , Rb] = candidates.map((c) => c.R);
  close(angle(Ra, Rb), 180, 1e-6, 'twisted pair 는 180° 차이');
  // 넷 중 하나의 R 이 참 R 이다
  const best = Math.min(...candidates.map((c) => angle(c.R, Rtrue)));
  assert.ok(best < 1e-4, `참 R 과 가장 가까운 후보의 각 ${best}°`);
});

test('§2-12 cheirality 가 네 후보 중 정확히 하나를 고른다', () => {
  const { cam1, cam2 } = stereo(4);
  const E = essentialFromCameras(cam1, cam2);
  const { R: Rtrue, t: tTrue } = relativePose(cam1, cam2);
  const { candidates } = decomposeEssential(E);
  // 정규화 좌표계: cam1 이 원점
  const c1n = { K, R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] };
  const c2true = { K, R: Rtrue, t: tTrue };
  const worldPts = [[0, 0, 0.8], [1, 1, 0.5], [-1, 2, 1.2], [0.5, -1, 0.3], [2, 3, 1.8]];
  // 월드 점을 cam1 좌표계로 옮긴 뒤 정규화 좌표계의 두 카메라로 투영한다
  const pairs = worldPts.map(
    (X) => project2(c1n, c2true, add(matVec(cam1.R, X), cam1.t)),
  );
  const { counts, bestIndex } = chooseByCheirality(c1n, candidates, pairs);
  assert.equal(counts[bestIndex], 5, '고른 후보는 5/5 통과');
  assert.equal(counts.filter((n) => n === 5).length, 1, '5/5 는 하나뿐이다');
  assert.equal(counts.filter((n) => n === 0).length, 3, '나머지 셋은 0/5');
});

// ================= 순수 수치 코드 =================

test('projJacobian 이 수치미분과 일치한다', () => {
  const { cam1 } = stereo(4);
  const X = [0.3, 1.7, 0.9];
  const J = projJacobian(cam1, X);
  const h = 1e-6;
  for (let i = 0; i < 3; i++) {
    const Xp = [...X], Xm = [...X];
    Xp[i] += h; Xm[i] -= h;
    const a = projectPoint(cam1, Xp), b = projectPoint(cam1, Xm);
    close(J[0][i], (a.u - b.u) / (2 * h), 1e-4, `∂u/∂X${i}`);
    close(J[1][i], (a.v - b.v) / (2 * h), 1e-4, `∂v/∂X${i}`);
  }
});

test('solve3 이 정칙계를 푼다', () => {
  const A = [[4, 1, 2], [1, 5, 1], [2, 1, 6]];
  const x = [1, -2, 3];
  const b = A.map((row) => dot(row, x));
  const got = solve3(A, b);
  for (let i = 0; i < 3; i++) close(got[i], x[i], 1e-12);
});

test('solve3 이 특이계에서 null 을 준다', () => {
  assert.equal(solve3([[1, 2, 3], [2, 4, 6], [1, 1, 1]], [1, 2, 3]), null);
});

test('normalMatrix 가 대칭이고 gradient 가 Jᵀr 이다', () => {
  const { cam1, cam2 } = stereo(4);
  const X = [0.2, 2.0, 0.7];
  const J = jacobian(cam1, cam2, X);
  assert.equal(J.length, 4);
  const M = normalMatrix(J);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(M[i][j], M[j][i], 1e-12);
  const r = [1, 2, 3, 4];
  const g = gradient(J, r);
  for (let i = 0; i < 3; i++) {
    close(g[i], J.reduce((s, row, k) => s + row[i] * r[k], 0), 1e-12);
  }
});

test('makeRng 은 시드가 같으면 같은 수열을 낸다', () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  const rand = makeRng(1);
  let sum = 0;
  for (let i = 0; i < 20000; i++) sum += gaussian(rand);
  close(sum / 20000, 0, 0.03, '표준정규 평균');
});

test('rayFromImage 가 카메라 중심과 방향을 준다', () => {
  const { cam1 } = stereo(4);
  const X = [0.4, 2.2, 0.6];
  const p = projectPoint(cam1, X);
  const { C, d } = rayFromImage(cam1, [p.u, p.v]);
  close(norm(d), 1, 1e-12, '방향은 정규화');
  // X 가 광선 위에 있다
  const along = dot(sub(X, C), d);
  assert.ok(norm(sub(add(C, scale(d, along)), X)) < 1e-9, '점이 광선 위');
});
