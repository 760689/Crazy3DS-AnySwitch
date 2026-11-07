import os
import re
import json
import ast
import math
import hashlib
import operator
from aiohttp import web
from server import PromptServer

try:
    from comfy_execution.graph import ExecutionBlocker
except ImportError:
    class ExecutionBlocker:
        def __init__(self, message):
            self.message = message


class AlwaysEqualProxy(str):
    """万能类型通配符代理，兼容 ComfyUI 前后端所有类型校验"""
    def __eq__(self, _):
        return True

    def __ne__(self, _):
        return False


ANY_TYPE = AlwaysEqualProxy("*")
MAX_DYNAMIC_SLOTS = 32

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
PRESETS_FILE = os.path.join(DATA_DIR, "anyswitch_presets.json")

# ==================== 按工作流隔离的标签数据 ====================
# 每个工作流一份 JSON：data/workflows/<workflow_key>.json
# workflow_key 由前端在 graph.extra 中生成并随工作流 JSON 一起保存，
# 因此不同工作流天然互不覆盖，各自读取自己的文件。
WORKFLOW_DIR = os.path.join(DATA_DIR, "workflows")
WORKFLOW_KEY_RE = re.compile(r"[^A-Za-z0-9_-]")

DEFAULT_PRESETS = {
    "selected_index": 0,
    "items": [
        {
            "title": "人像高清修复001",
            "content": (
                "Exact 1:1 color-faithful 8K upscale and high-frequency micro-texture restoration. "
                "Strictly lock the exact original image composition, pixel colors, flat even lighting, "
                "and neutral color profile with zero exposure shift, zero blown-out highlights, and zero "
                "added objects. Reconstruct only the existing materials in the frame with extreme optical "
                "clarity: natural microscopic surface relief, subtle organic cellular grain, realistic "
                "translucent subsurface scattering, clean smooth matte transitions without stray fibers, "
                "and crisp structural weave details. Uniform balanced luminance and unretouched "
                "medium-format DSLR raw optical sharpness."
            ),
        },
        {"title": "未命名", "content": "1024"},
        {"title": "常规按钮", "content": "512 * 1.5"},
        {"title": "未命名", "content": ""},
        {"title": "未命名", "content": ""},
        {"title": "常规按钮", "content": ""},
        {
            "title": "这是一个测试用超长标题名的按钮",
            "content": "Masterpiece, ultra-detailed, photorealistic cinematic lighting.",
        },
    ],
}


def ensure_presets_file():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(PRESETS_FILE):
        with open(PRESETS_FILE, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_PRESETS, f, ensure_ascii=False, indent=2)


def load_presets_data():
    ensure_presets_file()
    try:
        with open(PRESETS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get("items"), list) and len(data["items"]) > 0:
                return data
    except Exception as e:
        print(f"[Crazy3DS_AnySwitch] 读取预设文件失败，回退至默认预设: {e}")
    return DEFAULT_PRESETS


def save_presets_data(data):
    ensure_presets_file()
    temp_file = PRESETS_FILE + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(temp_file, PRESETS_FILE)


# ==================== 按工作流隔离的读写实现 ====================
def sanitize_workflow_key(key):
    """工作流标识消毒：只保留安全字符，杜绝路径穿越"""
    cleaned = WORKFLOW_KEY_RE.sub("", str(key or ""))[:64]
    return cleaned or "default"


def workflow_presets_path(key):
    return os.path.join(WORKFLOW_DIR, f"{sanitize_workflow_key(key)}.json")


def load_workflow_presets(key):
    """读取某个工作流专属的标签文件；不存在时返回空骨架"""
    safe_key = sanitize_workflow_key(key)
    empty = {"workflow_key": safe_key, "nodes": {}, "last": None}
    path = workflow_presets_path(key)
    if not os.path.exists(path):
        return empty
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"[Crazy3DS_AnySwitch] 读取工作流标签文件失败，回退为空: {e}")
        return empty
    if not isinstance(data, dict):
        return empty
    if not isinstance(data.get("nodes"), dict):
        data["nodes"] = {}
    data.setdefault("workflow_key", safe_key)
    data.setdefault("last", None)
    return data


def save_workflow_node_presets(key, node_id, data):
    """
    读-改-写：只更新「本工作流」文件里该节点那一段。
    last 同步为最近一次内容，供同工作流内新建节点继承。
    """
    safe_key = sanitize_workflow_key(key)
    node_id = str(node_id)
    os.makedirs(WORKFLOW_DIR, exist_ok=True)
    path = workflow_presets_path(safe_key)

    store = load_workflow_presets(safe_key)
    store["workflow_key"] = safe_key
    store["nodes"][node_id] = data
    store["last"] = data

    temp_file = path + ".tmp"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)
    os.replace(temp_file, path)
    return path


# ==================== REST API 路由注册 ====================
@PromptServer.instance.routes.get("/crazy3ds/anyswitch/presets")
async def api_get_presets(request):
    return web.json_response(load_presets_data())


@PromptServer.instance.routes.post("/crazy3ds/anyswitch/presets")
async def api_save_presets(request):
    try:
        body = await request.json()
        if not isinstance(body, dict) or not isinstance(body.get("items"), list):
            return web.json_response({"status": "error", "message": "Invalid preset format"}, status=400)
        save_presets_data(body)
        return web.json_response({"status": "ok"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


@PromptServer.instance.routes.get("/crazy3ds/anyswitch/workflow/{key}")
async def api_get_workflow_presets(request):
    """读取指定工作流的标签数据（文件不存在时返回空骨架，前端会回退到默认值）"""
    key = request.match_info.get("key", "")
    try:
        return web.json_response(load_workflow_presets(key))
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


@PromptServer.instance.routes.post("/crazy3ds/anyswitch/workflow/{key}")
async def api_save_workflow_presets(request):
    """写入指定工作流中某个标签节点的数据，只动这一个文件"""
    key = request.match_info.get("key", "")
    try:
        body = await request.json()
        node_id = str(body.get("node_id", "0"))
        data = body.get("data")
        if not isinstance(data, dict):
            return web.json_response({"status": "error", "message": "Invalid data"}, status=400)

        path = save_workflow_node_presets(key, node_id, data)
        return web.json_response(
            {
                "status": "ok",
                "workflow_key": sanitize_workflow_key(key),
                "file": os.path.relpath(path, DATA_DIR).replace("\\", "/"),
            }
        )
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


# ==================== AST 安全数学解析器 ====================
SAFE_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

SAFE_FUNCTIONS = {
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    "int": int,
    "float": float,
    "pow": pow,
    "sqrt": math.sqrt,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "asin": math.asin,
    "acos": math.acos,
    "atan": math.atan,
    "ceil": math.ceil,
    "floor": math.floor,
    "log": math.log,
    "log10": math.log10,
    "exp": math.exp,
    "pi": math.pi,
    "e": math.e,
}


def _is_num(val):
    """严格判断是否为数值且排除 bool 子类陷阱"""
    return isinstance(val, (int, float)) and not isinstance(val, bool)


def _eval_ast_node(node):
    if isinstance(node, ast.Expression):
        return _eval_ast_node(node.body)
    elif isinstance(node, ast.Constant):
        if _is_num(node.value):
            return node.value
        raise ValueError("Unsupported constant")
    elif isinstance(node, ast.Num):  # 兼容旧版 AST 节点
        if _is_num(node.n):
            return node.n
        raise ValueError("Unsupported num")
    elif isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type not in SAFE_OPERATORS:
            raise ValueError(f"Unsupported operator: {op_type}")
        left = _eval_ast_node(node.left)
        right = _eval_ast_node(node.right)
        if op_type is ast.Pow and abs(right) > 1000:
            raise ValueError("Exponent too large")
        return SAFE_OPERATORS[op_type](left, right)
    elif isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type not in SAFE_OPERATORS:
            raise ValueError(f"Unsupported unary operator: {op_type}")
        return SAFE_OPERATORS[op_type](_eval_ast_node(node.operand))
    elif isinstance(node, ast.Name):
        if node.id in SAFE_FUNCTIONS and _is_num(SAFE_FUNCTIONS[node.id]):
            return SAFE_FUNCTIONS[node.id]
        raise ValueError(f"Unknown identifier: {node.id}")
    elif isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in SAFE_FUNCTIONS:
            raise ValueError("Unsupported function call")
        func = SAFE_FUNCTIONS[node.func.id]
        if not callable(func):
            raise ValueError("Identifier is not callable")
        args = [_eval_ast_node(arg) for arg in node.args]
        return func(*args)
    raise ValueError("Unsupported expression")


def parse_smart_value(raw_text: str):
    """
    智能解析输出内容：
    1. 纯整数 -> int
    2. 纯浮点数 -> float
    3. 数学函数/表达式 -> 计算结果 (int 或 float)
    4. 常规文本/Prompt -> str
    """
    if not isinstance(raw_text, str):
        return raw_text
    stripped = raw_text.strip()
    if not stripped:
        return ""

    # 1. 纯整数判断
    try:
        if stripped.isdigit() or (stripped.startswith(("+", "-")) and stripped[1:].isdigit()):
            return int(stripped)
    except Exception:
        pass

    # 2. 纯浮点数判断
    try:
        val = float(stripped)
        if not math.isnan(val) and not math.isinf(val):
            if "." in stripped or "e" in stripped.lower():
                return val
    except Exception:
        pass

    # 3. 安全数学表达式/函数求值（单行且长度合理时尝试）
    if "\n" not in stripped and len(stripped) <= 120:
        try:
            tree = ast.parse(stripped, mode="eval")
            result = _eval_ast_node(tree)
            if _is_num(result):
                if isinstance(result, float):
                    if math.isnan(result) or math.isinf(result):
                        return raw_text
                    if result.is_integer():
                        return int(result)
                return result
        except Exception:
            pass

    # 4. 默认返回原始字符串
    return raw_text


# ==================== 分支 1：Crazy3DS AnySwitch 任意单出 ====================
class Crazy3DS_AnySwitch_Single:
    @classmethod
    def INPUT_TYPES(cls):
        optional_inputs = {}
        for i in range(1, MAX_DYNAMIC_SLOTS + 1):
            optional_inputs[f"input_{i}"] = (ANY_TYPE, {"lazy": True})
        return {
            "required": {
                "switch_state": (
                    "STRING",
                    {"default": '{"active_slot": 1, "rows": [{"title": "", "on": true}]}'},
                ),
            },
            "optional": optional_inputs,
        }

    RETURN_TYPES = (ANY_TYPE,)
    RETURN_NAMES = ("Set Anything",)
    FUNCTION = "execute"
    CATEGORY = "Crazy3DS/Switch"

    @classmethod
    def IS_CHANGED(cls, switch_state, **kwargs):
        return hashlib.sha256(str(switch_state).encode("utf-8")).hexdigest()

    def check_lazy_status(self, switch_state, **kwargs):
        try:
            state = json.loads(switch_state)
        except Exception:
            state = {}

        rows = state.get("rows", [])
        active_idx = None
        for idx, row in enumerate(rows):
            if row.get("on", False):
                active_idx = idx + 1
                break

        # 如果没有任何一路处于 ON，不请求任何上游节点（零算力消耗）
        if active_idx is None:
            return []

        target_key = f"input_{active_idx}"
        if target_key in kwargs and kwargs[target_key] is None:
            return [target_key]
        return []

    def execute(self, switch_state, **kwargs):
        try:
            state = json.loads(switch_state)
        except Exception:
            state = {}

        rows = state.get("rows", [])
        active_idx = None
        for idx, row in enumerate(rows):
            if row.get("on", False):
                active_idx = idx + 1
                break

        if active_idx is not None:
            target_key = f"input_{active_idx}"
            if target_key in kwargs and kwargs[target_key] is not None:
                return (kwargs[target_key],)

        # 严格遵循开关状态：若全部为 OFF 或选中的通道未连接，静默阻断下游
        return (ExecutionBlocker(None),)


# ==================== 分支 2：Crazy3DS AnySwitch 任意多出 ====================
class Crazy3DS_AnySwitch_Multi:
    @classmethod
    def INPUT_TYPES(cls):
        optional_inputs = {}
        for i in range(1, MAX_DYNAMIC_SLOTS + 1):
            optional_inputs[f"input_{i}"] = (ANY_TYPE, {"lazy": True})
        return {
            "required": {
                "switch_state": ("STRING", {"default": '{"rows": [{"title": "", "on": true}]}'}),
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
    def IS_CHANGED(cls, switch_state, **kwargs):
        return hashlib.sha256(str(switch_state).encode("utf-8")).hexdigest()

    def check_lazy_status(self, switch_state, **kwargs):
        try:
            state = json.loads(switch_state)
        except Exception:
            state = {}

        rows = state.get("rows", [])
        needed = []
        for idx, row in enumerate(rows):
            if row.get("on", False):
                key = f"input_{idx + 1}"
                if key in kwargs and kwargs[key] is None:
                    needed.append(key)
        return needed

    @staticmethod
    def _should_pass_none_instead_of_blocker(prompt, unique_id, slot_index_0_based, on_slots_set):
        """
        核心拓扑感知逻辑：
        检查当前处于 OFF 的输出端口 `slot_index_0_based` 下游连接了哪些节点。
        如果下游节点是一个“汇聚型多输入节点”（如多图编辑节点），且该下游节点还连接了其他有效导通输入，
        则返回 True（传递 None 而非 ExecutionBlocker），保证多图编辑节点不会被连坐阻断！
        如果下游节点仅有这一个输入（如 PreviewImage）或所有输入全关，则返回 False（传递 ExecutionBlocker 静默终止）。
        """
        if not prompt or not unique_id:
            return False

        str_uid = str(unique_id)
        downstream_consumers = []

        for node_id, node_info in prompt.items():
            if str(node_id) == str_uid or not isinstance(node_info, dict):
                continue
            inputs = node_info.get("inputs", {})
            for _, inp_val in inputs.items():
                if isinstance(inp_val, list) and len(inp_val) == 2:
                    if str(inp_val[0]) == str_uid and int(inp_val[1]) == slot_index_0_based:
                        downstream_consumers.append((node_id, node_info))

        if not downstream_consumers:
            return False

        for _, consumer_info in downstream_consumers:
            inputs = consumer_info.get("inputs", {})
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

        return False

    def execute(self, switch_state, prompt=None, unique_id=None, **kwargs):
        try:
            state = json.loads(switch_state)
        except Exception:
            state = {}

        rows = state.get("rows", [])
        on_slots_set = set()
        for idx, row in enumerate(rows):
            if row.get("on", False) and kwargs.get(f"input_{idx + 1}") is not None:
                on_slots_set.add(idx)

        results = []
        for i in range(MAX_DYNAMIC_SLOTS):
            is_on = (i < len(rows)) and rows[i].get("on", False)
            val = kwargs.get(f"input_{i + 1}", None)

            if is_on and val is not None:
                results.append(val)
            else:
                if self._should_pass_none_instead_of_blocker(prompt, unique_id, i, on_slots_set):
                    results.append(None)
                else:
                    results.append(ExecutionBlocker(None))

        return tuple(results)


# ==================== 分支 3：Crazy3DS AnySwitch 文本标签按钮 ====================
class Crazy3DS_AnySwitch_TagButtons:
    @classmethod
    def INPUT_TYPES(cls):
        default_json = json.dumps(load_presets_data(), ensure_ascii=False)
        return {
            "required": {
                "tag_state": ("STRING", {"default": default_json}),
            }
        }

    RETURN_TYPES = (ANY_TYPE,)
    RETURN_NAMES = ("Set Anything",)
    FUNCTION = "execute"
    CATEGORY = "Crazy3DS/Switch"

    @classmethod
    def IS_CHANGED(cls, tag_state):
        return hashlib.sha256(str(tag_state).encode("utf-8")).hexdigest()

    def execute(self, tag_state):
        try:
            data = json.loads(tag_state) if tag_state else load_presets_data()
        except Exception:
            data = load_presets_data()

        items = data.get("items", [])
        selected_idx = int(data.get("selected_index", 0))

        if not items:
            return ("",)

        if selected_idx < 0 or selected_idx >= len(items):
            selected_idx = 0

        raw_content = items[selected_idx].get("content", "")
        parsed_output = parse_smart_value(raw_content)
        return (parsed_output,)


NODE_CLASS_MAPPINGS = {
    "Crazy3DS_AnySwitch_Single": Crazy3DS_AnySwitch_Single,
    "Crazy3DS_AnySwitch_Multi": Crazy3DS_AnySwitch_Multi,
    "Crazy3DS_AnySwitch_TagButtons": Crazy3DS_AnySwitch_TagButtons,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Crazy3DS_AnySwitch_Single": "Crazy3DS AnySwitch 任意单出",
    "Crazy3DS_AnySwitch_Multi": "Crazy3DS AnySwitch 任意多出",
    "Crazy3DS_AnySwitch_TagButtons": "Crazy3DS AnySwitch 文本标签按钮",
}