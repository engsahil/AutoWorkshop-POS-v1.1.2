/**
 * Optional demonstration dataset.
 * Clearly user-invoked (Settings → Data, or the empty dashboard) and always
 * created through the real transaction pipeline, so it obeys stock, numbering
 * and balance rules. It never runs automatically and never mixes with existing
 * business records.
 */
import { dbAll, dbCount } from './db';
import {
  createCustomer, createLabor, createPart, createService, createSupplier, createVehicle,
  createWarranty, notify, type Actor
} from './repo';
import {
  createExpense, createJobCard, changeJobStatus, createPurchase, invoiceJobCard,
  payPurchase, receivePurchase, sell, createReturn, type SaleLineInput
} from './transactions';
import { todayISO } from './money';
import { uid } from './ids';
import { mutate, audit } from './repo';
import type { Customer, Invoice, JobCard, Part, Service, Vehicle } from './types';

function prng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export async function demoDataExists(): Promise<boolean> {
  const [invoices, jobs] = await Promise.all([dbCount('invoices'), dbCount('jobcards')]);
  return invoices > 0 || jobs > 0;
}

export async function loadDemoData(actor: Actor): Promise<{ invoices: number; jobs: number; customers: number }> {
  if (await demoDataExists()) {
    throw new Error('Demo data can only be loaded into a fresh workspace (no invoices or job cards yet).');
  }
  const rand = prng(20251021);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const daysAgoTs = (d: number, hour = 11) => {
    const date = new Date();
    date.setDate(date.getDate() - d);
    date.setHours(hour, Math.floor(rand() * 55), 0, 0);
    return date.getTime();
  };

  const suppliers = [];
  suppliers.push(await createSupplier({ name: 'Al-Madina Auto Parts', contactPerson: 'Faisal Mehmood', phone: '0423 555 1200', address: 'Bilal Gunj, Lahore' }, actor));
  suppliers.push(await createSupplier({ name: 'Pak Lubricants Depot', contactPerson: 'Nadia Iqbal', phone: '0300 845 2211', address: 'Badami Bagh, Lahore' }, actor));
  suppliers.push(await createSupplier({ name: 'Highway Tyre House', contactPerson: 'Usman Tariq', phone: '0321 778 9911', address: 'Ferozepur Road, Lahore' }, actor));

  const partSeeds: Partial<Part>[] = [
    { name: 'Engine Oil 5W-30 (4L)', sku: 'OIL-5W30', category: 'Lubricants', brand: 'Shell', costPaisa: 820000, pricePaisa: 1150000, qty: 46, reorderLevel: 12, unit: 'bottle', supplierId: suppliers[1].id },
    { name: 'Oil Filter — Corolla', sku: 'FLT-COR-01', category: 'Filters', brand: 'Toyota Genuine', costPaisa: 145000, pricePaisa: 240000, qty: 30, reorderLevel: 8, unit: 'pcs', supplierId: suppliers[0].id },
    { name: 'Air Filter — Civic', sku: 'FLT-CIV-02', category: 'Filters', brand: 'Denso', costPaisa: 210000, pricePaisa: 340000, qty: 18, reorderLevel: 6, unit: 'pcs', supplierId: suppliers[0].id },
    { name: 'Brake Pad Set — Front', sku: 'BRK-PAD-01', category: 'Braking', brand: 'Bosch', costPaisa: 385000, pricePaisa: 620000, qty: 14, reorderLevel: 5, unit: 'set', supplierId: suppliers[0].id },
    { name: 'Brake Fluid DOT4', sku: 'BRK-FLD-04', category: 'Braking', brand: 'Total', costPaisa: 68000, pricePaisa: 125000, qty: 22, reorderLevel: 6, unit: 'bottle', supplierId: suppliers[1].id },
    { name: 'Spark Plug (Iridium)', sku: 'SPK-IRD-01', category: 'Ignition', brand: 'NGK', costPaisa: 92000, pricePaisa: 165000, qty: 40, reorderLevel: 12, unit: 'pcs', supplierId: suppliers[0].id },
    { name: 'Wiper Blade 20"', sku: 'WPR-20-01', category: 'Accessories', brand: 'Valeo', costPaisa: 52000, pricePaisa: 95000, qty: 26, reorderLevel: 8, unit: 'pcs', supplierId: suppliers[0].id },
    { name: 'Battery 55Ah', sku: 'BAT-55AH', category: 'Electrical', brand: 'Ags', costPaisa: 2050000, pricePaisa: 2680000, qty: 6, reorderLevel: 3, unit: 'pcs', supplierId: suppliers[2].id, warrantyMonths: 12 },
    { name: 'Coolant Concentrate', sku: 'CLT-GRN-01', category: 'Lubricants', brand: 'Caltex', costPaisa: 78000, pricePaisa: 135000, qty: 19, reorderLevel: 6, unit: 'bottle', supplierId: suppliers[1].id },
    { name: 'AC Compressor — City', sku: 'ACP-CIT-01', category: 'AC System', brand: 'Subros', costPaisa: 4650000, pricePaisa: 5900000, qty: 3, reorderLevel: 2, unit: 'pcs', supplierId: suppliers[0].id, warrantyMonths: 6 },
    { name: 'Shock Absorber — Rear', sku: 'SHK-REAR-01', category: 'Suspension', brand: 'KYB', costPaisa: 690000, pricePaisa: 998000, qty: 9, reorderLevel: 4, unit: 'pcs', supplierId: suppliers[0].id },
    { name: 'Headlight Bulb H4', sku: 'BLB-H4-01', category: 'Electrical', brand: 'Philips', costPaisa: 42000, pricePaisa: 82000, qty: 3, reorderLevel: 8, unit: 'pcs', supplierId: suppliers[0].id },
    { name: 'Clutch Kit — Alto', sku: 'CLT-ALT-01', category: 'Transmission', brand: 'Exedy', costPaisa: 1450000, pricePaisa: 1975000, qty: 4, reorderLevel: 2, unit: 'set', supplierId: suppliers[0].id },
    { name: 'Wheel Alignment Bolt Kit', sku: 'ALN-BLT-01', category: 'Suspension', brand: 'Genuine', costPaisa: 65000, pricePaisa: 120000, qty: 16, reorderLevel: 5, unit: 'kit', supplierId: suppliers[2].id }
  ];
  const parts: Part[] = [];
  for (const seed of partSeeds) parts.push(await createPart(seed, actor));

  const serviceSeeds: Partial<Service>[] = [
    { name: 'General Service', category: 'General Service', pricePaisa: 450000, durationMins: 120, description: 'Full inspection, fluid top-up and road test.' },
    { name: 'Oil & Filter Change', category: 'Oil Change', pricePaisa: 280000, durationMins: 45 },
    { name: 'Brake Service', category: 'Brake Service', pricePaisa: 650000, durationMins: 90 },
    { name: 'AC Service & Gas Refill', category: 'AC Service', pricePaisa: 780000, durationMins: 120 },
    { name: 'Engine Diagnostics', category: 'Diagnostics', pricePaisa: 550000, durationMins: 60 },
    { name: 'Wheel Alignment & Balancing', category: 'General Service', pricePaisa: 380000, durationMins: 45 }
  ];
  const services: Service[] = [];
  for (const seed of serviceSeeds) services.push(await createService(seed, actor));

  await createLabor({ name: 'Master Technician — Hourly', ratePaisa: 120000, category: 'Workshop Labor' }, actor);
  await createLabor({ name: 'Bodywork & Paint — Panel', ratePaisa: 350000, category: 'Bodywork' }, actor);
  await createLabor({ name: 'Electrical Work — Hourly', ratePaisa: 140000, category: 'Electrical' }, actor);

  const customerSeeds = [
    { name: 'Ahmed Raza', phone: '0300 111 2233', email: 'ahmed.raza@example.pk' },
    { name: 'Bilal Khan', phone: '0321 445 6677', email: 'bilal.khan@example.pk' },
    { name: 'Sara Malik', phone: '0333 998 4455', email: 'sara.malik@example.pk' },
    { name: 'Imran Sheikh', phone: '0345 220 8899' },
    { name: 'Ayesha Butt', phone: '0301 556 7788', email: 'ayesha.butt@example.pk' },
    { name: 'Hassan Ali', phone: '0312 330 1122' }
  ];
  const customers: Customer[] = [];
  for (const seed of customerSeeds) customers.push(await createCustomer(seed, actor));

  const vehicleSeeds = [
    { customerIdx: 0, regNo: 'LEB-1234', make: 'Toyota', model: 'Corolla', year: 2021, color: 'White', odometer: 48200 },
    { customerIdx: 1, regNo: 'LEC-7788', make: 'Honda', model: 'Civic', year: 2020, color: 'Silver', odometer: 63400 },
    { customerIdx: 2, regNo: 'LZA-4455', make: 'Suzuki', model: 'Alto', year: 2019, color: 'Grey', odometer: 72100 },
    { customerIdx: 3, regNo: 'LEA-9012', make: 'Toyota', model: 'Yaris', year: 2022, color: 'Pearl White', odometer: 21800 },
    { customerIdx: 4, regNo: 'LEC-2211', make: 'Honda', model: 'City', year: 2023, color: 'Black', odometer: 12400 },
    { customerIdx: 5, regNo: 'LEX-6060', make: 'Kia', model: 'Sportage', year: 2021, color: 'Blue', odometer: 39900 }
  ];
  const vehicles: Vehicle[] = [];
  for (const seed of vehicleSeeds) {
    vehicles.push(await createVehicle({
      customerId: customers[seed.customerIdx].id, regNo: seed.regNo, make: seed.make,
      model: seed.model, year: seed.year, color: seed.color, odometer: seed.odometer
    }, actor));
  }

  // Purchases (one received & partly paid, one draft)
  const purchase1 = await createPurchase({
    supplierId: suppliers[1].id,
    lines: [
      { partId: parts[0].id, name: parts[0].name, sku: parts[0].sku, qty: 24, costPaisa: 820000 },
      { partId: parts[8].id, name: parts[8].name, sku: parts[8].sku, qty: 12, costPaisa: 78000 }
    ],
    notes: 'Monthly lubricants restock'
  }, actor);
  await receivePurchase(purchase1.id, actor);
  await payPurchase(purchase1.id, [{ method: 'bank', amountPaisa: 1500000 }], actor, uid('op'));

  await createPurchase({
    supplierId: suppliers[0].id,
    lines: [
      { partId: parts[3].id, name: parts[3].name, sku: parts[3].sku, qty: 10, costPaisa: 385000 },
      { partId: parts[5].id, name: parts[5].name, sku: parts[5].sku, qty: 24, costPaisa: 92000 }
    ],
    notes: 'Brake and ignition stock'
  }, actor);

  // Sales across ~5.5 months
  const salesMix = [
    { day: 158, customer: 0, vehicle: 0, parts: [1, 2], service: 0, pay: 'paid' },
    { day: 149, customer: 1, vehicle: 1, parts: [3], service: 2, pay: 'paid' },
    { day: 141, customer: 2, vehicle: 2, parts: [0, 1], service: 1, pay: 'paid' },
    { day: 132, customer: 3, vehicle: 3, parts: [], service: 0, pay: 'paid' },
    { day: 124, customer: 4, vehicle: 4, parts: [5, 5, 5, 5], service: 4, pay: 'partial' },
    { day: 118, customer: 5, vehicle: 5, parts: [4], service: 3, pay: 'paid' },
    { day: 109, customer: 0, vehicle: 0, parts: [0, 1], service: 1, pay: 'paid' },
    { day: 101, customer: 1, vehicle: 1, parts: [2, 6], service: 0, pay: 'paid' },
    { day: 93, customer: 2, vehicle: 2, parts: [8], service: 1, pay: 'unpaid' },
    { day: 86, customer: 3, vehicle: 3, parts: [3], service: 2, pay: 'paid' },
    { day: 78, customer: 4, vehicle: 4, parts: [0], service: 3, pay: 'paid' },
    { day: 71, customer: 5, vehicle: 5, parts: [11], service: 4, pay: 'paid' },
    { day: 63, customer: 0, vehicle: 0, parts: [6, 6], service: 0, pay: 'paid' },
    { day: 55, customer: 1, vehicle: 1, parts: [10], service: 2, pay: 'partial' },
    { day: 47, customer: 2, vehicle: 2, parts: [0, 1], service: 1, pay: 'paid' },
    { day: 40, customer: 3, vehicle: 3, parts: [], service: 5, pay: 'paid' },
    { day: 33, customer: 4, vehicle: 4, parts: [7], service: 4, pay: 'unpaid' },
    { day: 26, customer: 5, vehicle: 5, parts: [3, 4], service: 2, pay: 'paid' },
    { day: 18, customer: 0, vehicle: 0, parts: [0, 1], service: 1, pay: 'paid' },
    { day: 12, customer: 1, vehicle: 1, parts: [2], service: 4, pay: 'paid' },
    { day: 7, customer: 2, vehicle: 2, parts: [5, 5], service: 0, pay: 'paid' },
    { day: 4, customer: 3, vehicle: 3, parts: [6], service: 1, pay: 'paid' },
    { day: 2, customer: 4, vehicle: 4, parts: [3], service: 2, pay: 'partial' },
    { day: 0, customer: 5, vehicle: 5, parts: [0], service: 1, pay: 'paid' }
  ];

  let invoiceCount = 0;
  let lastInvoice: Invoice | null = null;
  for (const mix of salesMix) {
    const customer = customers[mix.customer];
    const vehicle = vehicles[mix.vehicle];
    const lines: SaleLineInput[] = [];
    for (const pi of mix.parts) {
      const p = parts[pi];
      lines.push({ kind: 'part', refId: p.id, name: p.name, qty: 1, ratePaisa: p.pricePaisa, taxRate: 0 });
    }
    const svc = services[mix.service % services.length];
    lines.push({ kind: 'service', refId: svc.id, name: svc.name, qty: 1, ratePaisa: svc.pricePaisa, taxRate: 0 });
    if (rand() > 0.55) {
      lines.push({ kind: 'labor', name: 'Workshop labor — hourly', qty: 1, ratePaisa: 120000, taxRate: 0 });
    }
    const total = lines.reduce((a, l) => a + l.qty * l.ratePaisa, 0);
    const payments = mix.pay === 'paid'
      ? [{ method: pick(['cash', 'card', 'bank'] as const), amountPaisa: total }]
      : mix.pay === 'partial'
        ? [{ method: 'cash' as const, amountPaisa: Math.round(total * 0.4) }]
        : [];
    const inv = await sell({
      customerId: customer.id, vehicleId: vehicle.id, lines, payments,
      date: daysAgoTs(mix.day), actor, opId: uid('op'), type: 'pos'
    });
    invoiceCount++;
    lastInvoice = inv;
  }

  // One return against the most recent paid invoice
  if (lastInvoice) {
    const partLine = (lastInvoice as Invoice).lines.find((l) => l.kind === 'part');
    if (partLine) {
      await createReturn({
        invoiceId: lastInvoice.id,
        lines: [{ lineId: partLine.id, qty: 1, restock: true }],
        refundMethod: 'cash',
        reason: 'Customer returned unused part — wrong fitment',
        actor,
        opId: uid('op')
      });
    }
  }

  // Job cards across statuses
  const jobSeeds = [
    { customer: 0, vehicle: 0, complaint: 'Engine noise at cold start, oil change due.', status: 'in_progress', priority: 'normal' },
    { customer: 1, vehicle: 1, complaint: 'AC not cooling on low fan speed.', status: 'approved', priority: 'high' },
    { customer: 2, vehicle: 2, complaint: 'Brake pedal feels soft; steering vibration at 80 km/h.', status: 'awaiting_approval', priority: 'urgent' },
    { customer: 3, vehicle: 3, complaint: 'Scheduled 20,000 km service.', status: 'ready', priority: 'normal' },
    { customer: 4, vehicle: 4, complaint: 'Battery warning light intermittently on.', status: 'draft', priority: 'low' },
    { customer: 5, vehicle: 5, complaint: 'Front suspension knocking over speed breakers.', status: 'on_hold', priority: 'high' }
  ];
  let jobsCreated = 0;
  const createdJobs: JobCard[] = [];
  for (const seed of jobSeeds) {
    const svc = services[(seed.customer + 2) % services.length];
    const job = await createJobCard({
      customerId: customers[seed.customer].id,
      vehicleId: vehicles[seed.vehicle].id,
      odometer: 20000 + seed.vehicle * 9000,
      complaint: seed.complaint,
      findings: 'Initial inspection completed; recommend the listed service items.',
      recommendation: svc.name,
      priority: seed.priority as JobCard['priority'],
      dueDate: todayISO(new Date(Date.now() + 86400000 * (seed.vehicle + 1))),
      estimatePaisa: svc.pricePaisa + 250000,
      lines: [
        { id: uid('jl'), kind: 'service', refId: svc.id, name: svc.name, qty: 1, ratePaisa: svc.pricePaisa, taxRate: 0 },
        { id: uid('jl'), kind: 'part', refId: parts[seed.vehicle % 6].id, name: parts[seed.vehicle % 6].name, qty: 1, ratePaisa: parts[seed.vehicle % 6].pricePaisa, taxRate: 0 }
      ]
    }, actor);
    createdJobs.push(job);
    jobsCreated++;
    if (seed.status !== 'draft' && seed.status !== 'awaiting_approval') {
      await changeJobStatus(job.id, 'awaiting_approval', 'Customer notified', actor);
      await changeJobStatus(job.id, 'approved', 'Approved by customer on phone', actor);
    }
    if (['in_progress', 'ready', 'on_hold'].includes(seed.status)) {
      await changeJobStatus(job.id, 'in_progress', 'Work started', actor);
    }
    if (seed.status === 'on_hold') {
      await changeJobStatus(job.id, 'on_hold', 'Waiting for parts delivery', actor);
    }
    if (seed.status === 'ready') {
      await changeJobStatus(job.id, 'ready', 'Road test complete', actor);
    }
  }

  // Invoice one job so completed-job reporting has data
  const invoiceJob = createdJobs[3];
  if (invoiceJob) {
    const estimate = invoiceJob.lines.reduce((a, l) => a + l.qty * l.ratePaisa, 0);
    await invoiceJobCard(invoiceJob.id, [{ method: 'card', amountPaisa: Math.round(estimate * 0.5) }], 0, actor, uid('op'));
  }

  // Expenses
  await createExpense({ category: 'Rent', amountPaisa: 8500000, method: 'bank', description: 'Workshop rent — monthly' }, actor);
  await createExpense({ category: 'Utilities', amountPaisa: 1450000, method: 'cash', description: 'Electricity and water' }, actor);
  await createExpense({ category: 'Consumables', amountPaisa: 320000, method: 'cash', description: 'Shop rags, gloves, degreaser' }, actor);

  // Warranties (one expiring soon so reminders are exercised)
  await createWarranty({
    customerId: customers[0].id, vehicleId: vehicles[0].id, partId: parts[7].id,
    itemName: 'Battery 55Ah', startDate: todayISO(new Date(Date.now() - 340 * 86400000)),
    endDate: todayISO(new Date(Date.now() + 22 * 86400000)),
    terms: '12 months replacement warranty against manufacturing defects.'
  }, actor);
  await createWarranty({
    customerId: customers[4].id, vehicleId: vehicles[4].id, serviceId: services[3].id,
    itemName: 'AC Service & Gas Refill', startDate: todayISO(new Date(Date.now() - 30 * 86400000)),
    endDate: todayISO(new Date(Date.now() + 150 * 86400000)),
    terms: '90-day workmanship warranty.'
  }, actor);

  await mutate(['audit'], async (tx) => {
    await audit(tx, 'demo.load', 'application', 'demo', `Demonstration dataset loaded (${invoiceCount} invoices, ${jobsCreated} job cards)`, actor);
    await notify(tx, 'system', 'Demo data loaded', 'Explore the dashboard, POS and job cards. Clear data from Settings → Data before live use.', '/settings');
  });

  return { invoices: invoiceCount, jobs: jobsCreated, customers: customers.length };
}

export async function clearAllBusinessData(actor: Actor): Promise<void> {
  const stores = [
    'customers', 'vehicles', 'parts', 'services', 'labor', 'suppliers', 'purchases', 'invoices',
    'payments', 'jobcards', 'returns', 'warranty', 'expenses', 'cashShifts', 'cashMovements',
    'stockMoves', 'notifications'
  ] as const;
  await mutate([...stores], async (tx) => {
    for (const store of stores) await tx.clear(store);
    // Read inside the same transaction. Awaiting a separate transaction here
    // lets this one auto-commit, and the sequence resets then throw.
    const seqs = await tx.all<{ key: string; prefix: string; padding: number }>('sequences');
    for (const s of seqs) {
      await tx.put('sequences', { ...s, next: 1, updatedAt: Date.now() });
    }
    await audit(tx, 'backup.import', 'application', 'all', 'All business records cleared (services, staff, users and settings retained)', actor);
  });
}
