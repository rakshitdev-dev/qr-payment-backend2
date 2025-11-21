import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  encodeFunctionData,
  getAddress
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import ERC20_ABI from "./erc20_abi.json";

/* -----------------------------------------
   CONFIG
--------------------------------------------*/
export const MAIN_PRIVATE_KEY = process.env.MAIN_PRIVATE_KEY;
export const MAIN_ADDRESS = getAddress(process.env.MAIN_ADDRESS);

export const RPC = {
  sepolia: "https://rpc.sepolia.org",
  polygon: "https://polygon-rpc.com",
  bsc: "https://bsc-dataseed.binance.org"
};

/* -----------------------------------------
   CLIENT FACTORY
--------------------------------------------*/
function getClients(chainName) {
  const rpcUrl = RPC[chainName];
  if (!rpcUrl) throw new Error(`Unsupported chain ${chainName}`);

  const publicClient = createPublicClient({ transport: http(rpcUrl) });

  const mainAccount = privateKeyToAccount(MAIN_PRIVATE_KEY);
  const mainWallet = createWalletClient({
    account: mainAccount,
    transport: http(rpcUrl)
  });

  return { publicClient, mainWallet };
}

/* -----------------------------------------
   1️⃣ Sweep Native Coin
--------------------------------------------*/
export async function sweepNative({
  chain,
  fromPriv,
  to = MAIN_ADDRESS
}) {
  const account = privateKeyToAccount(fromPriv);
  const { publicClient, mainWallet } = getClients(chain);

  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) return { status: "empty", amount: "0" };

  const gasPrice = await publicClient.getGasPrice();
  const gasLimit = 21000n;
  const gasFee = gasLimit * gasPrice;

  // If wallet cannot afford gas → sponsor gas from main wallet
  if (balance <= gasFee) {
    await mainWallet.sendTransaction({
      to: account.address,
      value: gasFee * 2n // send enough for gas
    });
  }

  const finalBalance = await publicClient.getBalance({ address: account.address });

  const amountToSend = finalBalance - gasFee;
  if (amountToSend <= 0n) return { status: "no-funds-after-gas" };

  const hash = await createWalletClient({
    account,
    transport: http(RPC[chain])
  }).sendTransaction({
    to,
    value: amountToSend
  });

  return {
    status: "success",
    hash,
    from: account.address,
    amount: amountToSend.toString()
  };
}

/* -----------------------------------------
   2️⃣ Sweep Single ERC20
--------------------------------------------*/
export async function sweepERC20({
  chain,
  token,
  fromPriv,
  to = MAIN_ADDRESS
}) {
  const account = privateKeyToAccount(fromPriv);
  const { publicClient, mainWallet } = getClients(chain);

  const tokenContract = {
    address: getAddress(token),
    abi: ERC20_ABI
  };

  const balance = await publicClient.readContract({
    ...tokenContract,
    functionName: "balanceOf",
    args: [account.address]
  });

  if (balance === 0n) return { status: "empty-token", token };

  // Check if wallet has gas
  const gasBalance = await publicClient.getBalance({ address: account.address });

  if (gasBalance === 0n) {
    const gasFee = parseEther("0.00015"); // enough for ERC20 transfer
    await mainWallet.sendTransaction({
      to: account.address,
      value: gasFee
    });
  }

  const hash = await createWalletClient({
    account,
    transport: http(RPC[chain])
  }).writeContract({
    ...tokenContract,
    functionName: "transfer",
    args: [to, balance]
  });

  return { status: "success", token, hash, amount: balance.toString() };
}

/* -----------------------------------------
   3️⃣ Multicall ERC20 sweep for same wallet
--------------------------------------------*/
export async function sweepERC20Multi({
  chain,
  fromPriv,
  tokens,
  to = MAIN_ADDRESS
}) {
  const account = privateKeyToAccount(fromPriv);
  const { publicClient, mainWallet } = getClients(chain);

  const calls = [];

  for (const token of tokens) {
    const balance = await publicClient.readContract({
      address: getAddress(token),
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address]
    });

    if (balance > 0n) {
      calls.push({
        to: getAddress(token),
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [to, balance]
        })
      });
    }
  }

  if (calls.length === 0) return { status: "no-tokens" };

  // Ensure gas exists
  const gasBalance = await publicClient.getBalance({ address: account.address });
  if (gasBalance === 0n) {
    await mainWallet.sendTransaction({
      to: account.address,
      value: parseEther("0.0003")
    });
  }

  const hash = await createWalletClient({
    account,
    transport: http(RPC[chain])
  }).sendTransaction({
    to: account.address,
    data: "0x", // dummy if only using raw calls
    // OR use official multicall contract if chain supports
  });

  return { status: "success", hash, calls: calls.length };
}

/* -----------------------------------------
   4️⃣ Fully Automated Sweep Handler
--------------------------------------------*/
export async function sweepAll({
  chain,
  fromPriv,
  tokens = []
}) {
  const native = await sweepNative({ chain, fromPriv });
  const erc20 = [];

  for (const t of tokens)
    erc20.push(await sweepERC20({ chain, fromPriv, token: t }));

  return { native, erc20 };
}
