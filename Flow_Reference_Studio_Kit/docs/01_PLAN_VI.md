# 01 — Kế hoạch triển khai

## 1. Mục tiêu và phạm vi

Tên làm việc: **Flow Reference Studio**. Công cụ dành cho người cần tạo nhân vật, concept, background, ảnh sản phẩm hoặc chỉnh chi tiết với nhiều nguồn tham chiếu. Người dùng nhập ý tưởng, phân vai các refs, chọn style và model, xem prompt cuối, tạo ảnh và sửa vùng chưa đạt.

Giả định triển khai: Chrome desktop trên Windows trước; UI tiếng Việt; prompt có thể giữ tiếng Việt hoặc biên soạn tiếng Anh; một tài khoản Flow đang đăng nhập trong một Chrome profile; không cần server cho MVP. Edge là phạm vi kiểm chứng sau. Không tự chuyển tài khoản để né giới hạn.

Kết quả mong muốn là giảm số lần tạo lại do sai nhân vật, sai trang phục, trộn style và sai vùng chỉnh sửa. Không đưa ra cam kết model luôn bám reference hoặc diễn đạt đúng 100%.

## 2. Phạm vi theo phiên bản

| Phiên bản | Có trong phạm vi | Cổng hoàn thành |
|---|---|---|
| G0 — kiểm chứng khả thi | Model picker, refs, thứ tự upload, tỷ lệ, lasso, tải ảnh, UI EN/VI; bảng capability thực nghiệm | Biết rõ thao tác nào tự động, hỗ trợ thủ công hoặc chưa khả dụng |
| MVP Assisted | Project, refs có phân vai, Prompt Compiler, model/tỷ lệ được xác nhận, xuất gói input, import kết quả, canvas mask, Strict compositor, history, export | Tạo và sửa ảnh end-to-end với thao tác Flow thủ công được hướng dẫn rõ |
| V1 Automation | Điền prompt, chọn option, upload refs, submit, theo dõi kết quả khi adapter đã được chứng minh; hàng đợi bền vững | Không gửi trùng trong kịch bản crash/reload; tự hạ về Assisted khi UI khác |
| V1.1 | Preset nhân vật/style, nhiều phiên bản, so sánh, chấm chất lượng hỗ trợ, batch hữu hạn | Cải thiện năng suất theo benchmark; không chạy vòng lặp sinh ảnh vô hạn |
| V2 tùy chọn | Provider Gemini API riêng qua backend của chủ công cụ; team sharing; packaging desktop | Có yêu cầu riêng, cơ chế xác thực, hạn mức và chi phí riêng |

MVP phải chứa cả tạo ảnh nhiều refs và sửa vùng. Không hoãn yêu cầu sửa vùng sang một roadmap không có ngày kiểm chứng. Nếu native lasso chưa điều khiển được, MVP vẫn làm được bằng crop/context + nhập ảnh kết quả + ghép cục bộ, với bước căn chỉnh/duyệt rõ ràng.

Ngoài MVP: tạo video, đăng lên mạng xã hội, đọc thư mục browser profile, chia sẻ cloud tự động, nền tảng mobile, gallery công khai. Native Flow Tools có thể được khảo sát sau nhưng không coi là API của extension.

## 3. Lộ trình và ước lượng

Ước lượng **20–30 ngày công kỹ thuật**, thường 4–6 tuần cho 1 dev tập trung, có người QA hỗ trợ. Chưa gồm thời gian xét duyệt Chrome Web Store. Mốc này phụ thuộc kết quả G0; không phải cam kết thời gian.

| Giai đoạn | Ngày công dự kiến | Công việc | Bằng chứng bàn giao |
|---|---:|---|---|
| G0 | 2–3 | Thử capability trên Flow thật, chốt Assisted/DOM, giới hạn upload và download | Báo cáo tương thích, case pass/fail, không chứa bí mật tài khoản |
| G1 | 3–4 | MV3, Workbench, side panel, IndexedDB, project/assets, mock provider | Extension chạy cục bộ; tạo/mở lại project được |
| G2 | 3–4 | References, source map, Prompt Compiler, preset, validation | Bộ input và prompt tái tạo được, không bỏ ref âm thầm |
| G3 | 4–6 | Canvas, tọa độ, mask/protect, crop mapping, compositor, PNG verifier | Các test mask/color/alpha/export pass; ảnh ngoài mask bằng baseline |
| G4 | 4–6 | Flow adapter, submit journal, polling/reconcile, phục hồi | Một lượt generate và edit thật; reload giữa submit không tự gửi lần nữa |
| G5 | 4–7 | QA thực tế, benchmark nội dung, sửa lỗi, đóng gói, hướng dẫn | UAT đạt, release candidate và kế hoạch rollback |

Chỉ song song các task không phụ thuộc nếu đội triển khai có nhân lực. Thứ tự bắt buộc: **capability → hợp đồng dữ liệu → mock → pipeline ảnh → Flow thật → nghiệm thu**.

## 4. Backlog có thể giao việc

| ID | Ưu tiên | Nội dung | Phụ thuộc | Định nghĩa hoàn thành |
|---|---|---|---|---|
| DISC-01 | P0 | Khảo sát Flow và model tài khoản | — | Capability ledger có ngày kiểm tra, bằng chứng, trạng thái unknown cho điều chưa biết |
| EXT-01 | P0 | MV3 + routes Workbench/side panel | — | Build production không tải JS từ CDN; không lỗi console trên flow chính |
| DATA-01 | P0 | Asset blob, draft, job journal, backup | EXT-01 | Restart không mất refs; migration có bản sao phục hồi |
| REF-01 | P0 | Import nhiều ảnh, phân vai, sắp thứ tự, crop dẫn xuất | DATA-01 | Source map đúng sau reorder/remove; original không bị sửa |
| PRM-01 | P0 | Compiler có cấu trúc và conflict lint | REF-01 | Cùng input/version tạo cùng prompt; chặn constraint mâu thuẫn đã xác định |
| CAP-01 | P0 | Model/tỷ lệ/resolution capability + revalidate | DISC-01 | Không chọn giá trị không biết; không tự đổi model |
| IMG-01 | P0 | Baseline RGBA, mask, protect, undo/redo | DATA-01 | Zoom/pan/DPR/EXIF không làm lệch mask |
| IMG-02 | P0 | Crop strategy + Strict compositor + PNG verify | IMG-01 | Ngoài mask không có pixel thay đổi ở file đã encode/decode |
| FLOW-01 | P0 | Assisted export/import walkthrough | PRM-01, IMG-01 | Có vòng end-to-end dù automation không khả dụng |
| FLOW-02 | P1 | DOM adapter có kiểm tra trước/sau | DISC-01, CAP-01 | Verified selector pack; fixture fail thì dừng trước submit |
| JOB-01 | P0 | Máy trạng thái, lock, cancel, reconcile | DATA-01 | Crash/reload test không gây submit trùng |
| HIST-01 | P0 | Version tree, compare, PNG/package export | IMG-02 | Mỗi ảnh truy ra prompt/refs/model thực tế/baseline |
| QA-01 | P0 | Test data + UAT + benchmark | Tất cả P0 | Lỗi chặn phát hành bằng 0; báo cáo giới hạn rõ ràng |
| OPT-01 | P2 | AI hỗ trợ phân tích refs/prompt | V1 ổn định | Có bật/tắt và data disclosure; không bắt buộc cho tạo ảnh |

## 5. Cổng nghiệm thu

**G0:** Nếu DOM không ổn định, vẫn tiếp tục MVP Assisted; không lắp endpoint nội bộ để lấp chỗ trống. Nếu không lấy được ảnh đầu ra bản đầy đủ bằng luồng được hỗ trợ, yêu cầu download/import file. Không dùng thumbnail cho bản xuất chất lượng cao.

**G2:** Mỗi ảnh đưa vào Flow phải có nguồn gốc, thứ tự, vai trò và SHA-256. UI phân biệt “đã chọn ở Studio”, “đã tải lên Flow” và “đã xác nhận”. Không có ref bị loại mà người dùng không biết.

**G3:** Nút xuất “Giữ nguyên ngoài vùng” chỉ bật sau khi PNG round-trip đạt `outsideChangedPixels = 0`. Chất lượng nội dung bên trong vùng được duyệt riêng.

**G4:** Tình trạng submit không rõ dẫn tới `NEEDS_RECONCILIATION`, không dẫn tới retry generate. Không đồng nhất bản ghi local với idempotency phía Flow.

**G5:** Bộ prompt benchmark và các lỗi bắt buộc trong QA đạt. Bộ phát hành gồm extension bundle, version notes, known issues, hướng dẫn sử dụng, backup/restore và ma trận tương thích.

## 6. Rủi ro và cách xử lý cụ thể

| Rủi ro | Biện pháp | Quyết định khi không đạt |
|---|---|---|
| Flow thay đổi giao diện | Adapter phiên bản hóa, semantic selector, preflight, fixture đã khử dữ liệu cá nhân | Dừng DOM action bị lỗi, vẫn dùng Assisted |
| Model không giữ đúng chi tiết | Vai trò ref rõ, protected traits, rubric và vòng sửa có giới hạn | Không đánh dấu đạt khi chưa qua review |
| Native mask không nhập được | Lasso thủ công hoặc crop context; compositing cục bộ | Hiện bước cần người dùng; không mô phỏng hỗ trợ native mask |
| Prompt edit làm biến đổi toàn ảnh | Copy pixel baseline ngoài mask; chặn export lỗi | Không phát hành nhãn Strict |
| Upload/output không ánh xạ chắc chắn | Xác nhận thứ tự và ảnh đầu ra trong UI | Chuyển Assisted; không đoán theo vị trí thumbnail |
| Hết quota / có xác minh tài khoản | Tạm dừng hàng đợi và nêu hành động trong Flow | Không tự retry vô hạn hoặc chuyển account |
| Thiếu RAM/quota lưu trữ | Decode từng ảnh, cache có giới hạn, kiểm tra dung lượng, backup | Chặn import mới trước khi ảnh đang lưu bị mất |

## 7. Chỉ số vận hành

Theo dõi số job hoàn thành, số lần cần thao tác thủ công, số submit không rõ kết quả, số ref upload sai, tỉ lệ xuất Strict pass và số lần tạo lại trước khi duyệt. Latency tạo ảnh báo theo percentile thực đo, không cam kết vì phụ thuộc Flow. Không thu nội dung prompt/ảnh lên máy chủ theo mặc định.
