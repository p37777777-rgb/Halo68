const { app, core } = require("photoshop");
const {
  EFFECT_GROUP_NAME,
  LAYER_NAMES,
  findEffectGroups,
  runBatch,
  selectLayer,
  refreshLayerList,
  setStatus,
  setBusy,
} = require("./components.js");

function findDirectChild(group, name) {
  return Array.from(group.layers || []).find((layer) => layer.name === name);
}

function getEffectLayers(documentToEdit) {
  const groups = findEffectGroups(documentToEdit);
  if (groups.length === 0) {
    throw new Error(`请先创建「${EFFECT_GROUP_NAME}」`);
  }
  if (groups.length > 1) {
    throw new Error(`检测到多个「${EFFECT_GROUP_NAME}」，请先保留一个效果组`);
  }

  const effectGroup = groups[0];
  const subject = findDirectChild(effectGroup, LAYER_NAMES.subject);
  const background = findDirectChild(effectGroup, LAYER_NAMES.background);
  if (!subject || !background) {
    throw new Error("效果组缺少 Subject 或 Background 图层");
  }
  return { subject, background };
}

async function selectSubject() {
  await runBatch(
    [
      {
        _obj: "autoCutout",
        sampleAllLayers: false,
        _options: { dialogOptions: "dontDisplay" },
      },
    ],
    "选择主体",
  );
}

async function addSelectionMask(layer, inverted, selectTarget = true) {
  if (selectTarget) {
    await selectLayer(layer, app.activeDocument);
  }
  const results = await require("photoshop").action.batchPlay(
    [
      {
        _obj: "make",
        new: { _class: "channel" },
        at: {
          _ref: "channel",
          _enum: "channel",
          _value: "mask",
        },
        using: {
          _enum: "userMaskEnabled",
          _value: inverted ? "hideSelection" : "revealSelection",
        },
        _isCommand: true,
        _options: { dialogOptions: "dontDisplay" },
      },
    ],
    {
      synchronousExecution: true,
      modalBehavior: "execute",
      immediateRedraw: true,
    },
  );
  for (const result of results || []) {
    if (result && String(result._obj).toLowerCase() === "error") {
      throw new Error(`${layer.name}蒙版失败: ${result.message || "未知错误"}`);
    }
  }
}

async function clearSelection() {
  await runBatch(
    [
      {
        _obj: "set",
        _target: [{ _ref: "channel", _property: "selection" }],
        to: { _enum: "ordinal", _value: "none" },
        _options: { dialogOptions: "dontDisplay" },
      },
    ],
    "清除选区",
  );
}

async function restoreSelection() {
  await runBatch(
    [
      {
        _obj: "set",
        _target: [{ _property: "selection", _ref: "channel" }],
        to: { _enum: "ordinal", _ref: "channel" },
        _options: { dialogOptions: "dontDisplay" },
      },
    ],
    "恢复选区",
  );
}

async function invertSelection() {
  await runBatch([{ _obj: "inverse" }], "反选");
}

async function restorePreviousSelection() {
  await runBatch(
    [
      {
        _obj: "set",
        _target: [{ _property: "selection", _ref: "channel" }],
        to: { _enum: "ordinal", _value: "previous" },
        _options: { dialogOptions: "dontDisplay" },
      },
    ],
    "恢复上一个选区",
  );
}

async function createSubjectMasks() {
  if (app.documents.length === 0) {
    setStatus("请打开一张图片", true);
    return;
  }

  const documentToEdit = app.activeDocument;
  setBusy(true);
  setStatus("正在选择人物并创建蒙版...");

  try {
    await core.executeAsModal(
      async () => {
        const { subject, background } = getEffectLayers(documentToEdit);
        subject.visible = true;

        await selectLayer(subject, documentToEdit);
        await selectSubject();
        await addSelectionMask(subject, false, false);
        await restoreSelection();
        await invertSelection();
        await addSelectionMask(background, false);
        await restorePreviousSelection();
        await clearSelection();
        await selectLayer(subject, documentToEdit);
      },
      { commandName: "Create Subject Masks" },
    );
    setStatus("人物蒙版已创建");
    await refreshLayerList();
  } catch (error) {
    console.error(error);
    const message = error && error.message ? error.message : String(error);
    setStatus(`创建失败:${message}`, true);
  } finally {
    setBusy(false);
  }
}

module.exports = { createSubjectMasks };
