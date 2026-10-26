/**
 * Servixa v1.1.2 — domain types.
 * All monetary values are stored as INTEGER paisa (1 PKR = 100 paisa) to avoid
 * floating point drift. Formatting/parsing happens at the edge (money.ts).
 */

export const APP_VERSION = '1.1.2';
export const BACKUP_FORMAT = 'servixa-backup';
export const BACKUP_VERSION = 1;

export type Role = 'Administrator' | 'Manager' | 'Cashier' | 'Mechanic' | 'Inventory Manager';

export type Permission =
  | 'dashboard.view'
  | 'pos.sell'
  | 'pos.discount'
  | 'pos.void'
  | 'invoices.view'
  | 'invoices.refund'
  | 'jobcards.view'
  | 'jobcards.manage'
  | 'customers.view'
  | 'customers.manage'
  | 'vehicles.view'
  | 'vehicles.manage'
  | 'inventory.view'
  | 'inventory.manage'
  | 'purchases.view'
  | 'purchases.manage'
  | 'suppliers.view'
  | 'returns.view'
  | 'warranty.view'
  | 'warranty.manage'
  | 'expenses.view'
  | 'expenses.manage'
  | 'shifts.view'
  | 'shifts.manage'
  | 'staff.view'
  | 'staff.manage'
  | 'reports.view'
  | 'analytics.view'
  | 'users.manage'
  | 'settings.manage'
  | 'backup.manage'
  | 'audit.view';

export const ALL_PERMISSIONS: Permission[] = [
  'dashboard.view', 'pos.sell', 'pos.discount', 'pos.void', 'invoices.view', 'invoices.refund',
  'jobcards.view', 'jobcards.manage', 'customers.view', 'customers.manage', 'vehicles.view',
  'vehicles.manage', 'inventory.view', 'inventory.manage', 'purchases.view', 'purchases.manage',
  'suppliers.view', 'returns.view', 'warranty.view', 'warranty.manage', 'expenses.view',
  'expenses.manage', 'shifts.view', 'shifts.manage', 'staff.view', 'staff.manage', 'reports.view',
  'analytics.view', 'users.manage', 'settings.manage', 'backup.manage', 'audit.view'
];

export const DEFAULT_ROLES: Record<Role, Permission[]> = {
  Administrator: ALL_PERMISSIONS,
  Manager: ALL_PERMISSIONS.filter((p) => p !== 'users.manage' && p !== 'settings.manage' && p !== 'backup.manage'),
  Cashier: [
    'dashboard.view', 'pos.sell', 'invoices.view', 'jobcards.view', 'customers.view',
    'customers.manage', 'vehicles.view', 'inventory.view', 'warranty.view', 'shifts.view', 'shifts.manage'
  ],
  Mechanic: ['dashboard.view', 'jobcards.view', 'jobcards.manage', 'customers.view', 'vehicles.view', 'inventory.view'],
  'Inventory Manager': [
    'dashboard.view', 'inventory.view', 'inventory.manage', 'purchases.view', 'purchases.manage',
    'suppliers.view', 'returns.view', 'reports.view', 'jobcards.view'
  ]
};

export interface Base {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Origin of the record for offline/sync reporting. */
  origin?: 'local' | 'synced';
}

export interface User extends Base {
  username: string;
  name: string;
  role: Role;
  email?: string;
  phone?: string;
  active: boolean;
  passwordHash: string;
  salt: string;
  iterations: number;
  avatar?: string | null;
  lastLogin?: number;
  preferences: { sound: boolean; volume: number; density: 'comfortable' | 'compact' };
  isOwner?: boolean;
}

/**
 * A user record with credentials removed. Everything that leaves the storage
 * layer (lists, login results, create/update returns) uses this shape, so a
 * password hash never reaches React state, logs or JSON dumps.
 */
export type PublicUser = Omit<User, 'passwordHash' | 'salt' | 'iterations'>;

export interface Customer extends Base {
  code: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  cnic?: string;
  notes?: string;
  balancePaisa: number;
  archived: boolean;
}

export interface Vehicle extends Base {
  customerId: string;
  regNo: string;
  make: string;
  model: string;
  year?: number;
  vin?: string;
  engineNo?: string;
  color?: string;
  odometer?: number;
  notes?: string;
  archived: boolean;
}

export type StockMoveType =
  | 'purchase' | 'sale' | 'return' | 'adjustment' | 'count' | 'job' | 'supplier-return' | 'void';

export interface Part extends Base {
  sku: string;
  barcode?: string;
  name: string;
  category: string;
  /** Optional free-text group under the category (bulk import maps a source column here). */
  subcategory?: string;
  brand?: string;
  compatibility?: string;
  /** Optional long description. Shown in the part editor; never invented by the importer. */
  description?: string;
  costPaisa: number;
  pricePaisa: number;
  minPricePaisa?: number;
  qty: number;
  reorderLevel: number;
  unit: string;
  supplierId?: string;
  location?: string;
  taxRate: number;
  warrantyMonths?: number;
  archived: boolean;
}

export interface Service extends Base {
  code: string;
  name: string;
  category: string;
  description?: string;
  pricePaisa: number;
  taxRate: number;
  durationMins?: number;
  archived: boolean;
}

export interface Labor extends Base {
  code: string;
  name: string;
  ratePaisa: number;
  category: string;
  description?: string;
  archived: boolean;
}

export interface Supplier extends Base {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  balancePaisa: number;
  notes?: string;
  archived: boolean;
}

export interface LineItem {
  id: string;
  kind: 'part' | 'service' | 'labor';
  refId?: string;
  name: string;
  sku?: string;
  qty: number;
  ratePaisa: number;
  discountPaisa: number;
  taxRate: number;
  taxPaisa: number;
  totalPaisa: number;
  costPaisa: number;
}

export interface PurchaseLine {
  id: string;
  partId?: string;
  name: string;
  sku?: string;
  qty: number;
  costPaisa: number;
  taxRate: number;
  totalPaisa: number;
}

export interface Purchase extends Base {
  number: string;
  supplierId: string;
  date: number;
  status: 'draft' | 'received' | 'cancelled';
  lines: PurchaseLine[];
  subtotalPaisa: number;
  taxPaisa: number;
  discountPaisa: number;
  totalPaisa: number;
  paidPaisa: number;
  receivedAt?: number;
  notes?: string;
  createdBy: string;
  opId?: string;
}

export interface Payment extends Base {
  number: string;
  kind: 'sale' | 'purchase' | 'refund' | 'credit';
  invoiceId?: string | null;
  purchaseId?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  method: 'cash' | 'card' | 'bank' | 'online';
  amountPaisa: number;
  date: number;
  shiftId?: string | null;
  reference?: string;
  notes?: string;
  createdBy: string;
  voided?: boolean;
  opId?: string;
}

export interface Invoice extends Base {
  number: string;
  type: 'pos' | 'job' | 'manual';
  customerId: string | null;
  vehicleId: string | null;
  jobCardId: string | null;
  date: number;
  lines: LineItem[];
  subtotalPaisa: number;
  discountPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
  paidPaisa: number;
  duePaisa: number;
  paymentStatus: 'paid' | 'partial' | 'unpaid';
  status: 'completed' | 'void';
  shiftId: string | null;
  notes?: string;
  createdBy: string;
  opId?: string;
}

export interface ReturnLine {
  id: string;
  lineId?: string;
  partId?: string;
  kind: 'part' | 'service' | 'labor';
  name: string;
  qty: number;
  ratePaisa: number;
  totalPaisa: number;
  restock: boolean;
}

export interface ReturnDoc extends Base {
  number: string;
  invoiceId: string;
  customerId: string | null;
  date: number;
  lines: ReturnLine[];
  subtotalPaisa: number;
  taxPaisa: number;
  totalPaisa: number;
  refundMethod: 'cash' | 'card' | 'bank' | 'credit';
  refundPaisa: number;
  reason: string;
  shiftId: string | null;
  createdBy: string;
  opId?: string;
}

export type JobStatus =
  | 'draft' | 'awaiting_approval' | 'approved' | 'in_progress'
  | 'on_hold' | 'ready' | 'completed' | 'cancelled';

export interface JobLine {
  id: string;
  kind: 'part' | 'service' | 'labor';
  refId?: string;
  name: string;
  qty: number;
  ratePaisa: number;
  taxRate: number;
}

export interface JobHistoryEntry {
  at: number;
  by: string;
  status?: JobStatus;
  action: string;
  note?: string;
}

export interface JobCard extends Base {
  number: string;
  customerId: string;
  vehicleId: string;
  odometer?: number;
  complaint: string;
  findings?: string;
  recommendation?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  mechanicId?: string | null;
  estimatePaisa: number;
  dueDate?: string;
  status: JobStatus;
  lines: JobLine[];
  customerApproved: boolean;
  completedAt?: number;
  invoiceId?: string;
  notes?: string;
  history: JobHistoryEntry[];
  createdBy: string;
  opId?: string;
}

export interface Warranty extends Base {
  number: string;
  customerId: string;
  vehicleId?: string | null;
  invoiceId?: string | null;
  partId?: string | null;
  serviceId?: string | null;
  itemName: string;
  startDate: string;
  endDate: string;
  terms?: string;
  status: 'active' | 'expired' | 'claimed' | 'void';
  claims: { at: number; description: string; resolution: string; by: string }[];
}

export interface Expense extends Base {
  category: string;
  date: number;
  amountPaisa: number;
  method: 'cash' | 'card' | 'bank' | 'online';
  description: string;
  shiftId?: string | null;
  status: 'pending' | 'approved';
  createdBy: string;
  approvedBy?: string;
}

export interface CashMovement extends Base {
  shiftId: string;
  type: 'in' | 'out';
  amountPaisa: number;
  reason: string;
  at: number;
  createdBy: string;
}

export interface StockMove extends Base {
  partId: string;
  type: StockMoveType;
  qty: number;
  unitCostPaisa: number;
  refType?: string;
  refId?: string;
  note?: string;
  date: number;
  createdBy: string;
}

export interface CashShift extends Base {
  number: string;
  userId: string;
  openedAt: number;
  openingPaisa: number;
  closedAt?: number;
  countedPaisa?: number;
  expectedPaisa?: number;
  variancePaisa?: number;
  status: 'open' | 'closed';
  notes?: string;
  closingNotes?: string;
}

export type AuditAction =
  | 'setup' | 'login' | 'login_failed' | 'logout' | 'sale.create' | 'invoice.void' | 'invoice.pay'
  | 'job.create' | 'job.status' | 'job.invoice' | 'purchase.create' | 'purchase.receive'
  | 'purchase.pay' | 'return.create' | 'stock.adjust' | 'shift.open' | 'shift.close'
  | 'expense.create' | 'expense.approve' | 'user.create' | 'user.update' | 'user.delete'
  | 'settings.update' | 'backup.export' | 'backup.import' | 'warranty.claim' | 'demo.load'
  | 'warranty.create' | 'customer.update' | 'vehicle.update' | 'part.import';

export interface AuditEvent extends Base {
  action: AuditAction;
  entity: string;
  entityId: string;
  summary: string;
  userId: string;
  userName?: string;
  meta?: Record<string, unknown>;
}

export type NotificationType =
  | 'low_stock' | 'sale' | 'payment' | 'job_assigned' | 'job_ready'
  | 'warranty_expiry' | 'purchase_received' | 'shift_warning' | 'backup' | 'system';

export interface AppNotification extends Base {
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  read: boolean;
}

export interface Sequence {
  key: string; // 'invoice', 'job', 'purchase', 'return', 'shift', 'warranty', 'payment', 'customer', 'supplier'
  prefix: string;
  next: number;
  padding: number;
}

export interface Attachments {
  logo?: string | null;
  loginArt?: string | null;
  loginArtPosition?: string;
  heroArt?: string | null;
  heroArtPosition?: string;
  setupArt?: string | null;
}

export interface BusinessProfile {
  name: string;
  legalName?: string;
  address?: string;
  phone?: string;
  email?: string;
  taxNumber?: string;
  regNumber?: string;
  currency: string;
  locale: string;
  timezone: string;
  hours?: string;
}

export interface DocumentSettings {
  invoicePrefix: string;
  invoicePadding: number;
  jobPrefix: string;
  purchasePrefix: string;
  returnPrefix: string;
  shiftPrefix: string;
  warrantyPrefix: string;
  receiptWidth: '58' | '80' | 'a4';
  footerNote: string;
  showLogoOnReceipt: boolean;
  defaultTaxRate: number;
  allowDiscounts: boolean;
  maxDiscountPercent: number;
  negativeStock: boolean;
  deductStockOnJobComplete: boolean;
  paymentMethods: ('cash' | 'card' | 'bank' | 'online')[];
}

export interface SecuritySettings {
  minPasswordLength: number;
  sessionHours: number;
  requireUppercase: boolean;
  requireNumber: boolean;
  lockAfterFailures: number;
}

export interface NotificationSettings {
  soundEnabled: boolean;
  volume: number;
  lowStock: boolean;
  sales: boolean;
  jobs: boolean;
  warranty: boolean;
  shift: boolean;
}

export interface LoginCopy {
  heading: string;
  subtitle: string;
  tagline: string;
}

export interface AppSettings {
  profile: BusinessProfile;
  documents: DocumentSettings;
  security: SecuritySettings;
  notifications: NotificationSettings;
  loginCopy: LoginCopy;
  attachments: Attachments;
  roles: Record<string, Permission[]>;
  setupComplete: boolean;
  onboardingDismissed?: boolean;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}
