require("dotenv").config();
const express = require("express");
const cors = require("cors");
const QRCode = require("qrcode");
const mongoose = require("mongoose");
const Session = require("./models/Session");
const { ethers } = require("ethers");
const { deriveDepositAddress } = require("./walletUtils");
const ICO_ABI = require("./icoAbi.json");
const startWatcher = require("./watcher");

// Allow BigInt JSON
BigInt.prototype.toJSON = function () { return this.toString(); };

const {
    MASTER_MNEMONIC,
    RELAYER_PRIVATE_KEY,
    ETH_RPC,
    BSC_RPC,
    MONGO_URI,
    MONGO_DB,
    ICO_ADDRESS_BSC,
    DEPOSIT_CHAIN_ID = "11155111"
} = process.env;

const app = express();
app.use(cors());
app.use(express.json());

// 🟢 Mongoose connection
mongoose
    .connect(MONGO_URI, { dbName: MONGO_DB || "ico_relayer" })
    .then(() => {
        console.log("✅ MongoDB connected");

        // Start watcher ONLY after DB is ready
        startWatcher();
    })
    .catch(err => console.error("Mongo error:", err));


// providers & relayer
const ethProvider = new ethers.JsonRpcProvider(ETH_RPC);
const bscProvider = new ethers.JsonRpcProvider(BSC_RPC);
const relayerWallet = RELAYER_PRIVATE_KEY ? new ethers.Wallet(RELAYER_PRIVATE_KEY, bscProvider) : null;

// helper to generate QR image (data URL)
async function generateDepositQr(depositAddress, ethAmount, chainId = Number(DEPOSIT_CHAIN_ID)) {
    // amount should be number in ETH
    const amountWei = ethers.parseEther(String(ethAmount || 0));
    const uri = `ethereum:${depositAddress}@${chainId}?value=${amountWei.toString()}`;
    const png = await QRCode.toDataURL(uri);
    return { uri, png };
}

// API: create session + QR (frontend hits this)
app.post("/create-qr-tx", async (req, res) => {
    try {
        const { saleType, tokenAddress, amountInWei, referrer, bnbUserAddress } = req.body;

        if (!MASTER_MNEMONIC) return res.status(500).json({ success: false, error: "MASTER_MNEMONIC not configured" });

        // create a session index by inserting a placeholder so we get a monotonically increasing index
        // simpler: use Session.countDocuments() if concurrency not a big issue; safer: use insert + use its insertedId as index seed
        // We'll use countDocuments (fast for demo). In production use a sequence/counter collection.
        const index = await Session.countDocuments() + 2; // for test

        const { address: depositAddress, privateKey: derivedPriv } = deriveDepositAddress(MASTER_MNEMONIC, index);

        // Convert payment amount (the user wants to pay on BSC) into ETH amount required for deposit
        // For demo we assume 1 ETH = 4 BNB =>  ETH_PER_BNB = 0.25
        // You should update conversion to live price in production
        const ETH_PER_BNB = 1 / 4;
        // amountInWei here is the BNB amount in wei as string; convert
        const bnbAmount = Number(amountInWei) / 1e18;
        const ethRequired = bnbAmount * ETH_PER_BNB; // float

        const { uri, png } = await generateDepositQr(depositAddress, ethRequired);

        const sessionDoc = {
            depositAddress,
            derivedPriv: derivedPriv, // optional: store for later (if you want backend to move funds) — **be careful** storing private keys
            bnbUserAddress: bnbUserAddress || null,
            saleType,
            tokenAddress,
            amountInWei: amountInWei.toString(),
            referrer,
            ethRequired: String(ethRequired),
            status: "pending",
            createdAt: new Date()
        };

        const result = await Session.insertOne(sessionDoc);

        res.json({
            success: true,
            sessionId: result.insertedId.toString(),
            qr: png,
            encodedTx: uri,
            depositAddress,
            ethRequired
        });
    } catch (err) {
        console.error("create-qr-tx error", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: check session status
app.get("/session-status/:sessionId", async (req, res) => {
    try {
        const { sessionId } = req.params;
        if (!mongoose.isValidObjectId(sessionId)) return res.status(400).json({ success: false, error: "invalid id" });
        const session = await Session.findOne({ _id: sessionId });
        if (!session) return res.status(404).json({ success: false, error: "not found" });

        res.json({
            success: true,
            session: {
                sessionId: session._id.toString(),
                status: session.status,
                ethTxHash: session.ethTxHash || null,
                bscTxHash: session.bscTxHash || null,
                ethRequired: session.ethRequired,
                createdAt: session.createdAt
            }
        });
    } catch (err) {
        console.error("session-status error", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: trigger buy (can be called by frontend once session is marked paid)
app.post("/trigger-buy", async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!ObjectId.isValid(sessionId)) return res.status(400).json({ success: false, error: "invalid id" });

        const session = await Session.findOne({ _id: new ObjectId(sessionId) });
        if (!session) return res.status(404).json({ success: false, error: "session not found" });
        if (session.status !== "paid") return res.status(400).json({ success: false, error: "payment not received" });

        if (!relayerWallet) return res.status(500).json({ success: false, error: "RELAYER_PRIVATE_KEY not configured" });

        const ico = new ethers.Contract(ICO_ADDRESS_BSC, ICO_ABI, relayerWallet);

        // call buy. Note: if token is native zero, include value param as needed.
        const tx = await ico.buy(
            BigInt(session.saleType || 0),
            session.tokenAddress,
            BigInt(session.amountInWei),
            session.referrer || ethers.ZeroAddress
        );

        const receipt = await tx.wait();

        await Session.updateOne({ _id: session._id }, { $set: { bscTxHash: receipt.hash, status: "completed", completedAt: new Date() } });

        res.json({ success: true, hash: receipt.hash });
    } catch (err) {
        console.error("trigger-buy error", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    startWatcher();
    console.log(`Backend running on port ${PORT}`);
});