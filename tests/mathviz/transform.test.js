import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  identity, rigid, similarity, affine, homographyFromQuads,
  apply, applyAll, preservation, UNIT_SQUARE,
} from '../../static/js/mathviz/transform.js';

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b} (eps ${eps})`);
const nearPt = (p, q, eps = 1e-9) => { near(p[0], q[0], eps); near(p[1], q[1], eps); };

test('identity 는 점을 그대로 둔다', () => {
  nearPt(apply(identity(), [3, -7]), [3, -7]);
});

test('rigid: 90도 회전은 (1,0) 을 (0,1) 로 보낸다', () => {
  const M = rigid({ theta: Math.PI / 2, tx: 0, ty: 0 });
  nearPt(apply(M, [1, 0]), [0, 1], 1e-12);
});

test('rigid: 평행이동이 더해진다', () => {
  const M = rigid({ theta: 0, tx: 2, ty: -3 });
  nearPt(apply(M, [1, 1]), [3, -2]);
});

test('rigid 는 길이와 각도를 보존한다', () => {
  const p = preservation(rigid({ theta: 0.7, tx: 5, ty: 1 }));
  assert.ok(p.keepsLength);
  assert.ok(p.keepsAngle);
  assert.ok(p.keepsParallel);
});

test('similarity 는 각도는 보존하고 길이는 s 배로 바꾼다', () => {
  const p = preservation(similarity({ theta: 0.3, s: 2, tx: 0, ty: 0 }));
  assert.ok(!p.keepsLength);
  assert.ok(p.keepsAngle);
  near(p.angleDeg, 90, 1e-9);
  near(p.lengthRatio, 1, 1e-9);   // sx/sy 비율은 1 (등방)
});

test('전단이 든 affine 은 각도를 깨지만 평행은 보존한다', () => {
  const p = preservation(affine({ theta: 0, sx: 1, sy: 1, shear: 0.8, tx: 0, ty: 0 }));
  assert.ok(!p.keepsAngle);
  assert.ok(p.keepsParallel);
  assert.ok(Math.abs(p.angleDeg - 90) > 1);
});

test('affine 은 평행사변형을 만든다 — 마주보는 변이 평행', () => {
  const M = affine({ theta: 0.4, sx: 1.3, sy: 0.7, shear: 0.5, tx: 1, ty: 2 });
  const [a, b, c, d] = applyAll(M, UNIT_SQUARE);
  const ab = [b[0] - a[0], b[1] - a[1]];
  const dc = [c[0] - d[0], c[1] - d[1]];
  near(ab[0] * dc[1] - ab[1] * dc[0], 0, 1e-9);   // 외적 0 = 평행
});

test('homographyFromQuads 는 네 대응점을 정확히 보낸다', () => {
  const dst = [[0.2, 0.1], [1.4, -0.2], [1.1, 1.3], [-0.3, 0.9]];
  const H = homographyFromQuads(UNIT_SQUARE, dst);
  applyAll(H, UNIT_SQUARE).forEach((p, i) => nearPt(p, dst[i], 1e-9));
});

test('같은 사각형끼리의 homography 는 항등이다', () => {
  const H = homographyFromQuads(UNIT_SQUARE, UNIT_SQUARE);
  nearPt(apply(H, [0.37, 0.62]), [0.37, 0.62], 1e-9);
});

test('원근이 든 homography 는 평행을 깬다', () => {
  const dst = [[0, 0], [1, 0], [0.7, 1], [0.3, 1]];   // 사다리꼴
  const p = preservation(homographyFromQuads(UNIT_SQUARE, dst));
  assert.ok(!p.keepsParallel);
  assert.ok(p.perspective > 1e-6);
});

test('apply 는 원근 나눗셈을 한다', () => {
  const M = [[1, 0, 0], [0, 1, 0], [1, 0, 1]];   // w = x + 1
  nearPt(apply(M, [1, 2]), [0.5, 1]);
});
