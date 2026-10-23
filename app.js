(() => {
  const FIREBASE_VERSION = "10.12.2";
  const CATS = [
    { key: "notice", label: "공지" },
    { key: "hw", label: "과제" },
    { key: "free", label: "자유" },
    { key: "qa", label: "질문" },
  ];
  const catLabel = (k) => (CATS.find((c) => c.key === k) || CATS[2]).label;
  const DAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

  const S = {
    posts: [], comments: [], settings: {}, ready: false, mode: "loading",
    view: "list", postId: null, editId: null, cat: "all", q: "",
    meId: null, admin: false, nick: "",
    confirmDel: null, editingClass: false, claiming: false,
  };
  let STORE = null;

  // ---------- 유틸 ----------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const $ = (s) => document.querySelector(s);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const pad = (n) => String(n).padStart(2, "0");
  const linkify = (escaped) => escaped.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);

  function ago(t) {
    const d = (Date.now() - t) / 1000;
    if (d < 60) return "방금";
    if (d < 3600) return Math.floor(d / 60) + "분 전";
    if (d < 86400) return Math.floor(d / 3600) + "시간 전";
    const dt = new Date(t), now = new Date();
    const md = `${pad(dt.getMonth() + 1)}.${pad(dt.getDate())}`;
    return dt.getFullYear() === now.getFullYear() ? md : `${dt.getFullYear()}.${md}`;
  }
  function fullDate(t) {
    const d = new Date(t);
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // 저장된 글은 누가 썼는지 모르니 항상 모양을 확인하고 쓴다
  function normComment(c) {
    return {
      id: c.id, postId: str(c.postId, 200), nick: str(c.nick, 12) || "익명", authorId: str(c.authorId, 200),
      body: str(c.body, 1000), createdAt: typeof c.createdAt === "number" ? c.createdAt : 0,
    };
  }
  function posts() {
    const byPost = {};
    for (const c of S.comments) {
      const n = normComment(c);
      if (n.body) (byPost[n.postId] = byPost[n.postId] || []).push(n);
    }
    return S.posts.map((p) => {
      const likes = obj(p.likes);
      return {
        id: p.id,
        cat: CATS.some((c) => c.key === p.cat) ? p.cat : "free",
        title: str(p.title, 80) || "(제목 없음)",
        body: str(p.body, 5000),
        nick: str(p.nick, 12) || "익명",
        authorId: str(p.authorId, 200),
        createdAt: typeof p.createdAt === "number" ? p.createdAt : 0,
        editedAt: typeof p.editedAt === "number" ? p.editedAt : 0,
        likeCount: Object.values(likes).filter((v) => v === true).length,
        liked: likes[S.meId] === true,
        comments: (byPost[p.id] || []).sort((a, b) => a.createdAt - b.createdAt),
      };
    }).sort((a, b) => b.createdAt - a.createdAt);
  }
  const isMine = (p) => !!p.authorId && p.authorId === S.meId;

  // ---------- 저장소 1: 이 기기(localStorage) 연습 모드 ----------
  // 연습 모드에서만 쓰는 초대코드 확인값(SHA-256). 공유 모드에서는 Firestore 보안 규칙이 코드를 확인한다.
  const LOCAL_INVITE_HASH = "9514bda5f1da3a11c1ec2b4d40252bcc327a89cc4cc0f01f673048a551333d08";
  async function sha256(text) {
    if (!(window.crypto && crypto.subtle)) return "";
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  function welcomePost() {
    return {
      cat: "notice",
      title: "구름닷컴에 오신 걸 환영해요",
      body: "우리 반만의 게시판, 구름닷컴이 열렸어요.\n\n• 공지: 선생님과 반장이 알릴 내용을 올려요.\n• 과제: 숙제, 수행평가 마감일을 함께 정리해요.\n• 자유: 하고 싶은 이야기를 편하게 나눠요.\n• 질문: 모르는 문제를 물어보고 서로 도와줘요.\n\n친구를 존중하는 말을 써 주세요. 전화번호나 주소 같은 개인정보는 올리지 않기로 해요.",
      nick: "구름닷컴", authorId: "system", createdAt: Date.now(), likes: {},
    };
  }
  function localStore() {
    const K = "goorm.local", KS = "goorm.settings";
    let me = LS.get("goorm.device", null);
    if (!me) { me = "d_" + uid(); LS.set("goorm.device", me); }
    let data = LS.get(K, null);
    if (!data || typeof data !== "object" || !data.posts) { data = { posts: { [uid()]: welcomePost() }, comments: {} }; LS.set(K, data); }
    let postsCb = () => {}, commentsCb = () => {}, setCb = () => {};
    const emit = () => {
      postsCb(Object.entries(data.posts).map(([id, p]) => ({ id, ...p })));
      commentsCb(Object.entries(data.comments).map(([id, c]) => ({ id, ...c })));
    };
    const save = () => { LS.set(K, data); emit(); };
    window.addEventListener("storage", (e) => {
      if (e.key === K) { data = LS.get(K, data); emit(); }
      if (e.key === KS) setCb(LS.get(KS, {}));
    });
    return {
      mode: "local", uid: me, admin: true, member: LS.get("goorm.joined", false) === true,
      async join(code) {
        const ok = (await sha256(code)) === LOCAL_INVITE_HASH;
        if (ok) LS.set("goorm.joined", true);
        return ok;
      },
      onPosts(cb) { postsCb = cb; emit(); },
      onComments(cb) { commentsCb = cb; emit(); },
      onSettings(cb) { setCb = cb; cb(LS.get(KS, {})); },
      async addPost(p) { const id = uid(); data.posts[id] = { ...p, authorId: me, createdAt: Date.now(), likes: {} }; save(); return id; },
      async editPost(id, p) { if (data.posts[id]) { Object.assign(data.posts[id], p, { editedAt: Date.now() }); save(); } },
      async like(id, on) { const p = data.posts[id]; if (p) { p.likes = { ...obj(p.likes), [me]: on }; save(); } },
      async removePost(id) {
        delete data.posts[id];
        for (const [cid, c] of Object.entries(data.comments)) if (c.postId === id) delete data.comments[cid];
        save();
      },
      async addComment(pid, c) { data.comments[uid()] = { ...c, postId: pid, authorId: me, createdAt: Date.now() }; save(); },
      async removeComment(pid, cid) { delete data.comments[cid]; save(); },
      async setSettings(s) { LS.set(KS, s); setCb(s); },
      async claimAdmin() { return true; },
    };
  }

  // ---------- 저장소 2: Firebase(Firestore) 공유 모드 ----------
  async function firebaseStore(cfg) {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
    const [{ initializeApp }, { getAuth, signInAnonymously }, fs] = await Promise.all([
      import(base + "firebase-app.js"),
      import(base + "firebase-auth.js"),
      import(base + "firebase-firestore.js"),
    ]);
    const app = initializeApp(cfg);
    const db = fs.getFirestore(app);
    const { user } = await signInAnonymously(getAuth(app));
    const me = user.uid;
    let admin = false, member = false;
    try { admin = (await fs.getDoc(fs.doc(db, "admins", me))).exists(); } catch (e) {}
    try { member = admin || (await fs.getDoc(fs.doc(db, "members", me))).exists(); } catch (e) {}

    const ms = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : 0);
    const read = (d) => {
      const x = d.data({ serverTimestamps: "estimate" });
      return { ...x, id: d.id, createdAt: ms(x.createdAt), editedAt: ms(x.editedAt) };
    };
    const postsCol = fs.collection(db, "posts");
    const store = {
      mode: "cloud", uid: me, admin, member,
      async join(code) {
        try {
          await fs.setDoc(fs.doc(db, "members", me), { code });
          return true;
        } catch (e) {
          if (e && e.code === "permission-denied") return false;
          throw e;
        }
      },
      onPosts(cb, err) {
        fs.onSnapshot(fs.query(postsCol, fs.orderBy("createdAt", "desc"), fs.limit(500)), (s) => cb(s.docs.map(read)), err);
      },
      onComments(cb) {
        fs.onSnapshot(fs.collectionGroup(db, "comments"), (s) => cb(s.docs.map(read)), () => {});
      },
      onSettings(cb) {
        fs.onSnapshot(fs.doc(db, "settings", "class"), (s) => cb(s.exists() ? s.data() : {}), () => {});
      },
      async addPost(p) {
        const ref = await fs.addDoc(postsCol, { ...p, authorId: me, createdAt: fs.serverTimestamp(), likes: {} });
        return ref.id;
      },
      async editPost(id, p) {
        await fs.updateDoc(fs.doc(db, "posts", id), { ...p, editedAt: fs.serverTimestamp() });
      },
      async like(id, on) {
        await fs.updateDoc(fs.doc(db, "posts", id), { ["likes." + me]: on });
      },
      async removePost(id) {
        const cs = await fs.getDocs(fs.collection(db, "posts", id, "comments"));
        await Promise.all(cs.docs.map((d) => fs.deleteDoc(d.ref)));
        await fs.deleteDoc(fs.doc(db, "posts", id));
      },
      async addComment(pid, c) {
        await fs.addDoc(fs.collection(db, "posts", pid, "comments"), { ...c, postId: pid, authorId: me, createdAt: fs.serverTimestamp() });
      },
      async removeComment(pid, cid) {
        await fs.deleteDoc(fs.doc(db, "posts", pid, "comments", cid));
      },
      async setSettings(s) {
        await fs.setDoc(fs.doc(db, "settings", "class"), s);
      },
      async claimAdmin(code) {
        try {
          await fs.setDoc(fs.doc(db, "admins", me), { code });
          store.admin = true;
          return true;
        } catch (e) {
          if (e && e.code === "permission-denied") return false;
          throw e;
        }
      },
    };
    return store;
  }

  async function act(fn, okMsg) {
    try {
      const r = await fn();
      if (okMsg) toast(okMsg);
      return r === undefined ? true : r;
    } catch (e) {
      const code = e && e.code;
      if (code === "permission-denied") toast("권한이 없어서 저장하지 못했어요.");
      else if (code === "unavailable") toast("인터넷 연결을 확인하고 다시 시도해 주세요.");
      else if (code === "resource-exhausted") toast("오늘 쓸 수 있는 양을 다 썼어요. 내일 다시 시도해 주세요.");
      else toast("저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
      console.error(e);
      return false;
    }
  }

  // ---------- 헤더 ----------
  function renderHeader() {
    const name = str(S.settings.name, 20) || "우리 반";
    $("#className").textContent = name;
    $("#classMotto").textContent = str(S.settings.motto, 40);
    const m = $("#mode");
    if (S.mode === "cloud") {
      m.className = "mode cloud";
      m.textContent = "반 친구들과 공유 중";
      m.title = "여기 올린 글은 이 게시판을 여는 모든 사람에게 보여요.";
    } else if (S.mode === "local") {
      m.className = "mode";
      m.textContent = "이 기기에만 저장돼요";
      m.title = "지금은 이 브라우저에만 글이 저장돼요.";
    } else if (S.mode === "error") {
      m.className = "mode";
      m.textContent = "연결 안 됨";
    }
    $("#nickBtn").textContent = S.nick ? "닉네임 · " + S.nick : "닉네임 정하기";
    document.title = name === "우리 반" ? "구름닷컴" : name + " · 구름닷컴";
  }

  // ---------- 목록 ----------
  function buildList() {
    const main = $("#main");
    main.dataset.view = "list";
    main.innerHTML = `
      ${S.mode === "local" ? `<p class="banner">지금은 이 기기에만 글이 저장되는 연습 모드예요. firebase-config.js에 Firebase 설정을 넣으면 반 친구들과 함께 쓸 수 있어요.</p>` : ""}
      <div class="toolbar">
        <div class="tabs" role="tablist" aria-label="말머리">
          <button class="tab" role="tab" data-cat="all">전체<span class="n"></span></button>
          ${CATS.map((c) => `<button class="tab" role="tab" data-cat="${c.key}">${c.label}<span class="n"></span></button>`).join("")}
        </div>
        <div class="tools">
          <input class="search" id="q" type="search" placeholder="제목, 내용, 글쓴이 검색" aria-label="글 검색" value="${esc(S.q)}">
          <button class="btn primary" type="button" data-go="write">글쓰기</button>
        </div>
      </div>
      <div class="board">
        <div class="board-head" aria-hidden="true"><span>말머리</span><span>제목</span><span>글쓴이</span><span class="c">날짜</span><span class="c">공감</span></div>
        <div id="rows"></div>
      </div>`;
    $("#q").addEventListener("input", (e) => { S.q = e.target.value; fillList(); });
    fillList();
  }
  function rowHtml(p, pinned) {
    const n = p.comments.length;
    const isNew = Date.now() - p.createdAt < 86400000;
    return `<button class="row${pinned ? " pinned" : ""}" type="button" data-open="${esc(p.id)}">
      <span class="tag t-${p.cat}">${catLabel(p.cat)}</span>
      <span class="row-title"><span class="tt">${esc(p.title)}</span>${n ? `<span class="cc">[${n}]</span>` : ""}${isNew ? `<span class="new" aria-label="새 글">N</span>` : ""}</span>
      <span class="row-meta">
        <span class="row-nick">${esc(p.nick)}</span>
        <span class="row-time c">${ago(p.createdAt)}</span>
        <span class="row-like c">${p.likeCount ? `<span class="lk-lbl">공감 </span>${p.likeCount}` : ""}</span>
      </span>
    </button>`;
  }
  function fillList() {
    const all = posts();
    document.querySelectorAll(".tab").forEach((t) => {
      const k = t.dataset.cat;
      t.setAttribute("aria-selected", String(k === S.cat));
      t.querySelector(".n").textContent = k === "all" ? all.length : all.filter((p) => p.cat === k).length;
    });
    const q = S.q.trim().toLowerCase();
    let list = S.cat === "all" ? all : all.filter((p) => p.cat === S.cat);
    if (q) list = list.filter((p) => (p.title + "\n" + p.body + "\n" + p.nick).toLowerCase().includes(q));
    let pinned = [];
    if (S.cat === "all" && !q) {
      pinned = list.filter((p) => p.cat === "notice").slice(0, 3);
      list = list.filter((p) => !pinned.includes(p));
    }
    const rows = $("#rows");
    if (!all.length) {
      rows.innerHTML = emptyHtml("아직 올라온 글이 없어요", "첫 글을 써서 우리 반 게시판을 시작해 보세요.", true);
    } else if (!pinned.length && !list.length) {
      rows.innerHTML = q
        ? emptyHtml(`'${esc(S.q.trim())}'에 맞는 글이 없어요`, "다른 낱말로 찾아보거나 말머리를 바꿔 보세요.", false)
        : emptyHtml(`${catLabel(S.cat)} 글이 아직 없어요`, "이 말머리의 첫 글을 써 보세요.", S.cat !== "notice" || S.admin);
    } else {
      rows.innerHTML = pinned.map((p) => rowHtml(p, true)).join("") + list.map((p) => rowHtml(p, false)).join("");
    }
  }
  function emptyHtml(title, sub, cta) {
    return `<div class="empty">
      <svg viewBox="0 0 120 80" aria-hidden="true"><path d="M30 70 h64 a20 20 0 0 0 2-40 a30 30 0 0 0-56-6 a22 22 0 0 0-10 46 z"/></svg>
      <h3>${title}</h3><p>${sub}</p>
      ${cta ? `<button class="btn primary" type="button" data-go="write">글쓰기</button>` : ""}
    </div>`;
  }

  // ---------- 글 보기 ----------
  function buildPost() {
    const main = $("#main");
    main.dataset.view = "post:" + S.postId;
    main.innerHTML = `
      <div class="post-nav"><button class="link-btn" type="button" data-go="list">← 목록으로</button></div>
      <article class="post" id="postArea"></article>
      <section class="comments" id="commentSec">
        <h2 class="sec-title">댓글<span class="n" id="cCount"></span></h2>
        <ul class="c-list" id="cList"></ul>
        <p class="c-none" id="cNone">첫 댓글을 남겨 보세요.</p>
        <form class="c-form" id="cForm">
          <label class="hint" for="cBody">댓글 쓰기</label>
          <textarea id="cBody" rows="3" maxlength="1000" placeholder="친구에게 힘이 되는 댓글을 남겨 주세요"></textarea>
          <div class="row2">
            <input id="cNick" maxlength="12" placeholder="닉네임" aria-label="닉네임" value="${esc(S.nick)}">
            <button class="btn primary" type="submit">댓글 등록</button>
          </div>
        </form>
      </section>`;
    $("#cForm").addEventListener("submit", submitComment);
    fillPost();
  }
  function fillPost() {
    const p = posts().find((x) => x.id === S.postId);
    const area = $("#postArea");
    if (!p) {
      area.innerHTML = `<div class="empty"><h3>이 글은 지워졌어요</h3><p>목록으로 돌아가서 다른 글을 읽어 보세요.</p><button class="btn" type="button" data-go="list">목록으로</button></div>`;
      $("#commentSec").hidden = true;
      return;
    }
    $("#commentSec").hidden = false;
    const canDel = isMine(p) || S.admin;
    const actions = !canDel ? "" : S.confirmDel === p.id
      ? `<span class="confirm">정말 지울까요? <button class="btn danger solid" type="button" data-del="${esc(p.id)}">지우기</button><button class="btn" type="button" data-nodel>취소</button></span>`
      : `${isMine(p) ? `<button class="link-btn" type="button" data-edit="${esc(p.id)}">수정</button>` : ""}<button class="link-btn" type="button" data-askdel="${esc(p.id)}">삭제</button>`;
    area.innerHTML = `
      <span class="tag t-${p.cat}">${catLabel(p.cat)}</span>
      <h1>${esc(p.title)}</h1>
      <div class="post-meta">
        <strong>${esc(p.nick)}</strong>
        <span>${fullDate(p.createdAt)}${p.editedAt ? " · 수정됨" : ""}</span>
        <span class="actions">${actions}</span>
      </div>
      <div class="post-body">${linkify(esc(p.body))}</div>
      <div class="like-wrap">
        <button class="like" type="button" data-like="${esc(p.id)}" aria-pressed="${p.liked}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6a5 5 0 0 1 9.2 5c-2.2 4.6-9.2 9-9.2 9z"/></svg>
          공감 <span class="n">${p.likeCount}</span>
        </button>
      </div>`;
    $("#cCount").textContent = p.comments.length || "";
    $("#cNone").hidden = p.comments.length > 0;
    $("#cList").innerHTML = p.comments.map((c) => `
      <li class="c-item">
        <div class="c-head">
          <strong>${esc(c.nick)}</strong>
          ${c.authorId && c.authorId === p.authorId ? `<span class="me-badge">글쓴이</span>` : ""}
          <span>${ago(c.createdAt)}</span>
          ${S.admin || isMine(p) || c.authorId === S.meId ? `<button class="link-btn" type="button" data-cdel="${esc(c.id)}">삭제</button>` : ""}
        </div>
        <div class="c-body">${linkify(esc(c.body))}</div>
      </li>`).join("");
  }
  async function submitComment(e) {
    e.preventDefault();
    const body = $("#cBody").value.trim();
    const nick = $("#cNick").value.trim();
    if (!body) { $("#cBody").focus(); return; }
    if (!nick) { toast("닉네임을 적어 주세요."); $("#cNick").focus(); return; }
    setNick(nick);
    const btn = $("#cForm button[type=submit]");
    btn.disabled = true;
    const ok = await act(() => STORE.addComment(S.postId, { nick, body }));
    btn.disabled = false;
    if (ok) $("#cBody").value = "";
  }

  // ---------- 글쓰기 ----------
  function buildWrite() {
    const main = $("#main");
    main.dataset.view = "write";
    const editing = S.editId ? posts().find((p) => p.id === S.editId) : null;
    const cats = CATS.filter((c) => c.key !== "notice" || S.admin);
    const cur = editing && cats.some((c) => c.key === editing.cat) ? editing.cat
      : S.cat !== "all" && cats.some((c) => c.key === S.cat) ? S.cat : "free";
    main.innerHTML = `
      <div class="post-nav"><button class="link-btn" type="button" data-go="${editing ? "back" : "list"}">← ${editing ? "글로 돌아가기" : "목록으로"}</button></div>
      <form class="write" id="wForm">
        <h2>${editing ? "글 고치기" : "새 글 쓰기"}</h2>
        <div class="field">
          <span class="lbl" id="catLbl">말머리</span>
          <div class="cat-pick" role="radiogroup" aria-labelledby="catLbl">
            ${cats.map((c) => `<label><input type="radio" name="cat" id="cat-${c.key}" value="${c.key}" ${c.key === cur ? "checked" : ""}><span class="t-${c.key}">${c.label}</span></label>`).join("")}
          </div>
          ${S.admin ? "" : `<span class="hint">공지는 선생님과 반장만 쓸 수 있어요.</span>`}
        </div>
        <div class="field">
          <label for="wTitle">제목</label>
          <input id="wTitle" maxlength="80" placeholder="예: 수학 수행평가 범위 정리" value="${editing ? esc(editing.title) : ""}">
        </div>
        <div class="field">
          <label for="wBody">내용</label>
          <textarea id="wBody" maxlength="5000" placeholder="반 친구들에게 전할 내용을 적어 주세요">${editing ? esc(editing.body) : ""}</textarea>
        </div>
        <div class="field">
          <label for="wNick">닉네임</label>
          <input id="wNick" maxlength="12" placeholder="예: 3번 김구름" value="${esc(editing ? editing.nick : S.nick)}" ${editing ? "disabled" : ""}>
        </div>
        <p class="err" id="wErr"></p>
        <div class="write-actions">
          <button class="btn" type="button" data-go="${editing ? "back" : "list"}">취소</button>
          <button class="btn primary" type="submit">${editing ? "고친 내용 저장" : "올리기"}</button>
        </div>
      </form>`;
    $("#wForm").addEventListener("submit", submitWrite);
    (editing ? $("#wBody") : $("#wTitle")).focus();
  }
  async function submitWrite(e) {
    e.preventDefault();
    const cat = (document.querySelector('input[name="cat"]:checked') || {}).value || "free";
    const title = $("#wTitle").value.trim();
    const body = $("#wBody").value.trim();
    const nick = $("#wNick").value.trim();
    const err = $("#wErr");
    if (!title) { err.textContent = "제목을 적어 주세요."; $("#wTitle").focus(); return; }
    if (!body) { err.textContent = "내용을 적어 주세요."; $("#wBody").focus(); return; }
    if (!S.editId && !nick) { err.textContent = "닉네임을 적어 주세요."; $("#wNick").focus(); return; }
    err.textContent = "";
    const btn = $("#wForm button[type=submit]");
    btn.disabled = true;
    if (S.editId) {
      const id = S.editId;
      const ok = await act(() => STORE.editPost(id, { cat, title, body }), "고친 내용을 저장했어요.");
      btn.disabled = false;
      if (ok) go("post", id);
    } else {
      setNick(nick);
      const id = await act(() => STORE.addPost({ cat, title, body, nick }), "글을 올렸어요.");
      btn.disabled = false;
      if (id) go("post", id);
    }
  }

  // ---------- 사이드 ----------
  function renderSide() {
    const all = posts();
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const today = all.filter((p) => p.createdAt >= start).length;
    const comments = all.reduce((n, p) => n + p.comments.length, 0);
    const hot = all.filter((p) => p.likeCount > 0).sort((a, b) => b.likeCount - a.likeCount || b.createdAt - a.createdAt).slice(0, 5);
    let adminPart = "";
    if (S.mode === "cloud" || S.mode === "local") {
      if (S.admin && S.editingClass) {
        adminPart = `<form class="class-form" id="classForm">
          <div class="field"><label for="cfName">반 이름</label><input id="cfName" maxlength="20" placeholder="예: 2학년 3반" value="${esc(str(S.settings.name, 20))}"></div>
          <div class="field"><label for="cfMotto">급훈 또는 한마디</label><input id="cfMotto" maxlength="40" placeholder="예: 서로 돕는 3반" value="${esc(str(S.settings.motto, 40))}"></div>
          <div class="write-actions"><button class="btn" type="button" id="classCancel">취소</button><button class="btn primary" type="submit">저장</button></div>
        </form>`;
      } else if (S.admin) {
        adminPart = `${S.mode === "cloud" ? `<span class="admin-badge">관리자로 들어와 있어요</span><br>` : ""}<button class="link-btn" type="button" id="editClass">반 이름·급훈 바꾸기</button>`;
      } else if (S.claiming) {
        adminPart = `<form class="admin-form" id="adminForm">
          <div class="field"><label for="adminCode">관리자 코드</label><input id="adminCode" type="password" autocomplete="off" placeholder="선생님께 받은 코드"></div>
          <div class="write-actions"><button class="btn" type="button" id="adminCancel">취소</button><button class="btn primary" type="submit">확인</button></div>
        </form>`;
      } else {
        adminPart = `<button class="link-btn" type="button" id="claimAdmin">선생님·반장 인증</button>`;
      }
    }
    $("#side").innerHTML = `
      <section class="card today" aria-label="오늘의 우리 반">
        <p class="date">${now.getMonth() + 1}월 ${now.getDate()}일</p>
        <p class="day">${DAYS[now.getDay()]} · 오늘의 우리 반</p>
        <dl class="stats">
          <div><dt>전체 글</dt><dd>${all.length}</dd></div>
          <div><dt>오늘 새 글</dt><dd>${today}</dd></div>
          <div><dt>댓글</dt><dd>${comments}</dd></div>
        </dl>
        ${adminPart}
      </section>
      <section class="card">
        <h2 class="sec-title">공감 많은 글</h2>
        ${hot.length ? `<ol class="hot">${hot.map((p) => `<li><button type="button" data-open="${esc(p.id)}"><span class="tt">${esc(p.title)}</span><span class="lk">공감 ${p.likeCount}</span></button></li>`).join("")}</ol>`
          : `<p class="hot-none">아직 공감받은 글이 없어요. 좋은 글에 공감을 눌러 주세요.</p>`}
      </section>
      <section class="card rules">
        <h2 class="sec-title">게시판 약속</h2>
        <ul>
          <li>친구를 존중하는 말을 써요.</li>
          <li>전화번호, 주소 같은 개인정보는 올리지 않아요.</li>
          <li>과제 답을 그대로 올리지 말고 푸는 방법을 나눠요.</li>
        </ul>
      </section>`;
    const cf = $("#classForm");
    if (cf) {
      cf.addEventListener("submit", async (e) => {
        e.preventDefault();
        const ok = await act(() => STORE.setSettings({ name: $("#cfName").value.trim(), motto: $("#cfMotto").value.trim() }), "반 정보를 저장했어요.");
        if (ok) { S.editingClass = false; renderSide(); }
      });
      $("#cfName").focus();
    }
    const af = $("#adminForm");
    if (af) {
      af.addEventListener("submit", async (e) => {
        e.preventDefault();
        const code = $("#adminCode").value.trim();
        if (!code) { $("#adminCode").focus(); return; }
        const r = await act(() => STORE.claimAdmin(code));
        if (r === true) {
          S.admin = true; S.claiming = false;
          toast("관리자로 인증했어요. 이제 공지를 쓸 수 있어요.");
          renderAll(true);
        } else if (r === false) {
          toast("코드가 맞지 않아요. 다시 확인해 주세요.");
          $("#adminCode").select();
        }
      });
      $("#adminCode").focus();
    }
  }

  // ---------- 화면 전환 ----------
  function renderAll(rebuild) {
    renderHeader();
    renderSide();
    if (!S.ready) return;
    const v = $("#main").dataset.view;
    if (S.view === "list") { if (rebuild || v !== "list") buildList(); else fillList(); }
    else if (S.view === "post") { if (rebuild || v !== "post:" + S.postId) buildPost(); else fillPost(); }
    else if (S.view === "write") { if (rebuild || v !== "write") buildWrite(); }
  }
  function go(view, id) {
    if (view === "back") { view = "post"; id = S.editId; }
    if (!S.ready) return;
    S.view = view;
    S.postId = view === "post" ? id : null;
    S.editId = view === "write" ? id || null : null;
    S.confirmDel = null;
    renderAll(true);
    const top = $("#main").getBoundingClientRect().top + window.scrollY - 16;
    if (window.scrollY > top) window.scrollTo({ top, behavior: "auto" });
  }
  function setNick(n) {
    S.nick = n;
    LS.set("goorm.nick", n);
    renderHeader();
  }

  // ---------- 클릭 ----------
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-go],[data-open],[data-cat],[data-like],[data-askdel],[data-nodel],[data-del],[data-edit],[data-cdel],#editClass,#classCancel,#claimAdmin,#adminCancel");
    if (!t) return;
    const d = t.dataset;
    if (d.go) { e.preventDefault(); go(d.go); }
    else if (d.open) go("post", d.open);
    else if (d.cat) { S.cat = d.cat; fillList(); }
    else if (d.like) {
      const p = posts().find((x) => x.id === d.like);
      if (p) act(() => STORE.like(p.id, !p.liked));
    }
    else if (d.askdel) { S.confirmDel = d.askdel; fillPost(); }
    else if ("nodel" in d) { S.confirmDel = null; fillPost(); }
    else if (d.del) { const ok = await act(() => STORE.removePost(d.del), "글을 지웠어요."); if (ok) go("list"); }
    else if (d.edit) go("write", d.edit);
    else if (d.cdel) act(() => STORE.removeComment(S.postId, d.cdel), "댓글을 지웠어요.");
    else if (t.id === "editClass") { S.editingClass = true; renderSide(); }
    else if (t.id === "classCancel") { S.editingClass = false; renderSide(); }
    else if (t.id === "claimAdmin") { S.claiming = true; renderSide(); }
    else if (t.id === "adminCancel") { S.claiming = false; renderSide(); }
  });

  // ---------- 닉네임 팝업 ----------
  const modal = $("#nickModal");
  $("#nickBtn").addEventListener("click", () => { $("#nickInput").value = S.nick; modal.hidden = false; $("#nickInput").focus(); });
  $("#nickCancel").addEventListener("click", () => { modal.hidden = true; });
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) modal.hidden = true; });
  $("#nickForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const n = $("#nickInput").value.trim();
    if (!n) { $("#nickInput").focus(); return; }
    setNick(n);
    modal.hidden = true;
    const w = $("#wNick"); if (w && !w.disabled) w.value = n;
    const c = $("#cNick"); if (c) c.value = n;
    toast("닉네임을 '" + n + "'(으)로 정했어요.");
  });

  // 상대 시간(3분 전 등)을 1분마다 새로 그린다
  setInterval(() => { if (S.ready && S.view === "list") fillList(); }, 60000);

  // ---------- 시작 ----------
  function showFail(title, detail, code) {
    S.mode = "error";
    renderHeader();
    $("#main").innerHTML = `<div class="board fail"><h3>${esc(title)}</h3><p>${esc(detail)}</p>${code ? `<code>${esc(code)}</code>` : ""}</div>`;
  }
  async function boot() {
    S.nick = str(LS.get("goorm.nick", ""), 12);
    const cfg = window.GOORM_FIREBASE_CONFIG;
    let store;
    if (cfg && cfg.apiKey && cfg.projectId) {
      try {
        store = await firebaseStore(cfg);
      } catch (e) {
        const code = (e && e.code) || String(e);
        const hint = /operation-not-allowed|admin-restricted/.test(code)
          ? "Firebase 콘솔의 Authentication에서 '익명' 로그인을 켜 주세요."
          : "인터넷 연결과 firebase-config.js 설정을 확인해 주세요.";
        showFail("게시판 서버에 연결하지 못했어요", hint, code);
        return;
      }
    } else {
      store = localStore();
    }
    STORE = store;
    S.mode = store.mode;
    S.meId = store.uid;
    S.admin = store.admin;
    if (store.member) start();
    else showGate();
  }

  // ---------- 초대코드 입장 화면 ----------
  function showGate() {
    document.body.classList.add("locked");
    const gate = $("#gate");
    gate.hidden = false;
    const input = $("#gateCode"), err = $("#gateErr"), btn = $("#gateForm button[type=submit]");
    input.focus();
    $("#gateForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = input.value.trim();
      if (!code) { err.textContent = "초대코드를 적어 주세요."; input.focus(); return; }
      btn.disabled = true;
      err.textContent = "";
      let ok = false;
      try { ok = await STORE.join(code); }
      catch (e2) { err.textContent = "확인하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요."; btn.disabled = false; return; }
      btn.disabled = false;
      if (!ok) { err.textContent = "초대코드가 맞지 않아요. 선생님이나 반장에게 다시 물어봐 주세요."; input.select(); return; }
      gate.hidden = true;
      document.body.classList.remove("locked");
      toast("구름닷컴에 들어왔어요.");
      start();
    });
  }

  function start() {
    const store = STORE;
    renderHeader();
    let gotPosts = false, gotComments = false;
    const ready = () => { if (gotPosts && gotComments) { S.ready = true; renderAll(false); } else renderSide(); };
    store.onSettings((s) => { S.settings = obj(s); renderHeader(); renderSide(); });
    store.onComments((list) => { S.comments = list; gotComments = true; ready(); });
    store.onPosts(
      (list) => { S.posts = list; gotPosts = true; ready(); },
      (e) => showFail("글 목록을 불러오지 못했어요", "Firestore 보안 규칙(firestore.rules)을 붙여 넣었는지 확인해 주세요.", e && e.code)
    );
  }
  renderHeader();
  renderSide();
  boot();
})();
