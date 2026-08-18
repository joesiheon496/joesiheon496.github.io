+++
title = "NSFP : 학습 데이터 없이, 두 프레임 사이에서 신경망을 최적화한다"
date = 2026-08-18T09:00:00+09:00
draft = false
math = true
tags = ["논문정리", "scene-flow", "point-cloud", "test-time-optimization", "LiDAR", "NeurIPS"]
categories = ["논문"]
summary = "연속된 두 LiDAR 점군(t=k, t=k+1)만 주고, 프레임 쌍마다 MLP를 즉석에서 최적화해 3D 흐름을 얻는다. 학습 데이터도 사전 학습도 없다 — 신경망의 구조 자체가 정규화(prior) 역할을 한다. KITTI에서 완전지도 방법을 큰 폭으로 이기고, 이후 ZeroFlow·Fast NSF·FlowCalib이 모두 이 위에 서 있다."
+++

> 📄 **논문**: *Neural Scene Flow Prior*, Xueqian Li, Jhony Kaesemodel Pontes, Simon Lucey — CMU · Argo AI — [arXiv:2111.01253](https://arxiv.org/abs/2111.01253), **NeurIPS 2021 (Spotlight)**
> 💻 **코드**: [github.com/Lilac-Lee/Neural_Scene_Flow_Prior](https://github.com/Lilac-Lee/Neural_Scene_Flow_Prior) · [프로젝트 페이지](https://lilac-lee.github.io/Neural_Scene_Flow_Prior/)
> 🔗 관련 정리: [Grad-PU]({{< ref "/posts/grad-pu" >}}) (반복 최적화로 점을 옮기는 같은 철학) · [Upsample Anything]({{< ref "/posts/upsample-anything" >}}) (2D 쪽의 test-time optimization) · [FlowCalib]({{< ref "/posts/flowcalib" >}}) (NSFP를 부품으로 쓰는 후속)

{{< celos title="[2021] Neural Scene Flow Prior" src="celos-card.png" />}}

## 한 줄 요약

Scene flow — 연속 두 점군 \(S_1, S_2\) 사이의 점별 3D 모션 — 를 구하는 데 **학습된 네트워크를 쓰지 않는다.** 대신 프레임 쌍이 주어질 때마다 **무작위 초기화된 MLP를 그 쌍 위에서 직접 최적화**한다. MLP는 흐름을 예측하도록 "배운" 적이 없다. 좌표를 받아 흐름을 내놓는 매끄러운 함수라는 **구조적 성질 자체가 정규화**로 작동하고, 그것이 노이즈에 강하고 물리적으로 그럴듯한 흐름을 만든다.

> 이미지 쪽 Deep Image Prior가 "네트워크 구조가 곧 prior"임을 보였다면, NSFP는 그 발상을 **동적 3D 장면**으로 가져온 것이다.

## 배경 / 왜 읽었나

- **학습 기반 scene flow의 일반화 문제.** FlowNet3D·PointPWC-Net 등은 라벨된 합성 데이터(FlyingThings3D — 학습 19,967쌍)로 학습하는데, 실측 LiDAR — 밀도·스캔 패턴·장면 분포가 전혀 다른 — 로 가면 성능이 무너진다. 자율주행에서 치명적인 약점.
- **고전 최적화의 정규화 설계 문제.** 프레임 쌍 위에서 직접 흐름을 최적화하는 고전 접근은 라벨이 필요 없지만, as-rigid-as-possible이나 그래프 라플라시안 같은 정규화 항을 손으로 설계해야 한다. 논문은 이 계열의 대표로 **graph prior**(k-NN 그래프 위 라플라시안 평활)를 구현해 처음부터 끝까지 비교군으로 끌고 간다.
- **내 관심사와의 접점.** "t=k, t=k+1 두 프레임 정보만으로 최적화한다"는 문제 설정의 원형이라 읽었다. 업샘플링 쪽에서 본 test-time optimization 흐름([Upsample Anything]({{< ref "/posts/upsample-anything" >}}))의 3D scene flow 판이기도 하다.

## 핵심 아이디어

흐름을 벡터장 \(g: \mathbb{R}^3 \to \mathbb{R}^3\) 로 표현하되, \(g\)를 MLP로 둔다. 최적화 변수는 흐름 벡터가 아니라 **MLP의 가중치 \(\Theta\)** 다.

기본형(forward만)은:

$$
\Theta^* = \arg\min_\Theta \sum_{p \in S_1} D\big(p + g(p;\Theta),\; S_2\big)
$$

여기서 \(D\)는 점-대-집합 거리 \(D(p, S) = \min_{x \in S} \lVert p - x \rVert_2^2\) 를 양방향으로 적용한 것 — 즉 Chamfer distance다. 이상치 억제를 위해 2 m에서 절단(truncation)한다.

실제로 쓰는 것은 **역방향 MLP \(g(\,\cdot\,;\Theta_{bwd})\)를 함께 최적화하는 사이클 일관성** 버전이다:

$$
\Theta^*, \Theta_{bwd}^* = \arg\min \;
\underbrace{\sum_{p \in S_1} D\big(p + g(p;\Theta),\, S_2\big)}_{\text{forward}}
\;+\;
\underbrace{\sum_{p' \in S_1'} D\big(p' + g(p';\Theta_{bwd}),\, S_1\big)}_{\text{cycle: } S_1 \to S_2 \to S_1}
$$

\(S_1' = \{p + g(p;\Theta)\}\) 는 forward로 옮긴 점군이다. 왕복해서 원위치로 돌아오라는 요구가, 희소한 점군에서 Chamfer의 잘못된 최근접 매칭으로 흐름이 붕괴하는 것을 막는다.

**정규화 항이 하나도 없다는 점**이 요지다. 점별 자유 변수로 흐름을 최적화하면 Chamfer가 노이즈에 그대로 끌려가지만, MLP를 거치면 가까운 점들이 자연스럽게 비슷한 흐름을 갖는다 — 명시적 평활 항 없이 매끄러움이 생긴다.

## 방법 상세

### 아키텍처 — 작정하고 단순하다

| 항목 | 값 |
|---|---|
| 구조 | MLP, hidden 8층 × 128 유닛, ReLU |
| 파라미터 | 약 116k (FlowNet3D 1.2M의 약 1/10) |
| 입력/출력 | 3D 좌표 → 3D 흐름 (점별 공유 가중치) |
| positional encoding | **안 씀** — 어블레이션에서 오히려 도움 안 됨 |

NeRF류에서 필수인 positional encoding을 버린 것이 흥미롭다. PE는 고주파를 잘 맞추게 하는 장치인데, 여기서는 **고주파를 못 맞추는 것이 곧 정규화**이므로 목적에 반한다.

### 최적화 설정

| 항목 | 값 |
|---|---|
| 옵티마이저 | Adam, lr 8e-3 고정 |
| 반복 | 최대 5,000 (loss 기반 early stopping, 통상 1k 이내 수렴) |
| 프로토콜 | 점군당 2,048점 샘플링 (표준 비교), full density 실험 별도 |
| 하드웨어 | Quadro P5000 1장 |

```text
입력: S1, S2  (연속 두 점군, 라벨 없음)

1. g(·;Θ), g(·;Θ_bwd) ← 무작위 초기화된 MLP 두 개
2. 반복 (early stopping까지):
   S1' = S1 + g(S1;Θ)                    # forward warp
   L   = TruncCD(S1', S2)                # 데이터 항 (2m 절단)
       + TruncCD(S1' + g(S1';Θ_bwd), S1) # cycle 항
   Θ, Θ_bwd ← Adam
3. 출력: flow = g(S1;Θ)   ← 공간 전체에서 정의된 연속 벡터장
```

## 실험

지표: EPE(end-point error, m) / Acc₅(EPE<0.05 m 또는 상대오차<5%) / Acc₁₀(<0.1 m 또는 <10%) / \(\theta_\epsilon\)(평균 각도 오차, rad).

**KITTI Scene Flow (2,048점):**

| 방법 | EPE ↓ | Acc₅(%) ↑ | Acc₁₀(%) ↑ | θ_ε ↓ |
|---|:---:|:---:|:---:|:---:|
| FlowNet3D (지도) | 0.199 | 10.44 | 38.89 | 0.386 |
| PointPWC-Net (완전지도) | 0.142 | 29.91 | 59.83 | 0.239 |
| Graph prior (무학습) | 0.099 | 63.60 | 81.18 | 0.176 |
| **NSFP (무학습)** | **0.050** | **81.68** | **93.19** | **0.133** |

합성 데이터로 학습한 지도 방법들이 KITTI에서 도메인 갭으로 무너지는 동안, 학습이 없는 NSFP는 갭 자체가 없다. Acc₅ 기준 완전지도 PointPWC 대비 **+51.8pp**.

**밀도를 올리면 격차가 더 벌어진다 (KITTI full density, ~30k점):**

| 방법 | Acc₅ | 시간/쌍 |
|---|:---:|:---:|
| Graph prior (k=50) | 65.50% | 162.97 s |
| **NSFP** | **95.68%** | **38.33 s** |

graph prior는 k-NN 그래프 구성이 \(O(n^2)\)라 10k점을 넘으면 급격히 무거워지고, NSFP는 \(O(n)\)이라 점이 많을수록 오히려 유리하다 — 정규화를 이산 그래프가 아니라 연속 함수로 옮긴 것의 실질적 이득.

**nuScenes (2,048점, pseudo-GT):** NSFP EPE 0.175 / Acc₅ 35.18% vs graph prior 0.289 / 20.12%. 절대 수치가 낮은 것은 nuScenes LiDAR가 32빔으로 더 희소하기 때문.

### 어블레이션

- **사이클 항의 기여가 결정적**: KITTI Acc₅ 60.36% → **80.70%** (+20.34pp). 희소 점군일수록 중요.
- **깊이·폭 스윕**: 깊고 넓을수록 정확도가 오르다 포화 — 8층×128이 정확도/비용의 균형점.

## 응용 — 흐름 적분으로 시퀀스 조밀화

\(g\)가 연속 벡터장이므로 임의 좌표에서 흐름을 질의할 수 있고, 프레임별 최적화 결과를 이어 붙여 **장기 대응**을 만들 수 있다:

$$
f_{0 \to m+1} = f_{0 \to m} + g\big(p_0 + f_{0 \to m};\; \Theta^*_{m \to m+1}\big)
$$

Argoverse에서 연속 10프레임을 한 프레임으로 누적해 조밀한 점군을 만드는 데모를 보인다. 이산 최근접 매칭 없이 부드러운 보간이 되는 것이 연속 표현의 이득 — **시간 축을 이용한 무학습 점군 조밀화**로, 업샘플링 관점에서 이 논문의 가장 흥미로운 대목이다.

## 한계 / 이후 계보

- **느리다.** 학습 기반 대비 10~100배 느린 런타임 최적화 (30k점 기준 ~38 s/쌍). 실시간 인지에는 부적합.
- 이 병목이 후속 연구의 출발점이 됐다:
  - **Fast NSF / [Fast Kernel Scene Flow](https://arxiv.org/abs/2403.05896)** — 최적화 구조를 바꿔 가속.
  - **[ZeroFlow](https://arxiv.org/abs/2305.10424)** — NSFP를 교사로 삼아 라벨 없이 실시간 학생 네트워크를 증류.
  - **[Self-Supervised Multi-Frame NSF](https://arxiv.org/abs/2403.16116)** — 두 프레임을 넘어 k−1, k, k+1 세 프레임으로 확장.
  - **[FlowCalib]({{< ref "/posts/flowcalib" >}})** — NSFP의 흐름장을 캘리브레이션 오차 탐지의 입력으로 사용.

## 메모

- [Grad-PU]({{< ref "/posts/grad-pu" >}})의 "학습된 거리함수 위에서 점을 경사 하강으로 이동"과 구도가 평행하다. 차이: Grad-PU는 학습된 prior + 추론 시 최적화, NSFP는 **prior조차 학습하지 않고** 구조적 prior만 쓴다.
- 업샘플링 서베이에서 확인한 "3D 쪽 학습-불필요 베이스라인 공백"에 대한 부분적 답이 여기 있다 — 흐름 적분 densification은 시간 축을 이용한 무학습 업샘플링으로 읽을 수 있다. 정적 단일 프레임 업샘플링과 결합하면 재미있는 방향.
- PE를 빼는 선택이 시사하는 것: **표현력을 늘리는 장치와 정규화로 쓰는 장치는 반대 방향**이다. 3DGS 계열 업샘플링·캘리브레이션에서 Gaussian 파라미터화의 자유도를 어디까지 열지 정할 때 같은 질문이 나온다.

---

## 부록: 수식 직관 가이드

**왜 MLP를 거치면 정규화가 되나?** 점별 자유 변수 최적화는 모래알 하나하나를 손으로 옮기는 것과 같다 — Chamfer가 시키는 대로 노이즈까지 따라간다. MLP는 좌표 공간 전체를 덮는 **탄성 시트**를 변형시키는 것과 같아서, 한 점을 옮기려면 주변 공간도 함께 휘어야 한다. 저주파(매끄러운) 변형이 고주파(노이즈) 변형보다 먼저, 쉽게 학습되는 신경망의 스펙트럼 편향이 이 "탄성"의 정체다.

**사이클 항은 왜 +20pp나 만드나?** Chamfer의 최근접 매칭은 희소 점군에서 서로 다른 여러 점을 같은 목표점에 뭉치게 만들 수 있다 (many-to-one 붕괴). 뭉친 점들은 되돌아갈 곳이 제각각이라 역방향 Chamfer가 커진다 — 왕복 요구가 붕괴 해를 비싸게 만들어 걸러낸다.

**흐름 적분(Eq. 5)의 포인트**: \(f_{0\to m}\)으로 옮겨 간 위치는 \(S_m\)의 실제 점과 일치하지 않는데, \(g\)가 연속 함수라 **그 위치에서도 흐름을 질의할 수 있다.** 이산 흐름 벡터를 최근접 점에서 빌려오는 방식이라면 누적할수록 오차가 쌓인다 — 연속 표현이라 장기 누적이 성립한다.
