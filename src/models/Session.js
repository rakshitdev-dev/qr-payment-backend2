const mongoose = require("mongoose");

const SessionSchema = new mongoose.Schema(
    {
        depositAddress: {
            type: String,
            required: true,
            index: true,
        },

        derivedPriv: {
            type: String,
            required: true,
        },

        // User EVM wallet
        bnbUserAddress: {
            type: String,
            required: true,
        },

        saleType: {
            type: Number,
            required: true,
        },

        tokenAddress: {
            type: String,
            required: true,
        },

        amountInWei: {
            type: String,
            required: true,
        },

        // Expected ETH to be sent to deposit address
        ethRequired: {
            type: String,
            required: true,
        },

        // Referral address
        referrer: {
            type: String,
            default: "0x0000000000000000000000000000000000000000",
        },

        // watcher assigns tx hash once detected
        txHash: {
            type: String,
            default: null,
        },

        // pending → paid → processed
        status: {
            type: String,
            enum: ["pending", "paid", "processed"],
            default: "pending",
            index: true
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("Session", SessionSchema);
