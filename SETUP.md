# Run Open Photon

Install Docker. Choose one backend and save its settings in a file named `.env`.
No repository clone, Node installation or local build is needed.

## Comfy Cloud

Create a [Comfy Cloud](https://cloud.comfy.org) API key with workflow access and credits:

```dotenv
COMFY_API_KEY=your-cloud-key
```

## Runpod

1. Deploy the [Open Photon template on Runpod](https://console.runpod.io/deploy?template=iqcvzqgt1q).
   Use an NVIDIA GPU with **32 GB VRAM or more** and a **CUDA 13-compatible driver**.
   Set `PROXY_TOKEN` to a long random secret. The template supplies the GPU image,
   port `8189` and persistent storage at `/workspace`.
2. Wait for `Serving the Comfy API v2` in the pod logs. The first boot downloads
   approximately 26 GB of models. Copy the pod ID and save:

   ```dotenv
   COMFY_BASE_URL=https://POD_ID-8189.proxy.runpod.net
   COMFY_PROXY_TOKEN=the-same-secret-as-PROXY_TOKEN
   ```

Leave `COMFY_API_KEY` unset for Runpod. Stop the pod when unused; terminate it to
remove its pod storage too. Separately created network volumes continue billing.

## Start the app — same image for both backends

```sh
docker run -d --name open-photon --init \
  --env-file .env \
  -p 127.0.0.1:3030:3000 \
  -v open-photon-data:/app/data \
  ghcr.io/wojciechjelen/open-photon:0.1.0
```

Open [localhost:3030](http://localhost:3030). Create an access code and enter it:

```sh
docker exec open-photon node scripts/mint-code.mjs me 100
```

`100` is that code's generation allowance. The volume keeps your results and access
codes across container replacement. Configuration details and development from source:
[deployment reference](docs/deployment.md).
