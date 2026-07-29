import {
  rigid, similarity, affine, homographyFromQuads,
  applyAll, preservation, decomposeAffine, UNIT_SQUARE,
} from './transform.js';
import {
  themeColors, onThemeChange, createView, drawGrid, drawPolygon,
  drawHandles, makeSliders, attachDrag, renderMatrix,
} from './core.js';

const WORLD = { xmin: -2, xmax: 2, ymin: -2, ymax: 2 };
const DEG = 180 / Math.PI;
const degFmt = (v) => `${v.toFixed(0)}°`;

const CLASSES = {
  rigid: {
    label: 'Rigid (3)',
    defs: [
      { key: 'theta', label: 'θ', min: -180, max: 180, step: 1, value: 30, fmt: degFmt },
      { key: 'tx', label: 'tx', min: -2, max: 2, step: 0.01, value: 0 },
      { key: 'ty', label: 'ty', min: -2, max: 2, step: 0.01, value: 0 },
    ],
    handles: 2,
    hint: '길이와 각도가 모두 남습니다. 모양은 절대 바뀌지 않습니다. '
        + '왼쪽 아래 점은 평행이동, 오른쪽 아래 점은 회전입니다.',
    matrix: (s) => rigid({ theta: s.theta / DEG, tx: s.tx, ty: s.ty }),
  },
  similarity: {
    label: 'Similarity (4)',
    defs: [
      { key: 'theta', label: 'θ', min: -180, max: 180, step: 1, value: 30, fmt: degFmt },
      { key: 's', label: 's', min: 0.2, max: 2, step: 0.01, value: 1 },
      { key: 'tx', label: 'tx', min: -2, max: 2, step: 0.01, value: 0 },
      { key: 'ty', label: 'ty', min: -2, max: 2, step: 0.01, value: 0 },
    ],
    handles: 2,
    hint: '크기는 바뀌지만 각도는 그대로입니다 — 정사각형이 계속 정사각형입니다. '
        + '오른쪽 아래 점을 끌면 회전과 크기가 함께 바뀝니다.',
    matrix: (s) => similarity({ theta: s.theta / DEG, s: s.s, tx: s.tx, ty: s.ty }),
  },
  affine: {
    label: 'Affine (6)',
    defs: [
      { key: 'theta', label: 'θ', min: -180, max: 180, step: 1, value: 20, fmt: degFmt },
      { key: 'sx', label: 'sx', min: 0.2, max: 2, step: 0.01, value: 1.2 },
      { key: 'sy', label: 'sy', min: 0.2, max: 2, step: 0.01, value: 0.8 },
      { key: 'shear', label: 'sh', min: -1.5, max: 1.5, step: 0.01, value: 0.4 },
      { key: 'tx', label: 'tx', min: -2, max: 2, step: 0.01, value: 0 },
      { key: 'ty', label: 'ty', min: -2, max: 2, step: 0.01, value: 0 },
    ],
    handles: 3,
    hint: '각도는 깨지지만 마주보는 변은 여전히 평행합니다. 점이 세 개뿐인 이유는 '
        + '네 번째 점이 평행사변형 제약으로 따라오기 때문입니다 — 그게 자유도 6 입니다.',
    matrix: (s) => affine({
      theta: s.theta / DEG, sx: s.sx, sy: s.sy, shear: s.shear, tx: s.tx, ty: s.ty,
    }),
  },
  homography: {
    label: 'Homography (8)',
    defs: [],
    handles: 4,
    hint: '슬라이더가 없습니다 — 자유도 8 은 네 점의 (x, y) 여덟 개 숫자와 같기 때문입니다. '
        + '네 꼭짓점을 자유롭게 끌어보세요. 평행마저 깨집니다.',
    matrix: null,   // quad 에서 직접 계산
  },
};

export function init(root) {
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = createView(canvas, WORLD);

  let kind = 'rigid';
  let params = {};
  let quad = UNIT_SQUARE.map((p) => [...p]);   // homography 전용 상태
  let sliders = null;
  let lastGood = null;                          // 퇴화 사각형 대비

  /** 현재 상태의 행렬. 퇴화로 계산이 실패하면 직전 행렬을 쓴다. */
  function matrix() {
    try {
      const M = kind === 'homography'
        ? homographyFromQuads(UNIT_SQUARE, quad)
        : CLASSES[kind].matrix(params);
      lastGood = M;
      return M;
    } catch {
      return lastGood || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    }
  }

  const currentQuad = () => applyAll(matrix(), UNIT_SQUARE);
  const handles = () => currentQuad().slice(0, CLASSES[kind].handles);

  function onDrag(i, p) {
    if (kind === 'homography') {
      quad[i] = p;
      draw();
      return;
    }

    if (kind === 'affine') {
      // 끌린 세 점에서 affine 을 역산한다.
      // 원본 (0,0) (1,0) (1,1) 의 상이 q0 q1 q2 이고
      // A·e1 = q1 - q0,  A·e2 = q2 - q1 이다.
      const q = currentQuad();
      q[i] = p;
      const [q0, q1, q2] = q;
      const M = [
        [q1[0] - q0[0], q2[0] - q1[0], q0[0]],
        [q1[1] - q0[1], q2[1] - q1[1], q0[1]],
        [0, 0, 1],
      ];
      const d = decomposeAffine(M);
      Object.assign(params, {
        theta: d.theta * DEG, sx: d.sx, sy: d.sy, shear: d.shear, tx: d.tx, ty: d.ty,
      });
    } else if (i === 0) {
      params.tx = p[0];
      params.ty = p[1];
    } else {
      const dx = p[0] - params.tx, dy = p[1] - params.ty;
      params.theta = Math.atan2(dy, dx) * DEG;
      if (kind === 'similarity') params.s = Math.hypot(dx, dy);
    }

    // 슬라이더 범위를 넘는 값을 그대로 두면 표시와 실제가 어긋난다.
    Object.assign(params, sliders.clamp(params));
    sliders.setValues(params);
    draw();
  }

  /**
   * carry = false 는 최초 초기화용이다. 이때 params 가 비어 있어서
   * matrix() 가 NaN 을 만들고 그걸 분해하면 전체가 NaN 이 된다.
   */
  function selectClass(next, carry = true) {
    const prevQuad = carry ? currentQuad() : null;
    const d = carry ? decomposeAffine(matrix()) : null;

    kind = next;
    const spec = CLASSES[kind];
    params = {};
    spec.defs.forEach((def) => { params[def.key] = def.value; });

    if (!carry) {
      // 기본값 그대로 쓴다.
    } else if (kind === 'homography') {
      quad = prevQuad.map((p) => [...p]);
    } else {
      // 낮은 클래스로 갈 때는 표현할 수 없는 성분이 버려진다 — 그게 자유도의 의미다.
      params.theta = d.theta * DEG;
      params.tx = d.tx;
      params.ty = d.ty;
      if (kind === 'similarity') params.s = d.sx;
      if (kind === 'affine') { params.sx = d.sx; params.sy = d.sy; params.shear = d.shear; }
    }

    sliders = makeSliders(root.querySelector('.mv-sliders'), spec.defs, (v) => {
      Object.assign(params, v);
      draw();
    });
    Object.assign(params, sliders.clamp(params));
    sliders.setValues(params);

    root.querySelectorAll('.mv-tabs button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.kind === kind));
    });
    draw();
  }

  const tabs = root.querySelector('.mv-tabs');
  tabs.innerHTML = '';
  Object.entries(CLASSES).forEach(([key, spec]) => {
    const b = document.createElement('button');
    b.textContent = spec.label;
    b.dataset.kind = key;
    b.setAttribute('aria-pressed', String(key === kind));
    b.addEventListener('click', () => selectClass(key));
    tabs.appendChild(b);
  });

  attachDrag(canvas, view, handles, onDrag);

  function draw() {
    const colors = themeColors();
    const M = matrix();
    drawGrid(ctx, view, colors);
    drawPolygon(ctx, view, UNIT_SQUARE, { stroke: colors.muted, width: 1.5 });
    drawPolygon(ctx, view, applyAll(M, UNIT_SQUARE),
      { stroke: colors.accent, fill: `${colors.accent}22`, firstEdge: colors.accent2 });
    drawHandles(ctx, view, handles(), colors);
    renderMatrix(root.querySelector('.mv-matrix-host'), M);

    const p = preservation(M);
    const mark = (ok) => (ok ? '<span class="ok">보존</span>' : '<span class="no">깨짐</span>');
    root.querySelector('.mv-readout').innerHTML = `
      길이 ${mark(p.keepsLength)} &nbsp; 각도 ${mark(p.keepsAngle)} &nbsp;
      평행 ${mark(p.keepsParallel)}<br>
      변 길이비 ${p.lengthRatio.toFixed(3)} · 사잇각 ${p.angleDeg.toFixed(1)}°
      · 원근항 ${p.perspective.toFixed(3)}`;
    root.querySelector('.mv-hint').textContent = CLASSES[kind].hint;
  }

  const redraw = () => { view.resize(); draw(); };
  selectClass('rigid', false);
  redraw();
  window.addEventListener('resize', redraw);
  onThemeChange(draw);
}
