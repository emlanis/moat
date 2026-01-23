"use client";

import Image from "next/image";
import { useState } from "react";
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  buildLeafHashes,
  computeMerkleRoot,
  hashMemo,
  toHex,
  type CommitmentPlan,
  type CommitmentRecipient,
  MockAdapter,
  SilentSwapAdapter,
} from "@moat/router";
import {
  commitBatch,
  fetchBatchCommit,
  fetchBatchCommitsByCreator,
} from "@/lib/solana/moatClient";
import { DEVNET_RPC } from "@/lib/solana/constants";

type PhantomProvider = {
  isPhantom?: boolean;
  connect: () => Promise<{ publicKey: PublicKey } | void>;
  publicKey: PublicKey | null;
  signTransaction: <T extends Transaction | VersionedTransaction>(
    transaction: T,
  ) => Promise<T>;
  signAllTransactions: <T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ) => Promise<T[]>;
};

type ConnectedPhantomProvider = Omit<PhantomProvider, "publicKey"> & {
  publicKey: PublicKey;
};

declare global {
  interface Window {
    solana?: PhantomProvider;
  }
}

type Status =
  | "idle"
  | "connecting"
  | "connected"
  | "building"
  | "sending"
  | "confirmed"
  | "error";

type Mode = "devnet-mock" | "mainnet-silentswap";

type RecipientInput = {
  recipientCaip10: string;
  amount: string;
  assetCaip19: string;
};

type WalletLike = {
  publicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(
    transaction: T,
  ) => Promise<T>;
  signAllTransactions: <T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ) => Promise<T[]>;
};

type BatchInfo = {
  pda: string;
  creator: string;
  batchId: string;
  kind: number;
  createdAt: string;
  merkleRoot: string;
  memoHash: string;
};

type CommitSnapshot = {
  batchId: bigint;
  recipients: CommitmentRecipient[];
  memo: {
    title?: string;
    note?: string;
    createdAt: string;
  };
  kind: number;
};

const MAX_U64 = BigInt("18446744073709551615");

const shortKey = (value: string) =>
  value.length > 10 ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;

const isConnectedWallet = (
  wallet: PhantomProvider,
): wallet is ConnectedPhantomProvider => wallet.publicKey !== null;

const buildProvider = (wallet: WalletLike) => {
  const connection = new Connection(DEVNET_RPC, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });
  return new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
    maxRetries: 5,
  });
};

const isBlockhashError = (message: string) =>
  message.toLowerCase().includes("blockhash not found");

const parseU64 = (value: string) => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Batch id must be a non-negative integer");
  }
  const parsed = BigInt(trimmed);
  if (parsed > MAX_U64) {
    throw new Error("Batch id exceeds u64 max");
  }
  return parsed;
};

const parseKind = (value: string) => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Kind must be a number between 0 and 255");
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
    throw new Error("Kind must be a number between 0 and 255");
  }
  return parsed;
};

const formatCreatedAt = (value: BN) => {
  let label = value.toString();
  try {
    const createdAtSeconds = value.toNumber();
    if (Number.isFinite(createdAtSeconds)) {
      label = new Date(createdAtSeconds * 1000).toISOString();
    }
  } catch {
    label = value.toString();
  }
  return label;
};

const toBatchInfo = (batch: {
  pda: PublicKey;
  creator: PublicKey;
  batchId: BN;
  kind: number;
  createdAt: BN;
  merkleRoot: Uint8Array;
  memoHash: Uint8Array;
}): BatchInfo => ({
  pda: batch.pda.toBase58(),
  creator: batch.creator.toBase58(),
  batchId: batch.batchId.toString(),
  kind: batch.kind,
  createdAt: formatCreatedAt(batch.createdAt),
  merkleRoot: toHex(batch.merkleRoot),
  memoHash: toHex(batch.memoHash),
});

export default function Page() {
  const [status, setStatus] = useState<Status>("idle");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [provider, setProvider] = useState<AnchorProvider | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [merkleRootHex, setMerkleRootHex] = useState<string | null>(null);
  const [memoHashHex, setMemoHashHex] = useState<string | null>(null);
  const [batchInfo, setBatchInfo] = useState<BatchInfo | null>(null);
  const [batchHistory, setBatchHistory] = useState<BatchInfo[]>([]);
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(
    null,
  );
  const [onchainVerificationMessage, setOnchainVerificationMessage] = useState<
    string | null
  >(null);
  const [commitSnapshot, setCommitSnapshot] = useState<CommitSnapshot | null>(
    null,
  );
  const [adapterStatus, setAdapterStatus] = useState<{
    orderId: string;
    status: string;
  } | null>(null);

  const [mode, setMode] = useState<Mode>("devnet-mock");
  const [title, setTitle] = useState("Devnet payout plan");
  const [note, setNote] = useState("");
  const [batchIdInput, setBatchIdInput] = useState("0");
  const [kindInput, setKindInput] = useState("0");
  const [recipients, setRecipients] = useState<RecipientInput[]>([
    {
      recipientCaip10: "",
      amount: "",
      assetCaip19: "",
    },
  ]);

  const isBusy =
    status === "connecting" || status === "building" || status === "sending";

  const solscanUrl = signature
    ? `https://solscan.io/tx/${encodeURIComponent(signature)}?cluster=devnet`
    : null;
  const batchAccountUrl = batchInfo
    ? `https://solscan.io/account/${encodeURIComponent(batchInfo.pda)}?cluster=devnet`
    : null;
  const batchAccountFmUrl = batchInfo
    ? `https://solana.fm/address/${encodeURIComponent(batchInfo.pda)}?cluster=devnet`
    : null;

  const statusText: Record<Status, string> = {
    idle: "idle",
    connecting: "connecting",
    connected: "connected",
    building: "building plan",
    sending: "sending",
    confirmed: "confirmed",
    error: "error",
  };

  const copyToClipboard = async (label: string, value: string) => {
    setCopyMessage(null);
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard not available");
      }
      await navigator.clipboard.writeText(value);
      setCopyMessage(`copied ${label}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setCopyMessage(`copy failed: ${msg}`);
    }
  };

  const refreshHistory = async (activeProvider: AnchorProvider) => {
    setHistoryMessage(null);
    try {
      const commits = await fetchBatchCommitsByCreator(
        activeProvider,
        activeProvider.wallet.publicKey,
      );
      const sorted = commits.sort((a, b) => b.batchId.cmp(a.batchId));
      setBatchHistory(sorted.map((batch) => toBatchInfo(batch)));
      if (sorted.length === 0) {
        setHistoryMessage("no batches yet");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setHistoryMessage(`history error: ${msg}`);
    }
  };

  const onConnect = async () => {
    try {
      setErrorMessage(null);
      setCopyMessage(null);
      setSignature(null);
      setMerkleRootHex(null);
      setMemoHashHex(null);
      setBatchInfo(null);
      setHistoryMessage(null);
      setVerificationMessage(null);
      setOnchainVerificationMessage(null);
      setCommitSnapshot(null);
      setAdapterStatus(null);
      setStatus("connecting");

      const wallet = window.solana;
      if (!wallet?.isPhantom) throw new Error("Phantom not found");

      await wallet.connect();
      if (!isConnectedWallet(wallet)) {
        throw new Error("Wallet public key missing");
      }

      setWalletAddress(wallet.publicKey.toBase58());
      const nextProvider = buildProvider(wallet);
      setProvider(nextProvider);
      setStatus("connected");
      await refreshHistory(nextProvider);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMessage(msg);
      setStatus("error");
    }
  };

  const updateRecipient = (
    index: number,
    field: keyof RecipientInput,
    value: string,
  ) => {
    setRecipients((current) =>
      current.map((recipient, idx) =>
        idx === index ? { ...recipient, [field]: value } : recipient,
      ),
    );
  };

  const addRecipient = () => {
    setRecipients((current) => [
      ...current,
      { recipientCaip10: "", amount: "", assetCaip19: "" },
    ]);
  };

  const removeRecipient = (index: number) => {
    setRecipients((current) => current.filter((_, idx) => idx !== index));
  };

  const resetDemo = () => {
    setErrorMessage(null);
    setCopyMessage(null);
    setSignature(null);
    setMerkleRootHex(null);
    setMemoHashHex(null);
    setBatchInfo(null);
    setVerificationMessage(null);
    setOnchainVerificationMessage(null);
    setCommitSnapshot(null);
    setAdapterStatus(null);
    setTitle("Devnet payout plan");
    setNote("");
    setBatchIdInput("0");
    setKindInput("0");
    setRecipients([{ recipientCaip10: "", amount: "", assetCaip19: "" }]);
    setStatus(walletAddress ? "connected" : "idle");
  };

  const onCommit = async () => {
    if (!provider || !walletAddress) {
      setErrorMessage("Connect Phantom first");
      setStatus("error");
      return;
    }

    try {
      setErrorMessage(null);
      setCopyMessage(null);
      setSignature(null);
      setMerkleRootHex(null);
      setMemoHashHex(null);
      setBatchInfo(null);
      setVerificationMessage(null);
      setOnchainVerificationMessage(null);
      setCommitSnapshot(null);
      setAdapterStatus(null);
      setStatus("building");

      const batchId = parseU64(batchIdInput);
      const kindNumber = parseKind(kindInput);

      const cleanedRecipients: CommitmentRecipient[] = recipients.map(
        (recipient) => ({
          recipientCaip10: recipient.recipientCaip10.trim(),
          amount: recipient.amount.trim(),
          assetCaip19: recipient.assetCaip19.trim(),
        }),
      );

      if (cleanedRecipients.length === 0) {
        throw new Error("Add at least one recipient");
      }

      cleanedRecipients.forEach((recipient, index) => {
        if (!recipient.recipientCaip10) {
          throw new Error(`Recipient ${index + 1} is missing CAIP-10`);
        }
        if (!recipient.amount) {
          throw new Error(`Recipient ${index + 1} is missing amount`);
        }
        if (!recipient.assetCaip19) {
          throw new Error(`Recipient ${index + 1} is missing CAIP-19`);
        }
      });

      const createdAt = new Date().toISOString();
      const memo = {
        title: title.trim() || undefined,
        note: note.trim() || undefined,
        createdAt,
      };

      const plan: CommitmentPlan = {
        id: `batch-${batchId.toString()}`,
        creator: walletAddress,
        batchId: batchId.toString(),
        recipients: cleanedRecipients,
        memo,
        mode,
      };

      const adapter =
        mode === "mainnet-silentswap"
          ? new SilentSwapAdapter()
          : new MockAdapter();
      const adapterResult = await adapter.execute(plan);
      setAdapterStatus(adapterResult);

      const leaves = await buildLeafHashes(
        walletAddress,
        batchId,
        cleanedRecipients,
      );
      const merkleRoot = await computeMerkleRoot(leaves);
      const memoHash = await hashMemo(memo);

      setMerkleRootHex(toHex(merkleRoot));
      setMemoHashHex(toHex(memoHash));
      setCommitSnapshot({
        batchId,
        recipients: cleanedRecipients,
        memo,
        kind: kindNumber,
      });

      setStatus("sending");
      const sendCommit = async (activeProvider: AnchorProvider) =>
        commitBatch(
          activeProvider,
          new BN(batchId.toString()),
          merkleRoot,
          memoHash,
          kindNumber,
        );

      const finalize = async (activeProvider: AnchorProvider) => {
        const signatureValue = await sendCommit(activeProvider);
        setSignature(signatureValue);
        const batch = await fetchBatchCommit(
          activeProvider,
          activeProvider.wallet.publicKey,
          new BN(batchId.toString()),
        );
        setBatchInfo(toBatchInfo(batch));
        await refreshHistory(activeProvider);
        setStatus("confirmed");
      };

      try {
        await finalize(provider);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isBlockhashError(msg)) {
          const refreshedProvider = buildProvider(provider.wallet);
          setProvider(refreshedProvider);
          await finalize(refreshedProvider);
        } else {
          throw e;
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMessage(msg);
      setStatus("error");
    }
  };

  const onExportPlan = () => {
    if (!commitSnapshot || !merkleRootHex || !memoHashHex) {
      setErrorMessage("No committed batch to export");
      return;
    }
    const payload = {
      plan: {
        id: `batch-${commitSnapshot.batchId.toString()}`,
        creator: walletAddress,
        batchId: commitSnapshot.batchId.toString(),
        recipients: commitSnapshot.recipients,
        memo: commitSnapshot.memo,
        kind: commitSnapshot.kind,
      },
      merkleRoot: merkleRootHex,
      memoHash: memoHashHex,
      signature: signature ?? null,
      batchPda: batchInfo?.pda ?? null,
      mode,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `moat_commit_batch_${commitSnapshot.batchId.toString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const onVerify = async () => {
    if (!walletAddress || !commitSnapshot) {
      setVerificationMessage("No committed batch to verify");
      return;
    }
    try {
      setVerificationMessage(null);
      const leaves = await buildLeafHashes(
        walletAddress,
        commitSnapshot.batchId,
        commitSnapshot.recipients,
      );
      const merkleRoot = await computeMerkleRoot(leaves);
      const memoHash = await hashMemo(commitSnapshot.memo);
      const merkleHex = toHex(merkleRoot);
      const memoHex = toHex(memoHash);

      if (merkleHex !== merkleRootHex || memoHex !== memoHashHex) {
        setVerificationMessage("verification failed: hash mismatch");
      } else {
        setVerificationMessage("verification passed: hashes match");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setVerificationMessage(`verification error: ${msg}`);
    }
  };

  const onVerifyOnchain = async () => {
    if (!provider || !walletAddress || !commitSnapshot) {
      setOnchainVerificationMessage("No committed batch to verify");
      return;
    }
    try {
      setOnchainVerificationMessage(null);
      const leaves = await buildLeafHashes(
        walletAddress,
        commitSnapshot.batchId,
        commitSnapshot.recipients,
      );
      const merkleRoot = await computeMerkleRoot(leaves);
      const memoHash = await hashMemo(commitSnapshot.memo);
      const batch = await fetchBatchCommit(
        provider,
        provider.wallet.publicKey,
        new BN(commitSnapshot.batchId.toString()),
      );
      const onchainRoot = toHex(batch.merkleRoot);
      const onchainMemo = toHex(batch.memoHash);
      if (toHex(merkleRoot) !== onchainRoot || toHex(memoHash) !== onchainMemo) {
        setOnchainVerificationMessage("on-chain verification failed: mismatch");
      } else {
        setOnchainVerificationMessage("on-chain verification passed");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setOnchainVerificationMessage(`on-chain verification error: ${msg}`);
    }
  };

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Image
          src="/moat_logo.png"
          alt="Moat logo"
          width={128}
          height={128}
          priority
        />
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 700 }}>Moat Registry</h1>
          <p style={{ opacity: 0.8 }}>
            Devnet proof layer: commit_batch (payout commitments)
          </p>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={{ fontSize: 13, opacity: 0.8 }}>Mode</label>
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as Mode)}
          style={{
            marginTop: 6,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #333",
            background: "transparent",
            color: "inherit",
          }}
        >
          <option value="devnet-mock">devnet-mock</option>
          <option value="mainnet-silentswap">mainnet-silentswap</option>
        </select>
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
          devnet-mock simulates a swap locally; mainnet-silentswap is a stub until
          live connectivity is enabled.
        </div>
      </div>

      <button
        onClick={onConnect}
        disabled={isBusy}
        style={{
          marginTop: 16,
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #222",
          fontWeight: 600,
          cursor: isBusy ? "not-allowed" : "pointer",
          opacity: isBusy ? 0.6 : 1,
        }}
      >
        Connect Phantom
      </button>

      <div style={{ marginTop: 16, fontFamily: "monospace", fontSize: 13 }}>
        status: {statusText[status]}
      </div>

      {walletAddress && (
        <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 13 }}>
          wallet: {shortKey(walletAddress)}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 14, marginBottom: 6 }}>Payout plan</div>
        <div style={{ display: "grid", gap: 10 }}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title"
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #333",
              background: "transparent",
              color: "inherit",
              fontFamily: "monospace",
            }}
          />
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Note (optional)"
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #333",
              background: "transparent",
              color: "inherit",
              fontFamily: "monospace",
            }}
          />
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
            <input
              value={batchIdInput}
              onChange={(event) => setBatchIdInput(event.target.value)}
              placeholder="Batch ID (u64)"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #333",
                background: "transparent",
                color: "inherit",
                fontFamily: "monospace",
              }}
            />
            <input
              value={kindInput}
              onChange={(event) => setKindInput(event.target.value)}
              placeholder="Kind (0-255)"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #333",
                background: "transparent",
                color: "inherit",
                fontFamily: "monospace",
              }}
            />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 14, marginBottom: 6 }}>Recipients</div>
        <div style={{ display: "grid", gap: 10 }}>
          {recipients.map((recipient, index) => (
            <div
              key={`recipient-${index}`}
              style={{
                border: "1px solid #222",
                borderRadius: 10,
                padding: 10,
                display: "grid",
                gap: 8,
              }}
            >
              <input
                value={recipient.recipientCaip10}
                onChange={(event) =>
                  updateRecipient(index, "recipientCaip10", event.target.value)
                }
                placeholder="Recipient CAIP-10 (e.g. solana:devnet:...)"
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: "transparent",
                  color: "inherit",
                  fontFamily: "monospace",
                }}
              />
              <input
                value={recipient.amount}
                onChange={(event) =>
                  updateRecipient(index, "amount", event.target.value)
                }
                placeholder="Amount (string)"
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: "transparent",
                  color: "inherit",
                  fontFamily: "monospace",
                }}
              />
              <input
                value={recipient.assetCaip19}
                onChange={(event) =>
                  updateRecipient(index, "assetCaip19", event.target.value)
                }
                placeholder="Asset CAIP-19 (e.g. solana:devnet:So111...)"
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: "transparent",
                  color: "inherit",
                  fontFamily: "monospace",
                }}
              />
              {recipients.length > 1 && (
                <button
                  onClick={() => removeRecipient(index)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #333",
                    background: "transparent",
                    color: "inherit",
                    fontSize: 12,
                  }}
                >
                  Remove recipient
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={addRecipient}
          style={{
            marginTop: 10,
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid #222",
            fontWeight: 600,
          }}
        >
          Add recipient
        </button>
      </div>

      <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={onCommit}
          disabled={isBusy || !provider}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #222",
            fontWeight: 600,
            cursor: isBusy || !provider ? "not-allowed" : "pointer",
            opacity: isBusy || !provider ? 0.6 : 1,
          }}
        >
          Commit Batch
        </button>
        <button
          onClick={resetDemo}
          disabled={isBusy}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #222",
            fontWeight: 600,
            cursor: isBusy ? "not-allowed" : "pointer",
            opacity: isBusy ? 0.6 : 1,
            background: "transparent",
            color: "inherit",
          }}
        >
          Reset demo state
        </button>
      </div>

      {signature && (
        <div style={{ marginTop: 12, fontFamily: "monospace", fontSize: 13 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div>signature: {signature}</div>
            <button
              onClick={() => copyToClipboard("signature", signature)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #333",
                fontSize: 12,
                background: "transparent",
                color: "inherit",
              }}
            >
              Copy
            </button>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <a href={solscanUrl ?? "#"} target="_blank" rel="noreferrer">
              View on Solscan
            </a>
            <button
              onClick={onExportPlan}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #333",
                fontSize: 12,
                background: "transparent",
                color: "inherit",
              }}
            >
              Export plan JSON
            </button>
          </div>
        </div>
      )}

      {batchInfo && (
        <div style={{ marginTop: 12, fontFamily: "monospace", fontSize: 13 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div>batch PDA: {batchInfo.pda}</div>
            <button
              onClick={() => copyToClipboard("batch PDA", batchInfo.pda)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #333",
                fontSize: 12,
                background: "transparent",
                color: "inherit",
              }}
            >
              Copy
            </button>
          </div>
          <div>creator: {shortKey(batchInfo.creator)}</div>
          <div>batch_id: {batchInfo.batchId}</div>
          <div>kind: {batchInfo.kind}</div>
          <div>created_at: {batchInfo.createdAt}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div>onchain merkle_root: {batchInfo.merkleRoot}</div>
            <button
              onClick={() =>
                copyToClipboard("onchain merkle_root", batchInfo.merkleRoot)
              }
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #333",
                fontSize: 12,
                background: "transparent",
                color: "inherit",
              }}
            >
              Copy
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div>onchain memo_hash: {batchInfo.memoHash}</div>
            <button
              onClick={() =>
                copyToClipboard("onchain memo_hash", batchInfo.memoHash)
              }
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #333",
                fontSize: 12,
                background: "transparent",
                color: "inherit",
              }}
            >
              Copy
            </button>
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
            {batchAccountUrl && (
              <a href={batchAccountUrl} target="_blank" rel="noreferrer">
                View batch account on Solscan
              </a>
            )}
            {batchAccountFmUrl && (
              <a href={batchAccountFmUrl} target="_blank" rel="noreferrer">
                View PDA on Solana.fm
              </a>
            )}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={onVerify}
              disabled={!commitSnapshot}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #222",
                fontWeight: 600,
              }}
            >
              Verify locally
            </button>
            <button
              onClick={onVerifyOnchain}
              disabled={!commitSnapshot || !provider}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #222",
                fontWeight: 600,
              }}
            >
              Verify on-chain
            </button>
          </div>
        </div>
      )}

      {adapterStatus && (
        <div style={{ marginTop: 12, fontFamily: "monospace", fontSize: 13 }}>
          <div>adapter order: {adapterStatus.orderId}</div>
          <div>adapter status: {adapterStatus.status}</div>
        </div>
      )}

      {merkleRootHex && (
        <div style={{ marginTop: 12, fontFamily: "monospace", fontSize: 13 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div>merkle_root: {merkleRootHex}</div>
            <button
              onClick={() => copyToClipboard("merkle_root", merkleRootHex)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #333",
                fontSize: 12,
                background: "transparent",
                color: "inherit",
              }}
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {memoHashHex && (
        <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 13 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div>memo_hash: {memoHashHex}</div>
            <button
              onClick={() => copyToClipboard("memo_hash", memoHashHex)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #333",
                fontSize: 12,
                background: "transparent",
                color: "inherit",
              }}
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {copyMessage && (
        <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 13 }}>
          {copyMessage}
        </div>
      )}

      {verificationMessage && (
        <div style={{ marginTop: 10, fontFamily: "monospace", fontSize: 13 }}>
          {verificationMessage}
        </div>
      )}

      {onchainVerificationMessage && (
        <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 13 }}>
          {onchainVerificationMessage}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 14, marginBottom: 6 }}>Batch history</div>
        <button
          onClick={() => (provider ? refreshHistory(provider) : null)}
          disabled={!provider || isBusy}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #222",
            background: "transparent",
            color: "inherit",
            fontSize: 12,
            cursor: !provider || isBusy ? "not-allowed" : "pointer",
            opacity: !provider || isBusy ? 0.6 : 1,
          }}
        >
          Refresh history
        </button>
        {historyMessage && (
          <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 13 }}>
            {historyMessage}
          </div>
        )}
        {batchHistory.length > 0 && (
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {batchHistory.map((entry) => (
              <div
                key={entry.pda}
                style={{
                  border: "1px solid #222",
                  borderRadius: 10,
                  padding: 10,
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              >
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <div>batch_id: {entry.batchId}</div>
                  <div>kind: {entry.kind}</div>
                </div>
                <div>pda: {shortKey(entry.pda)}</div>
                <div>created_at: {entry.createdAt}</div>
                <div style={{ marginTop: 6, display: "flex", gap: 10 }}>
                  <a
                    href={`https://solscan.io/account/${encodeURIComponent(entry.pda)}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Solscan
                  </a>
                  <a
                    href={`https://solana.fm/address/${encodeURIComponent(entry.pda)}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Solana.fm
                  </a>
                  <button
                    onClick={() => copyToClipboard("batch PDA", entry.pda)}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid #333",
                      fontSize: 12,
                      background: "transparent",
                      color: "inherit",
                    }}
                  >
                    Copy PDA
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {errorMessage && (
        <div style={{ marginTop: 12, color: "#b00020" }}>
          error: {errorMessage}
        </div>
      )}
    </main>
  );
}
