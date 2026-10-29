# Flow Reference Studio — Bộ triển khai extension

**Phiên bản:** 1.0 • **Ngày:** 27/10/2026 • **Ngôn ngữ:** Tiếng Việt

Tài liệu thiết kế và bàn giao triển khai cho một extension Chrome tạo/chỉnh ảnh thông qua Google Flow. Trọng tâm là nhiều ảnh tham chiếu có phân vai, prompt có cấu trúc, chọn model theo tài khoản và chỉnh vùng với kiểm tra bảo toàn pixel bên ngoài.

**Trạng thái bàn giao:** Đây là bộ plan, specs, runbook, hợp đồng dữ liệu, ví dụ và mã tham chiếu cho thuật toán ghép vùng. Chưa phải extension cài đặt hoàn chỉnh. DOM của Flow, thao tác upload/lasso và khả năng lấy ảnh đầu ra cần được thử trực tiếp trên tài khoản thử nghiệm ở giai đoạn G0. Không có tài khoản Flow nào được truy cập trong quá trình viết bộ này.

## Đọc theo vai trò

| Người đọc | Tài liệu |
|---|---|
| Chủ sản phẩm / quản lý | [01_PLAN_VI.md](docs/01_PLAN_VI.md), [02_PRODUCT_UX_SPEC_VI.md](docs/02_PRODUCT_UX_SPEC_VI.md) |
| Dev extension | [03_TECHNICAL_SPEC_VI.md](docs/03_TECHNICAL_SPEC_VI.md), thư mục `contracts/` |
| Dev prompt / hình ảnh | [04_PROMPT_REFERENCE_SPEC_VI.md](docs/04_PROMPT_REFERENCE_SPEC_VI.md), [05_MASK_EDIT_SPEC_VI.md](docs/05_MASK_EDIT_SPEC_VI.md) |
| QA / vận hành | [06_RUNBOOK_VI.md](docs/06_RUNBOOK_VI.md), [07_QA_ACCEPTANCE_VI.md](docs/07_QA_ACCEPTANCE_VI.md), `qa/` |
| Agent hoặc dev bắt đầu triển khai | [08_IMPLEMENTATION_HANDOFF_VI.md](docs/08_IMPLEMENTATION_HANDOFF_VI.md) |
| Kiểm tra căn cứ / giả định | [09_SOURCES_ASSUMPTIONS_VI.md](docs/09_SOURCES_ASSUMPTIONS_VI.md) |

## Sáu quyết định sản phẩm

1. Chrome Manifest V3; side panel để điều khiển Flow, trang Workbench riêng để vẽ mask và xem ảnh lớn.
2. Flow Web là provider chính, dùng phiên đăng nhập của người dùng trong tab Flow. Extension không cần lấy mật khẩu, cookie hay token.
3. Có chế độ Assisted dùng được trước; tự động hóa DOM chỉ bật cho thao tác đã qua kiểm thử tương thích.
4. Model, tỷ lệ, độ phân giải và giới hạn refs lấy từ khả năng thực tế; không biến tên model hoặc giới hạn lịch sử thành hằng số sản phẩm.
5. Prompt Compiler ghép mục tiêu, vai trò refs, style và ràng buộc. Mức ưu tiên ref là quy tắc biên soạn prompt, không giả làm trọng số của model.
6. Chế độ Strict Region Edit ghép lại phần ngoài mask từ ảnh gốc đã chuẩn hóa và kiểm tra PNG xuất; không dùng lời nhắc làm bằng chứng giữ nguyên ảnh.

## Kiểm tra mã tham chiếu

Yêu cầu Node.js có trình chạy `node:test`:

```bash
node --test reference/mask_core.test.mjs
```

Mã này chỉ kiểm tra phép ghép RGBA, feather hướng vào trong và so sánh ngoài mask. Nó không gọi Flow, không có codec PNG, không chứng minh tích hợp trình duyệt đã hoạt động. Việc kiểm thử encode/decode PNG và color profile được yêu cầu riêng trong QA trước khi phát hành nhãn Strict.

## Cách dùng bộ này

Đọc plan → chốt các cổng nghiệm thu → triển khai mock adapter → hoàn tất pipeline ảnh cục bộ → kiểm chứng Flow thật → mở rộng automation. Mọi nhánh fallback, bước người dùng phải làm và giới hạn tài khoản phải hiện đúng trong UI. Các con số hiệu năng và lịch triển khai là mục tiêu đề xuất, chưa phải số đo của sản phẩm.
