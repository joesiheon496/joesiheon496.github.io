// static/js/mathviz/gimbal.js
// 데모 1 — 세 숫자의 대가.
//
// 왼쪽은 오일러 세 각으로 돌린 좌표축 트라이어드, 오른쪽은 pitch 에 대한 κ 곡선이다.
// pitch 를 89.9° 로 밀면 `yaw` 와 `roll` 이 **같은 회전**을 만들고 κ 가 1e4 에 닿는다.
//
// 🔑 `좌표계` 를 회전벡터로 바꾸면 κ 가 **π/2 에서 멈춘다.** 그것이 이 글의 축이다 —
// 대가가 사라지는 게 아니라 순방향에서 역방향(log)으로 자리를 옮긴다.
//
// ⚠️ pitch 슬라이더 상한은 89.9° 다. 정확히 90° 는 야코비안이 특이하고 역산 오일러도
// 정의되지 않는다. 스펙 §3-7

import { add, scale } from './camera.js';
import {
  eulerToR, eulerKappa, eulerJacDet, eulerJacobian, dofCollapse,
  expKappa, expJacDet, angleBetween, I3,
} from './so3.js';
import { svd3 } from './epipolar.js';
import { OBS, GROUND_LINES, drawPolys } from './scene.js';
import {
  themeColors, onThemeChange, createView, drawPath,
  makeSliders, makeRadios,
} from './core.js';

const D = 180 / Math.PI;
const PITCH_MAX = 89.9;
/** 트라이어드 축 길이 (m). 지면 격자에 견줘 읽히는 크기로 골랐다. */
const AXIS_LEN = 2.4;

export function init(root) {
  const canvases = root.querySelectorAll('canvas');
  if (canvases.length < 2) throw new Error('gimbal 은 panes="2" 가 필요하다');
  const [sceneCanvas, curveCanvas] = canvases;

  const sceneWorld = { xmin: 60, xmax: 420, ymin: 430, ymax: 70 };
  const curveWorld = { xmin: 0, xmax: 90, ymin: -0.2, ymax: 4.3 };
  const sceneView = createView(sceneCanvas, sceneWorld);
  const curveView = createView(curveCanvas, curveWorld);

  const sliderHost = root.querySelector('.mv-sliders');
  const readout = root.querySelector('.mv-readout');
  const hint = root.querySelector('.mv-hint');

  const state = { yaw: 25, pitch: 30, roll: -15, chart: 'euler' };

  makeSliders(sliderHost, [
    { key: 'yaw', label: 'yaw (Z)', min: -180, max: 180, step: 1, value: 25,
      fmt: (v) => `${v.toFixed(0)}°` },
    { key: 'pitch', label: 'pitch (Y)', min: -PITCH_MAX, max: PITCH_MAX, step: 0.1, value: 30,
      fmt: (v) => `${v.toFixed(1)}°` },
    { key: 'roll', label: 'roll (X)', min: -180, max: 180, step: 1, value: -15,
      fmt: (v) => `${v.toFixed(0)}°` },
  ], (v) => { Object.assign(state, v); render(); });

  makeRadios(sliderHost, {
    key: 'chart',
    label: '좌표계',
    value: 'euler',
    options: [
      { value: 'euler', label: '오일러 ZYX' },
      { value: 'expmap', label: '회전벡터' },
    ],
  }, (v) => { Object.assign(state, v); render(); });

  const angles = () => [state.yaw / D, state.pitch / D, state.roll / D];

  /** 회전된 트라이어드의 3D 선분들. 축마다 굵기가 다르다 (스펙 §3-8). */
  function triadPolys(R) {
    const col = (j) => [R[0][j], R[1][j], R[2][j]];
    return [0, 1, 2].map((j) => [[0, 0, 0.05], add([0, 0, 0.05], scale(col(j), AXIS_LEN))]);
  }

  function render() {
    const c = themeColors();
    const ang = angles();
    const R = eulerToR(ang);

    // ---------- 왼쪽: 트라이어드 ----------
    sceneView.resize();
    const ctx = sceneCanvas.getContext('2d');
    const { w, h } = sceneView.size;
    ctx.clearRect(0, 0, w, h);
    drawPolys(ctx, sceneView, OBS, GROUND_LINES, { color: c.grid, width: 1 });
    // 기준 트라이어드 (회전 없음) — 흐리게
    drawPolys(ctx, sceneView, OBS, triadPolys(I3()), { color: c.muted, width: 1.2 });
    // 회전된 트라이어드 — 축별 색
    const axisColors = [c.accent, c.accent3, c.accent2];
    triadPolys(R).forEach((poly, j) => {
      drawPolys(ctx, sceneView, OBS, [poly], { color: axisColors[j], width: 3 - j * 0.4 });
    });
    // 🔑 자유도 상실 시연: yaw 를 +d 한 것과 roll 을 −d 한 것을 점선으로 겹쳐 그린다.
    // pitch=±90° 에 가까우면 둘이 붙어버린다
    const d = 12 / D;
    for (const [alt, dash] of [
      [eulerToR([ang[0] + d, ang[1], ang[2]]), [5, 4]],
      [eulerToR([ang[0], ang[1], ang[2] - d]), [2, 5]],
    ]) {
      ctx.save();
      ctx.setLineDash(dash);
      drawPolys(ctx, sceneView, OBS, [triadPolys(alt)[0]], { color: c.fg, width: 1.4 });
      ctx.restore();
    }

    // ---------- 오른쪽: κ 곡선 ----------
    curveView.resize();
    const cctx = curveCanvas.getContext('2d');
    const cs = curveView.size;
    cctx.clearRect(0, 0, cs.w, cs.h);
    const isEuler = state.chart === 'euler';
    // x = 각(도), y = log10 κ
    curveWorld.xmin = 0;
    curveWorld.xmax = isEuler ? 90 : 180;
    curveWorld.ymin = -0.15;
    curveWorld.ymax = isEuler ? 4.4 : 0.45;

    // 격자와 라벨
    cctx.font = '11px system-ui, sans-serif';
    cctx.strokeStyle = c.grid;
    cctx.lineWidth = 1;
    cctx.fillStyle = c.muted;
    const xt = isEuler ? [0, 30, 60, 89.9] : [0, 60, 120, 180];
    for (const x of xt) {
      const [px] = curveView.toPixel([x, 0]);
      cctx.beginPath(); cctx.moveTo(px, 0); cctx.lineTo(px, cs.h); cctx.stroke();
      cctx.fillText(`${x}°`, px + 3, cs.h - 4);
    }
    const yt = isEuler ? [0, 1, 2, 3, 4] : [0, 0.2, 0.4];
    for (const y of yt) {
      const [, py] = curveView.toPixel([0, y]);
      cctx.beginPath(); cctx.moveTo(0, py); cctx.lineTo(cs.w, py); cctx.stroke();
      cctx.fillText(`κ=${(10 ** y).toFixed(y < 1 ? 2 : 0)}`, 3, py - 3);
    }
    // π/2 수평선 — 회전벡터의 상한
    {
      const [, py] = curveView.toPixel([0, Math.log10(Math.PI / 2)]);
      cctx.save();
      cctx.setLineDash([4, 4]);
      cctx.strokeStyle = c.accent3;
      cctx.beginPath(); cctx.moveTo(0, py); cctx.lineTo(cs.w, py); cctx.stroke();
      cctx.restore();
      cctx.fillStyle = c.accent3;
      cctx.fillText('π/2 = 1.571', 6, py - 4);
    }
    // κ 곡선 — 닫힌형
    const N = 240;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const deg = (i / N) * curveWorld.xmax;
      const k = isEuler ? eulerKappa(deg / D) : expKappa(deg / D);
      if (!Number.isFinite(k)) continue;
      pts.push([deg, Math.log10(k)]);
    }
    drawPath(cctx, curveView, pts, { color: isEuler ? c.accent : c.accent3, width: 2.5 });
    // 현재 위치
    {
      const deg = isEuler ? Math.abs(state.pitch) : angleBetween(R, I3()) * D;
      const k = isEuler ? eulerKappa(deg / D) : expKappa(deg / D);
      if (Number.isFinite(k) && deg <= curveWorld.xmax) {
        const [px, py] = curveView.toPixel([deg, Math.log10(k)]);
        cctx.beginPath(); cctx.arc(px, py, 4.5, 0, Math.PI * 2);
        cctx.fillStyle = c.accent2; cctx.fill();
      }
    }

    renderReadout(ang, R);
  }

  function renderReadout(ang, R) {
    const J = eulerJacobian(ang);
    const S = svd3(J).S;
    const measured = S[0] / S[2];
    const closed = eulerKappa(ang[1]);
    const thetaDeg = angleBetween(R, I3()) * D;
    const collapse = dofCollapse(ang, 12 / D) * D;

    readout.innerHTML = `
      <div><b>오일러 ZYX</b> κ 실측 <b>${fmtK(measured)}</b> · 닫힌형
        √((1+sin p)/(1−sin p)) = <b>${fmtK(closed)}</b>
        <span class="ok">일치</span></div>
      <div>det(J) = ${eulerJacDet(ang[1]).toFixed(5)} (= cos pitch) ·
        점근형 2/cos p = ${fmtK(2 / Math.cos(ang[1]))}</div>
      <div><span class="hi">■</span> 자유도 상실 지표: yaw+12° 와 roll−12° 의 각 차이
        <b>${collapse < 0.05 ? '0.000' : collapse.toFixed(3)}°</b>
        ${collapse < 0.05 ? '<span class="no">— 같은 회전이다</span>' : ''}</div>
      <div><b>회전벡터</b> 이 자세의 θ = ${thetaDeg.toFixed(2)}° ·
        κ = <b>${expKappa(thetaDeg / D).toFixed(4)}</b> ·
        det(J) = ${expJacDet(thetaDeg / D).toFixed(4)}</div>
      <div class="mv-note">회전벡터의 κ 는 θ=180° 에서도 π/2 = 1.5708 을 넘지 않는다 —
        같은 자리에서 오일러는 ${fmtK(eulerKappa((89.99) / D))} 다</div>`;

    hint.innerHTML = `<code>pitch</code> 를 <b>89.9°</b> 로 밀어보세요. 점선 두 개가
      겹칩니다 — <code>yaw</code> 를 늘린 것과 <code>roll</code> 을 줄인 것이 <b>같은
      회전</b>이 되어 자유도 하나를 잃습니다. κ 가 같이 발산합니다.
      <code>좌표계</code> 를 <b>회전벡터</b> 로 바꾸면 곡선이 <b>π/2 에서 멈춥니다</b> —
      짐벌락이 없습니다. 대가는 그 좌표계의 <code>log</code> 가 180° 에서 무너지는 것으로
      옮겨갑니다.`;
  }

  const fmtK = (k) => (!Number.isFinite(k) ? '∞'
    : k >= 1000 ? k.toExponential(2) : k.toFixed(k < 10 ? 3 : 1));

  onThemeChange(render);
  window.addEventListener('resize', render);
  render();
}
