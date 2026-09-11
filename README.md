# DBPod

DBPod는 PostgreSQL에 연결해 SQL을 실행하고, 조회 결과를 탐색·복사·추가·편집할 수 있는 크로스 플랫폼 데이터베이스 클라이언트입니다.

첫 번째 MVP는 데스크톱 애플리케이션과 PostgreSQL 지원에 집중합니다. 다만 UI, 상태 모델, Rust Core의 경계는 처음부터 Android와 iOS를 함께 고려해 설계합니다.

## 현재 사용 가능한 버전

macOS 데스크톱 MVP의 연결·SQL 실행·멀티탭·안전한 편집 흐름을 구현했습니다. 아래 제품 방향과 상세 명세에는 후속 작업도 포함됩니다. 검증된 범위와 남은 릴리스 조건은 [구현 현황](docs/plan/progress.md), [설계·구현 검토와 수정 기록](docs/quality/hardening-review-2026-09-08.md)을 확인하세요.

```bash
pnpm install --frozen-lockfile
pnpm tauri dev
```

검증: `pnpm test`, `pnpm typecheck`, `cargo test --manifest-path src-tauri/Cargo.toml`. PostgreSQL 통합 테스트에는 Docker가 필요합니다. macOS 앱 생성은 `pnpm tauri build --bundles app`입니다. 서명·공증은 별도 릴리스 단계입니다.

첫 화면의 저장된 연결은 카드 오른쪽 손잡이를 드래그해 순서를 바꿀 수 있습니다. 손잡이에 키보드 초점을 둔 뒤 ↑/↓ 키로도 이동할 수 있으며, 순서는 앱을 다시 실행해도 유지됩니다.

접속 중에는 왼쪽 연결 목록 상단의 **HOME** 버튼으로 연결을 유지한 채 저장된 연결 목록을 볼 수 있습니다. 연결 아이콘 아래의 **+** 버튼으로도 연결 관리 화면을 열어 새 연결을 추가할 수 있습니다. 연결 아이콘을 누르면 기존 SQL 초안과 결과로 돌아옵니다. 입력 영역 밖에서 Backspace를 눌러도 화면이 이동하지 않습니다.

연결 후 탐색기 상단의 **데이터베이스**에서 서버의 모든 DB를 확인하고 현재 연결의 DB를 변경할 수 있습니다. 새 연결 항목은 생기지 않으며 접속 불가 DB는 비활성화됩니다. 최초 연결은 프로필에 저장된 DB를 사용합니다. DB 전환 전에 SQL 초안을 저장하고 대상 DB의 초안을 복원하며, 이전 DB의 조회 결과·테이블·정의 코드 탭은 닫습니다. 미저장 편집은 폐기 확인을 받고, 실행 중인 쿼리·열린 트랜잭션·저장 작업이 있으면 전환을 차단합니다. 스키마 아래 **Tables / Functions** 폴더를 펼치면 각각 테이블·뷰와 함수·프로시저 목록이 표시됩니다. 파티션은 부모 테이블 아래에 표시합니다.

**Functions**에서 함수나 프로시저를 클릭하면 읽기 전용 탭에 정의 SQL이 표시됩니다. 같은 항목을 다시 클릭하면 기존 탭으로 이동하며, **새로고침**으로 최신 정의를 다시 조회할 수 있습니다.

연결 화면에서 **Cmd/Ctrl+D** 또는 탭 목록 옆의 **◫** 버튼을 누르면 탭 목록·에디터·결과를 포함한 작업 영역이 좌우로 분할됩니다. 각 영역의 **+** 버튼으로 탭을 추가하고 독립적으로 전환할 수 있으며, **Ctrl+Tab / Cmd/Ctrl+1~9**도 선택한 영역 안에서 동작합니다. 상단 실행·중지는 선택한 영역의 탭에 적용됩니다. 마지막 탭을 닫거나 **분할 영역 닫기**를 누르면 남은 영역이 공간을 채웁니다. HOME이나 다른 연결을 다녀와도 분할 상태와 SQL·결과는 유지되며, 앱을 다시 실행하면 SQL 초안을 일반 탭으로 복원합니다.

결과 그리드의 행번호를 클릭하거나 셀을 선택한 뒤 **Shift+Space**를 누르면 행 전체가 선택됩니다. 삭제는 **선택 행 삭제** 버튼으로 표시한 후 저장해야 반영됩니다. 쿼리 결과는 처음 200행을 표시하고 아래로 스크롤하면 200행씩 추가로 가져옵니다. SQL은 한 번만 실행하며 고정된 최대 행 수 제한은 없습니다. 기존 연결의 `maxRows` 설정도 쿼리 결과를 잘라내지 않습니다. 메모리 보호 한도(결과 512MiB / 연결 1GiB / 앱 2GiB)에 도달하면 결과 보관을 중단하고 상태 표시줄에 알립니다. 이 값은 24GB 메모리의 데스크톱에 맞춘 고정 기본값이며, 보존량은 원본 크기의 4배와 컬럼당 256바이트로 추정합니다(실제 프로세스 메모리 상한은 아님). CSV·JSON 내보내기와 선택 영역 없는 전체 복사는 아직 표시하지 않은 보관 결과도 포함합니다.

## 문서

구현 기준과 문서 읽기 순서는 [`docs/README.md`](docs/README.md)에 정리되어 있습니다.

- [제품 명세](docs/product/product_spec.md)
- [화면 디자인 명세](docs/spec/design_spec.md)
- [쿼리 실행 명세](docs/spec/query_execution_spec.md)
- [데이터 편집 명세](docs/spec/data_editing_spec.md)
- [애플리케이션 아키텍처](docs/architecture/architecture.md)
- [IPC 계약](docs/architecture/ipc_contract.md)
- [위협 모델](docs/security/threat_model.md)
- [MVP 상세 구현 계획](docs/plan/plan-mvp.md)

## 제품 방향

- 데스크톱 우선 개발 및 출시
- Windows, macOS, Linux 지원
- 동일한 React UI와 Rust Core를 활용한 Android, iOS 확장
- MVP 데이터베이스는 PostgreSQL만 지원
- MySQL 등 다른 RDBMS는 후속 단계에서 지원
- 사용자가 작성한 SQL 실행
- 탭 기반 쿼리 워크스페이스
- 대용량 결과 탐색
- 조회 결과 복사 및 붙여넣기를 통한 레코드 생성
- 조회 결과 셀 편집 및 트랜잭션 저장
- 보안을 부가 기능이 아닌 기본 아키텍처 제약으로 적용

## 기술 스택

### 애플리케이션

- React
- TypeScript
- Vite
- Tauri 2
- Rust
- SQLx
- PostgreSQL
- Tailwind CSS
- CodeMirror 6

모바일 지원이 필요하므로 공식적으로 모바일 브라우저를 지원하지 않는 Monaco Editor 대신 CodeMirror 6를 SQL 에디터로 사용합니다.

### TanStack

| 역할 | 라이브러리 |
| --- | --- |
| 화면 라우팅 | `@tanstack/react-router` |
| DB 메타데이터 및 비동기 상태 | `@tanstack/react-query` |
| 조회 결과 테이블 모델 (후속 정렬·고정·리사이즈) | `@tanstack/react-table` |
| 대용량 행 렌더링 | `@tanstack/react-virtual` |
| 연결 설정 및 입력 폼 | `@tanstack/react-form` |

TanStack Start는 사용하지 않습니다. Tauri에 번들되는 SPA이므로 SSR과 서버 함수가 필요하지 않으며 Vite와 TanStack Router를 직접 조합합니다.

워크스페이스와 실행 결과는 연결별 외부 저장소에서 관리하고 React는 `useSyncExternalStore`로 구독합니다. 화면을 전환해도 원래 연결의 실행 상태가 갱신됩니다. SQL 초안과 탭 배치는 OS Keychain 키로 암호화한 로컬 스냅샷에 저장하고, 결과·편집 버퍼·이력은 메모리에만 유지합니다.

### TanStack 사용 원칙

- 연결 목록, 스키마, 테이블 목록과 테이블 데이터 페이지 조회에는 TanStack Query를 사용합니다.
- 임의 SQL 실행, INSERT, UPDATE, DELETE는 자동 재실행을 방지하기 위해 mutation으로 처리합니다.
- Router URL과 search parameter에는 SQL, 비밀번호, connection string을 저장하지 않습니다.
- 동적 쿼리 탭은 route가 아닌 워크스페이스 상태로 관리합니다.
- 현재 그리드는 TanStack Virtual을 사용합니다. TanStack Table 기반 열 모델은 후속 작업입니다.
- 셀 편집, 범위 선택, 복사 및 TSV 붙여넣기는 DBPod Grid 계층에서 구현합니다.
- TanStack Table에는 가상화가 내장되어 있지 않으므로 TanStack Virtual을 조합합니다.
- 조회 결과 Query cache는 디스크에 영속화하지 않습니다.
- 탭이나 연결을 닫거나 앱이 잠기면 관련 결과 cache를 제거합니다.
- 프로덕션 빌드에는 TanStack Devtools를 포함하지 않습니다.

## 아키텍처

```text
React UI
├── Connection Manager
├── Schema Explorer
├── Query Tabs
├── CodeMirror SQL Editor
└── TanStack Result Grid
         │
         │ 제한된 Tauri IPC
         ▼
Rust Core
├── Credential Vault
├── Connection Manager
├── PostgreSQL Query Executor
├── Query Cancellation
├── Result and Type Converter
├── Record Editor
└── Transaction Manager
         │
         │ SQLx + TLS
         ▼
PostgreSQL
```

React WebView는 신뢰할 수 없는 경계로 취급합니다. React에서 데이터베이스에 직접 연결하거나 connection string을 조립하지 않습니다. PostgreSQL 연결, 쿼리 실행, 취소, 편집 저장은 제한된 사용자 정의 Tauri command를 통해 Rust Core에서 수행합니다.

공식 `tauri-plugin-sql`은 프로토타입에 사용할 수 있지만, DBPod는 다중 연결 풀, 쿼리 취소, 대용량 결과, 타입 변환, 보안 자격 증명과 편집 트랜잭션이 필요하므로 제품 구현에는 사용자 정의 Rust 계층과 SQLx를 사용합니다.

## MVP 기능

### 연결

- PostgreSQL 연결 프로필 생성, 수정, 삭제
- 연결 테스트
- 여러 연결 동시 관리
- 연결별 쿼리 탭
- TLS 및 사용자 CA 인증서 설정
- 읽기 전용 연결 프로필
- 연결 종료 및 자동 잠금

### 쿼리 워크스페이스

- 탭 생성, 닫기, 이름 변경
- 탭별 연결과 SQL 초안 유지
- 현재 선택 영역 또는 현재 SQL 구문 실행
- 현재 결과를 교체하는 기본 실행
- 이전 결과를 유지하는 새 Result Tab 실행
- 실행 중인 쿼리 취소
- 실행 시간, 영향받은 행 수 및 오류 표시
- 결과 행 수 제한과 추가 로딩
- 앱 재실행 시 SQL 탭 복원
- 쿼리 결과는 기본적으로 디스크에 자동 저장하지 않음

예상 탭 모델은 다음과 같습니다.

```ts
type QueryTab = {
  id: string
  connectionId: string
  title: string
  sql: string
  status: 'idle' | 'running' | 'success' | 'error'
  resultTabs: ResultTab[]
  activeResultTabId?: string
  isDirty: boolean
}
```

### 기본 단축키

| 동작 | 단축키 |
| --- | --- |
| 현재 선택 SQL 또는 현재 구문 실행 | `Cmd/Ctrl + Enter` |
| 새 Result Tab에서 실행 | `Cmd/Ctrl + Shift + Enter` |
| 현재 실행 취소 | `Esc` 또는 `Cmd/Ctrl + .` |
| 현재 탭 닫기 | `Cmd/Ctrl + W` |
| 다음 탭 | `Ctrl + Tab` |
| 이전 탭 | `Ctrl + Shift + Tab` |
| 다음/이전 패널 | `Cmd/Ctrl + Shift + →/←` |
| 다음/이전 탭 | `Cmd/Ctrl + Option/Alt + →/←` |
| 탭 직접 이동 | `Cmd/Ctrl + 1~9` |
| 그리드 행 전체 선택 | `Shift + Space` |
| 그리드 선택 영역 복사 | `Cmd/Ctrl + C` |

탭 이동은 패널 경계를 이어서 마지막 탭 다음에 다음 패널의 첫 탭을 열고, 전체 마지막 탭과 첫 탭도 순환합니다. 설정 화면에서 모든 단축키를 변경하거나 기본값으로 복원할 수 있습니다. 이 단축키는 앱 내부 key binding으로 구현합니다. OS 전역 단축키 플러그인에 의존하지 않습니다. 외장 키보드가 연결된 모바일에서도 동일하게 동작해야 하며, 모든 단축키 기능에는 터치로 실행할 수 있는 UI도 제공합니다.

### Result Tab

기본 쿼리 실행 1회는 Query Tab 아래에 결과 하나를 표시합니다. Result Tab의 단위는 SQL 문장이 아니라 실행 결과 스냅샷입니다.

- 첫 기본 실행은 `Result 1`을 생성합니다.
- `Cmd/Ctrl + Enter`로 다시 실행하면 현재 Result Tab의 내용을 교체합니다.
- `Cmd/Ctrl + Shift + Enter`로 실행하면 이전 결과를 유지하고 새 Result Tab을 생성합니다.
- 선택 영역이 있으면 선택된 SQL을, 없으면 커서가 있는 현재 SQL 구문을 실행합니다.
- Pin된 결과나 저장하지 않은 편집 내용이 있는 결과는 기본 실행으로 덮어쓰지 않습니다.
- 보호된 결과를 활성화한 상태에서 기본 실행하면 자동으로 새 Result Tab을 생성합니다.
- 서로 다른 Query Tab에서는 동시에 실행할 수 있지만 MVP에서는 Query Tab 하나당 하나의 실행만 허용합니다.
- 결과 데이터는 디스크에 자동 저장하지 않으며 앱 재실행 시 SQL 탭만 복원합니다.

```ts
type ResultTab = {
  id: string
  title: string
  executionId: string
  executedSql: string
  executedAt: string
  status: 'running' | 'success' | 'error' | 'cancelled'
  rowCount?: number
  durationMs?: number
  isPinned: boolean
  isEditable: boolean
  pendingChangeCount: number
}
```

Query Toolbar에는 기본 실행과 새 결과 실행을 모두 제공합니다.

```text
[▶ Run] [▶＋] [Stop]

Run menu
├── Run
├── Run in New Result Tab
└── Explain
```

모바일에서도 길게 누르기에만 의존하지 않고 `Run`과 `Run in New Result`를 명시적인 버튼 또는 메뉴 명령으로 제공합니다.

### 결과 테이블

- 정렬
- 열 크기 변경
- 열 고정
- 행 및 셀 선택
- 행 가상화
- 복사 가능한 TSV 출력
- 셀 편집
- 변경사항 표시
- 저장 및 취소
- 신규 행 입력
- 여러 행 붙여넣기 미리보기
- CSV 및 JSON 내보내기

결과 그리드는 다음 책임을 분리합니다.

```text
TanStack Table
├── 컬럼과 행 모델
├── 정렬
├── 열 크기 및 고정
└── 선택과 편집 상태
        +
TanStack Virtual
└── 화면에 보이는 행만 렌더링
        +
DBPod Grid Layer
├── 셀 에디터
├── TSV 복사 및 붙여넣기
├── 신규 레코드 생성
├── 변경사항 추적
└── 저장 및 취소
```

### 붙여넣기를 통한 레코드 생성

- 스프레드시트와 호환되는 TSV 형식을 기본으로 사용합니다.
- 선택된 시작 셀 또는 신규 행 영역을 기준으로 값을 매핑합니다.
- 모바일에서는 별도의 Import Sheet에서 붙여넣기 결과를 미리 봅니다.
- 컬럼 타입에 따라 값을 검증합니다.
- `NULL`, 빈 문자열, PostgreSQL 기본값을 서로 구분합니다.
- 여러 행은 하나의 트랜잭션으로 INSERT합니다.
- 모든 값은 SQL 문자열 결합이 아닌 bind parameter로 전달합니다.
- 오류 발생 시 전체 롤백하고 실패한 행과 컬럼을 표시합니다.

### 조회 결과 편집

모든 SQL 결과를 안전하게 편집할 수 있는 것은 아닙니다. JOIN, 집계, 서브쿼리 결과는 원본 레코드가 모호하므로 MVP에서는 다음 조건을 만족할 때만 편집을 허용합니다.

- 단일 base table 결과
- Primary Key 또는 안전하게 식별할 수 있는 unique key 존재
- 수정 대상 컬럼의 원본 테이블과 컬럼을 식별할 수 있음

JOIN, 집계, 식별 키가 없는 결과는 읽기 전용으로 표시합니다.

편집 저장 시에는 다음 규칙을 적용합니다.

- `WHERE primary_key = ...` 조건 사용
- 모든 변경값에 bind parameter 사용
- 여러 셀 변경을 하나의 명시적 트랜잭션으로 저장
- PostgreSQL `xmin` 등의 버전 정보를 사용한 optimistic locking
- 저장 전후 영향받은 행 수 검증
- 다른 사용자의 변경이 감지되면 자동 덮어쓰기 금지

파괴적인 쿼리 확인 기능은 사고 방지 UX이며 보안 경계로 간주하지 않습니다. 실제 권한 경계는 PostgreSQL Role과 권한 설정입니다.

## 데스크톱과 모바일

개발 및 출시 순서는 데스크톱 우선입니다. 하지만 CSS와 컴포넌트는 Tailwind의 모바일 우선 방식으로 작성하고 넓은 화면에서 기능을 확장합니다.

상세 화면 구조, 왼쪽 사이드바, Connection Workspace, Work Tab과 Result Tab 명세는 [`docs/spec/design_spec.md`](docs/spec/design_spec.md)를 기준으로 합니다.

| 화면 | 기본 UI |
| --- | --- |
| 모바일 `< md` | 스키마 Drawer, 에디터와 결과 전환, 하단 실행 버튼 |
| 태블릿 `md` | 접이식 탐색기, 에디터와 결과의 세로 분할 |
| 데스크톱 `lg+` | 고정 탐색기, 쿼리 탭, 리사이즈 가능한 에디터 및 결과 분할 |

OS 종류가 아니라 실제 사용 가능한 화면과 컨테이너 크기를 기준으로 레이아웃을 변경합니다. 따라서 작은 데스크톱 창도 compact UI로 전환됩니다.

### 데스크톱 상호작용

- 셀 더블클릭 인라인 편집
- 에디터와 결과 동시 표시
- 리사이즈 가능한 패널
- 마우스 드래그 범위 선택
- 키보드 중심 탐색과 TSV 복사 및 붙여넣기

### 모바일 상호작용

- 셀 터치 시 Bottom Sheet 또는 전체 화면 편집기 표시
- `Editor / Result` 세그먼트 전환
- 스키마 탐색기 Drawer
- 붙여넣기 전용 Import Sheet
- 수평 스크롤 가능한 결과 그리드
- 행 전체를 위한 별도 상세 편집 화면
- 터치 실행 버튼과 외장 키보드 단축키 동시 지원
- 앱이 백그라운드로 이동하면 민감한 화면 미리보기 가림

### Tailwind CSS 원칙

- 기본 utility는 모바일 레이아웃으로 작성하고 `md:`, `lg:`에서 확장합니다.
- 리사이즈 가능한 패널 내부에서는 container query를 활용합니다.
- 색상값을 컴포넌트에 직접 반복하지 않고 semantic design token을 사용합니다.
- Light, Dark, System 테마를 지원합니다.
- 데스크톱은 compact density, 터치 환경은 comfortable density를 기본으로 합니다.
- `pointer-coarse:`로 터치 대상과 셀 간격을 확대합니다.
- hover에서만 접근할 수 있는 기능을 만들지 않습니다.
- `focus-visible`, 키보드 탐색, ARIA 상태를 지원합니다.
- `prefers-reduced-motion`과 고대비 환경을 고려합니다.
- 모바일 safe area와 동적 viewport 높이를 반영합니다.
- 폰트, 아이콘, CSS는 앱에 번들링하며 CDN을 사용하지 않습니다.

기본 검증 화면 크기는 다음과 같습니다.

- 360×800: 소형 모바일
- 768×1024: 태블릿
- 1024×640: 작은 데스크톱 창
- 1440×900: 일반 데스크톱

각 화면에서 터치 입력과 마우스·키보드 입력을 별도로 검증합니다.

## 보안

DBPod는 데이터베이스 비밀번호, 인증서, 임의 SQL 실행 권한과 민감할 수 있는 조회 결과를 다룹니다. 보안 요구사항은 MVP 완료 조건에 포함됩니다.

### Tauri와 IPC

- React WebView를 신뢰하지 않습니다.
- 로컬에 번들된 애플리케이션 코드만 Tauri IPC에 접근할 수 있습니다.
- Tauri capability는 필요한 window, webview와 command만 허용합니다.
- remote capability를 활성화하지 않습니다.
- Shell, 파일 시스템, 외부 HTTP 등 불필요한 플러그인 권한을 허용하지 않습니다.
- Rust command 입력을 구조적으로 검증하고 크기 제한을 적용합니다.
- CSP를 활성화하고 최대한 제한적으로 설정합니다.
- 원격 JavaScript, CSS, 폰트와 CDN을 로드하지 않습니다.
- `unsafe-eval`을 허용하지 않습니다.

### 자격 증명

```ts
type ConnectionProfile = {
  id: string
  host: string
  port: number
  database: string
  username: string
  credentialId: string
  tlsMode: 'verify-full' | 'verify-ca' | 'insecure'
}
```

- 프로필에는 비밀값 대신 불투명한 `credentialId`만 저장합니다.
- 비밀번호, 클라이언트 개인키와 민감한 인증서는 일반 설정 파일에 저장하지 않습니다.
- 자격 증명은 OS Keychain/Keystore와 암호화된 vault에 저장합니다.
- 암호화 키를 일반 Tauri Store나 설정 JSON에 저장하지 않습니다.
- 실제 connection string은 Rust Core에서만 구성합니다.
- 비밀번호는 입력 후 React form state에서 즉시 제거합니다.
- 저장된 비밀번호와 개인키를 React로 다시 반환하지 않습니다.
- 로그, 오류 메시지와 디버그 출력에서 비밀값을 마스킹합니다.
- 일정 시간 미사용 시 연결을 종료하고 vault를 잠급니다.

### 네트워크와 TLS

- PostgreSQL 연결 기본값은 `verify-full`입니다.
- SQLx의 기본 `Prefer` 모드를 그대로 사용하지 않습니다.
- 서버 인증서의 CA와 호스트 이름을 모두 검증합니다.
- 사용자 CA 인증서와 필요 시 mTLS를 지원합니다.
- `insecure` 연결은 명시적인 경고와 재확인 없이는 사용할 수 없습니다.
- 모바일 기기에서 PostgreSQL을 공용 인터넷에 직접 노출하지 않습니다.
- 사내 및 개발 환경의 모바일 연결은 VPN 사용을 기본으로 합니다.
- 일반 서비스 형태의 모바일 연결은 HTTPS 또는 WebSocket 게이트웨이를 사용합니다.

### 데이터베이스 권한과 쿼리 안전

- 운영 데이터베이스에서 superuser 연결을 사용하면 경고합니다.
- 읽기 전용 Role과 편집용 최소 권한 Role 분리를 권장합니다.
- 읽기 전용 프로필에서는 PostgreSQL 권한과 `READ ONLY` 트랜잭션을 함께 사용합니다.
- `DROP`, `TRUNCATE`, 대량 `DELETE/UPDATE`에는 실행 전 확인 단계를 제공합니다.
- 문장 판별이 필요할 때 정규식이 아니라 PostgreSQL parser를 사용합니다.
- 쿼리 timeout, 최대 결과 행 수와 실행 취소를 지원합니다.
- 앱에서 생성하는 INSERT, UPDATE, DELETE는 항상 bind parameter를 사용합니다.
- 여러 행 변경은 트랜잭션으로 처리합니다.
- 사용자가 직접 작성한 임의 SQL은 애플리케이션이 완전히 안전하게 만들 수 없으므로 PostgreSQL Role을 최종 권한 경계로 사용합니다.

### 조회 결과, 기록과 클립보드

- 조회 결과를 기본적으로 디스크에 자동 저장하지 않습니다.
- Query cache를 영속화하지 않습니다.
- 탭 종료, 연결 종료, 앱 잠금 시 메모리의 관련 결과를 제거합니다.
- 쿼리 이력은 암호화 저장하거나 사용자가 비활성화할 수 있게 합니다.
- 쿼리 텍스트와 결과값을 일반 로그에 남기지 않습니다.
- 로그에는 기본적으로 실행 시간, 행 수와 오류 코드 등 비민감 메타데이터만 기록합니다.
- 복사는 반드시 사용자의 명시적인 동작으로만 수행합니다.
- 비밀번호와 개인키 필드는 클립보드 복사를 허용하지 않습니다.
- 민감 결과의 클립보드 자동 삭제 옵션을 제공합니다.
- CSV 내보내기에는 spreadsheet formula injection 방어 옵션을 제공합니다.
- 임시 평문 결과 파일을 남기지 않습니다.

### 배포와 공급망

- 데스크톱 앱 바이너리를 플랫폼별로 코드 서명합니다.
- Tauri updater의 서명 검증을 사용합니다.
- 업데이트 서명 개인키는 CI 보안 저장소에서만 관리합니다.
- `pnpm-lock.yaml`과 `Cargo.lock`을 커밋합니다.
- CI에서 Rust 및 npm 의존성 취약점을 검사합니다.
- `cargo audit`, `cargo deny`와 npm 패키지 검사를 적용합니다.
- 프로덕션 sourcemap을 외부에 공개하지 않습니다.
- 프로덕션 빌드에서 디버그 로그와 개발자 도구를 제거합니다.

### 보안 완료 조건

- 비밀번호와 개인키가 로그, URL, Router state, Query cache 또는 일반 설정 파일에 남지 않아야 합니다.
- PostgreSQL TLS `verify-full`이 기본이어야 합니다.
- remote Tauri capability가 없어야 합니다.
- 각 Tauri command가 최소 권한 capability로 제한되어야 합니다.
- 앱이 생성하는 모든 쓰기 SQL이 bind parameter를 사용해야 합니다.
- 탭과 연결 종료 시 민감한 결과 cache가 제거되어야 합니다.
- 프로덕션 업데이트는 유효한 서명 없이는 설치되지 않아야 합니다.

## 개발 단계

### 1. 기반

- Vite + React + TypeScript 프로젝트
- Tauri 2 데스크톱 및 모바일 타깃
- Tailwind CSS와 design token
- TanStack Router와 애플리케이션 shell
- Tauri capability와 CSP
- Rust 오류 모델과 IPC 타입

### 2. PostgreSQL 연결

- 보안 credential vault
- SQLx PostgreSQL 연결 풀
- TLS `verify-full`
- 연결 테스트 및 lifecycle
- 스키마와 테이블 탐색

### 3. 쿼리 워크스페이스

- CodeMirror SQL 에디터
- 쿼리 탭
- 실행 결과 멀티탭
- 현재 결과 실행 및 새 Result Tab 실행
- 단축키
- 실행, timeout 및 취소
- 결과 타입 변환

### 4. 결과 그리드

- TanStack Table
- TanStack Virtual
- 복사 및 내보내기
- 셀 편집과 변경사항 추적
- optimistic locking 저장
- TSV 붙여넣기와 일괄 INSERT

### 5. 크로스 플랫폼 검증

- Windows, macOS, Linux
- Android, iOS responsive UI
- 터치, 마우스, 키보드 입력
- 모바일 background privacy
- 성능, 접근성 및 보안 테스트

## 라이선스

DBPod는 [Apache License 2.0](LICENSE)으로 배포되는 오픈소스 프로젝트입니다.

## 참고 자료

- [Tauri 2](https://v2.tauri.app/)
- [Tauri Security](https://v2.tauri.app/security/)
- [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
- [Tauri Content Security Policy](https://v2.tauri.app/security/csp/)
- [Tauri SQL Plugin](https://v2.tauri.app/plugin/sql/)
- [Tauri Stronghold](https://v2.tauri.app/plugin/stronghold/)
- [Tauri Updater](https://v2.tauri.app/plugin/updater/)
- [SQLx PostgreSQL](https://docs.rs/sqlx/latest/sqlx/postgres/)
- [TanStack Router](https://tanstack.com/router/latest)
- [TanStack Query](https://tanstack.com/query/latest)
- [TanStack Table](https://tanstack.com/table/latest)
- [TanStack Virtual](https://tanstack.com/virtual/latest)
- [TanStack Form](https://tanstack.com/form/latest)
- [Tailwind CSS Responsive Design](https://tailwindcss.com/docs/responsive-design)
- [CodeMirror](https://codemirror.net/)
- [OWASP Desktop App Security Top 10](https://owasp.org/www-project-desktop-app-security-top-10/)
