import requests
import time
import random
import threading

API_URL = "https://dienlanhquangphat.vn/toolvip"
WSOL = "So11111111111111111111111111111111111111112"
WORKER_ID = "webcon_python"
BATCH_SIZE = 5
DELAY_SECONDS = 2.4
RPC_URLS = []

# ===== Load RPC list =====
def load_rpc_urls():
    global RPC_URLS
    with open("apikeys.txt", "r") as f:
        RPC_URLS = [line.strip() for line in f if line.strip()]
    if not RPC_URLS:
        print("❌ Không có RPC nào trong apikeys.txt")
        exit(1)

# ===== Gọi RPC JSON =====
def call_rpc(method, params, rpc):
    try:
        res = requests.post(rpc, json={
            "jsonrpc": "2.0", "id": 1, "method": method, "params": params
        }, timeout=10)
        return res.json()
    except:
        return None

# ===== Lấy giá token =====
def get_price_from_pool(mint, rpc):
    try:
        res1 = call_rpc("getTokenLargestAccounts", [mint], rpc)
        if not res1 or not res1.get("result", {}).get("value"):
            print(f"⚠️ [{mint}] Không có token account lớn nào.")
            return None

        token_acc = res1["result"]["value"][0]["address"]
        res2 = call_rpc("getAccountInfo", [token_acc, {"encoding": "jsonParsed"}], rpc)
        parsed = res2["result"]["value"]["data"]["parsed"]["info"]
        owner = parsed.get("owner")
        token_amt = float(parsed.get("tokenAmount", {}).get("uiAmount", 0))

        if not owner or token_amt == 0:
            print(f"⚠️ [{mint}] Không có owner hoặc token amount = 0")
            return None

        res3 = call_rpc("getTokenAccountsByOwner", [owner, {"mint": WSOL}, {"encoding": "jsonParsed"}], rpc)
        if not res3 or not res3.get("result", {}).get("value"):
            print(f"⚠️ [{mint}] Không tìm thấy WSOL account của owner")
            return None

        wsol_acc = res3["result"]["value"][0]["pubkey"]
        res4 = call_rpc("getTokenAccountBalance", [wsol_acc], rpc)
        wsol_amt = float(res4["result"]["value"].get("uiAmount", 0))

        if wsol_amt == 0:
            print(f"⚠️ [{mint}] WSOL amount = 0")
            return None

        price = round(wsol_amt / token_amt, 12)
        print(f"✅ [{mint}] Giá = {price} SOL")
        return price
    except Exception as e:
        print(f"❌ [{mint}] Lỗi khi lấy giá: {e}")
        return None

# ===== Lấy token batch =====
def assign_batch():
    try:
        res = requests.get(f"{API_URL}/assign-token.php?worker={WORKER_ID}&count={BATCH_SIZE}", verify=False)
        return res.json() if res.status_code == 200 else []
    except:
        return []

# ===== Gửi kết quả =====
def send_results(results):
    try:
        requests.post(f"{API_URL}/update-token.php", json=results, verify=False)
        print(f"📤 Gửi {len(results)} token thành công")
    except:
        print("❌ Gửi dữ liệu thất bại")

# ===== Vòng lặp chính =====
def worker_loop():
    while True:
        tokens = assign_batch()
        if not tokens:
            time.sleep(2)
            continue

        results = []
        for token in tokens:
            mint = token["mint"]
            rpc = random.choice(RPC_URLS)
            price = get_price_from_pool(mint, rpc)
            if price:
                results.append({
                    "mint": mint,
                    "price": price,
                    "timestamp": int(time.time()),
                    "index": token.get("index")
                })
            time.sleep(DELAY_SECONDS)

        if results:
            send_results(results)
        time.sleep(0.5)

if __name__ == "__main__":
    load_rpc_urls()
    print(f"🚀 Worker {WORKER_ID} khởi động với {len(RPC_URLS)} RPC")
    threading.Thread(target=worker_loop).start()
