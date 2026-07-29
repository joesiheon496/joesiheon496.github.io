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

/** 3×3 동차행렬에서 선형부(왼쪽 위 2×2)만 떼낸다. */
export function linear2x2(M) {
  return [[M[0][0], M[0][1]], [M[1][0], M[1][1]]];
}

/**
 * 2×2 SVD. A = U diag(s1, s2) Vᵀ, s1 >= s2 >= 0.
 *
 * 흔히 쓰이는 E/F/G/H + 두 각 닫힌 형식은 쓰지 않는다. 특이값은 맞지만
 * 각도 규약을 잘못 조합하기 쉽고, 그러면 재구성이 조용히 깨진다.
 * 대신 AᵀA 의 고윳값 분해로 V 와 σ 를 얻고 u_i = A v_i / σ_i 로 U 를 만든다.
 * 퇴화(σ2 = 0, A = 0)를 명시적으로 다룰 수 있다는 것도 이 경로의 장점이다.
 *
 * A 는 2×2 (`[[a,b],[c,d]]`). 3×3 동차행렬은 linear2x2 를 먼저 통과시킨다.
 */
export function svd2x2(A) {
  const [[a, b], [c, d]] = A;

  // B = AᵀA (대칭 준양정)
  const p = a * a + c * c;
  const q = a * b + c * d;
  const r = b * b + d * d;

  const disc = Math.sqrt(Math.max(0, (p - r) * (p - r) + 4 * q * q));
  const l1 = (p + r + disc) / 2;
  const l2 = Math.max(0, (p + r - disc) / 2);
  const s1 = Math.sqrt(Math.max(0, l1));
  const s2 = Math.sqrt(l2);

  // l1 에 대응하는 고유벡터. q ≈ 0 이면 B 가 이미 대각이므로 큰 쪽 축을 고른다.
  let v1;
  if (Math.abs(q) > 1e-14) v1 = [q, l1 - p];
  else v1 = p >= r ? [1, 0] : [0, 1];
  const n1 = Math.hypot(v1[0], v1[1]) || 1;
  v1 = [v1[0] / n1, v1[1] / n1];
  const v2 = [-v1[1], v1[0]];               // 직교 보완 — 이 구성 때문에 V 는 항상 회전이다

  const Av = (v) => [a * v[0] + b * v[1], c * v[0] + d * v[1]];
  const EPS = 1e-12;

  let u1;
  if (s1 > EPS) {
    const w = Av(v1);
    u1 = [w[0] / s1, w[1] / s1];
  } else {
    u1 = [1, 0];                            // A = 0
  }

  let u2;
  if (s2 > EPS) {
    const w = Av(v2);
    u2 = [w[0] / s2, w[1] / s2];
  } else {
    u2 = [-u1[1], u1[0]];                   // 퇴화: 직교 보완으로 채운다
  }

  return { s1, s2, v1, v2, u1, u2 };
}

/**
 * 단계 애니메이션용 형태. U 와 V 를 **모두 회전**으로 만든다.
 *
 * V 는 svd2x2 의 구성상 항상 회전이지만 U 는 det(A) < 0 이면 반사가 된다.
 * 그러면 회전만으로는 A 에 도달할 수 없다. u2 를 뒤집고 σ2 에 부호를 주면
 * 둘 다 회전이 되고 재구성은 그대로 정확하다.
 *
 * 데모에서 음수 σ2 는 "도형이 선분을 지나 뒤집힌다" 로 보인다 — 그게 반사다.
 */
export function svdRotationForm(A) {
  const { s1, s2, v1, u1, u2 } = svd2x2(A);
  const detU = u1[0] * u2[1] - u1[1] * u2[0];
  const flip = detU < 0;
  // u2 를 뒤집은 벡터는 따로 만들지 않는다 — 회전행렬의 두 번째 열은 첫 번째 열로
  // 정해지므로 thetaU 하나로 U 가 완전히 결정되고, flip 여부는 s2signed 의 부호에 담긴다.
  return {
    s1,
    s2signed: flip ? -s2 : s2,
    thetaU: Math.atan2(u1[1], u1[0]),
    thetaV: Math.atan2(v1[1], v1[0]),
  };
}

/**
 * 의사역행렬 A⁺ = V Σ⁺ Uᵀ. σ_i <= tol 인 성분은 0 으로 버린다.
 * 가역 행렬에서는 역행렬과 같고, 특이 행렬에서도 유한한 값을 준다.
 */
export function pseudoInverse2x2(A, tol = 1e-12) {
  const { s1, s2, v1, v2, u1, u2 } = svd2x2(A);
  const i1 = s1 > tol ? 1 / s1 : 0;
  const i2 = s2 > tol ? 1 / s2 : 0;
  // A⁺ = i1 (v1 u1ᵀ) + i2 (v2 u2ᵀ)
  return [
    [i1 * v1[0] * u1[0] + i2 * v2[0] * u2[0], i1 * v1[0] * u1[1] + i2 * v2[0] * u2[1]],
    [i1 * v1[1] * u1[0] + i2 * v2[1] * u2[0], i1 * v1[1] * u1[1] + i2 * v2[1] * u2[1]],
  ];
}
