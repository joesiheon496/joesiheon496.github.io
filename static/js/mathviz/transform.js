// 2D 동차좌표 변환. DOM 접근 없음 — 브라우저와 Node 양쪽에서 돈다.

export const UNIT_SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1]];

export function identity() {
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
}

/** 회전 후 평행이동. 자유도 3. 길이·각도 보존. */
export function rigid({ theta, tx, ty }) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [[c, -s, tx], [s, c, ty], [0, 0, 1]];
}

/** rigid + 등방 스케일. 자유도 4. 각도 보존, 길이는 s 배. */
export function similarity({ theta, s, tx, ty }) {
  const c = Math.cos(theta), sn = Math.sin(theta);
  return [[s * c, -s * sn, tx], [s * sn, s * c, ty], [0, 0, 1]];
}

/**
 * 자유도 6. 선형부를 회전 × 상삼각으로 둔다 (QR 분해 형태).
 *   A = R(theta) · [[sx, shear], [0, sy]]
 * 이 매개화는 모든 가역 2x2 를 덮으면서 슬라이더마다 의미를 준다.
 */
export function affine({ theta, sx, sy, shear, tx, ty }) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const a = c * sx, b = c * shear - s * sy;
  const d = s * sx, e = s * shear + c * sy;
  return [[a, b, tx], [d, e, ty], [0, 0, 1]];
}

/**
 * affine() 의 역. 선형부를 회전 × 상삼각으로 되돌린다 (QR).
 * 원근항(3행)은 무시하므로 homography 를 넣어도 선형부만 돌려준다 —
 * 클래스를 낮출 때 도형을 이어받는 데 쓴다.
 * theta 는 라디안.
 */
export function decomposeAffine(M) {
  const [a, b] = [M[0][0], M[0][1]];
  const [d, e] = [M[1][0], M[1][1]];
  const theta = Math.atan2(d, a);
  const c = Math.cos(theta), s = Math.sin(theta);
  return {
    theta,
    sx: c * a + s * d,
    shear: c * b + s * e,
    sy: -s * b + c * e,
    tx: M[0][2],
    ty: M[1][2],
  };
}

/** 부분 피벗 가우스 소거. A 는 n×n, b 는 길이 n. A·x = b 의 x 반환. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-14) throw new Error('특이 행렬 — 네 점이 퇴화했다');
    [M[col], M[piv]] = [M[piv], M[col]];
    const p = M[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / p;
      if (f === 0) continue;
      for (let c2 = col; c2 <= n; c2++) M[r][c2] -= f * M[col][c2];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

/**
 * 네 대응점에서 homography. 자유도 8 (h22 = 1 로 고정).
 * 각 대응 (x,y)->(u,v) 가 두 식을 준다:
 *   h00 x + h01 y + h02 - h20 x u - h21 y u = u
 *   h10 x + h11 y + h12 - h20 x v - h21 y v = v
 */
export function homographyFromQuads(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  const h = solve(A, b);
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

/** 동차좌표로 올려 곱하고 w 로 나눈다. */
export function apply(M, [x, y]) {
  const w = M[2][0] * x + M[2][1] * y + M[2][2];
  return [
    (M[0][0] * x + M[0][1] * y + M[0][2]) / w,
    (M[1][0] * x + M[1][1] * y + M[1][2]) / w,
  ];
}

export function applyAll(M, pts) {
  return pts.map((p) => apply(M, p));
}

/**
 * 무엇이 보존되는가.
 * 기저벡터 e1, e2 의 상(image)으로 판정한다 — 특잇값보다 직관적이고 표시하기 쉽다.
 *  lengthRatio : |A e1| / |A e2|  (1 이면 등방)
 *  angleDeg    : A e1 과 A e2 사이 각 (90 이면 각도 보존)
 *  perspective : |h20| + |h21|    (0 이면 affine = 평행 보존)
 */
export function preservation(M) {
  const e1 = [M[0][0], M[1][0]];
  const e2 = [M[0][1], M[1][1]];
  const n1 = Math.hypot(e1[0], e1[1]);
  const n2 = Math.hypot(e2[0], e2[1]);
  const dot = e1[0] * e2[0] + e1[1] * e2[1];
  const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot / (n1 * n2)))) * 180 / Math.PI;
  const perspective = Math.abs(M[2][0]) + Math.abs(M[2][1]);

  const EPS = 1e-9;
  const keepsAngle = Math.abs(angleDeg - 90) < 1e-7 && Math.abs(n1 - n2) < EPS;
  return {
    lengthRatio: n1 / n2,
    angleDeg,
    perspective,
    keepsLength: keepsAngle && Math.abs(n1 - 1) < EPS,
    keepsAngle,
    keepsParallel: perspective < EPS,
  };
}
