+++
title = "WPF 프로그램을 트레이로 내려 백그라운드에서 제어하기 — X버튼이 감시를 죽이면 안 된다"
date = 2026-08-31T15:00:00+09:00
draft = false
tags = ["C#", "WPF", "Windows", "트레이", "NotifyIcon"]
categories = ["개발"]
summary = "24시간 돌아야 하는 감시 프로그램인데 워치독이 UI 프로세스 안에 있다면, 운영자가 창을 닫는 순간 감시까지 죽는다. WPF 창을 트레이(알림 영역)로 내려 백그라운드에서 계속 돌리고, 우클릭 메뉴로 상태 확인·제어·진짜 종료를 제공하는 패턴을 정리했다. 외부 패키지 없이 WinForms NotifyIcon만 쓰고, 숨김/복귀/종료 전이 규칙은 순수 클래스로 빼서 단위 테스트로 고정한다. Windows 11 오버플로 영역, 툴팁 63자 예외, 아이콘 리소스 폴백, 중복 실행 시 기존 창 복귀까지 — 실제로 밟은 함정 순서대로."
+++

## 한 줄 요약

> 트레이 상주의 본질은 아이콘이 아니라 **수명주기 계약의 변경**이다 — "창 닫기 = 프로세스 종료"라는 기본 계약을
> "창 닫기 = 숨김, 종료는 명시적 요청만"으로 바꾸는 것이고, 그 전이 규칙이야말로 테스트로 고정할 대상이다.

## 왜 필요했나

현장 PC에서 24시간 돌아야 하는 카메라 감시 뷰어가 있다. 문제는 이 뷰어가 단순 표시기가 아니라는 것 —
캡처 엔진 프로세스를 **감시하고 재시작하는 워치독이 뷰어 안에** 있다. 운영자가 "화면만 끄려고" X버튼을 누르는 순간
워치독까지 같이 죽고, 그날 밤 엔진이 멈추면 아무도 되살리지 않는다.

해법은 셋 중 하나다: 워치독을 서비스로 분리하거나, X버튼을 막거나, **창을 닫아도 프로세스는 남기거나**.
서비스 분리는 옳지만 큰 공사고(세션 경계, UI 상호작용 제약), X버튼을 막으면 운영자와 싸우게 된다.
트레이 상주가 가장 싼 해법이다.

## 준비: 외부 패키지 없이

WPF에는 트레이 API가 없다. NuGet의 Hardcodet.NotifyIcon을 쓰는 글이 많은데, 오프라인 현장 PC에
의존성을 하나라도 덜 가져가려면 **WinForms의 `NotifyIcon`을 그대로 쓰면 된다** — .NET 데스크톱 SDK에
내장이라 csproj 한 줄이 전부다.

```xml
<PropertyGroup>
  <UseWPF>true</UseWPF>
  <UseWindowsForms>true</UseWindowsForms>  <!-- NotifyIcon용. WPF와 공존 가능 -->
</PropertyGroup>
```

## 핵심 1 — 전이 규칙을 순수 클래스로

X버튼이 눌렸을 때 "숨길지, 진짜 닫을지"는 UI 코드에 인라인하기 쉬운 판단인데, 여기엔 함정이 두 개 있다.

1. 풍선 알림("백그라운드에서 계속 실행 중")은 **최초 1회만** 떠야 한다 — 매번 뜨면 소음이다.
2. 종료 확인 팝업에서 "아니오"를 눌렀으면 종료 요청 상태를 **되돌려야** 한다 — 안 그러면 다음 X버튼이
   숨김 대신 종료로 빠진다. (실제로 처음 구현에서 빠뜨렸던 부분이다.)

이런 상태 전이는 WPF 없이 돌 수 있는 순수 클래스로 빼면 단위 테스트가 닿는다.

```csharp
public readonly record struct TrayCloseDecision(bool CancelClose, bool HideToTray, bool ShowBalloon);

public sealed class TrayLifecycle {
  private bool _balloonShown;
  public bool ExitRequested { get; private set; }

  public void RequestExit() => ExitRequested = true;
  public void CancelExit()  => ExitRequested = false;   // 종료 확인에서 '아니오'

  public TrayCloseDecision OnWindowClosing() {
    if (ExitRequested) return new(false, false, false);   // 진짜 종료 진행
    bool balloon = !_balloonShown;
    _balloonShown = true;
    return new(true, true, balloon);                      // 닫기 취소 + 숨김
  }
}
```

```csharp
[Fact] public void CancelExit_RestoresHideBehavior() {
  var t = new TrayLifecycle();
  t.RequestExit();
  t.CancelExit();
  var d = t.OnWindowClosing();
  Assert.True(d.CancelClose); Assert.True(d.HideToTray);   // '아니오' 후의 X는 다시 숨김
}
```

창 쪽 배선은 이제 얇다:

```csharp
protected override void OnClosing(CancelEventArgs e) {
  var d = _tray.OnWindowClosing();
  if (d.CancelClose) { e.Cancel = true; HideToTray(d.ShowBalloon); return; }

  var r = MessageBox.Show("프로그램을 종료하시겠습니까?", "종료 확인",
                          MessageBoxButton.YesNo, MessageBoxImage.Question);
  if (r != MessageBoxResult.Yes) { e.Cancel = true; _tray.CancelExit(); return; }
  // …실제 정리(자식 프로세스 종료 등)…
  base.OnClosing(e);
}

// 사이드바 '종료' 버튼과 트레이 메뉴 '종료'는 같은 경로
private void OnExit(object s, RoutedEventArgs e) { _tray.RequestExit(); Close(); }
```

## 핵심 2 — 트레이 아이콘과 메뉴

```csharp
private NotifyIcon? _trayIcon;
private ToolStripMenuItem? _trayStatusItem;

private void SetupTrayIcon() {
  var menu = new ContextMenuStrip();

  // 상태줄: 클릭 대상이 아니라 표시용. 메뉴가 '열리는 순간' 최신 값으로 갱신한다.
  _trayStatusItem = new ToolStripMenuItem("카메라 상태 —") { Enabled = false };
  menu.Items.Add(_trayStatusItem);
  menu.Items.Add(new ToolStripSeparator());
  menu.Opening += (_, _) => _trayStatusItem.Text = FormatCameraLine(_lastOnline);

  menu.Items.Add("UI 열기", null, (_, _) => Dispatcher.Invoke(ShowFromTray));
  menu.Items.Add("엔진 재시작", null, (_, _) => Dispatcher.Invoke(RestartWorker));
  menu.Items.Add("데이터 폴더 열기", null, (_, _) => Dispatcher.Invoke(OpenDataFolder));
  menu.Items.Add(new ToolStripSeparator());
  menu.Items.Add("종료", null, (_, _) => Dispatcher.Invoke(() => { _tray.RequestExit(); Close(); }));

  _trayIcon = new NotifyIcon { Text = "MyApp — 감시 동작 중", ContextMenuStrip = menu, Visible = true };

  // 아이콘: 설치본은 exe 옆 .ico, 개발 빌드는 파일이 출력 폴더에 없으므로 WPF 리소스(pack URI)로 폴백
  try { _trayIcon.Icon = new Icon(Path.Combine(AppContext.BaseDirectory, "app.ico")); }
  catch {
    var sri = System.Windows.Application.GetResourceStream(new Uri("pack://application:,,,/app.ico"));
    _trayIcon.Icon = sri != null ? new Icon(sri.Stream) : SystemIcons.Application;
  }
  _trayIcon.DoubleClick += (_, _) => Dispatcher.Invoke(ShowFromTray);
}

public void ShowFromTray() {
  Show();
  if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
  Activate();
}

private void HideToTray(bool balloon) {
  Hide();
  if (balloon)
    _trayIcon?.ShowBalloonTip(5000, "MyApp",
        "백그라운드에서 계속 실행 중입니다. 트레이 아이콘 우클릭 → 'UI 열기'로 복귀합니다.",
        ToolTipIcon.Info);
}

protected override void OnClosed(EventArgs e) {
  _trayIcon?.Dispose();   // 안 지우면 죽은 아이콘이 알림 영역에 남는다
  base.OnClosed(e);
}
```

메뉴 핸들러가 전부 `Dispatcher.Invoke`로 감싸인 이유: `NotifyIcon`의 이벤트는 WinForms 쪽 컨텍스트에서
올라오므로, WPF 창을 만지는 코드는 WPF 디스패처로 넘겨야 안전하다.

## 핵심 3 — 숨김 중에도 "일"은 계속되어야 한다

숨겼으니 CPU를 아끼겠다고 렌더 타이머를 통째로 멈추면 함정에 빠질 수 있다. 우리 경우 워치독의
"카메라 프레임이 신선한가" 판정이 **렌더 틱 안에서 갱신**되고 있었다 — 타이머를 멈추면 몇 분 뒤
워치독이 거짓 '전체 중단'을 선언하고 멀쩡한 엔진을 재시작한다.

그래서 타이머는 계속 돌리고 **비싼 단계(프레임 복사·그리기)만 건너뛴다**:

```csharp
public bool RenderSuspended { get; set; }   // 숨김 중 true

private void OnRenderTick(object? s, EventArgs e) {
  PollStatusAndFreshness();                  // 감시 로직의 입력 — 항상 수행
  if (RenderSuspended) return;               // 그리기만 생략
  RenderFrames();
}
```

일반화하면: **트레이 상주를 도입하는 순간 "UI 갱신"과 "상태 판정"의 의존 관계를 점검해야 한다.**
숨김 상태에서 굶는 로직이 있는지가 이 패턴의 진짜 난이도다.

## 핵심 4 — 중복 실행은 차단이 아니라 "복귀"

창이 트레이에 숨어 있으면 운영자는 프로그램이 꺼진 줄 알고 바탕화면 아이콘을 또 누른다.
단일 인스턴스 가드(Mutex)가 "이미 실행 중입니다" 안내만 띄우면 운영자는 더 혼란스럽다.
두 번째 인스턴스가 **기존 인스턴스의 창을 복귀시키는 신호**를 보내고 조용히 끝나게 한다.

```csharp
// 첫 인스턴스: 수신 대기
_showUiEvent = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\MyApp_ShowUi");
new Thread(() => {
  while (true) {
    try { _showUiEvent.WaitOne(); } catch { break; }        // 종료 중 dispose되면 탈출
    Dispatcher.Invoke(() => (MainWindow as MainWindow)?.ShowFromTray());
  }
}) { IsBackground = true }.Start();

// 두 번째 인스턴스: Mutex 획득 실패 시
try { using var ev = EventWaitHandle.OpenExisting(@"Local\MyApp_ShowUi"); ev.Set(); } catch { }
Environment.Exit(0);
```

## 밟았던 함정 목록

| 함정 | 내용 |
|---|---|
| **Windows 11 오버플로** | 새 트레이 아이콘은 기본적으로 `^`(숨겨진 아이콘) 안에 들어간다. "아이콘이 안 뜬다"의 8할은 이것. 항상 보이게 하려면 사용자가 작업표시줄로 드래그해야 한다(프로그램이 강제할 방법은 없다) |
| **`NotifyIcon.Text` 63자 제한** | 초과하면 예외가 난다. 상태를 툴팁에 욱여넣지 말고 짧은 요약("카메라 4/6")만, 상세는 메뉴 상태줄로 |
| **아이콘 리소스** | csproj에서 `<Resource Include="app.ico"/>`는 어셈블리에 임베드될 뿐 출력 폴더에 파일이 없다. 파일 경로 로드 실패 시 pack URI 폴백을 넣어야 개발 빌드에서도 아이콘이 나온다 |
| **Dispose** | `NotifyIcon`을 dispose하지 않고 종료하면 죽은 아이콘이 마우스를 올릴 때까지 알림 영역에 남는다 |
| **'아니오' 되돌리기** | 종료 확인을 취소했으면 `ExitRequested`를 리셋해야 다음 X버튼이 다시 '숨김'으로 동작한다 |
| **숨김 중 굶는 로직** | 렌더 타이머에 얹혀 살던 상태 판정이 있으면 타이머를 멈추는 순간 오판이 시작된다. 그리기만 끄고 폴링은 유지 |

## 정리

- 트레이 상주는 UI 장식이 아니라 **수명주기 계약 변경**이다. 전이 규칙(숨김/복귀/종료/취소)을 순수 클래스로
  빼서 테스트로 고정하면, 나중에 메뉴가 늘어나도 규칙은 흔들리지 않는다.
- WPF + WinForms `NotifyIcon` 조합은 csproj 한 줄로 끝난다. 외부 패키지가 필요 없다.
- 도입 전 점검 질문 하나: **"창이 안 보이는 동안에도 반드시 돌아야 하는 로직이 UI 갱신에 얹혀 있지 않은가?"**
  이 질문의 답이 이 패턴의 성패를 가른다.
