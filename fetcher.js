/**
 * Blockchain Inflow Feeder
 * Retrieves recent incoming token transfers (USDT / USDC) for TRON and EVM (Ethereum / BSC) wallets.
 */

// --- Configuration & API Keys ---
const TRON_API_KEY = 'cd864a5c-18c6-4015-b32e-f1bc31840ad7';
const BSCSCAN_API_KEY = ''; // Paste your free BscScan API key here (https://bscscan.com/myapikey)

const TRON_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const ETH_USDT_CONTRACT = '0xdac17f958d2ee523a2206206994597C13D831ec7';
const ETH_USDC_CONTRACT = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const BSC_USDT_CONTRACT = '0x55d398326f99059ff775485246999027b3197955';
const BSC_USDC_CONTRACT = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';

/**
 * Fetch incoming TRC-20 USDT transfers for a TRON wallet.
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
 * Fetch incoming ERC-20 / BEP-20 (USDT / USDC) transfers for an EVM wallet (Ethereum & BSC).
 */
async function fetchEvmInflows(evmAddress, minAmount = 5, limit = 15) {
  const cleanAddr = evmAddress.toLowerCase();
  const results = [];

  // 1. Ethereum transfers via Blockscout (100% free, no key needed)
  try {
    const url = `https://eth.blockscout.com/api?module=account&action=tokentx&address=${cleanAddr}&offset=${limit}`;
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.result)) {
        for (const tx of json.result) {
          if (!tx.to || tx.to.toLowerCase() !== cleanAddr) continue;
          if (!tx.from || tx.from.toLowerCase() === cleanAddr) continue;

          const contract = (tx.contractAddress || '').toLowerCase();
          const symbol = tx.tokenSymbol || '';
          const decimals = Number(tx.tokenDecimal || 6);

          const isUsdt = contract === ETH_USDT_CONTRACT || symbol === 'USDT';
          const isUsdc = contract === ETH_USDC_CONTRACT || symbol === 'USDC';

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
      }
    }
  } catch (_) {}

  // 2. BSC transfers via BscScan (if BSCSCAN_API_KEY configured at top of file)
  if (BSCSCAN_API_KEY) {
    try {
      const url = `https://api.bscscan.com/api?module=account&action=tokentx&address=${cleanAddr}&offset=${limit}&sort=desc&apikey=${BSCSCAN_API_KEY}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.result)) {
          for (const tx of json.result) {
            if (!tx.to || tx.to.toLowerCase() !== cleanAddr) continue;
            if (!tx.from || tx.from.toLowerCase() === cleanAddr) continue;

            const contract = (tx.contractAddress || '').toLowerCase();
            const symbol = (tx.tokenSymbol || '').toUpperCase();
            const decimals = Number(tx.tokenDecimal || 18);

            const isUsdt = contract === BSC_USDT_CONTRACT || symbol === 'USDT' || symbol === 'BSC-USD';
            const isUsdc = contract === BSC_USDC_CONTRACT || symbol === 'USDC';

            if (isUsdt || isUsdc) {
              const rawValue = BigInt(tx.value || 0);
              const amount = Number(rawValue) / (10 ** decimals);

              if (amount >= minAmount) {
                results.push({
                  from: tx.from,
                  to: tx.to,
                  amount: Math.round(amount * 100) / 100,
                  token: isUsdt ? 'USDT (BEP-20 / BSC)' : 'USDC (BEP-20 / BSC)',
                  txHash: tx.hash,
                  timestamp: Number(tx.timeStamp) * 1000
                });
              }
            }
          }
        }
      }
    } catch (_) {}
  }

  // Sort combined inflows by largest amount first
  results.sort((a, b) => b.amount - a.amount);
  return results.slice(0, limit);
}

/**
 * Universal Inflows Feeder: auto-detects TRON or EVM address.
 */
async function getIncomingTransfers(address, minAmount = 5, limit = 10) {
  if (!address || typeof address !== 'string') return [];
  const cleanAddr = address.trim();

  if (cleanAddr.startsWith('T') && cleanAddr.length === 34) {
    return fetchTronInflows(cleanAddr, minAmount, limit);
  }

  if (cleanAddr.startsWith('0x') && cleanAddr.length === 42) {
    return fetchEvmInflows(cleanAddr, minAmount, limit);
  }

  return [];
}

module.exports = { getIncomingTransfers };
