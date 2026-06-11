/**
 * AUTO-GENERATED — DO NOT EDIT.
 * This is the shared API contract for this app, regenerated from the plan on
 * every build. Both the frontend (@/contract) and the backend (./contract)
 * import these types so the request/response shapes can never drift.
 */


export interface User {
  /** Unique user ID */
  id: string;
  /** User's email address */
  email: string;
  /** Business name */
  businessName?: string;
  /** GST Identification Number */
  gstin?: string;
  /** Business address */
  address?: string;
  /** City */
  city?: string;
  /** State */
  state?: string;
  /** PIN code */
  pincode?: string;
  /** Contact phone number */
  phone?: string;
  /** Bank name for invoice footer */
  bankName?: string;
  /** Bank account number */
  accountNumber?: string;
  /** Bank IFSC code */
  ifscCode?: string;
  /** Business logo URL from S3 */
  logoUrl?: string;
  /** ISO timestamp */
  createdAt: string;
}

export interface OtpCode {
  /** Unique OTP record ID */
  id: string;
  /** Email the code was sent to */
  email: string;
  /** 6-digit OTP code */
  code: string;
  /** Expiry ISO timestamp (10 min TTL) */
  expiresAt: string;
  /** ISO timestamp */
  createdAt: string;
}

export interface Client {
  /** Unique client ID */
  id: string;
  /** Owner user ID */
  userId: string;
  /** Client/company name */
  name: string;
  /** Primary contact name */
  contactPerson?: string;
  /** Client email */
  email?: string;
  /** Client phone */
  phone?: string;
  /** Client GSTIN */
  gstin?: string;
  /** Billing address */
  address?: string;
  /** City */
  city?: string;
  /** State */
  state?: string;
  /** PIN code */
  pincode?: string;
  /** Internal notes about the client */
  notes?: string;
  /** ISO timestamp */
  createdAt: string;
}

export interface Invoice {
  /** Unique invoice ID */
  id: string;
  /** Owner user ID */
  userId: string;
  /** Associated client ID */
  clientId: string;
  /** Invoice number e.g. INV-2024-001 */
  invoiceNumber: string;
  /** Date of invoice ISO string */
  invoiceDate: string;
  /** Payment due date ISO string */
  dueDate?: string;
  /** Invoice status */
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  /** Array of line items */
  lineItems: InvoiceLineItem[];
  /** Sum before tax in INR */
  subtotal: number;
  /** Central GST amount in INR */
  cgst: number;
  /** State GST amount in INR */
  sgst: number;
  /** Integrated GST amount in INR (for inter-state) */
  igst: number;
  /** Total amount including tax in INR */
  total: number;
  /** Payment terms or notes on invoice */
  notes?: string;
  /** True if IGST applies, false for CGST+SGST */
  isInterState: boolean;
  /** ISO timestamp */
  createdAt: string;
  /** ISO timestamp */
  updatedAt: string;
}

export interface InvoiceLineItem {
  /** Line item ID */
  id: string;
  /** Product or service description */
  description: string;
  /** HSN/SAC code */
  hsnSac?: string;
  /** Quantity */
  quantity: number;
  /** Unit e.g. hrs, pcs, kg */
  unit?: string;
  /** Rate per unit in INR */
  rate: number;
  /** GST rate as percentage e.g. 18 */
  gstRate: number;
  /** Line total before tax */
  amount: number;
}

export interface Expense {
  /** Unique expense ID */
  id: string;
  /** Owner user ID */
  userId: string;
  /** Short description of the expense */
  title: string;
  /** Expense category */
  category: 'travel' | 'office' | 'software' | 'utilities' | 'marketing' | 'salaries' | 'other';
  /** Expense amount in INR */
  amount: number;
  /** GST amount paid on this expense (input tax credit) */
  gstPaid?: number;
  /** Date of expense ISO string */
  date: string;
  /** Vendor or supplier name */
  vendor?: string;
  /** S3 URL of uploaded receipt */
  receiptUrl?: string;
  /** S3 key for receipt file */
  receiptKey?: string;
  /** Additional notes */
  notes?: string;
  /** ISO timestamp */
  createdAt: string;
  /** ISO timestamp */
  updatedAt: string;
}

export interface ApiContract {
  "auth-request-code": { method: "POST"; path: "/api/auth/request-code"; request: { email: string }; response: { ok: boolean } };
  "auth-verify-code": { method: "POST"; path: "/api/auth/verify-code"; request: { email: string; code: string }; response: { token: string; user: User } };
  "auth-me": { method: "GET"; path: "/api/auth/me"; request: void; response: User };
  "update-profile": { method: "PATCH"; path: "/api/auth/me"; request: Partial<Omit<User, 'id' | 'email' | 'createdAt'>>; response: User };
  "list-clients": { method: "GET"; path: "/api/clients"; request: void; response: Client[] };
  "create-client": { method: "POST"; path: "/api/clients"; request: Omit<Client, 'id' | 'userId' | 'createdAt'>; response: Client };
  "get-client": { method: "GET"; path: "/api/clients/:id"; request: void; response: Client };
  "update-client": { method: "PATCH"; path: "/api/clients/:id"; request: Partial<Omit<Client, 'id' | 'userId' | 'createdAt'>>; response: Client };
  "delete-client": { method: "DELETE"; path: "/api/clients/:id"; request: void; response: { ok: boolean } };
  "list-invoices": { method: "GET"; path: "/api/invoices"; request: void; response: Invoice[] };
  "create-invoice": { method: "POST"; path: "/api/invoices"; request: Omit<Invoice, 'id' | 'userId' | 'createdAt' | 'updatedAt'>; response: Invoice };
  "get-invoice": { method: "GET"; path: "/api/invoices/:id"; request: void; response: Invoice };
  "update-invoice": { method: "PATCH"; path: "/api/invoices/:id"; request: Partial<Omit<Invoice, 'id' | 'userId' | 'createdAt'>>; response: Invoice };
  "delete-invoice": { method: "DELETE"; path: "/api/invoices/:id"; request: void; response: { ok: boolean } };
  "list-expenses": { method: "GET"; path: "/api/expenses"; request: void; response: Expense[] };
  "create-expense": { method: "POST"; path: "/api/expenses"; request: Omit<Expense, 'id' | 'userId' | 'createdAt' | 'updatedAt'>; response: Expense };
  "get-expense": { method: "GET"; path: "/api/expenses/:id"; request: void; response: Expense };
  "update-expense": { method: "PATCH"; path: "/api/expenses/:id"; request: Partial<Omit<Expense, 'id' | 'userId' | 'createdAt'>>; response: Expense };
  "delete-expense": { method: "DELETE"; path: "/api/expenses/:id"; request: void; response: { ok: boolean } };
  "upload-receipt": { method: "POST"; path: "/api/expenses/upload-receipt"; request: FormData; response: { url: string; key: string } };
  "get-tax-report": { method: "GET"; path: "/api/reports/tax"; request: void; response: { period: string; totalRevenue: number; totalCgst: number; totalSgst: number; totalIgst: number; totalGstCollected: number; totalExpenses: number; totalInputCredit: number; netGstPayable: number; invoiceCount: number; expenseCount: number } };
  "get-dashboard-stats": { method: "GET"; path: "/api/dashboard/stats"; request: void; response: { totalRevenue: number; paidInvoices: number; unpaidInvoices: number; overdueInvoices: number; totalExpenses: number; recentInvoices: Invoice[]; recentExpenses: Expense[] } };
}

export const API_ROUTES = {
  "auth-request-code": { method: "POST", path: "/api/auth/request-code" },
  "auth-verify-code": { method: "POST", path: "/api/auth/verify-code" },
  "auth-me": { method: "GET", path: "/api/auth/me" },
  "update-profile": { method: "PATCH", path: "/api/auth/me" },
  "list-clients": { method: "GET", path: "/api/clients" },
  "create-client": { method: "POST", path: "/api/clients" },
  "get-client": { method: "GET", path: "/api/clients/:id" },
  "update-client": { method: "PATCH", path: "/api/clients/:id" },
  "delete-client": { method: "DELETE", path: "/api/clients/:id" },
  "list-invoices": { method: "GET", path: "/api/invoices" },
  "create-invoice": { method: "POST", path: "/api/invoices" },
  "get-invoice": { method: "GET", path: "/api/invoices/:id" },
  "update-invoice": { method: "PATCH", path: "/api/invoices/:id" },
  "delete-invoice": { method: "DELETE", path: "/api/invoices/:id" },
  "list-expenses": { method: "GET", path: "/api/expenses" },
  "create-expense": { method: "POST", path: "/api/expenses" },
  "get-expense": { method: "GET", path: "/api/expenses/:id" },
  "update-expense": { method: "PATCH", path: "/api/expenses/:id" },
  "delete-expense": { method: "DELETE", path: "/api/expenses/:id" },
  "upload-receipt": { method: "POST", path: "/api/expenses/upload-receipt" },
  "get-tax-report": { method: "GET", path: "/api/reports/tax" },
  "get-dashboard-stats": { method: "GET", path: "/api/dashboard/stats" },
} as const;
