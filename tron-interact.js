const { TronWeb } = require("tronweb");
const erc20Abi = require("./src/erc20Abi.json");
const { tronClients } = require("./src/providers");

const tronWeb = new TronWeb({
    fullHost: 'https://api.shasta.trongrid.io',
    privateKey: 'b03a5d4560f61fd2cf94a9a25f7a2f5667dba9dfd08756eedf907f9ec5df984a'
});
const decimalsTest = async () => {
    // let contract = await tronWeb.contract(erc20Abi, 'TNo2TQh5w1b5zC8zv1ByLp3preeNZR1ZSE');
    let contract = await tronClients["tron-shasta"].contract(erc20Abi, 'TNo2TQh5w1b5zC8zv1ByLp3preeNZR1ZSE');
    let result = await contract.decimals().call();
    let result2 = await contract.balanceOf('TPassvsx2d3qadHU5a9LyAtx1btZDU7ejr').call();
    console.log(result)
    console.log(result2)
}
decimalsTest()