/**
 * Blockchain Inflow Feeder
 * Retrieves recent incoming token transfers (USDT / USDC) for TRON and EVM (Ethereum / BSC) wallets.
 * Powered by TronGrid (for TRON) and Alchemy Asset Transfers API (for Ethereum & BSC).
 */

// --- Configuration & API Keys ---
const TRON_API_KEY = 'cd864a5c-18c6-4015-b32e-f1bc31840ad7';
const ALCHEMY_API_KEY = ''; // Paste your free Alchemy API key here (https://www.alchemy.com)

const TRON_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const ETH_USDT_CONTRACT = '0xdac17f958d2ee523a2206206994597C13D831ec7';
const ETH_USDC_CONTRACT = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const BSC_USDT_CONTRACT = '0x55d398326f99059ff775485246999027b3197955';
const BSC_USDC_CONTRACT = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';

/**
 * Fetch incoming TRC-20 USDT transfers for a TRON wallet via TronGrid.
 */
async function fetchTronInflows(tronAddress, minAmount = 5, limit = 50) {
  const url = `https://api.trongrid.io/v1/accounts/${tronAddress}/transactions/trc20?limit=${limit}`;
  const res = await fetch(url, {
    headers: {
      'TRON-PRO-API-KEY': TRON_API_KEY
    }
  });
  if (!res.ok) {
    throw new Error(`TronGrid Inflows HTTP error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (!json.data || !Array.isArray(json.data)) return [];

  const results = [];
  for (const tx of json.data) {
    if (tx.to !== tronAddress) continue;
    if (!tx.from || tx.from === tronAddress) continue;

    const symbol = tx.token_info?.symbol || 'UNKNOWN';
    const decimals = tx.token_info?.decimals || 6;
    const rawValue = BigInt(tx.value || 0);
    const amount = Number(rawValue) / (10 ** decimals);

    if (symbol === 'USDT' && amount >= minAmount) {
      results.push({
        from: tx.from,
        to: tx.to,
        amount: Math.round(amount * 100) / 100,
        token: 'USDT (TRC-20)',
        txHash: tx.transaction_id,
        timestamp: tx.block_timestamp
      });
    }
  }

  return results;
}

/**
 * Fetch incoming transfers via Alchemy Asset Transfers API (for Ethereum or BSC).
 * @param {string} rpcUrl - Alchemy endpoint (eth-mainnet or bnb-mainnet)
 * @param {string} evmAddress - Target wallet
 * @param {string[]} contractAddresses - Filter token contracts (USDT, USDC)
 * @param {string} chainLabel - e.g. "Ethereum" or "BSC"
 * @param {number} minAmount - Minimum threshold
 * @param {number} limit - Transfer limit
 */
async function fetchAlchemyTransfers(rpcUrl, evmAddress, contractAddresses, chainLabel, minAmount = 5, limit = 15) {
  if (!ALCHEMY_API_KEY) return [];

  try {
    const cleanAddr = evmAddress.toLowerCase();
    const hexLimit = '0x' + Math.min(limit, 50).toString(16);

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'alchemy_getAssetTransfers',
        params: [{
          fromBlock: '0x0',
          toBlock: 'latest',
          toAddress: cleanAddr,
          contractAddresses: contractAddresses,
          category: ['erc20'],
          withMetadata: true,
          maxCount: hexLimit
        }]
      })
    });

    if (!res.ok) return [];
    const json = await res.json();
    const transfers = json.result?.transfers;
    if (!Array.isArray(transfers)) return [];

    const results = [];
    for (const tx of transfers) {
      if (!tx.from || tx.from.toLowerCase() === cleanAddr) continue;

      const amount = Number(tx.value || 0);
      if (amount >= minAmount) {
        const symbol = tx.asset || 'USDT';
        const timestamp = tx.metadata?.blockTimestamp
          ? new Date(tx.metadata.blockTimestamp).getTime()
          : Date.now();

        results.push({
          from: tx.from,
          to: tx.to,
          amount: Math.round(amount * 100) / 100,
          token: `${symbol} (${chainLabel})`,
          txHash: tx.hash,
          timestamp: timestamp
        });
      }
    }

    return results;
  } catch (_) {
    return [];
  }
}

/**
 * Fallback: Fetch incoming ERC-20 transfers from Blockscout (zero API key) if no Alchemy key.
 */
async function fetchBlockscoutFallback(evmAddress, minAmount = 5, limit = 15) {
  try {
    const cleanAddr = evmAddress.toLowerCase();
    const url = `https://eth.blockscout.com/api?module=account&action=tokentx&address=${cleanAddr}&offset=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const json = await res.json();
    if (!json.result || !Array.isArray(json.result)) return [];

    const results = [];
    for (const tx of json.result) {
      if (!tx.to || tx.to.toLowerCase() !== cleanAddr) continue;
      if (!tx.from || tx.from.toLowerCase() === cleanAddr) continue;

      const contract = (tx.contractAddress || '').toLowerCase();
      const symbol = tx.tokenSymbol || '';
      const decimals = Number(tx.tokenDecimal || 6);

      const isUsdt = contract === ETH_USDT_CONTRACT.toLowerCase() || symbol === 'USDT';
      const isUsdc = contract === ETH_USDC_CONTRACT.toLowerCase() || symbol === 'USDC';

      if (isUsdt || isUsdc) {
        const rawValue = BigInt(tx.value || 0);
        const amount = Number(rawValue) / (10 ** decimals);

        if (amount >= minAmount) {
          results.push({
            from: tx.from,
            to: tx.to,
            amount: Math.round(amount * 100) / 100,
            token: isUsdt ? 'USDT (ERC-20)' : 'USDC (ERC-20)',
            txHash: tx.hash,
            timestamp: Number(tx.timeStamp) * 1000
          });
        }
      }
    }

    return results;
  } catch (_) {
    return [];
  }
}

/**
 * Fetch incoming transfers for an EVM wallet (queries only the selected chain to reduce load).
 * @param {string} evmAddress
 * @param {number} minAmount
 * @param {number} limit
 * @param {string} chain - 'eth' or 'bsc' (default: 'eth')
 */
async function fetchEvmInflows(evmAddress, minAmount = 5, limit = 15, chain = 'eth') {
  const cleanAddr = evmAddress.toLowerCase();
  const isBsc = chain === 'bsc' || chain === '2';

  // If Alchemy API Key is configured, query ONLY the selected chain
  if (ALCHEMY_API_KEY) {
    if (isBsc) {
      const bscEndpoint = `https://bnb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
      return fetchAlchemyTransfers(bscEndpoint, cleanAddr, [BSC_USDT_CONTRACT, BSC_USDC_CONTRACT], 'BEP-20 / BSC', minAmount, limit);
    } else {
      const ethEndpoint = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
      return fetchAlchemyTransfers(ethEndpoint, cleanAddr, [ETH_USDT_CONTRACT, ETH_USDC_CONTRACT], 'Ethereum', minAmount, limit);
    }
  }

  // Fallback: If no Alchemy key is set, use open Blockscout for Ethereum
  if (!isBsc) {
    return fetchBlockscoutFallback(cleanAddr, minAmount, limit);
  }

  return [];
}

/**
 * Universal Inflows Feeder: auto-detects TRON or EVM (Ethereum / BSC) address.
 * @param {string} address
 * @param {number} minAmount
 * @param {number} limit
 * @param {string} [chain] - Optional: 'eth', 'bsc', or 'all'
 */
async function getIncomingTransfers(address, minAmount = 5, limit = 10, chain = 'all') {
  if (!address || typeof address !== 'string') return [];
  const cleanAddr = address.trim();

  // TRON address check (Starts with 'T', 34 characters) -> Uses TronGrid
  if (cleanAddr.startsWith('T') && cleanAddr.length === 34) {
    return fetchTronInflows(cleanAddr, minAmount, limit);
  }

  // EVM address check (Starts with '0x', 42 characters) -> Filters by chosen chain (eth / bsc / all)
  if (cleanAddr.startsWith('0x') && cleanAddr.length === 42) {
    return fetchEvmInflows(cleanAddr, minAmount, limit, chain);
  }

  return [];
}

module.exports = { getIncomingTransfers };
