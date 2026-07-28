+++
title = "네트워크 트래픽, 어떻게 재는가 — 네 가지 방식과 고르는 법"
date = 2026-07-28T13:45:00+09:00
draft = false
tags = ["네트워크", "트래픽", "모니터링", "wireshark", "pktmon", "netflow", "linux", "windows"]
categories = ["기타"]
summary = "트래픽 측정은 도구 고르기 전에 질문 고르기다. 카운터·플로우·패킷 캡처·능동 측정 네 가지 방식이 각각 어떤 질문에 답하는지, Windows/Linux에서 실제로 어떤 명령을 쓰는지, 그리고 평균·P95·마이크로버스트에서 사람들이 어디서 틀리는지 정리."

[cover]
  image = "taxonomy.png"
  alt = "네트워크 트래픽을 재는 네 가지 방식: 카운터, 플로우, 패킷 캡처, 능동 측정"
  caption = "측정 방식 네 가지 — 아래로 갈수록 정보는 많아지고 비용·부하도 커진다"
  relative = true
+++

> 🔧 실행 환경: 아래 Windows 명령은 **Windows 11에서 직접 돌려 확인**했고, 출력도 실제 결과다. Linux 쪽은 표준 도구 기준.

## 한 줄 요약

트래픽 측정은 **도구를 고르는 일이 아니라 질문을 고르는 일**이다. "회선이 모자라나?"와 "누가 다 쓰고 있나?"와 "왜 느리지?"는 서로 다른 도구를 요구하고, 잘못 고르면 정확해 보이는 틀린 숫자가 나온다.

## 먼저: 무슨 질문에 답하려는가

| 질문 | 필요한 방식 | 대표 도구 |
|---|---|---|
| 회선이 얼마나 차 있나? 증설이 필요한가? | **① 카운터** | `Get-NetAdapterStatistics`, `/proc/net/dev`, SNMP |
| 누가(어느 IP·서비스가) 다 쓰고 있나? | **② 플로우** | NetFlow / IPFIX / sFlow + 컬렉터 |
| 왜 느린가? 어디서 끊기나? | **③ 패킷 캡처** | Wireshark / tcpdump / pktmon |
| 이 구간이 실제로 몇 Mbps 나오나? | **④ 능동 측정** | iperf3, ethr |
| 어느 프로세스가 쓰고 있나? | 호스트 단위 도구 | 리소스 모니터, `nethogs`, eBPF |

이 순서가 곧 **비용 순서**이기도 하다. 카운터는 공짜고, 패킷 캡처는 디스크와 CPU를 먹는다. **위에서부터 시도하고, 답이 안 나올 때만 내려간다.**

---

## ① 카운터 — 이미 세고 있는 값을 읽는다

커널과 네트워크 장비는 이미 바이트를 세고 있다. 이걸 두 번 읽어서 차이를 시간으로 나누면 대역폭이다. **패킷 유실이 없고**(커널 집계라서), **권한도 대개 필요 없고**, 부하도 사실상 0이다.

### Windows

```powershell
# 누적 바이트 (관리자 권한 불필요)
Get-NetAdapterStatistics | Select-Object Name, ReceivedBytes, SentBytes

# Name  ReceivedBytes    SentBytes
# ----  -------------    ---------
# 이더넷   725207944752 122998051875
```

**누적값**이므로 1초 간격으로 두 번 읽어 빼면 초당 바이트가 나온다. 이걸 그대로 쓰는 게 가장 단순한 측정 루프다.

```powershell
# 초당 값을 바로 주는 성능 카운터 (역시 관리자 불필요)
(Get-Counter '\Network Interface(*)\Bytes Received/sec').CounterSamples |
    Select-Object InstanceName, CookedValue

# 30초 동안 1초 간격으로 CSV 로 흘리기
typeperf "\Network Interface(*)\Bytes Total/sec" -si 1 -sc 30 -f CSV -o net.csv
```

방향별로 보려면 `Bytes Total/sec` 대신 `Bytes Sent/sec`·`Bytes Received/sec`를 **한 번의 호출로 같이** 가져와야 타임스탬프가 어긋나지 않는다.

> ⚠️ **`netstat -e`는 믿지 마라.** 같은 머신에서 같은 순간에 재보면:
>
> ```
> Get-NetAdapterStatistics : 725,207,944,752 bytes  (725 GB)
> netstat -e               :   2,447,267,026 bytes  (2.4 GB)
> ```
>
> 300배 차이다. 32비트 카운터를 쓰는 오래된 인터페이스라 고속 링크에서는 이미 여러 바퀴 돌아버린 값이다. 화면에 그럴듯한 숫자가 찍히는 게 제일 위험하다.

### Linux

```bash
ip -s link show eth0          # 누적 RX/TX 바이트·패킷·드롭
cat /proc/net/dev             # 같은 값의 원본
nstat -az                     # 커널 SNMP 카운터 (재전송·드롭까지)
ethtool -S eth0               # NIC 드라이버 레벨 카운터 (하드웨어 드롭)
sar -n DEV 1 60               # 1초 간격 60회, 인터페이스별 kB/s
```

`ethtool -S`의 `rx_dropped`·`rx_missed_errors`는 **커널이 아니라 NIC이 흘린 패킷**이라, 여기 값이 오르면 호스트가 이미 못 따라가고 있다는 뜻이다. 상위 도구로는 안 보인다.

장기 추이는 **vnStat**이 편하다. 패킷을 스니핑하지 않고 커널 통계만 읽어 DB에 쌓기 때문에 링크 속도와 무관하게 가볍다.

```bash
vnstat -i eth0 -d      # 일별
vnstat -i eth0 -m      # 월별
```

### SNMP — 남의 장비를 잴 때

스위치·라우터는 대개 직접 로그인할 수 없으므로 SNMP로 인터페이스 카운터를 폴링한다. 여기에 **고전적인 함정**이 있다.

```
32비트 카운터(ifInOctets) 는 2³² 바이트 = 34.4 Gbit 마다 한 바퀴 돈다.
  1 Gbps 링크  → 약 34초마다 랩어라운드
  100 Mbps 링크 → 약 5.7분마다 랩어라운드
```

5분 폴링을 돌리면 **100 Mbps 링크부터 이미 값이 깨진다.** RFC 2863은 20 Mbps 이상 인터페이스에 64비트 카운터(`ifHCInOctets` / `ifHCOutOctets`)를 쓰도록 규정하고 있으니, 폴러 설정에서 **HC 카운터를 쓰는지 반드시 확인**할 것.

**카운터 방식의 한계**: 총량만 안다. 카메라 4대가 합쳐서 180 Mbps라는 건 알아도 그중 어느 대가 얼마인지는 모른다. 그게 필요하면 ②나 ③으로 내려가야 한다.

---

## ② 플로우 — 대화 단위로 요약해 받는다

장비가 패킷을 **5-tuple(출발지·목적지 IP/포트, 프로토콜)** 로 묶어 "이 대화가 몇 바이트 흘렀다"는 레코드만 컬렉터로 보낸다. 패킷 내용은 없지만 **누가 누구와 얼마나** 통신했는지는 다 나온다. 트래픽 원본의 1/1000 이하 용량으로 전체 네트워크를 볼 수 있는 게 강점이다.

| 방식 | 성격 | 특징 |
|---|---|---|
| **NetFlow** (v5/v9) | Cisco 발 사실상 표준 | 모든 플로우를 집계. 장비 CPU 부담 |
| **IPFIX** | NetFlow v9의 IETF 표준화 | 필드 확장 가능 |
| **sFlow** | N개 중 1개 **표본추출** | 부하가 낮고 L2–L7 헤더까지 보이지만 통계적 추정치 |

**sFlow는 샘플링**이다. 1/1000 샘플링이면 큰 흐름의 총량은 잘 맞지만 **작고 짧은 플로우는 통째로 안 보일 수 있다.** 보안 목적(모든 연결을 봐야 함)에는 부적합하고, 용량 산정에는 충분하다.

컬렉터는 ntopng, ElastiFlow, Kentik 같은 것들. 스위치가 플로우를 지원하지 않으면 이 방식은 아예 못 쓴다.

---

## ③ 패킷 캡처 — 통째로 받아 적는다

가장 많은 정보를 주고 가장 비싸다. **"왜"를 물을 때만** 내려온다 — 재전송이 일어나는지, TCP 윈도가 왜 안 자라는지, 핸드셰이크 어디서 죽는지.

### 어디서 뜰 것인가: 호스트 vs SPAN vs TAP

- **호스트 NIC** — 가장 쉽다. 다만 그 호스트를 지나는 트래픽만 보인다.
- **SPAN(포트 미러링)** — 스위치가 복사해준다. 공짜지만 함정이 있다.
- **TAP** — 회선에 물리적으로 끼우는 수동 장치. 전부 다 보인다.

SPAN의 문제:

> 10G 양방향 트래픽을 다 보려면 SPAN 포트에 **20G 용량**이 필요하다. 모자라면 스위치가 미러 프레임을 버린다. 스위치는 **본업(포워딩)을 미러링보다 우선**하므로, 정작 혼잡할 때 — 즉 우리가 보고 싶은 바로 그 순간 — 캡처가 빠진다. 게다가 SPAN은 손상 프레임·최소 크기 미만 프레임을 버리고 VLAN 태그를 떼는 경우가 많다.

즉 **SPAN에서 "드롭이 안 보인다"는 건 드롭이 없다는 뜻이 아니다.** 저부하 구간의 기능 확인용으로는 충분하고, 혼잡 분석에는 TAP을 써야 한다.

### Windows: 설치 없이 pktmon

Windows 10 1809 / Server 2019부터 `pktmon.exe`가 기본 내장이다. **오프라인 서버처럼 Wireshark를 못 까는 환경에서 특히 유용하다.** (드라이버를 다루므로 관리자 권한 필요)

```powershell
pktmon filter add -i 10.0.0.10 -t tcp      # 필터 먼저 (최대 32개)
pktmon start --capture --comp nics         # NIC 레벨만 캡처
pktmon counters                            # 계층별 통과/드롭 카운터
pktmon stop
pktmon etl2pcap PktMon.etl -o cap.pcapng   # Wireshark 로 열기
```

실시간으로 화면에 뿌리려면 로그 모드를 바꾼다 (내 환경에서 확인한 정확한 플래그는 `-m real-time`, `rt` 아님):

```powershell
pktmon start -c -m real-time               # Ctrl+C 로 중단, 파일 안 남김
```

pktmon의 진짜 강점은 **드롭 감지**다. `--type drop`으로 버려진 패킷만 잡고, `pktmon counters`가 네트워킹 스택의 어느 구성 요소(필터 드라이버, 가상 스위치 등)에서 사라졌는지와 드롭 사유를 알려준다. 방화벽·VPN·컨테이너 네트워킹 문제 추적에 강하다.

> ⚠️ `pktmon counters`는 **구성 요소(NIC) 단위로만** 쪼개진다. 필터를 여러 개 걸어도 필터별 카운터를 따로 주지 않으므로, 장비 A와 B의 트래픽을 **동시에 나눠 세는 용도로는 못 쓴다.**

### Wireshark를 제대로 쓰는 법

```bash
# GUI 말고 dumpcap 으로 뜬다 — 링버퍼 100MB × 50개 = 최근 5GB만 유지
dumpcap -i eth0 -f "host 10.0.0.10 and tcp" \
        -b filesize:100000 -b files:50 -s 128 -w cap.pcapng
```

핵심 원칙 셋:

1. **캡처 필터(`-f`, BPF)와 디스플레이 필터는 다른 것이다.** 디스플레이 필터는 이미 다 받아놓고 화면에서만 거른다. 기가비트 링크에서 무필터 캡처는 **분당 수백 MB**를 만든다. 걸러야 한다면 캡처 단계에서 걸러라.
2. **GUI로 장시간 캡처하지 마라.** Wireshark GUI는 받는 족족 해석하고 그리느라 패킷을 놓친다. `dumpcap`으로 받아서 나중에 Wireshark로 연다. 100MB 넘는 파일은 GUI가 눈에 띄게 느려진다(컬러링 규칙을 끄면 좀 낫다).
3. **snaplen(`-s`)을 줄여라.** 헤더만 필요하면 128바이트면 충분하고, 파일 크기가 10분의 1이 된다. 페이로드를 봐야 할 때만 `-s 0`.

Linux에서는 `tcpdump -i eth0 -w cap.pcap -s 128 'port 554'`가 같은 일을 한다.

---

## ④ 능동 측정 — 직접 흘려보고 잰다

앞의 셋은 **관찰**이고, 이건 **실험**이다. "이 구간이 실제로 몇 Mbps 나오는가"는 관찰로는 알 수 없다. 아무도 안 쓰고 있으면 0으로 보일 뿐이니까.

```bash
# 서버 쪽
iperf3 -s

# 클라이언트 쪽 — TCP 로 천장 먼저 확인
iperf3 -c 10.0.0.1 -t 30 -P 4

# UDP 로 손실·지터 — -b 를 반드시 지정할 것
iperf3 -c 10.0.0.1 -u -b 800M -t 30
```

> ⚠️ **UDP에서 `-b`를 빼면 iperf3는 1 Mbps로 돈다.** 기본값이 그렇다. "UDP가 왜 이렇게 느리지?"의 절반은 이것 때문이다.

제대로 된 순서는 **TCP로 천장을 먼저 잡고 → 그 절반쯤에서 UDP를 시작해 단계적으로 올리며 손실이 시작되는 지점을 찾는 것**이다. 그 무릎이 실시간 트래픽에 쓸 수 있는 실용 용량이다.

Windows끼리라면 Microsoft의 **ethr**도 있다. 기능은 iperf3가 더 풍부하지만 ethr은 수천 개 연결까지 스케일한다.

> 🚨 **운영 중인 회선에서 함부로 돌리지 말 것.** 능동 측정은 정의상 링크를 채운다. 카메라 영상이 흐르는 회선에서 iperf3를 풀로 돌리면 그 순간 영상이 끊긴다.

---

## 프로세스·앱 단위로 쪼개기

NIC 총량은 알겠는데 "어느 프로그램이"가 궁금할 때.

**Windows**
- **리소스 모니터**(`resmon`) → 네트워크 탭: 프로세스별 B/s를 바로 보여준다. 가장 빠른 답.
- `netstat -b` — 연결별 실행 파일 이름 (관리자 권한 필요, 느림)
- `Get-NetTCPConnection | Select LocalPort,RemoteAddress,OwningProcess` — 연결 목록만

**Linux**
- `nethogs` — 프로세스별 대역폭 (top의 네트워크판)
- `iftop` — **연결별** 대역폭. 링크를 먹는 상대를 찾을 때
- `nload` — 인터페이스 전체 in/out 그래프. 빠르게 눈으로 확인
- `bmon` — 인터페이스가 여러 개일 때
- `ss -tin` — 소켓별 RTT·재전송·cwnd (성능 진단에 의외로 유용)

**컨테이너/쿠버네티스**라면 요즘은 **eBPF** 계열이 표준이다. 애플리케이션을 건드리지 않고 커널에서 모든 패킷을 보므로 사이드카 프록시가 필요 없다. Cilium + Hubble(L3–L7 흐름), Microsoft Retina(CNI 무관, 관측 전용), Pixie(자동 계측) 조합이 많이 쓰인다.

---

## 숫자를 어떻게 읽을 것인가

여기서부터가 도구보다 중요하다.

### 평균·P95·최대는 다른 질문에 답한다

{{< img src="percentile.png" alt="같은 측정에서 나오는 평균, P95, 최대" caption="같은 1분 측정에서 평균 199 · P95 301 · 최대 399 Mbps — 어느 숫자를 쓰느냐로 결론이 갈린다" >}}

- **평균** — 총 전송량 계산용. 회선 산정에 쓰면 100% 과소평가한다.
- **P95** — 실무 표준. 상위 5%를 버린 값이라 순간 튐에 흔들리지 않으면서 실사용 수준을 보여준다.
- **최대** — 한 번의 이상치에 좌우된다. 단독으로 쓰면 과잉 투자.

P95가 표준이 된 건 **ISP 과금 방식** 때문이기도 하다. 대부분의 ISP는 5분 간격 샘플을 한 달치 모아 상위 5%를 버리고, 남은 최댓값으로 청구한다(버스터블 과금). 즉 **한 달의 36시간까지는 마음껏 튀어도 요금이 안 오른다.** 회선 계약을 검토한다면 내 측정도 같은 정의로 내야 비교가 된다.

계산할 때 한 가지: P95를 **선형보간**으로 낼지 **최근접 순위**로 낼지 정해두는 게 좋다. 실측에 없는 값이 리포트에 찍히면 안 되는 상황이라면 `index = ceil(0.95 × n) - 1` 위치의 실제 샘플을 쓰는 쪽이 안전하다.

### 샘플링 간격이 결론을 바꾼다

{{< img src="sampling-interval.png" alt="같은 트래픽을 10ms, 1초, 10초 평균으로 본 결과" caption="완전히 같은 트래픽. 10ms로 보면 1103 Mbps로 회선을 넘지만, 1초 평균은 399, 10초 평균은 217 Mbps다" >}}

위 그림의 세 그래프는 **같은 트래픽**이다. 10 ms 해상도로 보면 1 Gbps 회선을 일곱 번 넘겼는데, 1초 평균에서는 최대 399 Mbps, 10초 평균에서는 217 Mbps로 "여유롭다"고 나온다.

이게 **마이크로버스트**다. 10 ms~1초 사이의 순간 폭증으로, 링크와 스위치 큐를 순간적으로 100% 채워 **테일 드롭 → TCP 재전송 → 지연 급증**을 만든다. 그런데 평균 사용률 지표에서는 완전히 사라진다.

정리하면:

| 무엇을 하려는가 | 필요한 해상도 |
|---|---|
| 회선 용량 산정 | 1초 샘플 + P95면 충분 |
| 월 사용량·과금 확인 | 5분 샘플 |
| 스위치 버퍼·큐 산정 | **1초 평균으로는 불가능** |
| 마이크로버스트 추적 | 스위치의 버퍼 텔레메트리(Cisco Nexus microburst monitoring, Arista LANZ 등) 또는 gNMI 스트리밍 |

호스트에서 1초 카운터를 읽는 방식으로는 마이크로버스트를 **원리적으로 못 잡는다.** "우리 측정에는 안 나왔다"가 아니라 "이 방법으로는 볼 수 없다"고 적어야 정직한 리포트다.

---

## 흔한 함정 정리

1. **측정 길이보다 측정 시점이 중요하다.** 영상 트래픽은 화면 변화에 비례한다. 아무 일도 없던 1시간은 실제로 돌아가는 10분보다 못한 자료다.
2. **32비트 카운터.** SNMP `ifInOctets`, Windows `netstat -e`. 고속 링크에서 랩어라운드한다.
3. **SPAN 드롭.** 혼잡할 때 미러가 먼저 버려진다. 정작 필요한 순간에 데이터가 없다.
4. **단위 혼동.** 카운터는 바이트, 회선 규격은 비트. `× 8`을 빼먹으면 8배 차이다. `MB/s`와 `Mbps`는 다른 말이다.
5. **UDP 테스트에 `-b` 누락.** 1 Mbps로 재고 "링크가 느리다"고 결론 내린다.
6. **가상 어댑터.** VPN·Hyper-V 가상 스위치가 통계를 안 주거나 이중 집계된다. 표에서 빠진 게 0이라는 뜻은 아니다.
7. **한 번만 재고 끝낸다.** 한 시점의 값은 데이터가 아니라 일화다.

## 상황별 첫 수

| 상황 | 이렇게 시작한다 |
|---|---|
| 회선 증설 판단 | 카운터 1초 샘플링 + P95, **실제 업무 시간대**에 1시간 이상 |
| 갑자기 느려짐 | `iftop`/리소스 모니터로 범인 찾기 → 안 나오면 캡처 |
| 특정 앱만 느림 | 그 호스트에서 필터 건 패킷 캡처. 재전송·RTT 확인 |
| 전체 네트워크 가시성 | 스위치에 플로우 켜고 컬렉터 구축 |
| 새 회선 검수 | iperf3 TCP → UDP 단계 상승 |
| 원인 모를 패킷 손실 | `ethtool -S` / `pktmon --type drop` 으로 드롭 지점 특정 |

## 메모

- 도구를 늘리는 것보다 **한 가지 방식의 한계를 정확히 아는 것**이 낫다. 리포트에 "이 수치로는 무엇을 말할 수 없는지"를 같이 적으면, 받는 사람이 잘못 쓰는 걸 막을 수 있다.
- Windows에서 **설치도 관리자 권한도 없이** 쓸 수 있는 게 `Get-NetAdapterStatistics`와 `Get-Counter`라는 점은 생각보다 자주 유용하다. 폐쇄망 서버에서 쓸 수 있는 사실상 유일한 선택지다.
- 반대로 **pktmon은 관리자 권한이 필요하지만 설치는 필요 없다.** 폐쇄망에서 패킷을 봐야 할 때 Wireshark 설치 승인을 받는 것보다 빠른 길이 될 수 있다.

---

**Sources**

- [pktmon | Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/pktmon) · [Pktmon command formatting](https://learn.microsoft.com/en-us/windows-server/networking/technologies/pktmon/pktmon-syntax)
- [Get-NetAdapterStatistics | Microsoft Learn](https://learn.microsoft.com/en-us/powershell/module/netadapter/get-netadapterstatistics)
- [Performance — The Wireshark Wiki](https://wiki.wireshark.org/Performance)
- [Network Flow Monitoring Explained: NetFlow vs sFlow vs IPFIX — Varonis](https://www.varonis.com/blog/flow-monitoring) · [NetFlow vs. sFlow — Kentik](https://www.kentik.com/blog/netflow-vs-sflow/)
- [Microburst Detection — Kentik](https://www.kentik.com/kentipedia/microburst-detection/) · [Microbursts, Jitter and Buffers — Arista (PDF)](https://www.arista.com/assets/data/pdf/TechBulletins/AristaMicrobursts.pdf)
- [Burstable billing — Wikipedia](https://en.wikipedia.org/wiki/Burstable_billing) · [95th percentile metering — Stackscale](https://www.stackscale.com/blog/95-percentile-metering-billing-bandwidth/)
- [SPAN Ports vs. Network TAPs — Profitap](https://insights.profitap.com/span-ports-vs.-network-taps) · [Network TAP vs Port Mirroring — Network Critical](https://www.networkcritical.com/blogs/network-tap-vs-port-mirroring)
- [Network Bandwidth Monitoring Tools: iftop, nload, bmon, vnstat — Linuxize](https://linuxize.com/post/network-bandwidth-monitoring-tools/)
- [iPerf — The TCP, UDP and SCTP network bandwidth measurement tool](https://iperf.fr/) · [microsoft/ethr](https://github.com/microsoft/ethr)
- [eBPF-Based Network Observability: Cilium Hubble and Alternatives — CloudRaft](https://www.cloudraft.io/blog/ebpf-based-network-observability-using-cilium-hubble)
