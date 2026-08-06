// static/js/mathviz/gaussian.js
// 10편의 순수 수학 — 다변량 가우시안. DOM 없음.
//
// RNG(mulberry32 · gaussPair)와 2×2 고유분해는 5편 stochastic.js 를 그대로 쓴다.
// 시드가 같으면 Node 와 브라우저에서 같은 수열이 나와, 글의 표와 데모의 readout 이
// 같은 값을 보여줄 수 있다 (스펙 §2).

import { mulberry32, gaussPair, symEigVec2 } from './stochastic.js';

/** Σ = R(θ) diag(σ1², σ2²) R(θ)ᵀ. θ 는 도 단위, σ1 이 주축이다. */
export function covFromParams(s1, s2, thetaDeg) {
  const t = (thetaDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const a = s1 * s1;
  const b = s2 * s2;
  return [
    [c * c * a + s * s * b, c * s * (a - b)],
    [c * s * (a - b), s * s * a + c * c * b],
  ];
}

/**
 * N(0, Σ(σ1,σ2,θ)) 표본기. z\~N(0,I) 를 L = R diag(σ1,σ2) 로 민다.
 * 스펙 §2 의 표가 전부 이 소비 순서(호출당 gaussPair 하나)로 측정됐다 —
 * 순서를 바꾸면 글의 숫자가 재현되지 않는다.
 */
export function makeSampler(s1, s2, thetaDeg, seed) {
  const t = (thetaDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const rnd = mulberry32(seed);
  return () => {
    const [z1, z2] = gaussPair(rnd);
    const x = s1 * z1;
    const y = s2 * z2;
    return [c * x - s * y, s * x + c * y];
  };
}

/**
 * 상관 ρ 인 표준 이변량 표본기: x2 = z1, x1 = ρz1 + √(1−ρ²)z2.
 * x2 를 먼저 만드는 이유: 조건부 데모가 x2 로 자르기 때문이다 (스펙 §2-E).
 */
export function makeCorrSampler(rho, seed) {
  const rnd = mulberry32(seed);
  const q = Math.sqrt(1 - rho * rho);
  return () => {
    const [z1, z2] = gaussPair(rnd);
    return [rho * z1 + q * z2, z1];
  };
}

/** 표본 평균과 표본공분산 (n−1 분모). */
export function sampleCov(pts) {
  const n = pts.length;
  let mx = 0;
  let my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= n; my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    const dx = x - mx;
    const dy = y - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const d = n - 1;
  return { mean: [mx, my], cov: [[sxx / d, sxy / d], [sxy / d, syy / d]] };
}

/** 주축이 x 축과 이루는 각(도). symEigVec2 의 v1 방향이다. */
export function axisAngleDeg(Sigma) {
  const { v1 } = symEigVec2(Sigma);
  return (Math.atan2(v1[1], v1[0]) * 180) / Math.PI;
}

/** kσ 타원 폴리라인. 반축이 k√λ 인 고유축 타원 — 마할라노비스 거리 k 의 등고선이다. */
export function ellipsePoints(Sigma, k, n = 64) {
  const { l1, l2, v1, v2 } = symEigVec2(Sigma);
  const a = k * Math.sqrt(Math.max(0, l1));
  const b = k * Math.sqrt(Math.max(0, l2));
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const p = a * Math.cos(t);
    const q = b * Math.sin(t);
    out.push([p * v1[0] + q * v2[0], p * v1[1] + q * v2[1]]);
  }
  return out;
}

/** 마할라노비스 거리 제곱 (x−μ)ᵀΣ⁻¹(x−μ). */
export function mahalanobis2(Sigma, mean, [x0, y0]) {
  const det = Sigma[0][0] * Sigma[1][1] - Sigma[0][1] * Sigma[1][0];
  const x = x0 - mean[0];
  const y = y0 - mean[1];
  return (Sigma[1][1] * x * x - 2 * Sigma[0][1] * x * y + Sigma[0][0] * y * y) / det;
}

/** k=1,2,3 σ 안의 표본 비율. 2D 닫힌형은 1−e^(−k²/2) 다 (스펙 §2-C). */
export function containment(Sigma, mean, pts) {
  const cnt = [0, 0, 0];
  for (const p of pts) {
    const m2 = mahalanobis2(Sigma, mean, p);
    for (let k = 1; k <= 3; k++) if (m2 <= k * k) cnt[k - 1]++;
  }
  return cnt.map((c) => c / pts.length);
}

/** 방향 φ(도) 단위벡터에 대한 주변 분산 dᵀΣd — 주변화는 방향으로 누르는 것이다. */
export function dirVariance(Sigma, phiDeg) {
  const t = (phiDeg * Math.PI) / 180;
  const dx = Math.cos(t);
  const dy = Math.sin(t);
  return dx * (Sigma[0][0] * dx + Sigma[0][1] * dy) + dy * (Sigma[1][0] * dx + Sigma[1][1] * dy);
}

/** 표본을 방향 φ 에 투영한 스칼라들. */
export function projectDir(pts, phiDeg) {
  const t = (phiDeg * Math.PI) / 180;
  const dx = Math.cos(t);
  const dy = Math.sin(t);
  return pts.map(([x, y]) => x * dx + y * dy);
}

/** 표준정규 밀도의 스케일판. */
export function gaussPdf(x, mu, sd) {
  const z = (x - mu) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

/** 스칼라 평균·표준편차 (n−1 분모). */
export function meanSd(vals) {
  const n = vals.length;
  if (n < 2) return { n, mean: NaN, sd: NaN };
  let s = 0;
  for (const v of vals) s += v;
  const mean = s / n;
  let q = 0;
  for (const v of vals) q += (v - mean) * (v - mean);
  return { n, mean, sd: Math.sqrt(q / (n - 1)) };
}

/**
 * 조건부의 이론값. 폭 0 슬라이스는 N(ρc, 1−ρ²) 이고, 유한 폭 w 는 분산을
 * ρ²w²/12 만큼 부풀린다 — 슬라이스 안 x₂ 를 균일로 근사한 값이라 w≤1 에서만 맞는다
 * (스펙 §2-E2, §3-3).
 */
export function conditionalParams(rho, c, w = 0) {
  const v0 = 1 - rho * rho;
  return {
    mean: rho * c,
    sd0: Math.sqrt(v0),
    sdW: Math.sqrt(v0 + (rho * rho * w * w) / 12),
  };
}

/** |x₂−c| < w/2 슬라이스에 든 x₁ 들. */
export function sliceValues(pts, c, w) {
  const out = [];
  for (const [x1, x2] of pts) if (Math.abs(x2 - c) < w / 2) out.push(x1);
  return out;
}

/**
 * 원근 나눗셈 u = x/z 의 모멘트 실측 (스펙 §2-F). linSd 는 3DGS/EWA 가 쓰는
 * 야코비안 선형화 √((σx/z₀)² + (x₀σz/z₀²)²) 다.
 * ⚠️ z 의 지지집합이 0 을 덮으면(z₀/σz ≲ 3) 모멘트가 사실상 없어 값이 시드 종속이다.
 */
export function perspectiveStats({ x0, sx, z0, sz, N, seed }) {
  const rnd = mulberry32(seed);
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  for (let i = 0; i < N; i++) {
    const [zx, zz] = gaussPair(rnd);
    const u = (x0 + sx * zx) / (z0 + sz * zz);
    s1 += u; s2 += u * u; s3 += u * u * u; s4 += u * u * u * u;
  }
  const m = s1 / N;
  const v = s2 / N - m * m;
  const sd = Math.sqrt(v);
  const m3 = s3 / N - (3 * m * s2) / N + 2 * m ** 3;
  const m4 = s4 / N - (4 * m * s3) / N + (6 * m * m * s2) / N - 3 * m ** 4;
  return {
    mean: m,
    sd,
    skew: m3 / sd ** 3,
    exKurt: m4 / (v * v) - 3,
    linSd: Math.hypot(sx / z0, (x0 * sz) / (z0 * z0)),
  };
}

/** 히스토그램. density 는 적분이 1 이 되도록 정규화한 막대 높이다. */
export function histogram(vals, { min, max, bins }) {
  const counts = new Array(bins).fill(0);
  const bw = (max - min) / bins;
  let inside = 0;
  for (const v of vals) {
    const i = Math.floor((v - min) / bw);
    if (i >= 0 && i < bins) { counts[i]++; inside++; }
  }
  const norm = inside > 0 ? inside * bw : 1;
  return {
    counts,
    density: counts.map((c) => c / norm),
    edges: Array.from({ length: bins + 1 }, (_, i) => min + i * bw),
  };
}
