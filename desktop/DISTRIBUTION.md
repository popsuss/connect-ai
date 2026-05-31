# 📦 Connect AI 데스크톱 — 배포 가이드 (윈도우 · 맥)

사람들이 다운로드해서 쓰게 만드는 법.

## 방법 A — GitHub Actions 자동 빌드 (추천)

코드를 GitHub 에 올리면 맥·윈도우 설치파일이 **자동으로** 만들어집니다.
설정은 이미 끝나있음: [.github/workflows/build-desktop.yml](../.github/workflows/build-desktop.yml)

1. 이 저장소를 GitHub 에 push
2. 빌드 실행 (둘 중 하나):
   - **태그 푸시**: `git tag desktop-v0.1.0 && git push --tags`
   - **수동**: GitHub → Actions 탭 → "Build Connect AI Desktop" → Run workflow
3. 끝나면:
   - **Actions 아티팩트**에 `.dmg` / `.exe` (테스트용)
   - **태그**로 돌렸으면 → **Releases** 에 자동 첨부 (배포용)

## 방법 B — 내 컴퓨터에서 직접 빌드

```bash
cd desktop
npm install
npm run dist
# 결과물: desktop/release/  (맥: *.dmg / 윈도우: *.exe)
```
- 맥용 `.dmg` 는 **맥에서**, 윈도우용 `.exe` 는 **윈도우에서** 빌드하세요.

## EZER 웹 다운로드 페이지

`/download` 페이지 만들어둠: [EZERAI/src/pages/Download.tsx](/Users/jay/EZERAI/src/pages/Download.tsx)
- `RELEASES` 상수를 **본인 GitHub 저장소 릴리스 URL**로 바꾸면 버튼이 연결됨
  ```
  https://github.com/<본인>/<저장소>/releases/latest
  ```

## ⚠️ 코드 서명 (나중에)

서명 없으면 첫 실행 시 보안 경고가 떠요 (실행은 됨):
- **맥**: 우클릭 → 열기 / 정식 배포는 Apple Developer ($99/년) + notarize
- **윈도우**: "추가 정보 → 실행" / 정식 배포는 코드서명 인증서

현재 설정은 **서명 없이 빌드**(`mac.identity: null`) — 친구·테스트 배포용으로 충분.

## 체크리스트

- [ ] (선택) 앱 아이콘 추가 — `desktop/assets/icon.icns`(맥) · `icon.ico`(윈도우)
- [ ] GitHub 에 push → Actions 빌드 확인
- [ ] Releases URL 을 EZER `/download` 에 반영
- [ ] 친구에게 `/download` 링크 공유
