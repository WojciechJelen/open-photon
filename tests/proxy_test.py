import tempfile
import unittest

from aiohttp import FormData, web
from aiohttp.test_utils import TestClient, TestServer

from selfhost.proxy import create_app, public_origin


class OriginConfiguration(unittest.TestCase):
    def test_runpod_and_other_hosts(self):
        self.assertEqual(
            public_origin({"RUNPOD_POD_ID": "pod123"}).netloc,
            "pod123-8189.proxy.runpod.net",
        )
        self.assertEqual(
            public_origin({"PROXY_PUBLIC_URL": "https://gpu.example/"}).netloc,
            "gpu.example",
        )
        self.assertIsNone(public_origin({}))
        self.assertIsNone(
            public_origin({"RUNPOD_POD_ID": "pod123", "PROXY_HOST": "127.0.0.1"})
        )

    def test_invalid_origins_do_not_expose_values(self):
        for origin in [
            "ftp://host",
            "https://user:secret@host",
            "https://host/path",
            "https://host?secret",
            "https://host#secret",
            "https://host:bad",
        ]:
            with self.subTest(origin=origin), self.assertRaises(ValueError) as error:
                public_origin({"PROXY_PUBLIC_URL": origin})
            self.assertNotIn("secret", str(error.exception))
        with self.assertRaises(ValueError):
            public_origin({"RUNPOD_POD_ID": "../invalid"})
        with self.assertRaises(ValueError):
            create_app({})


class ProxyBehindGateway(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.jobs = {}

        async def prompt(request):
            job = (await request.json())["prompt_id"]
            self.jobs[job] = {
                "outputs": {
                    "1": {
                        "images": [
                            {
                                "filename": "output.png",
                                "subfolder": "",
                                "type": "output",
                            }
                        ]
                    }
                },
                "status": {"status_str": "success", "completed": True},
            }
            return web.json_response({"prompt_id": job})

        async def history(request):
            job = request.match_info["id"]
            return web.json_response({job: self.jobs[job]})

        async def upload(request):
            await request.post()
            return web.json_response(
                {"name": "input.png", "subfolder": "", "type": "input"}
            )

        upstream = web.Application()
        upstream.add_routes(
            [
                web.post("/prompt", prompt),
                web.get("/history/{id}", history),
                web.post("/upload/image", upload),
            ]
        )
        self.upstream = TestServer(upstream)
        await self.upstream.start_server()
        self.addAsyncCleanup(self.upstream.close)
        state = tempfile.TemporaryDirectory()
        self.addCleanup(state.cleanup)
        app = create_app(
            {
                "RUNPOD_POD_ID": "pod123",
                "PROXY_TOKEN": "test-token",
                "PROXY_STATE_DIR": state.name,
            },
            str(self.upstream.make_url("")),
        )
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        self.addAsyncCleanup(self.client.close)
        self.headers = {
            "Authorization": "Bearer test-token",
            "Host": "100.65.0.1:4567",
            "X-Forwarded-Host": "attacker.example",
            "X-Forwarded-Proto": "http",
        }
        self.base = "https://pod123-8189.proxy.runpod.net/api/v2/"

    async def test_asset_job_and_output_links_use_public_origin(self):
        form = FormData()
        form.add_field("content_type", "image/png")
        form.add_field("file_path", "input.png")
        form.add_field(
            "file", b"test input", filename="input.png", content_type="image/png"
        )
        response = await self.client.post(
            "/api/v2/assets", data=form, headers=self.headers
        )
        self.assertEqual(response.status, 201)
        asset = await response.json()
        self.assertTrue(asset["url"].startswith(self.base))
        response = await self.client.post(
            "/api/v2/jobs",
            json={"workflow": {"1": {"class_type": "EmptyImage", "inputs": {}}}},
            headers=self.headers,
        )
        self.assertEqual(response.status, 201)
        job = await response.json()
        self.assertTrue(all(url.startswith(self.base) for url in job["urls"].values()))
        response = await self.client.get(
            f"/api/v2/jobs/{job['id']}", headers=self.headers
        )
        job = await response.json()
        self.assertEqual(job["status"], "succeeded")
        self.assertTrue(job["outputs"][0]["url"].startswith(self.base))

    async def test_auth_and_cross_site_guard_remain_enabled(self):
        for headers in [{}, {"Authorization": "Bearer wrong"}]:
            response = await self.client.get("/api/v2/jobs", headers=headers)
            self.assertEqual(response.status, 401)
        response = await self.client.get(
            "/api/v2/jobs", headers={**self.headers, "Sec-Fetch-Site": "cross-site"}
        )
        self.assertEqual(response.status, 403)
        response = await self.client.get("/api/v2/health")
        self.assertEqual(response.status, 200)
