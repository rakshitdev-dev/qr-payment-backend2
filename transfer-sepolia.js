const { JsonRpcProvider, Wallet, formatUnits, parseUnits, formatEther, parseEther } = require('ethers');

async function main() {
    // === CONFIGURATION ===
    const RPC_URL = "https://0xrpc.io/sep";

    const PRIVATE_KEY = "63bd3e1ca3f56d1f21f2cc19ddcfbe4e844d0b0bba747f4ab3d4486337d97974"; // Never hardcode this!
    const RECIPIENT_ADDRESS = "0x30086497c5e5f191878f9e06505d328c2b043e88"; // Change this

    const AMOUNT_ETH = "0.0012"; // 0.0012 Sepolia ETH

    // ====================

    if (!PRIVATE_KEY || PRIVATE_KEY === "") {
        throw new Error("Set PRIVATE_KEY in your .env file");
    }

    // Connect to Sepolia
    const provider = new JsonRpcProvider(RPC_URL || "https://0xrpc.io/sep");

    // Create signer (your wallet)
    const wallet = new Wallet(PRIVATE_KEY, provider);

    console.log("Sender address   :", wallet.address);
    console.log("Recipient address:", RECIPIENT_ADDRESS);
    console.log("Amount           :", AMOUNT_ETH, "Sepolia ETH\n");

    // Check balance first
    const balance = await provider.getBalance(wallet.address);
    const balanceEth = formatEther(balance);
    console.log(`Sender balance: ${balanceEth} Sepolia ETH`);

    const amountWei = parseEther(AMOUNT_ETH);

    // Estimate gas (optional but recommended)
    const gasEstimate = await provider.estimateGas({
        from: wallet.address,
        to: RECIPIENT_ADDRESS,
        value: amountWei,
    });

    console.log(`Estimated gas: ${gasEstimate.toString()}`);

    // Send transaction
    const tx = await wallet.sendTransaction({
        to: RECIPIENT_ADDRESS,
        value: amountWei,
        // Optional: set gasLimit a bit higher than estimate
        gasLimit: gasEstimate + 5000n,
    });

    console.log("\nTransaction sent!");
    console.log("Tx hash:", tx.hash);
    console.log(`https://sepolia.etherscan.io/tx/${tx.hash}`);

    // Wait for confirmation
    console.log("\nWaiting for confirmation...");
    const receipt = await tx.wait();
    console.log("Transaction confirmed in block", receipt.blockNumber);
}

main().catch((error) => {
    console.error("Error:", error.message || error);
    process.exit(1);
});


