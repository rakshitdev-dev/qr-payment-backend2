const { ethers, HDNodeWallet } = require("ethers");

/**
 * Derive deterministic deposit address for each session index.
 * Path: m/44'/60'/0'/0/{index}
 */
function deriveDepositAddress(mnemonic, index = 0) {
    try {
        // If HDNodeWallet is available (ethers v6)
        if (HDNodeWallet && typeof HDNodeWallet.fromPhrase === "function") {
            const master = HDNodeWallet.fromPhrase(mnemonic);
            const child = master.derivePath(`44'/60'/0'/0/${index}`);
            return {
                address: child.address,
                privateKey: child.privateKey,
            };
        }

        // Fallback (rare, but safe)
        if (ethers.Wallet && ethers.Mnemonic) {
            const mn = ethers.Mnemonic.fromPhrase(mnemonic);
            const master = ethers.HDNodeWallet.fromMnemonic(mn);
            const child = master.derivePath(`m/44'/60'/0'/0/${index}`);
            return {
                address: child.address,
                privateKey: child.privateKey,
            };
        }

        throw new Error("No compatible HD wallet available in ethers.");

    } catch (e) {
        console.error("❌ Derive deposit address error:", e.message);
        throw e; // correctly rethrow actual error
    }
}

module.exports = { deriveDepositAddress };
