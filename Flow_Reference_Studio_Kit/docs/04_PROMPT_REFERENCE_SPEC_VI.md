# 04 — Prompt và nhiều ảnh tham chiếu

## 1. Nguyên tắc

Model cần biết **ảnh nào cung cấp yếu tố nào**. Upload nhiều ảnh mà không phân vai dễ trộn nhân vật, trang phục hoặc bố cục. Studio giải quyết bằng dữ liệu có cấu trúc, source map và review; không hứa khả năng mô hình tuyệt đối.

Prompt Compiler cục bộ là MVP. Nó tổ chức yêu cầu người dùng, không tự hiểu đầy đủ nội dung ảnh. Tính năng AI phân tích ảnh/dịch prompt có thể bổ sung nhưng phải tách khỏi chức năng biên soạn xác định và giữ bản gốc.

## 2. Reference roles

| Role | Dùng để lấy | Phải nói rõ không lấy khi cần |
|---|---|---|
| `identity` | Khuôn mặt, tóc, mắt, tỷ lệ, dấu hiệu nhận diện | Trang phục, pose, background không thuộc yêu cầu |
| `outfit` | Quần áo, phụ kiện, chất liệu, màu | Gương mặt của mẫu mặc đồ |
| `pose` | Tư thế, hướng nhìn, nhịp chuyển động | Danh tính, palette hoặc style của ref |
| `composition` | Khung hình, camera, vị trí, khoảng trống | Chi tiết vật thể không được chọn |
| `environment` | Bối cảnh, layout, kiến trúc | Nhân vật xuất hiện tình cờ |
| `style` | Nét, shading, rendering, texture, mức giản lược | Nhân vật, logo, chữ hoặc đồ vật trong ảnh mẫu |
| `palette` | Màu chủ đạo, quan hệ sáng/tối | Vật thể và bố cục |
| `object` | Hình dáng/silhouette/chất liệu vật thể | Không lấy kích thước tuyệt đối nếu brief khác |
| `detail` | Một họa tiết, nút áo, emblem do người dùng chỉ định | Các yếu tố còn lại |

Một asset có thể mang nhiều role nếu người dùng chủ động gán. Chủ thể dùng `subjectKey`, ví dụ `girl_a` và `girl_b`; mọi identity/outfit/pose phải thuộc đúng chủ thể. Không gộp hai người thành “the character”.

`primary`, `secondary`, `supporting` chỉ quyết định cách diễn đạt ưu tiên. Không gửi `weight: 0.8`, `CFG`, `denoise`, `seed`, LoRA hoặc negative-prompt riêng trừ khi capability thực sự hỗ trợ tham số đó. “Giữ traits” là mục tiêu semantic; không gọi là pixel lock.

## 3. Phân giải yêu cầu mâu thuẫn

Thứ tự quản lý ràng buộc: phạm vi mask/protect do engine áp dụng → thay đổi người dùng yêu cầu → traits được chọn giữ → vai trò ref → style → gợi ý trang trí. Thứ tự này **không tự giải mọi mâu thuẫn**.

Ví dụ người dùng chọn “giữ tóc đen” nhưng brief viết “đổi tóc đỏ”: compiler phát `CONFLICT_TRAIT` và yêu cầu chọn giữ hay đổi trước submit. Ref style có tóc đỏ nhưng chỉ role style: chỉ dẫn lấy nét/shading, không lấy màu tóc, nên không cần chặn nếu mapping đã rõ.

Không dùng heuristics từ khóa để tuyên bố đã hiểu semantic hoàn hảo. Structured constraints có thể kiểm tra xác định; mâu thuẫn trong free text đưa ra cảnh báo cần review, không sửa im lặng.

## 4. Pipeline compiler

1. Normalize newline/whitespace không làm đổi exact text và tên riêng.
2. Resolve active references, validate file tồn tại, role/subject, capability và số lượng.
3. Đóng băng thứ tự input; base edit có slot riêng; generate source map theo chính thứ tự sẽ upload.
4. Build prompt AST: task → source map → must keep/change → subject/action → environment/composition → style → lighting/palette → output intent → exclusions.
5. Lint missing subject/role, traits mâu thuẫn, exact text bị mâu thuẫn, global style trong strict local edit, prompt quá dài so với giới hạn đã biết.
6. Render ngôn ngữ được chọn, gắn `compilerVersion`, hash và diff với bản trước.
7. Hiển thị final text + numbered input preview; người dùng chỉnh lại nếu cần. Bản edit tay được lưu riêng, làm invalid các xác nhận upload/prompt trước.
8. Adapter đặt/đọc lại input; không nộp nếu source map không khớp thứ tự Flow đang dùng.

Giới hạn prompt chưa biết thì không cắt tự động. Ưu tiên giảm lặp rồi cho người dùng xem phần bị rút gọn; không bỏ traits hay refs để vừa hộp text.

## 5. Format prompt chuẩn

```text
TASK
Create [asset type] for [purpose]. [One clear main action or visual result.]

REFERENCE MAP — images are supplied in this exact order
Image 1 [alias]: use only for [roles and subject]. Preserve [selected traits].
Image 2 [alias]: use only for [roles]. Do not transfer [excluded attributes].
[Repeat for the actual active inputs only.]

SUBJECT AND SCENE
[Subject identity, action, environment and relevant objects.]

COMPOSITION
[Camera, framing, placement, spatial relationships, required empty areas.]

ART DIRECTION
[Medium, linework, shading, texture, palette and level of stylization.]

MUST KEEP / MUST CHANGE
[Explicit constraints, with no contradictory requirements.]

LIGHT AND MATERIALS
[Light direction, softness and material cues.]

AVOID
[A short list of relevant failures, expressed in normal language.]
```

Đây là mẫu Studio tự thiết kế, không phải cú pháp riêng của Flow. Tỷ lệ/model vẫn được đặt trong UI provider; dòng mô tả tỷ lệ trong prompt không thay được setting đó. Nếu standard Flow không giữ thứ tự ảnh đủ rõ, người dùng phải kiểm tra numbered preview và thumbnails; alias riêng trong Studio không được giả định là attachment ID mà Flow hiểu.

## 6. Ví dụ: nhân vật anime trong phòng isometric

**Input giả định:** Image 1 = nhân vật; Image 2 = trang phục; Image 3 = căn phòng; Image 4 = ví dụ nét vẽ. Các tên/mô tả dưới đây chỉ là ví dụ, phải thay bằng ref thực tế.

**Prompt nội dung người dùng:** “Cô gái đang tưới chậu cây trong phòng trọ nhỏ, góc nhìn isometric, ánh sáng sáng sớm; giữ gương mặt và tóc theo ảnh nhân vật.”

**Prompt style art:** “Anime 2D, nét sạch mảnh, cel shading mềm, palette kem–xanh sage, đồ nội thất giản lược nhưng đọc rõ, không photorealistic.”

**Prompt compiled mẫu:**

```text
Create one cozy anime illustration of Girl A watering a small potted plant
in a compact boarding-house bedroom in the morning.

Reference map:
- Image 1 is Girl A's identity reference. Preserve her face shape, short
  dark hair, eye color and selected hair accessory. Do not copy its outfit
  or background.
- Image 2 is her outfit reference only. Use the cream cardigan and sage
  skirt. Do not transfer the model's face or hairstyle.
- Image 3 is the room-layout reference. Keep the window, bed and desk in
  the same relative arrangement. Do not add people from this reference.
- Image 4 is the art-direction reference only. Use its thin clean outlines,
  soft cel shading and restrained texture. Do not copy its characters or props.

Use a clear isometric three-quarter view. Place Girl A beside the window,
holding one watering can above one potted plant. Keep her silhouette readable
against the room. Preserve the identity traits from Image 1 while using the
rendering language of Image 4; avoid mixing realistic skin with anime features.

Use warm morning light from the window, a cream and sage palette, soft local
shadows and simplified readable furniture. Include one character only.
Avoid extra limbs, duplicate watering cans, floating furniture, added text
and unrelated accessories.
```

Nếu user muốn chibi, thêm tỷ lệ chibi đã lựa chọn một cách rõ ràng. Không vừa yêu cầu giữ tỷ lệ cơ thể của ref non-chibi vừa chuyển sang chibi mà không giải thích ưu tiên.

## 7. Ví dụ: sửa màu sofa trong vùng chọn

```text
Edit the supplied base image. Within the indicated sofa region, replace
the blue upholstery with warm terracotta woven fabric. Keep the sofa's
silhouette, seams, cushion count and placement. Match the existing light
direction and preserve the visible wood trim that has been protected.

Use the fabric reference for color and weave only; do not import its furniture
shape, room or lighting. Do not reframe, move the camera, change the wall,
floor or neighboring objects, or add labels and outlines.

Return the same framing as the supplied base image. The selection guide,
if included, is an editing aid and must not appear in the result.
```

Prompt này tăng xác suất đúng vùng; nhãn Strict chỉ dựa vào compositor và phép kiểm tra PNG. Nếu bản crop context được dùng, đổi “same framing” thành “same framing as the supplied context crop”, lưu map crop và không đòi model xuất toàn ảnh.

## 8. Preset style có cấu trúc

Preset lưu tên/version, medium, linework, shading, texture, palette, lighting preferences, độ giản lược, phù hợp subject nào và exclusions. Ví dụ “Anime Cozy Room” không chỉ là chuỗi “masterpiece, best quality, 8K”. Không thêm tính từ nâng chất lượng nếu chúng mâu thuẫn với art direction.

Identity pack lưu những traits mô tả và các ảnh được người dùng chọn; style pack lưu refs/style fields. Với dự án nhân vật dài hạn, pin pack version ở mỗi job để việc đổi pack không làm mất khả năng truy vết job cũ.

## 9. Vòng tối ưu có kiểm soát

`Brief → Compile → Validate → Generate → Review → Minimal revision → Generate child job`.

Sau review, ghi lỗi cụ thể: tóc sai, tay sai, layout lệch, style quá thực, seam lộ. Lần sửa thay đổi một nhóm nguyên nhân; giữ refs và settings còn lại để dễ so sánh. Lượt sửa mặc định do người dùng kích hoạt; batch chỉ chạy trong số lượt/số output đã đặt.

Không claim seed reproducibility khi provider không công bố/cho chọn seed. Cùng prompt/model/refs chỉ tái tạo **yêu cầu**, không bảo đảm cùng bitmap. AI chấm điểm nếu có là hỗ trợ xếp hạng, không chứng minh danh tính đúng hay mọi pixel giữ nguyên.
