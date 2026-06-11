import { Router, type Request, type Response } from 'express';
import type { Db } from 'mongodb';
import { requireAuth } from '../middleware/auth';
import type { ApiContract } from '../contract';

type TaxReportResponse = ApiContract['get-tax-report']['response'];

/**
 * Parse a "period" query string into { from, to } ISO date strings.
 *
 * Supported formats:
 *   - "YYYY-QN"  e.g. "2024-Q1"  → Jan–Mar 2024
 *   - "YYYY"     e.g. "2024"     → full calendar year
 *
 * Returns null when the format is unrecognised.
 */
function parsePeriod(period: string): { from: string; to: string; label: string } | null {
  // Quarter format: 2024-Q1
  const quarterMatch = period.match(/^(\d{4})-Q([1-4])$/i);
  if (quarterMatch) {
    const year = parseInt(quarterMatch[1], 10);
    const quarter = parseInt(quarterMatch[2], 10);
    const startMonth = (quarter - 1) * 3; // 0-indexed
    const fromDate = new Date(Date.UTC(year, startMonth, 1));
    const toDate = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999)); // last ms of last day
    return {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      label: `${year}-Q${quarter}`,
    };
  }

  // Full year format: 2024
  const yearMatch = period.match(/^(\d{4})$/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    const fromDate = new Date(Date.UTC(year, 0, 1));
    const toDate = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
    return {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      label: `${year}`,
    };
  }

  return null;
}

export function createReportsRouter(db: Db): Router {
  const router = Router();

  // GET /api/reports/tax
  // Query params: from (ISO), to (ISO), period (e.g. "2024-Q1" or "2024")
  router.get('/tax', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.auth!.userId;

      let fromISO: string;
      let toISO: string;
      let periodLabel: string;

      const { from, to, period } = req.query as Record<string, string | undefined>;

      if (period) {
        const parsed = parsePeriod(period);
        if (!parsed) {
          res.status(400).json({ error: 'Invalid period format. Use YYYY-QN (e.g. 2024-Q1) or YYYY (e.g. 2024).' });
          return;
        }
        fromISO = parsed.from;
        toISO = parsed.to;
        periodLabel = parsed.label;
      } else if (from && to) {
        // Validate ISO dates
        const fromTs = Date.parse(from);
        const toTs = Date.parse(to);
        if (isNaN(fromTs) || isNaN(toTs)) {
          res.status(400).json({ error: 'Invalid date format. Use ISO date strings for `from` and `to`.' });
          return;
        }
        if (fromTs > toTs) {
          res.status(400).json({ error: '`from` date must be before `to` date.' });
          return;
        }
        fromISO = new Date(fromTs).toISOString();
        toISO = new Date(toTs).toISOString();
        periodLabel = `${fromISO.slice(0, 10)} to ${toISO.slice(0, 10)}`;
      } else {
        res.status(400).json({
          error: 'Provide either `period` (e.g. 2024-Q1) or both `from` and `to` query parameters.',
        });
        return;
      }

      // ── Aggregate invoices ──────────────────────────────────────────────────
      // Only count non-draft invoices (sent, paid, overdue) so draft invoices
      // don't inflate the GST collected figure.
      const invoiceCursor = db.collection('invoices').find({
        userId,
        invoiceDate: { $gte: fromISO, $lte: toISO },
        status: { $in: ['sent', 'paid', 'overdue'] },
      });

      let totalRevenue = 0;
      let totalCgst = 0;
      let totalSgst = 0;
      let totalIgst = 0;
      let invoiceCount = 0;

      for await (const inv of invoiceCursor) {
        totalRevenue += typeof inv.subtotal === 'number' ? inv.subtotal : 0;
        totalCgst += typeof inv.cgst === 'number' ? inv.cgst : 0;
        totalSgst += typeof inv.sgst === 'number' ? inv.sgst : 0;
        totalIgst += typeof inv.igst === 'number' ? inv.igst : 0;
        invoiceCount += 1;
      }

      const totalGstCollected = round2(totalCgst + totalSgst + totalIgst);

      // ── Aggregate expenses ──────────────────────────────────────────────────
      const expenseCursor = db.collection('expenses').find({
        userId,
        date: { $gte: fromISO, $lte: toISO },
      });

      let totalExpenses = 0;
      let totalInputCredit = 0;
      let expenseCount = 0;

      for await (const exp of expenseCursor) {
        totalExpenses += typeof exp.amount === 'number' ? exp.amount : 0;
        totalInputCredit += typeof exp.gstPaid === 'number' ? exp.gstPaid : 0;
        expenseCount += 1;
      }

      const netGstPayable = round2(totalGstCollected - totalInputCredit);

      const report: TaxReportResponse = {
        period: periodLabel,
        totalRevenue: round2(totalRevenue),
        totalCgst: round2(totalCgst),
        totalSgst: round2(totalSgst),
        totalIgst: round2(totalIgst),
        totalGstCollected,
        totalExpenses: round2(totalExpenses),
        totalInputCredit: round2(totalInputCredit),
        netGstPayable,
        invoiceCount,
        expenseCount,
      };

      res.json(report);
    } catch (err) {
      console.error('GET /api/reports/tax error:', err);
      res.status(500).json({ error: 'Failed to generate tax report. Please try again.' });
    }
  });

  return router;
}

/** Round to 2 decimal places to avoid floating-point noise in monetary values. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
