# DBPod 접근성 체크리스트

## Application

- [ ] keyboard만으로 주요 flow 완료
- [ ] skip/focus 이동 경로 존재
- [ ] focus indicator가 항상 보임
- [ ] page/panel title이 명확함
- [ ] 상태를 색상만으로 표현하지 않음
- [ ] reduced motion 지원
- [ ] forced colors/high contrast 지원
- [ ] 200% text zoom 지원

## Connection과 Sidebar

- [ ] connection accessible name에 이름·환경·상태 포함
- [ ] PROD badge가 text로 표시
- [ ] tree/list semantics 적절
- [ ] search result 수와 loading announcement
- [ ] collapsed section 상태 노출
- [ ] context menu keyboard 접근

## Tabs

- [ ] tablist/tab/tabpanel semantics
- [ ] Arrow/Home/End navigation
- [ ] active tab 상태
- [ ] running/dirty/pinned/error label
- [ ] close button keyboard 접근
- [ ] tab close 후 예측 가능한 focus

## Query Editor

- [ ] editor label과 shortcut help
- [ ] syntax error 위치 announcement
- [ ] Run/Run New/Stop touch alternative
- [ ] running/cancelling 상태 announcement
- [ ] transaction과 read-only 상태 text

## Result Grid

- [ ] row/column/cell context
- [ ] virtual row position announcement
- [ ] keyboard cell navigation
- [ ] selection 상태
- [ ] sort direction
- [ ] editable/read-only reason
- [ ] NULL과 empty text 구분
- [ ] modified/inserted/deleted/conflict 상태 text
- [ ] Quick View focus trap/restore

## Dialog/Sheet

- [ ] accessible name/description
- [ ] initial focus
- [ ] focus trap
- [ ] Escape 동작
- [ ] destructive default focus 피함
- [ ] close 후 trigger focus 복원

## Mobile

- [ ] 주요 touch target 44px 이상
- [ ] safe area
- [ ] virtual keyboard 회피
- [ ] orientation 변경 상태 보존
- [ ] VoiceOver/TalkBack smoke
- [ ] external keyboard shortcut

## Test

- [ ] automated accessibility scan
- [ ] VoiceOver macOS/iOS
- [ ] NVDA Windows
- [ ] TalkBack Android
- [ ] keyboard-only regression
- [ ] grayscale/high contrast

