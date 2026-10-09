# Cài đặt Master Office

Hai cách: **Docker** (một lệnh, cho máy chủ hoặc máy trong văn phòng) và **chạy từ mã nguồn** (phát triển).

## 1. Docker — một lệnh

Cần: Docker 24+ với Docker Compose, máy 4 CPU / 8 GB RAM (16 GB nếu bật AI local), 20 GB đĩa.

```bash
git clone https://github.com/<bạn>/master-office.git && cd master-office
cp .env.production.example .env.production
# Mở .env.production: đặt PUBLIC_URL / PUBLIC_WS_URL / PUBLIC_HOST và các mật khẩu (openssl rand -base64 32)
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d --build
```

Lần đầu mất 10–20 phút (tải ảnh, cài Chromium cho xuất PDF, build web). Khi `docker compose … ps` báo `api` là `healthy`, mở `PUBLIC_URL` → trang **Thiết lập lần đầu**: tạo tài khoản quản trị, tên tổ chức, e-mail hệ thống (tuỳ chọn). Mời người khác ở **Admin → Members → Invite**: không có SMTP thì liên kết mời hiện ngay trên màn hình.

Các dịch vụ: `proxy` (Caddy, cổng 80/443), `web` (Next.js), `api` (NestJS: REST, realtime, cộng tác, SMTP vào), `postgres`, `redis`, `s3` (SeaweedFS). Dữ liệu nằm trong volume `pgdata`, `s3data`, `api-cache`, `caddy-data`.

### Địa chỉ và HTTPS

| Tình huống | `.env.production` |
|---|---|
| Máy trong mạng nội bộ, không tên miền | `PUBLIC_HOST=:80`, `PUBLIC_URL=http://192.168.1.10`, `PUBLIC_WS_URL=ws://192.168.1.10` |
| Có tên miền trỏ về máy, mở cổng 80/443 | `PUBLIC_HOST=office.example.com`, `PUBLIC_URL=https://office.example.com`, `PUBLIC_WS_URL=wss://office.example.com` — Caddy tự xin chứng chỉ Let's Encrypt |
| Sau một proxy khác (nginx, Traefik) | giữ `PUBLIC_HOST=:80`, đổi `HTTP_PORT` (vd 8080), proxy ngoài chuyển mọi đường dẫn kể cả websocket về cổng đó |

Trình duyệt chỉ nói chuyện với một địa chỉ: `/` là web, `/api/*` là API (REST, tải lên, websocket realtime), `/collab` là cộng tác thời gian thực, `/pub/*` là trang đã xuất bản.

### Tuỳ chọn

- **Mail đi** (mời, thông báo): `SMTP_URL=smtp://user:pass@host:587`, `MAIL_FROM`. Để trống → mail chỉ được ghi vào hộp thư đi trong ứng dụng.
- **Mail đến** (§70): `MAIL_INBOUND_PORT=2525` + `MAIL_INBOUND_SECRET`; trỏ MX hoặc webhook của nhà cung cấp về cổng đó.
- **Gọi video qua internet** (§73): `MEETING_ICE_SERVERS` với một máy chủ TURN; trong cùng mạng LAN không cần.
- **AI local** (§80–81): `docker compose … --profile ai up -d`, rồi `docker compose … exec ollama ollama pull qwen2.5:3b` (và `qwen2.5vl:7b` cho đọc chữ trong ảnh). Chỉnh ở **AI → Model & settings**. Có GPU thì mới nhanh; CPU chạy được model 3B ở ~10 token/giây.
- **S3 ngoài** (AWS, MinIO, Wasabi): đổi `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` trong compose và bỏ dịch vụ `s3`.

### Vận hành

```bash
docker compose -f infra/docker-compose.prod.yml --env-file .env.production logs -f api     # nhật ký
docker compose -f infra/docker-compose.prod.yml --env-file .env.production pull && … up -d --build   # cập nhật
docker compose … exec postgres pg_dump -U workos workos > backup.sql                        # sao lưu CSDL
docker run --rm -v master-office_s3data:/data -v "$PWD":/out alpine tar czf /out/s3.tgz /data   # sao lưu file
```

Migration CSDL chạy tự động mỗi khi `api` khởi động. Kiểm tra sức khoẻ: `GET /api/health`.

**Giữ kỹ `SETTINGS_KEY`**: nó mã hoá mật khẩu SMTP và khoá API AI đã nhập; đổi khoá là mất các giá trị đó (nhập lại ở Admin).

## 2. Chạy từ mã nguồn (phát triển)

Cần Node 22+, pnpm 9, Docker (cho Postgres / Redis / S3).

```bash
pnpm install
pnpm infra:up        # Postgres :5440, Redis :6390, S3 :9000 (thêm --profile mail cho Mailpit)
pnpm db:migrate
pnpm db:seed         # dữ liệu mẫu: tổ chức HANAMI, 10 người dùng, Sakura Beauty Spa…
pnpm dev             # API :4000 (+ cộng tác :4001) và web :3000
```

Mở http://localhost:3000. Ở chế độ dev (`AUTH_DEV=1`, mặc định khi không phải production) có thể đổi người dùng ở menu avatar → *Switch user (dev)* để thử phân quyền. Xuất PDF cần Chromium: `pnpm --filter @workos/api exec playwright install chromium`.

Kiểm thử: `pnpm typecheck`, `pnpm test` (seed lại + test API từng module + e2e Playwright; cần `pnpm dev` đang chạy; lần đầu `pnpm --filter @workos/web exec playwright install chromium`).

## 3. Cấu hình

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DATABASE_URL` | `postgres://workos:workos@localhost:5440/workos` | Postgres |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION` | SeaweedFS dev | Kho file |
| `API_PORT`, `COLLAB_PORT` | 4000, 4001 | Cổng API và cộng tác |
| `COLLAB_PUBLIC_URL` | `ws://localhost:4001` | Địa chỉ websocket cộng tác mà trình duyệt mở |
| `WEB_ORIGIN` | `http://localhost:3000` | CORS |
| `COLLAB_SECRET` | dev | Ký token cộng tác |
| `SETTINGS_KEY` | file `apps/api/.secrets/settings.key` | Mã hoá cài đặt nhạy cảm |
| `AUTH_DEV` | `1` ngoài production | Bộ đổi người dùng dev, header `x-user-id` |
| `SMTP_URL`, `MAIL_FROM`, `MAIL_INBOUND_PORT`, `MAIL_INBOUND_SECRET` | trống / 2525 | Mail |
| `MEETING_ICE_SERVERS` | `[]` | STUN/TURN cho họp video |
| `OLLAMA_URL`, `OLLAMA_MODEL` | `http://127.0.0.1:11434` | AI local |
| `OCR_CACHE_DIR` | `.cache/tessdata` | Dữ liệu ngôn ngữ Tesseract (tải một lần) |
| `NEXT_PUBLIC_API_URL` (web, lúc build) | `http://localhost:4000` | Địa chỉ API cho tải lên và websocket; `/api` khi sau proxy |
| `API_URL` (web) | `http://localhost:4000` | Đích của proxy `/api` trong Next.js |

## 4. Giới hạn đã biết

- Một máy chủ, một tiến trình API: cộng tác thời gian thực giữ tài liệu đang mở trong bộ nhớ; ~20–50 người dùng đồng thời là mức đã nhắm tới. Nhiều tiến trình cần Redis cho Hocuspocus (chưa cấu hình).
- Workbook rất lớn (500k ô) mở được nhưng cần ~1 GB RAM trình duyệt (xem §83).
- Nhập `.xls` / `.ods` cần LibreOffice (chưa có trong ảnh Docker).
