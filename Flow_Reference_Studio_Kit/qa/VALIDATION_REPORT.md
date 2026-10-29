# Validation report — 27/10/2026

## Đã thực hiện

- `node --test reference/mask_core.test.mjs`: **14/14 test pass**; bao gồm 300 trường hợp ngẫu nhiên có seed, mask/protect, feather, alpha và outside diff. Node v24.22.1.
- `node --experimental-strip-types --input-type=module -e "import('./contracts/domain.ts')"`: import/strip cú pháp thành công. Đây không phải TypeScript typecheck; môi trường không có tsc.
- JSON templates/manifest parse được; UAT CSV được tạo từ bảng QA và mọi dòng giữ NOT_RUN.
- Link Markdown tương đối, fence, cấu trúc gói và checksum được kiểm tra trong bước đóng gói.

## Chưa thực hiện

- Chưa xây/cài extension hoàn chỉnh; chưa chạy Chrome/Flow E2E.
- Chưa kiểm chứng selectors, synthetic upload, native mask import, model list hoặc tài khoản người dùng.
- Chưa chạy PNG codec round-trip, EXIF/ICC integration hoặc benchmark chất lượng AI.
- Chưa có kết quả UAT sản phẩm; không dùng 14 core tests làm bằng chứng mọi tính năng đã hoàn thành.

Mã core nhận candidate đã căn chỉnh và RGBA bytes; chỉ chứng minh tính chất của phép ghép và phép so sánh trong phạm vi đó. Release Strict phải thêm các integration tests trong docs/05 và docs/07.
