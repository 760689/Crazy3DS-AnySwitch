# -*- coding: utf-8 -*-
"""
Crazy3DS AnySwitch 任意组出（分支 4 · 独立模块）

本文件与 nodes.py 中的「任意单出 / 任意多出 / 文本标签按钮」完全解耦：
- 不 import nodes.py，独立维护自己的类型代理与阻断逻辑；
- 单独修改本文件即可，不会影响另外三个节点；
- 前端对应文件为 js/crazy3ds_anyswitch_group.js。

功能语义：
    一个开关管一组，同时只允许一组 ON；
    组内每一行各自「左输入 → 右输出」独立贯通，行与行、组与组互不干扰。
"""

import json
import hashlib

try:
    from comfy_execution.graph import ExecutionBlocker
except ImportError:

    class ExecutionBlocker:
        def __init__(self, message):
            self.message = message


class GroupAnyType(str):
    """万能类型通配符代理，兼容 ComfyUI 前后端所有类型校验"""

    def __eq__(self, _):
        return True

    def __ne__(self, _):
        return False


ANY_TYPE = GroupAnyType("*")

MAX_DYNAMIC_SLOTS = 32

# 默认状态：一组、一行、默认开启
DEFAULT_GROUP_STATE = {"groups": [{"on": True, "rows": [{"title": ""}]}]}


def flatten_group_rows(state):
    """把分组状态压平成逐行列表，行序即为端口序：[(group_dict, gi, ri), ...]"""
    flat = []
    if not isinstance(state, dict):
        return flat
    groups = state.get("groups")
    if not isinstance(groups, list):
        return flat
    for gi, group in enumerate(groups):
        if not isinstance(group, dict):
            continue
        rows = group.get("rows")
        if not isinstance(rows, list) or not rows:
            rows = [{}]
        for ri in range(len(rows)):
            flat.append((group, gi, ri))
    return flat


def pass_none_instead_of_blocker(prompt, unique_id, slot_index_0_based, on_slots_set):
    """
    拓扑感知兜底：
    OFF 行的下游若是汇聚型多输入节点（且该节点仍有其它有效导通输入），
    则传 None 而不是 ExecutionBlocker，避免把整条下游分支连坐阻断；
    若下游只有这一路输入（如 PreviewImage/SaveImage），则传 ExecutionBlocker 静默终止。
    """
    if not prompt or not unique_id or not isinstance(prompt, dict):
        return False

    str_uid = str(unique_id)
    downstream_consumers = []

    try:
        for node_id, node_info in prompt.items():
            if str(node_id) == str_uid or not isinstance(node_info, dict):
                continue
            inputs = node_info.get("inputs", {})
            if not isinstance(inputs, dict):
                continue
            for _, inp_val in inputs.items():
                if isinstance(inp_val, list) and len(inp_val) == 2:
                    if str(inp_val[0]) == str_uid and int(inp_val[1]) == slot_index_0_based:
                        downstream_consumers.append((node_id, node_info))
    except (TypeError, ValueError):
        return False

    if not downstream_consumers:
        return False

    try:
        for _, consumer_info in downstream_consumers:
            inputs = consumer_info.get("inputs", {})
            if not isinstance(inputs, dict):
                continue
            other_active_links = 0
            for _, inp_val in inputs.items():
                if isinstance(inp_val, list) and len(inp_val) == 2:
                    src_id, src_slot = str(inp_val[0]), int(inp_val[1])
                    if src_id == str_uid:
                        if src_slot in on_slots_set:
                            other_active_links += 1
                    else:
                        other_active_links += 1
            if other_active_links > 0:
                return True
    except (TypeError, ValueError):
        return False

    return False


class Crazy3DS_AnySwitch_GroupButtons:
    """分支 4：任意组出 —— 同时只允许一组开启，组内每行各自「输入 → 输出」前后贯通"""

    @classmethod
    def INPUT_TYPES(cls):
        optional_inputs = {}
        for i in range(1, MAX_DYNAMIC_SLOTS + 1):
            optional_inputs[f"input_{i}"] = (ANY_TYPE, {"lazy": True})
        return {
            "required": {
                "group_state": (
                    "STRING",
                    {"default": json.dumps(DEFAULT_GROUP_STATE, ensure_ascii=False)},
                ),
            },
            "optional": optional_inputs,
            "hidden": {
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = tuple(ANY_TYPE for _ in range(MAX_DYNAMIC_SLOTS))
    RETURN_NAMES = tuple(f"out_{i}" for i in range(1, MAX_DYNAMIC_SLOTS + 1))
    FUNCTION = "execute"
    CATEGORY = "Crazy3DS/Switch"

    @classmethod
    def IS_CHANGED(cls, group_state, **kwargs):
        return hashlib.sha256(str(group_state).encode("utf-8")).hexdigest()

    @staticmethod
    def _parse_state(group_state):
        try:
            state = json.loads(group_state) if group_state else {}
        except Exception:
            state = {}
        return state if isinstance(state, dict) else {}

    def check_lazy_status(self, group_state, **kwargs):
        """只向上游索要当前 ON 组内各行所需的输入，其余通道零算力消耗"""
        flat = flatten_group_rows(self._parse_state(group_state))
        needed = []
        for idx, (group, _gi, _ri) in enumerate(flat):
            if not group.get("on", False):
                continue
            key = f"input_{idx + 1}"
            if key in kwargs and kwargs[key] is None:
                needed.append(key)
        return needed

    def execute(self, group_state, prompt=None, unique_id=None, **kwargs):
        flat = flatten_group_rows(self._parse_state(group_state))

        active_slots = set()
        for idx, (group, _gi, _ri) in enumerate(flat):
            if group.get("on", False) and kwargs.get(f"input_{idx + 1}") is not None:
                active_slots.add(idx)

        results = []
        for i in range(MAX_DYNAMIC_SLOTS):
            val = kwargs.get(f"input_{i + 1}", None)
            row_on = i < len(flat) and flat[i][0].get("on", False)

            if row_on and val is not None:
                results.append(val)
            elif pass_none_instead_of_blocker(prompt, unique_id, i, active_slots):
                results.append(None)
            else:
                results.append(ExecutionBlocker(None))

        return tuple(results)


NODE_CLASS_MAPPINGS = {
    "Crazy3DS_AnySwitch_GroupButtons": Crazy3DS_AnySwitch_GroupButtons,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Crazy3DS_AnySwitch_GroupButtons": "Crazy3DS AnySwitch 任意组出",
}
