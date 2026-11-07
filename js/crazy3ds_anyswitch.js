import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// ==================== 精致化视觉常量 ====================
const THEME = {
    nodeBg: "#282828",
    headerBg: "#333333",
    border: "#3e3e3e",
    cyan: "#14857b",
    cyanBright: "#1ca89c",
    cyanFillActive: "#125e57",
    cyanStrokeActive: "#25b8ab",
    pillBg: "#222222",
    pillStroke: "#424242",
    textActive: "#071715",
    textNormal: "#8c8c8c",
    textMuted: "#5e5e5e",
    textContent: "#9aa0a6",
    rowHeight: 22,
    rowGap: 5,
    topBase: 34,
    strokeWidth: 1.0,
};

// 注入全局滚动条与常驻输入框无痕样式
(function injectSeamlessStyles() {
    if (document.getElementById("crazy3ds-anyswitch-styles")) return;
    const style = document.createElement("style");
    style.id = "crazy3ds-anyswitch-styles";
    style.textContent = `
        .crazy3ds-persistent-textarea {
            position: fixed;
            margin: 0;
            padding: 6px 8px;
            background: #202020;
            color: #9aa0a6;
            border: 1px solid #343434;
            border-radius: 4px;
            font-size: 11.5px;
            line-height: 16px;
            font-family: Consolas, "Microsoft YaHei", sans-serif;
            resize: none;
            outline: none;
            box-shadow: none;
            box-sizing: border-box;
            caret-color: #1ca89c;
            overflow-y: auto;
            overflow-x: hidden;
            white-space: pre-wrap;
            word-break: break-word;
            transform-origin: 0 0;
            z-index: 20;
            transition: border-color 0.1s ease;
            cursor: text;
        }
        .crazy3ds-persistent-textarea:focus {
            border-color: #25b8ab;
        }
        .crazy3ds-persistent-textarea::placeholder {
            color: #505050;
        }
        .crazy3ds-persistent-textarea::-webkit-scrollbar {
            width: 5px;
        }
        .crazy3ds-persistent-textarea::-webkit-scrollbar-track {
            background: transparent;
        }
        .crazy3ds-persistent-textarea::-webkit-scrollbar-thumb {
            background: #444444;
            border-radius: 3px;
        }
        .crazy3ds-persistent-textarea::-webkit-scrollbar-thumb:hover {
            background: #1ca89c;
        }
        .crazy3ds-seamless-inline {
            position: fixed;
            margin: 0;
            background: transparent;
            border: none;
            outline: none;
            box-shadow: none;
            font-family: "Microsoft YaHei", sans-serif;
            box-sizing: border-box;
            caret-color: #1ca89c;
            transform-origin: 0 0;
            z-index: 100000;
        }
        .crazy3ds-seamless-inline::placeholder {
            color: #5e5e5e;
        }
    `;
    document.head.appendChild(style);
})();

// ==================== 将滚轮事件精准转发给 ComfyUI 主画布以触发画布缩放 ====================
function forwardWheelToCanvas(e) {
    const canvasEl = app.canvas?.canvas;
    if (!canvasEl) return;
    const clonedEvent = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
    });
    canvasEl.dispatchEvent(clonedEvent);
}

// ==================== 基础绘制工具 ====================
function drawRoundedRect(ctx, x, y, w, h, r, fill, stroke, lineWidth = 1.0) {
    if (w <= 0 || h <= 0) return;
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    }
}

function fitText(ctx, text, maxWidth) {
    if (!text || maxWidth <= 0) return "";
    if (ctx.measureText(text).width <= maxWidth) return text;
    const ellipsis = "...";
    let len = text.length;
    while (len > 0 && ctx.measureText(text.slice(0, len) + ellipsis).width > maxWidth) {
        len--;
    }
    return text.slice(0, len) + ellipsis;
}

function hideDataWidget(node, widgetName) {
    const w = node.widgets?.find((w) => w.name === widgetName);
    if (!w) return null;
    w.type = "converted-widget";
    w.hidden = true;
    w.computeSize = () => [0, -4];
    w.draw = () => {};
    if (w.element) {
        w.element.style.display = "none";
    }
    return w;
}

// ==================== 1:1 矩阵缩放同步单行输入框 ====================
function openInlineInput({
    domEvent,
    initialValue,
    placeholder,
    rectInNode,
    node,
    editKey,
    padLeft = 10,
    fontSize = 11.5,
    textColor = "#c8d0d4",
    onLiveChange,
    onCommit,
}) {
    const existing = document.getElementById("crazy3ds-inline-input");
    if (existing && existing._finishCleanup) {
        existing._finishCleanup(true);
    } else if (existing) {
        existing.remove();
    }

    if (domEvent) {
        if (domEvent.preventDefault) domEvent.preventDefault();
        if (domEvent.stopPropagation) domEvent.stopPropagation();
    }

    const input = document.createElement("input");
    input.id = "crazy3ds-inline-input";
    input.className = "crazy3ds-seamless-inline";
    input.type = "text";
    input.value = initialValue || "";
    input.placeholder = placeholder || "";
    input.spellcheck = false;
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");

    const syncPosition = () => {
        const canvas = app.canvas;
        if (!canvas || !node.graph) return;
        const ds = canvas.ds;
        const canvasRect = canvas.canvas.getBoundingClientRect();
        const screenX = canvasRect.left + (node.pos[0] + rectInNode.x + ds.offset[0]) * ds.scale;
        const screenY = canvasRect.top + (node.pos[1] + rectInNode.y + ds.offset[1]) * ds.scale;

        Object.assign(input.style, {
            left: `${screenX}px`,
            top: `${screenY}px`,
            width: `${rectInNode.w}px`,
            height: `${rectInNode.h}px`,
            padding: `0 ${padLeft}px`,
            color: textColor,
            fontSize: `${fontSize}px`,
            lineHeight: `${rectInNode.h}px`,
            transform: `scale(${ds.scale})`,
        });
    };

    syncPosition();
    node._editingKey = editKey;
    node._syncInlineInputPos = syncPosition;

    let committed = false;
    const finish = (save) => {
        if (committed) return;
        committed = true;
        node._editingKey = null;
        node._syncInlineInputPos = null;
        window.removeEventListener("pointerdown", onOutsidePointerDown, true);
        if (save) onCommit(input.value);
        input.remove();
        app.graph.setDirtyCanvas(true, true);
    };
    input._finishCleanup = finish;

    const onOutsidePointerDown = (ev) => {
        if (ev.target !== input) {
            finish(true);
        }
    };

    ["mousedown", "pointerdown", "mouseup", "click", "dblclick", "contextmenu"].forEach((evt) => {
        input.addEventListener(evt, (e) => e.stopPropagation());
    });

    input.addEventListener("input", () => {
        if (onLiveChange) onLiveChange(input.value);
    });

    input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
        } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
        }
    });

    input.addEventListener("blur", () => finish(true));
    input.addEventListener(
        "wheel",
        (e) => {
            e.preventDefault();
            e.stopPropagation();
            forwardWheelToCanvas(e);
        },
        { passive: false }
    );

    document.body.appendChild(input);
    input.focus({ preventScroll: true });

    if (domEvent && typeof domEvent.clientX === "number") {
        const ds = app.canvas.ds;
        const canvasRect = app.canvas.canvas.getBoundingClientRect();
        const clickLocalX =
            (domEvent.clientX - canvasRect.left) / ds.scale -
            ds.offset[0] -
            node.pos[0] -
            rectInNode.x -
            padLeft;
        const ctx = app.canvas.ctx;
        if (ctx && input.value) {
            ctx.save();
            ctx.font = `${fontSize}px Microsoft YaHei, sans-serif`;
            let bestIdx = input.value.length;
            for (let i = 0; i <= input.value.length; i++) {
                if (ctx.measureText(input.value.slice(0, i)).width >= clickLocalX) {
                    bestIdx = i;
                    break;
                }
            }
            ctx.restore();
            input.setSelectionRange(bestIdx, bestIdx);
        }
    } else {
        const len = input.value.length;
        input.setSelectionRange(len, len);
    }

    app.graph.setDirtyCanvas(true, true);
    requestAnimationFrame(() => {
        window.addEventListener("pointerdown", onOutsidePointerDown, true);
    });
}


// ============================================================================
// 分支 A & B：动态行渲染与端口伸缩核心引擎（任意单出 & 任意多出）
// ============================================================================
function setupDynamicSwitchNode(nodeType, isMultiMode) {
    const MIN_W = 210;

    nodeType.prototype.computeSize = function () {
        const rowCount = Math.max(1, this.inputs ? this.inputs.length : 1);
        const h = THEME.topBase + rowCount * (THEME.rowHeight + THEME.rowGap) + 6;
        return [MIN_W, h];
    };

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);

        this.color = THEME.headerBg;
        this.bgcolor = THEME.nodeBg;
        this._isSyncingSlots = false;
        this._editingKey = null;

        this._stateWidget = hideDataWidget(this, "switch_state");

        this._switchData = {
            active_slot: 1,
            rows: [{ title: "", on: true }],
        };

        this._initPorts();
        this._syncWidgetValue();
        this.size = [300, this.computeSize()[1]];
        this._updateSlotPositions();
    };

    nodeType.prototype._initPorts = function () {
        this._isSyncingSlots = true;
        try {
            while (this.inputs && this.inputs.length > 1) {
                this.removeInput(this.inputs.length - 1);
            }
            if (!this.inputs || this.inputs.length === 0) {
                this.addInput("input_1", "*");
            }
            this.inputs[0].name = "input_1";
            this.inputs[0].label = " ";

            if (!isMultiMode) {
                while (this.outputs && this.outputs.length > 1) {
                    this.removeOutput(this.outputs.length - 1);
                }
                if (!this.outputs || this.outputs.length === 0) {
                    this.addOutput("Set Anything", "*");
                }
                this.outputs[0].name = "Set Anything";
                this.outputs[0].label = "Set Anything";
            } else {
                while (this.outputs && this.outputs.length > 1) {
                    this.removeOutput(this.outputs.length - 1);
                }
                if (!this.outputs || this.outputs.length === 0) {
                    this.addOutput("out_1", "*");
                }
                this.outputs[0].name = "out_1";
                this.outputs[0].label = " ";
            }
        } finally {
            this._isSyncingSlots = false;
        }
    };

    nodeType.prototype._syncWidgetValue = function () {
        this._stateWidget = hideDataWidget(this, "switch_state");
        if (this._stateWidget) {
            this._stateWidget.value = JSON.stringify(this._switchData);
        }
    };

    nodeType.prototype._updateSlotPositions = function () {
        const minSize = this.computeSize();
        const curW = Math.max(MIN_W, this.size ? this.size[0] : 300);
        this.size = [curW, minSize[1]];

        const firstRowY = THEME.topBase + THEME.rowHeight / 2;
        if (this.inputs) {
            for (let i = 0; i < this.inputs.length; i++) {
                this.inputs[i].label = " ";
                this.inputs[i].pos = [10, firstRowY + i * (THEME.rowHeight + THEME.rowGap)];
            }
        }
        if (this.outputs) {
            if (!isMultiMode) {
                if (this.outputs[0]) {
                    this.outputs[0].label = "Set Anything";
                    this.outputs[0].pos = [curW - 10, 17];
                }
            } else {
                for (let i = 0; i < this.outputs.length; i++) {
                    this.outputs[i].label = " ";
                    this.outputs[i].pos = [curW - 10, firstRowY + i * (THEME.rowHeight + THEME.rowGap)];
                }
            }
        }
    };

    // 动态增删端口 + 全拓扑连线迁移保护
    nodeType.prototype.onConnectionsChange = function (type, index, connected, link_info) {
        if (this._isSyncingSlots) return;
        if (type !== LiteGraph.INPUT) return;
        if (app.configuringGraph) return;

        this._isSyncingSlots = true;
        try {
            const totalInputs = this.inputs ? this.inputs.length : 0;

            if (connected) {
                if (index === totalInputs - 1 && totalInputs < 32) {
                    const nextIdx = totalInputs + 1;
                    this.addInput(`input_${nextIdx}`, "*");
                    if (isMultiMode) {
                        this.addOutput(`out_${nextIdx}`, "*");
                    }
                    const hasAnyOn = this._switchData.rows.some((r) => r.on);
                    this._switchData.rows.push({
                        title: "",
                        on: !hasAnyOn && !isMultiMode ? true : false,
                    });
                }
            } else {
                if (totalInputs > 1) {
                    const keptChannels = [];
                    for (let i = 0; i < totalInputs; i++) {
                        const inSlot = this.inputs[i];
                        if (inSlot && inSlot.link != null) {
                            const outTargets = [];
                            if (isMultiMode && this.outputs[i] && Array.isArray(this.outputs[i].links)) {
                                for (const linkId of this.outputs[i].links) {
                                    const linkObj = app.graph.links[linkId];
                                    if (linkObj) {
                                        const targetNode = app.graph.getNodeById(linkObj.target_id);
                                        if (targetNode) {
                                            outTargets.push({
                                                targetNode,
                                                targetSlot: linkObj.target_slot,
                                            });
                                        }
                                    }
                                }
                            }
                            keptChannels.push({
                                rowMeta: this._switchData.rows[i] || { title: "", on: false },
                                outTargets,
                            });
                        }
                    }

                    if (isMultiMode && this.outputs[index]) {
                        this.disconnectOutput(index);
                    }

                    for (let i = totalInputs - 1; i >= 0; i--) {
                        if (this.inputs[i].link == null) {
                            this.removeInput(i);
                            if (isMultiMode && this.outputs && i < this.outputs.length) {
                                this.removeOutput(i);
                            }
                        }
                    }

                    for (let i = 0; i < this.inputs.length; i++) {
                        this.inputs[i].name = `input_${i + 1}`;
                        if (isMultiMode && this.outputs[i]) {
                            this.outputs[i].name = `out_${i + 1}`;
                            const expectedTargets = keptChannels[i]?.outTargets || [];
                            for (const t of expectedTargets) {
                                const alreadyLinked =
                                    Array.isArray(this.outputs[i].links) &&
                                    this.outputs[i].links.some((lid) => {
                                        const l = app.graph.links[lid];
                                        return l && l.target_id === t.targetNode.id && l.target_slot === t.targetSlot;
                                    });
                                if (!alreadyLinked) {
                                    this.connect(i, t.targetNode, t.target_slot);
                                }
                            }
                        }
                    }

                    const tailIdx = this.inputs.length + 1;
                    this.addInput(`input_${tailIdx}`, "*");
                    if (isMultiMode) {
                        this.addOutput(`out_${tailIdx}`, "*");
                    }

                    const newRows = keptChannels.map((c) => c.rowMeta);
                    newRows.push({ title: "", on: false });

                    if (!isMultiMode && !newRows.some((r) => r.on) && newRows.length > 0) {
                        newRows[0].on = true;
                        this._switchData.active_slot = 1;
                    }

                    this._switchData.rows = newRows;
                }
            }

            this._syncWidgetValue();
            this._updateSlotPositions();
            app.graph.setDirtyCanvas(true, true);
        } finally {
            this._isSyncingSlots = false;
        }
    };

    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        if (origOnConfigure) origOnConfigure.apply(this, arguments);
        this._isSyncingSlots = true;
        try {
            this._stateWidget = hideDataWidget(this, "switch_state");
            if (this._stateWidget && this._stateWidget.value) {
                try {
                    const parsed = JSON.parse(this._stateWidget.value);
                    if (parsed && Array.isArray(parsed.rows)) {
                        this._switchData = parsed;
                    }
                } catch (e) {}
            }

            const desiredCount = Math.max(
                1,
                this._switchData.rows.length,
                info.inputs ? info.inputs.length : 1
            );

            while (this.inputs && this.inputs.length > desiredCount) {
                this.removeInput(this.inputs.length - 1);
            }
            while (this.inputs && this.inputs.length < desiredCount) {
                this.addInput(`input_${this.inputs.length + 1}`, "*");
            }

            if (isMultiMode) {
                while (this.outputs && this.outputs.length > desiredCount) {
                    this.removeOutput(this.outputs.length - 1);
                }
                while (this.outputs && this.outputs.length < desiredCount) {
                    this.addOutput(`out_${this.outputs.length + 1}`, "*");
                }
            } else {
                while (this.outputs && this.outputs.length > 1) {
                    this.removeOutput(this.outputs.length - 1);
                }
            }

            while (this._switchData.rows.length < desiredCount) {
                this._switchData.rows.push({ title: "", on: false });
            }

            this._syncWidgetValue();
            this._updateSlotPositions();
        } finally {
            this._isSyncingSlots = false;
        }
    };

    nodeType.prototype.onDrawForeground = function (ctx) {
        if (this.flags.collapsed) return;
        this._updateSlotPositions();
        if (this._syncInlineInputPos) this._syncInlineInputPos();

        const w = this.size[0];
        const rowCount = this.inputs ? this.inputs.length : 1;

        ctx.save();

        if (isMultiMode) {
            ctx.font = "11px Arial, Microsoft YaHei, sans-serif";
            ctx.fillStyle = "#969696";
            ctx.textAlign = "right";
            ctx.textBaseline = "middle";
            ctx.fillText("Set Anything", w - 18, 17);
        }

        this._hitBoxes = [];

        for (let i = 0; i < rowCount; i++) {
            if (!this._switchData.rows[i]) {
                this._switchData.rows[i] = { title: "", on: false };
            }
            const row = this._switchData.rows[i];
            const y = THEME.topBase + i * (THEME.rowHeight + THEME.rowGap);
            const h = THEME.rowHeight;

            const toggleW = 50;
            const rightMargin = isMultiMode ? 22 : 12;
            const toggleX = w - rightMargin - toggleW;
            const pillX = 20;
            const pillW = Math.max(50, toggleX - pillX - 7);

            const isEditingThisRow = this._editingKey === `row_${i}`;

            drawRoundedRect(
                ctx,
                pillX,
                y,
                pillW,
                h,
                h / 2,
                THEME.pillBg,
                isEditingThisRow ? THEME.cyanStrokeActive : THEME.pillStroke,
                THEME.strokeWidth
            );

            if (!isEditingThisRow) {
                ctx.font = "11.5px Microsoft YaHei, sans-serif";
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                const hasTitle = row.title && row.title.trim().length > 0;
                const displayTitle = hasTitle ? row.title : "这里支持输入自定义标题/注释...";
                ctx.fillStyle = hasTitle ? "#c8d0d4" : THEME.textMuted;
                ctx.fillText(fitText(ctx, displayTitle, pillW - 20), pillX + 10, y + h / 2);
            }

            this._hitBoxes.push({
                type: "title_pill",
                index: i,
                rect: { x: pillX, y, w: pillW, h },
            });

            const isOn = !!row.on;
            drawRoundedRect(
                ctx,
                toggleX,
                y,
                toggleW,
                h,
                h / 2,
                "#202020",
                isOn ? THEME.cyanStrokeActive : THEME.pillStroke,
                THEME.strokeWidth
            );

            const knobR = (h - 6) / 2;
            if (isOn) {
                ctx.font = "bold 10px Arial, sans-serif";
                ctx.fillStyle = "#e0e6ea";
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText("ON", toggleX + 8, y + h / 2 + 0.5);

                ctx.beginPath();
                ctx.arc(toggleX + toggleW - knobR - 3.5, y + h / 2, knobR, 0, Math.PI * 2);
                ctx.fillStyle = THEME.cyanBright;
                ctx.fill();
            } else {
                ctx.beginPath();
                ctx.arc(toggleX + knobR + 3.5, y + h / 2, knobR, 0, Math.PI * 2);
                ctx.fillStyle = "#484848";
                ctx.fill();

                ctx.font = "bold 10px Arial, sans-serif";
                ctx.fillStyle = THEME.textMuted;
                ctx.textAlign = "right";
                ctx.textBaseline = "middle";
                ctx.fillText("OFF", toggleX + toggleW - 6.5, y + h / 2 + 0.5);
            }

            this._hitBoxes.push({
                type: "toggle",
                index: i,
                rect: { x: toggleX, y, w: toggleW, h },
            });
        }

        ctx.restore();
    };

    nodeType.prototype.onMouseDown = function (e, localPos) {
        if (!this._hitBoxes || !localPos) return false;
        const [mx, my] = localPos;

        for (const box of this._hitBoxes) {
            const { x, y, w, h } = box.rect;
            if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
                const idx = box.index;
                if (!this._switchData.rows[idx]) {
                    this._switchData.rows[idx] = { title: "", on: false };
                }

                if (box.type === "toggle") {
                    if (!isMultiMode) {
                        const currentlyOn = !!this._switchData.rows[idx].on;
                        if (currentlyOn) {
                            this._switchData.rows[idx].on = false;
                            this._switchData.active_slot = 0;
                        } else {
                            for (let i = 0; i < this._switchData.rows.length; i++) {
                                this._switchData.rows[i].on = i === idx;
                            }
                            this._switchData.active_slot = idx + 1;
                        }
                    } else {
                        this._switchData.rows[idx].on = !this._switchData.rows[idx].on;
                    }
                    this._syncWidgetValue();
                    app.graph.setDirtyCanvas(true, true);
                    return true;
                }

                if (box.type === "title_pill") {
                    openInlineInput({
                        domEvent: e,
                        initialValue: this._switchData.rows[idx].title,
                        placeholder: "这里支持输入自定义标题/注释...",
                        rectInNode: box.rect,
                        node: this,
                        editKey: `row_${idx}`,
                        padLeft: 10,
                        fontSize: 11.5,
                        textColor: "#c8d0d4",
                        onLiveChange: (val) => {
                            this._switchData.rows[idx].title = val;
                        },
                        onCommit: (newVal) => {
                            this._switchData.rows[idx].title = newVal;
                            this._syncWidgetValue();
                        },
                    });
                    return true;
                }
            }
        }
        return false;
    };
}


// ============================================================================
// 分支 C：Crazy3DS AnySwitch 文本标签按钮
// ============================================================================
let GLOBAL_CACHED_PRESETS = null;
const ACTIVE_TAG_NODES = new Set();

// ==================== 按工作流隔离的标签数据 ====================
// workflow_key 存在 graph.extra 里，随工作流 JSON 一起保存/加载。
// 于是每个工作流对应一个独立文件：data/workflows/<workflow_key>.json，
// 新工作流会拿到全新 key，绝不会覆盖或串用其它工作流的内容。
function getCrazyWorkflowKey() {
    const g = app.graph;
    if (!g) return "default";
    if (!g.extra || typeof g.extra !== "object") g.extra = {};
    if (!g.extra.crazy3ds_workflow_id) {
        g.extra.crazy3ds_workflow_id =
            "wf" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }
    return g.extra.crazy3ds_workflow_id;
}

async function fetchWorkflowPresets() {
    try {
        const res = await api.fetchApi(
            `/crazy3ds/anyswitch/workflow/${encodeURIComponent(getCrazyWorkflowKey())}`
        );
        if (res.ok) return await res.json();
    } catch (e) {
        console.warn("[Crazy3DS_AnySwitch] 读取本工作流标签失败:", e);
    }
    return null;
}

function postWorkflowPresets(node) {
    try {
        const body = JSON.stringify({ node_id: String(node.id), data: node._tagData });
        return api.fetchApi(`/crazy3ds/anyswitch/workflow/${encodeURIComponent(getCrazyWorkflowKey())}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
        });
    } catch (e) {
        console.warn("[Crazy3DS_AnySwitch] 写入本工作流标签失败:", e);
        return Promise.resolve(null);
    }
}

// 编辑后防抖写盘，避免每次按键都打接口
function scheduleWorkflowPresetsSave(node, immediate = false) {
    if (node._wfSaveTimer) {
        clearTimeout(node._wfSaveTimer);
        node._wfSaveTimer = null;
    }
    if (immediate) {
        postWorkflowPresets(node);
        return;
    }
    node._wfSaveTimer = setTimeout(() => {
        node._wfSaveTimer = null;
        postWorkflowPresets(node);
    }, 700);
}

// 全局守护定时器：当切换工作流或节点脱离 Graph 时，确保没有任何孤儿 DOM 残留
setInterval(() => {
    for (const node of ACTIVE_TAG_NODES) {
        const isActive =
            node.graph && app.graph === node.graph && app.graph._nodes && app.graph._nodes.includes(node);
        if (!isActive && node._persistentTextarea) {
            node._persistentTextarea.style.display = "none";
        }
    }
}, 400);

// 旧版「全局预设」接口保持可用，但已不参与节点初始化，避免跨工作流串内容
async function fetchGlobalPresets() {
    try {
        const res = await api.fetchApi("/crazy3ds/anyswitch/presets");
        if (res.ok) {
            GLOBAL_CACHED_PRESETS = await res.json();
            return GLOBAL_CACHED_PRESETS;
        }
    } catch (e) {
        console.warn("[Crazy3DS_AnySwitch] 获取预设失败:", e);
    }
    return null;
}

async function saveGlobalPresets(data) {
    GLOBAL_CACHED_PRESETS = data;
    try {
        await api.fetchApi("/crazy3ds/anyswitch/presets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
    } catch (e) {
        console.warn("[Crazy3DS_AnySwitch] 保存预设失败:", e);
    }
}

function setupTagButtonsNode(nodeType) {
    const MIN_W = 240;

    nodeType.prototype.computeSize = function () {
        return [MIN_W, this._minRequiredHeight || 120];
    };

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);

        this.color = THEME.headerBg;
        this.bgcolor = THEME.nodeBg;
        this._tagWidget = hideDataWidget(this, "tag_state");

        this._deleteMode = false;
        this._expanded = false;
        this._editingKey = null;
        this._minRequiredHeight = 120;
        this._savedExpandedHeight = 290;
        this._feedbackMsg = "";
        this._feedbackTimer = null;

        this._tagData = {
            selected_index: 0,
            items: [
                {
                    title: "人像高清修复001",
                    content:
                        "Exact 1:1 color-faithful 8K upscale and high-frequency micro-texture restoration. Strictly lock the exact original image composition, pixel colors, flat even lighting, and neutral color profile with zero exposure shift, zero blown-out highlights, and zero added objects. Reconstruct only the existing materials in the frame with extreme optical clarity: natural microscopic surface relief, subtle organic cellular grain, realistic translucent subsurface scattering, clean smooth matte transitions without stray fibers, and crisp structural weave details. Uniform balanced luminance and unretouched medium-format DSLR raw optical sharpness.",
                },
                { title: "未命名", content: "1024" },
                { title: "常规按钮", content: "512 * 1.5" },
                { title: "未命名", content: "" },
                { title: "未命名", content: "" },
                { title: "常规按钮", content: "" },
                { title: "这是一个测试用超长标题名的按钮", content: "Masterpiece, best quality." },
            ],
        };

        ACTIVE_TAG_NODES.add(this);
        this._initPersistentTextarea();

        // 新节点：从「本工作流」专属文件里恢复内容（优先本节点 id 段，其次该工作流的最近一份）。
        // 延后一拍执行，等 ComfyUI 分配好 node.id；若期间工作流已把 tag_state 配进来，则不覆盖。
        setTimeout(() => {
            if (this._configuredFromWorkflow) return;
            fetchWorkflowPresets().then((wf) => {
                if (this._configuredFromWorkflow) return;
                const nodes = wf && wf.nodes && typeof wf.nodes === "object" ? wf.nodes : null;
                const mine = nodes ? nodes[String(this.id)] : null;
                const candidate = mine && Array.isArray(mine.items) ? mine : wf && wf.last;
                if (candidate && Array.isArray(candidate.items) && candidate.items.length > 0) {
                    this._tagData = JSON.parse(JSON.stringify(candidate));
                    this._refreshPersistentTextareaValue();
                    this._syncToWidget(false);
                    app.graph.setDirtyCanvas(true, true);
                }
            });
        }, 0);

        this.size = [380, 120];
        this._syncToWidget(false);
    };

    nodeType.prototype._initPersistentTextarea = function () {
        if (this._persistentTextarea) return;
        const ta = document.createElement("textarea");
        ta.className = "crazy3ds-persistent-textarea";
        ta.placeholder = "点击此处输入文本、整数、浮点数或数学函数（如 512 * 1.5）...";
        ta.spellcheck = false;
        ta.setAttribute("autocomplete", "off");
        ta.setAttribute("autocorrect", "off");
        ta.setAttribute("autocapitalize", "off");
        ta.style.display = "none";

        // 1. 滚轮阶梯接力：有内容可滚时优先滚内容，到顶或底（或内容未超出高度）时立即转发给画布执行缩放
        ta.addEventListener(
            "wheel",
            (e) => {
                const hasOverflow = ta.scrollHeight > ta.clientHeight + 1;
                if (hasOverflow && !e.ctrlKey) {
                    const canScrollUp = e.deltaY < 0 && ta.scrollTop > 0.5;
                    const canScrollDown =
                        e.deltaY > 0 && Math.ceil(ta.scrollTop + ta.clientHeight) < ta.scrollHeight - 1;

                    if (canScrollUp || canScrollDown) {
                        e.stopPropagation();
                        return;
                    }
                }
                e.preventDefault();
                e.stopPropagation();
                forwardWheelToCanvas(e);
            },
            { passive: false }
        );

        // 2. 鼠标按下智能区分“拖动画布”与“单击编辑”
        let dragState = null;

        ta.addEventListener("pointerdown", (e) => {
            const isFocused = document.activeElement === ta;
            const isMiddleBtn = e.button === 1;
            const isLeftBtn = e.button === 0;

            if (isFocused && isLeftBtn && !app.canvas?.space_pressed) {
                e.stopPropagation();
                return;
            }

            if (isLeftBtn || isMiddleBtn) {
                e.preventDefault();
                e.stopPropagation();
                dragState = {
                    startX: e.clientX,
                    startY: e.clientY,
                    lastX: e.clientX,
                    lastY: e.clientY,
                    button: e.button,
                    isDraggingCanvas: isMiddleBtn || !!app.canvas?.space_pressed,
                    pointerId: e.pointerId,
                };
                try {
                    ta.setPointerCapture(e.pointerId);
                } catch (_) {}
            }
        });

        ta.addEventListener("pointermove", (e) => {
            if (!dragState || e.pointerId !== dragState.pointerId) return;
            const dx = e.clientX - dragState.lastX;
            const dy = e.clientY - dragState.lastY;
            const totalDist = Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY);

            if (!dragState.isDraggingCanvas && totalDist > 4) {
                dragState.isDraggingCanvas = true;
                ta.style.cursor = "grabbing";
            }

            if (dragState.isDraggingCanvas && app.canvas) {
                e.preventDefault();
                e.stopPropagation();
                const scale = app.canvas.ds.scale || 1;
                app.canvas.ds.offset[0] += dx / scale;
                app.canvas.ds.offset[1] += dy / scale;
                app.canvas.setDirty(true, true);
                this._syncDOMRectNow();
            }

            dragState.lastX = e.clientX;
            dragState.lastY = e.clientY;
        });

        const endPointerGesture = (e) => {
            if (!dragState || e.pointerId !== dragState.pointerId) return;
            const state = dragState;
            dragState = null;
            ta.style.cursor = "text";
            try {
                ta.releasePointerCapture(state.pointerId);
            } catch (_) {}

            if (!state.isDraggingCanvas && state.button === 0) {
                ta.focus({ preventScroll: true });
            }
        };

        ta.addEventListener("pointerup", endPointerGesture);
        ta.addEventListener("pointercancel", () => {
            dragState = null;
            ta.style.cursor = "text";
        });

        ["mousedown", "mouseup", "click", "dblclick", "contextmenu"].forEach((evt) => {
            ta.addEventListener(evt, (e) => e.stopPropagation());
        });

        ta.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
                e.preventDefault();
                ta.blur();
            }
        });

        ta.addEventListener("input", () => {
            const selIdx = this._tagData.selected_index || 0;
            if (this._tagData.items[selIdx]) {
                this._tagData.items[selIdx].content = ta.value;
                this._syncToWidget();
            }
        });

        ta.addEventListener("blur", () => {
            this._syncToWidget();
            this._showFeedback("内容已同步到当前工作流");
        });

        this._outsidePointerListener = (ev) => {
            if (document.activeElement === ta && ev.target !== ta) {
                ta.blur();
            }
        };
        window.addEventListener("pointerdown", this._outsidePointerListener, true);

        document.body.appendChild(ta);
        this._persistentTextarea = ta;
        this._refreshPersistentTextareaValue();
    };

    nodeType.prototype._refreshPersistentTextareaValue = function () {
        if (!this._persistentTextarea) return;
        const selIdx = this._tagData.selected_index || 0;
        const val = this._tagData.items[selIdx]?.content ?? "";
        if (this._persistentTextarea.value !== val) {
            this._persistentTextarea.value = val;
        }
    };

    nodeType.prototype._syncDOMRectNow = function () {
        if (this._lastContentRect) {
            this._updatePersistentTextareaRect(this._lastContentRect, this._expanded);
        }
    };

    nodeType.prototype._updatePersistentTextareaRect = function (rectInNode, visible) {
        if (!this._persistentTextarea) return;
        const ta = this._persistentTextarea;
        this._lastContentRect = rectInNode;

        const isNodeActiveInGraph =
            this.graph && app.graph === this.graph && app.graph._nodes && app.graph._nodes.includes(this);

        if (!visible || !rectInNode || this.flags?.collapsed || !isNodeActiveInGraph) {
            if (ta.style.display !== "none") ta.style.display = "none";
            return;
        }

        const canvas = app.canvas;
        if (!canvas) return;
        const ds = canvas.ds;

        if (ds.scale < 0.25) {
            if (ta.style.display !== "none") ta.style.display = "none";
            return;
        }

        const canvasRect = canvas.canvas.getBoundingClientRect();
        const screenX = canvasRect.left + (this.pos[0] + rectInNode.x + ds.offset[0]) * ds.scale;
        const screenY = canvasRect.top + (this.pos[1] + rectInNode.y + ds.offset[1]) * ds.scale;

        if (ta.style.display === "none") {
            ta.style.display = "block";
            this._refreshPersistentTextareaValue();
        }

        ta.style.left = `${screenX}px`;
        ta.style.top = `${screenY}px`;
        ta.style.width = `${rectInNode.w}px`;
        ta.style.height = `${rectInNode.h}px`;
        ta.style.transform = `scale(${ds.scale})`;
    };

    const origOnRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
        ACTIVE_TAG_NODES.delete(this);
        if (this._wfSaveTimer) {
            clearTimeout(this._wfSaveTimer);
            this._wfSaveTimer = null;
        }
        if (this._outsidePointerListener) {
            window.removeEventListener("pointerdown", this._outsidePointerListener, true);
            this._outsidePointerListener = null;
        }
        if (this._persistentTextarea) {
            this._persistentTextarea.remove();
            this._persistentTextarea = null;
        }
        if (origOnRemoved) origOnRemoved.apply(this, arguments);
    };

    const origOnCollapse = nodeType.prototype.collapse;
    nodeType.prototype.collapse = function () {
        if (origOnCollapse) origOnCollapse.apply(this, arguments);
        if (this._persistentTextarea && this.flags?.collapsed) {
            this._persistentTextarea.style.display = "none";
        }
    };

    nodeType.prototype._showFeedback = function (msg) {
        this._feedbackMsg = msg;
        if (this._feedbackTimer) clearTimeout(this._feedbackTimer);
        this._feedbackTimer = setTimeout(() => {
            this._feedbackMsg = "";
            app.graph.setDirtyCanvas(true, true);
        }, 1200);
        app.graph.setDirtyCanvas(true, true);
    };

    // 把标签数据写进「当前工作流」的 widget 快照；
    // persist=true 时顺带防抖写入本工作流专属的 data/workflows/<key>.json。
    nodeType.prototype._syncToWidget = function (persist = true) {
        this._tagWidget = hideDataWidget(this, "tag_state");
        if (this._tagWidget) {
            this._tagWidget.value = JSON.stringify(this._tagData);
        }
        if (persist && this.graph) {
            scheduleWorkflowPresetsSave(this, false);
        }
    };

    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        if (origOnConfigure) origOnConfigure.apply(this, arguments);
        this._configuredFromWorkflow = true;
        this._tagWidget = hideDataWidget(this, "tag_state");
        if (this._tagWidget && this._tagWidget.value) {
            try {
                const parsed = JSON.parse(this._tagWidget.value);
                if (parsed && Array.isArray(parsed.items)) {
                    this._tagData = parsed;
                    this._refreshPersistentTextareaValue();
                }
            } catch (e) {}
        }
    };

    nodeType.prototype._computeFlexTagRows = function (ctx, containerX, startY, containerW) {
        const items = this._tagData.items || [];
        ctx.font = "11.5px Microsoft YaHei, sans-serif";
        const hGap = 6;
        const vGap = 6;
        const btnH = 22;
        const padX = 12;

        const measured = items.map((item, index) => {
            const title = item.title || "未命名";
            const textW = ctx.measureText(title).width;
            const naturalW = Math.min(containerW, Math.max(54, Math.ceil(textW + padX * 2)));
            return { index, title, naturalW };
        });

        const rows = [];
        let currentRow = [];
        let currentWidth = 0;

        for (const m of measured) {
            const needed = currentRow.length === 0 ? m.naturalW : currentWidth + hGap + m.naturalW;
            if (needed > containerW && currentRow.length > 0) {
                rows.push({ items: currentRow, rawWidth: currentWidth });
                currentRow = [m];
                currentWidth = m.naturalW;
            } else {
                currentRow.push(m);
                currentWidth = needed;
            }
        }
        if (currentRow.length > 0) {
            rows.push({ items: currentRow, rawWidth: currentWidth });
        }

        const boxes = [];
        let curY = startY;

        for (const row of rows) {
            const count = row.items.length;
            const totalGaps = (count - 1) * hGap;
            const naturalSum = Math.max(1, row.rawWidth - totalGaps);
            const extraSpace = Math.max(0, containerW - row.rawWidth);
            let curX = containerX;

            for (let i = 0; i < count; i++) {
                const item = row.items[i];
                const stretchedW =
                    i === count - 1
                        ? containerX + containerW - curX
                        : Math.floor(item.naturalW + extraSpace * (item.naturalW / naturalSum));

                boxes.push({
                    index: item.index,
                    title: item.title,
                    x: curX,
                    y: curY,
                    w: Math.max(36, stretchedW),
                    h: btnH,
                });
                curX += stretchedW + hGap;
            }
            curY += btnH + vGap;
        }

        return {
            boxes,
            nextY: curY,
        };
    };

    nodeType.prototype.onDrawForeground = function (ctx) {
        if (this.flags.collapsed) {
            this._updatePersistentTextareaRect(null, false);
            return;
        }
        if (this._syncInlineInputPos) this._syncInlineInputPos();

        const w = Math.max(MIN_W, this.size[0]);
        if (this.size[0] !== w) this.size[0] = w;

        ctx.save();
        this._hitBoxes = [];

        // 1. 标题栏右侧 [-] [+] 按钮组
        const btnSize = 15;
        const plusX = w - 22;
        const minusX = plusX - btnSize - 4;
        const headerBtnY = -22.5;

        drawRoundedRect(
            ctx,
            minusX,
            headerBtnY,
            btnSize,
            btnSize,
            2,
            this._deleteMode ? "#3a2020" : "#222222",
            this._deleteMode ? "#d9534f" : "#3d3d3d",
            1.0
        );
        ctx.strokeStyle = this._deleteMode ? "#ff6b6b" : THEME.cyanBright;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(minusX + 3.5, headerBtnY + btnSize / 2);
        ctx.lineTo(minusX + btnSize - 3.5, headerBtnY + btnSize / 2);
        ctx.stroke();

        this._hitBoxes.push({
            type: "btn_minus",
            rect: { x: minusX - 2, y: headerBtnY - 2, w: btnSize + 4, h: btnSize + 4 },
        });

        drawRoundedRect(ctx, plusX, headerBtnY, btnSize, btnSize, 2, "#222222", "#3d3d3d", 1.0);
        ctx.strokeStyle = THEME.cyanBright;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(plusX + 3.5, headerBtnY + btnSize / 2);
        ctx.lineTo(plusX + btnSize - 3.5, headerBtnY + btnSize / 2);
        ctx.moveTo(plusX + btnSize / 2, headerBtnY + 3.5);
        ctx.lineTo(plusX + btnSize / 2, headerBtnY + btnSize - 3.5);
        ctx.stroke();

        this._hitBoxes.push({
            type: "btn_plus",
            rect: { x: plusX - 2, y: headerBtnY - 2, w: btnSize + 4, h: btnSize + 4 },
        });

        // 2. 固定输出端口
        if (this.outputs && this.outputs[0]) {
            this.outputs[0].label = "Set Anything";
            this.outputs[0].pos = [w - 10, 16];
        }

        // 3. 流式胶囊标签区
        const padX = 12;
        const containerW = w - padX * 2;
        const tagStartY = 30;
        const layout = this._computeFlexTagRows(ctx, padX, tagStartY, containerW);
        const selectedIdx = this._tagData.selected_index || 0;

        for (const b of layout.boxes) {
            const isSelected = b.index === selectedIdx;
            drawRoundedRect(
                ctx,
                b.x,
                b.y,
                b.w,
                b.h,
                b.h / 2,
                isSelected ? THEME.cyanFillActive : THEME.pillBg,
                isSelected ? THEME.cyanStrokeActive : THEME.pillStroke,
                THEME.strokeWidth
            );

            ctx.font = isSelected ? "bold 11.5px Microsoft YaHei, sans-serif" : "11.5px Microsoft YaHei, sans-serif";
            ctx.fillStyle = isSelected ? "#071715" : "#888888";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(fitText(ctx, b.title, b.w - 14), b.x + b.w / 2, b.y + b.h / 2 + 0.5);

            this._hitBoxes.push({
                type: "tag_select",
                index: b.index,
                rect: { x: b.x, y: b.y, w: b.w, h: b.h },
            });

            if (this._deleteMode) {
                const delR = 6.5;
                const cx = b.x + b.w - 5;
                const cy = b.y + 3;

                ctx.beginPath();
                ctx.arc(cx, cy, delR, 0, Math.PI * 2);
                ctx.fillStyle = "#b53838";
                ctx.fill();

                ctx.font = "bold 9px Arial, sans-serif";
                ctx.fillStyle = "#ffffff";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("X", cx, cy + 0.5);

                this._hitBoxes.push({
                    type: "tag_delete_x",
                    index: b.index,
                    rect: { x: cx - delR - 3, y: cy - delR - 3, w: delR * 2 + 6, h: delR * 2 + 6 },
                });
            }
        }

        // 4. 折叠/展开控制条
        const toggleBarY = layout.nextY + 2;
        const triX = padX + 6;
        const triY = toggleBarY + 7;

        ctx.fillStyle = THEME.cyanBright;
        ctx.beginPath();
        if (!this._expanded) {
            ctx.moveTo(triX - 4.5, triY - 3);
            ctx.lineTo(triX + 4.5, triY - 3);
            ctx.lineTo(triX, triY + 4);
        } else {
            ctx.moveTo(triX - 4.5, triY + 3);
            ctx.lineTo(triX + 4.5, triY + 3);
            ctx.lineTo(triX, triY - 4);
        }
        ctx.closePath();
        ctx.fill();

        ctx.font = "11px Microsoft YaHei, sans-serif";
        ctx.fillStyle = "#707070";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const barText = this._expanded
            ? "点击折叠"
            : "点击展开 <预览/编辑> 当前选择具体内容...";
        ctx.fillText(fitText(ctx, barText, containerW - 24), triX + 11, triY);

        if (this._feedbackMsg) {
            ctx.fillStyle = THEME.cyanBright;
            ctx.textAlign = "right";
            ctx.fillText(this._feedbackMsg, w - padX, triY);
        }

        this._hitBoxes.push({
            type: "accordion_toggle",
            rect: { x: padX, y: toggleBarY - 2, w: containerW, h: 18 },
        });

        const collapsedHeight = toggleBarY + 20;

        if (!this._expanded) {
            this._minRequiredHeight = collapsedHeight;
            this.size[1] = collapsedHeight;
            this._updatePersistentTextareaRect(null, false);
            ctx.restore();
            return;
        }

        // 5. 展开面板绘制
        const dividerY = toggleBarY + 16;
        ctx.strokeStyle = "#363636";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(8, dividerY);
        ctx.lineTo(w - 8, dividerY);
        ctx.stroke();

        const currentItem = this._tagData.items[selectedIdx] || { title: "未命名", content: "" };
        const headerRowY = dividerY + 13;

        ctx.font = "11px Microsoft YaHei, sans-serif";
        ctx.textBaseline = "middle";

        const delBtnText = "删除此项/按钮";
        const delBtnW = ctx.measureText(delBtnText).width;
        const delBtnX = w - padX - delBtnW;

        const saveBtnText = "更新保存";
        const saveBtnW = ctx.measureText(saveBtnText).width;
        const saveBtnX = delBtnX - saveBtnW - 12;

        ctx.textAlign = "left";
        ctx.fillStyle = "#8a8a8a";
        ctx.fillText(saveBtnText, saveBtnX, headerRowY);
        this._hitBoxes.push({
            type: "save_current",
            rect: { x: saveBtnX - 4, y: headerRowY - 9, w: saveBtnW + 8, h: 18 },
        });

        ctx.fillStyle = "#808080";
        ctx.fillText(delBtnText, delBtnX, headerRowY);
        this._hitBoxes.push({
            type: "delete_current",
            rect: { x: delBtnX - 4, y: headerRowY - 9, w: delBtnW + 8, h: 18 },
        });

        // 左侧标题编辑区
        ctx.fillStyle = "#757575";
        ctx.fillText("标题名：", padX, headerRowY);

        const titleValX = padX + 44;
        const maxTitleW = Math.max(40, saveBtnX - titleValX - 10);
        const titleEditRect = { x: titleValX, y: headerRowY - 9, w: maxTitleW, h: 18 };

        if (this._editingKey !== "tag_title") {
            ctx.fillStyle = THEME.cyanBright;
            ctx.fillText(fitText(ctx, currentItem.title || "未命名", maxTitleW), titleValX, headerRowY);
        } else {
            ctx.strokeStyle = THEME.cyanStrokeActive;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(titleValX, headerRowY + 8);
            ctx.lineTo(titleValX + maxTitleW, headerRowY + 8);
            ctx.stroke();
        }

        this._hitBoxes.push({
            type: "edit_title",
            rect: titleEditRect,
        });

        // 多行正文框区域
        const contentTop = headerRowY + 13;
        const bottomFooterSpace = 28;
        const minContentH = 72;

        this._minRequiredHeight = contentTop + minContentH + bottomFooterSpace;
        const effectiveNodeH = Math.max(this._minRequiredHeight, this.size[1]);
        this.size[1] = effectiveNodeH;
        this._savedExpandedHeight = effectiveNodeH;

        const contentH = Math.max(minContentH, effectiveNodeH - contentTop - bottomFooterSpace);
        const contentRect = { x: padX, y: contentTop, w: containerW, h: contentH };

        this._updatePersistentTextareaRect(contentRect, true);

        // 右下角 [清空] [复制] 按钮（9px 精致小字）
        const bottomBarY = contentTop + contentH + 5;
        const smallBtnW = 32;
        const smallBtnH = 17;
        const copyX = w - padX - smallBtnW;
        const clearX = copyX - smallBtnW - 5;

        drawRoundedRect(ctx, clearX, bottomBarY, smallBtnW, smallBtnH, 2, "#333333", "#464646", 1.0);
        ctx.font = "9px Microsoft YaHei, sans-serif";
        ctx.fillStyle = "#c0c0c0";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("清空", clearX + smallBtnW / 2, bottomBarY + smallBtnH / 2 + 0.5);

        this._hitBoxes.push({
            type: "btn_clear",
            rect: { x: clearX, y: bottomBarY, w: smallBtnW, h: smallBtnH },
        });

        drawRoundedRect(ctx, copyX, bottomBarY, smallBtnW, smallBtnH, 2, "#333333", "#464646", 1.0);
        ctx.font = "9px Microsoft YaHei, sans-serif";
        ctx.fillStyle = "#c0c0c0";
        ctx.fillText("复制", copyX + smallBtnW / 2, bottomBarY + smallBtnH / 2 + 0.5);

        this._hitBoxes.push({
            type: "btn_copy",
            rect: { x: copyX, y: bottomBarY, w: smallBtnW, h: smallBtnH },
        });

        ctx.restore();
    };

    nodeType.prototype.onMouseDown = function (e, localPos) {
        if (!this._hitBoxes || !localPos) return false;
        const [mx, my] = localPos;

        const sortedBoxes = [...this._hitBoxes].sort((a, b) =>
            a.type === "tag_delete_x" ? -1 : b.type === "tag_delete_x" ? 1 : 0
        );

        for (const box of sortedBoxes) {
            const { x, y, w, h } = box.rect;
            if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
                const items = this._tagData.items;
                const selIdx = this._tagData.selected_index || 0;

                switch (box.type) {
                    case "btn_plus": {
                        items.push({ title: "未命名", content: "" });
                        this._tagData.selected_index = items.length - 1;
                        if (!this._expanded) {
                            this._expanded = true;
                            this.size[1] = Math.max(this._savedExpandedHeight || 290, 260);
                        }
                        this._refreshPersistentTextareaValue();
                        this._syncToWidget();
                        this._showFeedback("已新增标签");
                        return true;
                    }
                    case "btn_minus": {
                        this._deleteMode = !this._deleteMode;
                        app.graph.setDirtyCanvas(true, true);
                        return true;
                    }
                    case "tag_delete_x": {
                        if (items.length <= 1) {
                            this._showFeedback("至少保留 1 个标签");
                            return true;
                        }
                        items.splice(box.index, 1);
                        if (this._tagData.selected_index >= items.length) {
                            this._tagData.selected_index = Math.max(0, items.length - 1);
                        }
                        this._refreshPersistentTextareaValue();
                        this._syncToWidget();
                        this._showFeedback("已删除标签");
                        return true;
                    }
                    case "tag_select": {
                        this._tagData.selected_index = box.index;
                        this._refreshPersistentTextareaValue();
                        this._syncToWidget();
                        app.graph.setDirtyCanvas(true, true);
                        return true;
                    }
                    case "accordion_toggle": {
                        this._expanded = !this._expanded;
                        if (this._expanded) {
                            this.size[1] = Math.max(this._savedExpandedHeight || 290, this._minRequiredHeight + 130);
                        } else {
                            this.size[1] = this._minRequiredHeight;
                            this._updatePersistentTextareaRect(null, false);
                        }
                        app.graph.setDirtyCanvas(true, true);
                        return true;
                    }
                    case "edit_title": {
                        const cur = items[selIdx];
                        if (!cur) return true;
                        openInlineInput({
                            domEvent: e,
                            initialValue: cur.title,
                            placeholder: "输入按钮标题名...",
                            rectInNode: box.rect,
                            node: this,
                            editKey: "tag_title",
                            padLeft: 0,
                            fontSize: 11,
                            textColor: THEME.cyanBright,
                            onLiveChange: (val) => {
                                cur.title = val || "未命名";
                            },
                            onCommit: (val) => {
                                cur.title = val.trim() || "未命名";
                                this._syncToWidget();
                                this._showFeedback("标题已更新");
                            },
                        });
                        return true;
                    }
                    case "save_current": {
                        // 标题栏右侧的「更新保存」：立即把当前内容落盘到本工作流文件
                        this._syncToWidget(false);
                        scheduleWorkflowPresetsSave(this, true);
                        this._showFeedback("已保存到本工作流");
                        return true;
                    }
                    case "delete_current": {
                        if (items.length <= 1) {
                            this._showFeedback("至少保留 1 个标签");
                            return true;
                        }
                        items.splice(selIdx, 1);
                        this._tagData.selected_index = Math.max(0, selIdx - 1);
                        this._refreshPersistentTextareaValue();
                        this._syncToWidget();
                        this._showFeedback("已删除当前项");
                        return true;
                    }
                    case "btn_clear": {
                        if (items[selIdx]) {
                            items[selIdx].content = "";
                            this._refreshPersistentTextareaValue();
                            this._syncToWidget();
                            this._showFeedback("已清空内容");
                        }
                        return true;
                    }
                    case "btn_copy": {
                        const textToCopy = items[selIdx]?.content || "";
                        if (navigator.clipboard) {
                            navigator.clipboard.writeText(textToCopy);
                            this._showFeedback("已复制到剪贴板");
                        }
                        return true;
                    }
                }
            }
        }
        return false;
    };
}


// ==================== 注册 ComfyUI 前端扩展 ====================
app.registerExtension({
    name: "Crazy3DS.AnySwitch.Suite",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "Crazy3DS_AnySwitch_Single") {
            setupDynamicSwitchNode(nodeType, false);
        } else if (nodeData.name === "Crazy3DS_AnySwitch_Multi") {
            setupDynamicSwitchNode(nodeType, true);
        } else if (nodeData.name === "Crazy3DS_AnySwitch_TagButtons") {
            setupTagButtonsNode(nodeType);
        }
    },
});