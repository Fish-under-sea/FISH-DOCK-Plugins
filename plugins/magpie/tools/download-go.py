# Go 1.26.8 工具链下载（断点续传）。本机 Schannel 坏，禁 curl/IWR；只用 Python OpenSSL。
import os
import sys
import time
import urllib.request

DST = r"D:\Fish-code\DSH-NEXT\插件\插件创作\.work\magpie-build\tools\go1.26.8.windows-amd64.zip"
SIZE = 74957586
SOURCES = [
    "https://mirrors.ustc.edu.cn/golang/go1.26.8.windows-amd64.zip",
    "https://mirrors.aliyun.com/golang/go1.26.8.windows-amd64.zip",
    "https://golang.google.cn/dl/go1.26.8.windows-amd64.zip",
    "https://go.dev/dl/go1.26.8.windows-amd64.zip",
]

os.makedirs(os.path.dirname(DST), exist_ok=True)


def have():
    return os.path.getsize(DST) if os.path.exists(DST) else 0


deadline = time.time() + 900  # 15 分钟内尽力完成
while have() < SIZE and time.time() < deadline:
    for url in SOURCES:
        if have() >= SIZE:
            break
        offset = have()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "magpie-build/1.0", "Range": "bytes=%d-" % offset})
            with urllib.request.urlopen(req, timeout=60) as r, open(DST, "ab") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
                    if have() % (10 << 20) < (1 << 20):
                        print("%.1f%% %d/%d  %s" % (have() * 100.0 / SIZE, have(), SIZE, url.split("/")[2]), flush=True)
        except Exception as exc:  # 换下一个源继续续传
            print("source fail %s: %s (%d bytes so far)" % (url.split("/")[2], type(exc).__name__, have()), flush=True)

n = have()
print("FINAL %d / %d bytes (%.1f%%)" % (n, SIZE, n * 100.0 / SIZE), flush=True)
if n != SIZE:
    sys.exit(2)
