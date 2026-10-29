# 09 — Nguồn, giả định và phần cần kiểm chứng

Ngày kiểm tra nguồn: **27/10/2026**. Các nhận định về khả năng nền tảng dựa vào nguồn chính thức dưới đây. Kiến trúc, giới hạn local, KPI, thuật toán, UX và lịch triển khai trong bộ docs là đề xuất thiết kế.

## 1. Khả năng Flow được tài liệu hóa

- Standard prompt box có chọn image model, tỷ lệ, số output và thêm reference images; Agent có thể tự định tuyến model [S01].
- Trang model lúc kiểm tra liệt kê Nano Banana Pro, Nano Banana 2 Lite và Nano Banana 2.1 cho ảnh [S02]. Đây là snapshot tài liệu, không phải danh sách bảo đảm có trong mọi tài khoản. Các trang mô tả default khác nhau, vì vậy extension đọc lựa chọn thực tế.
- Google công bố công cụ lasso/drawing để chỉnh vùng ảnh [S03]. Khả năng extension tự nhập mask chưa được chứng minh.
- Chi phí/giới hạn có thể thay đổi; dữ liệu được biết phải lấy từ UI hiện tại [S11]. Không gán chi phí video cho ảnh.

Không xác định được trong các nguồn đã kiểm tra một hợp đồng API công khai của **Flow Web** để extension submit image jobs bằng session người dùng. Bộ này không kết luận API như vậy tuyệt đối không tồn tại; G0 phải xác minh nếu xuất hiện tài liệu chính thức mới. Gemini API là một provider riêng [S10], không phải endpoint nội bộ Flow.

## 2. Danh mục nguồn

| Mã | Nguồn chính thức | Dùng cho |
|---|---|---|
| S01 | [Create & edit images in Google Flow](https://support.google.com/flow/answer/16729550?hl=en) | Model/options/references/standard vs Agent |
| S02 | [Flow models & supported features](https://support.google.com/flow/answer/16352836) | Snapshot tên image models |
| S03 | [New ways to create and refine content in Flow — 25/02/2026](https://blog.google/innovation-and-ai/models-and-research/google-labs/flow-updates-february-2026/) | Công bố lasso/drawing; không phải API mask |
| S04 | [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) | Side panel, permission và extension context |
| S05 | [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) | Worker có thể dừng; persist state |
| S06 | [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) | DOM, isolated world, messaging |
| S07 | [Message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) | JSON messages và transport design |
| S08 | [Remote hosted code in MV3](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code) | Bundle code, không remote executable |
| S09 | [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) | Content script fetch vs extension permissions |
| S10 | [Gemini API image generation](https://ai.google.dev/gemini-api/docs/image-generation) | Provider API riêng; image editing/semantic masking |
| S11 | [Manage Flow credits](https://support.google.com/flow/answer/16526234?hl=en) | Chi phí và giới hạn phụ thuộc cấu hình hiện tại |

## 3. Bảng giả định cần đóng ở G0

| Hạng mục | Trạng thái hiện tại | Cách xác minh |
|---|---|---|
| Origin/route thực của Flow trên máy người dùng | Chưa quan sát trực tiếp | Mở URL chính thức, ghi URL sau redirect |
| Model/tỷ lệ/resolution có trong tài khoản | Chưa quan sát trực tiếp | Đọc settings Image mode |
| Giới hạn số/size/type refs trong Flow | Chưa xác định từ nguồn dùng ở bộ này | Quan sát UI/error hoặc docs mới; không thử brute force |
| DOM selector ổn định | Chưa triển khai | G0 fixture + runtime read-back |
| Synthetic file upload | Chưa kiểm chứng | Một thử nghiệm có kiểm soát, manual fallback |
| Native mask import hoặc điều khiển lasso | Chưa kiểm chứng | Thử UI capability; không suy từ lasso visible |
| Đường lấy file output full-resolution | Chưa kiểm chứng tự động | Download UI trước, automatic path sau |
| Cost của một image job cụ thể | Unknown | Đọc UI; không lấy giá từ model khác |
| Identity/style adherence | Chưa benchmark | Bộ 12 brief và rubric ở QA |
| PNG/color/alpha strict round-trip | Chưa có ứng dụng hoàn chỉnh | Integration tests G3; core reference không thay thế |

## 4. Kết luận bàn giao

Bộ thiết kế có đường thực hiện khả thi ngay cả khi một số thao tác Flow phải làm thủ công: chuẩn bị refs/prompt → tạo trên Flow → nhập ảnh kết quả → chỉnh/ghép vùng → xuất kiểm tra. Mức tự động hóa chỉ tăng khi có evidence. Điều được kiểm tra xác định là dữ liệu input, trạng thái và pixel ngoài mask; chất lượng ảnh sinh được quản lý bằng review và benchmark.
