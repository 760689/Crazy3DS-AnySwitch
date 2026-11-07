import { app } from "../../scripts/app.js";

// ============================================================================
// Crazy3DS AnySwitch 任意组出（分支 4 · 独立前端）
//   与 crazy3ds_anyswitch.js（单出/多出/文本标签按钮）完全解耦，
//   单独修改本文件即可，不会影响另外三个节点。
//
//   交互约定：
//   · 一个开关管一组，同时只允许一组 ON
//   · 组内每行各自「左输入 → 右输出」独立贯通
//   · 每组顶行尾部 + ：给本组增加一行；其余行尾部 − ：删除该行
//   · 组前 X ：删除整组。平时不显示，点标题栏 − 进入「删除组」模式后才出现
//   · 面板上每个可点区域都有鼠标悬停注释
// ============================================================================

const GROUP_THEME = {
    nodeBg: "#282828",
    headerBg: "#333333",
    border: "#3e3e3e",
    cyan: "#14857b",
    cyanBright: "#1ca89c",
    cyanStrokeActive: "#25b8ab",
    pillBg: "#222222",
    pillStroke: "#424242",
    textMuted: "#5e5e5e",
    textNormal: "#c8d0d4",
    strokeWidth: 1.0,
};

const GRP_ROW_H = 22;
const GRP_ROW_GAP = 5;
const GRP_GROUP_GAP = 14;
const GRP_TOP_BASE = 34;
const GRP_MIN_W = 180; // 允许缩到很窄，胶囊与符号始终保持不重叠
const GRP_MAX_ROWS = 32;

// 面板内所有「符号类」按钮（行尾 + / −、组前 X）共用同一套字体与颜色，
// 保证字号、字重、颜色三者永不分叉。
const GRP_SYMBOL_FONT = "bold 13px Arial, sans-serif";
const GRP_SYMBOL_COLOR = "#8a8a8a";
const GRP_SYMBOL_HOVER = "#e2e8ea";

// ==================== 本文件专属样式（独立 id，避免与另一文件互相覆盖） ====================
(function injectGroupStyles() {
    if (document.getElementById("crazy3ds-anyswitch-group-styles")) return;
    const style = document.createElement("style");
    style.id = "crazy3ds-anyswitch-group-styles";
    style.textContent = `
        .crazy3ds-group-inline {
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
            padding: 0;
        }
        .crazy3ds-group-inline::placeholder {
            color: #5e5e5e;
        }
    `;
    document.head.appendChild(style);
})();

// ==================== 基础工具 ====================
function grpDrawRoundedRect(ctx, x, y, w, h, r, fill, stroke, lineWidth = 1.0) {
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

function grpFitText(ctx, text, maxWidth) {
    if (!text || maxWidth <= 0) return "";
    if (ctx.measureText(text).width <= maxWidth) return text;
    const ellipsis = "...";
    let len = text.length;
    while (len > 0 && ctx.measureText(text.slice(0, len) + ellipsis).width > maxWidth) {
        len--;
    }
    return text.slice(0, len) + ellipsis;
}

function grpForwardWheelToCanvas(e) {
    const canvasEl = app.canvas?.canvas;
    if (!canvasEl) return;
    canvasEl.dispatchEvent(
        new WheelEvent("wheel", {
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
        })
    );
}

// 隐藏 group_state 数据 widget：只隐藏不改 type。
// 若改成 "converted-widget"，部分 ComfyUI 版本会认为「值由连线提供」而跳过序列化，
// 开关状态就传不到后端；这里显式 serialize=true 做双保险。
function hideGroupStateWidget(node) {
    const w = node.widgets ? node.widgets.find((x) => x.name === "group_state") : null;
    if (!w) return null;
    w.hidden = true;
    w.computeSize = () => [0, -4];
    w.draw = () => {};
    if (w.options && typeof w.options === "object") w.options.serialize = true;
    if (w.element) w.element.style.display = "none";
    return w;
}

// 画布内 1:1 缩放跟随的单行输入框（供行标题就地编辑）
function openGroupInlineInput({ domEvent, initialValue, placeholder, rectInNode, node, editKey, onLiveChange, onCommit }) {
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
    input.className = "crazy3ds-group-inline";
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
            padding: `0 10px`,
            color: "#c8d0d4",
            fontSize: `11.5px`,
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
        if (ev.target !== input) finish(true);
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
            grpForwardWheelToCanvas(e);
        },
        { passive: false }
    );

    document.body.appendChild(input);
    input.focus({ preventScroll: true });

    if (domEvent && typeof domEvent.clientX === "number") {
        const ds = app.canvas.ds;
        const canvasRect = app.canvas.canvas.getBoundingClientRect();
        const clickLocalX = (domEvent.clientX - canvasRect.left) / ds.scale - ds.offset[0] - node.pos[0] - rectInNode.x - 10;
        const ctx = app.canvas.ctx;
        if (ctx && input.value) {
            ctx.save();
            ctx.font = "11.5px Microsoft YaHei, sans-serif";
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

// ==================== 数据与布局 ====================
function grpGroups(node) {
    return node._groupData && Array.isArray(node._groupData.groups) ? node._groupData.groups : [];
}

function grpFlatRows(node) {
    const flat = [];
    grpGroups(node).forEach((group, gi) => {
        const rows = Array.isArray(group.rows) ? group.rows : [];
        rows.forEach((row, ri) => {
            flat.push({ gi, ri, row, group, uid: row.uid });
        });
    });
    return flat;
}

function grpLayout(node) {
    const rows = [];
    const dividers = [];
    let y = GRP_TOP_BASE;

    grpGroups(node).forEach((group, gi) => {
        if (gi > 0) {
            y += GRP_GROUP_GAP;
            // 分割线放在「上一行底边 → 下一行顶边」这段空隙的正中：
            // 上一行底部到本行顶部共 ROW_GAP + GROUP_GAP，取一半即真正居中。
            dividers.push({ gi, y: y - (GRP_ROW_GAP + GRP_GROUP_GAP) / 2 });
        }
        const groupRows = Array.isArray(group.rows) ? group.rows : [];
        groupRows.forEach((row, ri) => {
            rows.push({ gi, ri, row, group, y, uid: row.uid });
            y += GRP_ROW_H + GRP_ROW_GAP;
        });
    });

    const minH = GRP_TOP_BASE + GRP_ROW_H + GRP_ROW_GAP + 6;
    const height = Math.max(minH, y - GRP_ROW_GAP + 6);
    return { rows, dividers, height };
}

function setupGroupSwitchNode(nodeType) {
    const ROW_H = GRP_ROW_H;

    // ---------------- 状态维护 ----------------
    nodeType.prototype._grpEnsureUids = function () {
        let seq = this._uidSeq || 1;
        grpGroups(this).forEach((group) => {
            const rows = Array.isArray(group.rows) ? group.rows : [];
            rows.forEach((row) => {
                if (typeof row.uid !== "number") {
                    row.uid = seq++;
                } else {
                    seq = Math.max(seq, row.uid + 1);
                }
            });
        });
        this._uidSeq = seq;
    };

    nodeType.prototype._grpNewUid = function () {
        const uid = this._uidSeq || 1;
        this._uidSeq = uid + 1;
        return uid;
    };

    nodeType.prototype._grpSyncWidget = function () {
        this._stateWidget = hideGroupStateWidget(this);
        if (this._stateWidget) {
            this._stateWidget.value = JSON.stringify({
                groups: grpGroups(this).map((group) => ({
                    on: !!group.on,
                    rows: (Array.isArray(group.rows) ? group.rows : []).map((row) => ({
                        title: row.title || "",
                    })),
                })),
            });
        }
    };

    nodeType.prototype._grpShowFeedback = function (msg) {
        this._feedbackMsg = msg;
        if (this._feedbackTimer) clearTimeout(this._feedbackTimer);
        this._feedbackTimer = setTimeout(() => {
            this._feedbackMsg = "";
            if (app.graph) app.graph.setDirtyCanvas(true, true);
        }, 1400);
        app.graph.setDirtyCanvas(true, true);
    };

    // 结构变更前先收尾正在进行的标题编辑，避免浮窗挂到已删除/错位的行上
    nodeType.prototype._grpEndInlineEdit = function () {
        if (this._editingKey == null) return;
        const el = document.getElementById("crazy3ds-inline-input");
        if (el && typeof el._finishCleanup === "function") {
            try {
                el._finishCleanup(true);
            } catch (e) {}
        }
        this._editingKey = null;
    };

    // ---------------- 端口重建（保留全部前后连线） ----------------
    nodeType.prototype._grpSnapshotLinks = function () {
        const inputs = new Map();
        const outputs = new Map();
        if (!app.graph || !app.graph.links) return { inputs, outputs };
        const linkTable = app.graph.links;

        if (this.inputs) {
            for (let i = 0; i < this.inputs.length; i++) {
                const slot = this.inputs[i];
                if (!slot || slot._uid == null) continue;
                const linkId = slot.link;
                if (linkId == null) continue;
                const l = linkTable[linkId];
                if (l) {
                    inputs.set(slot._uid, { origin_id: l.origin_id, origin_slot: l.origin_slot });
                }
            }
        }

        if (this.outputs) {
            for (let i = 0; i < this.outputs.length; i++) {
                const slot = this.outputs[i];
                if (!slot || slot._uid == null) continue;
                const arr = [];
                if (Array.isArray(slot.links)) {
                    for (const lid of slot.links) {
                        const l = linkTable[lid];
                        if (l) arr.push({ target_id: l.target_id, target_slot: l.target_slot });
                    }
                }
                if (arr.length) outputs.set(slot._uid, arr);
            }
        }

        return { inputs, outputs };
    };

    nodeType.prototype._grpApplyPorts = function () {
        this._grpEndInlineEdit();
        this._hoverKey = null;
        this._hoverTip = null;
        const flat = grpFlatRows(this);
        const snap = this._grpSnapshotLinks();

        this._isSyncingSlots = true;
        try {
            while (this.inputs && this.inputs.length > 0) {
                this.removeInput(this.inputs.length - 1);
            }
            while (this.outputs && this.outputs.length > 0) {
                this.removeOutput(this.outputs.length - 1);
            }

            flat.forEach((entry, idx) => {
                this.addInput(`input_${idx + 1}`, "*");
                this.addOutput(`out_${idx + 1}`, "*");

                const inSlot = this.inputs[this.inputs.length - 1];
                const outSlot = this.outputs[this.outputs.length - 1];
                inSlot._uid = entry.uid;
                outSlot._uid = entry.uid;
                inSlot.label = " ";
                outSlot.label = " ";
            });

            // 按行 uid 回填前后连线：上端连回上游，下端连回全部下游
            flat.forEach((entry, idx) => {
                try {
                    const recIn = snap.inputs.get(entry.uid);
                    if (recIn && this.inputs[idx] && this.inputs[idx].link == null) {
                        const srcNode = app.graph.getNodeById(recIn.origin_id);
                        // 必须从上游输出侧发起：本节点同序号同时存在 in/out，
                        // 直接用 this.connect(idx, src, slot) 会被 litegraph 误判为输出连线。
                        if (srcNode && typeof srcNode.connect === "function") {
                            srcNode.connect(recIn.origin_slot, this, idx);
                        }
                    }
                } catch (err) {
                    console.warn("[Crazy3DS_AnySwitch_Group] 恢复上游连线失败:", err);
                }

                try {
                    const recOuts = snap.outputs.get(entry.uid);
                    if (recOuts) {
                        for (const rec of recOuts) {
                            const tgtNode = app.graph.getNodeById(rec.target_id);
                            if (tgtNode) this.connect(idx, tgtNode, rec.target_slot);
                        }
                    }
                } catch (err) {
                    console.warn("[Crazy3DS_AnySwitch_Group] 恢复下游连线失败:", err);
                }
            });
        } finally {
            this._isSyncingSlots = false;
        }

        // 行数变了：高度重新贴合内容
        this._grpFitHeight();
        app.graph.setDirtyCanvas(true, true);
    };

    // 只同步槽位坐标；尺寸采用「宽度可自由缩放、高度不小于内容」的策略
    nodeType.prototype._grpUpdatePositions = function () {
        const lay = grpLayout(this);
        const curW = Math.max(GRP_MIN_W, this.size ? this.size[0] : 340);
        const curH = this.size && this.size[1] ? this.size[1] : lay.height;
        this.size = [curW, Math.max(lay.height, curH)];

        lay.rows.forEach((entry, idx) => {
            const cy = entry.y + ROW_H / 2;
            const inSlot = this.inputs && this.inputs[idx];
            if (inSlot) {
                inSlot.label = " ";
                inSlot.pos = [10, cy];
            }
            const outSlot = this.outputs && this.outputs[idx];
            if (outSlot) {
                outSlot.label = " ";
                outSlot.pos = [curW - 10, cy];
            }
        });
    };

    // 结构变化后把高度收紧到内容高度（宽度保持用户设定）
    nodeType.prototype._grpFitHeight = function () {
        const lay = grpLayout(this);
        const curW = Math.max(GRP_MIN_W, this.size ? this.size[0] : 340);
        this.size = [curW, lay.height];
        this._grpUpdatePositions();
    };

    // 返回「最小尺寸」而不是「当前尺寸」，否则 litegraph 会把宽度下限一路抬高，
    // 表现为「只能拉大、缩不回去」。高度下限 = 内容所需高度，保证内容不被裁切。
    nodeType.prototype.computeSize = function () {
        return [GRP_MIN_W, grpLayout(this).height];
    };

    // ---------------- 生命周期 ----------------
    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        if (origOnNodeCreated) origOnNodeCreated.apply(this, arguments);

        this.color = GROUP_THEME.headerBg;
        this.bgcolor = GROUP_THEME.nodeBg;
        this._isSyncingSlots = false;
        this._editingKey = null;
        this._deleteMode = false;
        this._feedbackMsg = "";
        this._feedbackTimer = null;
        this._uidSeq = 2;
        this._hoverKey = null;
        this._hoverTip = null;
        this._hoverPos = null;

        // 默认：只有一组、只有一行，且该组默认 ON
        this._groupData = { groups: [{ on: true, rows: [{ title: "", uid: 1 }] }] };

        this._stateWidget = hideGroupStateWidget(this);
        this._grpApplyPorts();
        this._grpSyncWidget();
        this.size = [340, grpLayout(this).height];
    };

    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        if (origOnConfigure) origOnConfigure.apply(this, arguments);

        this._grpEndInlineEdit();
        this._isSyncingSlots = false;
        this._deleteMode = false;
        this._editingKey = null;
        this._uidSeq = 1;

        this._stateWidget = hideGroupStateWidget(this);
        if (this._stateWidget && this._stateWidget.value) {
            try {
                const parsed = JSON.parse(this._stateWidget.value);
                if (parsed && Array.isArray(parsed.groups) && parsed.groups.length > 0) {
                    this._groupData = {
                        groups: parsed.groups.map((g) => {
                            const rows = Array.isArray(g.rows) && g.rows.length > 0 ? g.rows : [{ title: "" }];
                            return {
                                on: !!g.on,
                                rows: rows.map((r) => ({
                                    title: typeof r.title === "string" ? r.title : "",
                                })),
                            };
                        }),
                    };
                }
            } catch (e) {}
        }

        if (!this._groupData) {
            this._groupData = { groups: [{ on: true, rows: [{ title: "" }] }] };
        }

        // 严格保证「同时只有一组 ON」
        let onSeen = false;
        grpGroups(this).forEach((g) => {
            if (g.on && !onSeen) onSeen = true;
            else g.on = false;
        });

        this._grpEnsureUids();

        const flat = grpFlatRows(this);
        const want = Math.max(1, flat.length);

        // 先按位置把已有端口绑定到行 uid，重建时连线才能对号入座
        if (this.inputs) {
            for (let i = 0; i < this.inputs.length; i++) {
                if (flat[i]) this.inputs[i]._uid = flat[i].uid;
            }
        }
        if (this.outputs) {
            for (let i = 0; i < this.outputs.length; i++) {
                if (flat[i]) this.outputs[i]._uid = flat[i].uid;
            }
        }

        const inCount = this.inputs ? this.inputs.length : 0;
        const outCount = this.outputs ? this.outputs.length : 0;

        if (inCount !== want || outCount !== want) {
            this._grpApplyPorts();
        } else {
            this._grpUpdatePositions();
        }

        this._grpSyncWidget();
    };

    const origOnRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
        this._grpEndInlineEdit();
        if (this._feedbackTimer) {
            clearTimeout(this._feedbackTimer);
            this._feedbackTimer = null;
        }
        if (origOnRemoved) origOnRemoved.apply(this, arguments);
    };

    // ---------------- 绘制 ----------------
    nodeType.prototype.onDrawForeground = function (ctx) {
        if (this.flags.collapsed) return;
        this._grpUpdatePositions();
        if (this._syncInlineInputPos) this._syncInlineInputPos();

        const w = this.size[0];
        const lay = grpLayout(this);

        ctx.save();
        this._hitBoxes = [];
        const hoverKey = this._hoverKey || null;

        // 1) 右上角标题 / 临时反馈
        ctx.font = "11px Arial, Microsoft YaHei, sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle = this._feedbackMsg ? GROUP_THEME.cyanBright : "#969696";
        ctx.fillText(this._feedbackMsg || "Set Anygroup", w - 14, 17);

        // 2) 标题栏右侧 [-] [+] ：删除组模式 / 新增一组
        const btnSize = 15;
        const plusX = w - 22;
        const minusX = plusX - btnSize - 4;
        const headerBtnY = -22.5;

        const minusKey = "grp_btn_minus";
        const plusKey = "grp_btn_plus";
        const minusHot = hoverKey === minusKey;
        const plusHot = hoverKey === plusKey;

        grpDrawRoundedRect(
            ctx,
            minusX,
            headerBtnY,
            btnSize,
            btnSize,
            2,
            this._deleteMode ? "#3a2020" : minusHot ? "#2c2c2c" : "#222222",
            this._deleteMode ? "#d9534f" : minusHot ? "#4d4d4d" : "#3d3d3d",
            1.0
        );
        ctx.strokeStyle = this._deleteMode ? "#ff6b6b" : minusHot ? "#e2e8ea" : GROUP_THEME.cyanBright;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(minusX + 3.5, headerBtnY + btnSize / 2);
        ctx.lineTo(minusX + btnSize - 3.5, headerBtnY + btnSize / 2);
        ctx.stroke();
        this._hitBoxes.push({
            type: "grp_btn_minus",
            key: minusKey,
            tooltip: this._deleteMode ? "退出「删除组」模式" : "进入「删除组」模式：各组前出现 X",
            rect: { x: minusX - 2, y: headerBtnY - 2, w: btnSize + 4, h: btnSize + 4 },
        });

        grpDrawRoundedRect(
            ctx,
            plusX,
            headerBtnY,
            btnSize,
            btnSize,
            2,
            plusHot ? "#2c2c2c" : "#222222",
            plusHot ? "#4d4d4d" : "#3d3d3d",
            1.0
        );
        ctx.strokeStyle = plusHot ? "#e2e8ea" : GROUP_THEME.cyanBright;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(plusX + 3.5, headerBtnY + btnSize / 2);
        ctx.lineTo(plusX + btnSize - 3.5, headerBtnY + btnSize / 2);
        ctx.moveTo(plusX + btnSize / 2, headerBtnY + 3.5);
        ctx.lineTo(plusX + btnSize / 2, headerBtnY + btnSize - 3.5);
        ctx.stroke();
        this._hitBoxes.push({
            type: "grp_btn_plus",
            key: plusKey,
            tooltip: "新增一组（默认只有一行）",
            rect: { x: plusX - 2, y: headerBtnY - 2, w: btnSize + 4, h: btnSize + 4 },
        });

        // 3) 组分割线（暗线 + 中央青色柔光带）；左侧留出 X 的位置
        for (const dv of lay.dividers) {
            ctx.strokeStyle = "#363636";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(30, dv.y + 0.5);
            ctx.lineTo(w - 6, dv.y + 0.5);
            ctx.stroke();

            const bandW = Math.min(230, Math.max(60, (w - 36) * 0.34));
            const bandX = Math.max(30, 30 + (w - 36 - bandW) / 2);
            const grad = ctx.createLinearGradient(bandX, 0, bandX + bandW, 0);
            grad.addColorStop(0, "rgba(28,168,156,0)");
            grad.addColorStop(0.3, "rgba(37,184,171,1)");
            grad.addColorStop(0.7, "rgba(37,184,171,1)");
            grad.addColorStop(1, "rgba(28,168,156,0)");
            ctx.fillStyle = grad;
            ctx.fillRect(bandX, dv.y - 0.5, bandW, 1.8);
        }

        // 4) 组删除 X：仅在「删除组」模式下出现，字符样式与行尾 +/− 完全同款
        if (this._deleteMode) {
            const groups = grpGroups(this);
            const xSpots = lay.dividers.map((dv) => ({ gi: dv.gi, group: groups[dv.gi], y: dv.y }));
            xSpots.push({ gi: 0, group: groups[0], y: GRP_TOP_BASE - 10 });

            for (const spot of xSpots) {
                const group = spot.group;
                if (!group) continue;

                const cx = 18;
                const cy = spot.y;
                const delKey = `grp_delete|${spot.gi}`;
                const hot = hoverKey === delKey;

                ctx.font = GRP_SYMBOL_FONT;
                ctx.fillStyle = hot ? GRP_SYMBOL_HOVER : GRP_SYMBOL_COLOR;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("×", cx, cy + 0.5);

                this._hitBoxes.push({
                    type: "grp_delete",
                    key: delKey,
                    tooltip: "删除这一组",
                    group: group,
                    rect: { x: cx - 9, y: cy - 9, w: 18, h: 18 },
                });
            }
        }

        // 5) 逐行绘制
        for (const entry of lay.rows) {
            const { gi, ri, row, group, y } = entry;
            const h = ROW_H;

            const pillX = 20;
            const toggleW = 50;
            const toggleX = w - 10 - 14 - toggleW;
            const symCx = toggleX - 13;
            const pillRight = symCx - 12;
            const pillW = Math.max(30, pillRight - pillX);
            const editKey = row.uid != null ? `r${row.uid}` : `g${gi}r${ri}`;
            const isEditing = this._editingKey === editKey;
            const titleKey = `grp_title|${gi}|${row.uid != null ? row.uid : ri}`;
            const titleHot = hoverKey === titleKey;

            // 行标题胶囊
            grpDrawRoundedRect(
                ctx,
                pillX,
                y,
                pillW,
                h,
                h / 2,
                titleHot ? "#262626" : GROUP_THEME.pillBg,
                isEditing ? GROUP_THEME.cyanStrokeActive : titleHot ? "#585858" : GROUP_THEME.pillStroke,
                GROUP_THEME.strokeWidth
            );

            if (!isEditing) {
                ctx.font = "11.5px Microsoft YaHei, sans-serif";
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                const hasTitle = row.title && row.title.trim().length > 0;
                const displayTitle = hasTitle ? row.title : "这里支持输入自定义标题/注释...";
                ctx.fillStyle = hasTitle ? GROUP_THEME.textNormal : GROUP_THEME.textMuted;
                ctx.fillText(grpFitText(ctx, displayTitle, pillW - 20), pillX + 10, y + h / 2 + 0.5);
            }

            this._hitBoxes.push({
                type: "grp_title",
                key: titleKey,
                tooltip: "点击编辑该行标题 / 注释",
                group: group,
                row: row,
                rect: { x: pillX, y, w: pillW, h },
            });

            // 行尾 + / − ：顶行为 +（本组加一行），其余为 −（删除本行）
            const symKey = ri === 0 ? `grp_row_add|${gi}` : `grp_row_del|${gi}|${row.uid != null ? row.uid : ri}`;
            const symHot = hoverKey === symKey;

            ctx.font = GRP_SYMBOL_FONT;
            ctx.fillStyle = symHot ? GRP_SYMBOL_HOVER : GRP_SYMBOL_COLOR;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(ri === 0 ? "+" : "−", symCx, y + h / 2 + 0.5);

            this._hitBoxes.push({
                type: ri === 0 ? "grp_row_add" : "grp_row_del",
                key: symKey,
                tooltip: ri === 0 ? "给本组增加一行" : "删除这一行",
                group: group,
                row: row,
                rect: { x: symCx - 8, y: y + 1, w: 16, h: h - 2 },
            });

            // 组开关（只画在每组首行）
            if (ri === 0) {
                const isOn = !!group.on;
                const toggleKey = `grp_toggle|${gi}`;
                const toggleHot = hoverKey === toggleKey;

                grpDrawRoundedRect(
                    ctx,
                    toggleX,
                    y,
                    toggleW,
                    h,
                    h / 2,
                    toggleHot ? "#262626" : "#202020",
                    isOn ? GROUP_THEME.cyanStrokeActive : toggleHot ? "#5f5f5f" : GROUP_THEME.pillStroke,
                    GROUP_THEME.strokeWidth
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
                    ctx.fillStyle = GROUP_THEME.cyanBright;
                    ctx.fill();
                } else {
                    ctx.beginPath();
                    ctx.arc(toggleX + knobR + 3.5, y + h / 2, knobR, 0, Math.PI * 2);
                    ctx.fillStyle = "#484848";
                    ctx.fill();

                    ctx.font = "bold 10px Arial, sans-serif";
                    ctx.fillStyle = GROUP_THEME.textMuted;
                    ctx.textAlign = "right";
                    ctx.textBaseline = "middle";
                    ctx.fillText("OFF", toggleX + toggleW - 6.5, y + h / 2 + 0.5);
                }

                this._hitBoxes.push({
                    type: "grp_toggle",
                    key: toggleKey,
                    tooltip: isOn ? "关闭本组（全部关闭后下游将停止）" : "开启本组（同时只允许一组开启）",
                    group: group,
                    rect: { x: toggleX, y, w: toggleW, h },
                });
            }
        }

        // 6) 悬停注释气泡（跟随鼠标，自动避开节点右侧与底部边界）
        if (this._hoverTip && this._hoverPos) {
            // 兜底：若画布鼠标已不在本节点内（某些版本不派发 onMouseLeave），直接不画
            const gm = app.canvas && app.canvas.graph_mouse;
            const outside =
                gm &&
                (gm[0] < this.pos[0] ||
                    gm[0] > this.pos[0] + w ||
                    gm[1] < this.pos[1] - 30 ||
                    gm[1] > this.pos[1] + this.size[1]);
            if (!outside) {
                const [hx, hy] = this._hoverPos;
                ctx.font = "11px Microsoft YaHei, sans-serif";
                const textW = ctx.measureText(this._hoverTip).width;
                const padX = 8;
                const tipW = Math.min(w - 8, textW + padX * 2);
                const tipH = 20;
                let tx = hx + 14;
                let ty = hy + 16;
                if (tx + tipW > w - 4) tx = hx - tipW - 14; // 右侧放不下就挪到光标左侧
                if (tx < 4) tx = 4;
                if (ty + tipH > this.size[1] - 4) ty = hy - tipH - 10; // 下方放不下就挪到上方

                grpDrawRoundedRect(ctx, tx, ty, tipW, tipH, 4, "rgba(16,16,16,0.96)", "#454545", 1.0);
                ctx.fillStyle = "#cfd5d8";
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText(grpFitText(ctx, this._hoverTip, tipW - padX * 2), tx + padX, ty + tipH / 2 + 0.5);
            }
        }

        ctx.restore();
    };

    // ---------------- 悬停注释 ----------------
    nodeType.prototype.onMouseMove = function (e, localPos) {
        if (!this._hitBoxes || !localPos) return false;
        const [mx, my] = localPos;

        let hit = null;
        for (const box of this._hitBoxes) {
            const { x, y, w, h } = box.rect;
            if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
                hit = box;
                break;
            }
        }

        this._hoverPos = [mx, my];

        const key = hit ? hit.key || hit.type : null;
        if (key !== this._hoverKey) {
            this._hoverKey = key;
            this._hoverTip = hit ? hit.tooltip || null : null;
            app.graph.setDirtyCanvas(true, true);
        }
        return false;
    };

    nodeType.prototype.onMouseLeave = function () {
        if (this._hoverKey !== null || this._hoverTip) {
            this._hoverKey = null;
            this._hoverTip = null;
            app.graph.setDirtyCanvas(true, true);
        }
    };

    // ---------------- 交互 ----------------
    nodeType.prototype.onMouseDown = function (e, localPos) {
        if (!this._hitBoxes || !localPos) return false;
        const [mx, my] = localPos;

        const priority = {
            grp_delete: 0,
            grp_toggle: 1,
            grp_row_add: 2,
            grp_row_del: 3,
            grp_title: 4,
            grp_btn_plus: 5,
            grp_btn_minus: 6,
        };

        const boxes = [...this._hitBoxes].sort((a, b) => (priority[a.type] ?? 9) - (priority[b.type] ?? 9));

        for (const box of boxes) {
            const { x, y, w, h } = box.rect;
            if (mx < x || mx > x + w || my < y || my > y + h) continue;

            const groups = grpGroups(this);
            // 命中框保存对象引用：即使上一次点击已改动结构、脏命中框尚未重绘，
            // 也不会因为索引漂移而误删别的行/组。
            const group = box.group && groups.indexOf(box.group) >= 0 ? box.group : null;
            const rowIndex = group && box.row && Array.isArray(group.rows) ? group.rows.indexOf(box.row) : -1;

            switch (box.type) {
                case "grp_btn_plus": {
                    if (grpFlatRows(this).length >= GRP_MAX_ROWS) {
                        this._grpShowFeedback(`已达 ${GRP_MAX_ROWS} 行上限`);
                        return true;
                    }
                    groups.push({ on: false, rows: [{ title: "", uid: this._grpNewUid() }] });
                    this._grpApplyPorts();
                    this._grpSyncWidget();
                    this._grpShowFeedback("已添加新组");
                    return true;
                }

                case "grp_btn_minus": {
                    this._deleteMode = !this._deleteMode;
                    app.graph.setDirtyCanvas(true, true);
                    return true;
                }

                case "grp_delete": {
                    if (!group) return true;
                    if (groups.length <= 1) {
                        this._grpShowFeedback("至少保留 1 组");
                        return true;
                    }
                    const idx = groups.indexOf(group);
                    const wasOn = !!group.on;
                    groups.splice(idx, 1);
                    if (wasOn) {
                        const nextIdx = Math.min(idx, groups.length - 1);
                        if (groups[nextIdx]) groups[nextIdx].on = true;
                    }
                    this._grpApplyPorts();
                    this._grpSyncWidget();
                    this._grpShowFeedback("已删除该组");
                    return true;
                }

                case "grp_toggle": {
                    if (!group) return true;
                    const turningOn = !group.on;
                    groups.forEach((g) => {
                        g.on = g === group ? turningOn : false;
                    });
                    this._grpSyncWidget();
                    app.graph.setDirtyCanvas(true, true);
                    return true;
                }

                case "grp_row_add": {
                    if (!group) return true;
                    if (grpFlatRows(this).length >= GRP_MAX_ROWS) {
                        this._grpShowFeedback(`已达 ${GRP_MAX_ROWS} 行上限`);
                        return true;
                    }
                    if (!Array.isArray(group.rows)) group.rows = [];
                    group.rows.push({ title: "", uid: this._grpNewUid() });
                    this._grpApplyPorts();
                    this._grpSyncWidget();
                    return true;
                }

                case "grp_row_del": {
                    if (!group || rowIndex < 0) return true;
                    if (group.rows.length <= 1) {
                        this._grpShowFeedback("每组至少保留 1 行");
                        return true;
                    }
                    group.rows.splice(rowIndex, 1);
                    this._grpApplyPorts();
                    this._grpSyncWidget();
                    return true;
                }

                case "grp_title": {
                    if (!group || rowIndex < 0) return true;
                    const row = group.rows[rowIndex];
                    openGroupInlineInput({
                        domEvent: e,
                        initialValue: row.title,
                        placeholder: "这里支持输入自定义标题/注释...",
                        rectInNode: box.rect,
                        node: this,
                        editKey: row.uid != null ? `r${row.uid}` : `g${groups.indexOf(group)}r${rowIndex}`,
                        onLiveChange: (val) => {
                            row.title = val;
                        },
                        onCommit: (val) => {
                            row.title = val;
                            this._grpSyncWidget();
                        },
                    });
                    return true;
                }
            }
        }

        return false;
    };
}

// ==================== 注册（独立扩展，不影响另一文件） ====================
app.registerExtension({
    name: "Crazy3DS.AnySwitch.Group",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "Crazy3DS_AnySwitch_GroupButtons") {
            setupGroupSwitchNode(nodeType);
        }
    },
});
