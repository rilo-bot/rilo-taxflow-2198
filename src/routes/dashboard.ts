import { Router, Request, Response } from 'express';
import type { Db } from 'mongodb';
import { requireAuth } from '../middleware/auth';
import type { Invoice, Expense } from '../contract';

export function createDashboardRouter(db: Db): Router {
  const router = Router();

  // GET /api/dashboard/stats
  router.get('/stats', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.auth!.userId;

      const invoicesCol = db.collection<Invoice>('invoices');
      const expensesCol = db.collection<Expense>('expenses');

      // Run all aggregations in parallel for efficiency
      const [invoiceDocs, expenseDocs] = await Promise.all([
        invoicesCol.find({ userId }).toArray(),
        expensesCol.find({ userId }).toArray(),
      ]);

      // Compute invoice stats
      let totalRevenue = 0;
      let paidInvoices = 0;
      let unpaidInvoices = 0;
      let overdueInvoices = 0;

      for (const inv of invoiceDocs) {
        if (inv.status === 'paid') {
          paidInvoices += 1;
          totalRevenue += inv.total ?? 0;
        } else if (inv.status === 'overdue') {
          overdueInvoices += 1;
        } else if (inv.status === 'sent' || inv.status === 'draft') {
          unpaidInvoices += 1;
        }
      }

      // Compute total expenses
      const totalExpenses = expenseDocs.reduce((sum, e) => sum + (e.amount ?? 0), 0);

      // Recent invoices: last 5, sorted by createdAt desc
      const recentInvoices = [...invoiceDocs]
        .sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tb - ta;
        })
        .slice(0, 5);

      // Recent expenses: last 5, sorted by createdAt desc
      const recentExpenses = [...expenseDocs]
        .sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tb - ta;
        })
        .slice(0, 5);

      // Strip internal MongoDB _id field from each document
      const sanitizeInvoice = (inv: any): Invoice => {
        const { _id, ...rest } = inv;
        return rest as Invoice;
      };
      const sanitizeExpense = (exp: any): Expense => {
        const { _id, ...rest } = exp;
        return rest as Expense;
      };

      res.json({
        totalRevenue,
        paidInvoices,
        unpaidInvoices,
        overdueInvoices,
        totalExpenses,
        recentInvoices: recentInvoices.map(sanitizeInvoice),
        recentExpenses: recentExpenses.map(sanitizeExpense),
      });
    } catch (err) {
      console.error('dashboard/stats error:', err);
      res.status(500).json({ error: 'Failed to load dashboard stats. Please try again.' });
    }
  });

  return router;
}
