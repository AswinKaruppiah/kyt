# 🛡️ KYT & AML Behavioral Intelligence Checker

Self-hosted, zero-cost transaction monitoring and money mule detection engine for **USDT** across **TRON (TRC-20)**, **Ethereum (ERC-20)**, and **BNB Smart Chain (BEP-20)**.

> **Full Documentation & Cost Predictions**: See the detailed breakdown in [SYSTEM_OVERVIEW.md](file:///d:/files/kyt-checker/SYSTEM_OVERVIEW.md).

---

## ⚡ Quick Start

### 1. Direct Wallet Inspection
Check any TRON or EVM wallet on-chain for Tether freezes, Chainalysis sanctions, and rapid pass-through mule behavior:
```bash
# TRON wallet
node index.js TMJPgsSS3BSrWhGTDdDgKKhwqX4grsLKFn

# EVM wallet (Ethereum)
node index.js 0x28C6c06298d514Db089934071355E5743bf21d60 eth

# EVM wallet (BSC)
node index.js 0x8894e0a0c962cb723c1976a4421c95949be2d4e3 bsc
```

### 2. Multi-Hop Backward Ancestry Trace
Trace inflows up to 3 hops backward to find dirty origins or transit mules:
```bash
# TRON 3-hop trace
node tracer.js TGGHXwH5MakCyQyWGtf7FdDsFsiSKjVaQt 3

# EVM 2-hop trace
node tracer.js 0x497c4860a269a717f20dcea8d9664018ccd49605 bsc 2
```

---

## 🔑 Key Features
- **$0 Running Cost**: Runs entirely on generous free-tier quotas (TronGrid, Alchemy) and public smart contract oracles.
- **Proactive Behavioral Blocking**: Detects laundering mules churning funds within minutes *before* Tether compliance freezes them.
- **Institutional Whitelist**: Centralized exchanges (Binance, OKX, Bybit, Kraken, Coinbase) are whitelisted to prevent false alarms on customer withdrawals.
- **Zero Data Leaks**: 100% self-hosted—no customer wallet addresses are sent to third-party commercial databases.
