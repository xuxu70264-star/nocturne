# NOCTURNE — handoff

> 最后更新：2026-10-27 15:45
> 当前版本：`?v=20261027-1`
> 运行：`cd nocturne && node server.js` → http://127.0.0.1:4173/

零依赖静态前端 + 一个极小的 Node 静态服务器；没有构建步骤。网易云相关能力全部走 `server.js`，
浏览器不直接持有 Cookie。

---

## 1. 现在有什么

- **开场**：Manrope 800 的 `NOCTURNE 夜航`、20px 副题、白色胶囊「进入 →」
- **主舞台**：WebGL2 波点之心（Taubin 隐式曲面）、三档半调、鼓点/低频驱动、H/H 尘埃切换
- **顶部 nav**：歌曲库 / 轮盘 / 歌单架 / 画廊 / 日推
- **歌曲库**：网易云搜索、添加、逐行删除、当前队列；内置 3 首 demo
- **轮盘**：圆弧歌词 + 右侧三张封面堆，上下拖整摞换歌
- **歌单架**：读网易云账号歌单，点击后把该歌单载入歌曲库
- **画廊**：当前歌单全部封面的斜向裸图叠层；鼠标视差 + 拖拽/滚轮翻阅
- **日推**：网易云每日推荐，载入歌曲库
- **登录**：右上角扫码；扫码被限制时可粘贴 `MUSIC_U` 登录
- **播放**：本地/网易云统一队列，支持进度拖动、音量、上一首/下一首、Media Session

---

## 2. 文件

```
nocturne/
  index.html          # hud / stage / drawer / shelf / gallery / wheel / curtain / login
  server.js           # 静态文件 + Range + 网易云登录/eapi/搜索/歌词/音频代理
  css/style.css       # 全站样式
  css/fonts.css       # General Sans + Manrope 本地 @font-face
  js/app.js           # 总控：队列、播放、nav、视图、文件拖入
  js/audio.js         # <audio> + AnalyserNode
  js/stage.js         # WebGL2 舞台/心/光柱
  js/heart.js         # 心形点云与局部拖拽
  js/paper-dots.js    # 纸张半调 wake（Canvas2D）
  js/lyrics.js        # LRC/纯文本解析与时间轴
  js/meta.js          # ID3v2 标签/封面
  js/wheel.js         # 轮盘歌词 + 封面堆
  js/shelf.js         # 歌单架（玻璃卡片，拖动翻）
  js/gallery.js       # 斜向裸图叠层（9 张卡池）
  js/ink.js           # 同色墨点加载：真实进度驱动的圆形转场
  js/cursor.js        # 自制纸点光标 + 慢半拍圆环；?cursor=0 关闭
  js/netease.js       # 歌曲库里的网易云搜索 UI
  js/login.js         # 二维码/Cookie 登录 + 账号态
  js/pwa.js           # 注册 Service Worker；?sw=0 注销
  manifest.webmanifest# PWA 名称/图标/独立窗口
  sw.js               # app shell 缓存；/api/ 永不拦截
  icons/              # 192/512/maskable/180
  vendor/qrcode.js    # 二维码 SVG（MIT）
  vendor/fonts/       # General Sans / Manrope（本地）
```

### PWA

- `manifest.webmanifest` + `sw.js` 让 Chrome/Edge 可以“安装 Nocturne”
- Service Worker 只缓存 UI、字体、demo；`/api/` 直接放行，登录和音频不走缓存
- JS/CSS/导航用 network-first，改了网页刷新就能拿到；字体/图标/demo 用 cache-first
- 调试时 `?sw=0` 会注销现有 Service Worker
- 仍需本地 `node server.js`；PWA 不是 Electron，没有独立服务端

---

## 3. 网易云接入

### 登录

- `POST /api/netease/login/qr`：取 `unikey`，返回 `{key,url}`，URL 为
  `https://music.163.com/login?codekey=…`
- `GET /api/netease/login/qr/check?key=`：1.8s 轮询；800 失效 / 801 等待 / 802 已扫 / 803 成功
- `POST /api/netease/login/cookie`：手动粘贴 `MUSIC_U`，用 `/api/nuser/account/get` 验 profile
- `GET /api/netease/me`、`POST /api/netease/logout`
- Cookie 持久化到 `nocturne/.netease-session.json`（0600）；启动时 `restoreSession()` 验证并恢复，
  `/me` 会在 profile 为空时再验一次；静态服务显式拒绝所有 dotfile，避免 cookie 被浏览器直接下载
- 也支持 `NOCTURNE_NETEASE_COOKIE` 环境变量；`logout` 删除 session 文件
- 扫码被网易云风控拒绝时，UI 提示并自动切到 Cookie 面板；Cookie 只需登录一次

### eapi

`server.js` 自己实现 eapi（AES-128-ECB + MD5，key `e82ckenh8dichen8`），不依赖 Mineradio。
Cookie header 会补 `os/osver/appver/versioncode/channel`。

- 搜索：`/api/cloudsearch/pc`，回退 `/api/search/pc`、`/api/search/get`
- 播放 URL：`/api/song/enhance/player/url/v1`（exhigh → standard），旧接口兜底
- 歌词：`/api/song/lyric/v1` → `/api/song/lyric`
- 歌单：`/api/user/playlist`、`/api/v6/playlist/detail`（必要时 `/api/v3/song/detail` 补曲目）
- 日推：`/api/v3/discovery/recommend/songs` 等

### 页面侧

- `GET /api/netease/search?q=&limit=`
- `GET /api/netease/song?id=` → `{url, quality, trial, lyric}`
- `GET /api/netease/playlists`
- `GET /api/netease/playlist?id=`
- `GET /api/netease/daily`
- `GET /api/netease/audio?url=`：同源代理；host 只允许 `*.music.126.net` / `*.126.net` / `*.netease.com`；
  转发 Range/Content-Range，**不要**套 9s API 超时

歌单/日推进入队列时是**懒加载**：只有 `id/title/artist/cover/duration`，点播放才
`resolveNeteaseTrack()` 去取 URL + LRC。不要给 `src` 塞空字符串。

歌词返回里混有 `{"t":...}` 的 YRC JSON 行，必须过滤，只留 `[mm:ss]` / `[ti:]`。

---

## 4. 队列与视图

### 歌曲库（drawer）

- 顶栏「歌曲库」= 原 `L` 抽屉
- 网易云搜索区在最上面；下面是当前队列
- 队列 3 首 demo：夜航 / 深海 / 潮汐
- 每行 `×` 删除；删当前会切下一首；只剩一首会拦住
- **只切换 `.is-active`，不要每次 `selectTrack` 都重建 384 行**；`syncPlaylistActive()` 负责

### 轮盘

- `W` / nav 打开
- 圆弧歌词 + 右侧三张封面；上下拖整摞 / 点邻卡 / 滚轮换歌
- `wheel-empty` 的「纯音乐 · 无歌词」使用 `--font-display` 600，不是衬线

### 歌单架

- `S` / nav 打开；`GET /api/netease/playlists`
- 只有**拖动 / 滚轮 / 方向键**才移动；单纯悬停不移动
- 卡片的 `pointerdown` **不要立刻 setPointerCapture**，否则 click 会被根节点吞掉；
  超过 5px 再捕获，并在 pointerup 释放
- 单击一张歌单 → `/api/netease/playlist?id=` → 替换队列 → 回主页面（不自动打开右侧歌曲库）；加载用墨点转场

### 歌单加载状态

- 打开歌单架先 `Shelf.setLoading()`：空 rail + 中心「正在读取你的歌单…」，footer 隐藏；
  不能先塞一个占位歌单，否则会像没删干净的孤立卡片
- 数据回来 `setQueue()` 移除 loading；失败 `closeShelf()` + toast
- 过渡：`.shelf__stage` 从右侧 64px / scale .985 推入（880ms），head/foot 错开淡入；
  去掉全屏 `backdrop-filter`，封面用 `?param=420y420`，避免打开时卡顿

### 同色墨点加载

- `js/ink.js`：点击点记录为圆心；覆盖层 `clip-path: circle(r at x y)`，底色 `#1e1e1e` + `--grain`
- 半径由真实阶段（0.15 发出 / 0.55 响应 / 0.86 JSON / 0.97 队列完成）驱动；
  等待时缓慢逼近 0.9，铺满 94% 就停住，绝不提前盖满
- 数据完成才 `complete()`：至少 420ms、补满、停 120ms；随后歌曲库 `is-ink-revealing` 淡入
- 失败/`Esc` 回缩 280ms；`aria-live` 播报；reduced-motion 直接铺满淡入

### 画廊

- `G` / nav 打开；展示当前队列（选中歌单）的全部封面
- 斜向叠层：裸图、无边框、无编号；鼠标移动有视差；**悬停封面时该卡向右上滑出 84px / 24px**；
  拖拽/滚轮/箭头翻阅，点击播放
- **9 张固定卡池**复用，不是每首歌一个 DOM；封面 `?param=420y420`
- 背景是深灰纸面（与主体一致），没有全屏 `backdrop-filter`
- 打开 gallery/shelf/wheel 时跳过 stage/heart 的 WebGL 渲染
- 卡片 `pointerdown` 同样不要立即捕获，避免点击无反馈

### 日推

- nav 最右；`GET /api/netease/daily`，替换队列并打开歌曲库

---

## 5. 视觉

- 全站纸面 `#1e1e1e` + `--grain`；舞台框 `#262626` / 12px / 1px .06 / 30px
- 字体：`--font-display` General Sans；`--font-hero` Manrope（开场）
- 无歌词的 `.quiet__title` 与歌词 `.lyrics__line--cur` 统一 `--font-display` 600、
  `clamp(30px, 4vw, 60px)`；切歌时不再从 76px 衬线跳到 46px 无衬线
- 视图标题（歌曲库/轮盘/歌单架/画廊）统一 `--font-display` 600、24px、`-0.01em`；
  不再用衬线
- 视图 footer 的歌曲名、`#drum-title` 也用 `--font-display` 600
- 歌曲库/日推的 `.track__title` 600、`.track__artist` 500；歌单卡 `.shelf-card__title` 600
- 歌曲库搜索区的 `.nsearch__label`「网易云」也用 `--font-display` 600，不再用衬线
- 轮盘 `.stack-card` 背景透明、无边框、无阴影；拖动时 dx 让整摞横向滑出，dy 切换歌曲
- 切换视觉预设时 `paperDots.setColor(css.accent)`，鼠标拖出的半调点和点击圆环跟着 accent 变色
- 自定义光标：5px 纸点 + 28px 细环，环慢半拍跟随；按钮/封面放大到 42px，输入框切回系统 `text` 光标；
  `?cursor=0` 完全关闭，触屏不启用
- 底部播放条：歌名 16/600、歌手 11/600、时间 12、进度 4px；播放键原来的奶油圆钮 + 两根竖线跟鼠标
- `.now` / `.gallery__now` / `.gallery__foot` / `.dock__row` 背景透明，不要给 now 区域加黑底/边框

---

## 6. 已知坑

1. **扫码经常被网易云风控拦截**，不是本地二维码逻辑的错误；用 Cookie 登录一次即可，
   `.netease-session.json` 会在重启后恢复。若仍被拒，先升级官方 App/换网络，再回退 Cookie。
2. **pointer capture 太早会导致点击无反馈**：必须等真正拖动后再捕获，并在 up 释放。
3. **gallery 不要给每首歌建 DOM**：384 首会卡；9 张卡池 + 懒加载。
4. **gallery 不要用全屏 backdrop-filter**：会拖垮 WebGL 舞台；背景保持不透明。
5. **音频代理不能套 9s 超时**：流要一直开着；Range 必须转发。
6. **歌词 YRC JSON 要过滤**，否则 LRC 解析异常。
7. **歌单详情 384 首**：一次性建 384 行可以，但切歌不要重建；打开时只加载当前窗口封面。
8. **`Shelf.setQueue` 要重置 `_focus`**，否则 footer 会停在 loading 文案。
9. **Cookie 是敏感信息**：`.netease-session.json` 含明文凭据，已加入 `.gitignore`，静态服务也拒绝 dotfile；
   不要提交、不要发给别人、不要让 server 监听公网。
10. **改 CSS/JS 必须 bump `index.html` 的 `?v=`**（当前 `20261027-1`）。

---

## 7. 验收

```bash
cd nocturne
node --test
node server.js
```

- 3 首 demo；歌手/标题正常
- 登录后歌曲库搜索 → 点结果播放
- 歌单架 12 个歌单；点「我喜欢的音乐」→ 384 首进入歌曲库
- 画廊 384 封面；拖动/点击/播放；控制台无报错
- 日推 32 首进入歌曲库
- 控制台干净；`prefers-reduced-motion` 下不启用拖尾/视差
