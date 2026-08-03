// static/js/mathviz/epilines.js
// 데모 1 — 에피폴라 직선.
//
// 두 패널이 둘 다 **이미지 뷰**다 (6편 데모처럼 장면 뷰 + 이미지 뷰가 아니다).
// 왼쪽이 카메라 1 이 보는 것, 오른쪽이 카메라 2 가 보는 것. 왼쪽에서 점을 끌면
// 오른쪽에 그 점의 에피폴라 직선이 뜬다 — 점 하나가 직선 하나로 제한된다.
//
// 존재 이유는 `직선 다발` 이다. 여러 점의 에피폴라 직선을 한꺼번에 켜면 전부
// 에피폴 한 점에서 만난다. 그리고 `배치` 를 좌우 스테레오로 바꾸면 에피폴이
// 화면 밖으로 나가버린다 — 스펙 §2-4, §2-9 가 화면에서 재현된다.

import {
  lookAt, intrinsics, projectPoint, cameraCenter, groundFromImage, dot,
} from './camera.js';
import {
  fundamentalFromCameras, epipoles,
  epipolarLineInSecond, epipolarLineInFirst, svd3,
} from './epipolar.js';
import {
  IMAGE_WORLD, IMAGE_SIZE, IMAGE_CX, IMAGE_CY, F_DEFAULT,
  GROUND_LINES, BOX_EDGES, drawPolys,
} from './scene.js';
import {
  themeColors, onThemeChange, createView, drawPath, drawPolygon,
  makeSliders, makeToggles, makeRadios, attachDrag, drawHandles,
} from './core.js';

const K = intrinsics({ f: F_DEFAULT, cx: IMAGE_CX, cy: IMAGE_CY });
const UP = [0, 0, 1];
const TARGET = [0, 0, 0.8];

/**
 * 배치 세 가지. 스펙 §2-4 의 실측 표에서 골랐다.
 *
 * 🔑 기본값이 좌우 스테레오가 **아니다.** 스테레오는 에피폴이 u=1752 로 화면(0\~480)
 * 밖에 나가서 "직선들이 한 점에서 만난다" 가 안 보이고, 위치 추정도 세 자리
 * 불안정하다 (§2-9: 6.5 px 대 7914 px). 전진 배치는 에피폴 둘이 다 화면 안이다.
 */
const LAYOUTS = {
  forward: { label: '전진 + 약간 좌우', eye1: [-0.5, -8, 1.6], eye2: [0.5, -4, 1.6] },
  axis: { label: '전진 (광축)', eye1: [0, -8, 1.6], eye2: [0, -4, 1.6] },
  stereo: { label: '좌우 스테레오', eye1: [-2, -6, 1.6], eye2: [2, -6, 1.6] },
};

/** 직선 다발에 쓸 지면 위 점들. 에피폴로 모이는 게 보이도록 흩어놓는다. */
const BUNDLE = [[-3, 1, 0], [-1, 4, 0], [1, 0, 0], [3, 3, 0], [0, 6, 0], [-4, 5, 0]];
/** 끌 수 있는 점의 기본 위치 (지면 위). */
const DRAG0 = [0.5, 1.5, 0];

export function init(root) {
  const canvases = root.querySelectorAll('canvas');
  if (canvases.length < 2) throw new Error('epilines 는 panes="2" 가 필요하다');
  const [canvas1, canvas2] = canvases;

  const view1 = createView(canvas1, IMAGE_WORLD);
  const view2 = createView(canvas2, IMAGE_WORLD);
  const sliderHost = root.querySelector('.mv-sliders');
  const readout = root.querySelector('.mv-readout');
  const hint = root.querySelector('.mv-hint');

  const state = { advance: 0, layout: 'forward' };
  let point = [...DRAG0];
  let toggles, radios;

  const sliders = makeSliders(sliderHost, [
    { key: 'advance', label: '카메라2 전진', min: -2, max: 2.5, step: 0.05, value: 0,
      fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} m` },
  ], (v) => { Object.assign(state, v); render(); });

  toggles = makeToggles(sliderHost, [
    { key: 'bundle', label: '직선 다발', value: true },
    { key: 'showEpipole', label: '에피폴 보기', value: true },
    { key: 'bothWays', label: '양방향 (1편에도 직선)', value: false },
  ], render);

  radios = makeRadios(sliderHost, {
    key: 'layout',
    label: '배치',
    value: 'forward',
    options: Object.entries(LAYOUTS).map(([value, l]) => ({ value, label: l.label })),
  }, (v) => { Object.assign(state, v); render(); });

  /** 두 카메라와 F. `카메라2 전진` 은 카메라 2 를 자기 시선 방향으로 민다. */
  function build() {
    const L = LAYOUTS[state.layout];
    const cam1 = { K, ...lookAt({ eye: L.eye1, target: TARGET, up: UP }) };
    const base = { K, ...lookAt({ eye: L.eye2, target: TARGET, up: UP }) };
    // 시선 방향(R 의 3행)으로 advance 만큼 이동 — 전진 배치의 의미를 살린다
    const fwd = base.R[2];
    const eye2 = L.eye2.map((v, i) => v + fwd[i] * state.advance);
    const cam2 = { K, ...lookAt({ eye: eye2, target: TARGET, up: UP }) };
    return { cam1, cam2, F: fundamentalFromCameras(cam1, cam2) };
  }

  /** 이미지 world 를 지나는 동차 직선을 선분으로 자른다. */
  function clipLine(l) {
    const { xmin, xmax, ymin, ymax } = IMAGE_WORLD;
    const lo = Math.min(ymin, ymax), hi = Math.max(ymin, ymax);
    const cand = [];
    if (Math.abs(l[1]) > 1e-12) for (const u of [xmin, xmax]) cand.push([u, -(l[0] * u + l[2]) / l[1]]);
    if (Math.abs(l[0]) > 1e-12) for (const v of [lo, hi]) cand.push([-(l[1] * v + l[2]) / l[0], v]);
    const inside = cand.filter(([u, v]) => u >= xmin - 1 && u <= xmax + 1 && v >= lo - 1 && v <= hi + 1);
    return inside.length >= 2 ? [inside[0], inside[1]] : null;
  }

  /** 에피폴이 world 밖이면 경계에 화살표를 찍는다 (6편 vanishing.js 규약). */
  function drawEdgeArrow(ctx, view, e, color) {
    const { xmin, xmax, ymin, ymax } = IMAGE_WORLD;
    const lo = Math.min(ymin, ymax), hi = Math.max(ymin, ymax);
    const u = Math.min(xmax - 8, Math.max(xmin + 8, e.u));
    const v = Math.min(hi - 8, Math.max(lo + 8, e.v));
    const [x, y] = view.toPixel([u, v]);
    const [cx, cy] = view.toPixel([(xmin + xmax) / 2, (lo + hi) / 2]);
    const ang = Math.atan2(y - cy, x - cx);
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-13, -6); ctx.lineTo(-13, 6); ctx.closePath();
    ctx.fillStyle = color; ctx.fill(); ctx.restore();
  }

  function markEpipole(ctx, view, e, color) {
    const { xmin, xmax, ymin, ymax } = IMAGE_WORLD;
    const lo = Math.min(ymin, ymax), hi = Math.max(ymin, ymax);
    if (e.atInfinity || !Number.isFinite(e.u) || !Number.isFinite(e.v)) return;
    if (e.u < xmin || e.u > xmax || e.v < lo || e.v > hi) {
      drawEdgeArrow(ctx, view, e, color);
      return;
    }
    const [x, y] = view.toPixel([e.u, e.v]);
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  }

  function render() {
    const c = themeColors();
    const { cam1, cam2, F } = build();
    const { bundle, showEpipole, bothWays } = toggles.getValues();
    const { e1, e2 } = epipoles(F);
    const S = IMAGE_SIZE;

    for (const [canvas, view, cam] of [[canvas1, view1, cam1], [canvas2, view2, cam2]]) {
      view.resize();
      const ctx = canvas.getContext('2d');
      const { w, h } = view.size;
      ctx.clearRect(0, 0, w, h);
      drawPolys(ctx, view, cam, GROUND_LINES, { color: c.grid, width: 1 });
      drawPolys(ctx, view, cam, BOX_EDGES, { color: c.muted, width: 1.5 });
      drawPolygon(ctx, view, [[0, 0], [S, 0], [S, S], [0, S]], { stroke: c.fg, width: 1.5 });
    }

    const ctx1 = canvas1.getContext('2d');
    const ctx2 = canvas2.getContext('2d');

    // --- 직선 다발: 여러 점의 에피폴라 직선이 에피폴에서 만난다 ---
    if (bundle) {
      for (const X of BUNDLE) {
        const p1 = projectPoint(cam1, X), p2 = projectPoint(cam2, X);
        if (p1.z <= 0 || p2.z <= 0) continue;
        const seg = clipLine(epipolarLineInSecond(F, [p1.u, p1.v]));
        if (seg) drawPath(ctx2, view2, seg, { color: c.grid, width: 1 });
        if (bothWays) {
          const s1 = clipLine(epipolarLineInFirst(F, [p2.u, p2.v]));
          if (s1) drawPath(ctx1, view1, s1, { color: c.grid, width: 1 });
        }
        for (const [ctx, view, p] of [[ctx1, view1, p1], [ctx2, view2, p2]]) {
          const [x, y] = view.toPixel([p.u, p.v]);
          ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = c.muted; ctx.fill();
        }
      }
    }

    // --- 끌고 있는 점과 그 에피폴라 직선 ---
    const q1 = projectPoint(cam1, point), q2 = projectPoint(cam2, point);
    if (q1.z > 0) {
      const seg = clipLine(epipolarLineInSecond(F, [q1.u, q1.v]));
      if (seg) drawPath(ctx2, view2, seg, { color: c.accent, width: 2.5 });
      drawHandles(ctx1, view1, [[q1.u, q1.v]], c);
    }
    if (q2.z > 0) {
      if (bothWays) {
        const seg = clipLine(epipolarLineInFirst(F, [q2.u, q2.v]));
        if (seg) drawPath(ctx1, view1, seg, { color: c.accent, width: 2.5 });
      }
      const [x, y] = view2.toPixel([q2.u, q2.v]);
      ctx2.beginPath(); ctx2.arc(x, y, 5, 0, Math.PI * 2);
      ctx2.fillStyle = c.accent; ctx2.fill();
      ctx2.strokeStyle = c.bg; ctx2.lineWidth = 2; ctx2.stroke();
    }

    if (showEpipole) {
      markEpipole(ctx1, view1, e1, c.accent2);
      markEpipole(ctx2, view2, e2, c.accent2);
    }

    renderReadout(cam1, cam2, F, e1, e2, q1, q2);
  }

  function renderReadout(cam1, cam2, F, e1, e2, q1, q2) {
    const inside = (e) => !e.atInfinity && Number.isFinite(e.u)
      && e.u >= 0 && e.u <= IMAGE_SIZE && e.v >= 0 && e.v <= IMAGE_SIZE;
    const residual = (q1.z > 0 && q2.z > 0)
      ? Math.abs(dot([q2.u, q2.v, 1], [
        F[0][0] * q1.u + F[0][1] * q1.v + F[0][2],
        F[1][0] * q1.u + F[1][1] * q1.v + F[1][2],
        F[2][0] * q1.u + F[2][1] * q1.v + F[2][2],
      ]))
      : NaN;
    const S = svd3(F).S;
    const fmtE = (e, name) => (e.atInfinity
      ? `${name} <b class="no">무한</b>`
      : `${name} (${e.u.toFixed(1)}, ${e.v.toFixed(1)}) ${inside(e) ? '<span class="ok">화면 안</span>' : '<span class="no">화면 밖</span>'}`);
    const baseline = cameraCenter(cam2).map((v, i) => v - cameraCenter(cam1)[i]);

    readout.innerHTML = `
      <div>|x₂ᵀ F x₁| = <b>${Number.isFinite(residual) ? residual.toExponential(2) : '—'}</b>
        <span class="ok">≈ 0 — 제약이 성립한다</span></div>
      <div>${fmtE(e1, 'e₁')}</div>
      <div>${fmtE(e2, 'e₂')}</div>
      <div>베이스라인 ${Math.hypot(...baseline).toFixed(2)} m · σ₃/σ₁ = ${(S[2] / S[0]).toExponential(1)} (rank 2)</div>`;

    hint.innerHTML = inside(e1) && inside(e2)
      ? '왼쪽 점을 끌어보세요. 오른쪽 직선이 따라 움직이지만 <b>언제나 에피폴을 지납니다</b>. <code>배치</code>를 <b>좌우 스테레오</b>로 바꾸면 에피폴이 화면 밖으로 나가버립니다 — 그래서 기본값이 전진 배치입니다.'
      : '<b>에피폴이 화면 밖입니다.</b> 경계 화살표가 방향을 가리킵니다. 이 배치에서는 직선들이 거의 평행해 보이고, 에피폴 위치 추정도 크게 불안정해집니다.';
  }

  // 왼쪽 이미지에서 점을 끈다 — 지면(Z=0)으로 되쏘아 3D 위치를 정한다.
  // 6편 groundFromImage 를 그대로 쓴다. 지평선 위를 클릭하면 null 이라 무시한다.
  attachDrag(canvas1, view1, () => {
    const { cam1 } = build();
    const p = projectPoint(cam1, point);
    return p.z > 0 ? [[p.u, p.v]] : [];
  }, (_i, worldPt) => {
    const { cam1 } = build();
    const g = groundFromImage(cam1, worldPt);
    if (!g) return;
    // 격자 범위 안으로 묶는다 — 밖으로 끌면 화면에서 사라져 되돌리기 어렵다
    point = [Math.max(-8, Math.min(8, g[0])), Math.max(-8, Math.min(8, g[1])), 0];
    render();
  });

  onThemeChange(render);
  window.addEventListener('resize', render);
  render();
}
