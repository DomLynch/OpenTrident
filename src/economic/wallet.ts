import { createHash, randomBytes, createCipheriv, createDecipheriv, KeyObject } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolveStateDir } from "../config/paths.js";
import { resolve } from "node:path";
import crypto from "node:crypto";

const WALLET_FILE = "wallet-encrypted.json";
const KEY_SIZE = 32;
const IV_SIZE = 16;
const SALT_SIZE = 32;
const MAX_TRANSACTION_AMOUNT_SOL = 0.1;
const DAILY_SPENDING_LIMIT_SOL = 1.0;

export type WalletConfig = {
  version: number;
  address: string;
  encryptedPrivateKey: string;
  salt: string;
  iv: string;
  createdAt: number;
};

export type WalletBalance = {
  address: string;
  lamports: number;
  sol: number;
  timestamp: number;
};

export type TransactionResult = {
  signature: string;
  slot: number;
  timestamp: number;
};

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return createHash("sha512")
    .update(Buffer.from(passphrase, "utf8"))
    .update(salt)
    .digest()
    .slice(0, KEY_SIZE);
}

function encryptPrivateKey(privateKeyBytes: Buffer, passphrase: string): {
  encrypted: string;
  salt: string;
  iv: string;
} {
  const salt = randomBytes(SALT_SIZE);
  const iv = randomBytes(IV_SIZE);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(privateKeyBytes), cipher.final()]);
  return {
    encrypted: encrypted.toString("base64"),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
  };
}

function decryptPrivateKey(encrypted: string, passphrase: string, saltB64: string, ivB64: string): Buffer {
  const salt = Buffer.from(saltB64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const endpoint = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`RPC ${response.status}`);
    const data = (await response.json()) as { result?: T; error?: { message: string } };
    if (data.error) throw new Error(`RPC error: ${data.error.message}`);
    return data.result as T;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function encodeBase58(bytes: Uint8Array): string {
  const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let result = "";
  while (num > 0n) {
    result = BASE58[Number(num % 58n)] + result;
    num = num / 58n;
  }
  return result || "1";
}

function decodeBase58Check(base58: string): Uint8Array {
  const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let result = new Array(64).fill(0);
  for (let i = 0; i < base58.length; i++) {
    let carry = BASE58.indexOf(base58[i]);
    if (carry < 0) throw new Error(`Invalid base58: "${base58[i]}"`);
    for (let j = 63; j >= 0; j--) {
      carry += 58 * (result[j] || 0);
      result[j] = carry % 256;
      carry = Math.floor(carry / 256);
    }
  }
  const firstNonZero = result.findIndex((b) => b !== 0);
  return new Uint8Array(result.slice(Math.max(0, firstNonZero)));
}

async function getBalance(address: string): Promise<number> {
  return rpcCall<number>("getBalance", [address]);
}

async function getRecentBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  return rpcCall<{ blockhash: string; lastValidBlockHeight: number }>("getLatestBlockhash", []);
}

async function sendRawTransaction(serialized: string): Promise<string> {
  return rpcCall<string>("sendTransaction", [serialized, { encoding: "base64" }]);
}

function deriveEd25519PublicKey(privateKeyBytes: Buffer): Buffer {
  return createHash("sha512").update(privateKeyBytes).digest().slice(0, 32);
}

function createEd25519Signature(message: Uint8Array, privateKeyBytes: Buffer): Uint8Array {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
    privateKey: Buffer.concat([privateKeyBytes, Buffer.alloc(32)]),
    publicKey: deriveEd25519PublicKey(privateKeyBytes),
  } as crypto.KeyPairKeyObjectOptions);
  const signer = crypto.createSign("SHA512");
  signer.update(Buffer.from(message));
  return new Uint8Array(signer.sign(privateKey));
}

export async function generateWallet(passphrase: string): Promise<WalletConfig> {
  const privateKeyBytes = randomBytes(KEY_SIZE);
  const publicKeyBytes = deriveEd25519PublicKey(privateKeyBytes);
  const { encrypted, salt, iv } = encryptPrivateKey(privateKeyBytes, passphrase);
  const address = encodeBase58(publicKeyBytes);

  const stateDir = resolveStateDir();
  const walletPath = resolve(stateDir, WALLET_FILE);
  await mkdir(stateDir, { recursive: true });

  const config: WalletConfig = {
    version: 1,
    address,
    encryptedPrivateKey: encrypted,
    salt,
    iv,
    createdAt: Date.now(),
  };

  await writeFile(walletPath, JSON.stringify(config, null, 2), "utf8");
  return config;
}

export async function loadWalletKey(passphrase: string): Promise<{ address: string; privateKeyBytes: Buffer }> {
  const stateDir = resolveStateDir();
  const walletPath = resolve(stateDir, WALLET_FILE);
  const raw = await readFile(walletPath, "utf8");
  const cfg = JSON.parse(raw) as WalletConfig;
  const privateKeyBytes = decryptPrivateKey(cfg.encryptedPrivateKey, passphrase, cfg.salt, cfg.iv);
  return { address: cfg.address, privateKeyBytes };
}

export async function getWalletBalance(address?: string): Promise<WalletBalance> {
  const addr = address ?? (await getDefaultAddress());
  if (!addr) return { address: "", lamports: 0, sol: 0, timestamp: Date.now() };
  const lamports = await getBalance(addr).catch(() => 0);
  return { address: addr, lamports, sol: lamports / 1e9, timestamp: Date.now() };
}

async function sendSol(params: { to: string; amountSol: number; passphrase: string }): Promise<TransactionResult> {
  const { to, amountSol, passphrase } = params;
  if (amountSol > MAX_TRANSACTION_AMOUNT_SOL) {
    throw new Error(`Amount ${amountSol} SOL exceeds max ${MAX_TRANSACTION_AMOUNT_SOL} SOL`);
  }

  const wallet = await loadWalletKey(passphrase);
  const lamports = BigInt(Math.round(amountSol * 1e9));
  const { blockhash } = await getRecentBlockhash();
  const recentBlockhashBytes = decodeBase58Check(blockhash);
  const toBytes = decodeBase58Check(to);
  const fromBytes = decodeBase58Check(wallet.address);

  const numSignatures = 1;
  const numReadonlySigned = 1;
  const numReadonlyUnsigned = 0;
  const messageHeader = [numSignatures, numReadonlySigned, numReadonlyUnsigned];

  const txBytes: number[] = [];
  for (const b of messageHeader) txBytes.push(b);
  for (const b of fromBytes) txBytes.push(b);
  for (const b of toBytes) txBytes.push(b);
  const lamportBytes = new Uint8Array(8);
  new DataView(lamportBytes.buffer).setBigUint64(0, lamports, true);
  for (const b of lamportBytes) txBytes.push(b);
  for (const b of recentBlockhashBytes) txBytes.push(b);

  const message = new Uint8Array(txBytes);
  const signature = createEd25519Signature(message, wallet.privateKeyBytes);

  const signatureBase58 = encodeBase58(signature);
  const signatureBytes = decodeBase58Check(signatureBase58);

  const serializedTx = Buffer.concat([
    Buffer.from([numSignatures]),
    Buffer.from(signatureBytes),
    Buffer.from([0]),
    Buffer.from(message),
  ]).toString("base64");

  const signatureResult = await sendRawTransaction(serializedTx);
  const slot = await rpcCall<number>("getSlot", []);

  return { signature: signatureResult, slot, timestamp: Date.now() };
}

let cachedAddress: string | null = null;

async function getDefaultAddress(): Promise<string | null> {
  if (cachedAddress) return cachedAddress;
  const stateDir = resolveStateDir();
  const walletPath = resolve(stateDir, WALLET_FILE);
  if (!existsSync(walletPath)) return null;
  try {
    const raw = await readFile(walletPath, "utf8");
    const config = JSON.parse(raw) as WalletConfig;
    cachedAddress = config.address;
    return cachedAddress;
  } catch {
    return null;
  }
}

export async function buildEconomicContext(): Promise<string> {
  const balance = await getWalletBalance();
  return [
    "## Economic Context",
    "",
    `**Wallet:** ${balance.address || "(not configured — run /wallet-generate)"}`,
    `**Balance:** ${balance.sol.toFixed(4)} SOL`,
    `**Max/TX:** ${MAX_TRANSACTION_AMOUNT_SOL} SOL  **Daily limit:** ${DAILY_SPENDING_LIMIT_SOL} SOL`,
    "",
  ].join("\n");
}

export { MAX_TRANSACTION_AMOUNT_SOL, DAILY_SPENDING_LIMIT_SOL };
