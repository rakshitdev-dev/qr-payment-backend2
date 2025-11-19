const { ethers } = require("ethers");
const Session = require("./models/Session");

const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC);

const POLL_INTERVAL = 6000;
let lastBlock = 0;

async function startWatcher() {
    console.log("🚀 ETH Watcher started...");

    if (lastBlock === 0) {
        lastBlock = await provider.getBlockNumber();
        console.log("Starting from block:", lastBlock);
    }

    setInterval(async () => {
        try {
            // const currentBlock = await provider.getBlockNumber();
            const currentBlock = 9660401;
            // if (currentBlock <= lastBlock) return;

            console.log(`🔍 Scanning block: ${currentBlock}`);

            const block = await provider.getBlock(currentBlock);
            if (!block || !block.transactions) return;

            for (const txHash of block.transactions) {

                // Fetch full transaction
                const tx = await provider.getTransaction(txHash);
                if (!tx || !tx.to) continue;

                // const toLower = tx.to.toLowerCase();
                const toLower = tx.to.toLowerCase();

                const session = await Session.findOne({
                    depositAddress: { $regex: new RegExp(`^${toLower}$`, "i") },
                    status: "pending"
                });

                if (!session) continue;

                console.log("🎯 Deposit found for session:", session._id.toString());

                session.status = "paid";
                session.txHash = tx.hash;
                await session.save();

                console.log("✅ Session updated to PAID:", tx.hash);
            }

            lastBlock = currentBlock;
        } catch (err) {
            console.error("❌ Watcher error:", err);
        }
    }, POLL_INTERVAL);
}

module.exports = startWatcher;
