'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  CsvRow, UserSummary, Settings, DEFAULT_SETTINGS,
  parseCsv, calculateUserSummaries, formatCurrency, formatPct, exportTableCsv,
} from './lib/simulator';

const CARD_STYLE: React.CSSProperties = {
  background: 'rgba(11, 16, 38, 0.72)',
  border: '1px solid rgba(168, 85, 247, 0.3)',
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};

const GLOW_CARD: React.CSSProperties = {
  ...CARD_STYLE,
  boxShadow: '0 0 15px rgba(168, 85, 247, 0.1)',
};

const INPUT_STYLE: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.8)',
  border: '1px solid rgba(99, 102, 241, 0.3)',
  borderRadius: 6,
  padding: '8px 12px',
  color: '#e2e8f0',
  fontSize: 14,
  width: '100%',
};

const BTN_STYLE: React.CSSProperties = {
  background: 'linear-gradient(135deg, #a855f7, #6366f1)',
  border: 'none',
  borderRadius: 8,
  padding: '10px 20px',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 14,
};

const STATUS_COLORS = {
  OK: '#22c55e',
  NEAR: '#eab308',
  OVER: '#ef4444',
};

const STATUS_ICONS = {
  OK: '🟢',
  NEAR: '🟡',
  OVER: '🔴',
};

type SortKey = keyof UserSummary;
type SortDir = 'asc' | 'desc';
type ImpactFilter = 'ALL' | 'UNIVERSAL_BLOCKED' | 'STILL_BLOCKED' | 'RECOVERED';

export default function Home() {
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [userCountOverride, setUserCountOverride] = useState(false);
  const [csvInfo, setCsvInfo] = useState<{ totalUsers: number; businessUsers: number; enterpriseUsers: number } | null>(null);
  const [simulationMode, setSimulationMode] = useState<'conservative' | 'practical'>('practical');
  const [sortKey, setSortKey] = useState<SortKey>('budgetUsedPct');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [licenseFilter, setLicenseFilter] = useState<string>('ALL');
  const [heavyFilter, setHeavyFilter] = useState<string>('ALL');
  const [impactFilter, setImpactFilter] = useState<ImpactFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [isDragOver, setIsDragOver] = useState(false);
  const [universalBudgetBase, setUniversalBudgetBase] = useState<'business' | 'enterprise'>('enterprise');
  const [isGlossaryOpen, setIsGlossaryOpen] = useState(false);
  const [isInterpretationOpen, setIsInterpretationOpen] = useState(false);
  const [isRoadmapOpen, setIsRoadmapOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ROWS_PER_PAGE = 50;

  const loadCsvText = useCallback((text: string, name: string) => {
    const rows = parseCsv(text);
    setCsvRows(rows);
    setFileName(name);
    setCurrentPage(1);
    const uniqueUsers = new Set(rows.map(r => r.username));
    const hasQuota = rows.some(r => r.monthly_quota > 0);
    let businessCount: number;
    if (hasQuota) {
      businessCount = new Set(rows.filter(r => r.monthly_quota > 0 && r.monthly_quota <= 1900).map(r => r.username)).size;
    } else {
      businessCount = new Set(rows.filter(r => r.cost_center_name.toLowerCase().includes('#business')).map(r => r.username)).size;
    }
    const enterpriseCount = uniqueUsers.size - businessCount;
    setCsvInfo({ totalUsers: uniqueUsers.size, businessUsers: businessCount, enterpriseUsers: enterpriseCount });
    if (!userCountOverride) {
      setSettings(prev => ({ ...prev, businessUsers: businessCount, enterpriseUsers: enterpriseCount }));
    }
  }, [userCountOverride]);

  // Auto-load example data on startup
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/example-data.csv`)
      .then(r => { if (!r.ok) throw new Error('No example data'); return r.text(); })
      .then(text => loadCsvText(text, 'Example Data (anonymized)'))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const universalBusiness = settings.businessLicensePrice * settings.universalMultiplier;
  const universalEnterprise = settings.enterpriseLicensePrice * settings.universalMultiplier;
  const selectedUniversal = settings.universalBudgetOverride > 0
    ? settings.universalBudgetOverride
    : universalBudgetBase === 'business' ? universalBusiness : universalEnterprise;

  const simulationSettings = useMemo(
    () => ({ ...settings, universalBudgetOverride: selectedUniversal }),
    [settings, selectedUniversal]
  );

  const userSummaries = useMemo(
    () => calculateUserSummaries(csvRows, simulationSettings),
    [csvRows, simulationSettings]
  );

  const gteMoney = (a: number, b: number) => Math.round(a * 100) >= Math.round(b * 100);

  const getUniversalBudgetForUser = (_u: UserSummary) => selectedUniversal;

  // Universal limit applies to normal users; heavy users are governed by individual budget.
  const isUniversalBlocked = (u: UserSummary) => !u.isHeavyUser && gteMoney(u.totalAicCost, getUniversalBudgetForUser(u));
  const isStillBlockedAfterIndividual = (u: UserSummary) => gteMoney(u.totalAicCost, u.effectiveBudget);
  const isRecoveredByIndividual = (u: UserSummary) => isUniversalBlocked(u) && !isStillBlockedAfterIndividual(u);

  const filteredUsers = useMemo(() => {
    let result = [...userSummaries];
    if (statusFilter !== 'ALL') result = result.filter(u => u.status === statusFilter);
    if (licenseFilter !== 'ALL') result = result.filter(u => u.licenseType === licenseFilter);
    if (heavyFilter !== 'ALL') result = result.filter(u => (u.isHeavyUser ? 'Yes' : 'No') === heavyFilter);
    if (impactFilter === 'UNIVERSAL_BLOCKED') result = result.filter(isUniversalBlocked);
    if (impactFilter === 'STILL_BLOCKED') result = result.filter(isStillBlockedAfterIndividual);
    if (impactFilter === 'RECOVERED') result = result.filter(isRecoveredByIndividual);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(u => u.username.toLowerCase().includes(q));
    }
    result.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return sortDir === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
    return result;
  }, [userSummaries, statusFilter, licenseFilter, heavyFilter, impactFilter, searchQuery, sortKey, sortDir]);

  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * ROWS_PER_PAGE;
    return filteredUsers.slice(start, start + ROWS_PER_PAGE);
  }, [filteredUsers, currentPage]);

  const totalPages = Math.ceil(filteredUsers.length / ROWS_PER_PAGE);

  const stats = useMemo(() => {
    const csvUserCount = userSummaries.length;
    const totalUsers = (settings.businessUsers + settings.enterpriseUsers) || csvUserCount;
    const totalAicCost = userSummaries.reduce((s, u) => s + u.totalAicCost, 0);
    const moyenne = csvUserCount > 0 ? totalAicCost / csvUserCount : 0;
    const sortedCosts = userSummaries.map(u => u.totalAicCost).sort((a, b) => a - b);
    const median = csvUserCount > 0
      ? csvUserCount % 2 === 0
        ? (sortedCosts[csvUserCount / 2 - 1] + sortedCosts[csvUserCount / 2]) / 2
        : sortedCosts[Math.floor(csvUserCount / 2)]
      : 0;
    const heavyUsers = userSummaries.filter(u => u.isHeavyUser);
    const normalUsers = userSummaries.filter(u => !u.isHeavyUser);
    const heavyMoyenne = heavyUsers.length > 0 ? heavyUsers[0].heavyMoyenne : moyenne;
      const maxUniversalForThreshold = selectedUniversal;
      const moyenneAboveAvg = userSummaries.filter(u => u.totalAicCost > moyenne);
      const moyenneHeavyAvg = moyenneAboveAvg.length > 0 ? moyenneAboveAvg.reduce((s, u) => s + u.totalAicCost, 0) / moyenneAboveAvg.length : moyenne;
      const heavyThreshold = moyenneHeavyAvg < maxUniversalForThreshold ? maxUniversalForThreshold : moyenne;
      const heavyThresholdSource: 'moyenne' | 'universal' | 'manual' =
        settings.universalBudgetOverride > 0 && settings.universalBudgetOverride >= moyenneHeavyAvg
          ? 'manual'
          : moyenneHeavyAvg < maxUniversalForThreshold ? 'universal' : 'moyenne';
    const businessUserCount = settings.businessUsers;
    const enterpriseUserCount = settings.enterpriseUsers;
    const businessPool = businessUserCount * settings.businessLicensePrice;
    const enterprisePool = enterpriseUserCount * settings.enterpriseLicensePrice;
    const totalPool = businessPool + enterprisePool;
    const poolUtilization = totalPool > 0 ? (totalAicCost / totalPool) * 100 : 0;

    // Consumption by license type
    const businessConsumption = userSummaries.filter(u => u.licenseType === 'Business').reduce((s, u) => s + u.totalAicCost, 0);
    const enterpriseConsumption = userSummaries.filter(u => u.licenseType === 'Enterprise').reduce((s, u) => s + u.totalAicCost, 0);

    // Count CSV users by license type
    const csvBusinessCount = userSummaries.filter(u => u.licenseType === 'Business').length;
    const csvEnterpriseCount = userSummaries.filter(u => u.licenseType === 'Enterprise').length;

    // Extra non-CSV users (zero consumption) per license type
    const extraBusiness = Math.max(0, businessUserCount - csvBusinessCount);
    const extraEnterprise = Math.max(0, enterpriseUserCount - csvEnterpriseCount);
    const extraTotal = extraBusiness + extraEnterprise;

    // Non-CSV users get universal budget (zero consumption = normal user)
    const universalBudgetBusiness = settings.universalBudgetOverride > 0 ? settings.universalBudgetOverride : settings.businessLicensePrice * settings.universalMultiplier;
    const universalBudgetEnterprise = settings.universalBudgetOverride > 0 ? settings.universalBudgetOverride : settings.enterpriseLicensePrice * settings.universalMultiplier;
    const extraEffectiveBudgets = simulationMode === 'conservative'
      ? extraBusiness * universalBudgetBusiness + extraEnterprise * universalBudgetEnterprise
      : 0;

    const sumEffectiveBudgets = userSummaries.reduce((s, u) => s + u.effectiveBudget, 0) + extraEffectiveBudgets;
    const overageExposure = sumEffectiveBudgets - totalPool;
    const enterpriseValid = overageExposure <= settings.enterpriseBudget;
    const gap = settings.enterpriseBudget - overageExposure;

    // Non-CSV users are always OK (0% budget used)
    const okCount = userSummaries.filter(u => u.status === 'OK').length + extraTotal;
    const nearCount = userSummaries.filter(u => u.status === 'NEAR').length;
    const overCount = userSummaries.filter(u => u.status === 'OVER').length;

    // Suggested multipliers at different coverage levels
    // Use the license price of whichever type has the most users
    const dominantLicensePrice = businessUserCount >= enterpriseUserCount
      ? settings.businessLicensePrice
      : settings.enterpriseLicensePrice;

    // Normal user blocked when: AIC cost > License × UniversalMultiplier
    // → multiplier needed = AIC cost / dominant license price
    const normalUserMultipliers = userSummaries
      .filter(u => !u.isHeavyUser)
      .map(u => u.totalAicCost / dominantLicensePrice)
      .sort((a, b) => a - b);

    // Heavy user blocked when: AIC cost > MAX(Universal, HeavyMoyenne × IndividualMultiplier)
    // → multiplier needed = AIC cost / heavyMoyenne
    const heavyUserMultipliers = userSummaries
      .filter(u => u.isHeavyUser && heavyMoyenne > 0)
      .map(u => u.totalAicCost / heavyMoyenne)
      .sort((a, b) => a - b);

    const getPercentile = (arr: number[], pct: number) => {
      if (arr.length === 0) return 1.1;
      const idx = Math.min(Math.floor(arr.length * pct / 100), arr.length - 1);
      return Math.max(1.1, Math.ceil(arr[idx] * 10) / 10);
    };

    const universalOptions = {
      p90: getPercentile(normalUserMultipliers, 90),
      p95: getPercentile(normalUserMultipliers, 95),
      p100: getPercentile(normalUserMultipliers, 100),
    };
    const individualOptions = {
      p90: getPercentile(heavyUserMultipliers, 90),
      p95: getPercentile(heavyUserMultipliers, 95),
      p100: getPercentile(heavyUserMultipliers, 100),
    };

    const suggestedUniversalMultiplier = universalOptions.p95;
    const suggestedIndividualMultiplier = individualOptions.p95;
    const suggestedEnterpriseBudget = Math.ceil(overageExposure / 100) * 100;

    return {
      totalUsers, csvUserCount, totalAicCost, moyenne, median, heavyMoyenne, heavyThreshold, heavyThresholdSource,
      heavyUsers: heavyUsers.length, heavyPct: totalUsers > 0 ? (heavyUsers.length / totalUsers) * 100 : 0,
      normalUsers: normalUsers.length + extraTotal,
      normalPct: totalUsers > 0 ? ((normalUsers.length + extraTotal) / totalUsers) * 100 : 0,
      businessUsers: businessUserCount, businessPool,
      enterpriseUsers: enterpriseUserCount, enterprisePool,
      totalPool, poolUtilization, businessConsumption, enterpriseConsumption,
      sumEffectiveBudgets, overageExposure, enterpriseValid, gap,
      okCount, nearCount, overCount,
      okPct: totalUsers > 0 ? (okCount / totalUsers) * 100 : 0,
      nearPct: totalUsers > 0 ? (nearCount / totalUsers) * 100 : 0,
      overPct: totalUsers > 0 ? (overCount / totalUsers) * 100 : 0,
      suggestedUniversalMultiplier, suggestedIndividualMultiplier, suggestedEnterpriseBudget,
      universalOptions, individualOptions,
      extraBusiness, extraEnterprise,
    };
  }, [userSummaries, settings, simulationMode, selectedUniversal]);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      loadCsvText(text, file.name);
    };
    reader.readAsText(file);
  }, [loadCsvText]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        return key;
      }
      setSortDir('desc');
      return key;
    });
  }, []);

  const updateSetting = useCallback((key: keyof Settings, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num) && num >= 0) {
      setSettings(prev => ({ ...prev, [key]: num }));
    }
  }, []);

  const individualBudget = settings.individualBudgetOverride > 0
    ? settings.individualBudgetOverride
    : Math.max(selectedUniversal, stats.heavyMoyenne * settings.individualMultiplier);

  const blockedBreakdown = useMemo(() => {
    let universalBlockedUsers = 0;
    let universalBlockedAmount = 0;
    let individualBlockedUsers = 0;
    let individualBlockedAmount = 0;
    let recoveredByIndividualUsers = 0;

    for (const u of userSummaries) {
      const universalBlocked = isUniversalBlocked(u);
      const individualBlocked = isStillBlockedAfterIndividual(u);

      if (universalBlocked) {
        universalBlockedUsers += 1;
        universalBlockedAmount += u.totalAicCost - getUniversalBudgetForUser(u);
      }
      if (individualBlocked) {
        individualBlockedUsers += 1;
        individualBlockedAmount += u.totalAicCost - u.effectiveBudget;
      }
      if (universalBlocked && !individualBlocked) recoveredByIndividualUsers += 1;
    }

    return {
      universalBlockedUsers,
      universalBlockedAmount,
      individualBlockedUsers,
      individualBlockedAmount,
      recoveredByIndividualUsers,
      recoveredByIndividualAmount: Math.max(0, universalBlockedAmount - individualBlockedAmount),
    };
  }, [userSummaries]);

  const handleExportCsv = useCallback(() => {
    const csvContent = exportTableCsv(filteredUsers);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'budget_simulation_results.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredUsers]);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 16px' }}>
      <header style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, background: 'linear-gradient(135deg, #a855f7, #6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          GitHub Copilot UBB Budget Simulator
        </h1>
        <p style={{ color: '#94a3b8', marginTop: 8 }}>
          Plan and simulate budget controls for your organization&apos;s Copilot AI usage
        </p>
      </header>

      {/* CSV Upload Area */}
      <div
        style={{
          ...GLOW_CARD,
          border: isDragOver ? '2px dashed #a855f7' : GLOW_CARD.border,
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'border 0.2s',
        }}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {csvRows.length === 0 ? (
          <>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📊</div>
            <p style={{ fontSize: 16, color: '#a855f7' }}>Drop your AI Usage Report CSV here</p>
            <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>or click to browse</p>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
            <p style={{ color: '#22c55e', margin: 0 }}>
              ✅ <strong>{fileName}</strong> — {csvRows.length.toLocaleString()} rows loaded
            </p>
            <button
              style={{ ...BTN_STYLE, padding: '6px 16px', fontSize: 12 }}
              onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
            >
              📂 Load your own CSV
            </button>
          </div>
        )}
      </div>

      {/* Settings Panel */}
      <div style={GLOW_CARD}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: '#a855f7' }}>⚙️ Settings</h2>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
          Tune your user counts, pricing, and budget controls. Suggested chips are data-driven shortcuts.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          {([
            [
              ['businessUsers', 'Business Users', settings.businessUsers],
              ['businessLicensePrice', 'Business License ($)', settings.businessLicensePrice],
            ],
            [
              ['enterpriseUsers', 'Enterprise Users', settings.enterpriseUsers],
              ['enterpriseLicensePrice', 'Enterprise License ($)', settings.enterpriseLicensePrice],
            ],
            [
              ['universalMultiplier', 'Universal Budget Factor', settings.universalMultiplier],
              ['individualMultiplier', 'Individual Budget Factor', settings.individualMultiplier],
            ],
            [
              ['enterpriseBudget', 'Enterprise Budget ($)', settings.enterpriseBudget],
              ['aicRate', 'AIC Rate ($/AIC)', settings.aicRate],
            ],
          ] as [keyof Settings, string, number][][]).map((group, groupIndex) => (
            <div key={groupIndex} style={{ background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.14)', borderRadius: 8, padding: 10 }}>
              {group.map(([key, label, value], fieldIndex) => {
                const options = stats.csvUserCount > 0
                  ? key === 'universalMultiplier' ? stats.universalOptions
                  : key === 'individualMultiplier' ? stats.individualOptions
                  : null
                  : null;
                const isMultiplierDisabled = (key === 'universalMultiplier' && settings.universalBudgetOverride > 0)
                  || (key === 'individualMultiplier' && settings.individualBudgetOverride > 0);
                const enterpriseSuggestion = stats.csvUserCount > 0 && key === 'enterpriseBudget' ? stats.suggestedEnterpriseBudget : null;
                const hasOptions = options !== null;
                const hasEnterpriseSuggestion = enterpriseSuggestion !== null && Math.abs(enterpriseSuggestion - value) > 100;
                const optionLabel = key === 'universalMultiplier' ? 'normal' : 'heavy';
                return (
                  <div key={key} style={{ marginBottom: fieldIndex === group.length - 1 ? 0 : 12 }}>
                    <label style={{ fontSize: 12, color: isMultiplierDisabled ? '#475569' : '#94a3b8', display: 'block', marginBottom: 4 }}>
                      {label}
                      {isMultiplierDisabled && <span style={{ fontSize: 10, color: '#eab308' }}> (overridden by card)</span>}
                    </label>
                    <input
                      type="number"
                      step={key === 'aicRate' ? '0.001' : key.includes('Multiplier') ? '0.1' : '1'}
                      value={value}
                      disabled={isMultiplierDisabled}
                      onChange={(e) => {
                        updateSetting(key, e.target.value);
                        if (key === 'businessUsers' || key === 'enterpriseUsers') setUserCountOverride(true);
                      }}
                      style={{ ...INPUT_STYLE, opacity: isMultiplierDisabled ? 0.4 : 1 }}
                    />
                    {hasOptions && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>
                          Suggested target ({optionLabel} users):
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {([['90%', options.p90], ['95%', options.p95], ['100%', options.p100]] as [string, number][]).map(([pctLabel, val]) => (
                            <button
                              key={pctLabel}
                              onClick={() => setSettings(prev => ({ ...prev, [key]: Math.round(val * 100) / 100 }))}
                              style={{
                                fontSize: 10, cursor: 'pointer', borderRadius: 4, padding: '2px 6px',
                                border: Math.abs(value - val) < 0.05 ? '1px solid #a855f7' : '1px solid rgba(148, 163, 184, 0.2)',
                                background: Math.abs(value - val) < 0.05 ? 'rgba(168, 85, 247, 0.15)' : 'rgba(15, 23, 42, 0.6)',
                                color: Math.abs(value - val) < 0.05 ? '#a855f7' : '#94a3b8',
                              }}
                            >
                              {pctLabel} = {val.toFixed(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {hasEnterpriseSuggestion && (
                      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 11, color: '#eab308' }}>
                          {'\u{1F4A1}'} Suggested reserve: <strong>{formatCurrency(enterpriseSuggestion)}</strong>
                        </span>
                        <button
                          onClick={() => setSettings(prev => ({ ...prev, [key]: Math.round(enterpriseSuggestion * 100) / 100 }))}
                          style={{ fontSize: 10, color: '#a855f7', background: 'none', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: 4, padding: '1px 6px', cursor: 'pointer' }}
                        >
                          Apply
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {csvInfo && (
          <div style={{ marginTop: 12, padding: '10px 16px', background: 'rgba(34, 197, 94, 0.08)', borderRadius: 8, border: '1px solid rgba(34, 197, 94, 0.2)' }}>
            <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>📄 CSV Detected:</span>
            <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 12 }}>
              {csvInfo.totalUsers.toLocaleString()} users ({csvInfo.businessUsers.toLocaleString()} Business, {csvInfo.enterpriseUsers.toLocaleString()} Enterprise)
            </span>
            {userCountOverride && (
              <button
                onClick={() => {
                  setSettings(prev => ({ ...prev, businessUsers: csvInfo.businessUsers, enterpriseUsers: csvInfo.enterpriseUsers }));
                  setUserCountOverride(false);
                }}
                style={{ marginLeft: 12, fontSize: 11, color: '#a855f7', background: 'none', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
              >
                Reset to CSV values
              </button>
            )}
          </div>
        )}
        <div style={{ marginTop: 16, padding: '16px', background: 'rgba(99, 102, 241, 0.1)', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#a855f7', marginBottom: 12 }}>💡 Budget Calculation (using your current settings)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <div style={{ padding: '16px', background: 'rgba(15, 23, 42, 0.6)', borderRadius: 8, border: '1px solid rgba(99, 102, 241, 0.2)' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', background: 'linear-gradient(90deg, #a78bfa, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>UNIVERSAL BUDGET</span>
                {settings.universalBudgetOverride > 0
                  ? <span style={{ color: '#eab308', fontSize: 11, padding: '1px 7px', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 999 }}>⚡ Manual</span>
                  : <span style={{ color: '#6366f1', fontSize: 11, fontWeight: 600, padding: '1px 7px', border: '1px solid rgba(99,102,241,0.35)', borderRadius: 999 }}>ƒx Data-driven</span>}
              </div>

              {settings.universalBudgetOverride > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>$</span>
                  <input type="number" step="0.01" value={settings.universalBudgetOverride}
                    onChange={(e) => updateSetting('universalBudgetOverride', e.target.value)}
                    style={{ ...INPUT_STYLE, width: 120, padding: '5px 10px', fontSize: 15 }} />
                  <span style={{ fontSize: 11, color: '#64748b' }}>per user (all license types)</span>
                  <button onClick={() => updateSetting('universalBudgetOverride', '0')} style={{ fontSize: 10, color: '#64748b', background: 'none', border: '1px solid rgba(100,116,139,0.3)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>✕ Reset</button>
                </div>
              ) : (
                <>
                  {/* Big result */}
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#818cf8', marginBottom: 6, letterSpacing: '-0.5px', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    ${universalBudgetBase === 'business' ? settings.businessLicensePrice : settings.enterpriseLicensePrice} × {settings.universalMultiplier} = {universalBudgetBase === 'business' ? formatCurrency(universalBusiness) : formatCurrency(universalEnterprise)}
                    <span style={{ fontSize: 12, fontWeight: 400, color: '#64748b' }}>per normal user</span>
                    <button onClick={() => updateSetting('universalBudgetOverride', String(selectedUniversal))} style={{ fontSize: 11, fontWeight: 500, color: '#a855f7', background: 'none', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>✎ Edit</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                    {(['business', 'enterprise'] as const).map(base => (
                      <button key={base} onClick={() => setUniversalBudgetBase(base)} style={{
                        fontSize: 11, cursor: 'pointer', borderRadius: 6, padding: '3px 12px',
                        border: universalBudgetBase === base ? '1px solid rgba(99,102,241,0.6)' : '1px solid rgba(148,163,184,0.12)',
                        background: universalBudgetBase === base ? 'rgba(99,102,241,0.2)' : 'transparent',
                        color: universalBudgetBase === base ? '#a5b4fc' : '#475569',
                        fontWeight: universalBudgetBase === base ? 700 : 400,
                        textTransform: 'capitalize',
                        transition: 'all 0.15s',
                      }}>{base}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', fontStyle: 'italic' }}>
                    {stats.normalUsers.toLocaleString()} normal users get this budget
                  </div>
                </>
              )}
            </div>
            {userSummaries.length > 0 && (
              <div style={{ padding: '16px', background: 'rgba(15, 23, 42, 0.6)', borderRadius: 8, border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', background: 'linear-gradient(90deg, #f97316, #fb923c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>INDIVIDUAL BUDGET</span>
                  {settings.individualBudgetOverride > 0
                    ? <span style={{ color: '#eab308', fontSize: 11, padding: '1px 7px', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 999 }}>⚡ Manual</span>
                    : <span style={{ color: '#6366f1', fontSize: 11, fontWeight: 600, padding: '1px 7px', border: '1px solid rgba(99,102,241,0.35)', borderRadius: 999 }}>ƒx Data-driven</span>}
                </div>

                {/* Big result or manual input */}
                {settings.individualBudgetOverride > 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>$</span>
                    <input type="number" step="0.01" value={settings.individualBudgetOverride}
                      onChange={(e) => updateSetting('individualBudgetOverride', e.target.value)}
                      style={{ ...INPUT_STYLE, width: 120, padding: '5px 10px', fontSize: 15 }} />
                    <span style={{ fontSize: 11, color: '#64748b' }}>per heavy user</span>
                    <button onClick={() => updateSetting('individualBudgetOverride', '0')} style={{ fontSize: 10, color: '#64748b', background: 'none', border: '1px solid rgba(100,116,139,0.3)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>✕ Reset</button>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#6366f1', marginBottom: 14, letterSpacing: '-0.5px', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                      {formatCurrency(individualBudget)}
                      <span style={{ fontSize: 12, fontWeight: 400, color: '#475569' }}>per heavy user</span>
                      <button onClick={() => updateSetting('individualBudgetOverride', String(individualBudget))} style={{ fontSize: 11, fontWeight: 500, color: '#a855f7', background: 'none', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>✎ Edit</button>
                    </div>

                    {/* Step tiles */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8, marginBottom: 12 }}>
                      <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.22)' }}>
                        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>① Cutoff ({stats.heavyThresholdSource})</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#6366f1' }}>{formatCurrency(stats.heavyThreshold)}</div>
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>Users at or above → heavy</div>
                      </div>
                      <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
                        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>② Heavy user avg</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#ef4444' }}>{formatCurrency(stats.heavyMoyenne)}</div>
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{stats.heavyUsers.toLocaleString()} users</div>
                      </div>
                      <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.22)' }}>
                        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>③ MAX(A, B)</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#a855f7' }}>{formatCurrency(individualBudget)}</div>
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>Highest wins</div>
                      </div>
                    </div>

                    {/* Collapsible how */}
                    <details style={{ fontSize: 11, color: '#64748b' }}>
                      <summary style={{ cursor: 'pointer', color: '#a855f7', fontWeight: 600, marginBottom: 4 }}>How is this calculated?</summary>
                      <div style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(15,23,42,0.5)', borderRadius: 8, border: '1px solid rgba(148,163,184,0.12)' }}>
                        <div style={{ marginBottom: 6, color: '#94a3b8' }}>
                          Cutoff: {settings.universalBudgetOverride > 0
                            ? <>manual override ({formatCurrency(settings.universalBudgetOverride)}) → use <strong style={{ color: '#eab308' }}>manual</strong></>
                            : stats.moyenne < selectedUniversal
                              ? <>avg ({formatCurrency(stats.moyenne)}) &lt; Universal ({formatCurrency(selectedUniversal)}) → use <strong style={{ color: '#6366f1' }}>Universal</strong></>
                              : <>use <strong style={{ color: '#6366f1' }}>average</strong> ({formatCurrency(stats.moyenne)})</>}
                        </div>
                        <div style={{ marginBottom: 8, color: '#94a3b8' }}>
                          Heavy User Avg = {formatCurrency(stats.heavyMoyenne * stats.heavyUsers)} / {stats.heavyUsers} users = <strong style={{ color: '#ef4444' }}>{formatCurrency(stats.heavyMoyenne)}</strong>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                          <div style={{ padding: '6px 10px', borderRadius: 6, background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.2)' }}>
                            <div style={{ fontSize: 10, color: '#64748b' }}>A — Universal floor</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#6366f1' }}>{formatCurrency(selectedUniversal)}</div>
                          </div>
                          <div style={{ padding: '6px 10px', borderRadius: 6, background: 'rgba(168,85,247,0.10)', border: '1px solid rgba(168,85,247,0.2)' }}>
                            <div style={{ fontSize: 10, color: '#64748b' }}>B — Heavy Avg × {settings.individualMultiplier}</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#a855f7' }}>{formatCurrency(stats.heavyMoyenne * settings.individualMultiplier)}</div>
                          </div>
                        </div>
                        <div style={{ color: '#94a3b8' }}>
                          MAX({formatCurrency(selectedUniversal)}, {formatCurrency(stats.heavyMoyenne * settings.individualMultiplier)}) = <strong style={{ color: '#6366f1' }}>{formatCurrency(individualBudget)}</strong>
                        </div>
                      </div>
                    </details>

                    <div style={{ fontSize: 10, color: '#475569', marginTop: 8, fontStyle: 'italic' }}>
                      {stats.heavyUsers.toLocaleString()} heavy users get this budget
                    </div>
                  </>
                )}
              </div>
            )}
            {userSummaries.length > 0 && (
              <div style={{ padding: '16px', background: 'rgba(15, 23, 42, 0.6)', borderRadius: 8, border: '1px solid rgba(148, 163, 184, 0.15)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 12, background: 'linear-gradient(90deg, #22d3ee, #67e8f9)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>REFERENCE VALUES</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)' }}>
                    <span style={{ fontSize: 11, color: '#64748b' }}>Moyenne <span style={{ color: '#475569' }}>({stats.csvUserCount.toLocaleString()} users)</span></span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#6366f1' }}>{formatCurrency(stats.moyenne)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)' }}>
                    <span style={{ fontSize: 11, color: '#64748b' }}>Heavy user avg <span style={{ color: '#475569' }}>({stats.heavyUsers.toLocaleString()} users)</span></span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#ef4444' }}>{formatCurrency(stats.heavyMoyenne)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.15)' }}>
                    <span style={{ fontSize: 11, color: '#64748b' }}>Median cost <span style={{ color: '#475569' }}>(50th percentile)</span></span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#6366f1' }}>{formatCurrency(stats.median)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)' }}>
                    <span style={{ fontSize: 11, color: '#64748b' }}>Active cutoff <span style={{ color: '#475569' }}>({stats.heavyThresholdSource})</span></span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#6366f1' }}>{formatCurrency(stats.heavyThreshold)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {(csvRows.length > 0 || (settings.businessUsers + settings.enterpriseUsers) > 0) && (
        <>
          {/* Simulation Mode Toggle */}
          <div style={{ ...GLOW_CARD, borderColor: 'rgba(99, 102, 241, 0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#a855f7', margin: 0 }}>🔬 Simulation Mode</h3>
              <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
                <button
                  onClick={() => setSimulationMode('practical')}
                  style={{
                    padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                    background: simulationMode === 'practical' ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'rgba(15, 23, 42, 0.8)',
                    color: simulationMode === 'practical' ? '#fff' : '#94a3b8',
                  }}
                >
                  Practical
                </button>
                <button
                  onClick={() => setSimulationMode('conservative')}
                  style={{
                    padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                    borderLeft: '1px solid rgba(99, 102, 241, 0.3)',
                    background: simulationMode === 'conservative' ? 'linear-gradient(135deg, #eab308, #ca8a04)' : 'rgba(15, 23, 42, 0.8)',
                    color: simulationMode === 'conservative' ? '#000' : '#94a3b8',
                  }}
                >
                  Conservative
                </button>
              </div>
            </div>
            {/* Mode description */}
            {simulationMode === 'practical' ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8, padding: '10px 14px' }}>
                <span style={{ fontSize: 18, lineHeight: 1 }}>✅</span>
                <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
                  <span style={{ color: '#22c55e', fontWeight: 700 }}>Only active users count.</span>{' '}
                  Users with zero consumption add their license fee to the pool but carry no budget allowance — so they can only help your numbers.
                  <span style={{ display: 'block', marginTop: 4, color: '#64748b', fontSize: 11 }}>→ Adding more users always improves your budget position.</span>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: 8, padding: '10px 14px' }}>
                <span style={{ fontSize: 18, lineHeight: 1 }}>⚠️</span>
                <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
                  <span style={{ color: '#eab308', fontWeight: 700 }}>Every user is assumed to hit their full cap.</span>{' '}
                  Even zero-consumption users are assigned their full universal budget — assuming they could start consuming at any time.
                  <span style={{ display: 'block', marginTop: 4, color: '#64748b', fontSize: 11 }}>→ Each extra Enterprise user adds {formatCurrency(settings.enterpriseLicensePrice * settings.universalMultiplier - settings.enterpriseLicensePrice)} of potential overage. Best for worst-case planning.</span>
                </div>
              </div>
            )}

            {/* Key definitions */}
            <div style={{ marginTop: 12, background: 'rgba(99,102,241,0.05)', borderRadius: 8, border: '1px solid rgba(99,102,241,0.12)', overflow: 'hidden' }}>
              <button
                onClick={() => setIsGlossaryOpen(prev => !prev)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: 'transparent',
                  border: 'none',
                  color: '#c4b5fd',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
              >
                <span>Glossary</span>
                <span style={{ color: '#818cf8', fontSize: 12 }}>{isGlossaryOpen ? 'Hide ▲' : 'Show ▼'}</span>
              </button>

              {isGlossaryOpen && (
                <div style={{ padding: '0 14px 10px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6 }}>
                    {[
                      { term: 'Total Included Pool', def: 'Total license fees paid (Business pool + Enterprise pool).' },
                      { term: 'Eff. Budget ($)', def: 'The budget cap that applies to each user (universal for normal users, individual for heavy users).' },
                      { term: 'License Credit ($)', def: 'Part already covered by the license fee (= license price). This is not extra cost.' },
                      { term: 'Overage ($)', def: 'Per-user spend above License Credit ($): max(0, AIC cost − license price).' },
                      { term: 'Max extra cost if all users hit their budget cap', def: 'Worst-case extra amount you need to fund beyond License Pool.' },
                      { term: 'Enterprise Budget', def: 'The reserve you set aside to cover overage exposure. Must be ≥ exposure to pass validation.' },
                      { term: 'Safety margin', def: 'Positive difference when Enterprise Budget is higher than max extra cost.' },
                      { term: 'Shortfall', def: 'Negative difference when Enterprise Budget is lower than max extra cost.' },
                    ].map(({ term, def }) => (
                      <div key={term} style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
                        <span style={{ color: '#c4b5fd', fontWeight: 600 }}>{term}</span>
                        <span style={{ color: '#475569' }}> — </span>
                        {def}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* How to read the numbers */}
            <div style={{ marginTop: 10, background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(59,130,246,0.06))', borderRadius: 10, border: '1px solid rgba(52,211,153,0.25)', overflow: 'hidden', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)' }}>
              <button
                onClick={() => setIsInterpretationOpen(prev => !prev)}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  background: 'transparent',
                  border: 'none',
                  color: '#a7f3d0',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
              >
                <span>How To Read These Numbers</span>
                <span style={{ color: '#6ee7b7', fontSize: 12, fontWeight: 800 }}>{isInterpretationOpen ? 'Hide ▲' : 'Show ▼'}</span>
              </button>

              {isInterpretationOpen && (
                <div style={{ padding: '0 14px 14px', fontSize: 12, color: '#cbd5e1', lineHeight: 1.65 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    <span style={{ fontSize: 10, color: '#d1fae5', border: '1px solid rgba(110,231,183,0.35)', background: 'rgba(16,185,129,0.15)', borderRadius: 999, padding: '2px 8px', fontWeight: 700 }}>Shared Pool</span>
                    <span style={{ fontSize: 10, color: '#bfdbfe', border: '1px solid rgba(96,165,250,0.35)', background: 'rgba(59,130,246,0.14)', borderRadius: 999, padding: '2px 8px', fontWeight: 700 }}>Control Ceilings</span>
                    <span style={{ fontSize: 10, color: '#fde68a', border: '1px solid rgba(250,204,21,0.35)', background: 'rgba(234,179,8,0.14)', borderRadius: 999, padding: '2px 8px', fontWeight: 700 }}>Risk Scenario, Not Forecast</span>
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    Don&apos;t treat each user&apos;s license fee as their personal wallet. Put everyone in one shared pool.
                    Budget factors are consumption controls, not money everyone will actually spend.
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
                    <div style={{ background: 'rgba(15,23,42,0.45)', border: '1px solid rgba(148,163,184,0.16)', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, color: '#99f6e4', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Simple Example</div>
                      <div>
                        If 100 users each have a $50 limit, the model can show up to $5,000 under consumption control.
                        In reality, maybe only a subset will actually consume near that limit.
                        If you budget as if all 100 always hit the limit, you can overestimate needs and think you need much more budget when you may not.
                      </div>
                    </div>

                    <div style={{ background: 'rgba(15,23,42,0.45)', border: '1px solid rgba(148,163,184,0.16)', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, color: '#99f6e4', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Strategy</div>
                      <div>1. Use pooled fairness (avoid silos): consumption limits can be higher than what each user individually brings through their seat fee, because everyone draws from one shared pool.</div>
                      <div>2. Run operations on actual consumption.</div>
                      <div>3. Keep the cap-based number as a risk ceiling, not a forecasted spend.</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Roadmap */}
            <div style={{ marginTop: 10, background: 'rgba(99,102,241,0.06)', borderRadius: 10, border: '1px solid rgba(129,140,248,0.22)', overflow: 'hidden' }}>
              <button
                onClick={() => setIsRoadmapOpen(prev => !prev)}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  background: 'transparent',
                  border: 'none',
                  color: '#c4b5fd',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
              >
                <span>Roadmap Policy Layers</span>
                <span style={{ color: '#a5b4fc', fontSize: 12, fontWeight: 800 }}>{isRoadmapOpen ? 'Hide ▲' : 'Show ▼'}</span>
              </button>

              {isRoadmapOpen && (
                <div style={{ padding: '0 14px 14px' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
                    Roadmap note only (from internal updates). This section does not change current calculations.
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div style={{ background: 'rgba(15,23,42,0.45)', border: '1px solid rgba(148,163,184,0.16)', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, color: '#a5b4fc', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Today (Current Model)</div>
                      <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
                        1. Universal ULB (baseline for everyone)<br />
                        2. Individual ULB (override for specific users)<br />
                        <span style={{ color: '#94a3b8' }}>This is how power users are handled today.</span>
                      </div>
                    </div>
                    <div style={{ background: 'rgba(15,23,42,0.45)', border: '1px solid rgba(148,163,184,0.16)', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, color: '#86efac', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>June (End of Month)</div>
                      <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
                        1. Team-based governance (Teams mapped to Cost Centers)<br />
                        2. Group-scoped ULB (team / cost-center default)<br />
                        3. Cost-center pool reservation (fair pool protection)
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Dashboard */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, marginBottom: 16 }}>
            {/* Actual Usage Summary */}
            <div style={GLOW_CARD}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#a855f7' }}>📈 Actual Usage Summary</h3>
              <StatRow label="Total Users (setting)" value={stats.totalUsers.toLocaleString()} />
              <StatRow label="Business Users" value={settings.businessUsers.toLocaleString()} />
              <StatRow label="Enterprise Users" value={settings.enterpriseUsers.toLocaleString()} />
              {stats.csvUserCount > 0 && stats.csvUserCount !== stats.totalUsers && (
                <StatRow label="Users in CSV" value={stats.csvUserCount.toLocaleString()} color="#94a3b8" />
              )}
              {(stats.extraBusiness + stats.extraEnterprise) > 0 && (
                <StatRow label="Zero-consumption users" value={`${(stats.extraBusiness + stats.extraEnterprise).toLocaleString()} (${stats.extraBusiness} B / ${stats.extraEnterprise} E)`} color="#64748b" />
              )}
              <StatRow label="Total AIC Cost" value={formatCurrency(stats.totalAicCost)} />
              <StatRow label="Moyenne" value={formatCurrency(stats.moyenne)} />
              <StatRow label="Median Cost" value={formatCurrency(stats.median)} />
              <StatRow label="Heavy Users" value={`${stats.heavyUsers} (${formatPct(stats.heavyPct)})`} />
              <StatRow label="Normal Users" value={`${stats.normalUsers} (${formatPct(stats.normalPct)})`} />
            </div>

            {/* Pool Analysis */}
            <div style={GLOW_CARD}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#a855f7' }}>🏦 Pool Analysis</h3>
              <StatRow label="Business Users" value={`${stats.businessUsers.toLocaleString()} × $${settings.businessLicensePrice} = ${formatCurrency(stats.businessPool)}`} />
              <StatRow label="Enterprise Users" value={`${stats.enterpriseUsers.toLocaleString()} × $${settings.enterpriseLicensePrice} = ${formatCurrency(stats.enterprisePool)}`} />
              <StatRow label="Total Included Pool" value={formatCurrency(stats.totalPool)} />
              <StatRow label="Total Consumption" value={formatCurrency(stats.totalAicCost)} />
              <StatRow label="Pool Utilization" value={formatPct(stats.poolUtilization)} />
              <ProgressBar pct={stats.poolUtilization} />
              {stats.totalPool > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Pool vs Consumption by License Type</div>
                  {/* Business bar */}
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Business</span>
                      <span>{formatCurrency(stats.businessConsumption)} / {formatCurrency(stats.businessPool)} ({stats.businessPool > 0 ? formatPct(stats.businessConsumption / stats.businessPool * 100) : '0%'})</span>
                    </div>
                    <div style={{ position: 'relative', height: 16, borderRadius: 4, overflow: 'hidden', background: 'rgba(99, 102, 241, 0.15)' }}>
                      <div style={{ position: 'absolute', height: '100%', width: '100%', background: 'rgba(99, 102, 241, 0.25)', borderRadius: 4 }} />
                      <div style={{
                        position: 'absolute', height: '100%', borderRadius: 4,
                        width: `${Math.min(100, stats.businessPool > 0 ? (stats.businessConsumption / stats.businessPool) * 100 : 0)}%`,
                        background: stats.businessConsumption > stats.businessPool ? 'linear-gradient(90deg, #eab308, #ef4444)' : 'linear-gradient(90deg, #6366f1, #a855f7)',
                      }} />
                    </div>
                  </div>
                  {/* Enterprise bar */}
                  <div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 3, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Enterprise</span>
                      <span>{formatCurrency(stats.enterpriseConsumption)} / {formatCurrency(stats.enterprisePool)} ({stats.enterprisePool > 0 ? formatPct(stats.enterpriseConsumption / stats.enterprisePool * 100) : '0%'})</span>
                    </div>
                    <div style={{ position: 'relative', height: 16, borderRadius: 4, overflow: 'hidden', background: 'rgba(99, 102, 241, 0.15)' }}>
                      <div style={{ position: 'absolute', height: '100%', width: '100%', background: 'rgba(99, 102, 241, 0.25)', borderRadius: 4 }} />
                      <div style={{
                        position: 'absolute', height: '100%', borderRadius: 4,
                        width: `${Math.min(100, stats.enterprisePool > 0 ? (stats.enterpriseConsumption / stats.enterprisePool) * 100 : 0)}%`,
                        background: stats.enterpriseConsumption > stats.enterprisePool ? 'linear-gradient(90deg, #eab308, #ef4444)' : 'linear-gradient(90deg, #6366f1, #a855f7)',
                      }} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Budget Validation */}
            <div style={GLOW_CARD}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: '#a855f7' }}>✅ Budget Coverage Check</h3>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 12, lineHeight: 1.5 }}>
                Planning upper-bound for fair pool distribution: caps are intentionally above average need, because strict "each user only spends what they bring" creates silos.
              </div>

              {/* Breakdown */}
              <div style={{ background: 'rgba(99,102,241,0.06)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Budget Caps Breakdown</div>
                <StatRow label={`${stats.normalUsers.toLocaleString()} normal users × ${formatCurrency(selectedUniversal)}`} value={formatCurrency(stats.normalUsers * selectedUniversal)} color="#64748b" />
                <StatRow label={`${stats.heavyUsers.toLocaleString()} heavy users × ${formatCurrency(individualBudget)}`} value={formatCurrency(stats.heavyUsers * individualBudget)} color="#64748b" />
                <div style={{ borderTop: '1px solid rgba(148,163,184,0.15)', margin: '4px 0' }} />
                <StatRow label="Total budget allowed" value={formatCurrency(stats.sumEffectiveBudgets)} />
                <StatRow label="Minus license fees already paid" value={`− ${formatCurrency(stats.totalPool)}`} color="#64748b" />
              </div>

              {/* Key result */}
              <div style={{ background: stats.overageExposure > settings.enterpriseBudget ? 'rgba(239,68,68,0.08)' : 'rgba(234,179,8,0.08)', borderRadius: 8, padding: '10px 12px', marginBottom: 10, border: `1px solid ${stats.overageExposure > settings.enterpriseBudget ? 'rgba(239,68,68,0.2)' : 'rgba(234,179,8,0.2)'}` }}>
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Extra you need to fund</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: stats.overageExposure > settings.enterpriseBudget ? '#ef4444' : '#eab308', letterSpacing: '-0.5px' }}>
                  {formatCurrency(stats.overageExposure)}
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>over and above what licenses already cover</div>
              </div>

              {/* Validation */}
              <StatRow label="Your Enterprise Budget" value={formatCurrency(settings.enterpriseBudget)} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid rgba(148,163,184,0.1)', marginTop: 4 }}>
                <span style={{ color: '#94a3b8', fontSize: 13 }}>Does your budget cover the exposure?</span>
                <span style={{ color: stats.enterpriseValid ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: 14 }}>
                  {stats.enterpriseValid ? '✅ Yes' : '⚠️ No'}
                </span>
              </div>
              <StatRow label={stats.gap >= 0 ? 'Safety margin' : 'Shortfall'} value={formatCurrency(Math.abs(stats.gap))} color={stats.gap >= 0 ? '#22c55e' : '#ef4444'} />
            </div>

            {/* Simulation Impact */}
            <div style={GLOW_CARD}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: '#a855f7' }}>🎯 Simulation Impact</h3>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, lineHeight: 1.5, fontWeight: 600 }}>
                Step 1: Budget Control Impact
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8, lineHeight: 1.5 }}>
                First pass = universal limit ({formatCurrency(selectedUniversal)}). Final pass = individual limit for heavy users ({formatCurrency(individualBudget)}).
              </div>
              <StatRow
                label="Blocked at Universal (first pass)"
                value={`${blockedBreakdown.universalBlockedUsers} users · ${formatCurrency(blockedBreakdown.universalBlockedAmount)}`}
                color="#f59e0b"
              />
              <StatRow
                label="Still Blocked after Individual (final)"
                value={`${blockedBreakdown.individualBlockedUsers} users · ${formatCurrency(blockedBreakdown.individualBlockedAmount)}`}
                color="#ef4444"
              />
              <StatRow
                label="Recovered by Individual upgrade"
                value={`${blockedBreakdown.recoveredByIndividualUsers} users · ${formatCurrency(blockedBreakdown.recoveredByIndividualAmount)}`}
                color="#22c55e"
              />
              <div style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)', margin: '8px 0' }} />
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, lineHeight: 1.5, fontWeight: 600 }}>
                Step 2: Overall Population Outcome
              </div>
              <StatRow label="🟢 OK (safe headroom)" value={`${stats.okCount} (${formatPct(stats.okPct)})`} color="#22c55e" />
              <StatRow label="🟡 NEAR (high usage)" value={`${stats.nearCount} (${formatPct(stats.nearPct)})`} color="#eab308" />
              <StatRow label="🔴 OVER (blocked)" value={`${stats.overCount} (${formatPct(stats.overPct)})`} color="#ef4444" />
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 24 }}>
                  {stats.okPct > 0 && <div style={{ width: `${stats.okPct}%`, background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{formatPct(stats.okPct)}</div>}
                  {stats.nearPct > 0 && <div style={{ width: `${stats.nearPct}%`, background: '#eab308', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#000' }}>{formatPct(stats.nearPct)}</div>}
                  {stats.overPct > 0 && <div style={{ width: `${stats.overPct}%`, background: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{formatPct(stats.overPct)}</div>}
                </div>
              </div>
            </div>
          </div>

          {/* Table Controls */}
          <div style={{ ...GLOW_CARD, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Search username..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              style={{ ...INPUT_STYLE, width: 200 }}
            />
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }} style={{ ...INPUT_STYLE, width: 120 }}>
              <option value="ALL">All Status</option>
              <option value="OK">🟢 OK</option>
              <option value="NEAR">🟡 NEAR</option>
              <option value="OVER">🔴 OVER</option>
            </select>
            <select value={licenseFilter} onChange={(e) => { setLicenseFilter(e.target.value); setCurrentPage(1); }} style={{ ...INPUT_STYLE, width: 140 }}>
              <option value="ALL">All Licenses</option>
              <option value="Business">Business</option>
              <option value="Enterprise">Enterprise</option>
            </select>
            <select value={heavyFilter} onChange={(e) => { setHeavyFilter(e.target.value); setCurrentPage(1); }} style={{ ...INPUT_STYLE, width: 140 }}>
              <option value="ALL">All Users</option>
              <option value="Yes">Heavy Users</option>
              <option value="No">Normal Users</option>
            </select>
            <select value={impactFilter} onChange={(e) => { setImpactFilter(e.target.value as ImpactFilter); setCurrentPage(1); }} style={{ ...INPUT_STYLE, width: 220 }}>
              <option value="ALL">All Impact</option>
              <option value="UNIVERSAL_BLOCKED">Blocked at Universal Limit</option>
              <option value="STILL_BLOCKED">Still Blocked After Individual</option>
              <option value="RECOVERED">Recovered by Individual</option>
            </select>
            <div style={{ flex: 1 }} />
            <span style={{ color: '#94a3b8', fontSize: 13 }}>
              {filteredUsers.length} of {userSummaries.length} users
            </span>
            <button onClick={handleExportCsv} style={{ ...BTN_STYLE, fontSize: 13, padding: '8px 16px' }}>
              ⬇️ Export CSV
            </button>
          </div>

          {/* Per-User Table */}
          <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid rgba(168, 85, 247, 0.2)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'rgba(99, 102, 241, 0.15)' }}>
                  {[
                    ['username', 'Username'],
                    ['costCenter', 'Cost Center'],
                    ['licenseType', 'License'],
                    ['totalAicQty', 'AIC Qty'],
                    ['totalAicCost', 'AIC Cost ($)'],
                    ['moyenne', 'Moyenne ($)'],
                    ['isHeavyUser', 'Heavy?'],
                    ['effectiveBudget', 'Eff. Budget ($)'],
                    ['includedCredits', 'License Credit ($)'],
                    ['overage', 'Overage ($)'],
                    ['budgetHeadroom', 'Headroom ($)'],
                    ['budgetUsedPct', 'Used (%)'],
                    ['status', 'Status'],
                  ].map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key as SortKey)}
                      style={{
                        padding: '10px 8px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        color: sortKey === key ? '#a855f7' : '#94a3b8',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        userSelect: 'none',
                        borderBottom: '1px solid rgba(168, 85, 247, 0.2)',
                      }}
                    >
                      {label} {sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedUsers.map((u) => (
                  <tr
                    key={u.username}
                    style={{
                      background: u.status === 'OVER'
                        ? 'rgba(239, 68, 68, 0.06)'
                        : u.status === 'NEAR'
                        ? 'rgba(234, 179, 8, 0.06)'
                        : 'transparent',
                      borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
                    }}
                  >
                    <td style={{ padding: '8px', fontWeight: 500 }}>{u.username}</td>
                    <td style={{ padding: '8px', color: '#94a3b8' }}>{u.costCenter || '—'}</td>
                    <td style={{ padding: '8px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        background: u.licenseType === 'Business' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(99, 102, 241, 0.15)',
                        color: u.licenseType === 'Business' ? '#22c55e' : '#6366f1',
                      }}>{u.licenseType}</span>
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{u.totalAicQty.toLocaleString()}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{formatCurrency(u.totalAicCost)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: '#94a3b8' }}>{formatCurrency(u.moyenne)}</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <span style={{ color: u.isHeavyUser ? '#eab308' : '#94a3b8' }}>
                        {u.isHeavyUser ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{formatCurrency(u.effectiveBudget)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: '#94a3b8' }}>{formatCurrency(u.includedCredits)}</td>
                    <td style={{ padding: '8px', textAlign: 'right' }}>{formatCurrency(u.overage)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: u.budgetHeadroom < 0 ? '#ef4444' : '#22c55e' }}>
                      {formatCurrency(u.budgetHeadroom)}
                    </td>
                    <td style={{ padding: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 6, background: 'rgba(148, 163, 184, 0.1)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.min(u.budgetUsedPct, 100)}%`,
                            height: '100%',
                            background: STATUS_COLORS[u.status],
                            borderRadius: 3,
                            transition: 'width 0.3s',
                          }} />
                        </div>
                        <span style={{ fontSize: 11, color: STATUS_COLORS[u.status], minWidth: 40 }}>
                          {formatPct(u.budgetUsedPct)}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      {STATUS_ICONS[u.status]} {u.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{ ...BTN_STYLE, opacity: currentPage === 1 ? 0.5 : 1, padding: '6px 14px', fontSize: 13 }}
              >
                ← Prev
              </button>
              <span style={{ color: '#94a3b8', lineHeight: '36px', fontSize: 13 }}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                style={{ ...BTN_STYLE, opacity: currentPage === totalPages ? 0.5 : 1, padding: '6px 14px', fontSize: 13 }}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(148, 163, 184, 0.06)' }}>
      <span style={{ color: '#94a3b8', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 13, color: color || '#e2e8f0' }}>{value}</span>
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 100 ? '#ef4444' : pct >= 80 ? '#eab308' : '#22c55e';
  return (
    <div style={{ marginTop: 8, height: 8, background: 'rgba(148, 163, 184, 0.1)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s' }} />
    </div>
  );
}
