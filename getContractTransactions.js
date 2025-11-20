const { ethers, JsonRpcProvider, Contract } = require("ethers");
const fs = require("fs");
require("dotenv").config();

const abi = require("./src/icoAbi.json");

BigInt.prototype.toJSON = function () { return this.toString(); };

const {
    BSC_RPC,
    ICO_ADDRESS_BSC
} = process.env;

if (!BSC_RPC) throw new Error("❌ Missing BSC_RPC in .env");
if (!ICO_ADDRESS_BSC) throw new Error("❌ Missing ICO_ADDRESS_BSC in .env");

const provider = new JsonRpcProvider(BSC_RPC);
const contract = new Contract(ICO_ADDRESS_BSC, abi, provider);

async function getAllContractEvents() {
    const filter = {
        address: ICO_ADDRESS_BSC,
        fromBlock: 0,
        toBlock: "latest",
    };

    console.log("⏳ Fetching logs...");
    const logs = await provider.getLogs(filter);
    console.log("✅ Total logs fetched:", logs.length);

    const parsedEvents = logs
        .map(log => {
            try {
                const decoded = contract.interface.parseLog(log);
                return {
                    eventName: decoded.name,
                    args: decoded.args,
                    txHash: log.transactionHash,
                    blockNumber: log.blockNumber,
                    logIndex: log.logIndex
                };
            } catch {
                return null;
            }
        })
        .filter(Boolean); // remove nulls

    console.log("📦 Saving events to events.json");

    fs.writeFileSync(
        "./events.json",
        JSON.stringify(parsedEvents, null, 2)
    );

    console.log("🎉 File saved: events.json");
}

getAllContractEvents();
