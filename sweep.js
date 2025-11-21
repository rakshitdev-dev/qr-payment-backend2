const {
    ethers,
    Wallet,
    JsonRpcProvider,
    Contract,
    formatUnits,
} = ethers;

// Minimal ERC-20 ABI (balance, transfer, decimals, name, symbol)
const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function name() view returns (string)"
];

// Minimal Multicall (Multicall3-like) ABI - if you have a deployed multicall on Sepolia
// We'll use `aggregate((address,bytes)[])` pattern if the multisig supports it.
// NOTE: The exact multicall ABI/address depends on deployment. This is optional.
const MULTICALL_ABI = [
    "function aggregate(tuple(address target, bytes callData)[] calldata calls) payable returns (uint256 blockNumber, bytes[] returnData)"
];

/**
 * Sweep function
 * @param {Object} opts
 * @param {string} opts.providerUrl - JSON-RPC URL for Sepolia
 * @param {string[]} opts.privateKeys - array of hex private keys (0x...)
 * @param {string[]} opts.tokenAddresses - array of ERC20 token addresses to sweep (can be empty)
 * @param {string} opts.to - destination address to collect funds
 * @param {string|null} opts.multicallAddress - if provided, will attempt to bundle multiple token transfers per wallet into a single signed tx (per-wallet only)
 * @param {boolean} opts.dryRun - if true, do everything except broadcast transactions
 */
export async function sweepSepolia({
    providerUrl,
    privateKeys,
    tokenAddresses = [],
    to,
    multicallAddress = null,
    dryRun = false,
}) {
    if (!providerUrl || !privateKeys || !to) {
        throw new Error("providerUrl, privateKeys and to are required");
    }

    const provider = new JsonRpcProvider(providerUrl);

    const results = [];

    for (const pk of privateKeys) {
        const wallet = new Wallet(pk, provider);
        const from = await wallet.getAddress();
        console.log("----");
        console.log(`Wallet: ${from}`);

        const nativeBalance = await provider.getBalance(from); // BigInt
        console.log(`Native balance: ${formatUnits(nativeBalance, 18)} ETH`);

        // We'll collect per-wallet actions and gas estimates.
        const actions = [];

        // 1) ERC-20 sweeps (if any)
        for (const tokenAddr of tokenAddresses) {
            try {
                const token = new Contract(tokenAddr, ERC20_ABI, provider);
                const rawBalance = await token.balanceOf(from);
                if (rawBalance <= 0n) {
                    console.log(`Token ${tokenAddr} balance 0 — skipping`);
                    continue;
                }

                // Attempt to get decimals and symbol for nicer logging (fallbacks if fail)
                let decimals = 18;
                let symbol = tokenAddr;
                try { decimals = await token.decimals(); } catch (e) { }
                try { symbol = await token.symbol(); } catch (e) { }

                console.log(`Token ${symbol} balance: ${formatUnits(rawBalance, decimals)} (${rawBalance} raw)`);

                // Create calldata for transfer(to, amount)
                const tokenWithSigner = new Contract(tokenAddr, ERC20_ABI, wallet);
                const transferData = tokenWithSigner.interface.encodeFunctionData("transfer", [to, rawBalance]);

                actions.push({
                    type: "erc20",
                    token: tokenAddr,
                    symbol,
                    decimals,
                    amountRaw: rawBalance,
                    calldata: transferData,
                    contract: tokenWithSigner
                });
            } catch (err) {
                console.error(`Error inspecting token ${tokenAddr} for ${from}:`, err.message || err);
            }
        }

        // 2) Native ETH sweep: compute max transferable (leave gas)
        // We must estimate gas. We'll assume a simple transfer gas limit of 21000 for native ETH.
        let nativeTx = null;
        if (nativeBalance > 0n) {
            // Estimate gas price / maxFeePerGas / maxPriorityFeePerGas modern EIP-1559
            const feeData = await provider.getFeeData();
            // Use maxFeePerGas if available, else fallback to gasPrice
            const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? feeData.gasPrice ?? 0n;
            const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;

            const gasLimitForEthTransfer = 21000n;

            // gasCost = gasLimit * maxFeePerGas
            const gasCost = gasLimitForEthTransfer * maxFeePerGas;

            if (nativeBalance > gasCost) {
                const transferable = nativeBalance - gasCost;
                console.log(`Estimated gas cost for ETH transfer: ${formatUnits(gasCost, 18)} ETH`);
                console.log(`Max transferable native ETH: ${formatUnits(transferable, 18)} ETH`);

                nativeTx = {
                    type: "native",
                    value: transferable,
                    gasLimit: gasLimitForEthTransfer,
                    maxFeePerGas,
                    maxPriorityFeePerGas
                };
            } else {
                console.log("Not enough ETH for gas to transfer native balance — skipping native sweep.");
            }
        } else {
            console.log("Native balance 0 — skipping native sweep.");
        }

        // If there are no actions and no native to send, skip
        if (actions.length === 0 && !nativeTx) {
            results.push({ from, status: "nothing_to_sweep" });
            continue;
        }

        // Check that wallet has enough ETH to pay gas for the transfers:
        // For ERC20 transfers we need to estimate gas: a typical ERC20 transfer ~ 60k - 100k gas.
        // We'll estimate per-action using provider. But to estimate we need a populated transaction for each calldata.
        // We'll estimate gas cost sum and compare to native balance.
        let totalEstimatedGasCost = 0n;

        // Gas estimate for ERC20 actions
        for (const a of actions) {
            try {
                // Build a "call" tx object to estimate
                const txRequest = {
                    to: a.token,
                    from,
                    data: a.calldata,
                };
                const estimatedGas = BigInt(await provider.estimateGas(txRequest));
                // Get fee data again for current gas costs
                const feeData = await provider.getFeeData();
                const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
                const actionGasCost = estimatedGas * maxFeePerGas;
                totalEstimatedGasCost += actionGasCost;
                a.estimatedGas = estimatedGas;
                a.estimatedGasCost = actionGasCost;
                console.log(`Estimated gas for transfer of ${a.symbol}: ${estimatedGas} gas -> cost ${formatUnits(actionGasCost, 18)} ETH`);
            } catch (err) {
                // fallback to conservative estimate if estimateGas fails
                const conservativeGas = 120000n;
                const feeData = await provider.getFeeData();
                const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
                const actionGasCost = conservativeGas * maxFeePerGas;
                totalEstimatedGasCost += actionGasCost;
                a.estimatedGas = conservativeGas;
                a.estimatedGasCost = actionGasCost;
                console.log(`Failed to estimate gas for token ${a.token}. Using conservative ${conservativeGas} gas -> cost ${formatUnits(actionGasCost, 18)} ETH`);
            }
        }

        // Add nativeTx gas cost if present (we already counted it for determining transferable)
        if (nativeTx) {
            const feeData = await provider.getFeeData();
            const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
            const nativeGasCost = nativeTx.gasLimit * maxFeePerGas;
            totalEstimatedGasCost += nativeGasCost;
        }

        console.log(`Total estimated gas cost to perform all actions for ${from}: ${formatUnits(totalEstimatedGasCost, 18)} ETH`);
        if (nativeBalance < totalEstimatedGasCost) {
            console.log("Wallet DOES NOT have enough ETH to cover gas for all planned actions. Will try to prioritize token transfers over native sweep.");
            // Strategy: If not enough, prefer ERC20 actions (they require ETH for gas), skip native sweep.
            nativeTx = null;
        }

        // Build and send transactions:
        // Option A: If multicallAddress is provided and there are >1 ERC20 actions, we can attempt to aggregate them into one multicall call (per-wallet).
        let txHashes = [];

        if (multicallAddress && actions.length > 0) {
            try {
                // Build multicall calldata
                const multicall = new Contract(multicallAddress, MULTICALL_ABI, wallet);

                // For aggregate, the call expects an array of { target, callData }
                const calls = actions.map(a => ({ target: a.token, callData: a.calldata }));

                // Prepare tx
                const unsignedTx = await multicall.populateTransaction.aggregate(calls);
                // fee data
                const feeData = await provider.getFeeData();
                if (feeData.maxFeePerGas) unsignedTx.maxFeePerGas = feeData.maxFeePerGas;
                if (feeData.maxPriorityFeePerGas) unsignedTx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;

                // estimate gas
                try {
                    const est = BigInt(await provider.estimateGas({ ...unsignedTx, from }));
                    unsignedTx.gasLimit = est + 5000n; // small buffer
                } catch (e) {
                    unsignedTx.gasLimit = 600000n; // fallback buffer
                }

                console.log(`Using multicall at ${multicallAddress} to bundle ${actions.length} token transfers into one tx (per-wallet).`);
                if (dryRun) {
                    console.log("[dryRun] would send multicall tx:", unsignedTx);
                } else {
                    const sent = await wallet.sendTransaction(unsignedTx);
                    console.log("Multicall sent txHash:", sent.hash);
                    txHashes.push(sent.hash);
                    await sent.wait(); // wait for confirmation
                    console.log("Multicall confirmed.");
                }
            } catch (err) {
                console.error("Failed to perform multicall bundling for this wallet:", err.message || err);
                // Fallback: do individual token transfers below
                for (const a of actions) a.fallbackToIndividual = true;
            }
        }

        // Send individual ERC20 transfers for actions that weren't covered by multicall (or if multicall not provided)
        for (const a of actions) {
            // If multicall covered them, skip
            if (multicallAddress && !a.fallbackToIndividual && txHashes.length > 0) {
                // Assume multicall covered all; skip
                continue;
            }

            if (nativeBalance < a.estimatedGasCost) {
                console.log(`Insufficient ETH to pay gas for ${a.symbol} transfer. Skipping token ${a.symbol}.`);
                continue;
            }

            if (dryRun) {
                console.log(`[dryRun] would call ${a.token}.transfer(${to}, ${a.amountRaw.toString()})`);
            } else {
                try {
                    const tx = await a.contract.transfer(to, a.amountRaw, {
                        gasLimit: a.estimatedGas,
                        // EIP-1559 fields optional; ethers will populate sensible defaults if omitted
                    });
                    console.log(`Sent transfer of ${a.symbol} txHash: ${tx.hash}`);
                    txHashes.push(tx.hash);
                    await tx.wait();
                    console.log(`Transfer of ${a.symbol} mined.`);
                    // Deduct gas estimate from nativeBalance to track remaining funds for further actions
                    const feeData = await provider.getFeeData();
                    const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
                    nativeBalance -= (a.estimatedGas * maxFeePerGas);
                } catch (err) {
                    console.error(`Error sending ${a.symbol} transfer:`, err.message || err);
                }
            }
        }

        // Now send native ETH (if any)
        if (nativeTx) {
            if (nativeBalance > nativeTx.value) {
                // unusual: our tracked nativeBalance may have decreased due to paying token gas; recompute
                console.log("Recomputing native transfer amount to ensure gas coverage...");

                // Refresh feeData
                const feeData = await provider.getFeeData();
                const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
                const gasLimit = nativeTx.gasLimit ?? 21000n;
                const gasCost = gasLimit * maxFeePerGas;

                const currentNativeBalance = await provider.getBalance(from);
                if (currentNativeBalance > gasCost) {
                    const valueToSend = currentNativeBalance - gasCost;
                    console.log(`Will send ${formatUnits(valueToSend, 18)} ETH (leaving ${formatUnits(gasCost, 18)} ETH for gas).`);
                    if (dryRun) {
                        console.log(`[dryRun] would send native tx: to=${to}, value=${formatUnits(valueToSend, 18)} ETH`);
                    } else {
                        try {
                            const tx = await wallet.sendTransaction({
                                to,
                                value: valueToSend,
                                gasLimit: gasLimit,
                                maxFeePerGas: maxFeePerGas,
                                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n
                            });
                            console.log("Native send txHash:", tx.hash);
                            txHashes.push(tx.hash);
                            await tx.wait();
                            console.log("Native transfer confirmed.");
                        } catch (err) {
                            console.error("Error sending native ETH:", err.message || err);
                        }
                    }
                } else {
                    console.log("Not enough ETH after token transfer gas to send native ETH.");
                }
            } else {
                console.log("Not enough native balance after token transfers to send ETH sweep.");
            }
        }

        results.push({ from, status: "done", txHashes });
    } // end for each private key

    return results;
}

// Example usage:
if (require.main === module) {
    (async () => {
        const PROVIDER_URL = process.env.ETH_RPC || "https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID";
        const PRIVATE_KEYS = 
        const TOKEN_ADDRESSES = (process.env.TOKENS || "").split(",").filter(Boolean); // ERC20 token addresses
        const DEST = process.env.DESTINATION || "0x107f9b818a14ea92c889573cbbee486fea608b4b";
        const MULTICALL = process.env.MULTICALL || null; // optional multicall address
        const DRY = (process.env.DRY === "1");

        if (PRIVATE_KEYS.length === 0) {
            console.error("No private keys provided. Set PRIVATE_KEYS env var (comma separated). Exiting.");
            process.exit(1);
        }

        try {
            const res = await sweepSepolia({
                providerUrl: PROVIDER_URL,
                privateKeys: PRIVATE_KEYS,
                tokenAddresses: TOKEN_ADDRESSES,
                to: DEST,
                multicallAddress: MULTICALL,
                dryRun: DRY,
            });
            console.log("Sweep summary:", JSON.stringify(res, null, 2));
        } catch (err) {
            console.error("Fatal error:", err);
        }
    })();
}
