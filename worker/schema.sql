-- 구름닷컴 D1 스키마. 처음 한 번: wrangler d1 execute goorm-db --remote --file schema.sql

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  cat TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  nick TEXT NOT NULL,
  author_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  edited_at INTEGER
);
CREATE INDEX IF NOT EXISTS posts_created ON posts (created_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  nick TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_post ON comments (post_id);

CREATE TABLE IF NOT EXISTS likes (
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 코드를 여러 번 틀리는 것을 막기 위한 기록
CREATE TABLE IF NOT EXISTS attempts (
  ip TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_ip ON attempts (ip, kind, at);

INSERT OR IGNORE INTO posts (id, cat, title, body, nick, author_id, created_at) VALUES (
  'welcome', 'notice', '구름닷컴에 오신 걸 환영해요',
  '우리 반만의 게시판, 구름닷컴이 열렸어요.' || char(10) || char(10) ||
  '• 공지: 선생님과 반장이 알릴 내용을 올려요.' || char(10) ||
  '• 과제: 숙제, 수행평가 마감일을 함께 정리해요.' || char(10) ||
  '• 자유: 하고 싶은 이야기를 편하게 나눠요.' || char(10) ||
  '• 질문: 모르는 문제를 물어보고 서로 도와줘요.' || char(10) || char(10) ||
  '친구를 존중하는 말을 써 주세요. 전화번호나 주소 같은 개인정보는 올리지 않기로 해요.',
  '구름닷컴', 'system', CAST(strftime('%s', 'now') AS INTEGER) * 1000
);
