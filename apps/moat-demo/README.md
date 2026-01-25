This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Devnet Proof Layer + Mainnet SilentSwap Toggle

This demo now builds a local payout plan, computes a Merkle root + memo hash,
and commits the batch on Solana devnet via `commit_batch`.

- Mode toggle:
  - `devnet-mock` uses a mock adapter and still commits on devnet.
  - `mainnet-silentswap` is a stub only (no real mainnet execution yet).
- The commitment transaction, merkle root, and memo hash are rendered in the UI.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Vercel Deploy Guide

Recommended for this monorepo:

1) Create a new Vercel project from the repo.
2) Set **Root Directory** to the repo root (not `apps/moat-demo`).
3) Set **Install Command**: `pnpm install`
4) Set **Build Command**: `pnpm --filter moat-demo build`
5) Set **Output Directory**: `apps/moat-demo/.next`
6) Deploy.

Notes:
- Phantom injects on HTTPS, so Vercel is a good fit for the demo.
- The app is devnet-only; the UI still shows the mainnet SilentSwap toggle as a stub.

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
