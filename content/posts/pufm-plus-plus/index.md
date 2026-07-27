+++
title = "PUFM++ : Flow Matching으로 점군 업샘플링 정리"
date = 2026-07-27T11:00:00+09:00
draft = false
tags = ["논문정리", "point-cloud", "flow-matching", "3D-vision", "upsampling"]
categories = ["논문"]
summary = "희소 점군을 조밀한 점군으로 복원하는 PUFM++ 논문(arXiv 2512.20988)과 전작 PUFM(코드 공개) 정리. Flow Matching으로 diffusion보다 훨씬 적은 스텝으로 고품질 업샘플링을 달성한다."

[cover]
  image = "cover.png"
  alt = "PUFM++ 커버"
  caption = "PUFM++: Point Cloud Upsampling via Enhanced Flow Matching"
  relative = true
+++

> 📄 **논문**: *Point Cloud Upsampling via Enhanced Flow Matching* (PUFM++), Zhi-Song Liu, Chenhang He, Roland Maier, Andreas Rupp — [arXiv:2512.20988](https://arxiv.org/abs/2512.20988) (2025-12)
> 💻 **코드**: [Holmes-Alan/PUFM](https://github.com/Holmes-Alan/PUFM) — 전작 **PUFM** (*Efficient Point Cloud Upsampling via Flow Matching*, [arXiv:2501.15286](https://arxiv.org/abs/2501.15286))의 공식 구현. 아래 "코드 돌려보기"는 이 저장소 기준입니다.
>
> ⚠️ 이 글의 그림은 저작권 문제를 피하려고 논문 figure를 그대로 쓰지 않고, **보고된 수치와 개념을 직접 도식/차트로 재구성**한 것입니다.

## 한 줄 요약

LiDAR·깊이카메라로 얻은 **희소하고 노이즈 많은 점군**을 **조밀하고 균일한 점군**으로 복원(업샘플링)하는 문제를, 노이즈→점군이 아니라 **희소 점군 → 조밀 점군을 직접 잇는 Flow Matching**으로 풀어, diffusion(20~50스텝) 대비 **6스텝 수준**으로 SOTA 품질을 낸다.

## 배경: 왜 어려운가

- 다운스트림 작업(표면 복원, 인식, SLAM 등)은 조밀·균일·무노이즈 점군을 원하지만, 센서 출력은 그 반대다.
- 고전적 최적화 기반 방법은 수작업 기하 prior에 의존해 일반화가 약하다.
- PU-Net·PU-GAN 등 초기 딥러닝은 특징 표현/전역 일관성이 부족했다.
- **Diffusion 기반**(PUDM 등)은 품질은 좋지만 **가우시안 노이즈에서 시작**하기 때문에 (1) 희소 점군에 이미 들어있는 기하 정보를 버리고, (2) 추론에 20~50스텝이 필요해 느리다.

## 핵심 아이디어 (전작 PUFM)

{{< img src="fig-concept.png" alt="sparse에서 dense로의 flow matching 개념도" caption="그림 1. 노이즈가 아니라 '희소 점군 자체'를 시작점으로 삼아 조밀 점군까지 직선 경로로 흐른다 (직접 재구성한 개념도)" >}}

Flow Matching은 시작 분포 `x0`(희소)와 목표 분포 `x1`(조밀) 사이를 잇는 속도장 `v_θ`를 학습한다.

```text
직선 보간:   x_t = (1 - t)·x0 + t·x1,   t ∈ [0,1]
학습 목표:   min ‖ v_θ(x_t, t) − (x1 − x0) ‖²   (MSE)
추론:        x0에서 시작해 ODE 적분 → x1  (스텝 수 적음)
```

핵심은 **시작점이 노이즈가 아니라 희소 점군**이라는 것. 이미 대략의 형상을 알고 출발하므로 경로가 짧아 스텝이 적게 든다. 단, 점군은 순서가 없어(unordered) 어떤 희소점이 어떤 조밀점으로 가야 하는지 대응이 모호한데, PUFM은 **EMD(Earth Mover's Distance) 사전 정렬**로 최적수송(OT) 대응을 잡아 안정적인 학습 경로를 만든다.

## PUFM++의 4가지 개선

### 1. 2단계 Flow Matching
- **Stage 1 (사전 정렬)**: EMD(auction 알고리즘)로 희소↔조밀 대응 `φ*`를 찾은 뒤 위 MSE 손실로 속도장을 학습. → *국소* 속도는 맞지만 t=1에서의 분포가 목표와 정확히 일치한다는 보장은 없음.
- **Stage 2 (종점 정제)**: 소스에서 궤적을 실제로 적분해 얻은 `x̃1`과 목표 `x1`의 **Chamfer Distance(순열 불변)** 를 최소화. 입력에 소량 노이즈 `ξ~N(0,σ²)`를 더해 국소 이웃 수송을 매끄럽게 정규화. → 분포 일치를 직접 강제.

### 2. Adaptive Time Scheduler (ATS)
학습 중 **타임스텝별 MSE 손실**로 "어려운 구간 밀도" `ω(t)=(L_mse(t)+ψ)^β`를 만들고, 그 CDF를 역변환 샘플링해 **어려운 구간에 ODE 스텝을 더 배분**. 같은 6스텝 예산에서 균일 스케줄 대비 CD 약 7% 개선.

### 3. Manifold 제약 (test-time)
- **곡률 가중**: 점마다 k-NN 공분산의 고윳값으로 곡률 `κ=λ1/(λ1+λ2+λ3)`을 구해, 고곡률(모서리·디테일) 영역의 속도 갱신을 강조(`w = 1 + α·κ`).
- **역투영(back-projection)**: 적분 후 원본 희소 표면으로의 거리 `‖x_kNN − x̃0‖²`를 작은 lr로 경사하강 → 점을 실제 표면에 밀착. → 메시 품질(법선 일관성·삼각형 품질) 향상.

### 4. RIN 기반 recurrent latent
PointNet++ 피드포워드는 매 스텝 전역 구조를 다시 추론해 시간적 일관성이 깨진다. PUFM++는 **Recurrent Interface Network(RIN)** 로 latent token `z_t`를 유지하며 속도와 함께 갱신(`[v, z_{t+1}] = v_θ(x_t, z_t, t)`). Read → Compute → Write 3단 어텐션 구조. 학습 시엔 스텝이 독립 샘플이라 과거 `z`가 없으므로, **null 초기화로 proxy latent를 뽑아(stop-grad) 자기 출력을 조건으로 쓰도록** 2-pass로 학습.

## 실험 결과

**데이터셋**: PU-GAN(테스트 27), PU1K(테스트 127). 패치 단위(조밀 1024pts / 희소 256pts).
**메트릭**: CD(Chamfer, ×1e4), HD(Hausdorff, ×1e3), P2F(점-표면 거리), JSD(분포 차이) — 모두 낮을수록 좋음. 메시 품질은 NC(법선 일관성)·ALR(삼각형 품질)·MR(다양체율) — 높을수록 좋음.

### 정량 결과 (PUGAN 4×)

{{< img src="fig-cd.png" alt="PUGAN 4x CD 비교 막대차트" caption="그림 2. PUGAN 4× Chamfer Distance 비교 (논문 Table 1 수치로 직접 작성, 낮을수록 좋음)" >}}

| 방법 | CD ↓ | HD ↓ | P2F ↓ | JSD ↓ |
|------|:----:|:----:|:-----:|:-----:|
| PUDM (diffusion) | 1.221 | 1.174 | 3.132 | 0.147 |
| SAPCU | 1.522 | 1.471 | 3.441 | 0.135 |
| Grad-PU | 1.132 | 1.186 | 1.957 | 0.111 |
| PUFM (전작) | 1.049 | 0.876 | 1.864 | 0.121 |
| **PUFM++** | **0.980** | **0.747** | **1.301** | **0.098** |

PU1K 16×에서도 CD 0.220→**0.176**, JSD 0.228→**0.135** 등 전작 대비 전반적 개선. JSD는 약 19% 감소.

### 실제 데이터 & 다운스트림
- **노이즈 입력**(PU1K 4×, η=0.02): CD 1.761(PUFM)→**1.662**로 견고.
- **KITTI LiDAR 3D 검출**(2×): Car AP@0.7 sparse 20.35 → **PUFM++ 23.86** (GT 20.36 상회, 빔 패턴 보존).
- **ScanNet RGB-D**(4×): CD **0.899**, HD **0.156** 로 Grad-PU·PUDM 대비 우수.
- **메시 복원**(PU1K 16×): NC **0.950** 로 가장 매끄러운 표면.

### Ablation 요약
- EMD 정렬 단독 효과는 미미, **Stage 2 정제가 핵심**(CD 0.035~0.05 개선).
- RIN은 파라미터 3.8배(115M vs 30M)지만 런타임 +73%에 그치고, 2단계 학습과 결합 시 CD 최대 개선.
- 곡률+역투영 둘 다 켜면 ALR +16%, NC +4%.

## 코드 돌려보기 (전작 PUFM 저장소 기준)

```bash
# 환경 (README): python 3.9, torch 1.13
# 내장 확장 빌드 필요: pointops, Chamfer3D, emd_assignment
pip install numpy==1.25.2 open3d==0.17.0 einops==0.3.2 scikit-learn==1.3.1 tqdm h5py

# 단일 파일 업샘플 (4배)
python test_pufm.py --model pufm --test_input_path example/camel.xyz --up_rate 4

# 벤치마크 평가 (attention 버전, PU-GAN)
python eval_pufm.py --model pufm_w_attn --dataset pugan --up_rate 4

# 임의 배율
python test_pufm_arbitrary.py
```

데이터셋은 PU1K(학습)·PU-GAN(평가), 사전학습 가중치는 `pretrained_model/`에 포함. Colab 데모도 제공. (PUFM++ 전용 코드는 공개 여부를 저장소에서 확인 필요.)

## 한계

- EMD 계산이 O(n²)이고, RIN latent를 위한 2-pass 학습으로 **학습 비용이 큼**. 모델도 115M로 무겁다.
- ATS의 CDF를 만들려면 학습 후 모델을 고정해 타임스텝별 손실을 재수집해야 해 **배포 절차가 번거로움**.
- 합성/정제 데이터 편향 — 도메인이 크게 다른 실제 스캔에선 성능 저하 가능.
- 향후 계획: **1-step distillation**, 업샘플링–완성(completion) 결합 모델.

## 메모

- 큰 그림: "노이즈에서 만들지 말고, 이미 가진 희소 점군에서 출발하라"가 diffusion 대비 효율의 핵심.
- 우리 쪽 깊이/포인트클라우드 파이프라인(예: 왜곡 보정 후 포인트클라우드)에서 **희소한 depth-back-projected 점군을 조밀화**하는 후처리로 붙여볼 여지가 있어 보임.
- 원문: [arXiv:2512.20988](https://arxiv.org/abs/2512.20988) · 코드: [Holmes-Alan/PUFM](https://github.com/Holmes-Alan/PUFM)
