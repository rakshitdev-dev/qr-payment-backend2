const mongoose = require("mongoose");

const SessionSchema = new mongoose.Schema(
{
    // Wallet where user must send funds
    depositAddress: { type: String, required: true, index: true },

    // Derived private key (backend uses derivedPriv)
    derivedPriv: { type: String, required: true },

    // User’s EVM wallet (receives sale tokens)
    userAddress: { type: String, required: true },

    // Sale type (ICO stage)
    saleType: { type: Number, required: true },

    // Payment token used by user (0x00 or ERC20)
    payToken: { type: String, required: true },

    // Amount to execute in $
    amountUsd: { type: String, required: true },

    // Amount user must send on payment chain (in standard unit)
    amountPayChain: { type: String, required: true },

    // Referral
    referrer: {
        type: String,
        default: "0x0000000000000000000000000000000000000000",
    },

    // Network where user is paying
    payChain: {
        type: String,
        enum: [
            "sepolia",
            "amoy",
            "solana-devnet",
            "bitcoin-testnet4",
            "tron-shasta",
            "ethereum",
            "polygon",
            "solana",
            "bitcoin",
            "tron"
        ],
        required: true,
        index: true
    },

    // Payment type (native, USDT, or token)
    payType: {
        type: String,
        enum: ["native", "usdt", "token"],
        required: true
    },

    // Payment detection status
    paymentStatus: {
        type: String,
        enum: ["pending", "paid", "confirmed"],
        default: "pending",
        index: true
    },

    paymentBlock: { type: Number },

    // Execution on BSC
    executionStatus: {
        type: String,
        enum: ["pending", "executed", "failed"],
        default: "pending",
        index: true
    },

    executionTxHash: { type: String, default: null },
    testnet: { type: Boolean, required: true, index: true },

},
{
    timestamps: true
}
);

module.exports = mongoose.model("Session", SessionSchema);
