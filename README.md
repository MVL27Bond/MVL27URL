# MVL27URL

> URL shortener chạy trên Cloudflare Workers và KV, có trang quản trị, tài khoản admin, API key, mật khẩu tạo link và cấu hình thương hiệu.

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f6821f?logo=cloudflare&logoColor=white)
![Storage](https://img.shields.io/badge/storage-KV-2563eb)
![License](https://img.shields.io/badge/license-internal-64748b)

## MVL27URL là gì?

MVL27URL biến URL dài thành link ngắn:

```text
https://example.com/articles/a-very-long-address
                           v
https://short.example.com/demo
```

Ứng dụng gồm trang tạo link tại `/`, trang quản trị tại `/links`, lưu trữ vĩnh viễn trong Cloudflare KV và quyền xóa link chỉ dành cho admin.

## Tính năng chính

| Nhóm | Tính năng |
| --- | --- |
| Link | Slug ngẫu nhiên an toàn, slug tùy chỉnh, title, redirect 302, click counter |
| Bảo mật | Username/password admin, PBKDF2, session HttpOnly, Origin check, rate limit |
| Quyền tạo link | Admin session, API key bật/tắt được, mật khẩu tạo link tùy chọn |
| Quản trị | Danh sách, tìm kiếm, thống kê, xóa một link, xóa toàn bộ link |
| Branding | Tên website, logo URL, domain short URL |
| An toàn dữ liệu | Link mới nằm trong `link:<slug>`, không xóa nhầm settings/session |

## Deploy nhanh bằng Cloudflare Dashboard

Đây là cách đơn giản nhất: không cần terminal và không cần build project.

### 1. Tạo Worker

1. Mở **Cloudflare Dashboard → Workers & Pages**.
2. Chọn **Create application → Create Worker**.
3. Đặt tên Worker và bấm **Deploy**.
4. Chọn **Edit code**, xóa code mẫu.
5. Mở file `worker.js` trong repository này, copy toàn bộ nội dung và dán vào editor.
6. Bấm **Save and deploy**.

### 2. Tạo và bind KV

KV là nơi lưu tài khoản admin, settings và link. Không có KV thì dữ liệu không thể lưu vĩnh viễn.

1. Vào **Storage & Databases → KV**.
2. Chọn **Create namespace**, đặt tên ví dụ `MVL27URL_DATA`.
3. Mở **Worker → Settings → Variables and Secrets**.
4. Trong **KV namespace bindings**, chọn **Add binding**.
5. Đặt **Variable name** chính xác là `url`.
6. Chọn namespace vừa tạo, bấm **Save**, rồi deploy lại Worker.

Worker cũng nhận binding tên `URLS` hoặc `KV`, nhưng nên dùng `url` để dễ nhớ.

### 3. Tạo admin lần đầu

1. Mở URL Worker và thêm `/links`.
2. Ví dụ: `https://mvl27url.username.workers.dev/links`.
3. Tạo username và mật khẩu admin, tối thiểu 10 ký tự.
4. Sau setup, bạn sẽ được đăng nhập tự động.

### 4. Cấu hình website

Trong `/links → Cài đặt`, admin có thể đổi:

- Tên website.
- Logo bằng URL `http` hoặc `https`.
- Domain dùng để sinh short URL.
- API key.
- Mật khẩu tạo link.
- Mật khẩu admin.

> Đổi trường **Domain** không tự tạo DNS. Muốn dùng domain riêng, hãy thêm Custom Domain cho Worker trước.

### Nếu quên bind KV

Website sẽ hiện trang **Chưa cấu hình lưu trữ** thay vì lỗi 500. Hãy bind KV với tên `url`, `URLS` hoặc `KV`, sau đó reload trang.

## Bảo vệ setup lần đầu bằng `SETUP_KEY`

Nếu Worker đã public trước khi setup, nên tạo secret bootstrap:

1. Vào **Worker → Settings → Variables and Secrets**.
2. Chọn **Add secret**.
3. Đặt tên `SETUP_KEY` và nhập giá trị khó đoán.
4. Deploy lại Worker.
5. Nhập giá trị này vào trường **Bootstrap key** khi setup.

Sau setup lần đầu, endpoint setup tự khóa.

## Cấu hình quyền tạo link

| API key | Mật khẩu tạo link | Ai được tạo link |
| :---: | :---: | --- |
| Tắt | Không đặt | Chỉ admin đã đăng nhập |
| Tắt | Đã đặt | Admin hoặc người có mật khẩu |
| Bật | Không đặt | Admin hoặc người có API key |
| Bật | Đã đặt | Admin, API key hoặc mật khẩu |

API key chỉ có quyền tạo link, không có quyền xem hoặc xóa link. API key tối thiểu 16 ký tự và được hash trước khi lưu KV. Mật khẩu tạo link gửi bằng header `x-create-password`; nhập `-` trong Cài đặt để tắt.

## Custom domain

1. Vào **Worker → Settings → Domains & Routes**.
2. Chọn **Add Custom Domain**.
3. Nhập domain đã nằm trong zone Cloudflare.
4. Hoàn tất DNS theo hướng dẫn Cloudflare.
5. Vào `/links → Cài đặt`, đặt trường **Domain** bằng domain vừa thêm.

Kết quả:

```text
https://short.example.com/demo
```

## Sử dụng API

### Tạo link bằng API key

```bash
curl -X POST "https://short.example.com/shorten" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"url":"https://example.com/a-long-path","slug":"demo","title":"Demo"}'
```

### Tạo link bằng mật khẩu riêng

```bash
curl -X POST "https://short.example.com/shorten" \
  -H "Content-Type: application/json" \
  -H "x-create-password: YOUR_CREATE_PASSWORD" \
  -d '{"url":"https://example.com/a-long-path"}'
```

Response thành công:

```json
{
  "slug": "demo",
  "shortUrl": "https://short.example.com/demo",
  "originalUrl": "https://example.com/a-long-path",
  "permanent": true,
  "createdAt": "2026-08-20T00:00:00.000Z"
}
```

### Danh sách endpoint

| Method | Endpoint | Quyền | Mô tả |
| --- | --- | --- | --- |
| `GET` | `/api/setup-status` | Public | Kiểm tra trạng thái setup |
| `POST` | `/api/setup` | Một lần | Tạo admin đầu tiên |
| `POST` | `/api/auth/login` | Public | Đăng nhập admin |
| `POST` | `/api/auth/logout` | Admin | Đăng xuất |
| `POST` | `/shorten` | Admin/API key/create password | Tạo link |
| `GET` | `/api/links` | Admin | Xem toàn bộ link |
| `GET` | `/api/stats` | Admin | Xem thống kê |
| `GET` | `/api/settings` | Admin | Xem settings |
| `PUT` | `/api/settings` | Admin | Cập nhật settings |
| `DELETE` | `/api/links/:slug` | Admin | Xóa một link |
| `DELETE` | `/api/links` | Admin | Xóa toàn bộ link |
| `GET` | `/:slug` | Public | Redirect tới URL gốc |

## Deploy bằng Wrangler

Dùng cách này khi muốn quản lý deployment bằng Git/CLI.

```bash
npm install
npx wrangler login
cp wrangler.toml.example wrangler.toml
npx wrangler kv namespace create URLS
npx wrangler deploy
```

Copy namespace ID vào `wrangler.toml` trước khi deploy. Secret tùy chọn:

```bash
npx wrangler secret put SETUP_KEY
npx wrangler secret put API_KEY
```

Không commit `wrangler.toml` hoặc secret vào Git.

## Deploy Cloudflare Pages

Worker này có thể chạy bằng Pages Advanced Mode:

```bash
npm install
npm run build:pages
npx wrangler pages project create mvl27url
npx wrangler pages deploy dist --project-name mvl27url
```

Trong Pages project, vào **Settings → Functions**, thêm KV namespace binding với variable name `url`, rồi redeploy.

Nếu dùng Git integration:

- Build command: `npm run build:pages`
- Build output directory: `dist`

## Lưu trữ và tương thích dữ liệu

| Prefix/key | Mục đích |
| --- | --- |
| `system:settings` | Settings và thông tin xác thực đã hash |
| `session:<token>` | Session admin, tự hết hạn sau 24 giờ |
| `link:<slug>` | Link mới |
| `ratelimit:<type>:<ip>` | Rate limit tạm thời |

Link cũ lưu bằng slug thô vẫn được đọc và redirect. Chỉ admin mới có thể xóa link.

## Bảo mật và giới hạn

- Dùng HTTPS cho production.
- Không chia sẻ API key hoặc mật khẩu tạo link.
- URL chỉ nhận scheme `http` và `https`; URL chứa username/password bị từ chối.
- Session admin dùng cookie `HttpOnly`, `Secure`, `SameSite=Strict`.
- Đổi mật khẩu admin sẽ vô hiệu hóa session cũ.
- API JSON có `Cache-Control: no-store`.
- Request thay đổi dữ liệu được kiểm tra Origin.
- Rate limit mặc định là 50 request/giờ theo IP; setup có giới hạn riêng.
- Cloudflare KV là eventual consistency. Rate limit, slug trùng đồng thời và click counter không phải thao tác atomic.
- Với lưu lượng lớn hoặc analytics chính xác, nên chuyển counter/rate limit sang Durable Objects hoặc Cloudflare Rate Limiting.
- Trang admin tải toàn bộ link để tìm kiếm tại client; nên bổ sung pagination khi dữ liệu rất lớn.

## Kiểm tra local

```bash
npm install
npm run check
npm run build:pages
```

Nên kiểm tra setup, login/logout, đổi mật khẩu, API key, mật khẩu tạo link, URL không hợp lệ, redirect và thao tác xóa link.

## Cấu trúc project

```text
.
├── worker.js                 # Worker chính và giao diện HTML
├── wrangler.toml.example     # Cấu hình mẫu cho Wrangler
├── package.json              # Scripts kiểm tra/build
└── scripts/
    └── build-pages.mjs       # Tạo dist/_worker.js cho Pages
```

## License

Dự án nội bộ MVL27URL. Bổ sung license riêng nếu phát hành công khai.
