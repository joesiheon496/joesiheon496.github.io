+++
title = "PU-Gaussian 업샘플링 데모 테스터 (Gradio 앱)"
date = 2026-07-28T13:50:00+09:00
draft = false
tags = ["point-cloud", "upsampling", "3D-gaussian", "gradio", "numpy", "프로그램정리"]
categories = ["프로그램"]
summary = "PU-Gaussian 논문의 핵심 아이디어를 학습 없이 numpy만으로 재현한 데모. kNN+PCA로 국소 이방성 가우시안을 추정해 점을 뽑고 표면으로 되끌어당긴다. 점군 파일을 올리면 원본/업샘플 결과를 3D 뷰어로 나란히 비교하는 Gradio GUI 포함."

[cover]
  image = "sample-output.png"
  alt = "입력 512점과 업샘플 결과 2048점 비교"
  caption = "토러스 512점 → 4× 업샘플 2048점 (CLI `--shape torus` 출력)"
  relative = true
+++

> 🛠 로컬 도구입니다. `D:\playground\pu-gaussian-tester` 에서 `python app.py` → `http://127.0.0.1:7862`
> 🔗 관련 정리: [PU-Gaussian — 3D 가우시안으로 점군 업샘플링]({{< ref "/posts/pu-gaussian" >}}) (원논문 [arXiv:2509.20207](https://arxiv.org/abs/2509.20207))
>
> ⚠️ **논문의 학습된 네트워크가 아닙니다.** Point Transformer도 학습 가중치도 없습니다. 아이디어만 고전적으로(numpy) 재현한 교육용 데모입니다. 실제 성능은 공식 구현 [mvg-inatech/PU-Gaussian](https://github.com/mvg-inatech/PU-Gaussian)을 보세요.

## 한 줄 요약

논문 [PU-Gaussian]({{< ref "/posts/pu-gaussian" >}})의 "국소 이웃을 **이방성 가우시안**으로 보고 거기서 점을 뽑는다"는 발상을, **학습 없이 kNN + PCA로** 구현해 손으로 만져보는 데모. 점군 파일을 올리면 즉시 3D 뷰어에 뜨고, 배율·`k`·퍼짐을 슬라이더로 돌려가며 결과를 나란히 비교한다.

논문을 읽고 "가우시안을 납작하게 만든다는 게 실제로 어떤 효과인가"가 안 잡혀서 만들었다. 슬라이더로 `normal-squeeze`를 1.0(구형)까지 올려보면 점들이 표면에서 부풀어 흩어지는 게 바로 보인다.

## 어떻게 동작하나

{{< img src="apx-pipeline.png" alt="3단계: kNN+PCA 가우시안 추정 → 샘플링 → 국소 평면 투영" caption="핵심 3단계를 2D로 그린 것. ②에서 일부러 퍼뜨리고 ③에서 표면으로 되끌어당기는 구조 (도식 직접 작성)" >}}

### ① 국소 이방성 가우시안 추정

점마다 kNN 이웃의 공분산을 고유분해한다.

```python
cov = np.einsum("nki,nkj->nij", d, d) / k    # (N,3,3)
evals, evecs = np.linalg.eigh(cov)           # evals 오름차순 → evals[:,0] = 표면 수직
s = np.sqrt(np.clip(evals, 1e-12, None))
s[:, 0] *= normal_squeeze                    # 수직축을 눌러 납작하게
```

`eigh`는 고유값을 **오름차순**으로 주므로 `evals[:,0]`이 최소 = 표면 법선 방향이다. 여기에 `normal_squeeze`(기본 0.25)를 곱해 눌러주면 논문이 말하는 "표면에 밀착한 납작한 타원체"가 된다. 학습된 `R`/`S` 헤드 대신 **PCA가 그 역할을 대신**한다.

### ② reparameterization 샘플링

```python
eps = np.clip(rng.normal(size=(n, r, 3)), -2.0, 2.0)   # 2σ 클립
scaled = eps * (Ss[:, None, :] * scale)
pts = mu[:, None, :] + np.einsum("nij,nrj->nri", Rs, scaled)   # μ + R(S⊙ε)
```

논문과 같은 `P = μ + R(S ⊙ ε)`. 2σ 밖 샘플을 잘라내는 것도 논문의 처리를 따랐다. 여기서는 미분 가능성이 필요 없지만(학습을 안 하니까), 형태를 맞춰두면 논문과 코드를 대조하기 쉽다.

### ③ 정제 — 국소 평면으로 투영

②의 결과는 표면 주변에 **부옇게 퍼져 있다**(위 그림 가운데). 각 점에 대해 원본 점군에서 kNN을 찾아 국소 평면을 구하고, 그 평면으로 수직 투영한다. 2회 반복.

```python
nrm = evecs[:, :, 0]                          # 최소 고유벡터 = 국소 평면 법선
dist = np.einsum("mi,mi->m", pts - c, nrm)
pts = pts - dist[:, None] * nrm               # 평면으로 투영
```

논문의 Stage 2(학습된 refinement network가 잔차 오프셋 예측)를 **기하 투영으로 대체**한 부분이다. 논문이 추론 시 정제를 2회 반복하는 것도 그대로 따랐다.

## 실행

### GUI

```bash
pip install -r requirements.txt
python app.py        # → http://127.0.0.1:7862
```

`.ply` / `.pcd` / `.xyz` / `.glb` / `.gltf` / `.obj` 를 올리면 **입력이 즉시 뷰어에 표시**되고, **🔍 업샘플 실행**을 누르면 오른쪽에 결과가 뜬다. `.ply` 다운로드 버튼도 있다.

파일이 없으면 합성 형상(`torus` / `sphere`)으로 바로 시험할 수 있다.

### CLI

```bash
# 합성 형상
python pu_gaussian_demo.py --shape torus --n-input 512 --up-rate 4

# 실제 파일
python pu_gaussian_demo.py --input scan.ply --up-rate 4 --save-ply
```

| 옵션 | 기본 | 설명 |
|---|:--:|---|
| `--input` | (없음) | 입력 파일. 주면 `--shape`/`--n-input` 무시 |
| `--shape` | torus | `torus` / `sphere` |
| `--n-input` | 512 | 합성 점 개수 |
| `--up-rate` | 4 | 업샘플 배율 |
| `--k` | 16 | 가우시안 추정용 이웃 수 |
| `--scale` | 0.8 | 샘플 퍼짐 계수 |
| `--normal-squeeze` | 0.25 | 표면 수직축 축소 = 이방성 강도 |
| `--save-ply` | off | open3d로 `.ply` 저장 |

## 실제 출력

방금 돌린 결과:

```
$ python pu_gaussian_demo.py --shape torus --n-input 512 --up-rate 4
[input]      512 pts,  mean NN spacing = 0.0844
[upsampled] 2048 pts,  mean NN spacing = 0.0374
```

최근접 이웃 평균 간격이 **0.0844 → 0.0374 로 44%** 가 됐다. 점 개수가 4배면 표면 밀도가 4배이고 간격은 이론적으로 1/√4 = 0.5배가 되어야 하는데, 그보다 조금 더 줄었다. 새 점이 원래 점 사이사이를 메우기 때문이다.

> 참고로 이 데모에는 **CD/HD/P2F 같은 정량 지표가 없다.** 정답 조밀 점군이 없으므로 잴 수가 없다. 최근접 간격은 "조밀해졌나"만 알려주는 대리 지표이고, "표면 위에 제대로 놓였나"는 말해주지 않는다. 논문 수치와 비교할 성질의 값이 아니다.

## 구현 메모

다시 만들 때 걸릴 만한 지점들:

- **`.glb` 포인트클라우드는 open3d가 못 읽는다.** 그래서 로더를 `trimesh` 우선 → 실패 시 `open3d` 순으로 두었다. Gradio `gr.Model3D`가 `.glb`를 원하는데 open3d는 point 프리미티브가 든 glb를 못 다루니, trimesh로 로드하고 trimesh로 export 하는 게 일관적이다.
- **`gr.Model3D(display_mode="point_cloud")`** 를 줘야 메시가 아니라 점으로 렌더된다. 안 주면 빈 화면처럼 보인다.
- **컬러는 export 시점에 박아 넣는다.** `trimesh.PointCloud(pts, colors=...)`로 z값을 viridis에 매핑해 저장. 뷰어 쪽에서 색을 지정할 방법이 없다.
- **업로드 즉시 미리보기.** `file.change` → `preview()`로 입력만 먼저 띄운다. 이게 없으면 "올렸는데 아무 일도 안 일어난다"는 인상을 준다. 실행 전에 입력이 제대로 읽혔는지 확인되는 것도 이득.
- **출력 크기 상한.** `len(inp) × up_rate > 2,000,000`이면 실행을 막는다. 정제 단계가 매 패스마다 `M×k` kNN 질의를 하므로, 상한이 없으면 브라우저가 아니라 프로세스가 먼저 죽는다.
- **`np.einsum`으로 배치 처리.** `for` 루프로 점마다 3×3 고유분해를 돌리면 수천 점에서 이미 느리다. `eigh`는 배치 입력을 받으므로 `(N,3,3)`을 한 번에 넣는다.

## 한계

1. **논문 재현이 아니다.** 학습된 Point Transformer가 빠졌으므로 일반화·노이즈 내성은 논문과 무관하다. 특히 노이즈가 있는 입력에서는 PCA가 흔들려 가우시안 방향이 틀어진다.
2. **정제가 국소 평면 투영이라 날카로운 모서리를 뭉갠다.** 모서리에서는 이웃이 두 면에 걸쳐 있어 평면이 어긋나고, 투영이 모서리를 깎는다. 논문의 학습된 refinement가 이런 데서 유리하다.
3. **밀도 균일성을 보장하지 않는다.** 모든 점에서 같은 배율로 뽑으므로, 원래 조밀했던 곳은 더 조밀해진다. 성긴 곳을 우선 채우는 로직이 없다.
4. **CPU numpy 구현.** 수만 점 이상에서는 정제 단계가 눈에 띄게 느려진다(경고를 띄운다).

## 메모

- 이 데모의 ③번(국소 평면 투영)은 사실 [PUtPFS]({{< ref "/posts/putpfs" >}})가 하는 일의 축소판이다. 그쪽은 평면에 투영한 뒤 **DCT 기저 중첩으로 표면을 근사**하고 그 위에 점을 얹는 반면, 여기서는 그냥 평면에 눌러 붙인다. 곡률이 있는 곳에서 차이가 난다.
- 논문을 읽을 때 수식이 안 잡히면 **슬라이더 하나 붙여 돌려보는 게 제일 빠르다.** `normal-squeeze`를 0.05 ↔ 1.0으로 오가면 "이방성"이 무슨 말인지 5초 만에 이해된다.
- 환경: numpy · scipy · matplotlib · trimesh · gradio (+ 선택 open3d)
