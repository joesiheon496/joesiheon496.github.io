+++
title = "Depth Anything 3 : 어떤 뷰에서든 3D 공간 복원"
date = 2026-07-27T12:45:00+09:00
draft = false
tags = ["논문정리", "depth-anything", "3D-vision", "multi-view", "pose-estimation"]
categories = ["논문"]
summary = "임의 개수의 이미지에서 (포즈를 알든 모르든) 공간적으로 일관된 3D 기하를 예측하는 Depth Anything 3 정리. 핵심은 '평범한 DINO 백본 하나 + depth-ray 단일 표현'이면 충분하다는 것."

[cover]
  image = "teaser.png"
  alt = "DA3 결과 개요: 단안 depth·pose·reconstruction에서 VGGT/Pi3 상회"
  caption = "DA3 결과 개요 — 단안 depth·pose·reconstruction 정확도에서 VGGT·Pi3 상회 · 원논문 Figure 1 (Lin et al., [arXiv:2511.10647](https://arxiv.org/abs/2511.10647), 학습용 인용)"
  relative = true
+++

> 📄 **논문**: *Depth Anything 3: Recovering the Visual Space from Any Views*, Haotong Lin 외 (ByteDance Seed) — [arXiv:2511.10647](https://arxiv.org/abs/2511.10647) (2025-11)
> 💻 **코드/모델**: [ByteDance-Seed/Depth-Anything-3](https://github.com/bytedance-seed/depth-anything-3) · [프로젝트 페이지](https://depth-anything-3.github.io) · [HF 모델](https://huggingface.co/depth-anything/)
> 🔗 참고: 이 모델은 제가 로컬에서 돌리는 [Depth Anything 3 비디오 프레임 테스터]({{< ref "/posts/depth-anything-3-video-tester" >}}) 의 백엔드입니다.
>
> ⚠️ Figure 1·2는 원논문 그림(출처 명기, 학습용 인용), 부록 도식은 직접 작성.

{{< celos title="[2025] Depth Anything 3 : Recovering the Visual" src="celos-card.png" />}}

## 한 줄 요약

**임의 개수의 이미지**(카메라 포즈를 알든 모르든)에서 **공간적으로 일관된 3D 기하**(depth + 카메라)를 한 번에 예측한다. 핵심 주장은 *"특수한 구조 없이 **평범한 DINO ViT 백본 하나**로 충분하고, **depth-ray 단일 표현**이면 복잡한 멀티태스크가 필요 없다"*는 것.

## 배경 / 문제

멀티뷰 3D 복원(구조 + 카메라 포즈)은 그동안 포인트맵·포즈·depth를 각각 예측하는 **복잡한 멀티태스크 + 특수 아키텍처**로 풀렸다(예: VGGT). DA3는 이를 **단순 백본 + 통합 타깃**으로 갈아엎어, 더 단순한데 더 정확하다는 것을 보인다.

## 핵심 아이디어 2가지

1. **백본은 vanilla transformer로 충분** — 사전학습된 DINOv2 ViT를 구조 변경 없이 사용. within-view self-attention과 cross-view self-attention을 2:1 비율로 섞어 여러 뷰 정보를 융합.
2. **depth-ray 단일 예측 타깃** — 픽셀마다 (거리 `D`) + (카메라 광선 `t, d`)만 내면, 3D 점은 `P = t + D·d`로 결정. 포인트맵·포즈를 따로 뽑는 중복을 없앤다. (자세한 직관은 [부록](#부록-수식-직관-가이드))

## 파이프라인

{{< img src="pipeline.png" alt="DA3 파이프라인" caption="DA3 파이프라인 — 입력 뷰 → Patch Embed → Vanilla DINO(within/cross-view attn) → Dual-DPT Head → Depth + Ray → Points. 카메라 토큰은 있으면 인코딩, 없으면 학습형. 원논문 Figure 2 (Lin et al., arXiv:2511.10647, 학습용 인용)" >}}

- **Dual-DPT Head**: 공유 reassembly로 특징을 처리한 뒤, **depth 가지**와 **ray 가지**로 갈라 각각 출력. 같은 중간 특징을 공유해 두 태스크가 서로 돕게 하면서 중복은 피한다(제거 시 4~11% 성능 하락).
- 출력: Depth `N×H×W`, Ray `N×½H×½W×6`(원점 3 + 방향 3) → 결합해 Points `N×H×W×3`.

## Teacher-Student 학습

실세계 데이터의 depth GT는 **노이즈 많고 불완전**하다. 그래서:
- **합성 데이터로만** 학습한 **monocular teacher**(Hypersim·TartanAir·BlendedMVS 등 20+ 데이터셋)가 고품질 pseudo-label 생성.
- teacher의 상대 depth를 실데이터의 희소·노이즈 GT에 **RANSAC 최소제곱으로 정렬**: `D_aligned = ŝ·D̃ + t̂` (스케일·시프트만 맞춤). → 라벨 디테일·완전성↑, 기하 정확도 유지.

## 모델 변형

| 변형 | 파라미터 | 용도 |
|------|:-------:|------|
| DA3-Small / Base / Large / **Giant** | 0.03 / 0.11 / 0.36 / **1.10B** | any-view 기본 시리즈 |
| DA3Metric-Large | 0.35B | 단안 **metric** depth |
| DA3Mono-Large | 0.35B | 고품질 단안 상대 depth |
| DA3Nested-Giant-Large | — | any-view + metric 결합(실제 스케일) |

라이선스: **Giant·Large·Nested = CC BY-NC 4.0**(비상업), **Base·Small·Metric·Mono = Apache 2.0**.

## 결과

- **카메라 포즈**: 이전 SOTA VGGT 대비 **+44.3%**, **기하 정확도 +25.1%**.
- **단안 depth**: DA2·VGGT 모두 상회.

| 벤치마크(δ₁↑) | DA2 | VGGT | **DA3** | Teacher |
|---|:--:|:--:|:--:|:--:|
| KITTI | 94.6 | 91.7 | **95.3** | 97.2 |
| ETH3D | 86.5 | 97.5 | **98.6** | 99.8 |

| Pose Auc3↑ | VGGT | **DA3-Giant** |
|---|:--:|:--:|
| HiRoom | 49.1 | **80.3** |
| ETH3D | 26.3 | **48.4** |
| ScanNet++ | 62.6 | **85.0** |

Giant는 VGGT와 크기가 비슷(1.10B vs 1.19B)한데 속도는 더 빠름(37.6 vs 34.1 FPS). 학습은 H100 128장 × 200k step(≈10일).

## 돌려보기

```bash
pip install xformers "torch>=2" torchvision
pip install -e ".[app]"     # Gradio UI 포함
```

```python
from depth_anything_3.api import DepthAnything3
model = DepthAnything3.from_pretrained("depth-anything/DA3NESTED-GIANT-LARGE-1.1")
prediction = model.inference(images)
```

```bash
da3 auto assets/examples/SOH --export-format glb   # 폴더 자동 처리
da3 video video.mp4 --fps 15 --export-format glb   # 비디오 → 3D
```

## 메모

- "복잡한 멀티태스크·특수 헤드"를 **단일 백본 + depth-ray 타깃**으로 단순화한 게 이 논문의 큰 그림. 단순함이 곧 일반화·확장성으로 이어진 사례.
- 실사용: 위 [로컬 테스터]({{< ref "/posts/depth-anything-3-video-tester" >}})에서 `da3-small/base/mono-large`로 비디오 프레임 depth·포인트클라우드를 뽑고 있음.
- 큰 모델(Giant/Nested)은 **비상업 라이선스(CC BY-NC 4.0)**라 상용 시 Base/Small(Apache 2.0) 고려.
- 원문: [arXiv:2511.10647](https://arxiv.org/abs/2511.10647) · 코드: [ByteDance-Seed/Depth-Anything-3](https://github.com/bytedance-seed/depth-anything-3)

---

## 부록: 수식 직관 가이드

> 핵심 수식을 비유와 그림으로. (도식은 직접 작성)

### A. depth-ray 표현

```text
P = t + D · d
  t : 카메라(광선) 원점 (3D)
  d : 픽셀이 바라보는 방향 단위벡터 (3D)
  D : 그 방향으로의 거리 = depth (스칼라)
```

{{< img src="apx-depthray.png" alt="depth-ray 표현 개념도" caption="원점 t에서 방향 d로 거리 D만큼 간 지점이 3D 점 P" >}}

**비유**: 픽셀 하나하나가 **레이저 포인터**라고 생각하면 된다. 포인터의 **위치**가 `t`, **쏘는 방향**이 `d`, 그리고 **레이저가 얼마나 멀리 맞았는지**가 `D`(depth). 이 세 개만 있으면 3D 공간의 점 `P`가 정해진다. 방향 `d`가 카메라 자세 정보를 품고 있어서, **포즈를 따로 예측하지 않아도** 광선맵(ray map)만으로 카메라가 어디를 어떻게 보는지가 나온다 — 그래서 "depth + ray"가 최소이면서 충분한 표현.

### B. Teacher → Student 정렬

```text
D_aligned = ŝ · D̃ + t̂        (ŝ, t̂: RANSAC 최소제곱으로 robust 추정)
```

**비유**: teacher가 만든 pseudo-depth `D̃`는 **눈금 없는 자**와 같다 — 모양(상대적 원근)은 정확한데 실제 스케일·오프셋은 모른다. 실데이터의 희소한 GT 몇 점을 **기준점 삼아 자의 눈금(스케일 `ŝ`)과 시작점(시프트 `t̂`)만 맞추면**, teacher의 촘촘하고 깨끗한 디테일을 실제 스케일에 정렬해 쓸 수 있다. RANSAC이라 이상치(노이즈 GT)에 흔들리지 않는다.
