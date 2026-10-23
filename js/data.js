// Sample data for SunGrid Solar, a (fictional) residential + commercial solar installer in Lahore.
// Everything here is bundled with the app so it works fully offline.
// Prices are indicative PKR figures for the Pakistani market; they are sample data, not a price list.

export const company = {
  name: 'SunGrid Solar',
  tagline: 'Solar installation & net-metering, Punjab',
  office: 'Office 4, Ali Tower, MM Alam Road, Gulberg III, Lahore',
  phone: '+92 42 3555 0142',
};

/** Job pipeline, in order. A job moves left to right. */
export const STATUSES = [
  'Site survey',
  'Quoted',
  'Approved',
  'Installing',
  'Net-metering',
  'Commissioned',
];

/** Peak sun hours per day (annual average) and the electricity distribution company (DISCO) per city. */
export const cities = {
  Lahore: { sunHours: 5.0, disco: 'LESCO' },
  Gujranwala: { sunHours: 5.0, disco: 'GEPCO' },
  Faisalabad: { sunHours: 5.2, disco: 'FESCO' },
  Multan: { sunHours: 5.4, disco: 'MEPCO' },
  Islamabad: { sunHours: 4.8, disco: 'IESCO' },
};

/** Assumptions used by the quote calculator. Change here, not in the logic. */
export const pricing = {
  panelWatt: 575, // JA Solar JAM72D40 575 W
  performanceRatio: 0.78, // real-world losses: heat, dust, cabling, inverter
  onGridPerKwPkr: 160000, // installed, per kWp, grid-tied inverter
  hybridPerKwPkr: 185000, // installed, per kWp, hybrid inverter
  batteryPkr: 395000, // Pylontech US5000 4.8 kWh
  batteryKwh: 4.8,
  kwPerBattery: 5, // hybrid quotes include 1 battery per 5 kWp (minimum 1)
  tariffPkrPerKwh: 55, // blended residential tariff incl. taxes
  minUnits: 50,
  maxUnits: 5000,
};

export const jobs = [
  {
    id: 'SG-1042',
    customer: 'Ahmed Raza',
    site: 'House 214, Street 9, DHA Phase 5',
    city: 'Lahore',
    type: 'On-grid',
    panels: 18,
    panelWatt: 575,
    inverter: 'Huawei SUN2000-10KTL-M1',
    batteries: 0,
    status: 'Net-metering',
    valuePkr: 1720000,
    nextStep: 'LESCO meter inspection',
    nextDate: '2026-10-24',
  },
  {
    id: 'SG-1043',
    customer: 'Ayesha Siddiqui',
    site: 'House 57-B, Block C, Johar Town',
    city: 'Lahore',
    type: 'Hybrid',
    panels: 12,
    panelWatt: 575,
    inverter: 'Growatt SPH 6000TL3 BH',
    batteries: 2,
    status: 'Installing',
    valuePkr: 1980000,
    nextStep: 'Battery rack and AC/DC box fitting',
    nextDate: '2026-10-22',
  },
  {
    id: 'SG-1044',
    customer: 'Usman Traders (Pvt) Ltd',
    site: 'Plot 31, Kot Lakhpat Industrial Area',
    city: 'Lahore',
    type: 'On-grid',
    panels: 40,
    panelWatt: 575,
    inverter: 'Huawei SUN2000-20KTL-M3',
    batteries: 0,
    status: 'Approved',
    valuePkr: 3650000,
    nextStep: 'Deliver panels and structure to site',
    nextDate: '2026-10-27',
  },
  {
    id: 'SG-1045',
    customer: 'Fatima Noor',
    site: 'House 12, Sector B, Bahria Town',
    city: 'Lahore',
    type: 'On-grid',
    panels: 9,
    panelWatt: 575,
    inverter: 'Huawei SUN2000-5KTL-L1',
    batteries: 0,
    status: 'Quoted',
    valuePkr: 845000,
    nextStep: 'Follow up on quote and advance payment',
    nextDate: '2026-10-23',
  },
  {
    id: 'SG-1046',
    customer: 'Hassan Mehmood',
    site: 'House 88, Block L, Model Town',
    city: 'Lahore',
    type: 'Hybrid',
    panels: 10,
    panelWatt: 575,
    inverter: 'Growatt SPH 6000TL3 BH',
    batteries: 2,
    status: 'Site survey',
    valuePkr: 1850000,
    nextStep: 'Roof survey and shading check',
    nextDate: '2026-10-25',
  },
  {
    id: 'SG-1047',
    customer: 'Al-Noor Medical Centre',
    site: '17 Jaranwala Road, Civil Lines',
    city: 'Faisalabad',
    type: 'On-grid',
    panels: 24,
    panelWatt: 575,
    inverter: 'Huawei SUN2000-12KTL-M2',
    batteries: 0,
    status: 'Quoted',
    valuePkr: 2210000,
    nextStep: 'Revised quote after load review',
    nextDate: '2026-10-28',
  },
  {
    id: 'SG-1038',
    customer: 'Bilal Chaudhry',
    site: 'House 9, Street 14, Gulberg III',
    city: 'Lahore',
    type: 'On-grid',
    panels: 14,
    panelWatt: 575,
    inverter: 'Huawei SUN2000-8KTL-M1',
    batteries: 0,
    status: 'Commissioned',
    valuePkr: 1290000,
    nextStep: 'First-year performance check',
    nextDate: '2027-09-15',
  },
  {
    id: 'SG-1039',
    customer: 'Sana Tariq',
    site: 'House 140, Phase 1, Wapda Town',
    city: 'Lahore',
    type: 'On-grid',
    panels: 10,
    panelWatt: 550,
    inverter: 'Inverex Veyron II 5 kW',
    batteries: 0,
    status: 'Commissioned',
    valuePkr: 910000,
    nextStep: 'Panel cleaning visit',
    nextDate: '2026-11-12',
  },
];

export const inventory = [
  { sku: 'PNL-JA575', name: 'JA Solar JAM72D40 575 W bifacial panel', category: 'Panels', stock: 126, reorderLevel: 60, unitPricePkr: 16100 },
  { sku: 'PNL-LG550', name: 'Longi Hi-MO 5 550 W panel', category: 'Panels', stock: 34, reorderLevel: 40, unitPricePkr: 15400 },
  { sku: 'INV-HW10', name: 'Huawei SUN2000-10KTL-M1 inverter', category: 'Inverters', stock: 4, reorderLevel: 2, unitPricePkr: 285000 },
  { sku: 'INV-HW20', name: 'Huawei SUN2000-20KTL-M3 inverter', category: 'Inverters', stock: 2, reorderLevel: 1, unitPricePkr: 420000 },
  { sku: 'INV-GW6', name: 'Growatt SPH 6000TL3 BH hybrid inverter', category: 'Inverters', stock: 3, reorderLevel: 4, unitPricePkr: 340000 },
  { sku: 'BAT-PY48', name: 'Pylontech US5000 4.8 kWh battery', category: 'Batteries', stock: 5, reorderLevel: 4, unitPricePkr: 395000 },
  { sku: 'MNT-AL5', name: 'Aluminium mounting rail set (per 5 kWp)', category: 'Structure', stock: 22, reorderLevel: 10, unitPricePkr: 90000 },
  { sku: 'CBL-DC6', name: 'DC solar cable 6 mm², 100 m roll', category: 'Cabling', stock: 14, reorderLevel: 8, unitPricePkr: 24000 },
  { sku: 'PRT-ACDC', name: 'AC/DC protection box (breakers + SPD)', category: 'Protection', stock: 11, reorderLevel: 10, unitPricePkr: 32000 },
  { sku: 'ERT-KIT', name: 'Earthing kit (rod, clamp, copper strip)', category: 'Protection', stock: 0, reorderLevel: 6, unitPricePkr: 9500 },
];
