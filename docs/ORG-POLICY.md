# Master Office — Chính sách tổ chức & quản trị

Tài liệu dành cho **khách hàng tự cài đặt** Master Office (bản open source, khuyến nghị tối đa khoảng 20 người / tổ chức). Đọc một lần trước khi mở hệ thống cho nhân viên.

---

## 1. Lần đầu truy cập (5 phút)

| Bước | Việc cần làm | Ghi chú |
|---|---|---|
| 1 | Mở địa chỉ hệ thống → màn hình **Cài đặt lần đầu** | Chỉ hiện khi hệ thống còn trống. |
| 2 | Nhập **tên tổ chức** (vd. "Công ty ABC") và miền email nếu có (vd. `abc.vn`) | Có thể đổi sau trong Admin. |
| 3 | Tạo **tài khoản Admin chủ sở hữu (Owner)**: họ tên, email, mật khẩu (≥ 10 ký tự) | Đây là tài khoản quyền cao nhất. Nên dùng email công việc của người phụ trách hệ thống. |
| 4 | Gắn **email hệ thống** (mục 4) | Bỏ qua được, nhưng chưa gắn thì **không gửi được lời mời / đặt lại mật khẩu qua email**. |
| 5 | Tạo **nhóm / phòng ban đầu tiên** và **mời người** | Bỏ qua được, làm sau ở Admin → Teams / Members. |

> Tài khoản Owner chỉ có một. Nên tạo thêm ít nhất **một Admin dự phòng** để không mất quyền quản trị khi Owner nghỉ việc.

---

## 2. Vai trò

### 2.1 Trong tổ chức

| Vai trò | Ai nên giữ | Được làm |
|---|---|---|
| **Owner** | Người cài đặt / giám đốc | Mọi quyền Admin, chuyển quyền Owner. Không thể bị khoá. |
| **Admin** | IT / hành chính (1–2 người) | Email hệ thống, mời / khoá người, đổi vai trò, tạo nhóm, đặt hạn mức dung lượng, xem mọi nhóm. |
| **Member** | Nhân viên | Dùng mọi ứng dụng, chat riêng và nhóm chat ≤ 10 người, thấy các nhóm công khai. |
| **Guest** | Cộng tác viên, khách hàng, đối tác | Chỉ thấy những gì được chia sẻ trực tiếp hoặc nhóm được thêm vào. |

### 2.2 Trong một nhóm / phòng ban

| Vai trò | Được làm |
|---|---|
| **Trưởng nhóm** | Thêm / bớt thành viên (đã có tài khoản), đặt **chức vụ trong nhóm**, tạo kênh chat của nhóm và thêm người vào kênh, quản lý file của nhóm, xem thông tin liên hệ đầy đủ của thành viên trong nhóm. |
| **Thành viên** | Đọc / viết trong nhóm, chat, tạo và sửa file của nhóm. |
| **Người xem** | Chỉ đọc (có thể được bình luận). |

**Một người có thể ở nhiều nhóm và giữ nhiều chức vụ**, vd. "Trưởng phòng Kinh doanh" ở phòng Kinh doanh và "Thành viên" ở dự án Website. Mỗi chức vụ gắn với nhóm tương ứng; khi chat, thẻ người hiện rõ người đó thuộc nhóm nào, chức vụ gì.

---

## 3. Cấu trúc nhóm (cây tổ chức)

Khuyến nghị đơn giản:

```
Công ty ABC
├── General (công khai — mọi người)
├── Phòng Kinh doanh (department)
│   ├── Đội bán hàng miền Bắc (team)
│   └── Đội bán hàng miền Nam (team)
├── Phòng Kỹ thuật (department)
│   └── Dự án Website (project)
└── Hành chính – Nhân sự (department, riêng tư)
```

* **Công khai**: mọi Member thấy và đọc được. **Riêng tư**: chỉ thành viên nhóm (và Admin).
* Phòng ban chứa dữ liệu nhạy cảm (Nhân sự, Kế toán) → để **riêng tư**.
* Mỗi nhóm có sẵn: kênh chat, thư mục file, lịch nhóm, (tuỳ chọn) hộp thư chung, dự án, wiki.

---

## 4. Gắn email hệ thống (app password)

Hệ thống dùng **một hộp thư** để gửi lời mời, đặt lại mật khẩu, thông báo. Bạn **không dùng mật khẩu đăng nhập thường** của email, mà tạo một **mật khẩu ứng dụng (app password)** riêng. Mật khẩu này được **mã hoá** khi lưu và **không bao giờ hiển thị lại**.

> ⚠️ Chỉ nhập app password vào trang **Admin → System email** của hệ thống. Không gửi qua chat, email hay cho bất kỳ ai (kể cả bộ phận hỗ trợ).

### 4.1 Gmail / Google Workspace (khuyến nghị)

1. Đăng nhập tài khoản Google sẽ dùng để gửi (nên tạo riêng, vd. `noreply.abc@gmail.com`).
2. Mở **https://myaccount.google.com/security**.
3. Ở mục *Cách bạn đăng nhập vào Google*, bật **Xác minh 2 bước** (2-Step Verification) nếu chưa bật.
4. Mở **https://myaccount.google.com/apppasswords** (hoặc tìm "App passwords" ở ô tìm kiếm của trang tài khoản).
5. Nhập tên ứng dụng, vd. `Master Office`, bấm **Tạo** (Create).
6. Google hiện **mật khẩu 16 ký tự** (dạng `abcd efgh ijkl mnop`) — sao chép ngay, sau khi đóng sẽ không xem lại được.
7. Trong Master Office: **Admin → System email** → chọn **Gmail** → nhập địa chỉ Gmail + dán mật khẩu 16 ký tự → **Save** → **Send test email**.

Thông số tự điền: `smtp.gmail.com`, cổng 465 (SSL). Giới hạn của Google: khoảng 500 người nhận / ngày (Gmail cá nhân), 2 000 / ngày (Google Workspace).

Nếu không thấy mục App passwords: chưa bật xác minh 2 bước; hoặc tài khoản Google Workspace bị quản trị viên tắt tính năng này; hoặc tài khoản chỉ dùng khoá bảo mật (Advanced Protection).

### 4.2 Outlook / Microsoft 365

Microsoft đang **ngừng hỗ trợ đăng nhập SMTP bằng mật khẩu** (basic authentication) cho Exchange Online / Outlook.com, nên app password của Microsoft **có thể không dùng được**. Nếu tổ chức vẫn cho phép:

1. Mở **https://account.microsoft.com/security** → **Tùy chọn bảo mật nâng cao** → bật **Xác minh hai bước**.
2. Ở mục **Mật khẩu ứng dụng**, chọn **Tạo mật khẩu ứng dụng mới**, sao chép mật khẩu.
3. Microsoft 365 (tài khoản công ty): quản trị viên phải bật **Authenticated SMTP** cho hộp thư đó (Microsoft 365 admin center → Users → chọn người → Mail → Manage email apps → Authenticated SMTP).
4. Trong Master Office: chọn **Outlook / Microsoft 365** (`smtp.office365.com`, cổng 587, STARTTLS) → nhập email + mật khẩu → **Send test email**.

Nếu gửi thử báo lỗi xác thực → dùng Gmail hoặc một dịch vụ SMTP (mục 4.3).

### 4.3 Máy chủ / dịch vụ SMTP khác

Chọn **Custom SMTP** và nhập host, cổng, chế độ bảo mật, tên đăng nhập, mật khẩu do nhà cung cấp cấp (vd. Zoho Mail: `smtp.zoho.com` 465 + app-specific password trong *Zoho Account → Security → App Passwords*; hoặc Brevo, Amazon SES, máy chủ mail nội bộ).

---

## 5. Mời người và nghỉ việc

| Việc | Cách làm |
|---|---|
| Mời | Admin → Members → **Invite**: email, vai trò (Member / Guest / Admin), nhóm ban đầu + chức vụ. Người nhận bấm link trong email (hạn 7 ngày), đặt tên + mật khẩu. |
| Thêm vào nhóm | Trưởng nhóm hoặc Admin: nhóm → Members → thêm người đã có tài khoản. |
| Quên mật khẩu | Màn hình đăng nhập → *Forgot password* (link hạn 1 giờ). Admin cũng có thể gửi link đặt lại. |
| Nghỉ việc | Admin → Members → **Suspend** (khoá đăng nhập ngay, đăng xuất mọi thiết bị, dữ liệu giữ nguyên) → chuyển file trong My Files cho người kế nhiệm → khi không cần nữa mới xoá. File trong nhóm thuộc về nhóm, không mất khi người nghỉ. |

---

## 6. Dung lượng lưu trữ

| Khái niệm | Quy định |
|---|---|
| Cách tính | Như Google Drive: kích thước file + các phiên bản cũ + tệp đính kèm email + ảnh trong tài liệu. Thùng rác **vẫn tính** cho tới khi xoá hẳn. |
| Ai chịu | File ở **My Files** tính cho **người sở hữu**; file trong **nhóm** tính cho **nhóm**. |
| Hạn mức mặc định (gợi ý) | Mỗi người **10 GB**, mỗi nhóm **50 GB**. Admin đổi được, và đặt riêng cho từng người / nhóm (chọn *Unlimited* để bỏ giới hạn). |
| Ở đâu | **Admin → Storage**: tổng quan, hạn mức mặc định, từng người, từng nhóm, các file lớn nhất. Mỗi người thấy thước đo của mình (và của nhóm đang mở) ở cuối thanh trái trong Drive. |
| Quỹ tổ chức | Bản open source: theo ổ đĩa máy chủ. Gợi ý: tổng hạn mức đã cấp ≤ 80 % dung lượng ổ lưu trữ, để chỗ cho phiên bản và sao lưu. Ví dụ 20 người × 10 GB + 5 nhóm × 50 GB = 450 GB → nên có ổ ≥ 600 GB. |
| Khi gần đầy | 80 %: thước đo chuyển vàng và nhắc dọn. 100 %: không tải thêm file được — tải lên, sao chép, chèn ảnh, đính kèm mail đều bị từ chối với thông báo "Storage full" (vẫn xem, sửa tài liệu và xoá được; thư đến vẫn nhận). |
| Giải phóng | Xoá hẳn thùng rác, xoá phiên bản cũ không cần, chuyển file lớn sang nhóm có hạn mức lớn hơn. |

Bản doanh nghiệp: hạn mức bắt buộc theo gói, báo cáo dung lượng định kỳ, cảnh báo cho Admin.

---

## 7. Danh bạ và quyền riêng tư

| Thông tin | Ai thấy |
|---|---|
| Tên, ảnh đại diện, chức danh chính, email công việc | Mọi Member trong tổ chức (Guest: chỉ người cùng nhóm). |
| Nhóm và chức vụ trong nhóm | Người xem thấy những nhóm mà chính họ cũng thấy. |
| Số điện thoại, địa điểm | Chính người đó, Admin, **trưởng của nhóm mà người đó thuộc về**; hoặc mọi người nếu người đó tự chọn "Hiện với mọi người" trong hồ sơ. |

Khi chat, thẻ người hiện **các nhóm + chức vụ** của người đó (ưu tiên nhóm của kênh đang chat và nhóm chung với bạn), để biết đang nói chuyện với ai, ở vai trò nào.

---

## 8. Bảo mật tối thiểu

* Mật khẩu ≥ 10 ký tự; không dùng lại mật khẩu email.
* Phiên đăng nhập hết hạn sau 30 ngày không dùng; đổi mật khẩu → đăng xuất các thiết bị khác.
* Admin không bao giờ hỏi mật khẩu của nhân viên; nhân viên tự đặt lại qua email.
* App password của email hệ thống chỉ nhập ở trang Admin, được mã hoá; khi nghi lộ → thu hồi app password ở Google / Microsoft và tạo cái mới.
* Sao lưu định kỳ cơ sở dữ liệu và kho file (S3); thử khôi phục ít nhất mỗi quý.
