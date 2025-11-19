// block-fetch.js
const { JsonRpcProvider, formatEther } = require("ethers");
const fs = require("fs");
const path = require("path");

// -------------------- CONFIG --------------------
const provider = new JsonRpcProvider("https://0xrpc.io/sep");
const BLOCK = 9653176;
const LOG_FILE = path.join(__dirname, "output.log");

// ANSI color codes
const COLOR = {
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    red: "\x1b[31m",
    reset: "\x1b[0m",
};

// Log to file
function writeToFile(type, msg) {
    const line = `[${new Date().toISOString()}] [${type}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, line);
}

// Custom console wrappers
function logSuccess(msg) {
    console.log(COLOR.green + msg + COLOR.reset);
    writeToFile("SUCCESS", msg);
}
function logInfo(msg) {
    console.info(COLOR.blue + msg + COLOR.reset);
    writeToFile("INFO", msg);
}
function logWarn(msg) {
    console.warn(COLOR.yellow + msg + COLOR.reset);
    writeToFile("WARN", msg);
}
function logError(msg) {
    console.error(COLOR.red + msg + COLOR.reset);
    writeToFile("ERROR", msg);
}

// Delay helper
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// -------------------- MAIN FUNCTION --------------------
async function fetchTxDetails() {
    logInfo(`⏳ Fetching block ${BLOCK}...`);

    const block = await provider.getBlock(BLOCK);

    if (!block || !block.transactions || block.transactions.length === 0) {
        logWarn("No transactions in this block.");
        return;
    }

    logSuccess(`🧾 Transactions in block: ${block.transactions.length}`);
    console.log("");

    for (const txHash of block.transactions) {
        await delay(100); // avoid rate limits

        const tx = await provider.getTransaction(txHash);
        const receipt = await provider.getTransactionReceipt(txHash);

        const msg = `
--------------------------------------------------
TX HASH        : ${txHash}
FROM           : ${tx.from}
TO             : ${tx.to}
VALUE (ETH)    : ${formatEther(tx.value || 0n)}
GAS USED       : ${receipt?.gasUsed?.toString()}
STATUS         : ${receipt?.status === 1 ? "SUCCESS" : "FAILED"}
BLOCK          : ${receipt?.blockNumber}
TIMESTAMP      : ${block.timestamp}
INPUT DATA     : ${tx.data}
--------------------------------------------------
`;

        console.log(msg);
        writeToFile("TX", msg);
    }

    logSuccess("✅ Finished fetching all transaction details.");
}

// Run
fetchTxDetails().catch((err) => logError(err.message));
