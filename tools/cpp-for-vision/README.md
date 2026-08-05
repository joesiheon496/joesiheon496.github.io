# `cpp-for-vision` 글의 실측 코드

`content/posts/cpp-for-vision/index.md` 의 표에 들어간 숫자는 전부 이 두 파일을 돌려서
나온 값이다. 교과서에서 옮겨 적은 것이 하나도 없다 — 그것이 그 글의 논지다.

- `measure_a.cpp` — 8비트 평균 · 얕은 복사 · stride · `resize` 화소 중심 · `at`/`Point` ·
  초기화 안 된 `Mat` · float 누적 · 타입 틀린 `at`
- `measure_b.cpp` — `MatExpr` 지연 계산 · 외부 버퍼 수명 · 화소 접근 속도 ·
  루프 안 `clone` · BGR · `saturate_cast` 반올림 · 0 으로 나누기

## 측정 환경

글의 숫자는 이 환경에서 나왔다. **시간 수치는 기계에 따라 다르므로 배율만 인용한다.**

```
OpenCV 4.5.4  (사전빌드 x64/vc14, opencv_world454)
MSVC          Visual Studio 18 Community
Windows 11 x64
```

## 빌드

`/utf-8` 이 **필수**다. 없으면 MSVC 가 BOM 없는 UTF-8 소스를 시스템 코드페이지(CP949)로
읽어서, 일부 한글의 둘째 바이트가 `0x5C`(`\`) 라 문자열 리터럴이 닫히지 않는다.
원인과 무관해 보이는 `C4430`·`C2001` 이 난다. 글의 마지막 항목이 이것이다.

```bat
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"

REM Release — 글의 성능 표 왼쪽 열
cl /nologo /EHsc /std:c++17 /O2 /utf-8 measure_a.cpp ^
   /I"C:\opencv\build\include" ^
   /link /LIBPATH:"C:\opencv\build\x64\vc14\lib" opencv_world454.lib

REM Debug — 글의 성능 표 오른쪽 열 (라이브러리 이름 끝에 d 가 붙는다)
cl /nologo /EHsc /std:c++17 /Od /MDd /D_DEBUG /utf-8 /Fe:measure_b_dbg.exe measure_b.cpp ^
   /I"C:\opencv\build\include" ^
   /link /LIBPATH:"C:\opencv\build\x64\vc14\lib" opencv_world454d.lib
```

실행하려면 DLL 이 PATH 에 있어야 한다:

```bat
set PATH=C:\opencv\build\x64\vc14\bin;%PATH%
measure_a.exe
```

## 주의

`measure_a.cpp` 의 6·8절과 `measure_b.cpp` 의 9절은 **정의되지 않은 동작을 관측**한다
(초기화 안 된 메모리, 타입이 틀린 `at`, 해제된 버퍼). 출력된 값은 이 실행에서 그렇게
나온 것이고 보장이 아니다. 글에서도 그렇게 적었다.
