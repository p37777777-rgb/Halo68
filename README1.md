第 1 阶段：PS 图层合成 MVP
第 2 阶段：自动人物蒙版
第 3 阶段：人脸/头部定位
第 4 阶段：光环透视与遮挡
第 5 阶段：预设、调色与辉光
第 6 阶段：稳定性、多人和发布

整体安排：
第 1 阶段：先做一个可交付 MVP
目标：用户打开单人照片，点击“添加光环”，插件建立完整、可编辑的图层组。
固定图层结构：
HALO68 Effect
Subject
Halo Glow
Halo
Background
功能顺序：

1. 检查活动文档、当前图层是否存在。
2. 复制用户选中的照片图层两份：Subject、Background。
3. 从插件内置资源导入透明光环 PNG。
4. 将光环置于 Subject 与 Background 中间。
5. 先让用户手动拖动、缩放、旋转光环。
6. 创建 Glow 副本，设置混合模式、不透明度、Gaussian Blur。
7. 所有生成内容只放入 HALO68 Effect，重复运行前仅删除/更新这个组。
   这一步不用 AI，最适合先验证 Photoshop 图层、历史记录、资源导入和效果品质。
   第 2 阶段：人物与背景自动分离
   目标：实现 Subject 自动带人物蒙版，光环自然位于人物头后。
   • 调用 Photoshop 的“选择主体”得到人物选区。
   • 为 Subject 创建图层蒙版。
   • 对 Background 使用反向蒙版。
   • 增加蒙版边缘参数：羽化、扩展/收缩、去边。
   • UI 提供“重新选择人物”和“编辑蒙版”按钮。
   不要自己训练人物分割模型。你的第一选择应是 Photoshop 的原生主体选择能力；它的结果和用户习惯中的 Photoshop 抠图最一致。
   第 3 阶段：人脸与头部定位
   目标：从“手动放光环”变成“自动放到头顶”。
   建议拆成一个纯数据模块：
   {
   faceBox: { x, y, width, height },
   landmarks: {
   leftEye, rightEye, noseTip, forehead
   },
   pose: { yaw, pitch, roll },
   haloAnchor: { x, y },
   confidence: 0.0
   }
   实现路线建议：
   • MVP： 用脸框估算头顶：x = 脸中心，y = 脸框顶部 - 0.15 × 脸高。
   • 正式版： 使用 MediaPipe Face Landmarker 或同级方案获取人脸关键点与头部姿态。
   • 低置信度兜底： 不自动应用，显示“无法可靠定位，请拖动光环微调”。
   人脸识别不要直接塞进 main.js。应独立为 services/faceDetection.js，这样未来可从云端推理切换成本地 WASM，而不影响 Photoshop 图层逻辑。
   第 4 阶段：空间感与遮挡
   根据姿态自动计算：
   • roll：光环旋转。
   • yaw：横向压缩光环，偏向头部转向的反方向。
   • 脸尺寸：光环缩放。
   • pitch：调整纵向高度与椭圆透视感。
   图层处理：
   Subject（最上层，遮挡光环）
   Halo
   Halo Glow
   Background（最下层）
   保留四个手动控制：X/Y 偏移、缩放、旋转、透视压缩。自动化负责 80%，用户负责最后 20%，效果会可靠得多。
   第 5 阶段：可编辑的风格系统
   先做 3 个预设就够：
   • Classic Gold：暖金光环、柔和辉光、背景轻降饱和。
   • Celestial White：白蓝光、较强辉光、轻微冷色。
   • Neon Aura：高饱和颜色、Linear Dodge/Add、背景暗化。
   可控参数：
   • 光环预设、色相、亮度、不透明度。
   • 辉光强度、模糊半径、扩散。
   • 背景亮度、饱和度、模糊。
   • 人物高光色、轮廓光强度。
   效果尽量用 Photoshop 调整层、图层样式和智能滤镜实现，保持 PSD 可再编辑。对于多步操作，用一次 executeAsModal 包裹，以生成单条历史记录；可用进度上报处理耗时操作。(developer.adobe.com)
