# 구름닷컴

우리 반 친구들이 공지·과제·자유·질문 글을 나누는 학급 게시판이에요.

- **사이트:** https://korean568.github.io/goorm-com/ (GitHub Pages)
- **게시판 서버:** Cloudflare Worker `goorm-com-api` + D1 데이터베이스 `goorm-db`

## 쓰는 방법

- 처음 들어오면 **초대코드**를 입력해야 해요. 코드는 Cloudflare 비밀값으로만 저장되고 이 저장소에는 없어요.
- 한 번 들어오면 그 기기에 입장 표시가 남아서 다시 묻지 않아요.
- 코드를 10분 안에 10번 틀리면 잠깐 막혀요.
- 내가 쓴 글은 고치거나 지울 수 있고, 내 글에 달린 댓글도 지울 수 있어요.
- 선생님·반장은 오른쪽 **선생님·반장 인증**에 관리자 코드를 넣어요. 그러면 공지 쓰기, 반 이름·급훈 바꾸기, 다른 사람 글 지우기를 할 수 있어요.
- 새 글은 8초마다 자동으로 불러와요.

## 코드 바꾸기

`worker` 폴더에서 아래 명령을 실행하고, 새 코드를 입력하면 돼요.

```bash
npx wrangler@4.20.0 secret put INVITE_CODE
```

```bash
npx wrangler@4.20.0 secret put ADMIN_CODE
```

## 서버 고치고 다시 올리기

```bash
npx wrangler@4.20.0 deploy
```

## 파일

| 파일 | 하는 일 |
| --- | --- |
| `index.html` | 화면 뼈대와 초대코드 입장 화면 |
| `style.css` | 디자인(밝은 화면과 어두운 화면) |
| `app.js` | 게시판 동작, 서버 연결, 연습 모드 |
| `config.js` | 게시판 서버 주소. 비우면 이 기기에만 저장되는 연습 모드(초대코드 0504) |
| `worker/src/index.js` | 게시판 서버: 초대코드 확인, 글·댓글·공감 저장, 권한 확인 |
| `worker/schema.sql` | D1 데이터베이스 표 만들기 |
| `worker/wrangler.toml` | Cloudflare 배포 설정 |
