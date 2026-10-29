# 02 — Đặc tả sản phẩm và UX

## 1. Bố cục công cụ

**Side panel** phục vụ lúc người dùng đang ở Flow: project hiện tại, tab kết nối, model/tỷ lệ đang dùng, tóm tắt refs, prompt cuối, trạng thái job, nút mở Workbench. Không nhồi trình vẽ mask vào chiều rộng hẹp.

**Workbench** là trang extension độc lập, tối ưu màn hình PC 1440×900 trở lên; vẫn sử dụng được ở 1280×720 bằng các panel thu gọn.

| Khu vực | Thành phần | Hành vi |
|---|---|---|
| Thanh trên | Project, provider, tab Flow, model, trạng thái kết nối, dung lượng | Model hiển thị nguồn xác nhận và thời điểm kiểm tra |
| Cột trái ~280 px | Reference board, vai trò, crop, thứ tự, active toggle | Reorder làm thay đổi input mapping; đánh dấu prompt cần biên soạn lại |
| Trung tâm co giãn | Canvas/kết quả, zoom/pan, before/after, mask, protect, heatmap | Công cụ vẽ chỉ xuất hiện khi đã chọn ảnh gốc |
| Cột phải ~340 px | Brief, style, constraints, ratio/resolution, prompt preview | Nút mở rộng toàn màn hình cho prompt dài |
| Thanh dưới | Queue, history/version, chi phí đã biết/chưa biết, tạo/hủy | Trạng thái phản ánh sự kiện thực; không chạy progress % giả |

Tab chức năng: **Tạo ảnh · Sửa vùng · Biến thể · Lịch sử · Cài đặt**. Không thay đổi provider, model hoặc gửi ảnh ra dịch vụ khác bằng một tùy chọn ẩn.

## 2. Luồng tạo ảnh

1. Tạo project, nhập mục tiêu và chọn loại công việc: nhân vật, background, sản phẩm, illustration hoặc custom.
2. Kết nối một tab Flow đang mở; nếu chưa đăng nhập, UI hướng dẫn đăng nhập trong Flow.
3. Import refs, gán vai trò, đặt trait cần giữ và chọn ref tham gia job này.
4. Chọn model/tỷ lệ từ thông tin đã đọc hoặc đã xác nhận; số output trong phạm vi provider chấp nhận.
5. Nhập **Prompt nội dung**, **Prompt style art** và các ràng buộc. Xem phần ghép cuối cùng và source map.
6. Preflight kiểm tra ref/capability/chi phí được biết. Nút “Tạo ảnh” cho phép gửi job cụ thể này; không tạo thêm vòng sửa tự động ngoài số lượt đã đặt.
7. Assisted hướng dẫn upload/copy prompt/chọn options/bấm tạo ở Flow. DOM mode thực hiện các bước đã chứng minh và đọc lại trạng thái trước submit.
8. Nhận ảnh hoặc import file tải từ Flow, chọn kết quả, kiểm tra checklist rồi lưu phiên bản/đưa vào sửa vùng.

Trong Assisted, nút “Chuẩn bị cho Flow” không hiển thị “đang tạo” trước khi người dùng thực sự gửi ở Flow. Đánh dấu nguồn kết quả là `user_import` nếu import thủ công; không dựng provider request ID.

## 3. Luồng sửa vùng

1. Chọn ảnh gốc; hệ thống tạo baseline đã chuẩn hóa và hiển thị kích thước.
2. Vẽ vùng được sửa bằng brush/lasso/rectangle; dùng protect brush để bảo vệ chi tiết nằm trong vùng lớn.
3. Mô tả thay đổi cục bộ, chọn refs liên quan và kiểm tra vùng bóng/ánh sáng cần đi kèm.
4. Chọn strategy được hỗ trợ: native Flow edit, crop patch, hoặc full-frame candidate.
5. Preview input: ảnh base, refs, vùng cần sửa, phần được bảo vệ, context crop. Overlay hướng dẫn tách riêng, không đè lên baseline.
6. Tạo candidate bằng Flow. Nhập/chọn đúng candidate, kiểm tra căn chỉnh ở mức pixel ảnh gốc.
7. Extension ghép candidate vào mask; vùng ngoài giữ pixel baseline. Cho xem before/after và đường biên.
8. Kiểm tra PNG xuất, xem `0 pixel ngoài vùng bị thay đổi`, sau đó duyệt nội dung và lưu version mới.

Nếu thay đổi đòi hỏi bóng đổ ngoài mask, UI báo: “Bóng mới nằm ngoài vùng được phép sửa. Mở rộng vùng để chỉnh cả bóng, hoặc giữ bóng hiện tại.” Việc mở rộng mask tạo revision mới và phải xem lại vùng trước lần tạo tiếp theo.

## 4. Yêu cầu chức năng

| ID | Chức năng | Quy tắc bắt buộc |
|---|---|---|
| FR-01 | Project | Tạo, đổi tên, lưu draft tự động, duplicate, archive/delete có phục hồi hợp lý; mỗi project có style preset riêng |
| FR-02 | Nhiều refs | Import nhiều file, kéo thả, loại trùng theo bytes, reorder, bật/tắt, xem full size |
| FR-03 | Vai trò ref | Identity, outfit, pose, composition, environment, style, palette, object/detail; base edit là slot riêng |
| FR-04 | Trait constraints | Ghi thuộc tính bắt buộc/không lấy từ ref; cùng một thuộc tính có hai chỉ định trái nhau phải giải quyết trước submit |
| FR-05 | Model picker | Chỉ model tài khoản đang có; đổi model phải kiểm tra lại refs, tỷ lệ, resolution, edit support |
| FR-06 | Brief + art style | Hai ô độc lập; lưu bản gốc và bản compiled; không tự thay nhân vật/đồ vật để “làm đẹp prompt” |
| FR-07 | Kích thước | Tách tỷ lệ tạo, resolution provider, kích thước export; custom W×H là bước xử lý ảnh nếu provider không có |
| FR-08 | Tạo/biến thể | Số output, số lượt tối đa, xem kết quả; retry/revise tạo child job và ghi lịch sử |
| FR-09 | Sửa vùng | Add/subtract mask, protect, feather hướng vào trong, undo/redo, zoom, pan, fit-to-screen |
| FR-10 | Bảo toàn ngoài vùng | Strict giữ hình học baseline, encode PNG lossless, kiểm tra byte RGBA ngoài mask |
| FR-11 | Lịch sử | Ảnh gốc, prompt, refs, settings, candidate, composite, report; hoàn tác tạo nhánh version |
| FR-12 | Export | PNG, JPEG dẫn xuất, project package có ảnh và metadata, prompt text; bản JPEG không có nhãn pixel-exact |
| FR-13 | Queue | Một job active cho mỗi tài khoản kết nối; pause/resume/cancel; sau reload phải reconcile |
| FR-14 | Khả năng tương thích | Hiển thị “Tự động”, “Cần thao tác”, “Chưa xác minh”, “Không hỗ trợ” cho từng bước |
| FR-15 | Dữ liệu | Local-first; xóa project xử lý cả blobs không còn tham chiếu; export backup trước migration lớn |

## 5. Reference board

Mỗi card hiển thị thumbnail, tên, vai trò, chủ thể liên quan, mức ưu tiên `primary/secondary/supporting`, traits lấy từ ảnh, traits cần tránh, trạng thái tham gia job, hash rút gọn và chất lượng quan sát.

Các cảnh báo có ích: mặt quá nhỏ; ảnh mờ; nhiều người nhưng chưa chọn chủ thể; ref style có trang phục khác ref identity; hai refs biểu diễn hai phiên bản nhân vật. Chưa có mô-đun thị giác thì để người dùng đánh giá, không tạo chỉ số AI giả.

Giới hạn sản phẩm đề xuất: tối đa 24 refs trong project, 20 MiB/file và 24 megapixel/file. Đây là giới hạn local của Studio, **không phải giới hạn Flow**. Số refs trong một request lấy từ capability đã xác nhận; nếu unknown, dùng Assisted và kiểm tra số thumbnail thực tế trước khi gửi.

PNG/JPEG/WebP tĩnh là đầu vào MVP. File động, SVG hoặc định dạng chưa có decoder: báo rõ chưa hỗ trợ. Crop/resize tạo derived asset, giữ original. Không tự ghép nhiều ref vào contact sheet để lách số lượng, vì giảm thông tin nhận dạng và đổi cách model hiểu ảnh.

## 6. Prompt editor

Các trường đề xuất: Subject, Action, Environment, Camera/Composition, Lighting, Mood của hình ảnh, Style/Medium, Palette, Protected traits, Avoid, Exact text. “Mood” ở đây là cảm xúc/màu sắc của hình ảnh, không phải hệ thống gameplay.

Người dùng có thể dùng chế độ đơn giản với 2 ô prompt nội dung/style; advanced mode mở các trường bổ sung. Preview cho thấy các phần đã được thêm, nguồn từ ref nào và cảnh báo mâu thuẫn. Không tự động dịch tên riêng, câu chữ phải in trong ảnh hoặc mã màu.

Nút “Cải thiện prompt” mặc định là bộ quy tắc cục bộ: bỏ lặp, tổ chức câu, nêu rõ mapping. Nếu bổ sung dịch vụ LLM, người dùng bật trước và biết ảnh/text nào được gửi; mọi chỉnh sửa có diff để áp dụng. Không có điểm “99% đúng” khi chưa tạo ảnh.

## 7. Model và kích thước

Dropdown có tên hiển thị chính xác trong Flow, capability, trạng thái available/disabled/unknown. Model đã chọn biến mất: giữ draft và chặn submit; không đổi sang model khác vì “gần giống”. Khi muốn tự chọn model bằng Flow Agent, UI dùng lựa chọn riêng **Auto — Flow Agent** và ghi model thực tế là unknown nếu không đọc được. Chọn model chính xác thì đi qua standard prompt box, xác nhận Agent không đang định tuyến tự động.

Ratio presets của Studio có thể gợi ý 1:1, 16:9, 9:16, 4:3, 3:2 nhưng chỉ bật những giá trị được xác nhận trên provider. Không suy diễn độ phân giải từ tỷ lệ. Resolution không đọc được: hiển thị “Do Flow quyết định”, sau khi nhận ảnh mới đọc W×H thật.

Custom export cần chọn rõ **fit + padding** hoặc **crop to fill**, có preview. Ảnh strict chỉ xuất đúng W×H baseline; resize/crop sau đó tạo file dẫn xuất với nhãn “Đã đổi kích thước”. Upscale thông thường và AI upscale là hai thao tác khác nhau, không gán giả cho model.

## 8. Lịch sử, so sánh và duyệt

Mỗi generation có các candidate; mỗi candidate có thể tạo version đã duyệt. Panel so sánh hỗ trợ slider trước/sau, hai ảnh cạnh nhau, zoom đồng bộ, đường viền mask và heatmap khác biệt. Ngoài mask xanh khi không đổi, lỗi đỏ khi có pixel khác. Không đưa overlay kiểm tra vào file xuất.

Checklist duyệt: đúng chủ thể; đúng traits; đúng style; đúng bố cục; nội dung theo brief; không lỗi bàn tay/vật thể đáng chú ý; seam vùng sửa chấp nhận được. Người dùng quyết định nội dung đạt; test pixel quyết định nhãn bảo toàn ngoài vùng. Hai kết quả được lưu riêng.

## 9. Trạng thái và thông báo

| Tình huống | Nội dung hiển thị / hành động |
|---|---|
| Chưa kết nối | “Mở Flow và chọn tab để kết nối.” |
| Có 2 tab phù hợp | Hiển thị title/project để chọn; không tự chọn tab cuối cùng |
| Chưa biết giới hạn refs | “Cần kiểm tra số ảnh trong Flow trước khi gửi.” |
| File quá lớn | Nêu kích thước, nút tạo bản thu nhỏ; original giữ nguyên |
| Không biết đã submit hay chưa | “Cần đối chiếu kết quả trong Flow để tránh tạo trùng.” |
| Mất liên kết kết quả | “Chọn ảnh trong Flow hoặc nhập file đã tải về.” |
| Hết quota/credit | Pause; mở trang Flow kiểm tra; không tự tiếp tục vào giờ dự đoán |
| Mask rỗng | “Vẽ vùng cần chỉnh sửa.”; disable generate |
| Candidate lệch góc nhìn | “Căn chỉnh hoặc tạo lại; chưa thể ghép đáng tin cậy.” |
| Verify strict lỗi | Khóa xuất Strict, cho xem difference; vẫn giữ candidate để điều tra |

## 10. Khả năng sử dụng

Keyboard navigation cho form, focus rõ, label đọc được; mask có công cụ rectangle bằng nhập tọa độ để không phụ thuộc hoàn toàn vào chuột. `Ctrl+Z` trong canvas undo nét vẽ, trong input undo text; không chặn toàn bộ phím tắt Flow. `Space+drag` pan, wheel có modifier để zoom; có nút thay thế. Auto-save thông báo lưu thật, không chỉ thay nhãn UI.
