const express = require("express");
const fetch = require("node-fetch");
const https = require("https");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const WORKER_ID = process.env.WORKER || "webcon_006";
const SERVER_URL = "https://dienlanhquangphat.vn/toolvip";
const agent = new https.Agent({ rejectUnauthorized: false });

const WSOL = "So11111111111111111111111111111111111111112";
const DELAY_MS = 2400;
const ROUND_DELAY_MS = 500;
const BATCH_SIZE = 5;
const TOKEN_TIMEOUT = 6000;

let rpcUrls = [];

function loadRpcUrls() {
  try {
    const raw = fs.readFileSync("apikeys.txt", "utf-8");
    rpcUrls = raw.trim().split("\n").filter(Boolean);
    if (rpcUrls.length === 0) throw new Error("Không có RPC nào trong file.");
  } catch (e) {
    console.error("❌ Không thể đọc apikeys.txt:", e.message);
    process.exit(1);
  }
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function fetchWithTimeout(url, options = {}, timeout = TOKEN_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  options.signal = controller.signal;
  try {
    const res = await fetch(url, options);
    clearTimeout(id);
    return res;
  } catch {
    clearTimeout(id);
    return null;
  }
}

async function callRpc(rpcUrl, method, params) {
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetchWithTimeout(rpcUrl, options);
    await delay(500);
    if (response) {
      try {
        return await response.json();
      } catch {}
    }
    await delay(1000);
  }
  return null;
}

async function getTokenPriceAndInfo(mint, rpcUrl) {
  try {
    const largest = await callRpc(rpcUrl, "getTokenLargestAccounts", [mint]);
    if (!largest?.result?.value?.length) return null;

    const tokenAccount = largest.result.value[0].address;
    const accountInfo = await callRpc(rpcUrl, "getAccountInfo", [tokenAccount, { encoding: "jsonParsed" }]);
    const parsedInfo = accountInfo?.result?.value?.data?.parsed?.info;
    const owner = parsedInfo?.owner;
    const tokenAmount = parseFloat(parsedInfo?.tokenAmount?.uiAmount || 0);
    if (!owner || tokenAmount === 0) return null;

    const wsolAccounts = await callRpc(rpcUrl, "getTokenAccountsByOwner", [owner, { mint: WSOL }, { encoding: "jsonParsed" }]);
    const wsolAmount = parseFloat(
      wsolAccounts?.result?.value?.[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0
    );

    if (wsolAmount === 0) return "NO_POOL";

    const supplyInfo = await callRpc(rpcUrl, "getTokenSupply", [mint]);
    const supply = supplyInfo?.result?.value?.uiAmount ?? 0;
    const topHolders = largest.result.value.slice(0, 10).map(acc => ({
      address: acc.address,
      amount: parseFloat(acc.uiAmountString || "0")
    }));

    return {
      mint,
      price: +(wsolAmount / tokenAmount).toFixed(9),
      unit: "WSOL",
      supply,
      poolAddress: tokenAccount,
      topHolders,
      timestamp: Math.floor(Date.now() / 1000)
    };
  } catch {
    return null;
  }
}

async function assignBatchTokens(batchSize) {
  try {
    const res = await fetch(`${SERVER_URL}/assign-token.php?worker=${WORKER_ID}&count=${batchSize}`, { agent });
    if (res.status === 204) return [];
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data && data.mint) return [data];
    return [];
  } catch (err) {
    console.error("❌ Gọi assign-token thất bại:", err.message);
    return [];
  }
}

async function sendResults(results) {
  if (!results.length) return;
  try {
    await fetch(`${SERVER_URL}/update-token.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(results),
      agent,
    });
    console.log(`📤 Gửi ${results.length} token thành công`);
  } catch (err) {
    console.error("❌ Gửi dữ liệu thất bại:", err.message);
  }
}

async function scanRound(round) {
  const scanTime = new Date().toLocaleTimeString("vi-VN", { hour12: false });
  const tokens = await assignBatchTokens(BATCH_SIZE);
  if (!tokens.length) return;

  const results = [];
  const start = Date.now();

  for (const token of tokens) {
    const rpc = rpcUrls[Math.floor(Math.random() * rpcUrls.length)];
    const priceData = await getTokenPriceAndInfo(token.mint, rpc);

    if (priceData && priceData !== "NO_POOL") {
      results.push({ ...priceData, index: token.index ?? undefined });
    } else {
      console.error(`❌ Không lấy được giá: ${token.mint}`);
    }

    if (Date.now() - start > 25000 && results.length > 0) {
      await sendResults(results);
      results.length = 0;
    }

    await delay(DELAY_MS);
  }

  if (results.length > 0) {
    await sendResults(results);
  }
}

app.get("/", (req, res) => {
  res.send(`✅ WebCon [${WORKER_ID}] đang chạy`);
});

app.listen(PORT, () => {
  console.log(`✅ Worker ${WORKER_ID} chạy tại http://localhost:${PORT}`);
  loadRpcUrls();

  let round = 1;
  (async function loop() {
    while (true) {
      await scanRound(round++);
      await delay(ROUND_DELAY_MS);
    }
  })();
});
