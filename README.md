# MVL27URL

Cloudflare Workers URL shortener dùng KV namespace.

## Cấu hình

- Bind KV namespace với tên `url`.
- Đặt secret `API_KEY` dài tối thiểu 16 ký tự. Worker từ chối chạy API nếu secret thiếu hoặc quá yếu, không dùng secret mặc định.
- Custom domain mặc định là `url.mvl27.bond`; cập nhật `CUSTOM_DOMAIN` trong `worker.js` nếu triển khai domain khác.

## Tính năng

- Tạo slug ngẫu nhiên bằng Web Crypto, hoặc slug tùy chỉnh tối đa 20 ký tự.
- Chỉ nhận URL `http`/`https`, không nhận `javascript:`, scheme lạ hoặc URL chứa thông tin đăng nhập.
- Link có thể đặt thời hạn từ 1 đến 365 ngày; link quá hạn tự trả 404 và được dọn khỏi KV.
- Theo dõi lượt click, tiêu đề tùy chọn và danh sách link được sắp xếp theo thời gian tạo.
- Rate limit riêng cho tạo link và các thao tác admin, tối đa 50 request/giờ theo IP.

## API

Header quản trị: `x-api-key: <API_KEY>`.

- `POST /shorten`: tạo link. Body: `{ "url": "https://example.com", "slug": "optional", "title": "optional", "expiresInDays": 7 }`.
- `GET /api/links`: liệt kê toàn bộ link, có phân trang KV nội bộ.
- `GET /api/stats`: thống kê hệ thống.
- `DELETE /api/links/:slug`: xóa một link.
- `DELETE /api/links`: xóa toàn bộ link, chỉ dùng sau xác nhận admin.
- `GET /:slug`: redirect và ghi nhận click.

Giao diện người dùng ở `/`, giao diện quản trị ở `/links`.