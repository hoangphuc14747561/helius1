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
const AMOUNT = 100_000_000;

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

async function getTokenPriceFromHelius(mint, heliusKey) {
  const url = `https://api.helius.xyz/v0/tokens/price?api-key=${heliusKey}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokens: [mint] })
    });
    const data = await res.json();
    const price = data?.prices?.[0]?.price;
    if (price) return { value: +price.toFixed(9), source: "Helius" };
  } catch {}
  return null;
}

async function getTokenPriceWithTimeout(mint, timeout = 5000) {
  const key = rpcUrls[Math.floor(Math.random() * rpcUrls.length)];
  return Promise.race([
    getTokenPriceFromHelius(mint, key),
    new Promise(resolve => setTimeout(() => resolve(null), timeout))
  ]);
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
    const price = await getTokenPriceWithTimeout(token.mint);
    if (price) {
      results.push({
        mint: token.mint,
        index: token.index ?? undefined,
        currentPrice: price.value,
        scanTime
      });
    } else {
      console.error(`❌ Không lấy được giá: ${token.mint}`);
    }

    if (Date.now() - start > 25000 && results.length > 0) {
      await sendResults(results);
      results.length = 0;
    }

    await delay(DELAY_MS);
  }

  if (results.length > 0) await sendResults(results);
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
