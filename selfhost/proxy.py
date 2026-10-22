"""Serve the upstream proxy with a fixed public origin behind a TLS gateway."""

import os
import re
from urllib.parse import urlsplit

from aiohttp import web
from comfy_api_proxy.app import make_app
from comfy_api_proxy.auth import make_bearer_auth_middleware
from comfy_api_proxy.middleware import make_origin_only_middleware


def public_origin(env):
    origin = env.get("PROXY_PUBLIC_URL", "").strip()
    pod_id = env.get("RUNPOD_POD_ID", "")
    if not origin and pod_id and env.get("PROXY_HOST", "0.0.0.0") != "127.0.0.1":
        if not re.fullmatch(r"[a-z0-9]+", pod_id):
            raise ValueError("Invalid RUNPOD_POD_ID")
        origin = f"https://{pod_id}-8189.proxy.runpod.net"
    if not origin:
        return None
    try:
        url = urlsplit(origin)
        valid = (
            url.scheme in ("http", "https")
            and url.hostname
            and not re.search(r"[\s\\]", url.netloc)
            and url.username is None
            and url.password is None
            and url.path in ("", "/")
            and not url.query
            and not url.fragment
            and not any(char in origin for char in "?#\r\n")
        )
        url.port
    except ValueError:
        valid = False
    if not valid:
        raise ValueError(
            "PROXY_PUBLIC_URL must be an HTTP(S) origin without credentials or a path"
        )
    return url


def create_app(env, comfyui_url="http://127.0.0.1:8188"):
    token = env.get("PROXY_TOKEN", "")
    if not token and env.get("PROXY_HOST", "0.0.0.0") != "127.0.0.1":
        raise ValueError("PROXY_TOKEN is required unless PROXY_HOST=127.0.0.1")
    origin = public_origin(env)

    @web.middleware
    async def external_origin(request, handler):
        # Use deployment configuration, never client-supplied forwarded headers.
        if origin:
            request = request.clone(scheme=origin.scheme, host=origin.netloc)
        return await handler(request)

    middlewares = [external_origin, make_origin_only_middleware()]
    if token:
        middlewares.append(make_bearer_auth_middleware(token))
    app = make_app(
        comfyui_url,
        comfyui_base_dir="/opt/ComfyUI",
        max_upload_bytes=int(env.get("MAX_UPLOAD_MB", "128")) * 1024 * 1024,
        state_dir=env.get("PROXY_STATE_DIR", "/workspace/comfy-api-proxy"),
        middlewares=middlewares,
    )

    # A CDN can turn a cold HEAD into GET before deciding whether to cache it.
    # Reuse the upstream hash probe, including its validation and auth middleware.
    probe = next(
        route
        for route in app.router.routes()
        if route.method == "HEAD"
        and route.resource.canonical == "/api/v2/assets/by-hash/{hash}"
    )
    app.router.add_get(probe.resource.canonical, probe.handler, allow_head=False)

    async def no_cache(request, response):
        response.headers["Cache-Control"] = "private, no-store"

    app.on_response_prepare.append(no_cache)
    return app


if __name__ == "__main__":
    web.run_app(
        create_app(os.environ), host=os.environ.get("PROXY_HOST", "0.0.0.0"), port=8189
    )
