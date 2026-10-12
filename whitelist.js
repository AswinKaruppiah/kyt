/**
 * Known Verified Crypto Exchange Hot Wallets
 * Used to gracefully stop tracing branches because exchanges enforce KYC on deposit.
 */

const KNOWN_EXCHANGES = {
  // TRON Exchange Hot Wallets
  'TMuA6YqfCeX8EhbfYEg5y7S4DqzSJireY9': 'Binance (TRON)',
  'TNDzfERD7HBad2wGj88EnTtKaPtGHGVCbs': 'Binance Hot 2 (TRON)',
  'TJblvdjqUVz6jD6V5GfC1sYh6DqD87xYt2': 'Binance Hot 3 (TRON)',
  'TKHuVq1oKVruCGL418K87DLR457S9S5v2C': 'OKX (TRON)',
  'TLi2eyBaoE2EBp31emx32QxJ7Nq38Jt8Y7': 'Bybit (TRON)',
  'TYkBoTA32f9SMuP3oP9xL1y6pT7ZzD1L5C': 'Kraken (TRON)',
  'TXjxK92r3QeG1LzFh8Y3g7d9P5kR1w8z4F': 'HTX / Huobi (TRON)',

  // Ethereum / EVM Exchange Hot Wallets
  '0x28c6c06298d514db089934071355e5743bf21d60': 'Binance Hot 14 (Ethereum)',
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549': 'Binance Hot 15 (Ethereum)',
  '0xdfd5293d8e347dfe59e90efd55b2956a13430eb0': 'Binance Hot 16 (Ethereum)',
  '0xa910f92acdaf488fa6802474dd3973676b3ac120': 'OKX (Ethereum)',
  '0xf89d7b9c379f6ce863181c074b853ee43300855': 'Bybit (Ethereum)',
  '0x5041ed759dd4afc3a72b8192c143f72f4724081a': 'Kraken (Ethereum)',
  '0x0d0707963952f2fba59dd06f2b425ace40b492fe': 'Gate.io (Ethereum)',
  '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503': 'Binance Reserve (Ethereum)'
};

/**
 * Checks if an address belongs to a verified cryptocurrency exchange.
 * @param {string} address - TRON or EVM address
 * @returns {{ isExchange: boolean, name: string | null }}
 */
function isExchange(address) {
  if (!address || typeof address !== 'string') {
    return { isExchange: false, name: null };
  }

  const lookupKey = address.startsWith('0x') ? address.toLowerCase() : address;
  const match = KNOWN_EXCHANGES[lookupKey];

  if (match) {
    return { isExchange: true, name: match };
  }

  return { isExchange: false, name: null };
}

module.exports = { isExchange, KNOWN_EXCHANGES };
