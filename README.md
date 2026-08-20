# MVL27URL

> URL shortener chạy trên Cloudflare Edge, có trang quản trị, session admin, API key bật/tắt được và cấu hình website lưu trong KV.

[![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-orange)](https://developers.cloudflare.com/workers/)
[![Cloudflare Pages](https://img.shields.io/badge/deploy-Cloudflare%20Pages-f6821f)](https://developers.cloudflare.com/pages/)

## Mục lục

- [Tính năng](#tính-năng)
- [Kiến trúc và lưu trữ](#kiến-trúc-và-lưu-trữ)
- [Chạy local](#chạy-local)
- [Deploy Cloudflare Workers](#deploy-cloudflare-workers-khuyến-nghị)
- [Deploy Cloudflare Pages](#deploy-cloudflare-pages)
- [Thiết lập lần đầu](#thiết-lập-lần-đầu)
- [Sử dụng API](#sử-dụng-api)
- [Quản trị website](#quản-trị-website)
- [Bảo mật và giới hạn](#bảo-mật-và-giới-hạn)
- [Kiểm tra và vận hành](#kiểm-tra-và-vận-hành)

## Tính năng

- Tạo slug ngẫu nhiên bằng Web Crypto hoặc slug tùy chỉnh tối đa 20 ký tự.
- Chỉ chấp nhận URL `http://` và `https://`; từ chối scheme nguy hiểm và URL chứa username/password.
- Link mới được lưu vĩnh viễn trong Cloudflare KV; chỉ admin đăng nhập mới có thể xóa.
- Theo dõi lượt click và tiêu đề link.
- Tài khoản admin tạo một lần ngay trên `/links`.
- Mật khẩu admin được băm PBKDF2 với salt, không lưu plaintext.
- Session admin dùng cookie `HttpOnly`, `Secure`, `SameSite=Strict`, TTL 24 giờ.
- API key có thể bật/tắt. API key chỉ dùng cho quyền tạo link, không dùng để mở trang quản trị.
- Mật khẩu tạo link riêng, tùy chọn, dùng qua header `x-create-password`.
- Quản lý tên website, logo, domain, API key, mật khẩu tạo link và mật khẩu admin trong tab **Cài đặt**.
- Rate limit theo IP cho setup, login, tạo link và thao tác admin.
- Có hỗ trợ migrate link cũ được lưu bằng slug thô; link mới dùng namespace `link:<slug>` để không đụng settings/session.

## Kiến trúc và lưu trữ

Đây là **Cloudflare Worker module**, không phải ứng dụng Node server truyền thống.

- `worker.js`: request handler, giao diện HTML, API và redirect.
- KV binding `url`: lưu settings, session, rate limit và link.
- `system:settings`: cấu hình website và thông tin xác thực đã hash.
- `session:<token>`: session admin tạm thời.
- `link:<slug>`: link mới. Link legacy có slug thô vẫn được đọc để tương thích.
- `wrangler.toml.example`: mẫu cấu hình deploy Workers.
- `scripts/build-pages.mjs`: tạo `dist/_worker.js` cho Cloudflare Pages Advanced Mode.

> Domain trong phần Cài đặt chỉ thay đổi URL được sinh ra và branding. Nó không tự tạo DNS, route Worker hay custom domain trong Cloudflare Dashboard.

## Yêu cầu

- Node.js 18 trở lên.
- Tài khoản Cloudflare có quyền Workers KV và Workers/Pages.
- Domain dùng custom domain phải được thêm vào zone Cloudflare và DNS phải trỏ đúng theo hướng dẫn Cloudflare.

## Chạy local

```bash
npm install
cp wrangler.toml.example wrangler.toml
```

Mở `wrangler.toml`, thay `REPLACE_WITH_KV_NAMESPACE_ID` bằng namespace ID thật. Tạo namespace:

```bash
npx wrangler kv namespace create URLS
npx wrangler kv namespace create URLS --preview
```

Điền cả `id` và `preview_id` nếu cần chạy preview. Sau đó chạy:

```bash
npx wrangler dev
```

Mở URL local mà Wrangler hiển thị và truy cập `/links` để setup.

## Deploy Cloudflare Workers (khuyến nghị)

### 1. Đăng nhập và tạo KV

```bash
npx wrangler login
npx wrangler kv namespace create URLS
```

Copy namespace ID vào `wrangler.toml`. Không commit file này nếu bạn không muốn lưu ID deployment trong Git.

### 2. Secret tùy chọn

`API_KEY` chỉ cần cho migrate hệ thống cũ hoặc muốn có API key mặc định từ environment. Cài đặt mới nên bật API key trong `/links`.

```bash
npx wrangler secret put API_KEY
```

Để bảo vệ endpoint setup lần đầu bằng một secret bootstrap:

```bash
npx wrangler secret put SETUP_KEY
```

Nếu `SETUP_KEY` tồn tại, nhập giá trị đó vào trường **Bootstrap key** trong `/links` hoặc gửi header `x-setup-key`.

### 3. Deploy

```bash
npx wrangler deploy
```

Sau khi deploy:

1. Mở `https://<worker-subdomain>/links`.
2. Tạo username và mật khẩu admin.
3. Đặt domain/logo/tên website trong tab **Cài đặt**.
4. Bật API key hoặc đặt mật khẩu tạo link nếu muốn người khác sử dụng.

### 4. Custom domain

Trong Cloudflare Dashboard vào **Workers & Pages → Worker → Settings → Domains & Routes**, thêm custom domain. Sau khi DNS hoạt động, đặt đúng domain đó trong tab **Cài đặt** để URL sinh ra khớp domain.

## Deploy Cloudflare Pages

Worker này có thể chạy trên Cloudflare Pages bằng **Advanced Mode**. Pages sẽ serve file `_worker.js` trong thư mục output.

### Deploy thủ công bằng CLI

```bash
npm install
npm run build:pages
npx wrangler pages project create mvl27url
npx wrangler pages deploy dist --project-name mvl27url
```

Khi Pages hỏi production branch, chọn branch bạn muốn dùng. Tạo KV namespace như phần Workers, sau đó bind KV cho Pages project:

```bash
npx wrangler pages secret put SETUP_KEY --project-name mvl27url
```

KV binding `url` cần được thêm trong Cloudflare Dashboard:

1. **Workers & Pages → mvl27url → Settings → Functions**.
2. Thêm KV namespace binding với variable name chính xác là `url`.
3. Chọn namespace đã tạo.
4. Redeploy Pages project.

> Pages Git integration dùng **Build command** `npm run build:pages` và **Build output directory** `dist`. Không tạo thư mục `functions/`; Advanced Mode sử dụng `dist/_worker.js` làm Worker entrypoint.

> Nếu muốn cấu hình KV bằng file Wrangler và deploy có kiểm soát, dùng Workers deployment ở trên. Pages phù hợp khi bạn muốn quản lý domain và pipeline qua Pages Dashboard.

## Thiết lập lần đầu

1. Mở `/links`.
2. Nhập username admin và mật khẩu tối thiểu 10 ký tự.
3. Có thể đặt mật khẩu tạo link riêng.
4. Có thể nhập API key tối thiểu 16 ký tự để bật quyền API cho người khác.
5. Nếu deploy với `SETUP_KEY`, nhập bootstrap key.
6. Sau khi setup, session được tạo tự động và bạn có thể mở tab **Cài đặt**.

Chính sách tạo link:

| API key | Mật khẩu tạo link | Ai được tạo link |
| --- | --- | --- |
| Tắt | Không đặt | Chỉ admin session |
| Tắt | Đã đặt | Admin hoặc người có mật khẩu |
| Bật | Không đặt | Admin hoặc người có API key |
| Bật | Đã đặt | Admin, API key hoặc mật khẩu |

## Sử dụng API

### Tạo link bằng API key

```bash
curl -X POST https://short.example.com/shorten \
	-H 'Content-Type: application/json' \
	-H 'x-api-key: YOUR_API_KEY' \
	-d '{"url":"https://example.com/a-long-path","slug":"demo","title":"Demo"}'
```

### Tạo link bằng mật khẩu riêng

```bash
curl -X POST https://short.example.com/shorten \
	-H 'Content-Type: application/json' \
	-H 'x-create-password: YOUR_CREATE_PASSWORD' \
	-d '{"url":"https://example.com/a-long-path"}'
```

### Các endpoint

| Method | Endpoint | Quyền | Mục đích |
| --- | --- | --- | --- |
| `GET` | `/api/setup-status` | Public | Đọc trạng thái setup và cấu hình public |
| `POST` | `/api/setup` | One-time | Tạo tài khoản admin lần đầu |
| `POST` | `/api/auth/login` | Public | Đăng nhập admin |
| `POST` | `/api/auth/logout` | Admin session | Đăng xuất |
| `POST` | `/shorten` | Admin/API key/create password | Tạo link vĩnh viễn |
| `GET` | `/api/links` | Admin session | Liệt kê link |
| `GET` | `/api/stats` | Admin session | Thống kê hệ thống |
| `GET` | `/api/settings` | Admin session | Đọc settings |
| `PUT` | `/api/settings` | Admin session | Cập nhật settings |
| `DELETE` | `/api/links/:slug` | Admin session | Xóa một link |
| `DELETE` | `/api/links` | Admin session | Xóa toàn bộ link |
| `GET` | `/:slug` | Public | Redirect và ghi click |

## Quản trị website

Trong `/links → Cài đặt`, admin có thể:

- Đổi tên website, logo URL và domain sinh short URL.
- Bật/tắt API key.
- Đặt API key mới; API key được hash trước khi lưu KV.
- Đặt mật khẩu tạo link hoặc nhập `-` để tắt.
- Đổi mật khẩu admin. Khi đổi mật khẩu, session cũ bị vô hiệu hóa.
- Xóa từng link hoặc xóa toàn bộ link. Thao tác xóa toàn bộ luôn yêu cầu nhập `DELETE`.

## Bảo mật và giới hạn

- Không commit `wrangler.toml` có secret hoặc API key.
- Dùng HTTPS cho production; cookie admin có cờ `Secure`.
- Link mới chỉ nhận `http`/`https`, không nhận credential trong URL.
- Các response JSON không được cache (`no-store, private`).
- Request thay đổi trạng thái được kiểm tra `Origin` và cookie dùng `SameSite=Strict`.
- Cloudflare KV là eventual consistency: rate limit, setup đồng thời, slug tùy chỉnh đồng thời và click counter không phải primitive atomic. Với lưu lượng lớn hoặc yêu cầu analytics chính xác, chuyển counter/rate limit/bootstrap sang Durable Objects hoặc Cloudflare Rate Limiting.
- Trang admin hiện tải toàn bộ link để tìm kiếm tại client. Khi namespace rất lớn, nên thêm API pagination/index riêng trước khi mở rộng quy mô.
- `DELETE /api/links` chỉ xóa keys nhận diện là link; không xóa settings, session hoặc rate-limit keys.
- CORS mặc định phục vụ cùng custom domain. Nếu dùng frontend khác origin, cần thiết kế allowlist origin riêng trước khi mở rộng CORS.

## Backup và migration KV

Trước khi deploy bản mới hoặc xóa hàng loạt, export KV bằng Wrangler:

```bash
npx wrangler kv key list --namespace-id YOUR_NAMESPACE_ID
npx wrangler kv key get 'system:settings' --namespace-id YOUR_NAMESPACE_ID
```

Không xóa `system:settings`, `session:*` hoặc `ratelimit:*` khi viết script dọn dữ liệu. Link legacy lưu bằng slug thô vẫn được đọc; link mới lưu dưới `link:<slug>`.

## Kiểm tra và vận hành

Kiểm tra cú pháp:

```bash
npm run check
```

Smoke test nên bao phủ:

- Setup lần đầu và setup lần hai bị từ chối.
- Login sai/đúng, logout và session hết hạn.
- API key bật/tắt, mật khẩu tạo link.
- Tạo URL độc hại bị từ chối.
- Link redirect, list, xóa một link và xóa toàn bộ không ảnh hưởng settings.
- Custom domain/logo/settings sau redeploy.

## License

Dự án nội bộ MVL27URL. Bổ sung license riêng nếu phát hành công khai.
# MVL27URL

Cloudflare Workers URL shortener dùng KV namespace.

## Cấu hình

- Bind KV namespace với tên `url`.
- Bind secret `API_KEY` dài tối thiểu 16 ký tự nếu muốn dùng API key legacy khi migrate; cấu hình mới được tạo và hash trong KV qua `/links`.
- Custom domain mặc định là `url.mvl27.bond`; cập nhật `CUSTOM_DOMAIN` trong `worker.js` nếu triển khai domain khác.

## Tính năng

- Tạo slug ngẫu nhiên bằng Web Crypto, hoặc slug tùy chỉnh tối đa 20 ký tự.
- Chỉ nhận URL `http`/`https`, không nhận `javascript:`, scheme lạ hoặc URL chứa thông tin đăng nhập.
- Link được lưu vĩnh viễn trong KV; chỉ admin đã đăng nhập mới có thể xóa.
- Theo dõi lượt click, tiêu đề tùy chọn và danh sách link được sắp xếp theo thời gian tạo.
- Rate limit riêng cho tạo link, login và các thao tác admin, tối đa 50 request/giờ theo IP.
- Lần đầu mở `/links`, admin tự tạo username và mật khẩu. Session dùng cookie `HttpOnly`, không lưu mật khẩu plaintext.
- Admin có thể bật/tắt API key, đặt mật khẩu tạo link tùy chọn, và quản lý tên website, logo, domain trong tab Cài đặt.
- Khi API key tắt và không đặt mật khẩu tạo link, chỉ phiên admin đăng nhập mới được tạo link.

## API

Session admin được tạo qua `/api/auth/login`. API key (nếu được bật) chỉ dùng để tạo link, với header `x-api-key: <API_KEY>`. Mật khẩu tạo link dùng header `x-create-password: <PASSWORD>`.

- `POST /api/setup`: thiết lập tài khoản admin một lần.
- `POST /api/auth/login` và `POST /api/auth/logout`: quản lý session admin.
- `POST /shorten`: tạo link vĩnh viễn. Body: `{ "url": "https://example.com", "slug": "optional", "title": "optional" }`.
- `GET /api/links`: liệt kê toàn bộ link, có phân trang KV nội bộ.
- `GET /api/stats`: thống kê hệ thống.
- `GET /api/settings` và `PUT /api/settings`: đọc/cập nhật cấu hình website, chỉ admin.
- `DELETE /api/links/:slug`: xóa một link.
- `DELETE /api/links`: xóa toàn bộ link, chỉ dùng sau xác nhận admin.
- `GET /:slug`: redirect và ghi nhận click.

Giao diện người dùng ở `/`, giao diện quản trị ở `/links`.