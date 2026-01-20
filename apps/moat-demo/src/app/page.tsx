// How to run:
// 1) pnpm --filter moat-demo dev
// 2) Click "Connect Phantom + Initialize"
// 3) Fill Target Program ID + Kind, then click "Register Entry"
// 4) See the entry listed + Solscan link for the tx
"use client";

import { useState } from "react";
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  callInitialize,
  fetchEntries,
  fetchRegistryState,
  registerEntry,
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
  | "sending"
  | "registering"
  | "loading"
  | "confirmed"
  | "error";

const shortKey = (value: string) =>
  value.length > 8 ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;

const isConnectedWallet = (
  wallet: PhantomProvider,
): wallet is ConnectedPhantomProvider => wallet.publicKey !== null;

export default function Page() {
  const [status, setStatus] = useState<Status>("idle");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [registryState, setRegistryState] = useState<{
    admin: string;
    nextId: string;
    bump: number;
  } | null>(null);
  const [entries, setEntries] = useState<
    Array<{
      id: number;
      kind: number;
      targetProgram: string;
      admin: string;
    }>
  >([]);
  const [provider, setProvider] = useState<AnchorProvider | null>(null);
  const [targetProgramId, setTargetProgramId] = useState("");
  const [kindInput, setKindInput] = useState("0");

  const isBusy =
    status === "connecting" ||
    status === "sending" ||
    status === "registering" ||
    status === "loading";
  const explorerUrl = signature
    ? `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`
    : null;
  const solscanUrl = signature
    ? `https://solscan.io/tx/${encodeURIComponent(signature)}?cluster=devnet`
    : null;

  const canRegister =
    Boolean(provider) && targetProgramId.trim().length > 0 && !isBusy;

  const loadRegistryData = async (activeProvider: AnchorProvider) => {
    setStatus("loading");
    const state = await fetchRegistryState(activeProvider);
    setRegistryState({
      admin: state.admin.toBase58(),
      nextId: state.nextId.toString(),
      bump: state.bump,
    });
    const onchainEntries = await fetchEntries(activeProvider);
    setEntries(
      onchainEntries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        targetProgram: entry.targetProgram.toBase58(),
        admin: entry.admin.toBase58(),
      })),
    );
    setStatus("confirmed");
  };

  async function onClickConnect() {
    try {
      setErrorMessage(null);
      setInfoMessage(null);
      setSignature(null);
      setRegistryState(null);
      setEntries([]);
      setStatus("connecting");

      const wallet = window.solana;
      if (!wallet?.isPhantom) throw new Error("Phantom not found");

      await wallet.connect();
      if (!isConnectedWallet(wallet))
        throw new Error("Wallet public key missing");
      setWalletAddress(wallet.publicKey.toBase58());
      const connectedWallet = wallet;

      const connection = new Connection(DEVNET_RPC, "confirmed");
      const nextProvider = new AnchorProvider(connection, connectedWallet, {
        commitment: "confirmed",
      });
      setProvider(nextProvider);

      setStatus("sending");
      try {
        const sig = await callInitialize(nextProvider);
        setSignature(sig);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "Registry already initialized on devnet") {
          setInfoMessage(msg);
        } else {
          throw e;
        }
      }

      await loadRegistryData(nextProvider);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMessage(msg);
      setStatus("error");
    }
  }

  async function onClickRegister() {
    if (!provider) {
      setErrorMessage("Connect Phantom first");
      setStatus("error");
      return;
    }
    try {
      setErrorMessage(null);
      setInfoMessage(null);
      setSignature(null);
      setStatus("registering");

      const kindNumber = Number(kindInput);
      const sig = await registerEntry(provider, targetProgramId, kindNumber);
      setSignature(sig);
      await loadRegistryData(provider);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMessage(msg);
      setStatus("error");
    }
  }

  const statusText: Record<Status, string> = {
    idle: "idle",
    connecting: "connecting",
    sending: "sending",
    registering: "registering",
    loading: "loading registry",
    confirmed: "confirmed",
    error: "error",
  };

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 32, fontWeight: 700 }}>Moat Registry</h1>
      <p style={{ opacity: 0.8 }}>Devnet call: initialize()</p>

      <button
        onClick={onClickConnect}
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
        Connect Phantom + Initialize
      </button>

      <div style={{ marginTop: 16, fontFamily: "monospace", fontSize: 13 }}>
        status: {statusText[status]}
      </div>

      {walletAddress && (
        <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 13 }}>
          wallet: {shortKey(walletAddress)}
        </div>
      )}

      {provider && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 14, marginBottom: 6 }}>
            Register a new entry
          </div>
          <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
            <input
              value={targetProgramId}
              onChange={(event) => setTargetProgramId(event.target.value)}
              placeholder="Target Program ID"
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
            <button
              onClick={onClickRegister}
              disabled={!canRegister}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #222",
                fontWeight: 600,
                cursor: canRegister ? "pointer" : "not-allowed",
                opacity: canRegister ? 1 : 0.6,
              }}
            >
              Register Entry
            </button>
          </div>
        </div>
      )}

      {signature && (
        <div style={{ marginTop: 12, fontFamily: "monospace", fontSize: 13 }}>
          <div>signature: {signature}</div>
          <a
            href={solscanUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
          >
            View on Solscan
          </a>
          {" | "}
          <a href={explorerUrl ?? "#"} target="_blank" rel="noreferrer">
            View on Explorer
          </a>
        </div>
      )}

      {infoMessage && (
        <div style={{ marginTop: 12, color: "#0b6a3b" }}>
          info: {infoMessage}
        </div>
      )}

      {registryState && (
        <div style={{ marginTop: 12, fontFamily: "monospace", fontSize: 13 }}>
          <div>registry admin: {shortKey(registryState.admin)}</div>
          <div>registry next_id: {registryState.nextId}</div>
          <div>registry bump: {registryState.bump}</div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 14, marginBottom: 6 }}>Entries</div>
        {entries.length === 0 ? (
          <div style={{ fontFamily: "monospace", fontSize: 13 }}>
            No entries yet
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {entries.map((entry) => (
              <div
                key={`${entry.id}-${entry.targetProgram}`}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #222",
                  fontFamily: "monospace",
                  fontSize: 13,
                }}
              >
                <div>id: {entry.id}</div>
                <div>kind: {entry.kind}</div>
                <div>target: {shortKey(entry.targetProgram)}</div>
                <div>admin: {shortKey(entry.admin)}</div>
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
