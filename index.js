require("dotenv").config();
const express = require("express");
const { ethers } = require("ethers");
const QRCode = require("qrcode");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");

// ---------------------------
// GLOBAL FIX – allow BigInt in JSON
// ---------------------------
BigInt.prototype.toJSON = function () {
    return this.toString();
};

// ---------------------------
// CONFIG
// ---------------------------
const app = express();
app.use(cors());
app.use(express.json());

const {
    PRIVATE_KEY,
    SEPOLIA_RPC,
    BSC_TESTNET_RPC,
    MONGO_URI,
    MONGO_DB,
    ICO_ADDRESS_BSC
} = process.env;

// BNB relayer wallet
const bnbProvider = new ethers.JsonRpcProvider(BSC_TESTNET_RPC);
const bnbRelayer = new ethers.Wallet(PRIVATE_KEY, bnbProvider);

// Your ICO details
const ICO_ABI = require("./icoAbi.json");

// ETH receiver wallet
const ETH_RECEIVER = "0x30086497c5e5f191878f9e06505d328c2b043E88";

// Conversion rate (DEMO example)
// 1 ETH = 4 BNB → so BNB * 0.25 ETH
const ETH_PER_BNB = 1 / 4;

// ---------------------------
// MONGO DB SETUP
// ---------------------------
const client = new MongoClient(MONGO_URI);
let db, Sessions;

async function initMongo() {
    await client.connect();
    db = client.db(MONGO_DB);
    Sessions = db.collection("sessions");
    console.log("Connected to MongoDB");
}
initMongo().catch(console.error);


// ---------------------------
// GENERATE QR-CODE
// ---------------------------
const generateBNBQRCode = async (receiver, amountBNB, chainId) => {
    const amountInWei = BigInt(amountBNB * 1e18).toString();
    const uri = `ethereum:${receiver}@${chainId}?value=${amountInWei}`;
    console.log("Payment URI:", uri);

    const qrPng = await QRCode.toDataURL(uri);
    return { uri, qrPng };
};


// ---------------------------
// 1. CREATE QR-CODE Tx API
// ---------------------------
app.post("/create-qr-tx", async (req, res) => {
    try {
        const { bnbUserAddress, saleType, tokenAddress, amountInWei, referrer } = req.body;

        // Convert BNB wei → BNB float
        const bnbAmount = Number(amountInWei) / 1e18;
        const ethRequired = bnbAmount * ETH_PER_BNB;

        const { uri, qrPng } = await generateBNBQRCode(ETH_RECEIVER, ethRequired, 11155111);

        // Save session to MongoDB
        const session = {
            bnbUserAddress,
            saleType,
            tokenAddress,
            amountInWei: amountInWei.toString(),
            ethRequired: ethRequired.toString(),
            referrer,
            status: "pending",
            createdAt: new Date()
        };
        const result = await Sessions.insertOne(session);

        res.json({
            success: true,
            sessionId: result.insertedId,
            qr: qrPng,
            encodedTx: uri,
            message: "Scan this QR with an Ethereum wallet"
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});


// ---------------------------
// 2. TRIGGER BSC BUY AFTER ETH PAYMENT
// ---------------------------
app.post("/trigger-buy", async (req, res) => {
    try {
        const { sessionId } = req.body;

        console.log({ api:"/trigger-buy",sessionId })

        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ success: false, error: "Invalid session ID" });
        }

        const session = await Sessions.findOne({ _id: sessionId });

        if (!session) return res.status(404).json({ success: false, error: "Session not found" });
        if (session.status !== "paid") return res.status(400).json({ success: false, error: "Payment not yet received" });

        const ico = new ethers.Contract(ICO_ADDRESS_BSC, ICO_ABI, bnbRelayer);
        const tx = await ico.buy(session.saleType, session.tokenAddress, session.amountInWei, session.referrer);
        const receipt = await tx.wait();

        await Sessions.updateOne(
            { _id: sessionId },
            { $set: { bscTxHash: receipt.hash, status: "completed" } }
        );

        res.json({
            success: true,
            message: "ICO buy completed on BSC",
            hash: receipt.hash
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get("/session-status/:sessionId", async (req, res) => {
    try {
        const { sessionId } = req.params;
        console.log({ api:"/session-status/:sessionId",sessionId })

        if (!ObjectId.isValid(sessionId)) {
            return res.status(400).json({ success: false, error: "Invalid session ID" });
        }

        const session = await Sessions.findOne({ _id: new ObjectId(sessionId) });

        if (!session) return res.status(404).json({ success: false, error: "Session not found" });

        res.json({
            success: true,
            session: {
                sessionId: session._id,
                status: session.status,
                bscTxHash: session.bscTxHash || null,
                ethRequired: session.ethRequired,
                createdAt: session.createdAt
            }
        });

    } catch (err) {
        console.error("Error fetching session:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});


// ---------------------------
// START SERVER
// ---------------------------
app.listen(5000, () => {
    console.log("Backend running on port 5000");
});
