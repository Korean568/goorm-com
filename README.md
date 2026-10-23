# 구름닷컴

우리 반 친구들이 공지·과제·자유·질문 글을 나누는 학급 게시판이에요.
화면은 GitHub Pages에서, 글·댓글·공감은 Firebase(Firestore)에 저장돼요.

- 처음 들어오면 **초대코드**를 입력해야 해요. 코드는 Firestore에만 있고 이 저장소에는 없어요.
- 로그인은 필요 없어요. 기기마다 익명 ID가 생겨서 내가 쓴 글만 고치고 지울 수 있어요.
- 선생님·반장은 오른쪽 '선생님·반장 인증'에 **관리자 코드**를 넣으면 공지를 쓰고, 반 이름을 바꾸고, 다른 사람 글을 지울 수 있어요.
- `firebase-config.js`가 비어 있으면 이 기기에만 저장되는 연습 모드로 열려요(초대코드 0504).

## Firebase 설정 (한 번만)

1. [Firebase 콘솔](https://console.firebase.google.com)에서 **프로젝트 추가**를 누르고 만들어요. Google 애널리틱스는 꺼도 돼요.
2. 프로젝트 개요에서 **웹 앱 추가(`</>`)** → 앱 이름 적고 등록 → 나오는 `firebaseConfig` 값을 `firebase-config.js`에 붙여 넣어요.
   ```js
   window.GOORM_FIREBASE_CONFIG = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "...",
   };
   ```
3. **빌드 → Authentication → 시작하기 → 로그인 방법 → 익명 → 사용 설정**.
   같은 화면의 **설정 → 승인된 도메인**에 `korean568.github.io`를 추가해요.
4. **빌드 → Firestore Database → 데이터베이스 만들기** → 위치 `asia-northeast3 (서울)` → **프로덕션 모드**.
5. Firestore의 **규칙** 탭에 [`firestore.rules`](firestore.rules) 내용을 통째로 붙여 넣고 **게시**해요.
6. Firestore의 **데이터** 탭에서 코드를 넣어요. 필드 유형은 꼭 **string**으로 해요.
   - 컬렉션 `config` → 문서 ID `invite` → 필드 `code` = `0504`
   - 컬렉션 `config` → 문서 ID `admin` → 필드 `code` = 관리자 코드(직접 정하기, 친구들에게 알려 주지 않기)

초대코드를 바꾸고 싶으면 `config/invite`의 `code`만 고치면 돼요. 이미 들어온 기기는 다시 묻지 않아요.

## 파일

| 파일 | 하는 일 |
| --- | --- |
| `index.html` | 화면 뼈대와 초대코드 입장 화면 |
| `style.css` | 디자인(밝은/어두운 화면 모두) |
| `app.js` | 게시판 동작, Firebase 연결, 연습 모드 |
| `firebase-config.js` | Firebase 프로젝트 설정값 |
| `firestore.rules` | 누가 무엇을 읽고 쓸 수 있는지 정하는 보안 규칙 |
