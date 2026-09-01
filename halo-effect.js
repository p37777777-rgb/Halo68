const { storage } = require("uxp");
//本体、原子操作和历史记录、枚举值
const { app, core, constants } = require("photoshop");
//方便调用本地文件api
const localFileSystem = storage.localFileSystem;

const {
  EFFECT_GROUP_NAME,
  HALO_RESOURCE_PATH,
  GLOW,
  LAYER_NAMES,
  GENERATED_LAYER_NAMES,
  importHaloIntoGroup,
  fitHaloToCanvas,
  removePreviousEffect,
  selectLayer,
  refreshLayerList,
  setStatus,
  setBusy,
  stackLayersInOrder,
  renameLayerById,
  isLayerAlive,
} = require("./tools/components.js");
//这个文件写大致主流程

//沿 parent 链一路往上找，判断图层是否在效果组内的任意层级
function isInsideEffectGroup(layer) {
  let current = layer.parent;
  while (current) {
    if (current.name === EFFECT_GROUP_NAME) return true;
    current = current.parent;
  }
  return false;
}

//校验用户选中的图层能否当作原图使用
function validateSourceLayer(layer) {
  if (!layer) return "请选择图片图层";
  if (layer.kind === constants.LayerKind.GROUP) return "请选择原图照片图层";
  if (layer.name === EFFECT_GROUP_NAME) return "请选择原图照片图层";
  if (isInsideEffectGroup(layer)) return "请选择原图照片图层";
  //上一轮生成的图层若被挤到了顶层，parent 为 null，只能靠名字识别
  if (GENERATED_LAYER_NAMES.includes(layer.name)) {
    return `「${layer.name}」是插件生成的图层，请选择原图照片图层`;
  }
  return null;
}

async function createHaloEffect() {
  //检查当前文档和图层是否存在
  if (app.documents.length === 0) {
    setStatus("请打开一张图片", true); //第二个参数是红色错误样式
    return;
  }

  const documentToEdit = app.activeDocument; //当前文档
  const sourceLayer = documentToEdit.activeLayers[0]; //当前选中的图层

  const invalidReason = validateSourceLayer(sourceLayer);
  if (invalidReason) {
    setStatus(invalidReason, true);
    return;
  }
  //后续清理旧组时要用 id 复查源图层是否还活着
  const sourceLayerId = sourceLayer.id;

  let haloFile = null;
  try {
    const pluginFolder = await localFileSystem.getPluginFolder();
    haloFile = await pluginFolder.getEntry(HALO_RESOURCE_PATH);
    if (!haloFile.isFile) throw new Error("当前文件有误");
  } catch (e) {
    setStatus(e.message, true);
    return;
  }
  setBusy(true);
  setStatus("正在建立图层中...");

  try {
    //所有文档都被executeAsModal包裹起来，保证操作是原子的，不会被其他操作打断防止并发、失败回滚
    await core.executeAsModal(
      async () => {
        // 1) 幂等：递归删掉所有旧效果组（不限层级、不限数量），失败即抛错
        await removePreviousEffect(documentToEdit);

        // 删旧组有可能连带删掉源图层（比如源图层本身就在旧组里），必须复查
        if (!isLayerAlive(documentToEdit, sourceLayerId)) {
          throw new Error("原图图层已不存在，请重新选择照片图层");
        }

        // 2) 全部在最外层创建，按"最终顺序倒序"：
        //    最终(上→下) Subject/Glow/Halo/Background
        //    创建顺序 Background → Halo → Glow → Subject
        const background = await sourceLayer.duplicate();
        background.name = LAYER_NAMES.background;

        const halo = await importHaloIntoGroup(haloFile, documentToEdit);
        await fitHaloToCanvas(halo, documentToEdit);

        const glow = await halo.duplicate();
        glow.name = LAYER_NAMES.glow;
        glow.opacity = GLOW.opacity;
        glow.blendMode = GLOW.blendMode;
        await glow.applyGaussianBlur(GLOW.blurRadius);

        const subject = await sourceLayer.duplicate();
        subject.name = LAYER_NAMES.subject;
        subject.visible = false;

        // 3) 成组前把四层排成连续的相邻顺序（上→下）
        //    不做这一步，createLayerGroup 会把中间夹着的无关图层挤出去。
        //    stackLayersInOrder 全部走相对移动，已到位的不重复移动，
        //    避免触发「命令"移动"当前不可用」
        const orderedTopToBottom = [subject, glow, halo, background];
        await stackLayersInOrder(orderedTopToBottom);

        // 4) 一次性打包成组（fromLayers 顺序 = 组内上→下）
        const effectGroup = await documentToEdit.createLayerGroup({
          name: EFFECT_GROUP_NAME,
          fromLayers: orderedTopToBottom,
        });
        if (!effectGroup) {
          throw new Error("打包成组失败");
        }

        // 5) 校验组名。部分 PS 版本会忽略 name，生成"组 1"，
        //    名字不对下一轮就找不到这个组，必须兜底改名
        if (effectGroup.name !== EFFECT_GROUP_NAME) {
          await renameLayerById(effectGroup.id, EFFECT_GROUP_NAME);
        }

        // 6) 校验四层确实都进了组，缺层说明成组时被挤出，尽早暴露
        const childNames = Array.from(effectGroup.layers || []).map(
          (l) => l.name,
        );
        const missing = orderedTopToBottom
          .map((l) => l.name)
          .filter((name) => !childNames.includes(name));
        if (missing.length > 0) {
          throw new Error(`图层未进入效果组: ${missing.join("、")}`);
        }

        halo.link(glow);
        await selectLayer(halo, documentToEdit);
      },
      { commandName: "Create Halo Effect" },
    );
    setStatus("光环效果已创建");
    await refreshLayerList();
  } catch (error) {
    console.error(error);
    setStatus(`创建失败:${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

module.exports = { createHaloEffect };
