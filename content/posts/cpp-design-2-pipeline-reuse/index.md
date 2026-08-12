+++
title = "C++ 실무 설계 2강 : 새 기능은 마지막 분기 하나로 — 파이프라인 재사용과 사후 판정"
date = 2026-08-13T09:00:00+09:00
draft = false
tags = ["C++", "강의", "설계", "파이프라인", "재사용"]
categories = ["프로그램"]
summary = "기능 추가 요청이 오면 새 파이프라인부터 만들고 싶어진다 — 복사해서 끝만 바꾸면 되니까. 하지만 분기에 필요한 정보가 '일이 끝난 뒤에만' 생기는 경우, 분기 지점은 파이프라인의 끝으로 강제되고, 그 앞의 모든 단계는 그대로 재사용된다. 제약이 설계를 정해 주는 이야기. 다운로드 관리자의 보관함/임시폴더 분기로 재구성했다."
+++

> 🧭 **C++ 실무 설계 시리즈**: 실제 프로젝트에서 겪은 문제들을 도메인을 바꿔 재구성한 강의입니다.
> 코드는 전부 이 글 안에서 완결되고, 의존성 없이 컴파일됩니다 (C++17).
> ← [1강: 판정을 I/O에서 떼어내라]({{< ref "/posts/cpp-design-1-pure-functions" >}})

## 한 줄 요약

> **새 기능을 붙일 때는 "기존 흐름과 달라지는 최초의 지점"을 먼저 찾아라.**
> 그 지점이 뒤에 있을수록 공짜로 얻는 코드가 많다. 판정 정보가 사후에만 생긴다면 분기 지점은 끝으로 강제된다 — 그건 제약이 아니라 선물이다.

## 사고는 이렇게 난다

다운로드 관리자가 이미 잘 돌아가고 있다고 하자. 대기열에서 요청을 꺼내고, 파일을 청크로 나눠 받고, 일시 오류면 재시도하고, 체크섬을 검증하고, 완료되면 보관함으로 옮긴다. 여기에 새 요구가 들어온다.

> "정체를 알 수 없는 파일은 보관함에 넣지 말고 **임시 폴더**에 두세요. 보관함이 어지러워져요."

그리고 조건이 하나 붙는다 — 판별은 확장자나 서버가 주는 Content-Type이 아니라 **실제 내용(매직 바이트)**으로 해야 한다. URL이 `/export?id=123`이면 확장자가 없고, Content-Type은 서버 설정이 틀리면 같이 틀리기 때문이다.

이 요구를 받은 손이 흔히 가는 곳이 여기다.

```cpp
// DownloadManager.cpp — 나쁜 버전 1: 파이프라인 복제
void DownloadManager::startDownload(const Request& req) {
    // 대기열 → 청크 분할 → 재시도 → 체크섬 → 보관함으로 이동   (40줄)
}

void DownloadManager::startTempDownload(const Request& req) {
    // 위 40줄을 복사해 붙이고, 마지막 이동 경로만 temp/로 바꿈   (40줄)
}
```

당장은 돌아간다. 사고는 **석 달 뒤에** 난다. 재시도 로직에 백오프를 넣는 개선이 `startDownload`에만 들어가고, 복사본은 아무도 기억하지 못한다. 이제 임시폴더행 다운로드만 유독 실패가 잦은데, 두 함수의 40줄을 나란히 놓고 diff를 뜨기 전까지는 **왜 한쪽만 그러는지 알 방법이 없다**. 복제된 파이프라인은 반드시 서로 멀어진다 — 갈라진 날이 아니라, 한쪽만 고쳐진 첫날부터.

두 번째 손은 좀 더 영리해 보인다.

```cpp
// 나쁜 버전 2: 시작 시점에 목적지를 '미리' 정해서 흘려보낸다
Destination guessFromUrl(const std::string& url) {
    if (endsWith(url, ".pdf")) return Destination::Archive;
    // ...
    return Destination::TempFolder;
}
```

이건 더 근본적인 문제가 있다. 요구사항이 "실제 내용으로 판별하라"인데, 내용은 **다운로드가 끝나야 존재한다**. 시작 시점에는 판정에 필요한 정보 자체가 없다. `guessFromUrl`은 판정을 억지로 앞당기려고 **판정의 근거를 더 나쁜 것(URL)으로 바꿔치기한 것**이고, 확장자 없는 URL과 거짓말하는 Content-Type에서 전부 틀린다.

## 패턴: 최초 분기 지점을 찾고, 그 앞은 손대지 않는다

질문을 바꾸자. "새 기능을 어디에 만들까"가 아니라 — **"새 기능이 기존 흐름과 달라지는 최초의 지점이 어디인가?"**

- 대기열에서 꺼낼 때? 아니다. 어떤 파일이든 똑같이 꺼낸다.
- 청크로 받을 때? 아니다. 목적지가 어디든 받는 방법은 같다.
- 재시도? 체크섬? 아니다. 전부 목적지와 무관하다.
- **다 받은 파일을 어디에 놓을 것인가?** — 여기다. 그리고 여기가 **가능한 유일한 지점**이기도 하다. 매직 바이트 판별은 바이트가 도착한 뒤에만 할 수 있으니까.

즉 판정이 사후에만 가능하다는 제약이 분기 지점을 파이프라인의 끝으로 **강제**한다. 이건 나쁜 소식이 아니다 — 설계 후보가 하나로 줄었다는 뜻이고, 끝에서 분기하면 그 앞의 대기열·청크·재시도·체크섬을 **한 줄도 안 고치고 상속받는다**는 뜻이다.

판정은 1강에서 한 그대로, enum을 반환하는 순수 함수로 만든다.

```cpp
enum class FileKind    { Document, Media, Unknown };
enum class Destination { Archive, TempFolder };

// 매직 바이트로 실제 종류를 판별한다 — 바이트가 도착한 뒤에만 가능하다 (= 사후 판정)
// rfind(p, 0) == 0 은 C++17식 starts_with (C++20의 starts_with와 같다)
[[nodiscard]] FileKind sniffKind(const std::string& bytes) {
    if (bytes.rfind("%PDF", 0) == 0) return FileKind::Document;
    if (bytes.rfind("RIFF", 0) == 0) return FileKind::Media;
    return FileKind::Unknown;
}

[[nodiscard]] constexpr Destination decideDestination(FileKind k) {
    switch (k) {
        case FileKind::Document: return Destination::Archive;
        case FileKind::Media:    return Destination::Archive;
        case FileKind::Unknown:  return Destination::TempFolder;
    }
    return Destination::TempFolder;   // 도달 불가 — C4715(모든 경로가 값을 반환하지 않음) 억제
}
```

그리고 파이프라인에서 **유일하게 달라지는 단계**가 이것이다.

```cpp
// 종료 단계: 이번 기능에서 '유일하게' 달라지는 부분
void deliver(const std::string& name, const std::string& bytes, Folders& out) {
    switch (decideDestination(sniffKind(bytes))) {
        case Destination::Archive:    out.archive[name] = bytes; break;
        case Destination::TempFolder: out.temp[name]    = bytes; break;
    }
}

// 파이프라인 전체 — deliver 한 줄 말고는 기능 추가 전과 동일하다
void download(const std::string& name, FakeServer& server, unsigned wantSum, Folders& out) {
    std::string bytes = fetchAll(server, 4);              // 청크 분할 + 재시도 (기존 그대로)
    assert(checksum(bytes) == wantSum && "checksum mismatch");
    deliver(name, bytes, out);                            // ← 여기 한 줄이 이번 기능의 전부
}
```

diff로 보면 이 기능의 전체 크기가 드러난다: 순수 함수 두 개 추가, `deliver`의 switch에 분기 하나. **상류는 diff에 등장하지 않는다.** 리뷰어가 검토할 범위도, 회귀가 숨을 수 있는 범위도 딱 그만큼이다.

## 테스트로 못 박기

판정이 `constexpr`이므로, 1강의 "표를 행 단위로 복사" 기법이 이번에는 **컴파일 타임**까지 내려간다.

```cpp
struct Rule { FileKind k; Destination want; };

constexpr Rule kRuleTable[] = {
    { FileKind::Document, Destination::Archive    },
    { FileKind::Media,    Destination::Archive    },
    { FileKind::Unknown,  Destination::TempFolder },
};

// FileKind는 3종 — 종류가 늘면 이 줄이 "표도 늘려라"를 강제한다
static_assert(std::size(kRuleTable) == 3, "rule table must cover every FileKind");

constexpr bool rulesHold() {
    for (const Rule& r : kRuleTable) {
        if (decideDestination(r.k) != r.want) return false;
    }
    return true;
}
// 판정이 constexpr이므로 테스트조차 컴파일 타임이다 — 틀리면 빌드가 안 된다
static_assert(rulesHold(), "destination rules changed — update table or code");
```

`main`을 실행하기도 전에, 규칙이 표와 다르면 **빌드가 실패한다**. `constexpr` 함수 안에서 for 루프를 돌 수 있는 건 C++14부터이고, 그 덕에 표 전체를 `static_assert` 하나로 고정할 수 있다.

끝에서 끝까지 테스트는 다른 것을 증명해야 한다 — **두 목적지가 같은 상류를 지난다**는 것.

```cpp
FakeServer pdfSrv{ "%PDF-1.7 fake report body", 3 };   // 3번째 요청마다 일시 오류
download("report.pdf", pdfSrv, checksum(pdfSrv.payload), folders);

FakeServer binSrv{ "no magic, just bytes", 4 };        // 4번째 요청마다 일시 오류
download("data.bin", binSrv, checksum(binSrv.payload), folders);

assert(folders.archive.count("report.pdf") == 1);      // 문서 → 보관함
assert(folders.temp.count("data.bin") == 1);           // 정체불명 → 임시 폴더
// 재시도를 거치고도 내용은 무결하다 — 상류 로직이 두 경로에 똑같이 일했다는 증거
assert(folders.archive.at("report.pdf") == pdfSrv.payload);
assert(folders.temp.at("data.bin") == binSrv.payload);
```

두 서버 모두 일부러 일시 오류를 내게 해 두었다. 보관함행도 임시폴더행도 같은 재시도 코드를 지나므로, **둘 다** 오류를 이겨내고 완주한다. 나쁜 버전 1(파이프라인 복제)이었다면 이 성질은 테스트로 보장할 수 없다 — 코드가 두 벌이면 "한쪽에서 통과한 테스트"가 다른 쪽에 대해 아무것도 말해 주지 않기 때문이다.

## 함정: 분기를 상류로 끌어올리고 싶은 유혹

이 패턴이 무너지는 경로는 대개 셋이다.

**1. "미리 알면 좋잖아" — 선판정의 유혹.** UI에 "이 파일은 임시폴더로 갈 예정"이라고 미리 표시하고 싶다는 요구가 나중에 온다. 그때 판정을 앞당기면 안 된다 — 사후 정보는 앞당길 수 없고, 앞당긴 순간 판정 근거가 URL 추측으로 바뀌면서 나쁜 버전 2로 퇴화한다. 미리 보여주고 싶다면 그것은 '추측을 표시하는' **별개의 기능**이고, 확정 판정은 여전히 끝에서 한다. 추측과 판정을 같은 함수로 만들면 안 된다.

**2. 플래그 꿰기.** 목적지를 `fetchAll`, `checksum`을 비롯한 모든 단계에 인자로 꿰어 넣는 설계. 중간 단계가 목적지를 **몰라도 된다**는 사실이 재사용의 근거인데, 시그니처에 꿰는 순간 그 근거를 스스로 파괴한다. 이제 모든 단계가 "목적지가 늘면" 같이 고쳐야 할 후보가 된다. 관심사가 끝 단계에만 있다면 끝 단계에만 존재하게 하라.

**3. `deliver`를 파이프라인 밖으로.** "호출자가 알아서 옮기게" 하면 유연해 보이지만, 호출자가 다섯 군데가 되는 순간 그중 하나는 분기를 빼먹는다. 분기는 파이프라인의 **마지막 단계로서 안에** 있어야 한다. 밖에 있는 규칙은 규칙이 아니라 관례이고, 관례는 새 호출자에게 전파되지 않는다.

그리고 목적지가 세 개로 늘어나는 날 — `Destination`에 값을 추가하면, 1강에서 본 그대로 `default` 없는 switch가 `-Wswitch`(MSVC는 `/W4`의 C4062)로 모든 소비처를 짚어 준다. 판정을 enum 반환 순수 함수로 만들어 둔 것이 여기서 한 번 더 값을 한다.

## 정리

| 원칙 | 이유 |
|---|---|
| "어디에 만들까" 대신 "기존과 달라지는 최초 지점이 어디인가" | 그 지점 앞의 코드를 전부 공짜로 상속받는다 |
| 판정 정보가 사후에만 생기면 분기는 끝으로 강제된다 | 설계 후보가 하나로 줄어든다 — 제약이 설계를 정해 준다 |
| 파이프라인 복제 금지 | 복사본은 한쪽만 고쳐진 첫날부터 멀어진다 |
| 플래그를 중간 단계에 꿰지 않는다 | 중간 단계의 '무지'가 재사용의 근거다 |
| 분기(deliver)는 파이프라인의 마지막 단계로서 안에 | 밖의 관례는 새 호출자에게 전파되지 않는다 |
| constexpr 판정 + `static_assert` 표 | 규칙이 표와 다르면 실행 전에 빌드가 실패한다 |

**다음 강 예고 — 3강 "자원을 나눠 쓰는 두 소비자는 예산도 나눠라":** 로그 로테이터 하나는 700GB 파티션을, 또 하나는 100GB 파티션을 관리한다. 같은 cleaner 클래스를 인스턴스 두 개로 나눠 예산을 격리하는 설계 — 그리고 "디스크 남은 공간 하한"을 각자 독립적으로 계산하면 왜 필요량의 두 배를 지우게 되는지, 무심코 공유한 뮤텍스가 어떻게 두 파티션의 청소를 조용히 직렬화하는지.

## 부록: 통째로 컴파일되는 연습 파일

본문 스니펫들을 한 파일로 합친 것이다. MSVC에서 `cl /std:c++17 /W4 /EHsc /utf-8 lec2_full.cpp`로 **경고 0개 컴파일·실행을 확인**했다 (표준 C++17만 썼으므로 GCC/Clang은 `g++ -std=c++17 -Wall -Wextra lec2_full.cpp`).

```cpp
// lec2_full.cpp — 2강 연습용 완결 파일 (이 파일 하나로 컴파일된다)
#include <cassert>
#include <iostream>
#include <iterator>   // std::size
#include <map>
#include <string>

// ---------- 판정 (순수 영역) ----------
enum class FileKind    { Document, Media, Unknown };
enum class Destination { Archive, TempFolder };

// 매직 바이트로 실제 종류를 판별한다 — 바이트가 도착한 뒤에만 가능하다 (= 사후 판정)
// rfind(p, 0) == 0 은 C++17식 starts_with (C++20의 starts_with와 같다)
[[nodiscard]] FileKind sniffKind(const std::string& bytes) {
    if (bytes.rfind("%PDF", 0) == 0) return FileKind::Document;
    if (bytes.rfind("RIFF", 0) == 0) return FileKind::Media;
    return FileKind::Unknown;
}

[[nodiscard]] constexpr Destination decideDestination(FileKind k) {
    switch (k) {
        case FileKind::Document: return Destination::Archive;
        case FileKind::Media:    return Destination::Archive;
        case FileKind::Unknown:  return Destination::TempFolder;
    }
    return Destination::TempFolder;   // 도달 불가 — C4715(모든 경로가 값을 반환하지 않음) 억제
}

// ---------- 기존 파이프라인 (이번 강에서 '건드리지 않는' 부분) ----------
// 실제라면 소켓·파일이지만, 연습에서는 흉내로 대체한다.
struct FakeServer {
    std::string payload;        // 서버가 가진 파일 내용
    int         failEvery = 0;  // n번째 요청마다 한 번 일시 오류 (0 = 항상 성공)
    int         calls     = 0;

    bool fetchChunk(std::size_t offset, std::size_t n, std::string& out) {
        ++calls;
        if (failEvery > 0 && calls % failEvery == 0) return false;   // 일시 오류
        out = payload.substr(offset, n);   // offset == size()면 "" — 마지막 청크 신호
        return true;
    }
};

// 청크 분할 + 재시도 — 새 기능이 '공짜로 상속받는' 상류 로직
[[nodiscard]] std::string fetchAll(FakeServer& server, std::size_t chunkSize) {
    std::string bytes;
    for (;;) {
        std::string part;
        int tries = 0;
        while (!server.fetchChunk(bytes.size(), chunkSize, part)) {
            ++tries;
            assert(tries < 3 && "gave up after 3 retries");
        }
        bytes += part;
        if (part.size() < chunkSize) break;   // 마지막 청크
    }
    return bytes;
}

[[nodiscard]] unsigned checksum(const std::string& bytes) {
    unsigned sum = 0;
    for (unsigned char c : bytes) sum = sum * 131 + c;
    return sum;
}

// 파일시스템 흉내: 폴더 → (파일명 → 내용)
struct Folders {
    std::map<std::string, std::string> archive;   // 보관함
    std::map<std::string, std::string> temp;      // 임시 폴더
};

// ---------- 종료 단계: 이번 강에서 '유일하게' 달라지는 부분 ----------
void deliver(const std::string& name, const std::string& bytes, Folders& out) {
    switch (decideDestination(sniffKind(bytes))) {
        case Destination::Archive:
            out.archive[name] = bytes;
            std::cout << "[deliver] " << name << " -> archive/\n";
            break;
        case Destination::TempFolder:
            out.temp[name] = bytes;
            std::cout << "[deliver] " << name << " -> temp/\n";
            break;
    }
}

// 파이프라인 전체 — deliver 한 줄 말고는 기능 추가 전과 동일하다
void download(const std::string& name, FakeServer& server, unsigned wantSum, Folders& out) {
    std::string bytes = fetchAll(server, 4);              // 4바이트 청크 (연습용)
    assert(checksum(bytes) == wantSum && "checksum mismatch");
    deliver(name, bytes, out);
}

// ---------- 테스트 1: 목적지 규칙을 컴파일 타임에 고정 ----------
struct Rule { FileKind k; Destination want; };

constexpr Rule kRuleTable[] = {
    { FileKind::Document, Destination::Archive    },
    { FileKind::Media,    Destination::Archive    },
    { FileKind::Unknown,  Destination::TempFolder },
};

// FileKind는 3종 — 종류가 늘면 이 줄이 "표도 늘려라"를 강제한다
static_assert(std::size(kRuleTable) == 3, "rule table must cover every FileKind");

constexpr bool rulesHold() {
    for (const Rule& r : kRuleTable) {
        if (decideDestination(r.k) != r.want) return false;
    }
    return true;
}
// 판정이 constexpr이므로 테스트조차 컴파일 타임이다 — 틀리면 빌드가 안 된다
static_assert(rulesHold(), "destination rules changed — update table or code");

int main() {
    // ---------- 테스트 2: 스니핑 (내용 기반 판별) ----------
    assert(sniffKind("%PDF-1.7 anything") == FileKind::Document);
    assert(sniffKind("RIFF....WAVEfmt ")  == FileKind::Media);
    assert(sniffKind("no magic here")     == FileKind::Unknown);
    std::cout << "sniff tests: 3/3 passed\n";

    // ---------- 테스트 3: 끝에서 끝까지 — 두 목적지가 같은 상류를 지난다 ----------
    Folders folders;

    FakeServer pdfSrv{ "%PDF-1.7 fake report body", 3 };   // 3번째 요청마다 일시 오류
    download("report.pdf", pdfSrv, checksum(pdfSrv.payload), folders);

    FakeServer binSrv{ "no magic, just bytes", 4 };        // 4번째 요청마다 일시 오류
    download("data.bin", binSrv, checksum(binSrv.payload), folders);

    assert(folders.archive.count("report.pdf") == 1);
    assert(folders.temp.count("data.bin") == 1);
    // 재시도를 거치고도 내용은 무결하다 — 상류 로직이 두 경로에 똑같이 일했다는 증거
    assert(folders.archive.at("report.pdf") == pdfSrv.payload);
    assert(folders.temp.at("data.bin") == binSrv.payload);

    std::cout << "e2e tests: passed\n";
    std::cout << "server requests: pdf=" << pdfSrv.calls
              << ", bin=" << binSrv.calls << " (retries included)\n";
    return 0;
}
```

실행 출력:

```text
sniff tests: 3/3 passed
[deliver] report.pdf -> archive/
[deliver] data.bin -> temp/
e2e tests: passed
server requests: pdf=10, bin=7 (retries included)
```

마지막 줄을 보라 — PDF는 25바이트를 4바이트 청크로 받으니 성공 요청이 7번인데 총 요청은 10번이다. 3번째 요청마다 일시 오류가 났고 재시도가 그걸 전부 흡수했다. 임시폴더행(`data.bin`)도 마찬가지로 오류(7번 중 1번)를 겪고 완주했다 — **같은 재시도 코드가 두 목적지에 똑같이 일한 것**이고, 이 성질은 파이프라인이 한 벌일 때만 공짜다.
