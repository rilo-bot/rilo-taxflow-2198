import { Router, type Request, type Response } from 'express';
import type { Db } from 'mongodb';
import crypto from 'crypto';
import type { Client } from '../contract';
import { requireAuth } from '../middleware/auth';

export function createClientsRouter(db: Db): Router {
  const router = Router();

  // All routes require authentication
  router.use(requireAuth);

  const clients = db.collection<Omit<Client, 'id'> & { id: string }>('clients');

  // ── GET /api/clients ───────────────────────────────────────────────────────
  // List all clients belonging to the authenticated user
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;

      const docs = await clients.find({ userId }).sort({ createdAt: -1 }).toArray();

      const result: Client[] = docs.map((doc) => ({
        id: doc.id,
        userId: doc.userId,
        name: doc.name,
        contactPerson: doc.contactPerson,
        email: doc.email,
        phone: doc.phone,
        gstin: doc.gstin,
        address: doc.address,
        city: doc.city,
        state: doc.state,
        pincode: doc.pincode,
        notes: doc.notes,
        createdAt: doc.createdAt,
      }));

      res.json(result);
    } catch (err) {
      console.error('list-clients error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to retrieve clients. Please try again.' });
    }
  });

  // ── POST /api/clients ──────────────────────────────────────────────────────
  // Create a new client record
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;

      const body = req.body as Partial<Omit<Client, 'id' | 'userId' | 'createdAt'>>;

      if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
        res.status(400).json({ error: 'Client name is required.' });
        return;
      }

      const now = new Date().toISOString();

      const newClient: Client = {
        id: crypto.randomUUID(),
        userId,
        name: body.name.trim(),
        contactPerson: body.contactPerson,
        email: body.email,
        phone: body.phone,
        gstin: body.gstin,
        address: body.address,
        city: body.city,
        state: body.state,
        pincode: body.pincode,
        notes: body.notes,
        createdAt: now,
      };

      await clients.insertOne(
        newClient as unknown as Parameters<typeof clients.insertOne>[0]
      );

      res.status(201).json(newClient);
    } catch (err) {
      console.error('create-client error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to create client. Please try again.' });
    }
  });

  // ── GET /api/clients/:id ───────────────────────────────────────────────────
  // Fetch a single client by ID
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;
      const { id } = req.params;

      if (!id) {
        res.status(400).json({ error: 'Client ID is required.' });
        return;
      }

      const doc = await clients.findOne({ id, userId });

      if (!doc) {
        res.status(404).json({ error: 'Client not found.' });
        return;
      }

      const result: Client = {
        id: doc.id,
        userId: doc.userId,
        name: doc.name,
        contactPerson: doc.contactPerson,
        email: doc.email,
        phone: doc.phone,
        gstin: doc.gstin,
        address: doc.address,
        city: doc.city,
        state: doc.state,
        pincode: doc.pincode,
        notes: doc.notes,
        createdAt: doc.createdAt,
      };

      res.json(result);
    } catch (err) {
      console.error('get-client error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to retrieve client. Please try again.' });
    }
  });

  // ── PATCH /api/clients/:id ─────────────────────────────────────────────────
  // Update a client's details
  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;
      const { id } = req.params;

      if (!id) {
        res.status(400).json({ error: 'Client ID is required.' });
        return;
      }

      // Only allow updating these fields
      type ClientUpdate = Partial<Omit<Client, 'id' | 'userId' | 'createdAt'>>;
      const allowedFields: (keyof ClientUpdate)[] = [
        'name',
        'contactPerson',
        'email',
        'phone',
        'gstin',
        'address',
        'city',
        'state',
        'pincode',
        'notes',
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

      // Validate name if it's being updated
      if ('name' in updates) {
        const name = updates['name'];
        if (typeof name !== 'string' || name.trim() === '') {
          res.status(400).json({ error: 'Client name cannot be empty.' });
          return;
        }
        updates['name'] = (name as string).trim();
      }

      const result = await clients.updateOne({ id, userId }, { $set: updates });

      if (result.matchedCount === 0) {
        res.status(404).json({ error: 'Client not found.' });
        return;
      }

      const updated = await clients.findOne({ id, userId });
      if (!updated) {
        res.status(404).json({ error: 'Client not found after update.' });
        return;
      }

      const clientResponse: Client = {
        id: updated.id,
        userId: updated.userId,
        name: updated.name,
        contactPerson: updated.contactPerson,
        email: updated.email,
        phone: updated.phone,
        gstin: updated.gstin,
        address: updated.address,
        city: updated.city,
        state: updated.state,
        pincode: updated.pincode,
        notes: updated.notes,
        createdAt: updated.createdAt,
      };

      res.json(clientResponse);
    } catch (err) {
      console.error('update-client error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to update client. Please try again.' });
    }
  });

  // ── DELETE /api/clients/:id ────────────────────────────────────────────────
  // Delete a client record
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;
      const { id } = req.params;

      if (!id) {
        res.status(400).json({ error: 'Client ID is required.' });
        return;
      }

      const result = await clients.deleteOne({ id, userId });

      if (result.deletedCount === 0) {
        res.status(404).json({ error: 'Client not found.' });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('delete-client error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to delete client. Please try again.' });
    }
  });

  return router;
}
