+++
title = "리눅스 네트워크 측정 명령어 실무 핸드북 — 질문에서 명령으로"
date = 2026-08-20T14:00:00+09:00
draft = false
tags = ["리눅스", "네트워크", "측정", "명령어"]
categories = ["기타"]
summary = "명령어를 외우는 게 아니라 질문을 명령으로 번역하는 표를 갖는 것이 실무다. '링크는 살아 있나'부터 '어디서 끊기나', '실제 몇 Mbps 나오나', '네트워크 탓인가 앱 탓인가'까지 — 질문 일곱 개에 명령 하나씩, 출력에서 어느 필드를 읽고 어디서 속기 쉬운지를 실제 실행 출력과 함께 정리했다."
+++

> 🔧 아래 출력은 ubuntu 24.04(컨테이너)에서 **실제 실행한 결과**다. 컨테이너(NAT 뒤)라서 생기는 특성 — mtr의 홉 접힘, 가상 NIC의 ethtool 값 — 은 본문에 그대로 표시했는데, 이것 자체가 교훈이기도 하다: **측정은 항상 "내가 서 있는 곳"에서의 측정이다.**
> 이 글은 "명령을 치고 출력을 읽는 법"이다. 그 앞 단계 — 카운터/플로우/캡처/능동측정 중 **무엇을 잴지 고르는 법** — 는 [네트워크 트래픽, 어떻게 재는가]({{< ref "/posts/network-traffic-check" >}})에서 다뤘다.

## 한 줄 요약

> 실무자의 무기는 명령어 암기가 아니라 **질문 → 명령 매핑**이다.
> "링크는 살아 있나 → `ip -s link`", "어디서 끊기나 → `mtr`", "네트워크 탓인가 앱 탓인가 → `ss`의 Send-Q/Recv-Q". 질문이 정해지면 명령은 하나로 좁혀진다.

## 1. 링크가 살아 있나, 에러는 없나 — `ip -s link`

케이블·드라이버·인터페이스 수준의 문제는 여기서 걸러진다. 위로 올라가기 전에 30초.

```bash
ip -s link show eth0
```

```text
2: eth0@if5: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP ...
    RX:  bytes packets errors dropped  missed   mcast
     234578490  164901      0       0       0       0
    TX:  bytes packets errors dropped carrier collsns
      11948994  160588      0       0       0       0
```

**읽을 곳**: 첫 줄의 `state UP`과 `LOWER_UP`(물리 링크 감지), 그리고 `errors`/`dropped` 열. errors는 CRC 오류 같은 손상(케이블·듀플렉스 불일치 의심), dropped는 받긴 했는데 커널이 버린 것(버퍼 부족, 모르는 VLAN 태그 등)이다 — 같은 "손실"이라도 범인이 다르다.

**함정**: 이 카운터는 **부팅 이후 누적**이다. dropped 500이 방금 문제인지 석 달 전 흔적인지는 알 수 없다 — 몇 초 간격으로 두 번 읽어 **델타가 지금도 증가하는지**를 봐야 한다.

물리 협상 상태는 `ethtool eth0`으로:

```text
	Speed: 10000Mb/s
	Duplex: Full
	Link detected: yes
```

기가비트 회선인데 `Speed: 100Mb/s`·`Duplex: Half`로 협상돼 있는 것 — "느려요"의 고전적 범인이다. (위 값은 컨테이너의 가상 NIC라 10G로 나온 것이고, 실물 NIC에서는 auto-negotiation 항목과 `ethtool -S`의 하드웨어 드롭 카운터까지 확인할 수 있다.)

## 2. 상대까지 가는가 — `ping`, 그리고 통계 줄 읽는 법

```bash
ping -c 5 -i 0.3 1.1.1.1
```

```text
--- 1.1.1.1 ping statistics ---
5 packets transmitted, 5 received, 0% packet loss, time 1204ms
rtt min/avg/max/mdev = 3.160/4.306/5.745/0.882 ms
```

**읽을 곳**: 다들 손실률만 보고 덮는데, 마지막 줄의 **`mdev`(표준편차)가 지터**다. avg 4ms에 mdev 0.9ms면 안정적인 경로이고, avg 4ms에 mdev 20ms면 평균은 좋아 보여도 실시간 통신(음성·제어)은 이미 고통받고 있다. `max`가 `avg`의 몇 배씩 튀면 경로 어딘가의 버퍼링(bufferbloat)을 의심한다.

**함정**: ICMP는 라우터가 **후순위로 처리하거나 rate-limit** 하는 경우가 많다. "ping은 튀는데 서비스는 멀쩡"이 가능하고 그 역도 가능하다. ping은 도달성과 대략의 RTT까지만 믿고, 그 이상은 다음 도구로.

## 3. 어디서 끊기나 — `mtr`

traceroute를 반복 실행하며 홉별 통계를 쌓는 도구다. 일회성 traceroute보다 항상 낫다 — 간헐 손실은 한 번의 측정에 안 잡히기 때문이다.

```bash
mtr -rn -c 10 1.1.1.1        # -r 보고서 모드, -n 역방향 DNS 생략, -c 측정 횟수
```

```text
HOST: c51753f9759b                Loss%   Snt   Last   Avg  Best  Wrst StDev
  1.|-- 172.17.0.1                 0.0%    10    0.1   0.1   0.1   0.1   0.0
  2.|-- 1.1.1.1                    0.0%    10    3.5   4.4   3.4   5.1   0.7
```

**읽을 곳**: 홉별 `Loss%`와 `Avg`의 **계단**. 어느 홉부터 지연이 확 뛰고 그 뒤로 유지되면 그 구간이 병목이다.

**함정 두 개.** 첫째, **중간 홉의 손실은 착시일 수 있다** — 라우터가 자기 앞으로 온 TTL 만료 응답을 rate-limit 하는 것뿐일 수 있어서, 중간 홉 Loss%가 높아도 **마지막 홉까지 이어지지 않으면** 실제 트래픽은 멀쩡한 것이다. 진짜 손실은 발생 지점부터 끝까지 전파된다. 둘째, 위 출력이 홉 2개뿐인 이유 — 컨테이너 NAT 뒤에서 쟀기 때문이다. VPN·NAT·터널 뒤에서는 경로가 접혀 보인다. 측정 위치가 결과를 정의한다.

## 4. 이 구간, 실제 몇 Mbps 나오나 — `iperf3`

카탈로그 속도 말고 실측. 한쪽에서 `iperf3 -s`(서버), 반대쪽에서:

```bash
iperf3 -c <서버IP> -t 10          # TCP 처리량
iperf3 -c <서버IP> -R             # 역방향 (다운로드 방향 — 비대칭 회선이면 필수)
iperf3 -c <서버IP> -u -b 100M    # UDP로 목표 대역폭을 밀어넣고 손실·지터 측정
```

```text
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-3.00   sec  23.2 GBytes  66.3 Gbits/sec    2             sender
[  5]   0.00-3.00   sec  23.2 GBytes  66.3 Gbits/sec                  receiver

[  5]   0.00-3.00   sec  35.8 MBytes   100 Mbits/sec  0.012 ms  0/1145 (0%)  receiver
```

**읽을 곳**: TCP 결과에서는 Bitrate만큼 **`Retr`(재전송) 열**이 중요하다 — 숫자가 크면 경로 어딘가에서 패킷이 죽고 있고, TCP가 그걸 감춰 주고 있었다는 뜻이다. UDP 결과는 지터(`0.012 ms`)와 손실(`0/1145`)을 직접 준다 — TCP와 달리 감춰 주지 않아서, 실시간 트래픽의 체감을 재려면 UDP로 잰다.

**함정**: 위 66.3 Gbits/sec는 **루프백**(같은 호스트) 수치다 — NIC도 케이블도 안 지난 숫자로, "iperf3가 잘 나온다"의 의미는 서버를 **어디에** 뒀느냐가 전부 결정한다. 병목을 찾으려면 서버 위치를 옮겨 가며 구간을 좁힌다.

## 5. 네트워크 탓인가, 앱 탓인가 — `ss`

이 질문 하나로 밤샘 디버깅의 방향이 갈린다. `netstat`은 잊고 `ss`로.

```bash
ss -s                                  # 전체 요약 (연결 수, timewait 등)
ss -ti state established               # 연결별 TCP 내부 상태 (RTT, cwnd, 재전송)
```

```text
Recv-Q Send-Q Local Address:Port  Peer Address:Port
0      196555     127.0.0.1:40570    127.0.0.1:5201
	 cubic wscale:7,7 rto:204 rtt:0.102/0.112 mss:65483 cwnd:41 ssthresh:16
	 bytes_sent:16579690533 bytes_acked:16579690428 segs_out:373087 ...
	 send 211Gbps pacing_rate 430Gbps delivery_rate 121Gbps app_limited ...
```

**읽을 곳 — 첫 줄의 두 큐가 판정을 내린다**:

- **`Send-Q`가 계속 크다** → 내 커널이 보내려고 쌓아 뒀는데 안 빠진다 → **경로나 상대가 못 받는다** (네트워크/상대 쪽).
- **`Recv-Q`가 계속 크다** → 데이터는 도착해 커널에 쌓였는데 **내 앱이 안 읽어 간다** (앱 쪽 — 네트워크는 무죄).

둘째 줄부터는 커널이 공짜로 주는 진단서다: `rtt:0.102/0.112`(평균/편차 ms), `cwnd`(혼잡 윈도), `retrans`(있다면 재전송 횟수), `delivery_rate`(실측 전달률), `app_limited`(병목이 네트워크가 아니라 **앱이 데이터를 안 줘서**라는 뜻). tcpdump 없이 여기까지 나온다.

**함정**: 스냅샷 한 번으로 판정하지 말 것. Send-Q는 정상 통신 중에도 순간적으로 찬다 — `watch -n1`로 몇 초 지켜보며 **계속 차 있는지**를 본다.

## 6. 사용량 추이 — `sar -n DEV`와 `/proc/net/dev`

```bash
sar -n DEV 2 5                         # 2초 간격 5회 (sysstat 패키지)
```

```text
04:35:10        IFACE   rxpck/s   txpck/s    rxkB/s    txkB/s  ...   %ifutil
04:35:12         eth0  11248.50  10909.00  15549.35    795.08  ...      1.27
04:35:14         eth0      0.00      0.00      0.00      0.00  ...      0.00
Average:         eth0   5624.25   5454.50   7774.68    397.54  ...      0.64
```

**읽을 곳**: `rxkB/s`/`txkB/s`와 `%ifutil`(링크 속도 대비 사용률). 위 출력이 좋은 반면교사다 — 2초 구간 하나는 15 MB/s로 찼는데 다음 구간은 0이고, **Average는 그 사이 어딘가의 거짓말**(7.7 MB/s)을 한다. 순간 포화(마이크로버스트)는 평균에 묻힌다. 짧은 간격으로, Average 말고 구간별 행을 본다.

sysstat이 없는 환경(컨테이너, 임베디드)에서는 커널 카운터를 직접 두 번 읽어 나눈다:

```bash
r1=$(awk '/eth0/{print $2}' /proc/net/dev); sleep 2
r2=$(awk '/eth0/{print $2}' /proc/net/dev); echo "rx $(( (r2-r1)/2 )) bytes/s"
```

의존성 0짜리 대역폭 측정기다. 프로세스별로 누가 쓰는지까지 필요하면 `nethogs eth0`(패킷을 소켓→프로세스로 역추적, root 필요).

## 7. 응용 계층 어디가 느린가 — `curl -w`

"사이트가 느려요"는 DNS·TCP·TLS·서버 중 누구 잘못인지부터 갈라야 한다. curl이 접속 한 번의 시간표를 전부 준다:

```bash
curl -so /dev/null -w 'dns %{time_namelookup}s | tcp %{time_connect}s | tls %{time_appconnect}s | ttfb %{time_starttransfer}s | total %{time_total}s\n' https://example.com
```

```text
dns 0.064100s | tcp 0.099501s | tls 0.138247s | ttfb 0.175943s | total 0.175986s
```

**읽을 곳**: 이 값들은 시작점부터의 **누적 시각**이라 구간은 빼서 계산한다 — DNS 64ms, TCP 핸드셰이크 35ms(0.099−0.064), TLS 39ms, **서버 처리 38ms**(ttfb−tls). 어느 구간이 비대한지에 따라 범인이 다르다: dns가 크면 리졸버, tcp가 크면 RTT(= 2절의 영역), tls가 크면 인증서 체인이나 TLS 설정, ttfb−tls가 크면 서버 애플리케이션.

**함정**: 첫 요청과 두 번째 요청은 다르다(DNS 캐시, TLS 세션 재사용, keep-alive). 몇 번 반복해서 패턴을 보고, 재현 조건(캐시 유무)을 명시해 둔다.

## 8. 최후의 수단 — `tcpdump`

위 도구들이 전부 "정상인데 안 된다"고 말할 때만 내려온다. 패킷은 거짓말하지 않지만, 캡처는 비싸고 읽는 시간은 더 비싸다.

```bash
tcpdump -ni eth0 -c 20 'tcp port 443'            # -n 필수: DNS 역질의로 캡처가 느려지는 것 방지
tcpdump -ni eth0 'host 10.0.0.5 and tcp port 5201'
tcpdump -ni eth0 'tcp[tcpflags] & (tcp-syn|tcp-rst) != 0'   # 접속 시도와 거절만
tcpdump -ni eth0 -w dump.pcap 'port 443'         # 저장해서 Wireshark로
```

```text
04:35:09.022043 IP 172.17.0.2.36152 > 104.20.23.154.443: Flags [S], seq 1422274521, ... length 0
04:35:09.057410 IP 104.20.23.154.443 > 172.17.0.2.36152: Flags [S.], seq 2700593678, ack 1422274522, ...
04:35:09.057440 IP 172.17.0.2.36152 > 104.20.23.154.443: Flags [.], ack 1, win 502, ...
04:35:09.058589 IP 172.17.0.2.36152 > 104.20.23.154.443: Flags [P.], seq 1:518, ack 1, ... length 517
```

**읽을 곳**: 위는 TCP 3-way 핸드셰이크가 그대로 잡힌 것이다 — `[S]`(SYN) → `[S.]`(SYN+ACK) → `[.]`(ACK), 그리고 첫 데이터 `[P.]`(PSH). 실무에서 가장 많이 확인하는 패턴 셋: **SYN만 반복**(상대 무응답 — 방화벽/라우팅), **SYN에 `[R]`(RST) 응답**(포트 닫힘 — 서비스가 안 떠 있음), **핸드셰이크 후 한참 뒤 RST**(중간 장비의 세션 타임아웃).

**함정**: 필터 없이 캡처하면 캡처 자체가 부하가 되고 `packets dropped by kernel`이 뜬다 — 필터는 커널(BPF)에서 걸리므로 **항상 필터와 `-c`(개수 제한)를 걸고 시작**한다. 더 깊은 분석 요령은 [트래픽 측정 글]({{< ref "/posts/network-traffic-check" >}})의 패킷 캡처 절에.

## 정리: 증상 → 첫 명령

| 증상 | 첫 명령 | 다음 |
|---|---|---|
| 아예 안 된다 | `ip -s link` (링크·에러) | `ping` 게이트웨이 → 외부 IP → DNS 순서로 어디서 끊기나 |
| 느리다 — 항상 | `ethtool`(협상 속도) | `iperf3`로 구간 실측, 서버 위치 옮겨 가며 좁히기 |
| 느리다 — 가끔 | `mtr -rn -c 100` 걸어 두기 | `sar -n DEV` 구간별 행에서 마이크로버스트 확인 |
| 특정 서비스만 느리다 | `curl -w` 시간 분해 | 범인 구간에 따라 `ss -ti`(RTT·재전송) 또는 서버 쪽 조사 |
| 연결이 쌓인다/끊긴다 | `ss -s`, `ss -ti` | Send-Q/Recv-Q로 네트워크 탓 vs 앱 탓 판정 |
| 위 전부가 "정상"이라는데 안 된다 | `tcpdump` + 필터 | SYN/RST 패턴 확인, `-w`로 저장해 Wireshark |

외울 것은 명령 옵션이 아니라 이 표의 **왼쪽 열에서 오른쪽 열로 가는 길**이다. 질문이 정확하면 명령은 하나로 좁혀지고, 출력에서 볼 필드도 두어 개로 줄어든다 — 나머지는 man 페이지가 기억해 준다.
