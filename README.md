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