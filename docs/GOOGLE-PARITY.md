# Đối chiếu với Google Workspace (Docs · Sheets · Slides · Forms)

Khảo sát ngày 2026-10-03 trên 4 file mẫu của người dùng (menu + menu con của Google Docs, Sheets, Slides và trình soạn Google Forms). Bổ sung cho [`OFFICE-PARITY.md`](OFFICE-PARITY.md) (đối chiếu với Microsoft Office).

Ký hiệu: ✅ Master Office đã có · ◐ có một phần · ❌ chưa có · ⭐ người dùng yêu cầu ưu tiên.

---

## 0. Yêu cầu ưu tiên của người dùng

| # | Yêu cầu | Ghi chú thiết kế |
|---|---|---|
| ⭐ 1 ✅ | **Macro** ("rất quan trọng") — **xong 2026-10-03** (ARCHITECTURE §24) | Ghi macro (record) → script JavaScript; chạy lại bằng menu / phím tắt; trình soạn script; API `SpreadsheetApp`-like trên dữ liệu của workbook; chạy trong sandbox (Web Worker) với quyền của người dùng. File `.xlsm`: giữ nguyên dự án VBA, hiển thị mã nguồn VBA, không thực thi VBA (bảo mật + không có runtime); chuyển VBA → JS có trợ giúp của AI ở Phase 6. Trigger (onEdit, theo lịch) ở bước sau. |
| ⭐ 2 ✅ | **Tab sheet ở phía trên** (giống Lark), không ở dưới như Google/Excel — **xong 2026-10-03** | Thanh tab riêng phía trên lưới: chuyển sheet, thêm, đổi tên, màu, ẩn/hiện, xoá, nhân bản, kéo sắp xếp. Ẩn footer tab mặc định của Univer. |

---

## 1. Google Docs → Master Docs

| Menu Google | Tính năng | MO |
|---|---|---|
| File | New, Open, Make a copy, Share, Download, Rename, Move, Trash, Version history, Page setup, Print, Print preview | ✅ |
| | Email (gửi file / email cộng tác viên), Approvals, Make available offline (◐ cache IndexedDB), Details, Language | ❌ (Approvals → Phase 7) |
| Edit | Undo/redo, cut/copy/paste, select all, find & replace | ✅ |
| | Paste without formatting, **Copy as Markdown / Paste from Markdown** | ❌ |
| View | Mode Editing / Suggesting | ✅ |
| | Mode **Viewing**, comments show/hide, **Document tabs & outline sidebar**, text width, **pageless format**, ruler, non-printing characters, equation toolbar, full screen | ◐ outline · ❌ còn lại |
| Insert | Image (upload/URL/Drive), table, link, horizontal line, page break, TOC, header/footer, page numbers, comment | ✅ |
| | Image từ camera/Drive picker, **cover image**, **building blocks** (meeting notes, email draft, decision log…), **smart chips** (date, people ✅ @mention, file ✅, calendar event, place, **dropdown**, placeholder), eSignature, **drawing**, **chart (bar/column/line/pie, từ Sheets — liên kết)**, **emoji / special characters / equation**, **document tabs**, **column break & section breaks**, **bookmark**, **watermark**, **footnote** | ❌ |
| Format | Bold/italic/underline/strike, super/subscript, size, capitalization, paragraph styles (Normal, Title, Subtitle, H1–H4), align, line spacing, bullets & numbering, clear formatting | ✅ |
| | Small caps, H5–H6, **paragraph styles options (update style to match, save as default)**, **borders & shading**, indentation options (first line, hanging), **columns**, page orientation per section, RTL text, keep with next / prevent single lines | ❌ |
| Tools | Word count, review suggested edits | ✅ |
| | **Spelling & grammar**, **compare documents**, citations, line numbers, explore, linked objects, dictionary, **translate document**, voice typing, notification settings, activity dashboard | ❌ |

## 2. Google Sheets → Master Sheets

| Menu Google | Tính năng | MO |
|---|---|---|
| Format | Number formats (đầy đủ), bold/italic/…, alignment, wrapping, font size, merge, conditional formatting, clear formatting | ✅ |
| | **Theme**, **convert to table / table formatting**, **alternating colors**, smart chip formats, RTL | ❌ |
| Insert | Rows/columns/cells, sheet, function, link | ✅ |
| | Chart (column, bar, line, area, pie, doughnut), pivot table, checkbox, image over cells, comment, note, table | ✅ |
| | **image in cell**, drawing, **dropdown** (◐ qua data validation), emoji, smart chips | ❌ |
| Data | Sort sheet/range, filter, data validation, column stats, remove duplicates, trim whitespace, split text to columns, protected sheets & ranges, named ranges | ✅ |
| | **Filter views**, **group-by views**, **slicer**, **named functions**, randomize range, data extraction, data connectors | ❌ |
| Tools / Extensions | ✅ **Macros** (record, run, manage, shortcut) · ✅ **script editor** (JS, API kiểu Apps Script) · ❌ trigger, import macro từ file khác · create a form linked to the sheet, calculation settings (manual / iterative), suggestion controls, notifications, activity dashboard | ❌ |
| View | Freeze, gridlines, zoom, formula bar, hidden sheets | ✅ |
| | Show/hide formulas, protected ranges, group/outline rows & columns, **⭐ sheet tabs on top** | ❌ |
| Cộng tác | Realtime, versions, export XLSX/CSV/PDF, con trỏ người khác trên lưới | ✅ |

## 3. Google Slides → Master Slides

| Menu Google | Tính năng | MO |
|---|---|---|
| Insert | Image, text box, shapes (16), table, chart (◐ native; from Sheets ✅ liên kết), new slide, comment, line, arrow | ✅ |
| | Video, audio, **diagram** (grid, hierarchy, timeline, process, relationship, cycle), **word art**, shape sets (arrows, callouts, equation), **elbow / curved connectors** (bám vào shape), curve, polyline, scribble, special characters, **animation**, link tới slide khác, **slide numbers**, **templates / building blocks**, placeholder | ❌ |
| Slide | New, duplicate, delete, skip (hide), move, change background, apply layout (6/11), transition, change theme | ✅ |
| | Thêm layout (main point, big number, caption, one column…), **edit theme (theme builder: master + layouts)**, import slides từ bản trình chiếu khác | ❌ |
| Arrange | Order, align, distribute, center on page | ✅ |
| | **Group / ungroup**, rotate 90° / flip menu | ◐ flip · ❌ group |
| Format | Text, align, bullets, table, borders & lines | ✅ |
| | **Format options** (drop shadow ◐, reflection, text fitting/autofit, indent), line & paragraph spacing chi tiết, **image: crop, mask, adjustments (transparency, brightness, contrast, recolor)** | ❌ |
| View / Tools | Slideshow, presenter view, speaker notes, grid view, zoom | ✅ |
| | **Motion panel (animations)**, Q&A khán giả, dictate notes, spelling, linked objects, publish to web / embed | ❌ |

## 4. Google Forms → Master Forms — ✅ xong 2026-10-03 (ARCHITECTURE §25); còn thiếu: QR, nhập câu hỏi từ form khác, email thông báo, chấm tay

| Khu vực | Tính năng cần có |
|---|---|
| Trình soạn | Tiêu đề, mô tả, ảnh header, theme (màu, font); **section**; khối tiêu đề-mô tả, ảnh, video; thêm / nhân bản / xoá / kéo sắp xếp câu hỏi; nhập câu hỏi từ form khác; soạn chung realtime (Yjs) như các editor khác |
| Kiểu câu hỏi | Short answer, paragraph, multiple choice, checkboxes, dropdown, **file upload** (vào Drive), linear scale, rating, multiple-choice grid, checkbox grid, date, time |
| Tuỳ chọn câu hỏi | Bắt buộc, mô tả, **xác thực** (số, độ dài, regex, email, số lựa chọn tối thiểu/tối đa), lựa chọn "Khác", xáo trộn lựa chọn, **rẽ nhánh: đi tới section theo câu trả lời** |
| Quiz | Chế độ bài kiểm tra: điểm, đáp án, phản hồi đúng/sai, công bố điểm |
| Cài đặt | Thu thập email (xác thực trong workspace), giới hạn 1 lần trả lời, sửa sau khi gửi, xem tóm tắt kết quả, thanh tiến độ, xáo trộn thứ tự câu hỏi, thông điệp xác nhận, bật/tắt nhận câu trả lời (+ hạn đóng), chỉ người trong tổ chức hay công khai |
| Câu trả lời | Tóm tắt có biểu đồ theo câu hỏi, xem từng câu trả lời, **liên kết sang Master Sheets** (tạo / đồng bộ sheet câu trả lời), tải CSV, xoá, thông báo khi có câu trả lời mới |
| Phát hành | Link trả lời (trang công khai không cần đăng nhập nếu cho phép), link điền sẵn, mã nhúng, QR |
| Liên kết | Sheets → "Tạo form" (Tools); form nằm trong Drive/Spaces, phân quyền như mọi tài nguyên |

## 5. Tính năng chung còn thiếu (mọi editor)

Spelling & grammar · translate · explore / AI (Phase 6) · chế độ **Viewing** · publish to web / embed · email cho cộng tác viên · activity dashboard (ai đã xem) · cài đặt thông báo · thư viện templates · offline đầy đủ.

---

## 6. Lộ trình bổ sung (đề xuất)

| Thứ tự | Phase | Nội dung |
|---|---|---|
| 1 ✅ | **3.2a** | ⭐ Tab sheet phía trên (kiểu Lark) |
| 2 ✅ | **3.2b** | ⭐ **Macro**: recorder, trình soạn script, chạy (menu + phím tắt), quản lý, sandbox Worker, API workbook; giữ & hiển thị VBA của .xlsm |
| 3 ✅ | **8** | **Forms** (module mới, đầy đủ mục 4) + liên kết Sheets |
| 4 | **3.1** | Sheets: chart, pivot, comment & note theo ô, protect ranges, named ranges, filter views, remove duplicates / trim, split text, table & alternating colors, checkbox, ảnh trong ô, text rotation, con trỏ người khác |
| 5 | **4.1** | Slides: group, animation + motion panel, video/audio, crop & điều chỉnh ảnh, connectors, diagram, word art, slide numbers, templates, theme builder, layout bổ sung |
| 6 | **2.2** | Docs: document tabs, smart chips (date, dropdown, place, event), building blocks, footnote, columns & section, equation, drawing, chart từ Sheets, bookmark, watermark, borders & shading, compare, Markdown copy/paste, pageless, chế độ Viewing |
| 7 | **chung** | Spelling, translate, publish/embed, activity dashboard, templates gallery |
