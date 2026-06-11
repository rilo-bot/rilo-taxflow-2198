import { Router, type Request, type Response } from 'express';
import type { Db } from 'mongodb';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import type { User } from '../contract';
import { requireAuth } from '../middleware/auth';

export function createAuthRouter(db: Db): Router {
  const router = Router();

  const users = db.collection<Omit<User, 'id'> & { _id?: unknown; id: string }>('users');
  const otpCodes = db.collection('otp_codes');

  // ── POST /api/auth/request-code ──────────────────────────────────────────
  router.post('/request-code', async (req: Request, res: Response) => {
    const { email } = req.body as { email?: string };

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'A valid email address is required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Generate a 6-digit OTP
    const code = String(crypto.randomInt(100000, 999999));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes

    // Upsert: replace any existing OTP for this email
    await otpCodes.updateOne(
      { email: normalizedEmail },
      {
        $set: {
          email: normalizedEmail,
          code,
          expiresAt: expiresAt.toISOString(),
          createdAt: now.toISOString(),
        },
      },
      { upsert: true }
    );

    // Upsert user record so it exists by the time verify-code runs
    const existingUser = await users.findOne({ email: normalizedEmail });
    if (!existingUser) {
      const newUser: User = {
        id: crypto.randomUUID(),
        email: normalizedEmail,
        createdAt: now.toISOString(),
      };
      await users.insertOne(newUser as unknown as Parameters<typeof users.insertOne>[0]);
    }

    // Send OTP via Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    const emailFrom = process.env.EMAIL_FROM;

    if (!resendApiKey || !emailFrom) {
      console.error('Resend configuration missing: RESEND_API_KEY or EMAIL_FROM not set.');
      res.status(500).json({ error: 'Could not send the code, please try again.' });
      return;
    }

    const resend = new Resend(resendApiKey);

    try {
      const sendPromise = resend.emails.send({
        from: emailFrom,
        to: normalizedEmail,
        subject: 'Your Taxflow login code',
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Your Taxflow Login Code</h2>
            <p style="font-size: 16px; color: #444;">Use the code below to sign in. It expires in 10 minutes.</p>
            <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #2563eb; padding: 24px 0;">
              ${code}
            </div>
            <p style="font-size: 13px; color: #888;">If you didn't request this, you can safely ignore this email.</p>
          </div>
        `,
      });

      // 8-second timeout to avoid hanging on slow provider
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Email send timed out')), 8000)
      );

      await Promise.race([sendPromise, timeout]);
    } catch (err) {
      console.error('Failed to send OTP email:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Could not send the code, please try again.' });
      return;
    }

    res.json({ ok: true });
  });

  // ── POST /api/auth/verify-code ────────────────────────────────────────────
  router.post('/verify-code', async (req: Request, res: Response) => {
    const { email, code } = req.body as { email?: string; code?: string };

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'A valid email address is required.' });
      return;
    }
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'A verification code is required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedCode = code.trim();

    const record = await otpCodes.findOne({ email: normalizedEmail });

    if (!record) {
      res.status(400).json({ error: 'No code found for this email. Please request a new one.' });
      return;
    }

    const now = new Date();
    const expiresAt = new Date(record['expiresAt'] as string);

    if (now > expiresAt) {
      await otpCodes.deleteOne({ email: normalizedEmail });
      res.status(400).json({ error: 'Your code has expired. Please request a new one.' });
      return;
    }

    if (record['code'] !== trimmedCode) {
      res.status(400).json({ error: 'Incorrect code. Please check and try again.' });
      return;
    }

    // Code is valid — consume it
    await otpCodes.deleteOne({ email: normalizedEmail });

    // Get or create the user
    let user = await users.findOne({ email: normalizedEmail });
    if (!user) {
      const newUser: User = {
        id: crypto.randomUUID(),
        email: normalizedEmail,
        createdAt: now.toISOString(),
      };
      await users.insertOne(newUser as unknown as Parameters<typeof users.insertOne>[0]);
      user = await users.findOne({ email: normalizedEmail });
    }

    if (!user) {
      res.status(500).json({ error: 'Failed to retrieve user after verification.' });
      return;
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      res.status(500).json({ error: 'Server misconfiguration: JWT_SECRET not set.' });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      secret,
      { expiresIn: '90d' }
    );

    const userResponse: User = {
      id: user.id,
      email: user.email,
      businessName: user.businessName,
      gstin: user.gstin,
      address: user.address,
      city: user.city,
      state: user.state,
      pincode: user.pincode,
      phone: user.phone,
      bankName: user.bankName,
      accountNumber: user.accountNumber,
      ifscCode: user.ifscCode,
      logoUrl: user.logoUrl,
      createdAt: user.createdAt,
    };

    res.json({ token, user: userResponse });
  });

  // ── GET /api/auth/me ──────────────────────────────────────────────────────
  router.get('/me', requireAuth, async (req: Request, res: Response) => {
    const { userId } = req.auth!;

    const user = await users.findOne({ id: userId });
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const userResponse: User = {
      id: user.id,
      email: user.email,
      businessName: user.businessName,
      gstin: user.gstin,
      address: user.address,
      city: user.city,
      state: user.state,
      pincode: user.pincode,
      phone: user.phone,
      bankName: user.bankName,
      accountNumber: user.accountNumber,
      ifscCode: user.ifscCode,
      logoUrl: user.logoUrl,
      createdAt: user.createdAt,
    };

    res.json(userResponse);
  });

  // ── PATCH /api/auth/me ────────────────────────────────────────────────────
  router.patch('/me', requireAuth, async (req: Request, res: Response) => {
    const { userId } = req.auth!;

    // Disallow updating protected fields — only pick allowed keys
    type ProfileUpdate = Partial<Omit<User, 'id' | 'email' | 'createdAt'>>;
    const allowedFields: (keyof ProfileUpdate)[] = [
      'businessName',
      'gstin',
      'address',
      'city',
      'state',
      'pincode',
      'phone',
      'bankName',
      'accountNumber',
      'ifscCode',
      'logoUrl',
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

    const updatedAt = new Date().toISOString();
    updates['updatedAt'] = updatedAt;

    await users.updateOne({ id: userId }, { $set: updates });

    const user = await users.findOne({ id: userId });
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const userResponse: User = {
      id: user.id,
      email: user.email,
      businessName: user.businessName,
      gstin: user.gstin,
      address: user.address,
      city: user.city,
      state: user.state,
      pincode: user.pincode,
      phone: user.phone,
      bankName: user.bankName,
      accountNumber: user.accountNumber,
      ifscCode: user.ifscCode,
      logoUrl: user.logoUrl,
      createdAt: user.createdAt,
    };

    res.json(userResponse);
  });

  return router;
}
