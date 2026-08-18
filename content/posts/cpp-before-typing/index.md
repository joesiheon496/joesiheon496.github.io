+++
title = "C++ 코드, 치기 전에 정하는 것들 — 구현보다 먼저 결정하는 7가지"
date = 2026-08-18T09:00:00+09:00
draft = false
tags = ["C++", "설계", "체크리스트"]
categories = ["프로그램"]
summary = "구현이 막히는 이유는 대부분 타이핑 실력이 아니라, 아직 내리지 않은 결정을 타이핑으로 때우려 하기 때문이다. 요구사항의 입출력 표부터 데이터 표현, 소유권, 에러 경로, 시그니처, 테스트까지 — 함수 본문을 채우기 전에 정해 두는 일곱 가지를 작은 파싱 함수 하나로 처음부터 끝까지 따라간다."
+++

## 한 줄 요약

> **결정이 끝나면 구현은 받아쓰기다.**
> 코드가 안 풀리는 순간의 대부분은 타이핑 문제가 아니라, 아직 내리지 않은 결정을 키보드 위에서 즉석으로 내리고 있는 순간이다. 결정을 먼저 하고, 마지막에 채워 넣는다.

## 왜 순서인가

함수를 짜다가 손이 멈추는 순간을 떠올려 보자. "실패하면 뭘 반환하지?" "이거 복사해도 되나?" "대문자 X도 받아야 하나?" — 전부 **구현의 질문이 아니라 설계의 질문**이다. 이 질문들을 타이핑 도중에 만나면 그 자리에서 임기응변으로 답하게 되고, 임기응변의 흔적은 코드 여기저기에 서로 모순되게 흩어진다. 어떤 분기는 -1을 반환하고 어떤 분기는 예외를 던지는 함수는 그렇게 태어난다.

그래서 나는 C++ 함수를 쓸 때 아래 순서로 결정을 먼저 소진시킨다. 관통 예제 하나로 처음부터 끝까지 가 보자 — 설정 문자열 `"1280x720"`을 해상도로 파싱하는, 어디에나 있을 법한 함수다.

## 1. 요구사항을 입출력 표로 번역한다

코드보다 먼저 **"이 입력이면 이 출력"의 표**를 만든다. 정상 케이스만이 아니라 경계와 실패를 채우는 것이 핵심이다.

| 입력 | 출력 | 메모 |
|---|---|---|
| `"1280x720"` | {1280, 720} | 정상 |
| `"1x1"` | {1, 1} | 경계: 최소 유효값 |
| `"0x720"` | 실패 | 0은 크기가 아니다 |
| `"-1280x720"` | 실패 | 음수 금지 |
| `"1280X720"` | 실패 | **대문자 X는? → 여기서 결정** |
| `" 1280x720"` | 실패 | **공백 제거는 호출자 책임 → 여기서 결정** |
| `"1280x720p"` | 실패 | 꼬리 문자 |

표를 채우다 보면 반드시 **답이 안 정해진 칸**을 만난다 — 대문자 X, 앞뒤 공백, `1920×1080`의 유니코드 곱셈 기호. 이 칸들이 이 단계의 수확이다. 구현 도중에 만나면 임기응변이 되지만, 표 위에서 만나면 **결정**이 된다. 애매하면 지금 물어보면 되고(스펙을 준 사람에게), 그 답은 표에 기록되어 남는다.

이걸 건너뛰면: 구현 도중 "어? 이 경우는?"이 터질 때마다 그 자리에서 if를 하나씩 덧대고, 한 달 뒤에는 어떤 입력이 왜 실패하는지 아무도 설명 못 하는 함수가 된다.

## 2. 데이터 표현을 정한다 — 타입이 설계의 절반

반환을 뭘로 할까. 손이 먼저 가는 건 `std::pair<int, int>`다.

```cpp
std::pair<int, int> parse(...);   // 나쁨: first가 너비인가 높이인가?
```

호출부마다 `.first`가 뭔지 기억해야 하고, 어느 날 누가 순서를 착각하면 화면이 세로로 돌아간다. 컴파일러는 침묵한다 — `pair<int,int>`에게 너비와 높이는 구분되지 않으니까. **이름 있는 타입 한 줄**이면 끝나는 일이다.

```cpp
struct Resolution {
    int width;
    int height;
};
```

이 단계에서 같이 정하는 것: 불변식(invariant)을 어디서 지킬 것인가. `Resolution`이 음수 크기를 절대 담을 수 없게 생성자에서 막을 수도 있고(불가능한 상태를 표현 불가능하게), 파싱 함수가 유효한 값만 만들도록 책임질 수도 있다. 이 예제는 작으니 후자로 정한다 — 정했다는 사실이 중요하다.

## 3. 소유권과 수명을 정한다 — 누가 만들고, 누가 들고, 누가 지우나

C++에서 값 하나가 지나가는 자리마다 이 질문이 따라온다. 함수 하나 수준에서는 세 가지로 압축된다.

- **입력**: 읽기만 한다 → **빌린다**. `std::string_view`(또는 `const T&`). 함수가 입력을 저장해 두고 나중에 쓸 게 아니라면 소유할 이유가 없다.
- **출력**: 작은 값이다 → **값으로 반환한다**. `Resolution`은 int 두 개, 복사 비용을 걱정할 크기가 아니다. out-파라미터(`bool parse(..., Resolution* out)`)는 초기화 안 된 변수를 먼저 만들게 강제하는 구식이다.
- **`unique_ptr`/`shared_ptr`는?** 이 함수엔 등장할 이유가 없다. 스마트 포인터는 "동적 수명"이라는 요구가 있을 때 꺼내는 도구지 기본값이 아니다 — **기본값은 값**이다.

이걸 건너뛰면: `const std::string&`으로 받았다가 호출자가 `char*`를 들고 있어서 임시 string이 생기고, out-파라미터로 뱉었다가 검사 안 된 미초기화 변수가 하류로 흘러간다.

## 4. 에러 경로를 정한다 — 실패는 설계 대상이다

`"abc"`가 들어오면 이 함수는 뭘 하나. 선택지는 셋이고, 기준은 **실패가 얼마나 정상적인 일인가**다.

- **`std::optional<T>`** — 실패가 정상 흐름의 일부일 때. 사용자가 설정 파일에 오타를 내는 건 예외적인 사건이 아니라 화요일이다. 이 예제의 답.
- **예외** — 실패가 호출부의 버그이거나, 여기서 계속할 방법이 없을 때. 파싱 실패는 둘 다 아니다.
- **에러 코드 + out-파라미터** — 실패의 '종류'를 구분해 줘야 할 때. "왜 실패했는지"까지 알려 줘야 한다면 `std::variant`나 (C++23이면) `std::expected`가 대안이다. 이 예제는 성공/실패 구분이면 충분하다.

하나 더 정할 것: **실패했을 때 무엇이 보장되는가.** 이 함수는 순수하므로 답이 공짜다 — 아무 부작용도 없었음이 보장된다. 부작용이 있는 함수라면 이 질문이 훨씬 무거워진다 (파일을 반쯤 옮기다 실패하면?). 실패 시 보장을 정하지 않은 함수는, 실패한 뒤의 세계가 어떤 상태인지 아무도 모르는 함수다.

## 5. 시그니처를 확정한다 — 계약을 먼저 쓰고 컴파일러를 문지기로

여기까지의 결정을 전부 시그니처 한 줄에 눌러 담는다. **본문은 아직 없다.**

```cpp
// 5단계: 시그니처가 계약이다
//  - string_view   : 빌려서 읽기만 한다        (3단계: 소유권)
//  - optional      : 실패가 정상 흐름의 일부다  (4단계: 에러 경로)
//  - [[nodiscard]] : 결과를 버리면 컴파일 경고
//  - noexcept      : from_chars는 던지지 않으므로 약속할 수 있다
[[nodiscard]] std::optional<Resolution> parseResolution(std::string_view s) noexcept;
```

이 한 줄은 문서이자 검문소다. `[[nodiscard]]`는 "파싱해 놓고 결과 안 쓰는" 호출부를 경고로 잡고, `noexcept`는 "이 함수는 던지지 않는다"를 문서가 아니라 **타입 시스템의 약속**으로 만든다 (안에서 던지면 그대로 terminate — 그래서 던지지 않는 구현을 쓸 수 있을 때만 붙인다). 반대로 말하면, 시그니처를 구현 다음에 쓰는 사람은 계약을 구현의 부산물로 얻는 것이고, 그 계약은 대개 우연이다.

## 6. 테스트를 먼저 쓴다 — 표가 있으니 공짜다

1단계를 제대로 했으면 이 단계는 번역 작업에 불과하다. 표의 행이 그대로 배열의 행이 된다 — [1강]({{< ref "/posts/cpp-design-1-pure-functions" >}})에서 스펙 표를 못 박던 그 방식이다.

```cpp
struct Case {
    std::string_view          input;
    std::optional<Resolution> want;
};

const Case kSpecTable[] = {
    { "1280x720",   Resolution{1280, 720}  },
    { "1x1",        Resolution{1, 1}       },   // 경계: 최소 유효값
    { "0x720",      std::nullopt           },   // 0은 크기가 아니다
    { "-1280x720",  std::nullopt           },   // 음수 금지
    { "1280X720",   std::nullopt           },   // 대문자 X → 표에서 '실패'로 결정
    { " 1280x720",  std::nullopt           },   // 공백 제거는 호출자 책임으로 결정
    { "1280x720p",  std::nullopt           },   // 꼬리 문자
    // ... (부록의 완결 파일에 전체 12행)
};
```

아직 구현이 없으니 이 테스트는 당연히 링크조차 안 된다. 그게 정상이다 — 지금 이 배열의 역할은 통과가 아니라, **7단계에서 구현이 끝나는 순간을 정의하는 것**이다. "다 됐다"의 기준이 감이 아니라 12개의 행이 된다.

## 7. 이제야 구현한다 — 받아쓰기

모든 결정이 끝난 뒤의 구현이 어떤 모습인지 보라.

```cpp
std::optional<Resolution> parseResolution(std::string_view s) noexcept {
    const char* first = s.data();
    const char* last  = s.data() + s.size();

    int w = 0;
    auto r1 = std::from_chars(first, last, w);
    if (r1.ec != std::errc{} || r1.ptr == last || *r1.ptr != 'x') return std::nullopt;

    int h = 0;
    auto r2 = std::from_chars(r1.ptr + 1, last, h);
    if (r2.ec != std::errc{} || r2.ptr != last) return std::nullopt;

    if (w <= 0 || h <= 0) return std::nullopt;
    return Resolution{w, h};
}
```

고민의 흔적이 없다. `std::from_chars`를 고른 것(로캘 무시, 예외 없음, 공백 안 건너뜀 — 표의 결정들과 정확히 일치한다), `r2.ptr != last`로 꼬리 문자를 거른 것, 마지막의 `w <= 0` — 전부 위 단계들에서 이미 내린 결정의 받아쓰기다. 구현 중에 새로 내린 결정은 없고, 그래서 이 함수는 한 번에 써진다.

마지막 동반자는 경고를 켠 컴파일러다. MSVC `/W4`, GCC/Clang `-Wall -Wextra` — 시그니처에 심어 둔 `[[nodiscard]]`와 (enum을 쓰는 코드라면) default 없는 switch는 경고가 켜져 있을 때만 문지기 노릇을 한다. 경고 0개는 결벽이 아니라, **진짜 경고가 나왔을 때 묻히지 않게 하는 바닥 소음 관리**다.

## 정리

| 순서 | 정하는 것 | 건너뛰면 |
|---|---|---|
| 1 | 입출력 표 (경계·실패 포함) | 결정이 임기응변이 되어 코드에 흩어진다 |
| 2 | 데이터 표현 (이름 있는 타입, 불변식의 위치) | `.first`가 너비인지 아무도 모른다 |
| 3 | 소유권 (입력은 빌리고, 출력은 값으로) | 불필요한 복사, 미초기화 out-파라미터 |
| 4 | 에러 경로 (optional/예외/코드 + 실패 시 보장) | 분기마다 다른 실패 방식이 공존한다 |
| 5 | 시그니처 (`[[nodiscard]]`, `noexcept`, const) | 계약이 구현의 부산물이 된다 |
| 6 | 테스트 (표 → 배열, 완료 기준) | "다 됐다"가 감이 된다 |
| 7 | 구현 (+ 경고 켠 컴파일러) | — 여기까지 왔으면 받아쓰기다 |

순서가 항상 이 일곱 단계를 전부 요구하는 건 아니다 — 세 줄짜리 헬퍼에 표까지 그리는 건 과잉이다. 하지만 손이 멈추는 함수, 리뷰에서 자꾸 얻어맞는 함수가 있다면 십중팔구 이 중 어느 단계를 키보드 위에서 때우고 있는 것이다. 함수가 아니라 기능 단위의 설계 순서가 궁금하다면 — 그건 [실무 설계 시리즈]({{< ref "/posts/cpp-design-1-pure-functions" >}})가 다루는 주제다. 특히 "새 기능이 기존과 달라지는 최초 지점 찾기"는 [2강]({{< ref "/posts/cpp-design-2-pipeline-reuse" >}})에.

## 부록: 통째로 컴파일되는 연습 파일

본문의 일곱 단계를 한 파일로 합친 것이다. MSVC에서 `cl /std:c++17 /W4 /EHsc /utf-8 before_typing.cpp`로 **경고 0개 컴파일·실행을 확인**했다 (표준 C++17만 썼으므로 GCC/Clang은 `g++ -std=c++17 -Wall -Wextra before_typing.cpp`).

```cpp
// before_typing.cpp — "치기 전에 정하는 것들" 연습용 완결 파일
#include <cassert>
#include <charconv>
#include <iostream>
#include <iterator>     // std::size
#include <optional>
#include <string_view>

// 2단계: 데이터 표현 — pair<int,int> 대신 이름 있는 타입
struct Resolution {
    int width;
    int height;
};

// 비교는 테스트에서 쓴다 (C++20이면 = default 한 줄)
constexpr bool operator==(Resolution a, Resolution b) {
    return a.width == b.width && a.height == b.height;
}

// 5단계: 시그니처가 계약이다
//  - string_view   : 빌려서 읽기만 한다        (3단계: 소유권)
//  - optional      : 실패가 정상 흐름의 일부다  (4단계: 에러 경로)
//  - [[nodiscard]] : 결과를 버리면 컴파일 경고
//  - noexcept      : from_chars는 던지지 않으므로 약속할 수 있다
[[nodiscard]] std::optional<Resolution> parseResolution(std::string_view s) noexcept;

// 6단계: 1단계의 입출력 표를 그대로 테스트로
struct Case {
    std::string_view          input;
    std::optional<Resolution> want;
};

const Case kSpecTable[] = {
    { "1280x720",   Resolution{1280, 720}  },
    { "1920x1080",  Resolution{1920, 1080} },
    { "1x1",        Resolution{1, 1}       },   // 경계: 최소 유효값
    { "0x720",      std::nullopt           },   // 0은 크기가 아니다
    { "-1280x720",  std::nullopt           },   // 음수 금지
    { "1280x",      std::nullopt           },   // 높이 없음
    { "x720",       std::nullopt           },   // 너비 없음
    { "1280",       std::nullopt           },   // 구분자 없음
    { "1280X720",   std::nullopt           },   // 대문자 X → 표에서 '실패'로 결정
    { " 1280x720",  std::nullopt           },   // 공백 제거는 호출자 책임으로 결정
    { "1280x720p",  std::nullopt           },   // 꼬리 문자
    { "",           std::nullopt           },
};

// 7단계: 구현은 마지막 — 위에서 내린 결정들을 채워 넣기만 한다
std::optional<Resolution> parseResolution(std::string_view s) noexcept {
    const char* first = s.data();
    const char* last  = s.data() + s.size();

    int w = 0;
    auto r1 = std::from_chars(first, last, w);
    if (r1.ec != std::errc{} || r1.ptr == last || *r1.ptr != 'x') return std::nullopt;

    int h = 0;
    auto r2 = std::from_chars(r1.ptr + 1, last, h);
    if (r2.ec != std::errc{} || r2.ptr != last) return std::nullopt;

    if (w <= 0 || h <= 0) return std::nullopt;
    return Resolution{w, h};
}

int main() {
    for (const Case& c : kSpecTable) {
        assert(parseResolution(c.input) == c.want);
    }
    std::cout << "spec tests: " << std::size(kSpecTable) << "/"
              << std::size(kSpecTable) << " passed\n";
    return 0;
}
```

실행 출력:

```text
spec tests: 12/12 passed
```

`"-1280x720"`이 실패하는 경로를 따라가 보면 이 구조의 재미가 보인다 — `from_chars`는 `-1280`을 **성공적으로** 파싱한다(음수는 유효한 int니까). 걸리는 곳은 마지막 줄 `w <= 0`이다. "파싱 성공"과 "유효한 해상도"는 다른 판정이고, 표를 먼저 만들었기 때문에 이 구분이 구현 전에 이미 결정되어 있었다.
