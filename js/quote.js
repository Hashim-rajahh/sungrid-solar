// Solar quote estimator. Pure logic, no DOM. Returns either { ok: true, ... } or { ok: false, errors }.
// All assumptions (sun hours, tariff, prices) live in data.js so they are easy to review and change.

import { cities, pricing } from './data.js';

export const SYSTEM_TYPES = ['On-grid', 'Hybrid'];

/** Parse what a person typed into the "monthly units" box. Returns { value } or { error }. */
export function parseUnits(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { error: 'Enter your average monthly units (kWh) from your electricity bill.' };
  }
  const cleaned = String(raw).replace(/[,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return { error: 'Monthly units must be a number, for example 450.' };
  }
  const value = Number(cleaned);
  if (value <= 0) return { error: 'Monthly units must be greater than zero.' };
  if (value < pricing.minUnits) {
    return {
      error: `Under ${pricing.minUnits} units a month is too small for a solar system. Check the "units consumed" line on your bill.`,
    };
  }
  if (value > pricing.maxUnits) {
    return {
      error: `Above ${pricing.maxUnits.toLocaleString('en-US')} units a month needs a commercial site survey. Please call us on the number in the footer.`,
    };
  }
  return { value };
}

/**
 * Size a system for a household/business and estimate cost, savings and payback.
 * @param {{units: string|number, city: string, type: string}} input
 */
export function calculateQuote(input) {
  const errors = {};
  const { units: rawUnits, city, type } = input ?? {};

  const parsed = parseUnits(rawUnits);
  if (parsed.error) errors.units = parsed.error;
  if (!city || !Object.hasOwn(cities, city)) errors.city = 'Choose the city where the system will be installed.';
  if (!SYSTEM_TYPES.includes(type)) errors.type = 'Choose On-grid or Hybrid.';
  if (Object.keys(errors).length) return { ok: false, errors };

  const units = parsed.value;
  const { sunHours } = cities[city];
  const dailyKwhNeeded = units / 30;
  const yieldPerKwPerDay = sunHours * pricing.performanceRatio;
  const requiredKw = dailyKwhNeeded / yieldPerKwPerDay;

  const panels = Math.ceil((requiredKw * 1000) / pricing.panelWatt);
  const systemKw = (panels * pricing.panelWatt) / 1000;

  const batteries = type === 'Hybrid' ? Math.max(1, Math.ceil(systemKw / pricing.kwPerBattery)) : 0;
  const perKw = type === 'Hybrid' ? pricing.hybridPerKwPkr : pricing.onGridPerKwPkr;
  const costPkr = Math.round(systemKw * perKw + batteries * pricing.batteryPkr);

  const monthlyGenerationKwh = systemKw * yieldPerKwPerDay * 30;
  const usedKwh = Math.min(monthlyGenerationKwh, units);
  const offsetPercent = Math.min(100, (monthlyGenerationKwh / units) * 100);
  const monthlySavingsPkr = Math.round(usedKwh * pricing.tariffPkrPerKwh);
  const paybackYears = costPkr / (monthlySavingsPkr * 12);

  return {
    ok: true,
    input: { units, city, type },
    disco: cities[city].disco,
    panels,
    panelWatt: pricing.panelWatt,
    systemKw,
    batteries,
    batteryKwh: batteries * pricing.batteryKwh,
    monthlyGenerationKwh,
    offsetPercent,
    monthlySavingsPkr,
    costPkr,
    paybackYears,
  };
}
