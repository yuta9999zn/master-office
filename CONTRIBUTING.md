# Đóng góp cho Master Office

Cảm ơn bạn. Vài điều giúp mọi việc trôi chảy:

## Trước khi bắt đầu

- Mỗi phần của hệ thống có một mục "quyết định" trong [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (§1–§83): đọc mục liên quan trước khi sửa, và **cập nhật nó** khi bạn thay đổi cách làm. Tài liệu là nguồn sự thật về *vì sao*; mã là *như thế nào*.
- Một thay đổi = một việc. Pull request nhỏ, mô tả rõ điều gì đổi và vì sao.

## Môi trường

```bash
pnpm install
pnpm infra:up && pnpm db:migrate && pnpm db:seed
pnpm dev
```

Trước khi gửi:

```bash
pnpm typecheck
pnpm --filter @workos/api test:<module>       # test API của phần bạn sửa (xem apps/api/package.json)
node apps/web/e2e/<flow>.mjs                   # e2e Playwright liên quan (WEB_URL=http://localhost:3000)
```

`pnpm test` chạy toàn bộ: seed lại cơ sở dữ liệu rồi mọi test API và e2e — mất khá lâu, và một vài bộ giả định dữ liệu seed còn nguyên (đã ghi trong tài liệu kiến trúc).

## Quy ước

- TypeScript nghiêm ngặt; không `any` ngoài những chỗ đã đánh dấu (binding Univer, dữ liệu plugin).
- Phía máy chủ không bao giờ trả về bí mật (mật khẩu SMTP, khoá API): lưu mã hoá bằng `auth/secrets`, chỉ trả cờ "đã có".
- Mọi thứ người dùng tạo đi qua **Unified Resource Model** và `PermissionsService`; ứng dụng mới không tự quản lý quyền.
- Mô hình dữ liệu dùng chung FE/BE nằm ở `packages/*`; dữ liệu cộng tác là Yjs với layout ghi ở đầu mỗi gói.
- Thay đổi CSDL: `pnpm --filter @workos/api db:generate` sinh migration vào `apps/api/drizzle`; không sửa migration đã có.
- Chuỗi giao diện tiếng Anh; tài liệu tiếng Việt (có thể thêm bản dịch).

## Báo lỗi

Ghi rõ: phiên bản (commit), cách cài (Docker / mã nguồn), các bước tái hiện, điều mong đợi và điều xảy ra, nhật ký của `api` nếu có (`docker compose … logs api`).
