# DBPod 플랫폼 지원 매트릭스

- 상태: MVP 기준선
- 최종 수정일: 2026-07-27

## 1. 지원 등급

- Tier 1: CI build, automated E2E와 release artifact 제공
- Tier 2: CI build와 smoke test, best-effort support
- Experimental: build와 핵심 flow 검증, 정식 지원 약속 없음
- Unsupported: 알려진 비지원

## 2. Desktop OS

| Platform | 기준 | 등급 | 비고 |
| --- | --- | --- | --- |
| macOS | 13+ Apple Silicon/Intel | Tier 1 | 초기 개발 platform |
| Windows | Windows 10 22H2+, Windows 11 | Tier 1 | WebView2 runtime |
| Ubuntu | 22.04 LTS, 24.04 LTS | Tier 1 | AppImage 또는 적절한 package |
| Debian | 12+ | Tier 2 | WebKitGTK dependency |
| Fedora | 최신 2개 stable release | Tier 2 | package smoke |
| 기타 Linux | modern WebKitGTK 환경 | Experimental | community report 기반 |

최소 OS는 security update와 WebView compatibility에 따라 상향할 수 있다. 하향은 release gate 전체 검증 후에만 허용한다.

## 3. Mobile

| Platform | 기준 | 등급 | MVP |
| --- | --- | --- | --- |
| Android | Android 12+, arm64 | Experimental | build/UI/VPN direct connection smoke |
| iOS | iOS 16+, arm64 | Experimental | build/UI/VPN direct connection smoke |
| Android tablet | Android 12+ | Experimental | responsive tablet layout |
| iPadOS | iPadOS 16+ | Experimental | responsive tablet layout |

모바일 정식 배포, Gateway, App Store review와 background network behavior는 MVP 이후 범위다.

## 4. PostgreSQL

| Server | 등급 |
| --- | --- |
| PostgreSQL 14 | Tier 1 until upstream support end, then Tier 2 |
| PostgreSQL 15 | Tier 1 |
| PostgreSQL 16 | Tier 1, PR integration |
| PostgreSQL 17 | Tier 1 |
| PostgreSQL 18 | Tier 1, PR integration |
| PostgreSQL 13 이하 | Unsupported |
| CockroachDB/Yugabyte 등 protocol-compatible | Experimental/Unsupported by default |

extension type은 unknown text fallback을 제공하지만 extension 기능 자체를 공식 지원하는 것은 아니다.

## 5. 기능 매트릭스

| 기능 | Desktop | Android/iOS |
| --- | --- | --- |
| PostgreSQL direct TLS | Tier 1 | Experimental, VPN 권장 |
| Connection Workspace | 지원 | 지원 |
| Query/Result Tabs | 지원 | 지원 |
| Query keyboard shortcuts | 지원 | external keyboard |
| Inline cell edit | 지원 | Bottom Sheet/full-screen |
| TSV clipboard | 지원 | explicit paste flow |
| CSV/JSON export | 지원 | platform picker 검증 필요 |
| OS secure storage | 지원 | 지원 |
| Stronghold vault | 지원 | build/device 검증 |
| Auto updater | desktop 지원 | App Store 정책 사용 |
| Global shortcut | 사용하지 않음 | 사용하지 않음 |
| Multiwindow | MVP 제외 | 제외 |
| SSH Tunnel | MVP 제외 | 제외 |
| Gateway | 후속 | 후속 권장 |

## 6. Input matrix

| Input | Desktop | Tablet | Phone |
| --- | --- | --- | --- |
| Mouse/trackpad | Primary | Optional | Rare |
| Touch | Optional | Primary | Primary |
| Keyboard | Primary | Optional/external | Optional/external |
| Screen reader | VoiceOver/NVDA | VoiceOver/TalkBack | VoiceOver/TalkBack |

모든 shortcut 기능은 pointer/touch alternative를 가진다.

## 7. Build architecture

필수 release target:

- macOS arm64
- macOS x86_64 또는 universal
- Windows x86_64
- Linux x86_64

후속:

- Windows arm64
- Linux arm64
- Android arm64
- iOS arm64

## 8. 플랫폼 차이

### Secure storage

- Linux Secret Service가 없으면 master password를 요구한다.
- mobile은 hardware-backed key가 가능한 경우 사용한다.

### Clipboard

- mobile clipboard permission과 user gesture 정책을 따른다.
- auto-clear는 platform별 제한과 사용자의 기존 clipboard 손실을 안내한다.

### File export

- desktop은 native save dialog
- mobile은 platform document picker/share sheet
- 앱이 광범위한 filesystem capability를 가지지 않는다.

### Updater

- desktop은 Tauri signed updater
- mobile은 App Store/Play Store update channel

## 9. 검증 기기

최소 reference:

- Apple Silicon macOS
- Intel 또는 AMD Windows 11
- Ubuntu 24.04 x86_64
- Android emulator API 31 이상
- iOS simulator 16 이상

release 전 Tier 1 desktop은 실제 hardware smoke test를 포함한다.

## 10. 지원 변경

플랫폼 등급 변경 시:

- 이유와 날짜
- security/support 영향
- migration 안내
- 마지막 지원 release

를 release note와 이 문서에 기록한다.

