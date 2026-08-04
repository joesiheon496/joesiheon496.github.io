// static/js/mathviz/errorcigar.js
// 데모 1 — 오차는 공이 아니라 시가다.
//
// 왼쪽은 **장면 뷰**(미터), 오른쪽은 **오차 단면**(밀리미터)이다. 두 패널의 축척이
// 340배 다르다 — 거리 8 m 에서 오차 타원체가 47 mm 이므로 한 화면에 같이 그릴 수 없다.
// 그래서 오른쪽을 따로 두고 자동 축척한다. 축척 배율을 readout 에 적는다.
//
// 오른쪽 평면은 **시선 방향을 포함하는** 평면이다 (시선에 수직인 평면이 아니다).
// 수직 단면을 그리면 늘어나는 방향이 화면 밖으로 나가 시가가 원으로 보인다.
// 가로축 = 횡방향, 세로축 = 시선방향.

import {
  lookAt, intrinsics, projectPoint, cameraCenter, projectPolyline,
  add, sub, scale, dot, norm, normalize, cross, matVec,
} from './camera.js';
import { jacobiEig } from './epipolar.js';
import {
  rayFromImage, triangulateMidpoint, triangulateDLT, triangulateGN,
  errorEllipsoid, rayAngle, makeRng, gaussian,
} from './triangulate.js';
import {
  IMAGE_SIZE, F_DEFAULT, IMAGE_CX, IMAGE_CY, OBS,
  GROUND_LINES, drawPolys, frustumPolys,
} from './scene.js';
import {
  themeColors, onThemeChange, createView, drawPath,
  makeSliders, makeToggles,
} from './core.js';

const K = intrinsics({ f: F_DEFAULT, cx: IMAGE_CX, cy: IMAGE_CY });
const UP = [0, 0, 1];
const TARGET = [0, 0, 0.8];
/** 표본 수. 300 이면 시가 모양이 읽히고 슬라이더가 끊기지 않는다. */
const TRIALS = 300;
/** 시드 고정 — 슬라이더를 되돌리면 같은 그림이 나온다. */
const SEED = 20260804;

/** 좌우 스테레오 배치. 스펙 §2 의 기준 배치이고 B 만 슬라이더로 바뀐다. */
function stereo(B) {
  return {
    cam1: { K, ...lookAt({ eye: [-B / 2, -6, 1.6], target: TARGET, up: UP }) },
    cam2: { K, ...lookAt({ eye: [B / 2, -6, 1.6], target: TARGET, up: UP }) },
  };
}
/** 두 카메라 중점에서 시선방향 dist m 떨어진 점. */
function pointAt(cam1, cam2, dist) {
  const mid = scale(add(cameraCenter(cam1), cameraCenter(cam2)), 0.5);
  return add(mid, scale(normalize(sub(TARGET, mid)), dist));
}

export function init(root) {
  const canvases = root.querySelectorAll('canvas');
  if (canvases.length < 2) throw new Error('errorcigar 는 panes="2" 가 필요하다');
  const [sceneCanvas, crossCanvas] = canvases;

  // 장면 뷰는 world 를 매 렌더마다 고쳐 쓴다 (거리가 32 m 까지 가면 기본 시야를 넘는다)
  const sceneWorld = { xmin: 0, xmax: 480, ymin: 480, ymax: 0 };
  const crossWorld = { xmin: -50, xmax: 50, ymin: -50, ymax: 50 };
  const sceneView = createView(sceneCanvas, sceneWorld);
  const crossView = createView(crossCanvas, crossWorld);

  const sliderHost = root.querySelector('.mv-sliders');
  const readout = root.querySelector('.mv-readout');
  const hint = root.querySelector('.mv-hint');

  const state = { baseline: 4, dist: 8, sigma: 1 };
  let toggles;

  makeSliders(sliderHost, [
    { key: 'baseline', label: '베이스라인 B', min: 0.5, max: 8, step: 0.1, value: 4,
      fmt: (v) => `${v.toFixed(1)} m` },
    { key: 'dist', label: '점까지 거리', min: 4, max: 32, step: 0.5, value: 8,
      fmt: (v) => `${v.toFixed(1)} m` },
    // ⚠️ 상한 10 px. 그 위에서 가우스-뉴턴이 발산한다 (스펙 §2-10, §3-2)
    { key: 'sigma', label: '화소 잡음 σ', min: 0.2, max: 10, step: 0.2, value: 1,
      fmt: (v) => `${v.toFixed(1)} px` },
  ], (v) => { Object.assign(state, v); render(); });

  toggles = makeToggles(sliderHost, [
    { key: 'samples', label: '표본 산포', value: true },
    { key: 'predicted', label: '예측 타원 σ²(JᵀJ)⁻¹', value: true },
    { key: 'compare', label: '세 방법 비교', value: false },
  ], render);

  /** 잡음 표본에서 세 방법의 오차 벡터를 모은다. */
  function simulate(cam1, cam2, X, sigma) {
    const a = projectPoint(cam1, X), b = projectPoint(cam2, X);
    const rand = makeRng(SEED);
    const out = { mid: [], dlt: [], gn: [], gaps: [], diverged: 0 };
    for (let k = 0; k < TRIALS; k++) {
      const x1 = [a.u + sigma * gaussian(rand), a.v + sigma * gaussian(rand)];
      const x2 = [b.u + sigma * gaussian(rand), b.v + sigma * gaussian(rand)];
      const m = triangulateMidpoint(cam1, cam2, x1, x2);
      const d = triangulateDLT(cam1, cam2, x1, x2);
      if (!m || !d) continue;
      const g = triangulateGN(cam1, cam2, x1, x2, d.X, { refDist: norm(sub(X, a)) });
      if (!g.X.every(Number.isFinite)) { out.diverged++; continue; }
      out.mid.push(sub(m.X, X));
      out.dlt.push(sub(d.X, X));
      out.gn.push(sub(g.X, X));
      out.gaps.push(m.gap);
    }
    return out;
  }

  /** 시선방향 v 와 그에 수직인 한 방향으로 이루는 2D 기저. */
  function crossBasis(view3) {
    // 수직 방향은 월드 z 를 쓰되 시선과 평행하면 x 로 바꾼다
    let ref = [0, 0, 1];
    if (Math.abs(dot(ref, view3)) > 0.95) ref = [1, 0, 0];
    const lat = normalize(cross(view3, ref));
    return { lat, depth: view3 };
  }

  /** 3D 오차를 (횡, 시선) 평면 좌표(mm)로. */
  const toCross = (e, basis) => [dot(e, basis.lat) * 1000, dot(e, basis.depth) * 1000];

  /** σ²(JᵀJ)⁻¹ 을 그 평면으로 사영한 2×2 공분산 → 타원 반축·회전. */
  function predictedEllipse(cam1, cam2, X, sigma, basis) {
    const { axes, dirs } = errorEllipsoid(cam1, cam2, X, sigma);
    // C = Σ (axis_i)² dir_i dir_iᵀ  를 (lat, depth) 로 사영
    const B = [basis.lat, basis.depth];
    const C2 = [0, 1].map((i) => [0, 1].map((j) => axes.reduce(
      (s, a, k) => s + a * a * dot(B[i], dirs[k]) * dot(B[j], dirs[k]), 0,
    )));
    const { values, vectors } = jacobiEig(C2);
    const idx = values[0] >= values[1] ? [0, 1] : [1, 0];
    return {
      semi: idx.map((i) => Math.sqrt(Math.max(0, values[i])) * 1000),
      angle: Math.atan2(vectors[1][idx[0]], vectors[0][idx[0]]),
    };
  }

  /** 관찰자 카메라로 3D 점들을 투영해 딱 맞는 world 를 만든다. */
  function fitScene(pts) {
    const proj = pts.map((P) => projectPoint(OBS, P)).filter((p) => p.z > 0);
    if (!proj.length) return;
    const us = proj.map((p) => p.u), vs = proj.map((p) => p.v);
    const pad = 40;
    const cx = (Math.min(...us) + Math.max(...us)) / 2;
    const cy = (Math.min(...vs) + Math.max(...vs)) / 2;
    // 정사각 캔버스라 한 변으로 맞춘다
    const half = Math.max(
      (Math.max(...us) - Math.min(...us)) / 2,
      (Math.max(...vs) - Math.min(...vs)) / 2,
    ) + pad;
    sceneWorld.xmin = cx - half; sceneWorld.xmax = cx + half;
    // y 는 뒤집어야 이미지 v 가 아래로 커진다 (6편 규약)
    sceneWorld.ymin = cy + half; sceneWorld.ymax = cy - half;
  }

  function render() {
    const c = themeColors();
    const { samples, predicted, compare } = toggles.getValues();
    const { cam1, cam2 } = stereo(state.baseline);
    const X = pointAt(cam1, cam2, state.dist);
    const C1 = cameraCenter(cam1), C2 = cameraCenter(cam2);
    const [x1, x2] = [projectPoint(cam1, X), projectPoint(cam2, X)];

    // ---------- 왼쪽: 장면 ----------
    sceneView.resize();
    const ctx = sceneCanvas.getContext('2d');
    fitScene([C1, C2, X, ...frustumPolys(cam1, { length: 1.2 }).flat()]);
    const { w, h } = sceneView.size;
    ctx.clearRect(0, 0, w, h);
    drawPolys(ctx, sceneView, OBS, GROUND_LINES, { color: c.grid, width: 1 });
    drawPolys(ctx, sceneView, OBS, frustumPolys(cam1, { length: 1.2 }), { color: c.muted, width: 1.4 });
    drawPolys(ctx, sceneView, OBS, frustumPolys(cam2, { length: 1.2 }), { color: c.muted, width: 1.4 });
    // 베이스라인
    drawPolys(ctx, sceneView, OBS, [[C1, C2]], { color: c.muted, width: 1.2 });
    // 두 광선 — 색이 다르다 (7편 §3-7 교훈: 의미가 다른 선은 색을 먼저 배정)
    const extend = (C, P) => add(C, scale(sub(P, C), 1.25));
    drawPolys(ctx, sceneView, OBS, [[C1, extend(C1, X)]], { color: c.accent, width: 1.8 });
    drawPolys(ctx, sceneView, OBS, [[C2, extend(C2, X)]], { color: c.accent3, width: 1.8 });
    // 참 점
    const pX = projectPoint(OBS, X);
    if (pX.z > 0) {
      const [px, py] = sceneView.toPixel([pX.u, pX.v]);
      ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = c.fg; ctx.fill();
    }

    // ---------- 오른쪽: 오차 단면 (mm) ----------
    const sim = simulate(cam1, cam2, X, state.sigma);
    const { d: view3 } = rayFromImage(cam1, [x1.u, x1.v]);
    const basis = crossBasis(view3);
    const ell = predictedEllipse(cam1, cam2, X, state.sigma, basis);
    // 축척: 예측 장반축의 3.2배를 반폭으로 — 표본 대부분이 들어온다
    const half = Math.max(ell.semi[0] * 3.2, 1e-3);
    crossWorld.xmin = -half; crossWorld.xmax = half;
    crossWorld.ymin = -half; crossWorld.ymax = half;

    crossView.resize();
    const cctx = crossCanvas.getContext('2d');
    const cs = crossView.size;
    cctx.clearRect(0, 0, cs.w, cs.h);
    // 십자선 — 가로 = 횡방향, 세로 = 시선방향
    const [ox, oy] = crossView.toPixel([0, 0]);
    cctx.strokeStyle = c.grid; cctx.lineWidth = 1;
    cctx.beginPath(); cctx.moveTo(0, oy); cctx.lineTo(cs.w, oy); cctx.stroke();
    cctx.beginPath(); cctx.moveTo(ox, 0); cctx.lineTo(ox, cs.h); cctx.stroke();

    if (samples) {
      const sets = compare
        ? [[sim.mid, c.accent], [sim.dlt, c.accent3], [sim.gn, c.accent2]]
        : [[sim.gn, c.accent2]];
      for (const [set, color] of sets) {
        cctx.fillStyle = color;
        for (const e of set) {
          const [px, py] = crossView.toPixel(toCross(e, basis));
          cctx.beginPath(); cctx.arc(px, py, 1.6, 0, Math.PI * 2); cctx.fill();
        }
      }
    }

    if (predicted) {
      // 1σ 와 2σ 타원
      for (const k of [1, 2]) {
        cctx.beginPath();
        for (let i = 0; i <= 64; i++) {
          const t = (i / 64) * Math.PI * 2;
          const ex = k * ell.semi[0] * Math.cos(t), ey = k * ell.semi[1] * Math.sin(t);
          const rx = ex * Math.cos(ell.angle) - ey * Math.sin(ell.angle);
          const ry = ex * Math.sin(ell.angle) + ey * Math.cos(ell.angle);
          const [px, py] = crossView.toPixel([rx, ry]);
          if (i === 0) cctx.moveTo(px, py); else cctx.lineTo(px, py);
        }
        cctx.closePath();
        cctx.strokeStyle = c.fg;
        cctx.lineWidth = k === 1 ? 2 : 1;
        cctx.setLineDash(k === 1 ? [] : [4, 4]);
        cctx.stroke();
      }
      cctx.setLineDash([]);
    }

    renderReadout(cam1, cam2, X, sim, basis, half);
  }

  function renderReadout(cam1, cam2, X, sim, basis, halfMm) {
    const [x1, x2] = [projectPoint(cam1, X), projectPoint(cam2, X)];
    const ang = rayAngle(cam1, cam2, [x1.u, x1.v], [x2.u, x2.v]) * 180 / Math.PI;
    const { axes, kappa, ratio } = errorEllipsoid(cam1, cam2, X, state.sigma);
    // 실측 축비 — 시선/횡 분해로 (타원체 축과 다른 양이다)
    const n = sim.gn.length || 1;
    const rms = (f) => Math.sqrt(sim.gn.reduce((s, e) => s + f(e) ** 2, 0) / n) * 1000;
    const depthRms = rms((e) => dot(e, basis.depth));
    const latRms = rms((e) => norm(sub(e, scale(basis.depth, dot(e, basis.depth)))));
    const gapMean = (sim.gaps.reduce((s, v) => s + v, 0) / n) * 1000;
    // 실측 타원체 축비
    const cov = [0, 1, 2].map((i) => [0, 1, 2].map(
      (j) => sim.gn.reduce((s, e) => s + e[i] * e[j], 0) / n,
    ));
    const measAxes = jacobiEig(cov).values
      .map((v) => Math.sqrt(Math.max(0, v)) * 1000).sort((a, b) => b - a);

    readout.innerHTML = `
      <div>광선 사잇각 <b>${ang.toFixed(2)}°</b> · 두 광선 최단거리 평균 <b>${gapMean.toFixed(2)} mm</b>
        <span class="no">— 만나지 않는다</span></div>
      <div>κ(JᵀJ) = <b>${kappa.toFixed(1)}</b> · √κ = <b>${ratio.toFixed(2)}</b></div>
      <div>축비 실측 <b>${(measAxes[0] / measAxes[2]).toFixed(2)}</b> vs √κ <b>${ratio.toFixed(2)}</b>
        <span class="ok">— 같은 수다</span></div>
      <div>최장축 예측 <b>${(axes[0] * 1000).toFixed(2)} mm</b> / 실측 <b>${measAxes[0].toFixed(2)} mm</b></div>
      <div>시선방향 ${depthRms.toFixed(2)} mm · 횡방향 ${latRms.toFixed(2)} mm
        (비 <b>${(depthRms / latRms).toFixed(1)}</b>)</div>
      <div class="mv-note">오른쪽 반폭 ${halfMm.toFixed(1)} mm — 왼쪽과 축척이
        약 ${Math.round((state.dist * 1000) / halfMm)}배 다릅니다${sim.diverged ? ` · 발산 ${sim.diverged}건` : ''}</div>`;

    hint.innerHTML = `<code>베이스라인</code>을 줄여보세요. 오른쪽 산포가 <b>세로로
      길어지고</b> κ 와 √κ 가 같이 커집니다 — 축비와 √κ 가 항상 같은 수로 붙어 다닙니다.
      <code>세 방법 비교</code>를 켜면 세 색이 <b>거의 겹칩니다</b>: 대칭 배치에서는
      어느 방법을 쓰는지가 답을 바꾸지 않습니다.`;
  }

  onThemeChange(render);
  window.addEventListener('resize', render);
  render();
}
