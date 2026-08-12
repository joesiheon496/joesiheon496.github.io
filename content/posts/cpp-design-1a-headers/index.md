+++
title = "C++ 실무 설계 1강 보강 : .h와 .cpp — 선언은 약속, 정의는 이행"
date = 2026-08-12T10:50:00+09:00
draft = false
tags = ["C++", "강의", "설계", "헤더", "링커"]
categories = ["프로그램"]
summary = "왜 맨날 .h와 .cpp로 나누는가. #include는 복사-붙여넣기일 뿐이고, 컴파일러는 .cpp 하나씩만 보고, 흩어진 조각을 잇는 건 링커다 — 이 모델이 잡히면 나누는 규칙은 전부 따라 나온다. 1강의 알림 예제를 4개 파일로 직접 나누고, 일부러 틀려서 LNK2019(이행 누락)와 LNK2005(중복 이행)를 만나본다. 에러 전문은 전부 실제로 재현한 것이다."
+++

> 🧭 **C++ 실무 설계 시리즈**의 보강편입니다. [1강]({{< ref "/posts/cpp-design-1-pure-functions" >}})의 완결 파일(`lec1_full.cpp`)을 재료로 쓰므로 1강을 먼저 읽는 게 좋습니다.
> 이 글의 컴파일 결과와 에러 메시지는 전부 MSVC(`/std:c++17 /W4`)로 실제 재현한 것입니다.

## 한 줄 요약

> **헤더(.h)는 약속, .cpp는 이행이다.** 컴파일러는 .cpp 하나를 컴파일할 때 약속(선언)만 있으면 되고,
> 이행(정의)이 실제로 어디 있는지는 **링커**가 나중에 찾는다. 약속만 있고 이행이 없으면 LNK2019,
> 이행이 두 번 있으면 LNK2005 — .h/.cpp 규칙은 전부 이 두 오류를 피하는 방법이다.

## 컴파일러는 한 번에 한 파일만 본다

.h/.cpp 분리가 헷갈리는 근본 이유는 **빌드가 2단계라는 걸 모르기 때문**이다.

```text
main.cpp            ──컴파일──▶  main.obj            ┐
message_window.cpp  ──컴파일──▶  message_window.obj  ┤──링크──▶ app.exe
                                                     ┘
```

1. **컴파일**: .cpp 파일 하나하나를 **서로 모르는 채로** 따로 기계어 조각(.obj)으로 만든다. 이 단위를 번역 단위(translation unit)라 부른다.
2. **링크**: .obj들을 모아서 "여기서 부른 `onMessageArrived`의 본문이 어느 조각에 있지?"를 찾아 잇는다.

그럼 `main.cpp`를 컴파일할 때 컴파일러는 `MessageWindow`가 뭔지 어떻게 아는가? 본문(정의)은 몰라도 된다. **생김새(선언)만 알면 호출 코드를 만들 수 있다.** 그 "생김새 목록"을 파일로 뽑아둔 것이 헤더고, `#include`는 그 내용을 **그 자리에 복사-붙여넣기**하는 것 이상도 이하도 아니다.

그래서 이렇게 나뉜다:

| | 역할 | 비유 |
|---|---|---|
| **선언** (declaration) | "이런 이름의 이런 함수가 **어딘가에** 있다" — `void write(const Message&);` | 계약서, 약속 |
| **정의** (definition) | 본문 그 자체 — `void Logger::write(...) { ... }` | 이행 |
| **.h** | 여러 .cpp가 공유할 약속 모음 | 게시된 계약서 |
| **.cpp** | 약속의 이행 + 그 파일만 아는 세부사항 | 실제 작업 |

지난 질문의 `::` 오류도 이 그림 안에 있다 — `void MessageWindow::onMessageArrived(...)`는 "클래스 밖에서 하는 이행"이라, 그 위에 약속(클래스 정의)이 먼저 보여야 한다. 보통 그 약속이 헤더에 살고, `#include`가 그걸 가져온다.

## 실습: 1강의 한 파일을 넷으로 나눈다

[1강 부록]({{< ref "/posts/cpp-design-1-pure-functions#부록-통째로-컴파일되는-연습-파일" >}})의 `lec1_full.cpp`를 나눈다. 나누는 기준은 단순하다 — **약속은 .h로, 이행은 .cpp로, 사용하는 쪽은 약속만 include.**

### ① notification_policy.h — 순수 판정 (통째로 헤더에)

```cpp
// notification_policy.h — 순수 판정. 선언과 정의가 모두 여기 있어도 되는 이유는 아래에.
#pragma once

enum class Urgency  { Normal, Critical };

enum class Disposal {
    PopupWithSound,   // 긴급 × 방해금지 OFF
    PopupMuted,       // 긴급 × 방해금지 ON
    BannerOnly,       // 일반 × 방해금지 OFF
    DigestLater,      // 일반 × 방해금지 ON
};

// constexpr 함수는 암묵적으로 inline → 여러 .cpp에 포함돼도 중복 정의가 아니다
[[nodiscard]] constexpr Disposal decideNotification(Urgency u, bool dndOn) {
    if (u == Urgency::Critical) {
        return dndOn ? Disposal::PopupMuted : Disposal::PopupWithSound;
    }
    return dndOn ? Disposal::DigestLater : Disposal::BannerOnly;
}
```

"본문은 .cpp로"라더니 왜 여기는 본문째 헤더인가? 두 가지가 겹쳐서다. 첫째, `constexpr` 함수는 **암묵적으로 `inline`**이라 여러 .cpp에 복사돼도 중복 정의가 아니다(inline의 진짜 의미가 "빨리"가 아니라 "중복 정의 허용"이다). 둘째, 컴파일 타임에 쓰려면(`static_assert`, `constexpr` 변수) 본문이 보여야 한다. — **순수 판정 영역은 헤더에 통째로 사는 게 자연스럽다.** 1강에서 "이 파일엔 include가 하나도 없다"고 했던 그 파일이 그대로 헤더가 된다.

`#pragma once`는 같은 헤더가 한 .cpp에 두 번 복사-붙여넣기되는 것(예: A.h와 B.h가 둘 다 이걸 include)을 막는 안전핀이다. 모든 헤더 첫 줄에 기계적으로 붙인다.

### ② message_window.h — 클래스의 생김새만

```cpp
// message_window.h — 클래스의 "생김새"(약속)만. 멤버 함수 본문은 .cpp로.
#pragma once
#include <queue>
#include "notification_policy.h"

struct Message {
    Urgency     urgency;
    const char* text;
};

struct Settings {
    bool dndOn = false;
};

class Logger {
public:
    void write(const Message& m);          // 선언만 — 본문은 .cpp
};

class MessageWindow {
public:
    explicit MessageWindow(Settings s) : settings_(s) {}
    void onMessageArrived(const Message& msg);   // 선언만

private:
    void playSound();                      // 선언만
    void showPopup(const Message& m);
    void showBanner(const Message& m);

    Settings            settings_;
    std::queue<Message> digest_;
    Logger              logger_;
};
```

멤버 함수가 전부 `;`로 끝나는 **선언**이 됐다. 예외가 생성자인데, 클래스 정의 **안에** 본문을 쓰면 암묵적으로 inline이라 헤더에 있어도 된다 — 한 줄짜리는 이렇게 두는 게 관례다.

### ③ message_window.cpp — 약속의 이행

```cpp
// message_window.cpp — 약속(헤더)의 이행. 부작용의 실제 구현이 사는 곳.
#include "message_window.h"
#include <iostream>

void Logger::write(const Message& m)          { std::cout << "[log] " << m.text << '\n'; }

void MessageWindow::playSound()               { std::cout << "[sound!]\n"; }
void MessageWindow::showPopup(const Message& m)  { std::cout << "[popup ] " << m.text << '\n'; }
void MessageWindow::showBanner(const Message& m) { std::cout << "[banner] " << m.text << '\n'; }

void MessageWindow::onMessageArrived(const Message& msg) {
    switch (decideNotification(msg.urgency, settings_.dndOn)) {
        case Disposal::PopupWithSound: playSound(); showPopup(msg); break;
        case Disposal::PopupMuted:     showPopup(msg);              break;
        case Disposal::BannerOnly:     showBanner(msg);             break;
        case Disposal::DigestLater:    digest_.push(msg);           break;
    }
    logger_.write(msg);
}
```

`<iostream>`이 **여기로 내려온 것**에 주목 — 헤더는 `std::cout`을 몰라도 된다. include를 .cpp로 내리면 이 헤더를 쓰는 모든 파일의 컴파일이 가벼워진다.

### ④ main.cpp — 약속만 보고 쓴다

```cpp
// main.cpp — 사용하는 쪽. 헤더(약속)만 보고 쓴다.
#include <cassert>
#include <iostream>
#include <iterator>
#include "message_window.h"

struct Case { Urgency u; bool dnd; Disposal want; };

constexpr Case kSpecTable[] = {
    { Urgency::Critical, false, Disposal::PopupWithSound },
    { Urgency::Critical, true,  Disposal::PopupMuted     },
    { Urgency::Normal,   false, Disposal::BannerOnly     },
    { Urgency::Normal,   true,  Disposal::DigestLater    },
};

static_assert(std::size(kSpecTable) == 4, "spec table must cover all 4 cells");

int main() {
    for (const Case& c : kSpecTable) {
        assert(decideNotification(c.u, c.dnd) == c.want);
    }
    std::cout << "policy tests: 4/4 passed\n\n";

    MessageWindow dndOn(Settings{true});
    dndOn.onMessageArrived({Urgency::Critical, "server down"});
    dndOn.onMessageArrived({Urgency::Normal,   "new comment"});
    return 0;
}
```

빌드는 **.cpp들만** 나열한다 (헤더는 include로 딸려 들어가므로 빌드 명령에 안 쓴다):

```text
cl /std:c++17 /W4 /EHsc /utf-8 main.cpp message_window.cpp /Fe:app.exe
(GCC/Clang: g++ -std=c++17 -Wall -Wextra main.cpp message_window.cpp -o app)
```

```text
policy tests: 4/4 passed

[popup ] server down
[log] server down
[log] new comment
```

`decideNotification`이 컴파일 타임 함수라서 `static_assert`와 테스트가 `main.cpp`에서 그대로 동작한다 — 판정의 약속과 이행이 한 몸(헤더)이기 때문이다.

## 일부러 틀려보기 — 이 두 에러가 개념의 전부다

규칙을 외우는 것보다 빠른 길: 규칙을 어기고 에러를 읽는다. 아래 에러 전문은 전부 실제 재현이다.

### 실험 1: 이행을 빼먹는다 → LNK2019

`message_window.cpp`를 빌드 명령에서 빼 본다: `cl ... main.cpp` 만.

```text
main.obj : error LNK2019: "public: void __cdecl MessageWindow::onMessageArrived(struct Message const &)"
           ... main 함수에서 참조되는 확인할 수 없는 외부 기호
fatal error LNK1120: 1개의 확인할 수 없는 외부 참조입니다.
```

컴파일은 **통과했다**는 게 핵심이다 — `main.cpp`는 약속(헤더)만 보고 호출 코드를 만들었고, 링커가 이행을 찾다가 실패했다. 에러 주어가 컴파일러(C로 시작)가 아니라 링커(LNK)인 것이 "빌드는 2단계"의 증거다. 실무에서 LNK2019를 만나면 반사적으로 물을 것: **"저 함수의 본문이 든 .cpp가 빌드 목록에 있나?"**

### 실험 2: 이행을 헤더에 쓴다 → LNK2005

`message_window.h` 끝에 본문 있는 함수를 하나 추가해 본다:

```cpp
void debugBeep() { }   // 헤더에 non-inline 정의
```

```text
message_window.obj : error LNK2005: "void __cdecl debugBeep(void)" 이(가)
                     main.obj에 이미 정의되어 있습니다.
fatal error LNK1169: 여러 번 정의된 기호가 있습니다.
```

`#include`가 복사-붙여넣기라는 것의 직접 증거다. 헤더가 `main.cpp`와 `message_window.cpp` 양쪽에 붙여넣어졌으니 이행이 두 개가 됐고, 링커가 "어느 쪽이 진짜냐"에서 멈춘다. `#pragma once`는 이걸 못 막는다 — 그건 "한 .cpp 안에서 두 번"을 막을 뿐, **서로 다른 .cpp 두 개**에 들어가는 건 정상 동작이다.

### 실험 3: inline을 붙인다 → 해소

```cpp
inline void debugBeep() { }   // inline이면 여러 .cpp에 포함돼도 중복 정의가 아니다
```

같은 빌드가 통과한다. `inline`의 현대적 의미는 최적화 힌트가 아니라 **"이 정의는 여러 번역 단위에 나타나도 된다(전부 같다고 약속함)"**이다. `constexpr` 함수와 클래스 정의 안의 멤버 본문이 헤더에 살 수 있는 것도 전부 암묵 inline이기 때문 — 예외처럼 보였던 것들이 사실 한 규칙이다.

## 규칙 요약

| .h에 두는 것 | .cpp에 두는 것 |
|---|---|
| `#pragma once` (첫 줄, 기계적으로) | 자기 헤더 `#include` (첫 include로) |
| enum·struct·class **정의** (생김새) | 멤버 함수 **본문** (`클래스이름::` 붙여서) |
| 함수 **선언** (`;`로 끝) | 자유 함수 본문 |
| `constexpr`/`inline` 함수 (본문째 OK) | 구현에만 필요한 `#include` (`<iostream>` 등) |
| 다른 .cpp도 봐야 하는 약속 전부 | 그 파일만 아는 세부 전부 |

실용적 보너스 — **재빌드 파급**. .cpp를 고치면 그 파일 하나만 다시 컴파일된다. 헤더를 고치면 그걸 include한 **모든** .cpp가 다시 컴파일된다. 본문을 .cpp에 두는 건 개념 정리인 동시에, 수정할 때마다 프로젝트 전체가 재컴파일되는 것을 막는 시간 절약이다.

## 연습 과제

1. [1강 부록]({{< ref "/posts/cpp-design-1-pure-functions#부록-통째로-컴파일되는-연습-파일" >}})의 `lec1_full.cpp`를 **이 글을 안 보고** 4개 파일로 나눠 빌드해 본다. 막히면 이 글과 대조.
2. 실험 1~3을 직접 재현한다 — LNK2019와 LNK2005를 **일부러 한 번씩** 만나 두면, 실전에서 만났을 때 30초 안에 원인을 짚게 된다.
3. `message_window.h`에서 `#include <queue>`를 지워 보고 에러를 관찰한다 — 같은 헤더 30행 에러(`'queue': 'std'의 멤버가 아닙니다`)가 **main.cpp를 컴파일할 때 한 번, message_window.cpp를 컴파일할 때 또 한 번**, .cpp마다 반복해서 찍힌다. 헤더는 번역 단위마다 새로 복사-붙여넣기된다는 세 번째 증거다.

**다음은 2강 "새 기능은 마지막 분기 하나로"** — 예고는 [1강]({{< ref "/posts/cpp-design-1-pure-functions" >}}) 끝에.
