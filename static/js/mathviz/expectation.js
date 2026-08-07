// static/js/mathviz/expectation.js
// 11편의 순수 수학 — 기댓값·분산과 √N. DOM 없음.
//
// RNG 는 5편 stochastic.js 의 mulberry32 · gaussPair 를 그대로 쓴다.
// ⚠️ 스펙 §2 의 표는 아래 draw 들의 **소비 순서 그대로** 측정됐다 — 가우시안의
// 짝 버퍼링, 코시의 재시도까지 바꾸면 글의 숫자가 재현되지 않는다.

import { mulberry32, gaussPair } from './stochastic.js';

export const DIST_KINDS = ['uniform', 'gauss', 'exp', 'cauchy'];

export const DIST_LABELS = {
  uniform: '균등',
  gauss: '가우시안',
  exp: '지수',
  cauchy: '코시 (가우시안 비)',
};

/**
 * 평균 0 으로 맞춘 분포 표본기. sigma 는 닫힌형 표준편차 — 코시는 NaN 이다
 * (분산이 없다는 것이 §2-E 의 주제다).
 */
export function makeDist(kind, seed) {
  const rnd = mulberry32(seed);
  if (kind === 'uniform') return { draw: () => rnd() - 0.5, sigma: Math.sqrt(1 / 12) };
  if (kind === 'gauss') {
    let buf = null;
    return {
      draw: () => {
        if (buf !== null) { const v = buf; buf = null; return v; }
        const [a, b] = gaussPair(rnd);
        buf = b;
        return a;
      },
      sigma: 1,
    };
  }
  if (kind === 'exp') return { draw: () => -Math.log(1 - rnd()) - 1, sigma: 1 };
  if (kind === 'cauchy') {
    // 표준 코시 = 가우시안 두 개의 비 — 10편 원근 나눗셈의 z₀ = 0 극한이다.
    return {
      draw: () => {
        let d = 0;
        let n = 0;
        while (d === 0) [n, d] = gaussPair(rnd);
        return n / d;
      },
      sigma: NaN,
    };
  }
  throw new Error(`unknown dist: ${kind}`);
}

export const meanOf = (a) => a.reduce((t, x) => t + x, 0) / a.length;

/** 표본 표준편차 — 분모는 N−1 이다 (§2-D 가 이유다). */
export function sdOf(a) {
  const m = meanOf(a);
  return Math.sqrt(a.reduce((t, x) => t + (x - m) ** 2, 0) / (a.length - 1));
}

export function medianOf(a) {
  const s = [...a].sort((x, y) => x - y);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}

/** 러닝 평균 궤적: n 번째 값이 처음 n 개의 평균. 데모 1 왼쪽이 그린다. */
export function runningMean(dist, N) {
  const out = new Array(N);
  let s = 0;
  for (let i = 0; i < N; i++) {
    s += dist.draw();
    out[i] = s / (i + 1);
  }
  return out;
}

/**
 * 추정량의 흩어짐: 시행마다 N 개를 뽑아 추정하고, |추정 − 0| 의 중앙값을 돌려준다.
 * sd 가 아니라 중앙값 절대오차인 이유: 코시에서 sd 는 정의도 수렴도 안 되지만
 * 이 지표는 언제나 유한하다. 가우시안 평균에서는 0.6745·σ/√N 과 같다.
 */
export function estimatorSpread(dist, N, trials, estimator) {
  const est = estimator === 'median' ? medianOf : meanOf;
  const errs = new Array(trials);
  for (let t = 0; t < trials; t++) {
    const xs = new Array(N);
    for (let i = 0; i < N; i++) xs[i] = dist.draw();
    errs[t] = Math.abs(est(xs));
  }
  return medianOf(errs);
}

/**
 * 공통인자 모형: xᵢ = √ρ·z공통 + √(1−ρ)·zᵢ. 상관 ρ, 분산 1.
 * 시행마다 { readings, mean } — 데모 2 왼쪽이 readings 행을, 오른쪽이 mean 을 쓴다.
 * ⚠️ 소비 순서: 시행마다 공통 1개 → 개별 N 개 (스펙 §2-C 의 측정 순서).
 */
export function corrTrials({ rho, N, trials, seed }) {
  const dist = makeDist('gauss', seed);
  const a = Math.sqrt(rho);
  const b = Math.sqrt(1 - rho);
  const out = [];
  for (let t = 0; t < trials; t++) {
    const common = dist.draw();
    const readings = new Array(N);
    let s = 0;
    for (let i = 0; i < N; i++) {
      readings[i] = a * common + b * dist.draw();
      s += readings[i];
    }
    out.push({ readings, mean: s / N });
  }
  return out;
}

/** 상관 바닥의 닫힌형: sd(평균) = √(σ²/N + (1−1/N)ρσ²), σ=1. 바닥은 √ρ 다. */
export function corrMeanSd(rho, N) {
  return Math.sqrt(1 / N + (1 - 1 / N) * rho);
}
