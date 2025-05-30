# 간단한 파일 업로드 서버

대용량 파일(4GB 이상)을 쉽게 업로드할 수 있는 간단한 웹 애플리케이션입니다. 드래그 앤 드롭 방식으로 파일을 업로드할 수 있습니다.

## 기능

- 드래그 앤 드롭으로 파일 업로드
- 대용량 파일(4GB 이상) 지원
- 업로드 진행 상황 표시
- 업로드된 파일 목록 확인
- SSH 터널을 통한 외부 접속 지원 (앱에서 자동 실행, 별도 명령어 입력 불필요, 비밀번호 입력 시 엔터만 누르면 공유 주소 생성)

## 설치 및 실행

### 필요 조건

- Node.js (v12 이상)
- npm 또는 yarn

### 설치

```bash
# 의존성 설치
npm install
```

### 실행

```bash
# 서버 시작
npm start
```

서버가 시작되면 `http://localhost:3000`으로 접속하여 사용할 수 있습니다.

## SSH 터널을 통한 외부 접속

SSH 터널은 앱 실행 시 자동으로 연결되며, 별도의 명령어 입력이 필요하지 않습니다. SSH 비밀번호를 묻는 창이 나오면 엔터만 누르면 되고, 이후 공유 가능한 주소가 자동으로 생성됩니다. 이 주소를 복사해 업로드할 사용자에게 전달하면 외부에서도 접속할 수 있습니다.

## 사용 방법

1. 앱을 실행하면 pinggy를 통해 공유 가능한 주소가 자동으로 생성됩니다.
2. 해당 주소를 복사해 업로드할 사용자에게 전달합니다.
3. 사용자는 전달받은 주소로 접속해 파일을 드래그하거나 클릭하여 업로드할 수 있습니다.
4. 업로드가 시작되면 진행 상황이 표시되고, 완료 시 파일 목록에 추가됩니다.

## 주의사항

- 업로드된 파일은 서버의 `uploads` 디렉토리에 저장됩니다.
- 서버를 외부에 공개할 경우 보안에 주의하세요.
- 대용량 파일 업로드 시 서버의 디스크 공간을 확인하세요.
- SSH 터널 사용 시 비밀번호 자동 입력은 지원하지 않습니다. 반드시 터미널에서 직접 입력해야 합니다.