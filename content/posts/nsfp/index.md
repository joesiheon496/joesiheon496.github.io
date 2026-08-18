+++
title = "NSFP : 학습 데이터 없이, 두 프레임 사이에서 신경망을 최적화한다"
date = 2026-08-18T09:00:00+09:00
draft = false
tags = ["논문정리", "scene-flow", "point-cloud", "test-time-optimization", "LiDAR", "NeurIPS"]
categories = ["논문"]
summary = "연속된 두 LiDAR 점군(t=k, t=k+1)만 주고, 프레임 쌍마다 MLP를 즉석에서 최적화해 3D 흐름을 얻는다. 학습 데이터도 사전 학습도 없다 — 신경망의 구조 자체가 정규화(prior) 역할을 한다. 이후 ZeroFlow·Fast NSF·FlowCalib이 모두 이 위에 서 있다."
+++

> 📄 **논문**: *Neural Scene Flow Prior*, Xueqian Li, Jhony Kaesemodel Pontes, Simon Lucey — CMU · Argo AI — [arXiv:2111.01253](https://arxiv.org/abs/2111.01253), **NeurIPS 2021 (Spotlight)**
> 💻 **코드**: [github.com/Lilac-Lee/Neural_Scene_Flow_Prior](https://github.com/Lilac-Lee/Neural_Scene_Flow_Prior) · [프로젝트 페이지](https://lilac-lee.github.io/Neural_Scene_Flow_Prior/)
> 🔗 관련 정리: [Grad-PU]({{< ref "/posts/grad-pu" >}}) (반복 최적화로 점을 옮기는 같은 철학) · [Upsample Anything]({{< ref "/posts/upsample-anything" >}}) (2D 쪽의 test-time optimization) · [FlowCalib]({{< ref "/posts/flowcalib" >}}) (NSFP를 부품으로 쓰는 후속)

## 한 줄 요약

Scene flow — 연속 두 점군 \(P_k, P_{k+1}\) 사이의 점별 3D 모션 — 를 구하는 데 **학습된 네트워크를 쓰지 않는다.** 대신 프레임 쌍이 주어질 때마다 **무작위 초기화된 MLP를 그 쌍 위에서 직접 최적화**한다. MLP는 흐름을 예측하도록 "배운" 적이 없다. 좌표를 받아 흐름을 내놓는 매끄러운 함수라는 **구조적 성질 자체가 정규화**로 작동하고, 그것이 노이즈에 강하고 물리적으로 그럴듯한 흐름을 만든다.

> 이미지 쪽 Deep Image Prior가 "네트워크 구조가 곧 prior"임을 보였다면, NSFP는 그 발상을 **동적 3D 장면**으로 가져온 것이다.

## 배경 / 왜 읽었나

- **학습 기반 scene flow의 일반화 문제.** FlowNet3D·PointPWC-Net 등은 라벨된 합성 데이터(FlyingThings3D 등)로 학습하는데, 실측 LiDAR — 밀도·패턴·장면 분포가 전혀 다른 — 로 가면 성능이 무너진다. 자율주행에서 치명적인 약점.
- **고전 최적화의 정규화 설계 문제.** 프레임 쌍 위에서 직접 흐름을 최적화하는 고전 접근은 라벨이 필요 없지만, as-rigid-as-possible 같은 정규화 항을 손으로 설계해야 하고 장면마다 잘 맞지 않는다.
- **내 관심사와의 접점.** "t=k, t=k+1 두 프레임 정보만으로 최적화한다"는 문제 설정의 원형이라 읽었다. 업샘플링 쪽에서 본 test-time optimization 흐름([Upsample Anything]({{< ref "/posts/upsample-anything" >}}))의 3D scene flow 판이기도 하다.

## 핵심 아이디어

흐름을 벡터장 \(g_\theta: \mathbb{R}^3 \to \mathbb{R}^3\) 로 표현하되, \(g_\theta\)를 MLP로 둔다. 최적화 변수는 흐름 벡터가 아니라 **MLP의 가중치 \(\theta\)** 다.

$$
\theta^* \;=\; \arg\min_\theta \; \mathrm{CD}\!\left(P_k + g_\theta(P_k),\; P_{k+1}\right) \;+\; \lambda \,\mathcal{L}_{\text{cycle}}
$$

- **데이터 항**: 흐름으로 옮긴 \(P_k\)와 \(P_{k+1}\) 사이의 Chamfer Distance. 대응점 라벨이 필요 없다.
- **사이클 항**: 역방향 흐름을 담당하는 **두 번째 MLP** \(h_\phi\)를 함께 최적화해, \(P_k \to P_{k+1} \to P_k\) 왕복이 원위치로 돌아오도록 강제한다 (cycle consistency).
- **암시적 정규화**: 점별 자유 변수로 흐름을 최적화하면 Chamfer가 노이즈에 그대로 끌려가지만, MLP를 거치면 가까운 점들이 자연스럽게 비슷한 흐름을 갖는다 — 명시적 평활 항 없이 매끄러움이 생긴다.

```text
입력: P_k, P_{k+1}  (연속 두 점군, 라벨 없음)

1. g_θ, h_φ ← 무작위 초기화된 MLP 두 개
2. 반복:
   P̂ = P_k + g_θ(P_k)                 # forward warp
   L  = CD(P̂, P_{k+1})                # 데이터 항
      + CD(P̂ + h_φ(P̂), P_k)          # cycle 항
   θ, φ ← Adam 업데이트
3. 출력: flow = g_θ(P_k)
```

**연속 표현이라는 부산물**이 중요하다. \(g_\theta\)는 점이 아니라 공간 전체에서 정의된 함수라, 임의 좌표의 흐름을 질의할 수 있다. 논문은 이를 이용해 **여러 프레임의 흐름을 적분해 LiDAR 시퀀스를 하나로 누적(densification)** 하는 응용을 보인다 — 시간 정보를 이용한 점군 조밀화, 즉 업샘플링과 직접 맞닿는 지점이다.

## 결과

- KITTI Scene Flow · nuScenes · Argoverse에서 **지도학습 방법과 대등하거나 더 나은** 정확도(EPE 기준). 핵심은 절대 수치보다 **도메인을 옮겨도 성능이 유지된다**는 것 — 학습 데이터가 없으니 도메인 격차 자체가 없다.
- 자율주행 장면의 흐름 누적으로 조밀한 점군 복원 데모.

## 한계 / 이후 계보

- **느리다.** 프레임 쌍마다 최적화를 돌리므로 수십 초~분 단위. 실시간 인지에는 부적합.
- 이 병목이 후속 연구의 출발점이 됐다:
  - **Fast NSF / Fast Kernel Scene Flow** — 최적화 구조를 바꿔 가속.
  - **[ZeroFlow](https://arxiv.org/abs/2305.10424)** — NSFP를 교사로 삼아 라벨 없이 실시간 학생 네트워크를 증류.
  - **[Self-Supervised Multi-Frame NSF](https://arxiv.org/abs/2403.16116)** — 두 프레임을 넘어 k−1, k, k+1 세 프레임으로 확장.
  - **[FlowCalib]({{< ref "/posts/flowcalib" >}})** — NSFP의 흐름장을 캘리브레이션 오차 탐지의 입력으로 사용.

## 메모

- [Grad-PU]({{< ref "/posts/grad-pu" >}})의 "학습된 거리함수 위에서 점을 경사 하강으로 이동"과 구도가 평행하다. 차이: Grad-PU는 학습된 prior + 추론 시 최적화, NSFP는 **prior조차 학습하지 않고** 구조적 prior만 쓴다.
- 업샘플링 서베이에서 확인한 "3D 쪽 학습-불필요 베이스라인 공백"에 대한 부분적 답이 여기 있다 — NSFP의 흐름 누적 densification은 **시간 축을 이용한 무학습 업샘플링**으로 읽을 수 있다. 정적 단일 프레임 업샘플링과 결합하면 재미있는 방향.

---

## 부록: 수식 직관 가이드

**왜 MLP를 거치면 정규화가 되나?** 점별 자유 변수 최적화는 모래알 하나하나를 손으로 옮기는 것과 같다 — Chamfer가 시키는 대로 노이즈까지 따라간다. MLP는 좌표 공간 전체를 덮는 **탄성 시트**를 변형시키는 것과 같아서, 한 점을 옮기려면 주변 공간도 함께 휘어야 한다. 저주파(매끄러운) 변형이 고주파(노이즈) 변형보다 먼저, 쉽게 학습되는 신경망의 스펙트럼 편향이 이 "탄성"의 정체다.
