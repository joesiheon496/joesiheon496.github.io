+++
title = "C++ 실무 설계 1강 : 판정을 I/O에서 떼어내라 — 순수 함수 추출과 테스트 고정"
date = 2026-08-12T08:50:00+09:00
draft = false
tags = ["C++", "강의", "설계", "테스트", "리팩토링"]
categories = ["프로그램"]
summary = "스펙은 2×2 표인데 코드는 UI 핸들러 속 if 덩어리다 — 이러면 표와 코드를 대조할 방법이 없다. 판정을 enum을 반환하는 순수 함수로 떼어내면 표의 칸 하나가 테스트 한 줄이 되고, '표는 4칸인데 enum은 3값'같은 결함이 시그니처만 봐도 드러난다. 실무 코드에서 겪은 문제를 도메인을 바꿔 재구성한 시리즈의 첫 강."
+++

> 🧭 **C++ 실무 설계 시리즈**: 실제 프로젝트에서 겪은 문제들을 도메인을 바꿔 재구성한 강의입니다.
> 코드는 전부 이 글 안에서 완결되고, 의존성 없이 컴파일됩니다 (C++17).

## 한 줄 요약

> **판정과 실행을 분리하라. 판정은 enum을 반환하는 순수 함수로, 실행은 그 enum을 소비하는 switch로.**
> 그러면 스펙 표의 칸 하나가 테스트 한 줄이 되고, 칸이 빠졌는지는 컴파일러가 세어 준다.

## 사고는 이렇게 난다

메시지 알림 기능을 만든다고 하자. 스펙은 회의에서 표 한 장으로 정해졌다.

| | 방해금지 OFF | 방해금지 ON |
|---|---|---|
| **긴급 메시지** | 소리 내며 팝업 | **무음으로 팝업** |
| **일반 메시지** | 배너만 표시 | 요약함에 보관 |

2×2, 네 칸. 명쾌하다. 그런데 이 표가 코드가 될 때 흔히 이렇게 된다.

```cpp
// MessageWindow.cpp — 나쁜 버전
void MessageWindow::onMessageArrived(const Message& msg) {
    if (msg.urgency == Urgency::Critical) {
        playSound();          // 팝업엔 소리가 따라온다고 "가정"
        showPopup(msg);
    } else {
        if (settings_.dndOn) {
            digest_.push(msg);
        } else {
            showBanner(msg);
        }
    }
    logger_.write(msg);       // 판정과 무관한 부작용까지 한 몸
}
```

버그가 보이는가? **긴급 × 방해금지 ON 칸이 없다.** 긴급이면 방해금지를 확인하지 않고 소리부터 낸다. 표의 네 칸 중 두 칸("소리 팝업"과 "무음 팝업")이 한 갈래로 뭉개졌고, 사용자는 새벽 3시에 소리를 듣게 된다.

더 나쁜 것은 **이 버그를 잡을 방법이 없다**는 점이다. 판정이 `MessageWindow` 안에 있으니 검증하려면 창을 띄우고, 설정 객체를 채우고, 로거를 모킹해야 한다. 그 비용 때문에 아무도 테스트를 안 쓰고, 표와 코드의 대조는 눈으로만 이루어진다. 눈은 뭉개진 분기를 잘 못 본다 — 코드가 자연스럽게 읽히기 때문이다.

## 패턴: 판정을 순수 함수로

순수 함수의 조건은 두 가지다. **같은 입력이면 항상 같은 출력**, 그리고 **부작용 없음**(파일·화면·전역 상태를 건드리지 않음). 판정 로직은 본질적으로 순수하다 — "긴급인가? 방해금지인가?"를 받아 "어떻게 처리할까"를 돌려줄 뿐이다. 불순한 것은 그 주변에 눌어붙은 I/O다. 그러니 떼어낸다.

먼저 표의 네 칸에 **이름**을 붙인다.

```cpp
// notification_policy.h — 이 파일에는 #include가 하나도 없다
enum class Urgency  { Normal, Critical };

enum class Disposal {
    PopupWithSound,   // 긴급 × 방해금지 OFF
    PopupMuted,       // 긴급 × 방해금지 ON   ← 나쁜 버전에서 사라졌던 칸
    BannerOnly,       // 일반 × 방해금지 OFF
    DigestLater,      // 일반 × 방해금지 ON
};

[[nodiscard]] constexpr Disposal decideNotification(Urgency u, bool dndOn) {
    if (u == Urgency::Critical) {
        return dndOn ? Disposal::PopupMuted : Disposal::PopupWithSound;
    }
    return dndOn ? Disposal::DigestLater : Disposal::BannerOnly;
}
```

세 가지에 주목하자.

1. **enum 값의 개수 = 표의 칸 수.** 이게 이 패턴의 심장이다. 표가 4칸이면 enum은 4값이어야 하고, 3값이면 어딘가 두 칸이 뭉개졌다는 뜻이다. 나쁜 버전의 버그가 여기서는 **enum 정의만 봐도** 드러난다 — 코드를 실행하기는커녕 함수 본문을 읽기도 전에.
2. `[[nodiscard]]` — 판정 결과를 버리면 컴파일 경고. 판정만 하고 실행을 잊는 실수를 막는다.
3. `constexpr` — 부작용이 없다는 주장의 증명이기도 하다. 부작용이 있으면 `constexpr`로 만들 수 없으니, 컴파일러가 순수성의 문지기가 된다.

실행은 그 enum을 **소비**하는 쪽의 일이다.

```cpp
// MessageWindow.cpp — 좋은 버전
void MessageWindow::onMessageArrived(const Message& msg) {
    switch (decideNotification(msg.urgency, settings_.dndOn)) {
        case Disposal::PopupWithSound: playSound(); showPopup(msg); break;
        case Disposal::PopupMuted:     showPopup(msg);              break;
        case Disposal::BannerOnly:     showBanner(msg);             break;
        case Disposal::DigestLater:    digest_.push(msg);           break;
        // default 없음 — 일부러다. 아래 참고.
    }
    logger_.write(msg);
}
```

`default:`를 **쓰지 않는 것**이 요령이다. 나중에 표에 칸이 늘어 enum에 다섯 번째 값이 추가되면, `-Wswitch`(GCC/Clang 기본 경고, MSVC는 `/W4`의 C4062)가 "처리 안 된 case가 있다"고 모든 소비처를 짚어 준다. `default:`를 써 두면 새 값이 조용히 default로 흘러들어 가고, 컴파일러는 입을 다문다.

## 테스트로 못 박기

이제 표를 **그대로** 테스트로 옮긴다. 프레임워크 없이 `assert`만으로 완결된다.

```cpp
// notification_policy_test.cpp
#include <cassert>
#include <iterator>   // std::size — <cstddef>가 아니다

struct Case { Urgency u; bool dnd; Disposal want; };

constexpr Case kSpecTable[] = {
    // 스펙 표를 행 단위로 옮긴다 — 주석까지 표와 같은 배치로
    { Urgency::Critical, false, Disposal::PopupWithSound },
    { Urgency::Critical, true,  Disposal::PopupMuted     },
    { Urgency::Normal,   false, Disposal::BannerOnly     },
    { Urgency::Normal,   true,  Disposal::DigestLater    },
};

// 표는 2×2 = 4칸. 케이스 수가 다르면 컴파일이 안 된다.
static_assert(std::size(kSpecTable) == 4, "spec table must cover all 4 cells");

int main() {
    for (const Case& c : kSpecTable) {
        assert(decideNotification(c.u, c.dnd) == c.want);
    }
    return 0;
}
```

이 테스트가 하는 일을 정확히 말하면 **고정(pinning)**이다. "지금 맞다"를 확인하는 게 아니라, **앞으로 누가 판정을 건드렸을 때 표와 달라지면 즉시 터지게** 못을 박아 두는 것. 입력이 enum과 bool뿐이라 전수 조사가 네 줄이고, 네 줄이니 아무도 테스트를 미루지 않는다.

`static_assert(std::size(kSpecTable) == 4)`는 사소해 보여도 값어치를 한다 — 나중에 표가 2×3으로 늘면 이 줄이 컴파일 에러로 "테스트도 늘려라"를 강제한다. 입력 조합의 수와 테스트 케이스 수를 묶어 두는 것이다. (실제 프로젝트에서는 `assert` 대신 Catch2나 GoogleTest를 쓰면 되고, 구조는 동일하다.)

## 이 패턴이 실제로 잡아낸 것

이 강의의 원형이 된 코드에서, 리뷰가 잡은 가장 심각한 결함이 정확히 이 모양이었다 — **스펙 표는 4칸인데 enum이 3값**. 두 칸이 하나의 처분으로 뭉개져 있었고, 판정이 순수 함수로 분리되어 있었기 때문에 리뷰어는 실행 경로를 추적할 필요 없이 **enum 정의와 표를 나란히 놓는 것만으로** 결함을 특정했다.

판정이 UI 핸들러에 인라인되어 있었다면 어땠을까. 리뷰어는 if의 중첩을 머릿속에서 시뮬레이션해야 하고, 그 시뮬레이션은 코드가 길수록 표가 아니라 **코드 쪽을 믿는 방향으로** 기운다. 분리는 테스트를 위한 것이기 이전에, **사람이 대조할 수 있는 형태**를 만드는 일이다.

## 어디까지 떼어내나

판정에 시간이나 설정값이 필요하면 어떻게 하나 — **읽지 말고 인자로 받는다.**

```cpp
// 나쁨: 함수가 스스로 시계를 본다 → 새벽 테스트를 못 짠다
Disposal decide(const Message& m) {
    bool night = currentHour() < 6;   // 숨은 입력
    ...
}

// 좋음: 시각은 호출자가 넣는다 → "새벽 3시"가 테스트 인자가 된다
Disposal decide(Urgency u, bool dndOn, int hourOfDay);
```

파일, 시계, 난수, 전역 설정 — 전부 같은 요령이다. 불순한 값의 **획득**은 호출자(경계)에 두고, 순수 함수는 값만 받는다. 그러면 "새벽 3시에 긴급 메시지"라는, 현실에서 재현하기 가장 고약한 상황이 테스트에서는 인자 세 개짜리 한 줄이 된다.

다만 **모든 것을 떼어내는 게 목표가 아니다.** 추출에도 비용과 위험이 있고, 특히 안전에 민감한 로직은 기계적인 리팩토링 작업에 끼워 넣지 않는 판단이 필요하다 — 이 얘기는 시리즈 마지막(에필로그)에서 따로 다룬다.

## 정리

| 원칙 | 이유 |
|---|---|
| 판정은 enum 반환 순수 함수, 실행은 소비처의 switch | 표↔코드 대조가 사람 눈으로 가능해진다 |
| enum 값 수 = 스펙 표의 칸 수 | 뭉개진 분기가 정의만 봐도 드러난다 |
| switch에 default 금지 (`-Wswitch`) | 칸이 늘 때 컴파일러가 소비처를 전부 짚어 준다 |
| 테스트는 표를 행 단위로 복사 + `static_assert`로 개수 고정 | "지금 맞다"가 아니라 "달라지면 터진다" |
| 숨은 입력(시계·설정·난수)은 인자로 | 재현 불가능한 상황이 함수 인자가 된다 |

**다음 강 예고 — 2강 "새 기능은 마지막 분기 하나로":** 다운로드 관리자에 "완료 후 보관함/임시폴더" 기능을 추가하는데, 새 파이프라인을 만들지 않고 종료 단계의 분기 하나로 끝내는 설계. 상류의 트리거·선택·분할 로직을 공짜로 상속받는 방법과, "판정이 사후에만 가능하다"는 제약이 오히려 설계를 정해 주는 이야기.
