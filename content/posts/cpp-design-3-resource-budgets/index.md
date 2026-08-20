+++
title = "C++ 실무 설계 3강 : 나눠 쓰는 자원에는 예산을 — 전역 하한이 부른 2배 삭제"
date = 2026-08-20T15:00:00+09:00
draft = false
tags = ["C++", "강의", "설계", "자원관리", "동시성"]
categories = ["프로그램"]
summary = "디스크를 나눠 쓰는 클리너 두 개가 '남은 공간이 하한 미만이면 지운다'를 각자 계산하면, 같은 부족분을 둘 다 자기 몫으로 알고 필요량의 두 배를 지운다. 삭제는 되돌릴 수 없다. 공유 관측값 대신 각자의 소유 예산을 기준으로 바꾸면 중복은 원리적으로 불가능해지고, 하한은 지키는 것이 아니라 예산 계약이 만들어 주는 것이 된다. 싱글턴+공유 뮤텍스라는 미봉책이 왜 더 나쁜지도 함께."
+++

> 🧭 **C++ 실무 설계 시리즈**: 실제 프로젝트에서 겪은 문제들을 도메인을 바꿔 재구성한 강의입니다.
> 코드는 전부 이 글 안에서 완결되고, 의존성 없이 컴파일됩니다 (C++17).
> ← [2강: 새 기능은 마지막 분기 하나로]({{< ref "/posts/cpp-design-2-pipeline-reuse" >}})

## 한 줄 요약

> **여럿이 나눠 쓰는 자원은 '남은 양'(공유 관측값)이 아니라 '각자의 예산'(소유값)으로 관리하라.**
> 공유 관측값으로 각자 행동하면 행동이 중복되고, 소유 예산으로 행동하면 중복이 원리적으로 불가능하다. 그리고 격리의 단위는 클래스가 아니라 **인스턴스**다.

## 사고는 이렇게 난다

서버의 100GB 시스템 파티션에 로그가 두 군데서 쌓인다 — 세션 로그(`session_*`)와 서비스 로그(`service_*`). 디스크가 차면 장애이므로, 각 로그군마다 오래된 파일부터 지우는 클리너를 만든다. 요구사항은 자연스럽게 이렇게 적힌다: **"남은 공간이 10GB 미만이 되면 오래된 로그를 지워서 10GB를 확보할 것."**

그리고 그 문장을 그대로 코드로 옮긴다.

```cpp
// SessionLogCleaner — 나쁜 버전
void SessionLogCleaner::run() {
    uint64_t free = disk.freeBytes();          // '남은 공간'을 본다
    if (free < kMinFree) {
        deleteOldest(kMinFree - free);         // 부족분 전체를 내가 메운다
    }
}

// ServiceLogCleaner::run() — 같은 로직의 복사본이 하나 더 돈다
```

각각 따로 보면 흠잡을 데 없다. 사고는 **스케줄러가 두 클리너를 같은 시각에 깨우는 날** 난다. 남은 공간 5GB, 하한 10GB — 부족분은 5GB다. 세션 클리너도 `free = 5`를 읽고 "5GB는 내 몫"이라 판단하고, 서비스 클리너도 같은 스냅샷에서 같은 판단을 한다. 결과: **10GB 삭제. 필요량의 정확히 2배.**

이 사고의 고약한 점이 세 가지다.

1. **삭제는 되돌릴 수 없다.** 2배 삭제는 곧 "로그 보존 기간이 절반"이라는 뜻이고, 보존 의무가 있는 로그라면 그 자체로 사고다.
2. **거의 항상은 멀쩡하다.** 두 클리너의 기상 시각이 어긋나면 늦게 깬 쪽이 갱신된 `free`를 보고 조용히 물러난다. 재현이 안 되는 채로 몇 달에 한 번, 로그가 이상하게 짧게 남는다.
3. **코드 리뷰로 못 잡는다.** 각 클리너는 단독으로는 옳다. 결함은 어느 파일에도 없고, **"같은 관측값을 보는 행위자가 둘"이라는 배치**에 있다.

원인을 한 문장으로 줄이면: `freeBytes()`는 **모두의 것이라서 누구의 것도 아닌 값**이다. 그 값에서 도출한 "부족분"을 각자 자기 책임으로 오해했다.

## 미봉책: 싱글턴 + 공유 뮤텍스 — 더 나빠진다

"동시에 돌아서 문제라면 못 돌게 하자"가 다음 손이다. 클리너를 싱글턴으로 합치거나, 전역 뮤텍스로 `run()`을 직렬화한다. 2배 삭제는 사라진다 — 그리고 새 사고가 예약된다.

이 서버에는 700GB 데이터 파티션도 있고, 거기도 같은 클리너가 돈다. 전역 뮤텍스는 이제 **물리적으로 독립인 두 디스크를 코드로 묶는다**: 700GB 파티션의 대청소(수만 파일, 몇 분)가 락을 쥐고 있는 동안, 100GB 시스템 파티션의 "지금 당장 1GB" 긴급 확보가 줄을 서서 기다린다. 디스크는 한가한데 로그는 쌓이고, 최악의 타이밍에 파티션이 찬다.

락이 틀렸던 게 아니라 **락의 범위**가 틀렸다. 보호할 자원이 둘(두 파티션, 두 로그군의 상태)이면 락도 둘이어야 한다. 그리고 그 답은 뮤텍스를 두 개 선언하는 게 아니라, 다음 절이다.

## 패턴: 예산을 나누고, 인스턴스로 격리한다

발상을 뒤집는다. "남은 공간을 감시하다 지키자"가 아니라 — **파티션을 미리 나눠 갖는다.**

```cpp
// 예산은 파티션을 남김없이 분할해야 한다 (기동 전 계약)
constexpr std::uint64_t kCapacityGB      = 100;
constexpr std::uint64_t kSessionBudgetGB = 55;
constexpr std::uint64_t kServiceBudgetGB = 35;
constexpr std::uint64_t kReserveGB       = 10;   // 아무도 못 쓰는 안전 여유

static_assert(kSessionBudgetGB + kServiceBudgetGB + kReserveGB == kCapacityGB,
              "budgets + reserve must partition the disk exactly");
```

이 `static_assert` 한 줄이 요구사항의 "하한 10GB"를 다른 방식으로 달성한다: 세션이 예산 55GB를 넘지 않고 서비스가 35GB를 넘지 않으면, 남은 공간은 **수학적으로** 10GB 이상이다. 하한은 각자가 눈치껏 '지키는' 것이 아니라 예산 계약이 **만들어 주는** 것이 된다.

판정은 [1강]({{< ref "/posts/cpp-design-1-pure-functions" >}}) 그대로 순수 함수다 — 그리고 시그니처를 보라. **남의 사정이 아예 입력에 없다.**

```cpp
// 내 사용량과 내 예산만 본다 — freeBytes()는 입력조차 아니다
[[nodiscard]] constexpr std::uint64_t gbOverBudget(std::uint64_t used, std::uint64_t budget) {
    return used > budget ? used - budget : 0;
}
static_assert(gbOverBudget(60, 55) == 5);
static_assert(gbOverBudget(35, 35) == 0);
```

클리너는 예산을 생성자로 주입받는 **보통 클래스**로, 로그군마다 인스턴스 하나씩이다.

```cpp
class LogCleaner {
public:
    LogCleaner(std::string prefix, std::uint64_t budgetGB)
        : prefix_(std::move(prefix)), budgetGB_(budgetGB) {}

    // 계획: 내 사용량이 내 예산을 넘은 만큼만
    [[nodiscard]] std::uint64_t plan(const Partition& p) const {
        return gbOverBudget(usedBy(p, prefix_), budgetGB_);
    }
    std::uint64_t run(Partition& p) { return deleteOldest(p, prefix_, plan(p)); }

private:
    std::string   prefix_;
    std::uint64_t budgetGB_;
    // std::mutex m_;   // 실물에서 상태를 보호한다면 락도 여기 — 인스턴스마다 하나
};
```

주석 한 줄에 뮤텍스 함정의 해답이 들어 있다. 락이 **멤버**면 인스턴스마다 하나씩 생기고, 700GB 파티션의 클리너와 100GB 파티션의 클리너는 서로의 존재조차 모른다. 싱글턴을 안 만들었을 뿐인데 직렬화 문제가 소멸했다 — **격리의 단위는 클래스가 아니라 인스턴스**라는 게 이런 뜻이다. 파티션이 하나 더 늘면? 인스턴스를 하나 더 만들면 된다. 코드는 한 줄도 안 바뀐다.

## 테스트로 못 박기

이 사고는 타이밍 문제라 "스레드 두 개 돌려서 재현"은 테스트로서 최악이다(간헐 실패). 대신 경쟁의 **본질만** 남긴다: 경쟁이란 결국 "둘 다 낡은 스냅샷으로 계획했다"는 것이므로, 계획과 실행을 두 단계로 갈라 단일 스레드로 결정론적으로 재현한다.

```cpp
// --- 나쁜 버전: 2배 삭제를 '재현'한다 ---
Partition p = makeSystemPartition();          // used 95, free 5, 하한 10
std::uint64_t planSession = planByGlobalFloor(p, 10);   // 같은 스냅샷으로
std::uint64_t planService = planByGlobalFloor(p, 10);   // 각자 계획
assert(planSession == 5 && planService == 5);           // 둘 다 "부족 5는 내 몫"

std::uint64_t freed = deleteOldest(p, "session_", planSession)
                    + deleteOldest(p, "service_", planService);
assert(freed == 10);                                    // 필요량 5의 정확히 2배
```

나쁜 버전을 테스트로 **고정해 두는 것**이 요점이다 — "이 배치는 이렇게 사고 난다"가 실행 가능한 문서로 남고, 누가 예산 방식을 전역 하한으로 '단순화'하러 왔을 때 이 assert가 이유를 설명해 준다.

좋은 버전은 **같은 동시 스케줄**(계획 둘 먼저, 실행 둘 나중)을 그대로 돌린다.

```cpp
LogCleaner session("session_", kSessionBudgetGB);
LogCleaner service("service_", kServiceBudgetGB);

std::uint64_t planSes = session.plan(p);   // 사용량 60 vs 내 예산 55 → 5
std::uint64_t planSvc = service.plan(p);   // 사용량 35 vs 내 예산 35 → 0
assert(planSes == 5 && planSvc == 0);      // 겹칠 값 자체를 보지 않는다

std::uint64_t freed = session.run(p) + service.run(p);
assert(freed == 5);                        // 정확히 필요량만
assert(p.freeGB() == kReserveGB);          // 하한 10GB는 계약이 만들어 준 결과
```

나쁜 버전과 좋은 버전의 차이가 "운 좋게 안 겹침"이 아니라는 데 주목하라. 좋은 버전은 **같은 낡은 스냅샷으로 계획해도 안전하다** — 두 계획의 입력이 애초에 겹치지 않기(각자 자기 파일 사용량만 보기) 때문이다. 경쟁 조건을 타이밍으로 피한 게 아니라 **자료 의존성 수준에서 제거**한 것이고, 그래서 단일 스레드 테스트로 증명이 끝난다.

## 함정: 이 패턴이 무너지는 경로

**1. 예산 합이 용량을 넘게 잡기.** 예산제의 전제는 `Σ예산 + 여유 = 용량`이다. 운영 중에 "세션 예산만 10GB 늘려 주세요"가 들어와 합이 105GB가 되는 순간 계약은 조용히 거짓말이 된다. 위처럼 상수라면 `static_assert`가 막아 주지만, 예산이 설정 파일에서 오면 컴파일러는 못 본다 — **기동 시점에 합을 검증하고 어긋나면 크게 실패**해야 한다. (조용히 봐주는 것이 왜 최악인지는 7강 "부팅 가드"에서 따로 다룬다.)

**2. '남은 공간' 폴백을 몰래 되살리기.** 몇 달 뒤 누군가 "예산은 안 넘었는데 디스크가 찼어요"(제3의 프로그램이 파티션에 뭔가를 쓴 것이다)를 겪고, 클리너에 `if (p.freeGB() < 10) 더 지움` 한 줄을 덧붙인다 — 전역 하한이 부활했고, 클리너가 둘이니 2배 삭제도 부활했다. 제3의 침입자 문제의 옳은 답은 침입자를 **모니터링으로 잡는 것**이지, 남의 초과분을 내 로그 삭제로 메워 주는 게 아니다.

**3. "어차피 한 클래스니까" 하고 상태를 static으로.** 캐시든 통계든 뮤텍스든, 멤버를 `static`으로 올리는 순간 인스턴스 격리가 그 변수 하나로 무너진다. 이 패턴에서 `static` 멤버는 곧 "모든 파티션이 공유"라는 선언이다 — 정말 그 의미인지 세 번 확인할 것.

## 정리

| 원칙 | 이유 |
|---|---|
| 공유 관측값(남은 양)으로 각자 판단 금지 | 같은 부족분을 전원이 자기 몫으로 오해한다 |
| 자원은 예산으로 미리 분할, 각자 소유값만 본다 | 계획의 입력이 겹치지 않아 중복이 원리적으로 불가능 |
| `Σ예산 + 여유 = 용량`을 계약으로 검증 | 하한은 지키는 것이 아니라 계약이 만들어 주는 것 |
| 격리 단위는 클래스가 아니라 인스턴스 (상태·락은 멤버로) | 자원이 늘면 인스턴스만 늘린다, 직렬화 함정도 소멸 |
| 경쟁 재현은 계획/실행 2단계 분리로 단일 스레드에서 | 타이밍 없이 결정론적으로 증명·고정 가능 |

**다음 강 예고 — 4강 "부분 실패에도 원본은 산다":** 백업 아카이브 수백 개를 다른 드라이브로 옮기는 작업. `rename`이 실패하면 copy+delete로 폴백하고, copy마저 도중에 실패하면 원본을 보존한 채 그 파일만 제외하고 계속 간다 — 여기까지는 설계다. 사고는 그다음 줄에서 난다: **폴백이 애써 살려 둔 원본을, 정리 단계의 delete가 지워 버린다.** "부분 실패 시 무엇이 보장되는가"를 코드 구조로 강제하는 법.

## 부록: 통째로 컴파일되는 연습 파일

본문 스니펫들을 한 파일로 합친 것이다. MSVC에서 `cl /std:c++17 /W4 /EHsc /utf-8 lec3_full.cpp`로 **경고 0개 컴파일·실행을 확인**했다 (표준 C++17만 썼으므로 GCC/Clang은 `g++ -std=c++17 -Wall -Wextra lec3_full.cpp`).

```cpp
// lec3_full.cpp — 3강 연습용 완결 파일 (이 파일 하나로 컴파일된다)
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <iostream>
#include <string>
#include <vector>

// ---------- 파티션 흉내 (단위: GB) ----------
struct LogFile {
    std::string   name;
    std::uint64_t sizeGB;
    int           ageDays;
};

struct Partition {
    std::uint64_t        capacityGB;
    std::vector<LogFile> files;   // 여러 로그군이 한 파티션에 섞여 산다

    std::uint64_t usedGB() const {
        std::uint64_t sum = 0;
        for (const LogFile& f : files) sum += f.sizeGB;
        return sum;
    }
    std::uint64_t freeGB() const { return capacityGB - usedGB(); }
};

// prefix가 붙은 파일만, 오래된 것부터, freed >= want 될 때까지 삭제
std::uint64_t deleteOldest(Partition& p, const std::string& prefix, std::uint64_t want) {
    std::uint64_t freed = 0;
    if (want == 0) return 0;
    std::stable_sort(p.files.begin(), p.files.end(),
                     [](const LogFile& a, const LogFile& b) { return a.ageDays > b.ageDays; });
    auto it = p.files.begin();
    while (it != p.files.end() && freed < want) {
        if (it->name.rfind(prefix, 0) == 0) {
            freed += it->sizeGB;
            it = p.files.erase(it);
        } else {
            ++it;
        }
    }
    return freed;
}

// ---------- 나쁜 버전: 공유 관측값(남은 공간) 기준 ----------
// 두 클리너가 같은 스냅샷을 보면 둘 다 부족분 '전체'를 자기가 메우려 한다
std::uint64_t planByGlobalFloor(const Partition& p, std::uint64_t minFreeGB) {
    std::uint64_t free = p.freeGB();
    return free < minFreeGB ? minFreeGB - free : 0;
}

// ---------- 좋은 버전: 소유 예산 기준 ----------
// 판정은 순수 함수 — 내 사용량과 내 예산만 본다 (1강 스타일)
[[nodiscard]] constexpr std::uint64_t gbOverBudget(std::uint64_t used, std::uint64_t budget) {
    return used > budget ? used - budget : 0;
}
static_assert(gbOverBudget(60, 55) == 5,  "over budget by 5");
static_assert(gbOverBudget(35, 35) == 0,  "exactly at budget");
static_assert(gbOverBudget(0,  55) == 0,  "under budget");

std::uint64_t usedBy(const Partition& p, const std::string& prefix) {
    std::uint64_t sum = 0;
    for (const LogFile& f : p.files) {
        if (f.name.rfind(prefix, 0) == 0) sum += f.sizeGB;
    }
    return sum;
}

class LogCleaner {
public:
    LogCleaner(std::string prefix, std::uint64_t budgetGB)
        : prefix_(std::move(prefix)), budgetGB_(budgetGB) {}

    // 계획: 내 사용량이 내 예산을 넘은 만큼만 — 남의 사정은 보지 않는다
    [[nodiscard]] std::uint64_t plan(const Partition& p) const {
        return gbOverBudget(usedBy(p, prefix_), budgetGB_);
    }
    std::uint64_t run(Partition& p) { return deleteOldest(p, prefix_, plan(p)); }

private:
    std::string   prefix_;
    std::uint64_t budgetGB_;
    // std::mutex m_;   // 실물에서 상태를 보호한다면 락도 여기 — 인스턴스마다 하나
};

// ---------- 예산은 파티션을 남김없이 분할해야 한다 (기동 전 계약) ----------
constexpr std::uint64_t kCapacityGB      = 100;
constexpr std::uint64_t kSessionBudgetGB = 55;
constexpr std::uint64_t kServiceBudgetGB = 35;
constexpr std::uint64_t kReserveGB       = 10;   // 아무도 못 쓰는 안전 여유

static_assert(kSessionBudgetGB + kServiceBudgetGB + kReserveGB == kCapacityGB,
              "budgets + reserve must partition the disk exactly");

// ---------- 테스트 ----------
Partition makeSystemPartition() {
    Partition p{kCapacityGB, {}};
    for (int i = 0; i < 60; ++i)
        p.files.push_back({"session_" + std::to_string(i), 1, 60 - i});
    for (int i = 0; i < 35; ++i)
        p.files.push_back({"service_" + std::to_string(i), 1, 35 - i});
    return p;   // used 95, free 5 — 하한(10)보다 5 부족한 상태
}

int main() {
    // --- 나쁜 버전: 2배 삭제를 재현한다 ---
    {
        Partition p = makeSystemPartition();
        assert(p.freeGB() == 5);
        const std::uint64_t kMinFreeGB = 10;

        // 스케줄러가 두 클리너를 같은 시각에 깨웠다 — 같은 스냅샷으로 각자 계획
        std::uint64_t planSession = planByGlobalFloor(p, kMinFreeGB);
        std::uint64_t planService = planByGlobalFloor(p, kMinFreeGB);
        assert(planSession == 5 && planService == 5);   // 둘 다 "부족 5GB는 내 몫"

        std::uint64_t freed = deleteOldest(p, "session_", planSession)
                            + deleteOldest(p, "service_", planService);
        assert(freed == 10);                            // 필요량 5의 정확히 2배
        std::cout << "[bad ] need 5 GB, freed " << freed << " GB — twice the need\n";
    }

    // --- 좋은 버전: 같은 '동시' 스케줄에서도 정확량만 지운다 ---
    {
        Partition p = makeSystemPartition();
        LogCleaner session("session_", kSessionBudgetGB);
        LogCleaner service("service_", kServiceBudgetGB);

        // 똑같이 같은 스냅샷으로 두 계획을 먼저 세워 본다
        std::uint64_t planSes = session.plan(p);   // 자기 사용량 60 vs 예산 55
        std::uint64_t planSvc = service.plan(p);   // 자기 사용량 35 vs 예산 35
        assert(planSes == 5 && planSvc == 0);      // 겹칠 값 자체를 보지 않는다

        std::uint64_t freed = session.run(p) + service.run(p);
        assert(freed == 5);
        assert(p.freeGB() == kReserveGB);          // 예산 계약이 하한을 '만들어' 준다
        std::cout << "[good] freed " << freed << " GB, free now " << p.freeGB() << " GB\n";
    }

    std::cout << "all tests passed\n";
    return 0;
}
```

실행 출력:

```text
[bad ] need 5 GB, freed 10 GB — twice the need
[good] freed 5 GB, free now 10 GB
all tests passed
```

같은 부족(5GB), 같은 동시 스케줄인데 나쁜 버전은 10GB를 지우고 좋은 버전은 5GB를 지운다. 차이는 스레드도 락도 아니고 — **계획 함수의 입력이 무엇이었느냐**뿐이다.
