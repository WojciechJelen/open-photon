"""Submits an API graph to a local ComfyUI (:8288), waits, prints each node's UI output.

    python3 src/features/spriteForge/prototype/run_local.py <graph.json>
"""

import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8288"
graph = json.load(open(sys.argv[1]))
request = urllib.request.Request(
    f"{BASE}/prompt",
    data=json.dumps({"prompt": graph}).encode(),
    headers={"Content-Type": "application/json"},
)
try:
    prompt_id = json.load(urllib.request.urlopen(request))["prompt_id"]
except urllib.error.HTTPError as error:
    print(error.read().decode())
    sys.exit(1)
started = time.time()
while True:
    history = json.load(urllib.request.urlopen(f"{BASE}/history/{prompt_id}"))
    if prompt_id in history:
        break
    time.sleep(0.5)
entry = history[prompt_id]
print(f"{entry['status']['status_str']} in {time.time() - started:.1f}s (prompt {prompt_id})")
for message in entry["status"].get("messages", []):
    if message[0] == "execution_error":
        print(json.dumps(message[1], indent=2)[:3000])
for node, output in entry.get("outputs", {}).items():
    print(node, graph[node]["class_type"], json.dumps(output)[:400])
