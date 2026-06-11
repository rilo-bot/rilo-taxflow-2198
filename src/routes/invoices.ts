import { Router, type Request, type Response } from 'express';
import type { Db } from 'mongodb';
import crypto from 'crypto';
import type { Invoice, InvoiceLineItem } from '../contract';
import { requireAuth } from '../middleware/auth';

export function createInvoicesRouter(db: Db): Router {
  const router = Router();

  // All routes require authentication
  router.use(requireAuth);

  const invoices = db.collection<Omit<Invoice, 'id'> & { id: string }>('invoices');

  // Helper: map a raw Mongo doc to a clean Invoice response object
  function toInvoice(doc: Record<string, unknown>): Invoice {
    return {
      id: doc.id as string,
      userId: doc.userId as string,
      clientId: doc.clientId as string,
      invoiceNumber: doc.invoiceNumber as string,
      invoiceDate: doc.invoiceDate as string,
      dueDate: doc.dueDate as string | undefined,
      status: doc.status as Invoice['status'],
      lineItems: (doc.lineItems as InvoiceLineItem[]) ?? [],
      subtotal: doc.subtotal as number,
      cgst: doc.cgst as number,
      sgst: doc.sgst as number,
      igst: doc.igst as number,
      total: doc.total as number,
      notes: doc.notes as string | undefined,
      isInterState: doc.isInterState as boolean,
      createdAt: doc.createdAt as string,
      updatedAt: doc.updatedAt as string,
    };
  }

  // ── GET /api/invoices ──────────────────────────────────────────────────────
  // List all invoices for the authenticated user, with optional status/date filters
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;

      // Build filter query
      const filter: Record<string, unknown> = { userId };

      // Optional status filter: ?status=draft|sent|paid|overdue
      const { status, from, to } = req.query;

      if (status) {
        const validStatuses = ['draft', 'sent', 'paid', 'overdue'];
        if (!validStatuses.includes(status as string)) {
          res.status(400).json({ error: `Invalid status filter. Must be one of: ${validStatuses.join(', ')}.` });
          return;
        }
        filter.status = status;
      }

      // Optional date range filters on invoiceDate: ?from=ISO&to=ISO
      if (from || to) {
        const dateFilter: Record<string, string> = {};
        if (from) dateFilter.$gte = from as string;
        if (to) dateFilter.$lte = to as string;
        filter.invoiceDate = dateFilter;
      }

      const docs = await invoices.find(filter).sort({ createdAt: -1 }).toArray();

      const result: Invoice[] = docs.map((doc) => toInvoice(doc as unknown as Record<string, unknown>));

      res.json(result);
    } catch (err) {
      console.error('list-invoices error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to retrieve invoices. Please try again.' });
    }
  });

  // ── POST /api/invoices ─────────────────────────────────────────────────────
  // Create a new GST invoice
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;

      type CreateBody = Omit<Invoice, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;
      const body = req.body as Partial<CreateBody>;

      // Required field validation
      if (!body.clientId || typeof body.clientId !== 'string') {
        res.status(400).json({ error: 'clientId is required.' });
        return;
      }
      if (!body.invoiceNumber || typeof body.invoiceNumber !== 'string') {
        res.status(400).json({ error: 'invoiceNumber is required.' });
        return;
      }
      if (!body.invoiceDate || typeof body.invoiceDate !== 'string') {
        res.status(400).json({ error: 'invoiceDate is required.' });
        return;
      }
      if (!body.status || !['draft', 'sent', 'paid', 'overdue'].includes(body.status)) {
        res.status(400).json({ error: 'status is required and must be one of: draft, sent, paid, overdue.' });
        return;
      }
      if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) {
        res.status(400).json({ error: 'lineItems must be a non-empty array.' });
        return;
      }
      if (typeof body.subtotal !== 'number') {
        res.status(400).json({ error: 'subtotal is required and must be a number.' });
        return;
      }
      if (typeof body.cgst !== 'number') {
        res.status(400).json({ error: 'cgst is required and must be a number.' });
        return;
      }
      if (typeof body.sgst !== 'number') {
        res.status(400).json({ error: 'sgst is required and must be a number.' });
        return;
      }
      if (typeof body.igst !== 'number') {
        res.status(400).json({ error: 'igst is required and must be a number.' });
        return;
      }
      if (typeof body.total !== 'number') {
        res.status(400).json({ error: 'total is required and must be a number.' });
        return;
      }
      if (typeof body.isInterState !== 'boolean') {
        res.status(400).json({ error: 'isInterState is required and must be a boolean.' });
        return;
      }

      const now = new Date().toISOString();

      // Ensure each line item has an id
      const lineItems: InvoiceLineItem[] = (body.lineItems as InvoiceLineItem[]).map((item) => ({
        ...item,
        id: item.id || crypto.randomUUID(),
      }));

      const newInvoice: Invoice = {
        id: crypto.randomUUID(),
        userId,
        clientId: body.clientId,
        invoiceNumber: body.invoiceNumber.trim(),
        invoiceDate: body.invoiceDate,
        dueDate: body.dueDate,
        status: body.status,
        lineItems,
        subtotal: body.subtotal,
        cgst: body.cgst,
        sgst: body.sgst,
        igst: body.igst,
        total: body.total,
        notes: body.notes,
        isInterState: body.isInterState,
        createdAt: now,
        updatedAt: now,
      };

      await invoices.insertOne(newInvoice as unknown as Parameters<typeof invoices.insertOne>[0]);

      res.status(201).json(newInvoice);
    } catch (err) {
      console.error('create-invoice error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to create invoice. Please try again.' });
    }
  });

  // ── GET /api/invoices/:id ──────────────────────────────────────────────────
  // Fetch a single invoice by ID
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;
      const { id } = req.params;

      if (!id) {
        res.status(400).json({ error: 'Invoice ID is required.' });
        return;
      }

      const doc = await invoices.findOne({ id, userId });

      if (!doc) {
        res.status(404).json({ error: 'Invoice not found.' });
        return;
      }

      res.json(toInvoice(doc as unknown as Record<string, unknown>));
    } catch (err) {
      console.error('get-invoice error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to retrieve invoice. Please try again.' });
    }
  });

  // ── PATCH /api/invoices/:id ────────────────────────────────────────────────
  // Update an invoice's details or status
  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;
      const { id } = req.params;

      if (!id) {
        res.status(400).json({ error: 'Invoice ID is required.' });
        return;
      }

      type InvoiceUpdate = Partial<Omit<Invoice, 'id' | 'userId' | 'createdAt'>>;
      const allowedFields: (keyof InvoiceUpdate)[] = [
        'clientId',
        'invoiceNumber',
        'invoiceDate',
        'dueDate',
        'status',
        'lineItems',
        'subtotal',
        'cgst',
        'sgst',
        'igst',
        'total',
        'notes',
        'isInterState',
        'updatedAt',
      ];

      const body = req.body as Record<string, unknown>;
      const updates: Partial<Record<string, unknown>> = {};

      for (const field of allowedFields) {
        if (field in body) {
          updates[field] = body[field];
        }
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: 'No valid fields provided for update.' });
        return;
      }

      // Validate status if provided
      if ('status' in updates) {
        const validStatuses = ['draft', 'sent', 'paid', 'overdue'];
        if (!validStatuses.includes(updates.status as string)) {
          res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}.` });
          return;
        }
      }

      // Ensure line items have ids if being updated
      if ('lineItems' in updates && Array.isArray(updates.lineItems)) {
        updates.lineItems = (updates.lineItems as InvoiceLineItem[]).map((item) => ({
          ...item,
          id: item.id || crypto.randomUUID(),
        }));
      }

      // Always bump updatedAt
      updates.updatedAt = new Date().toISOString();

      const result = await invoices.updateOne({ id, userId }, { $set: updates });

      if (result.matchedCount === 0) {
        res.status(404).json({ error: 'Invoice not found.' });
        return;
      }

      const updated = await invoices.findOne({ id, userId });
      if (!updated) {
        res.status(404).json({ error: 'Invoice not found after update.' });
        return;
      }

      res.json(toInvoice(updated as unknown as Record<string, unknown>));
    } catch (err) {
      console.error('update-invoice error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to update invoice. Please try again.' });
    }
  });

  // ── DELETE /api/invoices/:id ───────────────────────────────────────────────
  // Delete an invoice
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;
      const { id } = req.params;

      if (!id) {
        res.status(400).json({ error: 'Invoice ID is required.' });
        return;
      }

      const result = await invoices.deleteOne({ id, userId });

      if (result.deletedCount === 0) {
        res.status(404).json({ error: 'Invoice not found.' });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('delete-invoice error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to delete invoice. Please try again.' });
    }
  });

  return router;
}
