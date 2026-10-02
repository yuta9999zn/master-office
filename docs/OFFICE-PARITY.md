# Đối chiếu tính năng với Microsoft Office

Mục tiêu: người dùng Word / Excel / PowerPoint chuyển sang Master Office mà **không phải học lại** — cùng nhóm lệnh, cùng phím tắt, cùng công thức, và file mở qua lại hai chiều.

Ký hiệu: ✅ đã có · 🟡 có một phần · 🔜 theo lộ trình (phase) · ⛔ không hỗ trợ (ghi rõ lý do)

---

## 1. Word → Docs (Phase 2 + 2.1)

| Nhóm (ribbon Word) | Tính năng | Trạng thái |
|---|---|---|
| **Home — Font** | Font, cỡ chữ, đậm / nghiêng / gạch chân / gạch ngang, màu chữ, tô nền (highlight), xóa định dạng | ✅ |
| | Chỉ số trên / dưới (Ctrl+. / Ctrl+,), đổi hoa-thường (UPPERCASE / lowercase / Title Case) | ✅ 2.1 |
| | Hiệu ứng chữ (shadow, outline) | 🔜 2.2 |
| **Home — Paragraph** | Căn trái / giữa / phải / đều, bullet, numbering, checklist, tăng / giảm lề danh sách | ✅ |
| | Giãn dòng (1 – 3), khoảng cách trước / sau đoạn | ✅ 2.1 |
| | Thụt dòng đầu, đánh số nhiều cấp tuỳ biến, viền & nền đoạn | 🔜 2.2 |
| **Home — Styles** | Normal, Title, Subtitle, Heading 1–4 | ✅ 2.1 |
| | Style tuỳ biến của tổ chức, bộ style theo template | 🔜 2.2 |
| **Home — Editing** | Tìm (Ctrl+F) và thay thế (Ctrl+H): khớp hoa-thường, khớp nguyên từ, thay từng kết quả / thay tất cả, tô sáng mọi kết quả | ✅ 2.1 |
| **Insert** | Bảng (thêm/xoá dòng-cột, gộp/tách ô, header row, kéo rộng cột), ảnh (upload, dán, kéo-thả), link, đường kẻ, code block, trích dẫn, callout, @mention, **thẻ file từ Drive (không copy)** | ✅ |
| | Ngắt trang (Ctrl+Enter), mục lục tự động (sống trong editor, là trường TOC thật khi mở bằng Word), header/footer, số trang ({page} / {pages}) | ✅ 2.1 |
| | Footnote, ký hiệu / phương trình, shape, chart | 🔜 2.2 |
| **Layout** | Khổ giấy (A4, Letter, Legal, A5), hướng dọc / ngang, lề (preset + tuỳ chỉnh) — áp dụng cho print layout, PDF và DOCX | ✅ 2.1 |
| | Chia cột, section với bố cục khác nhau | 🔜 2.2 |
| **References** | Mục lục | ✅ 2.1 |
| | Chú thích cuối trang, trích dẫn, caption | 🔜 2.2 |
| **Review** | Comment theo đoạn chọn, trả lời, resolve / reopen, @mention trong comment, đếm từ | ✅ |
| | **Chế độ gợi ý sửa (Track Changes)**: Editing / Suggesting; chèn và xoá thành đề xuất có tác giả + thời gian; Accept / Reject từng mục hoặc tất cả; xuất DOCX thành revision thật của Word (`w:ins` / `w:del`) | ✅ 2.1 |
| | Theo dõi thay đổi định dạng (không chỉ chữ), so sánh 2 phiên bản | 🔜 2.2 |
| **View** | Outline, panel comment / gợi ý / lịch sử, Print layout (khổ giấy, lề, header/footer), zoom 75–150% | ✅ 2.1 |
| | Focus mode, thước kẻ | 🔜 2.2 |
| **Cộng tác** | Nhiều người sửa đồng thời (CRDT), con trỏ & tên người khác, người đang online, tự lưu, làm việc offline rồi tự hợp nhất; thiết lập trang cũng đồng bộ realtime | ✅ |
| **Phiên bản** | Tự lưu phiên bản 15 phút/lần khi có sửa, đặt tên phiên bản, xem trước, khôi phục (giữ bản hiện tại) | ✅ |
| **File** | Tải về DOCX / PDF / HTML / TXT, nhập DOCX (kèm báo cáo giữ định dạng), giữ file gốc làm version 1, Print preview (PDF thật, phân trang thật), Print | ✅ |
| | Nhập .doc / .rtf / .odt (qua LibreOffice) | 🔜 2.2 |
| **Phím tắt** | Ctrl+B/I/U/Z/Y/K/F/H/Enter/./,, Ctrl+Alt+1..3, Ctrl+Alt+M, Tab/Shift+Tab trong danh sách, cú pháp Markdown (#, -, 1., [ ], >, ```) | ✅ |

**Giới hạn đã biết**
- Nhập DOCX (mammoth): font, cỡ, màu chữ và căn lề đoạn trở về mặc định; header/footer, track changes, bố cục trang không nhập. Báo cáo import hiển thị rõ từng mục. Phase 2.2 thay bằng bộ đọc OOXML riêng.
- Chế độ gợi ý sửa theo dõi **chữ** (chèn / xoá). Thao tác cấu trúc (gộp đoạn, đổi kiểu danh sách, thao tác bảng, định dạng) được áp dụng trực tiếp. Người chỉ có quyền comment chưa gợi ý sửa được (chỉ comment).
- Mục lục trong file DOCX hiển thị danh sách heading; số trang xuất hiện sau khi người đọc nhấn "Update field" (F9) trong Word — như mọi mục lục do máy tạo.

---|---|---|
| **Home — Font** | Font, cỡ chữ, đậm / nghiêng / gạch chân / gạch ngang, màu chữ, tô nền (highlight), xóa định dạng | ✅ |
| | Chỉ số trên / dưới, đổi hoa-thường, hiệu ứng chữ | 🔜 2.1 |
| **Home — Paragraph** | Căn trái / giữa / phải / đều, bullet, numbering, checklist, tăng / giảm lề danh sách | ✅ |
| | Giãn dòng, khoảng cách trước/sau đoạn, thụt dòng đầu, đánh số nhiều cấp tuỳ biến, viền & nền đoạn | 🔜 2.1 |
| **Home — Styles** | Normal, Heading 1–4 | ✅ |
| | Style tuỳ biến của tổ chức, Title/Subtitle, bộ style theo template | 🔜 2.1 |
| **Home — Editing** | Tìm / thay thế (Ctrl+F / Ctrl+H), chọn tất cả | 🟡 (chọn tất cả) · 🔜 2.1 |
| **Insert** | Bảng (thêm/xoá dòng-cột, gộp/tách ô, header row, kéo rộng cột), ảnh (upload, dán, kéo-thả), link, đường kẻ, code block, trích dẫn, callout, @mention, **thẻ file từ Drive (không copy)** | ✅ |
| | Ngắt trang, header/footer, số trang, mục lục tự động, footnote, ký hiệu / phương trình, shape, chart | 🔜 2.1–2.2 |
| **Layout** | Khổ giấy, lề, hướng giấy, cột | 🔜 2.2 (áp dụng cho export DOCX/PDF và chế độ xem trang in) |
| **References** | Mục lục, chú thích, trích dẫn, caption | 🔜 2.2 |
| **Review** | Comment theo đoạn chọn, trả lời, resolve / reopen, @mention trong comment | ✅ |
| | Track changes / Suggesting mode, so sánh 2 phiên bản, đếm từ | 🟡 (đếm từ) · 🔜 2.2 |
| **View** | Outline (điều hướng heading), panel comment / lịch sử | ✅ |
| | Chế độ xem trang in (Print layout), zoom, focus mode | 🔜 2.1 |
| **Cộng tác** | Nhiều người sửa đồng thời (CRDT), con trỏ & tên người khác, người đang online, tự lưu, làm việc offline rồi tự hợp nhất | ✅ |
| **Phiên bản** | Tự lưu phiên bản 15 phút/lần khi có sửa, đặt tên phiên bản, xem trước, khôi phục (giữ bản hiện tại) | ✅ |
| **File** | Tải về DOCX / PDF / HTML / TXT, nhập DOCX (kèm báo cáo giữ định dạng), giữ file gốc làm version 1 | ✅ |
| | Nhập .doc / .rtf / .odt (qua LibreOffice), in trực tiếp | 🔜 2.2 |
| **Phím tắt** | Ctrl+B/I/U/Z/Y/K, Ctrl+Alt+1..3, Tab/Shift+Tab trong danh sách, cú pháp Markdown (#, -, 1., [ ], >, ```) | ✅ |

**Giới hạn đã biết khi nhập DOCX (mammoth):** font, cỡ, màu chữ và căn lề đoạn trở về mặc định; header/footer, track changes, bố cục trang không nhập. Báo cáo import hiển thị rõ từng mục. Phase 2.2 thay bằng bộ đọc OOXML riêng để giữ font / màu / căn lề.

---

## 2. Excel → Sheets (Phase 3)

### 2.1 Công thức — nguyên tắc "giống Excel"
- **Cú pháp**: `=`, tham chiếu `A1`, `$A$1`, `A1:B10`, `A:A`, `1:1`, `Sheet2!A1`, `'Tên có dấu cách'!A1`, named range, structured reference của Table (`Table1[Cột]`).
- **Ngữ nghĩa**: thứ tự toán tử, ép kiểu, so sánh chuỗi không phân biệt hoa-thường, ngày là số seri (1900 date system, kể cả lỗi năm nhuận 1900 để trùng Excel), làm tròn IEEE giống Excel hiển thị 15 chữ số.
- **Lỗi**: `#DIV/0!` `#N/A` `#NAME?` `#NULL!` `#NUM!` `#REF!` `#VALUE!` `#SPILL!` `#CALC!` — cùng điều kiện phát sinh.
- **Mảng động**: spill (`=FILTER(...)`, `=SORT(...)`, `=UNIQUE(...)`, toán tử `#`, `@`).
- **Tính lại**: phụ thuộc theo đồ thị, hàm volatile (`NOW`, `TODAY`, `RAND`, `OFFSET`, `INDIRECT`), tham chiếu vòng báo lỗi như Excel.
- **Kiểm chứng**: bộ test đọc file .xlsx thật (có giá trị cache do Excel tính), tính lại bằng engine của Master Office và so sánh từng ô. Không đạt thì không phát hành hàm đó.
- **Engine**: formula engine của Univer (mã nguồn mở, cú pháp Excel), chạy ở trình duyệt khi sửa và ở server khi export (để giá trị cache trong XLSX đúng).

### 2.2 Nhóm hàm (bắt buộc cho Phase 3)
| Nhóm | Hàm |
|---|---|
| Toán | SUM, SUMIF, SUMIFS, SUMPRODUCT, ROUND/ROUNDUP/ROUNDDOWN, INT, MOD, ABS, POWER, SQRT, CEILING, FLOOR, RAND, RANDBETWEEN, SUBTOTAL, AGGREGATE |
| Thống kê | AVERAGE, AVERAGEIF(S), COUNT, COUNTA, COUNTBLANK, COUNTIF(S), MIN/MAX, MINIFS/MAXIFS, MEDIAN, MODE, STDEV, VAR, LARGE, SMALL, RANK, PERCENTILE, QUARTILE |
| Logic | IF, IFS, AND, OR, NOT, XOR, IFERROR, IFNA, SWITCH, LET, LAMBDA |
| Tra cứu | VLOOKUP, HLOOKUP, XLOOKUP, LOOKUP, INDEX, MATCH, XMATCH, OFFSET, INDIRECT, CHOOSE, ROW(S), COLUMN(S), FILTER, SORT, SORTBY, UNIQUE, SEQUENCE, TRANSPOSE |
| Văn bản | TEXT, CONCAT, CONCATENATE, TEXTJOIN, LEFT, RIGHT, MID, LEN, FIND, SEARCH, SUBSTITUTE, REPLACE, TRIM, UPPER, LOWER, PROPER, VALUE, TEXTBEFORE, TEXTAFTER, TEXTSPLIT |
| Ngày giờ | DATE, TODAY, NOW, YEAR, MONTH, DAY, HOUR, MINUTE, WEEKDAY, WEEKNUM, EDATE, EOMONTH, DATEDIF, NETWORKDAYS, WORKDAY, DATEVALUE |
| Tài chính | PMT, FV, PV, NPV, IRR, RATE, NPER |
| Thông tin | ISBLANK, ISNUMBER, ISTEXT, ISERROR, ISNA, N, TYPE |

### 2.2b Trạng thái kiểm chứng (Phase 3)
Bộ `apps/web/e2e/formula-cases.mjs` — **132/132 công thức cho kết quả trùng Excel**, gồm: SUM/AVERAGE/MIN/MAX/COUNT(A/BLANK)/PRODUCT/SUMPRODUCT/MEDIAN/STDEV(.P)/VAR, ROUND(UP/DOWN)/INT/TRUNC/MOD (số âm)/ABS/POWER/SQRT/CEILING(.MATH)/FLOOR/EVEN/ODD/FACT/COMBIN/GCD/LCM/SIGN/PI, RANK/LARGE/SMALL/PERCENTILE/QUARTILE, SUMIF(S)/COUNTIF(S) (wildcard)/AVERAGEIF/MAXIFS/MINIFS, ép kiểu (`"1"+1`, `TRUE+1`, `50%`), CONCATENATE/&/LEN/LEFT/RIGHT/MID/UPPER/PROPER/TRIM/SUBSTITUTE/REPLACE/FIND/SEARCH/TEXT/VALUE/REPT/EXACT/TEXTJOIN/CHAR/CODE, so sánh chuỗi không phân biệt hoa-thường, IF/AND/OR/NOT/XOR/IFERROR/IFS/SWITCH/IFNA, lỗi `#DIV/0! #N/A #VALUE! #NUM! #NAME?`, IS*, VLOOKUP (chính xác/gần đúng)/INDEX/MATCH/XLOOKUP/CHOOSE/LOOKUP/OFFSET/INDIRECT/ROWS/COLUMNS, DATE/YEAR/MONTH/DAY/WEEKDAY/EOMONTH/EDATE/DATEDIF/DAYS/NETWORKDAYS/WORKDAY/TIME/HOUR/YEARFRAC, PMT/NPV/IRR/PV/FV/RATE, FILTER/UNIQUE/SORT/SEQUENCE/LET. Kết quả công thức tài chính/ngày tự nhận định dạng số (tiền tệ, %, ngày) giống Excel. Hàm mới thêm vào danh sách 2.2 phải có ca kiểm chứng trước khi coi là "giống Excel".

### 2.3 Tính năng bảng tính
Trạng thái Phase 3 (✅ có, ◐ một phần, ⏳ Phase 3.1): ✅ ribbon kiểu Excel (Start/Insert/Formulas/Data/View), font/màu/viền/căn lề/wrap/merge, định dạng số, insert/delete/ẩn/di chuyển dòng-cột, autofill, sort, filter, conditional formatting, data validation, find & replace, hyperlink, freeze, gridlines, nhiều sheet (thêm/xoá/đổi tên/màu tab/ẩn/sắp xếp), thanh công thức + gợi ý hàm, realtime nhiều người, phiên bản; ✅ import XLSX/CSV, export XLSX/CSV/PDF/HTML; ◐ CF/validation/filter chưa đi vào XLSX (giữ trong Master Office); ⏳ chart, pivot, sparkline, ảnh, comment theo ô, bảo vệ sheet, group/outline, text to columns.

| Nhóm (ribbon Excel) | Tính năng | Phase |
|---|---|---|
| Home | Font, màu, viền, căn lề, wrap, merge, định dạng số (General, Number, Currency, Accounting, Date, %, Fraction, Text, Custom `#,##0.00`), conditional formatting, format as table, insert/delete dòng-cột, autosum, fill (kéo điền chuỗi), sort & filter, find & replace | 3 |
| Insert | Chart (cột, dòng, tròn, vùng, kết hợp), pivot table, sparkline, ảnh, link, comment | 3–3.1 |
| Formulas | Thanh công thức, gợi ý hàm & tham số, named ranges, trace precedents/dependents, evaluate formula | 3 |
| Data | Sort nhiều cột, filter, data validation (dropdown), remove duplicates, text to columns, group/outline, freeze panes | 3 |
| Review / View | Comment, bảo vệ sheet/vùng, freeze panes, zoom, gridlines, nhiều sheet (thêm/đổi tên/màu tab/ẩn) | 3 |
| File | Nhập/xuất XLSX (giữ công thức, định dạng, merge, validation, conditional format, chart, sheet), CSV, PDF | 3 |
| ⛔ | VBA/macro, Power Query, kết nối dữ liệu ngoài, add-in — mở được file nhưng phần này không chạy; báo cáo import liệt kê rõ | — |

---

## 3. PowerPoint → Slides (Phase 4)

| Nhóm (ribbon PowerPoint) | Tính năng | Phase |
|---|---|---|
| Home | Slide mới theo layout, nhân bản, section, font/đoạn như Docs, arrange (thứ tự, căn, phân bố, nhóm) | 4 |
| Insert | Text box, shape, icon, ảnh, video, bảng, chart (dữ liệu liên kết Sheets), SmartArt cơ bản → diagram | 4 |
| Design | Theme, bảng màu, font theme, kích thước slide (16:9, 4:3, tuỳ ý), nền | 4 |
| Transitions / Animations | Chuyển slide cơ bản (fade, push, wipe); animation vào/ra/nhấn mạnh cơ bản | 4.1 |
| Slide Show | Trình chiếu toàn màn hình, presenter view (ghi chú + slide kế), laser pointer | 4 |
| Review / View | Comment trên đối tượng, speaker notes, slide sorter, outline view | 4 |
| File | Nhập/xuất PPTX, PDF, PNG từng slide | 4 |
| ⛔ | Animation phức tạp theo đường đi, trigger, macro, embedded OLE | — |

---

Trạng thái Phase 4 (✅ có, ◐ một phần, ⏳ 4.1): ✅ slide mới theo 6 layout, nhân bản, xoá, ẩn, kéo sắp xếp, font/cỡ/đậm/nghiêng/gạch/màu/highlight/danh sách/căn lề, arrange (thứ tự, căn, phân bố), text box, 16 shape + đường/mũi tên, ảnh (chèn/dán/kéo-thả/thay), bảng, biểu đồ 6 loại (dữ liệu liên kết Sheets), theme, bảng màu, font theme, kích thước slide + hướng, nền (màu/gradient/ảnh), transition fade/push/wipe, trình chiếu + presenter view + laser, comment trên đối tượng, speaker notes, slide sorter, nhập/xuất PPTX, PDF, PNG; ◐ section, outline view; ⏳ nhóm đối tượng, animation, crop ảnh, video, icon, SmartArt.

## 4. Tương thích file — mục tiêu kiểm thử

- **Round-trip**: file tạo trong Master Office → export → mở bằng Office (và LibreOffice trong CI) → import lại → so sánh cấu trúc. Docs đã có test round-trip DOCX (text, danh sách, bảng).
- **Bộ file mẫu thật**: báo cáo, hợp đồng, bảng lương, dashboard, pitch deck — lưu trong `test/corpus/`, chạy mỗi lần build.
