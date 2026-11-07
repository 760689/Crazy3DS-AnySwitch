# 本包被拆成两个互不依赖的后端模块，便于单独修改：
#   nodes.py        —— 任意单出 / 任意多出 / 文本标签按钮
#   nodes_group.py  —— 任意组出（分支 4）
from .nodes import NODE_CLASS_MAPPINGS as _BASE_CLASS_MAPPINGS
from .nodes import NODE_DISPLAY_NAME_MAPPINGS as _BASE_DISPLAY_NAMES
from .nodes_group import NODE_CLASS_MAPPINGS as _GROUP_CLASS_MAPPINGS
from .nodes_group import NODE_DISPLAY_NAME_MAPPINGS as _GROUP_DISPLAY_NAMES

NODE_CLASS_MAPPINGS = {**_BASE_CLASS_MAPPINGS, **_GROUP_CLASS_MAPPINGS}
NODE_DISPLAY_NAME_MAPPINGS = {**_BASE_DISPLAY_NAMES, **_GROUP_DISPLAY_NAMES}

# 前端同样一分为二：
#   js/crazy3ds_anyswitch.js        —— 前三个节点
#   js/crazy3ds_anyswitch_group.js  —— 任意组出（分支 4）
WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
