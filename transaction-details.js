const { ethers, JsonRpcProvider } = require("ethers");
const fs = require("fs");
require("dotenv").config();

const { BSC_RPC } = process.env;

if (!BSC_RPC) throw new Error("❌ Missing BSC_RPC in .env");

const provider = new JsonRpcProvider(BSC_RPC);

// ---------------------------------------------------------
// 📌 Function to fetch full transaction details and save JSON
// ---------------------------------------------------------
async function getTransactionByHash(txHash) {
    console.log("⏳ Fetching transaction...");

    const tx = await provider.getTransaction(txHash);

    if (!tx) {
        console.log("❌ Transaction not found");
        return null;
    }

    console.log("⏳ Fetching receipt...");
    const receipt = await provider.getTransactionReceipt(txHash);

    const result = {
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: tx.value ? tx.value.toString() : null,
        nonce: tx.nonce,
        gasPrice: tx.gasPrice?.toString(),
        data: tx.data,
        blockNumber: tx.blockNumber,
        receipt: receipt
            ? {
                  status: receipt.status,
                  gasUsed: receipt.gasUsed.toString(),
                  blockNumber: receipt.blockNumber,
                  contractAddress: receipt.contractAddress,
                  logs: receipt.logs
              }
            : "Waiting for confirmation..."
    };

    // ---------------------------------------------------------
    // 📁 Save to JSON file with the name "<hash>.json"
    // ---------------------------------------------------------
    const filename = `${tx.hash}.json`;

    fs.writeFileSync(filename, JSON.stringify(result, null, 2));

    console.log(`📦 Saved to ${filename}`);
    return result;
}

// ---------------------------------------------------------
// 🟢 Call function
// ---------------------------------------------------------
getTransactionByHash(
    "0x0efbec9374781a3f1ec7dd1ddc18d1c3d1d353b0456e941fa17c3ae8a381fafb"
);
