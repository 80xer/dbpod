# DBPod 릴리스 전략

- 상태: MVP 기준선
- 최종 수정일: 2026-07-27

## 1. 버전

Semantic Versioning을 사용한다.

- `0.x`: pre-release product development
- `1.0`: MVP 안정성·보안·플랫폼 gate 충족
- patch: 호환 bug/security fix
- minor: backward-compatible feature
- major: workspace/persistence/IPC 호환 breaking change

## 2. Channel

- `nightly`: 자동 build, 지원 없음
- `beta`: 서명된 tester 배포
- `stable`: release gate 전체 통과

beta와 stable은 같은 signing trust chain을 사용하되 endpoint를 분리한다.

## 3. Desktop artifact

- macOS signed/notarized bundle
- Windows signed installer
- Linux AppImage와 배포 정책에 맞는 package
- checksum
- SBOM
- signature
- release notes

## 4. Mobile

MVP는 simulator/device test build까지다.

정식 배포 시:

- App Store/Play Store signing
- store update channel
- privacy manifest
- network/clipboard/biometric permission 설명
- Gateway 또는 VPN product policy

## 5. CI/CD

### Build

- clean checkout
- locked dependencies
- generated IPC binding check
- tests/security scan
- platform build
- artifact secret scan
- signing
- checksum/SBOM
- release storage upload

### Signing key

- CI protected secret 또는 hardware-backed signing
- developer laptop에 production updater key 저장 금지
- rotation/recovery procedure
- key loss 시 update continuity 영향 문서화

## 6. Updater

- Tauri signed updater
- HTTPS endpoint
- signature 없는 update 거부
- version/channel 검증
- rollback은 별도 서명 artifact
- 강제 update는 critical security incident 외 사용 금지

## 7. Release gate

- [ ] product acceptance criteria
- [ ] Tier 1 platform build/E2E
- [ ] PostgreSQL version matrix
- [ ] security baseline checklist
- [ ] dependency/license scan
- [ ] performance budget
- [ ] accessibility checklist
- [ ] persistence migration/rollback
- [ ] signed updater tamper test
- [ ] release notes
- [ ] known issues

## 8. Security release

- vulnerability severity triage
- fix branch와 embargo
- supported channel patch
- CVE/advisory 여부
- dependency update
- credential/signing key compromise 대응
- 사용자에게 영향을 주는 log/clipboard/data exposure 명확히 공지

## 9. Telemetry와 crash

- 기본 비활성화
- opt-in 전송 payload preview
- SQL/result/credential 금지
- vendor 선택 전 threat model과 privacy review

## 10. 라이선스

- 소스 코드와 문서는 Apache License 2.0으로 배포한다.
- source와 artifact에 root `LICENSE`를 포함한다.
- release build마다 dependency license compatibility를 검사한다.
- 필요한 third-party notice와 SBOM을 artifact에 포함한다.
- 별도 보안 신고 이메일이 `SECURITY.md`에 등록되기 전에는 stable public release를 만들지 않는다.
