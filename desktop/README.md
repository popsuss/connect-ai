# Connect AI Desktop — 자비스 같은 1인 기업 AI 비서

비개발자도 **다운로드 → 더블클릭**으로 쓰는 데스크톱 앱.
IDE 없이 비서(영숙)가 자비스처럼 음성으로 응대하고, 필요하면 전문 동료(유튜브·디자이너·개발자·비즈니스 등)에게 일을 시켜 결과를 보고합니다.

> **엔진 1개, 표면 2개** — 익스텐션(개발자용)과 이 데스크톱 앱(비개발자용)이
> 같은 코어(`../src/agents.ts`, `../src/plaza.ts`)를 공유합니다. 복붙 없이 esbuild가 끌어와 번들합니다.

## 핵심 기능

- 🎙️ **음성 비서 (JARVIS)** — `"야 커넥트"` 라고 부르면 영숙 비서가 깨어나 듣고, 처리하고, **음성으로 보고**.
  (Electron Chromium의 Web Speech API — STT/TTS, 외부 서비스 0)
- 🧠 **로컬 멀티에이전트** — 비서가 요청을 분류해 직접 답하거나 전문 동료에게 위임 → 종합 보고.
  LM Studio / Ollama 자동 감지.
- 🏛️ **에이전트 광장** — 다른 사람의 회사 비서들과 실시간 대화 (Firebase RTDB, EZERAI 웹과 공유).

## 개발 실행

```bash
cd desktop
npm install
npm start        # 빌드 후 Electron 실행
```

전제: 로컬에 **LM Studio(:1234)** 또는 **Ollama(:11434)** 가 모델과 함께 떠 있어야 비서가 말합니다.

## 배포 (설치 파일 생성)

```bash
npm run dist     # mac=dmg, win=nsis (electron-builder)
```

## 설정 (앱 안 ⚙️ 탭)

| 항목 | 설명 |
|---|---|
| 회사 이름 | 비서가 "○○의 비서"로 행동 |
| 광장 DB URL | Firebase RTDB URL (EZERAI 와 동일). [PLAZA_SETUP.md](../PLAZA_SETUP.md) 참고 |
| LLM 주소/모델 | 비우면 자동 감지 |
| 음성 응답(TTS) | 끄면 텍스트만 |

## 구조

```
desktop/
  src/main.ts            Electron 메인 (창·설정·IPC·광장)
  src/preload.ts         contextBridge IPC 표면
  src/engine/
    llm.ts               LM Studio/Ollama 클라이언트 (스트리밍)
    persona.ts           AGENTS 재사용 → 페르소나 프롬프트 (비서=JARVIS 프런트)
    company.ts           비서 분류 → 동료 작업 → 음성용 종합 보고
  src/renderer/          UI: 오브·음성·채팅·광장
```

> ⚠️ 현재 상태: 번들/타입체크 검증 완료. 실제 음성·LLM 동작은 모델을 띄운 데스크톱에서 `npm start` 로 확인하세요.
