// static/js/mathviz/eightpoint.js
// 데모 2 — 8점으로 F 를 패기.
//
// 왼쪽: 카메라 1 이미지. 깨끗한 대응 8점(연한)과 알고리즘이 실제로 받은 잡음 섞인
// 입력(진한)을 같이 보여준다. 오른쪽: 복원한 F̂ 의 에피폴라 직선(진한)과 정답 F 의
// 직선(연한)을 겹친다 — 벌어진 폭이 추정 오차다.
//
// 존재 이유는 `정규화` × `배치` 조합이다. 스펙 §2-7: 조건수는 정규화로 항상 2000배
// 넘게 좋아지는데 **정확도 이득은 배치가 정한다** — 전진 배치 1.2배, 좌우 스테레오
// 4\~5배. 교과서가 "무조건 정규화" 로 뭉개는 지점이다.
//
// ⚠️ readout 은 **시드 30개 평균**이다. 한 번의 잡음 추출로는 1.2배가 안 보인다 —
// 단일 시드에서는 1.01배까지 나와서 화면 숫자가 주장과 어긋난다. 4ms 밖에 안 걸리니
// 매 렌더마다 평균을 다시 낸다. 그려지는 직선만 대표 추출 하나를 쓴다.
//
// ⚠️ 에피폴 오차는 **중앙값**이다. 꼬리가 두꺼워서 평균을 쓰면 스테레오에서
// 259671 px 같은 값이 찍힌다 (중앙값은 523 px). 5편의 "한 궤적으로는 못 잰다" 와
// 같은 종류의 함정이다.

import { lookAt, intrinsics, projectPoint } from './camera.js';
import {
  fundamentalFromCameras, fundamentalFromPairs, epipoles,
  epipolarLineInSecond, conditionNumber, symmetricEpipolarDistance,
  normalizingTransform, svd3,
} from './epipolar.js';
import {
  IMAGE_WORLD, IMAGE_SIZE, IMAGE_CX, IMAGE_CY, F_DEFAULT,
  GROUND_LINES, drawPolys,
} from './scene.js';
import {
  themeColors, onThemeChange, createView, drawPath, drawPolygon,
  makeSliders, makeToggles, makeRadios,
} from './core.js';

const K = intrinsics({ f: F_DEFAULT, cx: IMAGE_CX, cy: IMAGE_CY });
const UP = [0, 0, 1];
const TARGET = [0, 0, 0.8];
/** 평균에 쓸 시드 수. 30 이면 배율이 안정되고 전체 4ms 다. */
const RUNS = 30;

/** 스펙 §2-4·§2-7 의 두 배치. 이 데모의 논지가 둘의 차이다. */
const LAYOUTS = {
  forward: { label: '전진 + 약간 좌우', eye1: [-0.5, -8, 1.6], eye2: [0.5, -4, 1.6] },
  stereo: { label: '좌우 스테레오', eye1: [-2, -6, 1.6], eye2: [2, -6, 1.6] },
};

/** 스펙 §2 의 그 3D 점들. 앞 8개로 F 를 풀고, 12개 전부로 기하 오차를 잰다. */
const OBJ = [
  [0, 0, 0], [0.5, 0.5, 1], [-0.5, -0.5, 0], [3, 2, 0], [-3, 4, 0], [1, -1, 0.5],
  [2, 5, 1.5], [-2, 1, 2], [0.3, 0.7, 0], [4, -1, 0.2], [-1, 3, 1], [2, -2, 0.6],
];

/** 시드 난수 — Math.random 을 쓰지 않는다. */
function makeNoise(seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  return () => {
    const u = 1 - rnd(), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}
const applyT = (T, [u, v]) => [
  T[0][0] * u + T[0][1] * v + T[0][2],
  T[1][0] * u + T[1][1] * v + T[1][2],
];
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function init(root) {
  const canvases = root.querySelectorAll('canvas');
  if (canvases.length < 2) throw new Error('eightpoint 는 panes="2" 가 필요하다');
  const [canvas1, canvas2] = canvases;

  const view1 = createView(canvas1, IMAGE_WORLD);
  const view2 = createView(canvas2, IMAGE_WORLD);
  const sliderHost = root.querySelector('.mv-sliders');
  const readout = root.querySelector('.mv-readout');
  const hint = root.querySelector('.mv-hint');

  const state = { sigma: 0.5, layout: 'forward' };
  let seed = 7;
  let toggles;

  const sliders = makeSliders(sliderHost, [
    { key: 'sigma', label: '잡음 σ', min: 0, max: 3, step: 0.05, value: 0.5,
      fmt: (v) => `${v.toFixed(2)} px` },
  ], (v) => { Object.assign(state, v); render(); });

  toggles = makeToggles(sliderHost, [
    { key: 'normalized', label: 'Hartley 정규화', value: true },
    { key: 'showTruth', label: '정답 F 겹쳐 보기', value: true },
  ], render);

  makeRadios(sliderHost, {
    key: 'layout',
    label: '배치',
    value: 'forward',
    options: Object.entries(LAYOUTS).map(([value, l]) => ({ value, label: l.label })),
  }, (v) => { Object.assign(state, v); render(); });

  const btnRow = document.createElement('div');
  btnRow.className = 'mv-slider';
  const btn = document.createElement('button');
  btn.textContent = '잡음 다시';
  btn.style.gridColumn = 'span 2';
  btn.addEventListener('click', () => { seed += 1; render(); });
  btnRow.append(document.createElement('label'), btn);
  sliderHost.appendChild(btnRow);

  /** 카메라쌍, 정답 F, 깨끗한 대응. */
  function scene() {
    const L = LAYOUTS[state.layout];
    const cam1 = { K, ...lookAt({ eye: L.eye1, target: TARGET, up: UP }) };
    const cam2 = { K, ...lookAt({ eye: L.eye2, target: TARGET, up: UP }) };
    const clean = OBJ.map((X) => {
      const a = projectPoint(cam1, X), b = projectPoint(cam2, X);
      return [[a.u, a.v], [b.u, b.v]];
    });
    return { cam1, cam2, Ftrue: fundamentalFromCameras(cam1, cam2), clean };
  }

  const jitter = (clean, g) => clean.slice(0, 8).map(([a, b]) => [
    [a[0] + g() * state.sigma, a[1] + g() * state.sigma],
    [b[0] + g() * state.sigma, b[1] + g() * state.sigma],
  ]);

  /**
   * 시드 RUNS 개 평균. 기하 오차는 **깨끗한 대응 12개**로 잰다 — 잡음 8개로 재면
   * 자기 입력에 얼마나 맞췄는지를 재게 되어 일반화 성능이 아니다.
   */
  function measure(normalized) {
    const { Ftrue, clean } = scene();
    const eT = epipoles(Ftrue);
    const g = makeNoise(seed);
    let geo = 0, cond = 0;
    const eErrs = [];
    for (let k = 0; k < RUNS; k++) {
      const noisy = jitter(clean, g);
      const F = fundamentalFromPairs(noisy, { normalized });
      geo += symmetricEpipolarDistance(F, clean);
      // cond(A) 는 실제로 푼 그 행렬에서 잰다 (정규화를 켰으면 정규화 좌표계)
      let pairs = noisy;
      if (normalized) {
        const T1 = normalizingTransform(noisy.map((q) => q[0]));
        const T2 = normalizingTransform(noisy.map((q) => q[1]));
        pairs = noisy.map(([a, b]) => [applyT(T1, a), applyT(T2, b)]);
      }
      cond += conditionNumber(pairs);
      const e = epipoles(F);
      eErrs.push((e.e1.atInfinity || eT.e1.atInfinity)
        ? NaN
        : Math.hypot(e.e1.u - eT.e1.u, e.e1.v - eT.e1.v));
    }
    return {
      geo: geo / RUNS,
      cond: cond / RUNS,
      eMedian: median(eErrs.filter(Number.isFinite)),
    };
  }

  function clipLine(l) {
    const { xmin, xmax, ymin, ymax } = IMAGE_WORLD;
    const lo = Math.min(ymin, ymax), hi = Math.max(ymin, ymax);
    const cand = [];
    if (Math.abs(l[1]) > 1e-12) for (const u of [xmin, xmax]) cand.push([u, -(l[0] * u + l[2]) / l[1]]);
    if (Math.abs(l[0]) > 1e-12) for (const v of [lo, hi]) cand.push([-(l[1] * v + l[2]) / l[0], v]);
    const inside = cand.filter(([u, v]) => u >= xmin - 1 && u <= xmax + 1 && v >= lo - 1 && v <= hi + 1);
    return inside.length >= 2 ? [inside[0], inside[1]] : null;
  }

  function render() {
    const c = themeColors();
    const { cam1, cam2, Ftrue, clean } = scene();
    const { normalized, showTruth } = toggles.getValues();
    const S = IMAGE_SIZE;

    // 그려지는 것은 **대표 추출 하나**다 (readout 의 평균과는 별개)
    const draw = jitter(clean, makeNoise(seed));
    const Fhat = fundamentalFromPairs(draw, { normalized });

    for (const [canvas, view, cam] of [[canvas1, view1, cam1], [canvas2, view2, cam2]]) {
      view.resize();
      const ctx = canvas.getContext('2d');
      const { w, h } = view.size;
      ctx.clearRect(0, 0, w, h);
      drawPolys(ctx, view, cam, GROUND_LINES, { color: c.grid, width: 1 });
      drawPolygon(ctx, view, [[0, 0], [S, 0], [S, S], [0, S]], { stroke: c.fg, width: 1.5 });
    }
    const ctx1 = canvas1.getContext('2d');
    const ctx2 = canvas2.getContext('2d');

    clean.slice(0, 8).forEach(([a], i) => {
      const [x, y] = view1.toPixel(a);
      ctx1.beginPath(); ctx1.arc(x, y, 3, 0, Math.PI * 2);
      ctx1.fillStyle = c.grid; ctx1.fill();
      const [nx, ny] = view1.toPixel(draw[i][0]);
      ctx1.beginPath(); ctx1.arc(nx, ny, 4, 0, Math.PI * 2);
      ctx1.fillStyle = c.accent; ctx1.fill();
      ctx1.strokeStyle = c.bg; ctx1.lineWidth = 1.5; ctx1.stroke();
    });

    draw.forEach(([a], i) => {
      if (showTruth) {
        const t = clipLine(epipolarLineInSecond(Ftrue, clean[i][0]));
        if (t) drawPath(ctx2, view2, t, { color: c.grid, width: 2 });
      }
      const h = clipLine(epipolarLineInSecond(Fhat, a));
      if (h) drawPath(ctx2, view2, h, { color: c.accent, width: 1.8 });
      const [x, y] = view2.toPixel(clean[i][1]);
      ctx2.beginPath(); ctx2.arc(x, y, 3, 0, Math.PI * 2);
      ctx2.fillStyle = c.accent2; ctx2.fill();
    });

    renderReadout(Ftrue, Fhat, clean);
  }

  function renderReadout(Ftrue, Fhat, clean) {
    const { normalized } = toggles.getValues();
    // 두 쪽을 **동시에** 보여준다 — 토글을 눌러보지 않아도 배율이 보인다
    const on = measure(true), off = measure(false);
    const cur = normalized ? on : off;
    const ratio = on.geo > 0 ? off.geo / on.geo : NaN;
    const eT = epipoles(Ftrue);
    const epiOnScreen = !eT.e1.atInfinity
      && eT.e1.u >= 0 && eT.e1.u <= IMAGE_SIZE && eT.e1.v >= 0 && eT.e1.v <= IMAGE_SIZE;
    const s3 = svd3(Fhat).S;
    const mark = (isOn) => (isOn === normalized ? '<b>' : '<span class="mv-cell">');
    const endMark = (isOn) => (isOn === normalized ? '</b>' : '</span>');

    readout.innerHTML = `
      <div>cond(A) — 정규화 ${mark(true)}O ${on.cond.toExponential(2)}${endMark(true)}
        · ${mark(false)}X ${off.cond.toExponential(2)}${endMark(false)}
        <span class="ok">${(off.cond / on.cond).toExponential(1)}배 차이</span></div>
      <div>기하 오차 (시드 ${RUNS}개 평균) — 정규화 ${mark(true)}O ${on.geo.toFixed(3)} px${endMark(true)}
        · ${mark(false)}X ${off.geo.toFixed(3)} px${endMark(false)}
        → <b class="${ratio > 2 ? 'ok' : 'no'}">${ratio.toFixed(2)}배</b></div>
      <div>에피폴 오차 (중앙값) — O ${on.eMedian.toFixed(0)} px · X ${off.eMedian.toFixed(0)} px
        ${epiOnScreen ? '' : '<span class="no">— 정답 에피폴이 화면 밖이라 매우 불안정하다</span>'}</div>
      <div>σ₃/σ₁ = ${(s3[2] / s3[0]).toExponential(1)} · 잡음 시드 ${seed}
        · 대응 8개로 풀고 12개로 평가</div>`;

    hint.innerHTML = `조건수는 <b>${(off.cond / on.cond).toExponential(1)}배</b> 갈리는데
      기하 오차는 <b>${ratio.toFixed(2)}배</b>만 갈립니다.
      <code>배치</code>를 바꿔보세요 — 같은 토글이 전진 배치에서는 1.2배 정도, 좌우
      스테레오에서는 4\~5배를 만듭니다. <b>정규화가 고치는 것은 조건수이고, 그것이
      정확도로 얼마나 번지는지는 배치가 정합니다.</b>
      ${epiOnScreen ? '' : ' 이 배치는 에피폴이 화면 밖이라 에피폴 추정 자체가 불안정합니다.'}`;
  }

  onThemeChange(render);
  window.addEventListener('resize', render);
  render();
}
