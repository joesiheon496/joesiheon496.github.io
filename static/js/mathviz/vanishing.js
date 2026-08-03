// static/js/mathviz/vanishing.js
// 데모 2 — 소실점.
//
// 존재 이유는 `선 위치 흔들기` 다. offset 을 재배치해도 소실점 마커가 꿈쩍 안 하는
// 것이 v ~ KRd 에 X0 가 없다는 것의 분리 관측이다.

import {
  lookAt, intrinsics, projectPoint, vanishingPoint, horizon, planeHomography,
  groundFromImage, normalize, add, scale,
} from './camera.js';
import { apply as applyH } from './transform.js';
import {
  OBS, SCENE_HOME, IMAGE_WORLD, IMAGE_SIZE, IMAGE_CX, IMAGE_CY, F_DEFAULT,
  CAM_HEIGHT, PITCH0,
  GROUND_LINES, drawPolys,
} from './scene.js';
import {
  themeColors, onThemeChange, createView, drawPath, drawPolygon,
  makeSliders, makeToggles, attachDrag, drawHandles,
} from './core.js';

const DIST = 6;                                     // 고정 — 이 데모의 주제는 방향이다
const LINE_EXTENT = 60;                             // 직선을 s ∈ [-60, 60] 까지 그린다
const N_LINES = 5;

/** 스펙 §2-4 의 그 다섯 offset. 흔들기 전 기본값이다. */
const OFFSETS0 = [[0, 0, 0], [-3, 0, 0], [2, 1, 0], [5, -2, 0], [-8, 4, 0]];

/** 시드 난수. Math.random 을 쓰지 않는다 (5편 3-1 규약). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function offsetsFor(shakeCount) {
  if (shakeCount === 0) return OFFSETS0;
  const rnd = mulberry32(1000 + shakeCount);
  return Array.from({ length: N_LINES }, () => [
    (rnd() * 2 - 1) * 7, (rnd() * 2 - 1) * 7, 0,
  ]);
}

/** 방향 d 의 직선을 3D 폴리라인으로. */
const linePoly = (X0, d) => [add(X0, scale(d, -LINE_EXTENT)), add(X0, scale(d, LINE_EXTENT))];

/** offset 다발의 s=LINE_EXTENT 먼 끝점들. readout 의 산포·흔들기 전후 비교가 같이 쓴다. */
const farEndpoints = (cam, offsets, d) => offsets.map((X0) => projectPoint(cam, add(X0, scale(d, LINE_EXTENT))));

export function init(root) {
  const canvases = root.querySelectorAll('canvas');
  if (canvases.length < 2) throw new Error('vanishing 은 panes="2" 가 필요하다');
  const [sceneCanvas, imageCanvas] = canvases;

  const sceneView = createView(sceneCanvas, { ...SCENE_HOME });
  const imageView = createView(imageCanvas, IMAGE_WORLD);
  const sliderHost = root.querySelector('.mv-sliders');
  const readout = root.querySelector('.mv-readout');
  const hint = root.querySelector('.mv-hint');

  const state = { theta: 0.4, pitch: PITCH0, logF: Math.log10(F_DEFAULT) };
  let shakeCount = 0;
  let toggles;
  // 흔들기 직전의 마커·직선 끝점 — "마커 이동" readout 이 진짜 전후 비교가 되려면
  // 필요하다. vanishingPoint(cam,d) 를 그 자리에서 두 번 부르면 offset 을 안 받는
  // 함수라 자명하게 0 이 나오는 헛검증이 된다 (tests/mathviz/camera.test.js 가
  // 금지하는 패턴). 흔들기 버튼만 채운다 — 슬라이더가 덮어쓰면 "흔들기 전후" 의
  // 의미가 사라진다.
  let preShake = null;

  const sliders = makeSliders(sliderHost, [
    { key: 'theta', label: '방향 θ', min: 0, max: Math.PI, step: 0.004, value: state.theta,
      fmt: (v) => `${(v * 180 / Math.PI).toFixed(0)}°` },
    { key: 'pitch', label: 'pitch', min: -Math.PI / 6, max: Math.PI / 9, step: 0.002,
      value: state.pitch, fmt: (v) => `${(v * 180 / Math.PI).toFixed(1)}°` },
    { key: 'logF', label: 'f', min: Math.log10(200), max: Math.log10(2000), step: 0.005,
      value: state.logF, fmt: (v) => `${Math.round(10 ** v)} px` },
  ], (v) => { Object.assign(state, v); render(); });

  toggles = makeToggles(sliderHost, [
    { key: 'ortho', label: '직교 다발 추가', value: false },
    { key: 'showHorizon', label: '지평선 보기', value: true },
    { key: 'unwarp', label: '평면 = Homography', value: false },
  ], render);

  // '흔들기' 는 값이 아니라 사건이라 버튼이다.
  const shakeRow = document.createElement('div');
  shakeRow.className = 'mv-slider';
  const shakeBtn = document.createElement('button');
  shakeBtn.textContent = '선 위치 흔들기';
  shakeBtn.style.gridColumn = 'span 2';
  shakeBtn.addEventListener('click', () => {
    // 증가 전에 현재(흔들기 전) 상태를 찍어둔다 — 마커는 동차 안전값으로,
    // atInfinity 면 그 사실만 남기고 NaN 을 남기지 않는다.
    const { cam } = build();
    const d = normalize([Math.cos(state.theta), Math.sin(state.theta), 0]);
    const vp = vanishingPoint(cam, d);
    preShake = {
      vp: vp.atInfinity ? { atInfinity: true } : { atInfinity: false, u: vp.u, v: vp.v },
      ends: farEndpoints(cam, offsetsFor(shakeCount), d),
    };
    shakeCount += 1;
    render();
  });
  shakeRow.append(document.createElement('label'), shakeBtn);
  sliderHost.appendChild(shakeRow);

  function build() {
    const f = 10 ** state.logF;
    const eye = [0, -DIST, CAM_HEIGHT];
    const target = [0, 0, CAM_HEIGHT + DIST * Math.tan(state.pitch)];
    const K = intrinsics({ f, cx: IMAGE_CX, cy: IMAGE_CY });
    return { f, cam: { K, ...lookAt({ eye, target, up: [0, 0, 1] }) } };
  }

  /** 이미지 world 사각형을 지나는 직선 l 을 선분으로 자른다. l·(u,v,1)=0 */
  function lineInWorld(l) {
    const { xmin, xmax, ymax, ymin } = IMAGE_WORLD;
    const pts = [];
    const [a, b, c] = l;
    if (Math.abs(b) > 1e-12) {
      for (const u of [xmin, xmax]) pts.push([u, -(a * u + c) / b]);
    }
    if (Math.abs(a) > 1e-12) {
      for (const v of [ymax, ymin]) pts.push([-(b * v + c) / a, v]);
    }
    const lo = Math.min(ymax, ymin), hi = Math.max(ymax, ymin);
    const inside = pts.filter(([u, v]) => u >= xmin - 1 && u <= xmax + 1 && v >= lo - 1 && v <= hi + 1);
    return inside.length >= 2 ? [inside[0], inside[1]] : null;
  }

  function render() {
    const c = themeColors();
    const { f, cam } = build();
    const { ortho, showHorizon, unwarp } = toggles.getValues();
    const offsets = offsetsFor(shakeCount);
    const dirs = [normalize([Math.cos(state.theta), Math.sin(state.theta), 0])];
    if (ortho) dirs.push(normalize([-Math.sin(state.theta), Math.cos(state.theta), 0]));
    const colors = [c.accent, c.accent2];

    for (const [canvas, view, viewCam, isScene] of [
      [sceneCanvas, sceneView, OBS, true],
      [imageCanvas, imageView, cam, false],
    ]) {
      view.resize();
      const ctx = canvas.getContext('2d');
      const { w, h } = view.size;
      ctx.clearRect(0, 0, w, h);
      drawPolys(ctx, view, viewCam, GROUND_LINES, { color: c.grid, width: 1 });
      dirs.forEach((d, k) => {
        drawPolys(ctx, view, viewCam, offsets.map((X0) => linePoly(X0, d)),
          { color: colors[k], width: 2 });
      });
      if (isScene) {
        // 방향 손잡이 — 원점에서 d 방향 3 m
        const p = projectPoint(OBS, scale(dirs[0], 3));
        if (p.z > 0) drawHandles(ctx, view, [[p.u, p.v]], c);
      }
    }

    // --- 이미지 뷰 전용 ---
    const ctx = imageCanvas.getContext('2d');
    const S = IMAGE_SIZE;
    drawPolygon(ctx, imageView, [[0, 0], [S, 0], [S, S], [0, S]], { stroke: c.fg, width: 1.5 });

    const vps = dirs.map((d) => vanishingPoint(cam, d));
    if (showHorizon) {
      const seg = lineInWorld(horizon(cam, [0, 0, 1]));
      if (seg) drawPath(ctx, imageView, seg, { color: c.accent3, width: 1.5 });
    }
    vps.forEach((vp, k) => {
      if (vp.atInfinity) return;
      const inView = vp.u >= IMAGE_WORLD.xmin && vp.u <= IMAGE_WORLD.xmax
        && vp.v <= IMAGE_WORLD.ymin && vp.v >= IMAGE_WORLD.ymax;
      if (inView) {
        const [x, y] = imageView.toPixel([vp.u, vp.v]);
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = colors[k]; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = colors[k]; ctx.fill();
      } else {
        // 밖이면 경계에 화살표 — 시야를 소실점에 맞추면 이미지가 너무 작아진다
        drawEdgeArrow(ctx, vp, colors[k]);
      }
    });

    if (unwarp) {
      // 이미지를 지면으로 되펴서 장면 뷰의 실제 격자에 겹친다. 정확히 겹치면 1편 매듭.
      //
      // ⚠️ groundFromImage 가 null 을 주면(지평선 위나 카메라 뒤로 매핑된 점) 참값
      // [X,Y,0] 을 대신 넣지 않는다 — 그러면 되펴기가 실패해도 실제 격자와 겹쳐
      // 보여서 "정확히 겹친다" 검증이 무의미해진다. 대신 성공한 점들의 연속 구간만
      // 잇고 null 에서 폴리라인을 끊는다 — 실패가 빈틈으로 드러나야 한다.
      const H = planeHomography(cam);
      const sctx = sceneCanvas.getContext('2d');
      // 3D 선은 반드시 drawPolys(→ projectPolyline) 를 지난다 — raw projectPoint 로
      // 직접 그리면 근평면 클리핑을 건너뛰어 z<=0 에서 뒤집힌 좌표가 나올 수 있다.
      const runs = [];
      let run = [];
      const flush = () => { if (run.length >= 2) runs.push(run); run = []; };
      for (const poly of GROUND_LINES) {
        for (const [X, Y] of poly) {
          const img = applyH(H, [X, Y]);          // 지면 → 이미지
          const g = groundFromImage(cam, img);    // 이미지 → 지면 (되펴기), 실패하면 null
          if (g) run.push(g); else flush();
        }
        flush();                                  // 폴리라인 경계에서도 끊는다
      }
      drawPolys(sctx, sceneView, OBS, runs, { color: c.accent3, width: 3 });
    }

    renderReadout(cam, vps, offsets, dirs);
  }

  function drawEdgeArrow(ctx, vp, color) {
    const { xmin, xmax, ymin, ymax } = IMAGE_WORLD;
    const cxw = (xmin + xmax) / 2, cyw = (ymin + ymax) / 2;
    const u = Math.min(xmax - 8, Math.max(xmin + 8, vp.u));
    const v = Math.min(Math.max(ymax, ymin) - 8, Math.max(Math.min(ymax, ymin) + 8, vp.v));
    const [x, y] = imageView.toPixel([u, v]);
    const [cx0, cy0] = imageView.toPixel([cxw, cyw]);
    const ang = Math.atan2(y - cy0, x - cx0);
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-12, -6); ctx.lineTo(-12, 6); ctx.closePath();
    ctx.fillStyle = color; ctx.fill(); ctx.restore();
  }

  function renderReadout(cam, vps, offsets, dirs) {
    const l = horizon(cam, [0, 0, 1]);
    const vp = vps[0];
    // 직선 끝점들이 s=60 에서 얼마나 모였나 — 유한 길이라 0 이 아니다 (흔들기와 무관)
    const ends = farEndpoints(cam, offsets, dirs[0]);
    const us = ends.map((p) => p.u), vsv = ends.map((p) => p.v);
    const spread = Math.hypot(Math.max(...us) - Math.min(...us),
                              Math.max(...vsv) - Math.min(...vsv));

    // 마커 이동 — 흔들기 전(preShake)과 지금을 실제로 비교한다. vanishingPoint 를
    // 같은 자리에서 두 번 부르면(예전 코드) offset 을 안 받는 함수라 자명하게
    // 0 이 나오는 헛검증이다. 대신 흔들기 버튼이 찍어둔 진짜 이전 상태와 비교하고,
    // 직선 끝점도 같이 얼마나 움직였는지를 나란히 보여준다 — 마커는 0, 직선은
    // 많이 움직였다는 대비가 이 데모의 요점이다.
    let shakeInfo;
    if (!preShake) {
      shakeInfo = '마커 이동 — <b>선 위치 흔들기</b> 를 눌러 확인';
    } else {
      let markerDelta;
      if (preShake.vp.atInfinity !== vp.atInfinity) {
        markerDelta = '비교 불가 (θ/pitch 변경으로 무한 여부가 바뀌었다)';
      } else if (vp.atInfinity) {
        markerDelta = '0.000000 px (무한 유지)';
      } else {
        markerDelta = `${Math.hypot(vp.u - preShake.vp.u, vp.v - preShake.vp.v).toFixed(6)} px`;
      }
      const lineDelta = Math.max(...ends.map((p, i) =>
        Math.hypot(p.u - preShake.ends[i].u, p.v - preShake.ends[i].v)));
      shakeInfo = `마커 이동 <b class="ok">${markerDelta}</b> (흔들기 전후) · `
        + `직선 끝점 이동(최대) <b>${lineDelta.toFixed(2)} px</b>`;
    }

    readout.innerHTML = `
      <div>소실점 ${vp.atInfinity
        ? '<b class="no">무한</b> (방향이 상면에 평행 — 이미지에서도 평행선이 평행하다)'
        : `<b>(${vp.u.toFixed(2)}, ${vp.v.toFixed(2)})</b>`}</div>
      <div>지평선 l = (${l.map((x) => x.toExponential(3)).join(', ')})</div>
      <div>흔들기 ${shakeCount} 회 · ${shakeInfo}</div>
      <div>직선 끝점 산포 (s=${LINE_EXTENT}) ${spread.toFixed(2)} px</div>
      ${vps.length > 1 && !vps[0].atInfinity && !vps[1].atInfinity
        ? `<div>두 소실점의 v: ${vps.map((p) => p.v.toFixed(4)).join(' / ')} — 같으면 지평선 위다</div>`
        : ''}`;

    hint.innerHTML = '<b>선 위치 흔들기</b>를 눌러보세요. 직선들이 전부 옮겨가는데 소실점 마커는 꿈쩍도 안 합니다 — 소실점은 방향만의 함수입니다. <code>직교 다발</code>과 <code>지평선</code>을 같이 켜면 두 소실점이 같은 높이에 놓입니다.';
  }

  // 장면 뷰 드래그: 관찰자 이미지 점 → 지면 좌표 → 방향 θ
  //
  // ⚠️ θ 의 역산은 `atan2(g[1], g[0])` 이다 — d = (cos θ, sin θ, 0) 이므로 평범한
  // atan2 다. 데모 1 의 yaw 역산 `atan2(g[0], -g[1])` 과 다르다 (그쪽은
  // eye = (d sin φ, -d cos φ, h) 를 되돌리는 것이라 축이 다르다). 섞지 말 것.
  //
  // ⚠️ 직선의 방향은 부호를 뒤집어도 같은 직선이라 슬라이더 범위가 [0, π] 다.
  // atan2 는 (-π, π] 를 주므로 음수면 π 를 더해 [0, π) 로 접는다.
  attachDrag(sceneCanvas, sceneView, () => {
    const d = normalize([Math.cos(state.theta), Math.sin(state.theta), 0]);
    const p = projectPoint(OBS, scale(d, 3));
    return p.z > 0 ? [[p.u, p.v]] : [];
  }, (_i, worldPt) => {
    const g = groundFromImage(OBS, worldPt);
    if (!g) return;
    if (Math.hypot(g[0], g[1]) < 1e-6) return;
    let theta = Math.atan2(g[1], g[0]);
    if (theta < 0) theta += Math.PI;
    const next = sliders.clamp({ theta });
    Object.assign(state, next);
    sliders.setValues(next);
    render();
  });

  onThemeChange(render);
  window.addEventListener('resize', render);
  render();
}
