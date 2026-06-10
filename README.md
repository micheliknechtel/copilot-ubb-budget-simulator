# GitHub Copilot UBB Budget Simulator

A web-based **Usage-Based Billing (UBB) Budget Simulator** for GitHub Copilot Enterprise. Plan and simulate budget controls for your organization's Copilot AI usage before applying them in production.

## Features

- **CSV Upload**: Drag-and-drop your Premium Request Usage Report CSV
- **Real-time Simulation**: Adjust budget parameters and instantly see per-user impact
- **Per-User Analysis**: Sortable, filterable table with status indicators (🟢 OK / 🟡 NEAR / 🔴 OVER)
- **Dashboard**: Usage summary, pool analysis, budget validation, and simulation impact
- **Recommendations**: Auto-suggested multipliers and enterprise budget based on your data
- **CSV Export**: Download simulation results

## Tech Stack

- Next.js (App Router) with TypeScript
- Static export — no backend, everything runs in the browser
- No external UI libraries — pure React with inline styles
- Dark theme with neon purple/blue accents

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Test Data

A sample CSV is included at `public/sample-data.csv` with 15 simulated users across various cost centers and license types.

## How It Works

1. Upload your CSV (or use the sample)
2. Adjust settings: license prices, multipliers, enterprise budget, AIC rate
3. The dashboard and table update instantly
4. Filter/sort users by status, license type, or heavy usage
5. Export results as CSV

## Business Rules

- **Universal Budget** = License Price × Universal Multiplier
- **Heavy User** = User whose AIC Cost > Global Average (Moyenne)
- **Individual Budget** = MAX(Universal Budget, Moyenne × Individual Multiplier)
- **Status**: 🟢 OK (headroom ≥ 0, used < 80%) | 🟡 NEAR (used ≥ 80%) | 🔴 OVER (headroom < 0)

## Deployment

```bash
npm run build
```

The static export will be in the `out/` directory, ready to deploy to GitHub Pages or any static host.

## License

MIT
