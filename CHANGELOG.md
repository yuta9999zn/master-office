# Changelog

Mọi thay đổi đáng kể của Master Office được ghi ở đây. Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/); phiên bản theo [SemVer](https://semver.org/lang/vi/).

## [0.1.0] — 2026-10-09

Bản phát hành mã nguồn mở đầu tiên.

### Ứng dụng
- **Docs** — soạn thảo cộng tác (TipTap + Yjs), Word parity: mục lục, chú thích, phương trình, cột, tab tài liệu, so sánh, kiểm tra chính tả; DOCX / PDF / Markdown.
- **Sheets** — Univer, công thức giống Excel, macro JavaScript + trigger, pivot, biểu đồ, bảo vệ vùng, filter view, XLSX / CSV, workbook lớn (bảng style chung, nhập trong worker).
- **Slides** — layout, theme, hiệu ứng, video, trình chiếu + presenter, hỏi đáp khán giả, PPTX / PDF / PNG; AI Image Studio.
- **Forms** — biểu mẫu, quiz, chấm điểm, liên kết Sheets, QR, trang trả lời công khai.
- **Drive & Spaces** — mô hình tài nguyên thống nhất, phân quyền một chỗ, phiên bản, xuất bản web, hạn mức dung lượng.
- **Chat** — kênh theo Space kiểu Discord, DM / nhóm, file, pin, phản ứng, thread; **Mail** — hộp thư tổ chức và hộp thư chung, SMTP vào / ra.
- **Calendar & Meetings** — lịch cá nhân / nhóm, mời .ics, họp video WebRTC, ghi hình, ghi chú.
- **Tasks** — Scrum / Kanban / Gantt, sprint và nghi lễ, bug, pha và cổng, tài liệu dự án theo mẫu BA, AI-DLC.
- **Approvals** (kiểu Lark), **Base** (kiểu Airtable), **Flow** (BPMN / UML / ER + tự động hoá), **Wiki** (kiểu Confluence), **Notes & Mind Map**.
- **AI** — một trợ lý trên thanh trên, Ollama local, kho prompt, sinh workflow / workbook / deck / banner / card.
- **Tổ chức** — đăng nhập, thiết lập lần đầu, mời, phòng ban / vị trí, quyền riêng tư liên hệ, quản trị.

### Đóng gói
- Docker một lệnh: `infra/docker-compose.prod.yml` (Caddy, web, api, Postgres, Redis, SeaweedFS, Ollama tuỳ chọn), `GET /health`, migration tự chạy khi khởi động.
- Tài liệu: `docs/INSTALL.md`, `docs/ARCHITECTURE.md` (§1–§84), `CONTRIBUTING.md`; giấy phép MIT; CI GitHub Actions.
