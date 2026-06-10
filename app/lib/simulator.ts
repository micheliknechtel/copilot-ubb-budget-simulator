export type CsvRow = {
  date: string;
  username: string;
  aic_quantity: number;
  model: string;
  cost_center_name: string;
};

export type UserSummary = {
  username: string;
  costCenter: string;
  licenseType: 'Business' | 'Enterprise';
  totalAicQty: number;
  totalAicCost: number;
  moyenne: number;
  heavyMoyenne: number;
  isHeavyUser: boolean;
  effectiveBudget: number;
  includedCredits: number;
  overage: number;
  budgetHeadroom: number;
  budgetUsedPct: number;
  status: 'OK' | 'NEAR' | 'OVER';
};

export type Settings = {
  businessLicensePrice: number;
  enterpriseLicensePrice: number;
  universalMultiplier: number;
  individualMultiplier: number;
  enterpriseBudget: number;
  aicRate: number;
  businessUsers: number;
  enterpriseUsers: number;
};

export const DEFAULT_SETTINGS: Settings = {
  businessLicensePrice: 19,
  enterpriseLicensePrice: 39,
  universalMultiplier: 1.3,
  individualMultiplier: 1.5,
  enterpriseBudget: 51062,
  aicRate: 0.01,
  businessUsers: 0,
  enterpriseUsers: 0,
};

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

export function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map(h => h.toLowerCase());
  const dateIdx = headers.indexOf('date');
  const usernameIdx = headers.indexOf('username');
  const aicIdx = headers.indexOf('aic_quantity');
  const modelIdx = headers.indexOf('model');
  const ccIdx = headers.indexOf('cost_center_name');

  if (usernameIdx === -1 || aicIdx === -1) return [];

  return lines.slice(1).filter(l => l.trim()).map(line => {
    const cols = splitCsvLine(line);
    return {
      date: cols[dateIdx] || '',
      username: cols[usernameIdx] || '',
      aic_quantity: parseFloat(cols[aicIdx]) || 0,
      model: cols[modelIdx] || '',
      cost_center_name: cols[ccIdx] || '',
    };
  });
}

export function getLicenseType(costCenterName: string): 'Business' | 'Enterprise' {
  return costCenterName.toLowerCase().includes('#business') ? 'Business' : 'Enterprise';
}

export function calculateUserSummaries(rows: CsvRow[], settings: Settings): UserSummary[] {
  const userMap = new Map<string, { totalAic: number; costCenter: string }>();

  for (const row of rows) {
    const existing = userMap.get(row.username);
    if (existing) {
      existing.totalAic += row.aic_quantity;
      if (!existing.costCenter && row.cost_center_name) {
        existing.costCenter = row.cost_center_name;
      }
    } else {
      userMap.set(row.username, { totalAic: row.aic_quantity, costCenter: row.cost_center_name });
    }
  }

  const users = Array.from(userMap.entries());
  const totalAicCostAll = users.reduce((sum, [, u]) => sum + u.totalAic * settings.aicRate, 0);
  const moyenne = users.length > 0 ? totalAicCostAll / users.length : 0;

  // Two-pass: first identify heavy users, then compute their average
  const heavyUserCosts = users
    .map(([, data]) => data.totalAic * settings.aicRate)
    .filter(cost => cost > moyenne);
  const heavyMoyenne = heavyUserCosts.length > 0
    ? heavyUserCosts.reduce((s, c) => s + c, 0) / heavyUserCosts.length
    : moyenne;

  return users.map(([username, data]) => {
    const licenseType = getLicenseType(data.costCenter);
    const licensePrice = licenseType === 'Business' ? settings.businessLicensePrice : settings.enterpriseLicensePrice;
    const universalBudget = licensePrice * settings.universalMultiplier;
    const totalAicCost = data.totalAic * settings.aicRate;
    const isHeavyUser = totalAicCost > moyenne;
    const individualBudget = Math.max(universalBudget, heavyMoyenne * settings.individualMultiplier);
    const effectiveBudget = isHeavyUser ? individualBudget : universalBudget;
    const includedCredits = licensePrice;
    const overage = Math.max(0, totalAicCost - includedCredits);
    const budgetAllowance = effectiveBudget - includedCredits;
    const budgetHeadroom = budgetAllowance - overage;
    const budgetUsedPct = budgetAllowance > 0 ? (overage / budgetAllowance) * 100 : 0;
    const status: 'OK' | 'NEAR' | 'OVER' =
      budgetHeadroom < 0 ? 'OVER' : budgetUsedPct >= 80 ? 'NEAR' : 'OK';

    return {
      username,
      costCenter: data.costCenter,
      licenseType,
      totalAicQty: data.totalAic,
      totalAicCost,
      moyenne,
      heavyMoyenne,
      isHeavyUser,
      effectiveBudget,
      includedCredits,
      overage,
      budgetHeadroom,
      budgetUsedPct,
      status,
    };
  });
}

export function formatCurrency(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPct(value: number): string {
  return value.toFixed(1) + '%';
}

export function exportTableCsv(users: UserSummary[]): string {
  const headers = [
    'Username', 'Cost Center', 'License Type', 'Total AIC Qty', 'Total AIC Cost ($)',
    'Moyenne ($)', 'Heavy Moyenne ($)', 'Is Heavy User?', 'Effective Budget ($)', 'Included Credits ($)',
    'Overage ($)', 'Budget Headroom ($)', 'Budget Used (%)', 'Status'
  ];
  const rows = users.map(u => [
    u.username, u.costCenter, u.licenseType, u.totalAicQty.toString(), u.totalAicCost.toFixed(2),
    u.moyenne.toFixed(2), u.heavyMoyenne.toFixed(2), u.isHeavyUser ? 'Yes' : 'No', u.effectiveBudget.toFixed(2),
    u.includedCredits.toFixed(2), u.overage.toFixed(2), u.budgetHeadroom.toFixed(2),
    u.budgetUsedPct.toFixed(1), u.status
  ]);
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
