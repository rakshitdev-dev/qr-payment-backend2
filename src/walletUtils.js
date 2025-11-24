const { ethers, HDNodeWallet } = require("ethers");
const bip39 = require("bip39");
const ed25519 = require("ed25519-hd-key");
const { Keypair, PublicKey } = require("@solana/web3.js");
const TronWeb = require("tronweb");
const bitcoin = require("bitcoinjs-lib");

/**
 * Derive deposit address across multiple chains:
 * 
 * - EVM: m/44'/60'/0'/0/{index}
 * - Solana: m/44'/501'/{index}'/0'
 * - Tron: m/44'/195'/0'/0/{index}
 * - Bitcoin: m/44'/0'/0'/0/{index}
 */

function deriveDepositAddress(mnemonic, index = 0, chain) {
    try {
        if (!bip39.validateMnemonic(mnemonic))
            throw new Error("Invalid mnemonic");

        const seed = bip39.mnemonicToSeedSync(mnemonic);

        switch (chain) {

            /* -------------------------------------------
             * 1️⃣ EVM (ETH, BNB, MATIC)
             * ------------------------------------------- */
            case "ethereum":
            case "polygon":
            case "bsc":
            case "sepolia":
            case "amoy": {
                const path = `44'/60'/0'/0/${index}`;  // Ensure depth of 4 here

                // ethers v6
                const master = HDNodeWallet.fromPhrase(mnemonic);
                const child = master.derivePath(path);  // This should work for a depth of 4

                return {
                    chain,
                    address: child.address,
                    privateKey: child.privateKey,
                };
            }

            /* -------------------------------------------
             * 2️⃣ Tron (TRC20/TRX) — secp256k1 (same as EVM)
             * ------------------------------------------- */
            case "tron":
            case "tron-shasta": {
                const path = `m/44'/195'/0'/0/${index}`; // SLIP44: 195 for TRX

                const master = HDNodeWallet.fromMnemonic(mnemonic);
                const child = master.derivePath(path);

                const tron = new TronWeb({});
                const tronAddress = tron.address.fromPrivateKey(child.privateKey);

                return {
                    chain,
                    address: tronAddress,
                    privateKey: child.privateKey,
                };
            }

            /* -------------------------------------------
             * 3️⃣ Solana (SPL tokens, SOL) — Ed25519
             * ------------------------------------------- */
            case "solana":
            case "solana-devnet": {
                const path = `m/44'/501'/${index}'/0'`;

                const derived = ed25519.derivePath(path, seed.toString("hex"));
                const keypair = Keypair.fromSeed(derived.key);

                return {
                    chain,
                    address: keypair.publicKey.toBase58(),
                    privateKey: Buffer.from(keypair.secretKey).toString("hex"),
                };
            }

            /* -------------------------------------------
             * 4️⃣ Bitcoin (BTC / Testnet)
             * ------------------------------------------- */
            case "bitcoin":
            case "bitcoin-testnet4": {
                const testnet = chain === "bitcoin-testnet4";

                const network = testnet
                    ? bitcoin.networks.testnet
                    : bitcoin.networks.bitcoin;

                const path = `m/44'/${testnet ? 1 : 0}'/0'/0/${index}`;

                const root = bitcoin.bip32.fromSeed(seed, network);
                const child = root.derivePath(path);

                const { address } = bitcoin.payments.p2pkh({
                    pubkey: child.publicKey,
                    network,
                });

                return {
                    chain,
                    address,
                    privateKey: child.toWIF(), // WIF format
                };
            }

            default:
                throw new Error(`Unsupported chain: ${chain}`);
        }

    } catch (e) {
        console.error("❌ Derive wallet error:", e.message);
        throw e;
    }
}

module.exports = { deriveDepositAddress };
