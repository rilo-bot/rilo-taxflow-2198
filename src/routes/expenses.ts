import { Router, type Request, type Response } from 'express';
import type { Db } from 'mongodb';
import crypto from 'crypto';
import multer from 'multer';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { Expense } from '../contract';
import { requireAuth } from '../middleware/auth';

// ── S3 client ────────────────────────────────────────────────────────────────
function getS3Client(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION!,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
    requestHandler: {
      // Give S3 calls a 10-second socket timeout so they fail fast
      connectionTimeout: 10_000,
      socketTimeout: 10_000,
    },
  });
}

// ── multer — store uploads in memory (max 10 MB) ────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WebP images and PDF files are accepted.'));
    }
  },
});

// ── Map a MongoDB document to the Expense contract type ──────────────────────
type ExpenseDoc = Omit<Expense, 'id'> & { id: string };

function toExpense(doc: ExpenseDoc): Expense {
  return {
    id: doc.id,
    userId: doc.userId,
    title: doc.title,
    category: doc.category,
    amount: doc.amount,
    gstPaid: doc.gstPaid,
    date: doc.date,
    vendor: doc.vendor,
    receiptUrl: doc.receiptUrl,
    receiptKey: doc.receiptKey,
    notes: doc.notes,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

const VALID_CATEGORIES: Expense['category'][] = [
  'travel',
  'office',
  'software',
  'utilities',
  'marketing',
  'salaries',
  'other',
];

export function createExpensesRouter(db: Db): Router {
  const router = Router();
  const expenses = db.collection<ExpenseDoc>('expenses');

  // ── POST /api/expenses/upload-receipt ──────────────────────────────────────
  // Must be registered BEFORE /:id routes to avoid ambiguity
  router.post(
    '/upload-receipt',
    requireAuth,
    upload.single('file'),
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'A file must be attached under the "file" field.' });
          return;
        }

        const bucket = process.env.S3_BUCKET;
        if (!bucket) {
          res.status(500).json({ error: 'Server misconfiguration: S3_BUCKET not set.' });
          return;
        }

        const ext = req.file.originalname.split('.').pop() ?? 'bin';
        const key = `receipts/${req.auth!.userId}/${crypto.randomUUID()}.${ext}`;

        const s3 = getS3Client();
        const command = new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        });

        await s3.send(command);

        const url = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

        res.status(201).json({ url, key });
      } catch (err) {
        console.error('upload-receipt error:', err instanceof Error ? err.message : err);
        res
          .status(500)
          .json({ error: 'Failed to upload receipt. Please try again.' });
      }
    }
  );

  // All remaining routes require auth
  router.use(requireAuth);

  // ── GET /api/expenses ──────────────────────────────────────────────────────
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;
      const docs = await expenses.find({ userId }).sort({ date: -1, createdAt: -1 }).toArray();
      res.json(docs.map(toExpense));
    } catch (err) {
      console.error('list-expenses error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to retrieve expenses. Please try again.' });
    }
  });

  // ── POST /api/expenses ─────────────────────────────────────────────────────
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;
      const body = req.body as Partial<Omit<Expense, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>;

      // Required field validation
      if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
        res.status(400).json({ error: 'title is required.' });
        return;
      }
      if (!body.category || !VALID_CATEGORIES.includes(body.category as Expense['category'])) {
        res
          .status(400)
          .json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}.` });
        return;
      }
      if (body.amount === undefined || body.amount === null || typeof body.amount !== 'number') {
        res.status(400).json({ error: 'amount is required and must be a number.' });
        return;
      }
      if (!body.date || typeof body.date !== 'string') {
        res.status(400).json({ error: 'date is required.' });
        return;
      }

      const now = new Date().toISOString();
      const newExpense: Expense = {
        id: crypto.randomUUID(),
        userId,
        title: body.title.trim(),
        category: body.category as Expense['category'],
        amount: body.amount,
        gstPaid: body.gstPaid,
        date: body.date,
        vendor: body.vendor,
        receiptUrl: body.receiptUrl,
        receiptKey: body.receiptKey,
        notes: body.notes,
        createdAt: now,
        updatedAt: now,
      };

      await expenses.insertOne(newExpense as unknown as ExpenseDoc);
      res.status(201).json(newExpense);
    } catch (err) {
      console.error('create-expense error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to create expense. Please try again.' });
    }
  });

  // ── GET /api/expenses/:id ──────────────────────────────────────────────────
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;
      const { id } = req.params;

      const doc = await expenses.findOne({ id, userId });
      if (!doc) {
        res.status(404).json({ error: 'Expense not found.' });
        return;
      }

      res.json(toExpense(doc));
    } catch (err) {
      console.error('get-expense error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to retrieve expense. Please try again.' });
    }
  });

  // ── PATCH /api/expenses/:id ────────────────────────────────────────────────
  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;
      const { id } = req.params;

      type ExpenseUpdate = Partial<Omit<Expense, 'id' | 'userId' | 'createdAt'>>;
      const allowedFields: (keyof ExpenseUpdate)[] = [
        'title',
        'category',
        'amount',
        'gstPaid',
        'date',
        'vendor',
        'receiptUrl',
        'receiptKey',
        'notes',
        'updatedAt',
      ];

      const body = req.body as Record<string, unknown>;
      const updates: Record<string, unknown> = {};

      for (const field of allowedFields) {
        if (field in body) {
          updates[field] = body[field];
        }
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: 'No valid fields provided for update.' });
        return;
      }

      // Validate category if being updated
      if ('category' in updates) {
        if (!VALID_CATEGORIES.includes(updates['category'] as Expense['category'])) {
          res
            .status(400)
            .json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}.` });
          return;
        }
      }

      // Validate title if being updated
      if ('title' in updates) {
        const t = updates['title'];
        if (typeof t !== 'string' || t.trim() === '') {
          res.status(400).json({ error: 'title cannot be empty.' });
          return;
        }
        updates['title'] = (t as string).trim();
      }

      // Always stamp updatedAt
      updates['updatedAt'] = new Date().toISOString();

      const result = await expenses.updateOne({ id, userId }, { $set: updates });

      if (result.matchedCount === 0) {
        res.status(404).json({ error: 'Expense not found.' });
        return;
      }

      const updated = await expenses.findOne({ id, userId });
      if (!updated) {
        res.status(404).json({ error: 'Expense not found after update.' });
        return;
      }

      res.json(toExpense(updated));
    } catch (err) {
      console.error('update-expense error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to update expense. Please try again.' });
    }
  });

  // ── DELETE /api/expenses/:id ───────────────────────────────────────────────
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const { userId } = req.auth!;
      const { id } = req.params;

      const doc = await expenses.findOne({ id, userId });
      if (!doc) {
        res.status(404).json({ error: 'Expense not found.' });
        return;
      }

      // Delete S3 receipt if one exists
      if (doc.receiptKey) {
        const bucket = process.env.S3_BUCKET;
        if (bucket) {
          try {
            const s3 = getS3Client();
            await s3.send(
              new DeleteObjectCommand({ Bucket: bucket, Key: doc.receiptKey })
            );
          } catch (s3Err) {
            // Log but don't block deletion — the DB record should still be removed
            console.error(
              'delete-receipt S3 error:',
              s3Err instanceof Error ? s3Err.message : s3Err
            );
          }
        }
      }

      await expenses.deleteOne({ id, userId });
      res.json({ ok: true });
    } catch (err) {
      console.error('delete-expense error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to delete expense. Please try again.' });
    }
  });

  return router;
}
