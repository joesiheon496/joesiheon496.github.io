+++
title = "Windows에서 ROS2 Humble 설치기 — 공식 바이너리, DLL 지옥, 그리고 인터프리터 분담"
date = 2026-08-19T10:00:00+09:00
draft = false
tags = ["ROS2", "LiDAR", "Windows", "환경설정"]
categories = ["프로그램"]
summary = "Windows에서 ROS2 Humble로 Ouster LiDAR 포인트클라우드를 받아 RViz2로 띄우기까지. 공식 바이너리와 RoboStack conda 어느 쪽도 혼자서는 완전하지 않았고, 결국 둘을 반쪽씩 나눠 쓰는 구성으로 안착했다. 누락 DLL을 심볼 검증 후 이식하는 pefile 절차, 깨진 ros2 CLI의 워크어라운드, 그리고 '어떤 작업은 어떤 파이썬으로'를 문서로 박제해야 하는 이유."
+++

## 한 줄 요약

> **Windows에서 ROS2는 "설치"가 아니라 "조립"이다.**
> 어느 배포판도 혼자 완전하지 않았다 — 공식 바이너리는 DLL이 빠져 있고, conda 빌드는 rclpy와 numpy가 손상돼 있다. 각자의 살아 있는 반쪽을 골라 잇고, 그 분담을 문서로 박제하는 것까지가 설치다.

## 배경

박사과정 연구용으로 LiDAR(Ouster OS1-128) 실측 도구를 만드는데, 장비가 붙어 있는 머신이 Windows다. 필요한 것은 세 가지 — ① 센서에서 프레임 취득, ② PointCloud2로 퍼블리시하는 ROS2 노드, ③ RViz2 실시간 뷰. 리눅스라면 `apt install ros-humble-desktop` 한 줄인 일이, Windows에서는 이틀짜리 모험이 됐다. 이 글은 그 기록이다 (이 글은 환경 이야기만 다룬다).

## 두 갈래 설치 경로, 그리고 둘 다 반쪽이었다

Windows에서 ROS2 Humble을 얻는 길은 크게 둘이다.

**경로 A — RoboStack (conda).** conda-forge 생태계에 ROS2를 얹은 배포판. `ros_env`라는 conda 환경에 Humble 데스크톱과 ouster-sdk를 넣었다. 결과: **센서 취득은 완벽하게 동작**했다. 그런데 `import rclpy`가 심볼 불일치로 죽고, 한술 더 떠 numpy가 LAPACK delay-load 크래시로 무거운 연산에서 죽는다. ROS를 쓰려고 만든 환경에서 ROS가 안 되는 상황.

**경로 B — 공식 바이너리.** ROS2 GitHub 릴리스의 Windows용 zip(2025-07-21 패치 릴리스)을 `C:\dev\ros2_humble`에 풀고, 이 바이너리가 대상으로 하는 **Python 3.10**을 `C:\Python310`에 설치했다. 사용법은 리눅스의 `source setup.bash` 대응인 `call C:\dev\ros2_humble\setup.bat`. 결과: 압축 푼 그대로는 **rclpy가 DLL 누락으로 죽고, RViz2는 창도 못 띄우고 즉사**했다.

즉 A는 취득만 되고 ROS가 안 되며, B는 ROS인데 DLL이 빠져 있다. 결말을 먼저 말하면 — B의 구멍을 A의 DLL로 메꿔서 B를 살리고, A는 취득 전용으로 강등시켰다. 이식 과정이 이 글의 본론이다.

## DLL 지옥 탈출기

### 증상 1: `import rclpy` → `DLL load failed` — spdlog.dll 누락

공식 바이너리에서 rclpy를 import하면 어떤 DLL인지도 말해 주지 않고 `ImportError: DLL load failed`만 나온다. `bin` 폴더의 DLL들이 뭘 요구하는지 pefile로 의존성을 대조해 보면 범인이 나온다 — `rcl.dll`과 `rcl_logging_spdlog.dll`이 `spdlog.dll`을 import하는데, **zip 안에 spdlog.dll이 없다**. (로깅 백엔드를 통째로 빼먹은 채 릴리스된 것이다.)

다행히 conda-forge에 spdlog 1.9.2 빌드(fmt v8 내장)가 있다. 그런데 여기서 **아무 spdlog나 주워 넣으면 안 된다** — 같은 이름의 DLL이라도 빌드 옵션에 따라 export 심볼이 다르고, 하나라도 빠지면 또 조용히 죽는다. 복사 전에 "요구하는 심볼을 후보가 전부 제공하는가"를 검증한다.

```python
# check_spdlog.py — 요구 import ⊆ 제공 export 인지 검증
import pefile

def imports_from(dll, target):
    pe = pefile.PE(dll, fast_load=True)
    pe.parse_data_directories(
        directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_IMPORT']])
    out = set()
    for e in getattr(pe, 'DIRECTORY_ENTRY_IMPORT', []):
        if e.dll.lower() == target:          # 정확히 일치시킬 것 — 아래 함정 참고
            out |= {i.name for i in e.imports if i.name}
    return out

need  = imports_from(r'C:\dev\ros2_humble\bin\rcl_logging_spdlog.dll', b'spdlog.dll')
need |= imports_from(r'C:\dev\ros2_humble\bin\rcl.dll', b'spdlog.dll')

have = {s.name
        for s in pefile.PE(r'C:\dev\ros2_humble\bin\spdlog.dll')
                       .DIRECTORY_ENTRY_EXPORT.symbols
        if s.name}
print('need', len(need), '| missing', len(need - have))
```

```text
need 11 | missing 0
```

`missing 0`을 확인하고 `bin`에 복사하면 rclpy가 살아난다.

> ⚠️ **부분 일치의 함정.** 처음에 DLL 이름을 `if b'spdlog' in e.dll.lower():`로 걸렀다가 "need 15 | missing 4"라는 **가짜 결과**에 속을 뻔했다. `rcl_logging_spdlog.dll` — 이름에 spdlog가 들어간다 — 에서 가져오는 심볼까지 섞인 것이다. 그 4개는 spdlog.dll이 줄 물건이 아니었다. 필터는 정확히 `== b'spdlog.dll'`로.

### 증상 2: RViz2 즉사 — 이번엔 두 개

RViz2는 에러 창 하나 없이 곧바로 종료된다(비정상 종료 코드만 남는다). 같은 방법으로 대조하면 `console_bridge.dll`과 `assimp-vc141-mt.dll` 누락. 이번 공급처는 경로 A에서 죽어 있던 conda `ros_env`다 — rclpy는 손상됐어도 **DLL 창고로는 멀쩡하다**.

- `console_bridge.dll` — conda 빌드(1.0.2) 그대로 복사.
- `assimp-vc141-mt.dll` — conda에는 `assimp.dll`(5.2.5)이라는 이름으로 있다. **이름을 바꿔서** 복사하면 된다 — Windows 로더는 import 테이블에 적힌 파일 이름으로 찾을 뿐이므로, 심볼이 호환되면 개명이 통한다(물론 위 pefile 검증을 먼저 통과시키고). assimp가 zlib을 끌고 오므로 `zlib.dll`도 동반 복사.

두 증상을 정리하면 절차는 항상 같다:

> **DLL 누락 디버깅 4단계**
> 1. 조용한 즉사, `ImportError: DLL load failed` → 누락 의심
> 2. **무엇이** 없나: pefile(또는 `dumpbin /dependents`)로 요구 DLL 목록을 뽑아 `bin`과 대조
> 3. 대체 후보의 export가 요구 import를 전부 덮는지 검증 — `missing 0` 확인
> 4. 그다음에야 복사. 같은 이름 ≠ 같은 ABI(fmt 내장 여부 같은 빌드 변형이 있다)

## 부속 정리 두 건

**방화벽.** 센서는 UDP로 데이터를 쏘므로, 패킷을 받는 파이썬 인터프리터마다 인바운드 허용 규칙이 필요하다. 규칙은 포트보다 프로그램 단위가 관리하기 쉽다:

```bat
netsh advfirewall firewall add rule name="Python310 ROS2 Ouster" dir=in action=allow program="C:\Python310\python.exe"
```

인터프리터를 여러 개 쓰게 되면(아래 참고) **각각** 규칙이 필요하다는 점을 잊기 쉽다 — "conda에서는 되는데 Python310에서는 프레임이 안 온다"의 정체가 대개 이것이다.

**깨진 ros2 CLI.** 공식 바이너리의 `Scripts\ros2.exe`를 실행하면 `failed to create process`가 나온다. pip식 exe 래퍼에는 **빌드 머신의 파이썬 절대 경로**가 박혀 있는데 내 머신에는 그 경로가 없기 때문이다. 래퍼가 깨졌을 뿐 파이썬 모듈(`ros2cli`)은 멀쩡하므로 직접 부르면 된다. bat 한 장으로 감싸 두면 원래 CLI처럼 쓸 수 있다:

```bat
@echo off
rem ros2.bat — 깨진 ros2.exe 대신 ros2cli 모듈 직접 호출
C:\Python310\python.exe -c "import sys; sys.argv=['ros2']+sys.argv[1:]; from ros2cli.cli import main; sys.exit(main())" %*
```

```text
> ros2 topic list
/ouster/points
/parameter_events
/rosout
```

## 진행 방법: 인터프리터 분담을 문서로 박제한다

이 조립의 결과, 머신에는 반쪽짜리 파이썬이 두 개 공존한다. 어떤 작업을 어디서 돌리는지가 곧 운영 매뉴얼이다:

| 작업 | 인터프리터 | 이유 |
|---|---|---|
| 센서 취득 (ROS 없이) | conda `ros_env` | ouster-sdk 정상 동작, 방화벽 허용 완료 |
| ROS2 노드 · RViz2 | `C:\Python310` + `setup.bat` | 공식 바이너리의 대상 파이썬 (DLL 수리 후) |
| numpy 무거운 분석 · 테스트 | `C:\Python310` | `ros_env`의 numpy는 LAPACK 크래시로 사용 불가 |

이 표는 반드시 **프로젝트 README에 그대로 박제**해 둔다. 조립식 환경의 진짜 위험은 조립 당일이 아니라 한 달 뒤다 — "왜 이 스크립트만 다른 파이썬으로 돌리지?"를 미래의 자신은 절대 기억하지 못하고, 무심코 통일하는 순간 LAPACK 크래시가 돌아온다. 표 한 장이 그 사고를 막는다.

## 실시간 뷰까지

조립이 끝난 뒤의 일상 사용은 단순하다. 노드는 파라미터로 센서 주소를 받고, `n_frames:=0`이면 저장 없이 스트리밍만 한다 (IP는 예시):

```bat
call C:\dev\ros2_humble\setup.bat
C:\Python310\python.exe capture_node.py --ros-args -p hostname:=192.168.1.100 -p n_frames:=0
```

RViz2까지 한 번에 띄우는 런처를 bat으로 묶어 두면 끝:

```bat
@echo off
rem view_live.bat — RViz2 + 스트리밍 노드 동시 실행 (노드는 Ctrl+C로 종료)
call C:\dev\ros2_humble\setup.bat
start "rviz2" rviz2 -d "%~dp0ouster_view.rviz"
C:\Python310\python.exe "%~dp0capture_node.py" --ros-args -p hostname:=192.168.1.100 -p n_frames:=0
```

RViz2 쪽은 설정 파일(`.rviz`)에 fixed frame을 센서 프레임(`os_sensor`)으로, PointCloud2 색상을 Z축 기준으로 저장해 두면 매번 클릭할 일이 없다. 토픽이 살아 있는지는 위의 `ros2 topic list` 래퍼로 확인한다.

## 정리

| 증상 | 원인 | 해법 |
|---|---|---|
| `import rclpy` → `DLL load failed` | 공식 zip에 `spdlog.dll` 누락 | conda-forge 빌드를 **심볼 검증 후** 복사 |
| RViz2 무언의 즉사 | `console_bridge.dll`·`assimp-vc141-mt.dll` 누락 | conda 빌드 복사 (assimp는 개명 + zlib 동반) |
| conda 쪽 rclpy·numpy 크래시 | 빌드 손상 (심볼 불일치, LAPACK delay-load) | 고치지 않고 **취득 전용으로 역할 한정** |
| `ros2.exe` → failed to create process | 래퍼에 박힌 빌드 머신 파이썬 경로 | `ros2cli.cli:main` 직접 호출 bat |
| 특정 파이썬만 센서 프레임 안 옴 | 인터프리터별 방화벽 규칙 누락 | 받는 인터프리터마다 인바운드 허용 |

교훈은 세 줄이다. **죽는 방식이 조용할수록 DLL을 의심하라.** ImportError 한 줄, 메시지 없는 즉사 — Windows에서 이 침묵은 대부분 로더가 파일을 못 찾은 것이다. **DLL은 심볼 검증(`missing 0`) 없이 옮기지 마라.** 같은 이름이 같은 ABI를 뜻하지 않는다. 그리고 **조립식 환경은 분담표가 완성품이다** — 어떤 작업이 어떤 인터프리터인지 문서로 남기는 것까지가 설치다.
