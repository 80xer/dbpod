# DBPod 디자인 시스템 명세

- 상태: MVP 기준선
- 최종 수정일: 2026-07-27

## 1. 기술

- Tailwind CSS
- semantic CSS custom properties
- accessible headless primitives
- Lucide 계열의 일관된 SVG icon set
- CodeMirror 6
- TanStack Table + Virtual

Dialog, Menu, Popover, Tooltip, Tabs와 Sheet는 검증된 accessible primitive를 사용하고 시각 스타일은 DBPod가 소유한다. third-party theme를 그대로 제품 외관으로 사용하지 않는다.

## 2. 원칙

- DB 작업이 주인공이며 chrome은 조용해야 한다.
- density는 높지만 text와 target을 희생하지 않는다.
- 상태를 색상만으로 표현하지 않는다.
- desktop mouse/keyboard와 mobile touch를 함께 지원한다.
- Light/Dark/System이 같은 의미 계층을 유지한다.
- remote font와 icon을 사용하지 않는다.

## 3. Token

### 3.1 Color role

```text
background
surface
surface-elevated
surface-muted
foreground
foreground-muted
border
border-strong
accent
accent-foreground
success
warning
danger
focus-ring
selection
grid-modified
grid-inserted
grid-deleted
grid-conflict
```

component에서 `blue-500`, `slate-900` 같은 palette 이름을 직접 사용하지 않고 role token을 사용한다.

### 3.2 Environment

| 환경 | 보조 색상 | 필수 text |
| --- | --- | --- |
| LOCAL | neutral | `LOCAL` |
| DEV | blue | `DEV` |
| STAGE | amber | `STAGE` |
| PROD | red | `PROD` |

색상은 보조 정보이며 badge text와 accessible label이 필수다.

### 3.3 Spacing

4px 기반 scale을 사용한다.

- 1: 4px
- 2: 8px
- 3: 12px
- 4: 16px
- 6: 24px
- 8: 32px

Grid와 compact toolbar는 2px 보조 spacing을 허용한다.

### 3.4 Radius

- cell/input: 4px
- button/menu item: 6px
- card/dialog: 8px
- sheet: platform layout에 맞는 상단 radius

데이터 Grid 자체에 과도한 rounded container를 사용하지 않는다.

### 3.5 Elevation

- base surface
- floating menu/popover
- modal/dialog

Dark theme에서는 shadow만으로 elevation을 표현하지 않고 border와 surface token을 함께 사용한다.

## 4. Typography

- UI: system UI font stack
- SQL/Grid monospace: local system monospace 우선
- user가 editor font family/size 설정 가능
- remote font download 금지

기본:

| 용도 | 크기 |
| --- | --- |
| Body | 13~14px desktop, 15~16px mobile |
| Compact label | 12px |
| Toolbar | 12~13px |
| Dialog title | 16~18px |
| SQL editor | 13px desktop, 15px mobile |
| Grid | 12~13px desktop, 14px mobile |

최소 200% text zoom에서 주요 flow가 동작해야 한다.

## 5. Density

### Compact

- mouse/keyboard desktop 기본
- toolbar 36~40px
- Grid row 28px
- 작은 icon button 최소 28px, 충분한 accessible area

### Comfortable

- coarse pointer, tablet와 mobile 기본
- control 최소 44px
- Grid row 40px
- menu item 44px 이상

`pointer-coarse`와 사용자 설정을 결합한다. 화면 너비만으로 touch 여부를 추측하지 않는다.

## 6. Component

### Foundation

- Button
- IconButton
- Input/Textarea
- Select/Combobox
- Checkbox/Switch
- Badge
- Tooltip
- Separator
- Spinner/Progress

### Overlay

- Dialog
- AlertDialog
- Popover
- DropdownMenu
- ContextMenu
- CommandPalette
- Drawer/Sheet
- Toast/Status announcement

### Workspace

- ConnectionRail
- ConnectionBadge
- ObjectSidebar
- WorkTabBar
- ResultTabBar
- SplitPane
- QueryToolbar
- ResultToolbar
- StatusBar

### Data

- ResultGrid
- CellEditor
- QuickView
- RowDetail
- PastePreview
- ChangePreview
- ConflictResolver

각 component는 keyboard, loading, disabled, error, read-only와 mobile behavior를 문서화한다.

## 7. Button hierarchy

- Primary: 현재 화면의 한 가지 주요 action
- Secondary: 자주 쓰는 보조 action
- Ghost: toolbar/tab chrome
- Danger: destructive action

Save changes와 Run은 동시에 보일 수 있지만 서로 다른 panel scope를 명확히 한다.

Danger action은 색상뿐 아니라 label과 확인 dialog를 사용한다.

## 8. Tab

### Work Tab

- type icon
- title
- running/dirty/error/read-only state
- active underline 또는 surface
- close button

### Result Tab

- ordinal
- source/command 요약
- row count
- running/dirty/pinned state

tab overflow는 horizontal scroll과 overflow menu를 제공한다. 선택 tab이 항상 viewport 안에 오도록 한다.

## 9. Grid state

| 상태 | 표현 |
| --- | --- |
| Focus | focus ring |
| Selection | selection background + border |
| Modified | corner marker + accessible text |
| Inserted | row marker + `New` |
| Deleted | strike/opacity + `Deleted` |
| Conflict | danger border + icon + text |
| Read-only | editor 없음, reason tooltip |
| NULL | muted italic token, literal text와 구분 |

## 10. Motion

- panel open/close 120~180ms
- tab underline 100ms 이하
- Grid focus에 animation 사용하지 않음
- loading spinner 외 continuous motion 최소화
- reduced motion에서는 transform animation 제거

## 11. Responsive

- base mobile styles
- `md` tablet
- `lg` desktop
- resizable 내부 control은 container query
- mobile bottom action은 safe area
- virtual keyboard에 editor/action이 가려지지 않음

## 12. Content와 localization

- UI string 하드코딩 대신 message key
- 한국어와 영어 MVP catalog
- command 이름과 shortcut는 locale에 맞게 표시
- SQL/PostgreSQL identifier는 번역하지 않음
- error code와 safe server detail을 분리
- 긴 한국어/영어 label에서 ellipsis와 tooltip 제공

## 13. 수용 조건

- Light/Dark/System에서 모든 semantic token 존재
- 환경 상태가 grayscale에서도 구분
- keyboard focus가 모든 control에서 보임
- coarse pointer에서 주요 target 44px 이상
- overlay가 focus trap과 restore를 올바르게 처리
- 200% text zoom에서 연결·실행·결과·저장 flow 동작
- component가 remote asset 없이 render

