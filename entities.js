/**
 * Known Regulated Entities & Centralized Exchange (CEX) Hot Wallets
 * Covers major institutional hot wallets and treasuries processing USDT on TRON, Ethereum, and BSC.
 * When the tracer encounters these entities, it safely stops backtracking down that branch.
 */

const KNOWN_ENTITIES = {
  // ==========================================
  // 1. TRON (TRC-20 USDT) Hot Wallets & Treasuries
  // ==========================================
  'tdqsquxbguclvvyc4xzgrprlk589dkhscf': { name: 'Binance (Hot Wallet 7)', type: 'CEX' },
  'tpymhehy5n8tcefygeqw2rpxsghsfzghpdn': { name: 'Binance (Hot Wallet)', type: 'CEX' },
  'tmua6yqfcex8ehbfyeg5ys4dqzsjirey9': { name: 'Binance (Hot Wallet)', type: 'CEX' },
  'tla2f6vpqdgre67v1736s7bj8ray5wyju7': { name: 'Binance (Cold/Reserve)', type: 'CEX' },
  'tkhuvq1okvrucglvqvxs6dawkv6fqgfs': { name: 'Tether Treasury (TRON)', type: 'TREASURY' },
  'trdfd4j3ddsmv5nu5hfdvwzqa4mls3xdiv': { name: 'OKX (Reserve)', type: 'CEX' },
  'tpsmj3be9ixsq7gufbvlz4eou6satbsqhh': { name: 'Bybit (Hot Wallet)', type: 'CEX' },
  'trli4kskhxfacnxkzlrf2wnhauwuqpwzin': { name: 'Tether MultiSig Signer (TRON)', type: 'TREASURY' },
  'tbpxhvasuzofnkytcto12uyseydphgatto': { name: 'Tether Master MultiSig Contract', type: 'TREASURY' },

  // ==========================================
  // 2. Ethereum (ERC-20 USDT) & BSC Hot Wallets
  // ==========================================
  // Binance
  '0x28c6c06298d514db089934071355e5743bf21d60': { name: 'Binance 14', type: 'CEX' },
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549': { name: 'Binance 15', type: 'CEX' },
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d': { name: 'Binance 16', type: 'CEX' },
  '0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be': { name: 'Binance 1', type: 'CEX' },
  '0x8894e0a0c962cb723c1976a4421c95949be2d4e3': { name: 'Binance (BSC Hot 6)', type: 'CEX' },
  '0xf977814e90da44bfa03b6295a0616a897441acec': { name: 'Binance (BSC/ETH Hot 8)', type: 'CEX' },
  '0x5a52e96bacdabb82fd05763e25335261b270efcb': { name: 'Binance (Hot 10)', type: 'CEX' },
  '0xd85370f0322312b9d073998b584742f1cf57a701': { name: 'Binance (Hot 14)', type: 'CEX' },

  // OKX
  '0x6cc5f688a30d370e237a314a7ce624b99e9f9f7e': { name: 'OKX 3', type: 'CEX' },
  '0xa7ef43a2bfb6513d3718023f540707cb10b6f1a7': { name: 'OKX Hot', type: 'CEX' },
  '0x5041ed759dd4afc3a72b8192c143f72f4724081a': { name: 'OKX 2', type: 'CEX' },

  // Bybit
  '0xf89d7b9c372f2561083e74744728552763073725': { name: 'Bybit Hot', type: 'CEX' },
  '0x1db92e2e88acda2bf92f38c488f35c24d3e646a9': { name: 'Bybit 2', type: 'CEX' },

  // Coinbase
  '0xa090e606e30bd747d4e6245a1517ebe430f0057e': { name: 'Coinbase 1', type: 'CEX' },
  '0x503828934d239051b47e614725636b347895ebe2': { name: 'Coinbase 2', type: 'CEX' },
  '0x71660c4005ba85c37ccec55d0c4493e66fe775d3': { name: 'Coinbase Hot', type: 'CEX' },

  // Kraken
  '0x2910543af39aba0cd09dbb2d50200b3e800a63d2': { name: 'Kraken 1', type: 'CEX' },

  // Bitfinex
  '0x876eabf441b2ee5b5b0554fd502a8e0600950cfa': { name: 'Bitfinex 1', type: 'CEX' },
  '0x77134cbc06cb00b66f4c7e623d5fdbf6777635ec': { name: 'Bitfinex 2', type: 'CEX' },

  // Tether Treasury
  '0x5754284f345afc66a98fbb0a0afe71e0f007b949': { name: 'Tether Treasury (ERC-20)', type: 'TREASURY' }
};

/**
 * Check if an address belongs to a verified institutional exchange or treasury.
 * @param {string} address - TRON or EVM address
 * @returns {{ name: string, type: string } | null}
 */
function getKnownEntity(address) {
  if (!address || typeof address !== 'string') return null;
  return KNOWN_ENTITIES[address.trim().toLowerCase()] || null;
}

module.exports = { getKnownEntity, KNOWN_ENTITIES };
