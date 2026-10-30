"""Sprite Forge: ComfyUI nodes that turn generated walk clips into engine-ready sprite atlases.

The nodes import ComfyUI's modules, so they load only when ComfyUI asks for them; the math
(`sprite_math`, `atlas`) imports without ComfyUI and is tested that way.
"""


async def comfy_entrypoint():
    from .nodes import SpriteForgeExtension

    return SpriteForgeExtension()
