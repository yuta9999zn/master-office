# Master Office

*Work together, go further.* Nền tảng làm việc thống nhất cho doanh nghiệp: Chat, Docs, Sheets, Slides, Drive, Spaces, Calendar, Meetings, Tasks, Wiki, Base, Approvals… trong **một** workspace, **một** mô hình phân quyền và **một** hệ thống file.

- Kiến trúc: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Ảnh giao diện tham chiếu: các file `*.png` ở thư mục gốc

## Trạng thái

**Phase 1–4 đã xong**: App Shell, Unified Resource Model, phân quyền, Spaces, Drive, **Docs** (Word parity, DOCX/PDF), **Notes & Mind Map**, **Sheets** (Univer, công thức như Excel, XLSX/CSV), **Slides** (soạn thảo cộng tác, theme, bảng, biểu đồ liên kết Sheets, trình chiếu + presenter view, PPTX/PDF/PNG) — tất cả realtime nhiều người. Bảng đối chiếu với Office: [`docs/OFFICE-PARITY.md`](docs/OFFICE-PARITY.md). Lộ trình các phase tiếp theo nằm ở §16 của tài liệu kiến trúc.

## Chạy môi trường dev

Yêu cầu: Node 22+, pnpm 9, Docker.

```bash
pnpm install
pnpm infra:up        # Postgres :5440, Redis :6390, S3 (SeaweedFS) :9000
pnpm db:migrate
pnpm db:seed         # tổ chức KAORI: Natural Beauty (+7 space con), ITM Japan, KAORI Brand, 10 người dùng
pnpm dev             # API :4000 (+ realtime :4001) + Web :3000
```

Mở http://localhost:3000. Người dùng mặc định là **Claudia Chen** (chủ workspace). Có thể đổi người dùng ở menu avatar → *Switch user (dev)* để thử phân quyền, ví dụ Hana Lee không thấy space HR (private).

## Kiểm thử

```bash
pnpm typecheck
pnpm test            # seed lại + API (smoke, docs, docs-word, notes, sheets, slides) + e2e (drive, docs, docs-word, notes, sheets + 132 công thức Excel, slides) — cần `pnpm dev` đang chạy
```

Lần đầu chạy e2e cần cài trình duyệt: `pnpm --filter @workos/web exec playwright install chromium`.

## Cấu trúc

```
apps/api        NestJS + Drizzle (Postgres) + S3 — resources, permissions, spaces, search, activity
apps/web        Next.js 16 + Tailwind 4 + Radix — shell, Home, Drive, Spaces, editors
packages/shared Kiểu dữ liệu dùng chung FE/BE (Resource, Role, …)
infra/          docker-compose cho dev
docs/           Kiến trúc
```

## Lưu ý môi trường

- Ổ `E:` dùng exFAT (không hỗ trợ symlink), nên pnpm chạy với `node-linker=hoisted` (xem `.npmrc`) và `@workos/shared` được import qua path alias của TypeScript.
- Cổng 5433/6380/5434 đang được các project khác dùng, vì vậy Master Office dùng 5440/6390.
