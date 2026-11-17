import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import express, { type Express, type Request, type Response } from 'express';
import multer from 'multer';
import type Database from 'better-sqlite3';
import {
  buildCanonicalManifest,
  computeSha256Hex,
  decryptEvidenceBuffer,
  encryptEvidenceBuffer,
  signManifest,
  verifyCustodyChain,
  verifyManifestSignature,
  type KeyPairBundle,
} from './crypto';
import { appendCustodyEvent, getVaultDir, recordAuditLog } from './db';
import { buildForensicReportPdf } from './report';
import {
  canAccessCase,
  clearSessionCookie,
  createSessionAuthMiddleware,
  extractSessionToken,
  getClientIp,
  LOCKOUT_MINUTES,
  loginRateLimiter,
  MAX_EVIDENCE_BYTES,
  MAX_FAILED_LOGINS,
  requireRole,
  resolveVaultFilePath,
  sanitizeFilename,
  SESSION_TTL_MS,
  setSessionCookie,
  validateEvidenceFile,
  type AuthenticatedRequest,
} from './security';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_EVIDENCE_BYTES,
    files: 1,
  },
});

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatEvidenceCode(): string {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `EVD-${year}-${suffix}`;
}

function formatCaseCode(): string {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `CASE-${year}-${suffix}`;
}

export function registerApiRoutes(
  app: Express,
  db: Database.Database,
  keys: { wrappingKeys: KeyPairBundle; signingKeys: KeyPairBundle }
): void {
  const auth = createSessionAuthMiddleware(db);
  const adminOnly = requireRole(db, ['ADMIN']);

  // Health & Setup Status
  app.get('/api/health', (req: Request, res: Response) => {
    const adminCountRow = db
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN'")
      .get() as { count: number };

    let authenticated = false;
    const rawToken = extractSessionToken(req);
    if (rawToken) {
      const tokenHash = computeSha256Hex(rawToken);
      const sess = db
        .prepare(
          `SELECT s.expires_at, s.revoked_at, u.status
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ?`
        )
        .get(tokenHash) as
        | { expires_at: string; revoked_at: string | null; status: string }
        | undefined;
      if (
        sess &&
        !sess.revoked_at &&
        sess.status === 'ACTIVE' &&
        new Date(sess.expires_at).getTime() > Date.now()
      ) {
        authenticated = true;
      }
    }

    res.json({
      status: 'ok',
      setupRequired: adminCountRow.count === 0,
      authenticated,
      timestamp: new Date().toISOString(),
    });
  });

  // Initial Administrator Setup (only when zero admins exist)
  app.post('/api/auth/setup', async (req: Request, res: Response) => {
    try {
      const existingAdmin = db
        .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN'")
        .get() as { count: number };
      if (existingAdmin.count > 0) {
        recordAuditLog(db, {
          actorEmail: String(req.body?.email || 'unknown'),
          actorRole: 'ANONYMOUS',
          action: 'DUPLICATE_ADMIN_SETUP_BLOCKED',
          resourceType: 'AUTH',
          status: 'WARNING',
          ipAddress: getClientIp(req),
          details: 'Blocked attempt to execute initial administrator setup after setup lock.',
        });
        res.status(403).json({
          error: 'Initial administrator setup is already locked. Duplicate administrator creation is not permitted.',
        });
        return;
      }

      const name = String(req.body?.name || '').trim();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const badgeNumber = String(req.body?.badgeNumber || '').trim();
      const department = String(req.body?.department || 'Digital Forensics').trim();
      const password = String(req.body?.password || '');
      const confirmPassword = String(req.body?.confirmPassword || '');

      if (!name || name.length < 2) {
        res.status(400).json({ error: 'Administrator name must be at least 2 characters.' });
        return;
      }
      if (!isValidEmail(email)) {
        res.status(400).json({ error: 'Provide a valid institutional email address.' });
        return;
      }
      if (!badgeNumber || badgeNumber.length < 2) {
        res.status(400).json({ error: 'Badge number is required.' });
        return;
      }
      if (password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        return;
      }
      if (password !== confirmPassword) {
        res.status(400).json({ error: 'Password and confirmation do not match.' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const userId = crypto.randomUUID();
      const now = new Date().toISOString();

      const createAdminTx = db.transaction(() => {
        const recheck = db
          .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN'")
          .get() as { count: number };
        if (recheck.count > 0) {
          throw new Error('ADMIN_EXISTS');
        }
        db.prepare(
          `INSERT INTO users (
            id, name, email, badge_number, department, role, password_hash, status, failed_attempts, locked_until, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'ADMIN', ?, 'ACTIVE', 0, NULL, ?, ?)`
        ).run(userId, name, email, badgeNumber, department, passwordHash, now, now);

        recordAuditLog(db, {
          userId,
          actorEmail: email,
          actorRole: 'ADMIN',
          action: 'INITIAL_ADMIN_CREATED',
          resourceType: 'USER',
          resourceId: userId,
          status: 'SUCCESS',
          ipAddress: getClientIp(req),
          details: `Initial administrator ${name} (${badgeNumber}) registered and initial setup locked.`,
        });
      });

      createAdminTx();
      res.status(201).json({
        message: 'Initial administrator registered successfully. Initial setup is now locked.',
        user: { id: userId, name, email, badgeNumber, department, role: 'ADMIN' },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'ADMIN_EXISTS') {
        res.status(403).json({ error: 'Administrator already exists.' });
        return;
      }
      if (msg.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'Email or badge number is already registered.' });
        return;
      }
      res.status(500).json({ error: 'Failed to register initial administrator.' });
    }
  });

  // Login
  app.post('/api/auth/login', loginRateLimiter, async (req: Request, res: Response) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const ipAddress = getClientIp(req);
      const userAgent = String(req.headers['user-agent'] || 'unknown').slice(0, 240);
      const now = new Date();
      const nowIso = now.toISOString();

      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }

      const user = db
        .prepare('SELECT * FROM users WHERE email = ?')
        .get(email) as
        | {
            id: string;
            name: string;
            email: string;
            badge_number: string;
            department: string;
            role: 'ADMIN' | 'INVESTIGATOR';
            password_hash: string;
            status: 'ACTIVE' | 'LOCKED' | 'DISABLED';
            failed_attempts: number;
            locked_until: string | null;
          }
        | undefined;

      if (!user) {
        db.prepare(
          'INSERT INTO login_attempts (email, user_id, success, ip_address, user_agent, reason, attempted_at) VALUES (?, NULL, 0, ?, ?, ?, ?)'
        ).run(email, ipAddress, userAgent, 'UNKNOWN_ACCOUNT', nowIso);

        recordAuditLog(db, {
          actorEmail: email,
          actorRole: 'ANONYMOUS',
          action: 'LOGIN_FAILED',
          resourceType: 'AUTH',
          status: 'FAILURE',
          ipAddress,
          details: `Failed login attempt for unregistered email ${email}.`,
        });

        res.status(401).json({ error: 'Invalid institutional email or password.' });
        return;
      }

      if (user.status === 'DISABLED') {
        db.prepare(
          'INSERT INTO login_attempts (email, user_id, success, ip_address, user_agent, reason, attempted_at) VALUES (?, ?, 0, ?, ?, ?, ?)'
        ).run(email, user.id, ipAddress, userAgent, 'ACCOUNT_DISABLED', nowIso);

        recordAuditLog(db, {
          userId: user.id,
          actorEmail: user.email,
          actorRole: user.role,
          action: 'LOGIN_BLOCKED_DISABLED',
          resourceType: 'AUTH',
          status: 'WARNING',
          ipAddress,
          details: `Login blocked for disabled account ${user.email}.`,
        });

        res.status(403).json({ error: 'This account has been disabled by an administrator.' });
        return;
      }

      // Check lockout expiration
      if (user.status === 'LOCKED') {
        if (user.locked_until && new Date(user.locked_until).getTime() > now.getTime()) {
          db.prepare(
            'INSERT INTO login_attempts (email, user_id, success, ip_address, user_agent, reason, attempted_at) VALUES (?, ?, 0, ?, ?, ?, ?)'
          ).run(email, user.id, ipAddress, userAgent, 'ACCOUNT_LOCKED', nowIso);

          res.status(423).json({
            error: `Account temporarily locked due to repeated failed attempts. Try again after ${new Date(user.locked_until).toLocaleTimeString()} or contact an administrator.`,
          });
          return;
        } else if (user.locked_until) {
          // Auto-unlock expired temporary lock
          db.prepare(
            "UPDATE users SET status = 'ACTIVE', failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?"
          ).run(nowIso, user.id);
          user.status = 'ACTIVE';
          user.failed_attempts = 0;
        } else {
          res.status(423).json({ error: 'Account is locked by an administrator.' });
          return;
        }
      }

      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        const nextFailed = user.failed_attempts + 1;
        const shouldLock = nextFailed >= MAX_FAILED_LOGINS;
        const lockedUntil = shouldLock
          ? new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
          : null;

        db.prepare(
          'UPDATE users SET failed_attempts = ?, status = ?, locked_until = ?, updated_at = ? WHERE id = ?'
        ).run(nextFailed, shouldLock ? 'LOCKED' : 'ACTIVE', lockedUntil, nowIso, user.id);

        db.prepare(
          'INSERT INTO login_attempts (email, user_id, success, ip_address, user_agent, reason, attempted_at) VALUES (?, ?, 0, ?, ?, ?, ?)'
        ).run(
          email,
          user.id,
          ipAddress,
          userAgent,
          shouldLock ? 'LOCKED_MAX_ATTEMPTS' : 'INVALID_PASSWORD',
          nowIso
        );

        recordAuditLog(db, {
          userId: user.id,
          actorEmail: user.email,
          actorRole: user.role,
          action: shouldLock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
          resourceType: 'AUTH',
          resourceId: user.id,
          status: shouldLock ? 'WARNING' : 'FAILURE',
          ipAddress,
          details: shouldLock
            ? `Account locked for ${LOCKOUT_MINUTES} minutes after ${nextFailed} failed password attempts.`
            : `Failed password verification (${nextFailed}/${MAX_FAILED_LOGINS}).`,
        });

        res.status(shouldLock ? 423 : 401).json({
          error: shouldLock
            ? `Account locked for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED_LOGINS} failed attempts.`
            : 'Invalid institutional email or password.',
        });
        return;
      }

      // Successful login: reset failed_attempts, create session
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = computeSha256Hex(rawToken);
      const csrfToken = crypto.randomBytes(24).toString('hex');
      const sessionId = crypto.randomUUID();
      const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

      db.transaction(() => {
        db.prepare(
          "UPDATE users SET failed_attempts = 0, locked_until = NULL, status = 'ACTIVE', updated_at = ? WHERE id = ?"
        ).run(nowIso, user.id);

        db.prepare(
          `INSERT INTO sessions (id, user_id, token_hash, csrf_token, ip_address, user_agent, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(sessionId, user.id, tokenHash, csrfToken, ipAddress, userAgent, expiresAt, nowIso);

        db.prepare(
          'INSERT INTO login_attempts (email, user_id, success, ip_address, user_agent, reason, attempted_at) VALUES (?, ?, 1, ?, ?, ?, ?)'
        ).run(email, user.id, ipAddress, userAgent, 'AUTHENTICATED', nowIso);

        recordAuditLog(db, {
          userId: user.id,
          actorEmail: user.email,
          actorRole: user.role,
          action: 'LOGIN_SUCCESS',
          resourceType: 'AUTH',
          resourceId: sessionId,
          status: 'SUCCESS',
          ipAddress,
          details: `Authenticated session initiated for ${user.name} (${user.badge_number}).`,
        });
      })();

      setSessionCookie(res, req, rawToken);
      res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          badgeNumber: user.badge_number,
          department: user.department,
          role: user.role,
          status: 'ACTIVE',
        },
        csrfToken,
        sessionToken: rawToken,
        expiresAt,
      });
    } catch {
      res.status(500).json({ error: 'Authentication service encountered an error.' });
    }
  });

  // Current Authenticated Session
  app.get('/api/auth/me', auth, (req: AuthenticatedRequest, res: Response) => {
    const session = db
      .prepare('SELECT expires_at, created_at FROM sessions WHERE id = ?')
      .get(req.sessionId!) as { expires_at: string; created_at: string } | undefined;

    res.json({
      user: req.user,
      csrfToken: req.csrfToken,
      session: session || null,
    });
  });

  // Logout
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const rawToken = extractSessionToken(req);
    if (rawToken) {
      const tokenHash = computeSha256Hex(rawToken);
      const sess = db
        .prepare(
          `SELECT s.id, u.id AS user_id, u.email, u.role
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.revoked_at IS NULL`
        )
        .get(tokenHash) as { id: string; user_id: string; email: string; role: string } | undefined;

      if (sess) {
        db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(
          new Date().toISOString(),
          sess.id
        );
        recordAuditLog(db, {
          userId: sess.user_id,
          actorEmail: sess.email,
          actorRole: sess.role,
          action: 'LOGOUT',
          resourceType: 'AUTH',
          resourceId: sess.id,
          status: 'SUCCESS',
          ipAddress: getClientIp(req),
          details: 'User session terminated cleanly via logout.',
        });
      }
    }
    clearSessionCookie(res, req);
    res.json({ message: 'Logged out successfully.' });
  });

  // Change Password
  app.post('/api/auth/change-password', auth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const currentPassword = String(req.body?.currentPassword || '');
      const newPassword = String(req.body?.newPassword || '');
      const confirmPassword = String(req.body?.confirmPassword || '');

      if (!currentPassword || newPassword.length < 8) {
        res.status(400).json({ error: 'Provide current password and a new password of at least 8 characters.' });
        return;
      }
      if (newPassword !== confirmPassword) {
        res.status(400).json({ error: 'New password and confirmation do not match.' });
        return;
      }

      const row = db
        .prepare('SELECT password_hash FROM users WHERE id = ?')
        .get(req.user!.id) as { password_hash: string };

      const matches = await bcrypt.compare(currentPassword, row.password_hash);
      if (!matches) {
        res.status(401).json({ error: 'Current password is incorrect.' });
        return;
      }

      const newHash = await bcrypt.hash(newPassword, 12);
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
        newHash,
        new Date().toISOString(),
        req.user!.id
      );

      recordAuditLog(db, {
        userId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        action: 'PASSWORD_CHANGED',
        resourceType: 'USER',
        resourceId: req.user!.id,
        status: 'SUCCESS',
        ipAddress: getClientIp(req),
        details: 'Account password updated by authenticated user.',
      });

      res.json({ message: 'Password updated successfully.' });
    } catch {
      res.status(500).json({ error: 'Failed to update password.' });
    }
  });

  // Admin Dashboard Stats
  app.get('/api/dashboard/admin', auth, adminOnly, (_req: AuthenticatedRequest, res: Response) => {
    const totalCases = (db.prepare('SELECT COUNT(*) AS c FROM cases').get() as { c: number }).c;
    const activeCases = (
      db.prepare("SELECT COUNT(*) AS c FROM cases WHERE status IN ('OPEN', 'ACTIVE', 'UNDER_REVIEW')").get() as {
        c: number;
      }
    ).c;
    const totalInvestigators = (
      db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'INVESTIGATOR'").get() as { c: number }
    ).c;
    const totalEvidence = (db.prepare('SELECT COUNT(*) AS c FROM evidence').get() as { c: number }).c;
    const encryptedEvidence = (
      db.prepare("SELECT COUNT(*) AS c FROM evidence WHERE encryption_status = 'ENCRYPTED'").get() as {
        c: number;
      }
    ).c;
    const verifiedEvidence = (
      db.prepare("SELECT COUNT(*) AS c FROM evidence WHERE integrity_status = 'INTEGRITY VERIFIED'").get() as {
        c: number;
      }
    ).c;
    const pendingVerification = (
      db.prepare("SELECT COUNT(*) AS c FROM evidence WHERE integrity_status = 'PENDING'").get() as {
        c: number;
      }
    ).c;
    const mismatchEvidence = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM evidence WHERE integrity_status IN ('INTEGRITY MISMATCH', 'VERIFICATION FAILED')"
        )
        .get() as { c: number }
    ).c;

    const recentActivities = db
      .prepare(
        `SELECT id, actor_email, actor_role, action, resource_type, resource_id, status, details, created_at
         FROM audit_logs ORDER BY id DESC LIMIT 12`
      )
      .all();

    const recentCases = db
      .prepare(
        `SELECT c.id, c.case_code, c.title, c.category, c.priority, c.status, c.created_at,
                u.name AS created_by_name,
                (SELECT COUNT(*) FROM evidence e WHERE e.case_id = c.id) AS evidence_count,
                (SELECT GROUP_CONCAT(u2.name, ', ')
                 FROM case_assignments ca JOIN users u2 ON u2.id = ca.user_id
                 WHERE ca.case_id = c.id) AS assigned_names
         FROM cases c
         JOIN users u ON u.id = c.created_by
         ORDER BY c.created_at DESC LIMIT 6`
      )
      .all();

    const recentEvidence = db
      .prepare(
        `SELECT e.id, e.evidence_code, e.original_filename, e.file_size, e.mime_type, e.sha256_hash,
                e.uploaded_at, e.encryption_status, e.integrity_status, e.signature_status,
                c.case_code, c.title AS case_title, u.name AS uploader_name
         FROM evidence e
         JOIN cases c ON c.id = e.case_id
         JOIN users u ON u.id = e.uploaded_by
         ORDER BY e.uploaded_at DESC LIMIT 6`
      )
      .all();

    res.json({
      stats: {
        totalCases,
        activeCases,
        totalInvestigators,
        totalEvidence,
        encryptedEvidence,
        verifiedEvidence,
        pendingVerification,
        mismatchEvidence,
      },
      recentActivities,
      recentCases,
      recentEvidence,
    });
  });

  // Investigator Dashboard Stats (strictly scoped to assigned cases)
  app.get('/api/dashboard/investigator', auth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const isAdmin = user.role === 'ADMIN';

    const assignedCases = isAdmin
      ? db
          .prepare(
            `SELECT c.id, c.case_code, c.title, c.category, c.priority, c.status, c.created_at,
                    (SELECT COUNT(*) FROM evidence e WHERE e.case_id = c.id) AS evidence_count
             FROM cases c ORDER BY c.created_at DESC`
          )
          .all()
      : db
          .prepare(
            `SELECT c.id, c.case_code, c.title, c.category, c.priority, c.status, c.created_at,
                    (SELECT COUNT(*) FROM evidence e WHERE e.case_id = c.id) AS evidence_count
             FROM cases c
             JOIN case_assignments ca ON ca.case_id = c.id
             WHERE ca.user_id = ?
             ORDER BY c.created_at DESC`
          )
          .all(user.id);

    const evidenceUploadedRow = db
      .prepare('SELECT COUNT(*) AS c FROM evidence WHERE uploaded_by = ?')
      .get(user.id) as { c: number };

    const pendingVerificationRow = isAdmin
      ? (db
          .prepare("SELECT COUNT(*) AS c FROM evidence WHERE integrity_status = 'PENDING'")
          .get() as { c: number })
      : (db
          .prepare(
            `SELECT COUNT(*) AS c FROM evidence e
             JOIN case_assignments ca ON ca.case_id = e.case_id
             WHERE ca.user_id = ? AND e.integrity_status = 'PENDING'`
          )
          .get(user.id) as { c: number });

    const authorizedEvidence = isAdmin
      ? db
          .prepare(
            `SELECT e.id, e.evidence_code, e.original_filename, e.file_size, e.uploaded_at,
                    e.encryption_status, e.integrity_status, e.signature_status, c.case_code
             FROM evidence e JOIN cases c ON c.id = e.case_id
             ORDER BY e.uploaded_at DESC LIMIT 8`
          )
          .all()
      : db
          .prepare(
            `SELECT e.id, e.evidence_code, e.original_filename, e.file_size, e.uploaded_at,
                    e.encryption_status, e.integrity_status, e.signature_status, c.case_code
             FROM evidence e
             JOIN cases c ON c.id = e.case_id
             JOIN case_assignments ca ON ca.case_id = e.case_id
             WHERE ca.user_id = ?
             ORDER BY e.uploaded_at DESC LIMIT 8`
          )
          .all(user.id);

    const recentActivity = isAdmin
      ? db
          .prepare(
            `SELECT cc.id, cc.event_type, cc.timestamp, cc.description, e.evidence_code, u.name AS actor_name
             FROM chain_of_custody cc
             JOIN evidence e ON e.id = cc.evidence_id
             JOIN users u ON u.id = cc.user_id
             ORDER BY cc.id DESC LIMIT 10`
          )
          .all()
      : db
          .prepare(
            `SELECT cc.id, cc.event_type, cc.timestamp, cc.description, e.evidence_code, u.name AS actor_name
             FROM chain_of_custody cc
             JOIN evidence e ON e.id = cc.evidence_id
             JOIN case_assignments ca ON ca.case_id = e.case_id
             JOIN users u ON u.id = cc.user_id
             WHERE ca.user_id = ?
             ORDER BY cc.id DESC LIMIT 10`
          )
          .all(user.id);

    res.json({
      stats: {
        assignedCasesCount: assignedCases.length,
        evidenceUploadedCount: evidenceUploadedRow.c,
        pendingVerificationCount: pendingVerificationRow.c,
        authorizedEvidenceCount: authorizedEvidence.length,
      },
      assignedCases,
      authorizedEvidence,
      recentActivity,
    });
  });

  // User Management (ADMIN only)
  app.get('/api/users', auth, adminOnly, (req: AuthenticatedRequest, res: Response) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const roleFilter = String(req.query.role || '').trim().toUpperCase();
    const statusFilter = String(req.query.status || '').trim().toUpperCase();

    let sql = `
      SELECT id, name, email, badge_number, department, role, status, failed_attempts, locked_until, created_at, updated_at
      FROM users WHERE 1=1
    `;
    const params: unknown[] = [];

    if (search) {
      sql += ' AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(badge_number) LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (roleFilter === 'ADMIN' || roleFilter === 'INVESTIGATOR') {
      sql += ' AND role = ?';
      params.push(roleFilter);
    }
    if (statusFilter === 'ACTIVE' || statusFilter === 'LOCKED' || statusFilter === 'DISABLED') {
      sql += ' AND status = ?';
      params.push(statusFilter);
    }
    sql += ' ORDER BY created_at DESC';

    const users = db.prepare(sql).all(...params);
    res.json({ users });
  });

  app.post('/api/users', auth, adminOnly, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const name = String(req.body?.name || '').trim();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const badgeNumber = String(req.body?.badgeNumber || '').trim();
      const department = String(req.body?.department || 'Digital Forensics').trim();
      const role = String(req.body?.role || 'INVESTIGATOR').toUpperCase();
      const password = String(req.body?.password || '');

      if (!name || name.length < 2) {
        res.status(400).json({ error: 'User name must be at least 2 characters.' });
        return;
      }
      if (!isValidEmail(email)) {
        res.status(400).json({ error: 'Valid institutional email is required.' });
        return;
      }
      if (!badgeNumber) {
        res.status(400).json({ error: 'Badge number is required.' });
        return;
      }
      if (role !== 'ADMIN' && role !== 'INVESTIGATOR') {
        res.status(400).json({ error: 'Role must be ADMIN or INVESTIGATOR.' });
        return;
      }
      if (password.length < 8) {
        res.status(400).json({ error: 'Initial password must be at least 8 characters.' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO users (
          id, name, email, badge_number, department, role, password_hash, status, failed_attempts, locked_until, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, NULL, ?, ?)`
      ).run(id, name, email, badgeNumber, department, role, passwordHash, now, now);

      recordAuditLog(db, {
        userId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        action: 'USER_CREATED',
        resourceType: 'USER',
        resourceId: id,
        status: 'SUCCESS',
        ipAddress: getClientIp(req),
        details: `Created ${role} account for ${name} (${badgeNumber}, ${email}).`,
      });

      res.status(201).json({
        user: {
          id,
          name,
          email,
          badge_number: badgeNumber,
          department,
          role,
          status: 'ACTIVE',
          created_at: now,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: 'Email or badge number already exists.' });
        return;
      }
      res.status(500).json({ error: 'Failed to create user.' });
    }
  });

  app.patch('/api/users/:id', auth, adminOnly, (req: AuthenticatedRequest, res: Response) => {
    const targetId = req.params.id;
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId) as
      | {
          id: string;
          name: string;
          email: string;
          role: 'ADMIN' | 'INVESTIGATOR';
          status: 'ACTIVE' | 'LOCKED' | 'DISABLED';
          department: string;
        }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const nextStatus = req.body?.status
      ? String(req.body.status).toUpperCase()
      : existing.status;
    const nextRole = req.body?.role ? String(req.body.role).toUpperCase() : existing.role;
    const nextDept = req.body?.department
      ? String(req.body.department).trim()
      : existing.department;

    if (!['ACTIVE', 'LOCKED', 'DISABLED'].includes(nextStatus)) {
      res.status(400).json({ error: 'Invalid status value.' });
      return;
    }
    if (!['ADMIN', 'INVESTIGATOR'].includes(nextRole)) {
      res.status(400).json({ error: 'Invalid role value.' });
      return;
    }
    if (targetId === req.user!.id && nextStatus !== 'ACTIVE') {
      res.status(400).json({ error: 'You cannot lock or disable your own active administrator account.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE users
       SET status = ?, role = ?, department = ?,
           failed_attempts = CASE WHEN ? = 'ACTIVE' THEN 0 ELSE failed_attempts END,
           locked_until = CASE WHEN ? = 'ACTIVE' THEN NULL ELSE locked_until END,
           updated_at = ?
       WHERE id = ?`
    ).run(nextStatus, nextRole, nextDept, nextStatus, nextStatus, now, targetId);

    if (nextStatus !== 'ACTIVE') {
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
        now,
        targetId
      );
    }

    recordAuditLog(db, {
      userId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      action: 'USER_UPDATED',
      resourceType: 'USER',
      resourceId: targetId,
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
      details: `Updated user ${existing.email}: status=${nextStatus}, role=${nextRole}.`,
    });

    const updated = db
      .prepare(
        'SELECT id, name, email, badge_number, department, role, status, failed_attempts, locked_until, created_at, updated_at FROM users WHERE id = ?'
      )
      .get(targetId);

    res.json({ user: updated });
  });

  // List Investigators (ADMIN uses this when assigning cases)
  app.get('/api/investigators', auth, adminOnly, (_req: AuthenticatedRequest, res: Response) => {
    const investigators = db
      .prepare(
        "SELECT id, name, email, badge_number, department, status FROM users WHERE role = 'INVESTIGATOR' AND status = 'ACTIVE' ORDER BY name ASC"
      )
      .all();
    res.json({ investigators });
  });

  // Investigation Cases
  app.get('/api/cases', auth, (req: AuthenticatedRequest, res: Response) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const statusFilter = String(req.query.status || '').trim().toUpperCase();
    const priorityFilter = String(req.query.priority || '').trim().toUpperCase();
    const sortBy = String(req.query.sort || 'newest');

    const user = req.user!;
    const params: unknown[] = [];

    let sql = `
      SELECT c.id, c.case_code, c.title, c.description, c.category, c.priority, c.status, c.created_by, c.created_at, c.updated_at,
             u.name AS created_by_name,
             (SELECT COUNT(*) FROM evidence e WHERE e.case_id = c.id) AS evidence_count,
             (SELECT GROUP_CONCAT(u2.name || ' (' || u2.badge_number || ')', ', ')
              FROM case_assignments ca2 JOIN users u2 ON u2.id = ca2.user_id
              WHERE ca2.case_id = c.id) AS assigned_investigators
      FROM cases c
      JOIN users u ON u.id = c.created_by
      WHERE 1=1
    `;

    if (user.role !== 'ADMIN') {
      sql += ' AND EXISTS (SELECT 1 FROM case_assignments ca WHERE ca.case_id = c.id AND ca.user_id = ?)';
      params.push(user.id);
    }

    if (search) {
      sql += ' AND (LOWER(c.case_code) LIKE ? OR LOWER(c.title) LIKE ? OR LOWER(c.category) LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (['OPEN', 'ACTIVE', 'UNDER_REVIEW', 'CLOSED', 'ARCHIVED'].includes(statusFilter)) {
      sql += ' AND c.status = ?';
      params.push(statusFilter);
    }
    if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(priorityFilter)) {
      sql += ' AND c.priority = ?';
      params.push(priorityFilter);
    }

    switch (sortBy) {
      case 'oldest':
        sql += ' ORDER BY c.created_at ASC';
        break;
      case 'priority':
        sql += ` ORDER BY CASE c.priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END, c.created_at DESC`;
        break;
      case 'title':
        sql += ' ORDER BY c.title ASC';
        break;
      default:
        sql += ' ORDER BY c.created_at DESC';
    }

    const cases = db.prepare(sql).all(...params);
    res.json({ cases });
  });

  app.post('/api/cases', auth, adminOnly, (req: AuthenticatedRequest, res: Response) => {
    try {
      const title = String(req.body?.title || '').trim();
      const description = String(req.body?.description || '').trim();
      const category = String(req.body?.category || 'Cyber Intrusion').trim();
      const priority = String(req.body?.priority || 'MEDIUM').toUpperCase();
      const status = String(req.body?.status || 'OPEN').toUpperCase();
      const assignedInvestigatorId = req.body?.assignedInvestigatorId
        ? String(req.body.assignedInvestigatorId).trim()
        : null;

      if (!title || title.length < 3) {
        res.status(400).json({ error: 'Case title must be at least 3 characters.' });
        return;
      }
      if (!description || description.length < 5) {
        res.status(400).json({ error: 'Case description is required.' });
        return;
      }
      if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(priority)) {
        res.status(400).json({ error: 'Invalid case priority.' });
        return;
      }
      if (!['OPEN', 'ACTIVE', 'UNDER_REVIEW', 'CLOSED', 'ARCHIVED'].includes(status)) {
        res.status(400).json({ error: 'Invalid case status.' });
        return;
      }

      const id = crypto.randomUUID();
      const caseCode = formatCaseCode();
      const now = new Date().toISOString();

      db.transaction(() => {
        db.prepare(
          `INSERT INTO cases (id, case_code, title, description, category, priority, status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(id, caseCode, title, description, category, priority, status, req.user!.id, now, now);

        if (assignedInvestigatorId) {
          const inv = db
            .prepare("SELECT id, name, badge_number FROM users WHERE id = ? AND status = 'ACTIVE'")
            .get(assignedInvestigatorId) as { id: string; name: string; badge_number: string } | undefined;
          if (!inv) {
            throw new Error('INVALID_INVESTIGATOR');
          }
          db.prepare(
            `INSERT INTO case_assignments (id, case_id, user_id, assigned_by, assigned_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(crypto.randomUUID(), id, inv.id, req.user!.id, now);
        }

        recordAuditLog(db, {
          userId: req.user!.id,
          actorEmail: req.user!.email,
          actorRole: req.user!.role,
          action: 'CASE_CREATED',
          resourceType: 'CASE',
          resourceId: id,
          status: 'SUCCESS',
          ipAddress: getClientIp(req),
          details: `Created case ${caseCode}: ${title} (${priority}).`,
        });
      })();

      const created = db.prepare('SELECT * FROM cases WHERE id = ?').get(id);
      res.status(201).json({ caseRecord: created });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'INVALID_INVESTIGATOR') {
        res.status(400).json({ error: 'Selected investigator does not exist or is inactive.' });
        return;
      }
      res.status(500).json({ error: 'Failed to create investigation case.' });
    }
  });

  app.get('/api/cases/:id', auth, (req: AuthenticatedRequest, res: Response) => {
    const caseId = req.params.id;
    const caseRecord = db
      .prepare(
        `SELECT c.*, u.name AS created_by_name, u.badge_number AS created_by_badge
         FROM cases c JOIN users u ON u.id = c.created_by
         WHERE c.id = ? OR c.case_code = ?`
      )
      .get(caseId, caseId) as { id: string; case_code: string } | undefined;

    if (!caseRecord) {
      res.status(404).json({ error: 'Investigation case not found.' });
      return;
    }

    if (!canAccessCase(db, req.user!, caseRecord.id)) {
      recordAuditLog(db, {
        userId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        action: 'UNAUTHORIZED_CASE_ACCESS',
        resourceType: 'CASE',
        resourceId: caseRecord.id,
        status: 'WARNING',
        ipAddress: getClientIp(req),
        details: `Blocked access to unassigned case ${caseRecord.case_code}.`,
      });
      res.status(403).json({ error: 'You are not assigned to this investigation case.' });
      return;
    }

    const assignedInvestigators = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.badge_number, u.department, ca.assigned_at
         FROM case_assignments ca
         JOIN users u ON u.id = ca.user_id
         WHERE ca.case_id = ?
         ORDER BY ca.assigned_at DESC`
      )
      .all(caseRecord.id);

    const evidenceItems = db
      .prepare(
        `SELECT e.*, u.name AS uploader_name, u.badge_number AS uploader_badge
         FROM evidence e
         JOIN users u ON u.id = e.uploaded_by
         WHERE e.case_id = ?
         ORDER BY e.uploaded_at DESC`
      )
      .all(caseRecord.id);

    const caseActivity = db
      .prepare(
        `SELECT cc.id, cc.event_type, cc.timestamp, cc.description, e.evidence_code, u.name AS actor_name
         FROM chain_of_custody cc
         JOIN evidence e ON e.id = cc.evidence_id
         JOIN users u ON u.id = cc.user_id
         WHERE e.case_id = ?
         ORDER BY cc.id DESC LIMIT 25`
      )
      .all(caseRecord.id);

    res.json({
      caseRecord,
      assignedInvestigators,
      evidenceItems,
      caseActivity,
    });
  });

  app.patch('/api/cases/:id', auth, adminOnly, (req: AuthenticatedRequest, res: Response) => {
    const caseId = req.params.id;
    const existing = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId) as
      | {
          id: string;
          case_code: string;
          title: string;
          description: string;
          category: string;
          priority: string;
          status: string;
        }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Investigation case not found.' });
      return;
    }

    const title = req.body?.title !== undefined ? String(req.body.title).trim() : existing.title;
    const description =
      req.body?.description !== undefined ? String(req.body.description).trim() : existing.description;
    const category =
      req.body?.category !== undefined ? String(req.body.category).trim() : existing.category;
    const priority =
      req.body?.priority !== undefined
        ? String(req.body.priority).toUpperCase()
        : existing.priority;
    const status =
      req.body?.status !== undefined ? String(req.body.status).toUpperCase() : existing.status;

    if (!title || title.length < 3) {
      res.status(400).json({ error: 'Case title must be at least 3 characters.' });
      return;
    }
    if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(priority)) {
      res.status(400).json({ error: 'Invalid priority.' });
      return;
    }
    if (!['OPEN', 'ACTIVE', 'UNDER_REVIEW', 'CLOSED', 'ARCHIVED'].includes(status)) {
      res.status(400).json({ error: 'Invalid status.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE cases SET title = ?, description = ?, category = ?, priority = ?, status = ?, updated_at = ? WHERE id = ?'
    ).run(title, description, category, priority, status, now, caseId);

    recordAuditLog(db, {
      userId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      action: 'CASE_UPDATED',
      resourceType: 'CASE',
      resourceId: caseId,
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
      details: `Updated case ${existing.case_code}: status=${status}, priority=${priority}.`,
    });

    const updated = db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
    res.json({ caseRecord: updated });
  });

  app.post('/api/cases/:id/assign', auth, adminOnly, (req: AuthenticatedRequest, res: Response) => {
    const caseId = req.params.id;
    const userId = String(req.body?.userId || '').trim();

    const caseRow = db.prepare('SELECT id, case_code FROM cases WHERE id = ?').get(caseId) as
      | { id: string; case_code: string }
      | undefined;
    if (!caseRow) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }

    const investigator = db
      .prepare("SELECT id, name, badge_number, email FROM users WHERE id = ? AND status = 'ACTIVE'")
      .get(userId) as { id: string; name: string; badge_number: string; email: string } | undefined;
    if (!investigator) {
      res.status(404).json({ error: 'Active investigator not found.' });
      return;
    }

    const exists = db
      .prepare('SELECT id FROM case_assignments WHERE case_id = ? AND user_id = ?')
      .get(caseId, userId);
    if (exists) {
      res.status(409).json({ error: 'Investigator is already assigned to this case.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO case_assignments (id, case_id, user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), caseId, userId, req.user!.id, now);

    recordAuditLog(db, {
      userId: req.user!.id,
      actorEmail: req.user!.email,
      actorRole: req.user!.role,
      action: 'INVESTIGATOR_ASSIGNED',
      resourceType: 'CASE',
      resourceId: caseId,
      status: 'SUCCESS',
      ipAddress: getClientIp(req),
      details: `Assigned ${investigator.name} (${investigator.badge_number}) to case ${caseRow.case_code}.`,
    });

    res.status(201).json({ message: 'Investigator assigned successfully.' });
  });

  app.delete(
    '/api/cases/:id/assign/:userId',
    auth,
    adminOnly,
    (req: AuthenticatedRequest, res: Response) => {
      const { id: caseId, userId } = req.params;
      const result = db
        .prepare('DELETE FROM case_assignments WHERE case_id = ? AND user_id = ?')
        .run(caseId, userId);
      if (result.changes === 0) {
        res.status(404).json({ error: 'Assignment not found.' });
        return;
      }

      recordAuditLog(db, {
        userId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        action: 'INVESTIGATOR_UNASSIGNED',
        resourceType: 'CASE',
        resourceId: caseId,
        status: 'SUCCESS',
        ipAddress: getClientIp(req),
        details: `Removed investigator ${userId} from case ${caseId}.`,
      });
      res.json({ message: 'Investigator removed from case.' });
    }
  );

  // Evidence Repository List
  app.get('/api/evidence', auth, (req: AuthenticatedRequest, res: Response) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const caseId = String(req.query.caseId || '').trim();
    const integrityFilter = String(req.query.integrity || '').trim();
    const user = req.user!;

    const params: unknown[] = [];
    let sql = `
      SELECT e.*, c.case_code, c.title AS case_title, u.name AS uploader_name, u.badge_number AS uploader_badge
      FROM evidence e
      JOIN cases c ON c.id = e.case_id
      JOIN users u ON u.id = e.uploaded_by
      WHERE 1=1
    `;

    if (user.role !== 'ADMIN') {
      sql += ' AND EXISTS (SELECT 1 FROM case_assignments ca WHERE ca.case_id = e.case_id AND ca.user_id = ?)';
      params.push(user.id);
    }
    if (caseId) {
      sql += ' AND e.case_id = ?';
      params.push(caseId);
    }
    if (integrityFilter) {
      sql += ' AND e.integrity_status = ?';
      params.push(integrityFilter);
    }
    if (search) {
      sql +=
        ' AND (LOWER(e.evidence_code) LIKE ? OR LOWER(e.original_filename) LIKE ? OR LOWER(e.sha256_hash) LIKE ? OR LOWER(c.case_code) LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY e.uploaded_at DESC';

    const evidence = db.prepare(sql).all(...params);
    res.json({ evidence });
  });

  // Acquire & Encrypt Evidence (Upload -> SHA-256 -> AES-256-GCM -> RSA-OAEP-3072 -> Vault -> DB)
  app.post(
    '/api/evidence/acquire',
    auth,
    (req: AuthenticatedRequest, res: Response, next) => {
      upload.single('file')(req, res, (err) => {
        if (err) {
          if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({ error: 'Evidence file exceeds the 25 MB maximum upload limit.' });
            return;
          }
          res.status(400).json({ error: err.message || 'File upload failed.' });
          return;
        }
        next();
      });
    },
    (req: AuthenticatedRequest, res: Response) => {
      const file = req.file;
      const caseId = String(req.body?.caseId || '').trim();
      const notes = String(req.body?.notes || '').trim();

      if (!file) {
        res.status(400).json({ error: 'Please select an evidence file to upload.' });
        return;
      }
      if (!caseId) {
        res.status(400).json({ error: 'Target investigation case is required.' });
        return;
      }

      const caseRow = db.prepare('SELECT id, case_code, status FROM cases WHERE id = ?').get(caseId) as
        | { id: string; case_code: string; status: string }
        | undefined;
      if (!caseRow) {
        res.status(404).json({ error: 'Target case not found.' });
        return;
      }
      if (!canAccessCase(db, req.user!, caseRow.id)) {
        res.status(403).json({ error: 'You are not authorized to acquire evidence for this case.' });
        return;
      }

      const safeFilename = sanitizeFilename(file.originalname);
      const validation = validateEvidenceFile(safeFilename, file.mimetype, file.size);
      if (!validation.valid) {
        res.status(400).json({ error: validation.reason });
        return;
      }

      const evidenceId = crypto.randomUUID();
      const evidenceCode = formatEvidenceCode();
      const uploadedAt = new Date().toISOString();
      const sha256Hash = computeSha256Hex(file.buffer);
      const safeStorageName = `${evidenceId}.enc`;
      const vaultPath = resolveVaultFilePath(getVaultDir(), safeStorageName);

      try {
        // 1. Encrypt with AES-256-GCM and wrap AES key using RSA-OAEP-3072
        const encryption = encryptEvidenceBuffer(
          file.buffer,
          evidenceId,
          sha256Hash,
          keys.wrappingKeys.publicKeyPem,
          keys.wrappingKeys.modulusLength
        );

        // 2. Write encrypted bytes to private vault
        fs.writeFileSync(vaultPath, encryption.ciphertext, { mode: 0o600 });

        // 3. Persist records atomically inside SQLite transaction
        db.transaction(() => {
          db.prepare(
            `INSERT INTO evidence (
              id, evidence_code, case_id, original_filename, safe_storage_name, file_size, mime_type,
              sha256_hash, uploaded_by, uploaded_at, encryption_status, integrity_status, signature_status, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ENCRYPTED', 'PENDING', 'UNAVAILABLE', ?)`
          ).run(
            evidenceId,
            evidenceCode,
            caseRow.id,
            safeFilename,
            safeStorageName,
            file.size,
            file.mimetype || 'application/octet-stream',
            sha256Hash,
            req.user!.id,
            uploadedAt,
            notes
          );

          db.prepare(
            `INSERT INTO encryption_metadata (
              id, evidence_id, aes_algorithm, iv_hex, auth_tag_hex, aad,
              rsa_algorithm, rsa_key_bits, rsa_key_fingerprint, wrapped_aes_key_b64, encrypted_size, encrypted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            crypto.randomUUID(),
            evidenceId,
            encryption.aesAlgorithm,
            encryption.ivHex,
            encryption.authTagHex,
            encryption.aad,
            encryption.rsaAlgorithm,
            encryption.rsaKeyBits,
            encryption.rsaKeyFingerprint,
            encryption.wrappedAesKeyB64,
            encryption.encryptedSize,
            uploadedAt
          );

          appendCustodyEvent(db, {
            evidenceId,
            userId: req.user!.id,
            eventType: 'ACQUISITION',
            description: `Evidence ${evidenceCode} (${safeFilename}, ${file.size} bytes) acquired for case ${caseRow.case_code}. SHA-256: ${sha256Hash}`,
            timestamp: uploadedAt,
          });

          appendCustodyEvent(db, {
            evidenceId,
            userId: req.user!.id,
            eventType: 'UPLOAD',
            description: `Artifact ingested into protected backend vault (${safeStorageName}).`,
          });

          appendCustodyEvent(db, {
            evidenceId,
            userId: req.user!.id,
            eventType: 'ENCRYPTION',
            description: `Encrypted via ${encryption.aesAlgorithm}; 256-bit DEK wrapped using ${encryption.rsaAlgorithm}-${encryption.rsaKeyBits} (FP: ${encryption.rsaKeyFingerprint}).`,
          });

          recordAuditLog(db, {
            userId: req.user!.id,
            actorEmail: req.user!.email,
            actorRole: req.user!.role,
            action: 'EVIDENCE_ACQUIRED_AND_ENCRYPTED',
            resourceType: 'EVIDENCE',
            resourceId: evidenceId,
            status: 'SUCCESS',
            ipAddress: getClientIp(req),
            details: `Acquired ${evidenceCode} (${safeFilename}) in case ${caseRow.case_code}; SHA-256 ${sha256Hash.slice(0, 16)}...`,
          });
        })();

        const created = db
          .prepare(
            `SELECT e.*, c.case_code, c.title AS case_title, u.name AS uploader_name, u.badge_number AS uploader_badge
             FROM evidence e
             JOIN cases c ON c.id = e.case_id
             JOIN users u ON u.id = e.uploaded_by
             WHERE e.id = ?`
          )
          .get(evidenceId);
        const encMeta = db
          .prepare(
            'SELECT id, aes_algorithm, iv_hex, auth_tag_hex, rsa_algorithm, rsa_key_bits, rsa_key_fingerprint, wrapped_aes_key_b64, encrypted_size, encrypted_at FROM encryption_metadata WHERE evidence_id = ?'
          )
          .get(evidenceId);

        res.status(201).json({
          evidence: created,
          encryptionMetadata: encMeta,
        });
      } catch {
        if (fs.existsSync(vaultPath)) {
          fs.unlinkSync(vaultPath);
        }
        res.status(500).json({ error: 'Cryptographic acquisition failed. No evidence was stored.' });
      }
    }
  );

  // Evidence Details
  app.get('/api/evidence/:id', auth, (req: AuthenticatedRequest, res: Response) => {
    const id = req.params.id;
    const item = db
      .prepare(
        `SELECT e.*, c.case_code, c.title AS case_title, c.priority AS case_priority, c.status AS case_status,
                u.name AS uploader_name, u.badge_number AS uploader_badge, u.email AS uploader_email
         FROM evidence e
         JOIN cases c ON c.id = e.case_id
         JOIN users u ON u.id = e.uploaded_by
         WHERE e.id = ? OR e.evidence_code = ?`
      )
      .get(id, id) as { id: string; case_id: string; evidence_code: string } | undefined;

    if (!item) {
      res.status(404).json({ error: 'Evidence item not found.' });
      return;
    }
    if (!canAccessCase(db, req.user!, item.case_id)) {
      res.status(403).json({ error: 'Access denied to this evidence record.' });
      return;
    }

    const encryptionMetadata = db
      .prepare(
        'SELECT id, evidence_id, aes_algorithm, iv_hex, auth_tag_hex, aad, rsa_algorithm, rsa_key_bits, rsa_key_fingerprint, wrapped_aes_key_b64, encrypted_size, encrypted_at FROM encryption_metadata WHERE evidence_id = ?'
      )
      .get(item.id);

    const integrityHistory = db
      .prepare(
        `SELECT iv.*, u.name AS verifier_name, u.badge_number AS verifier_badge
         FROM integrity_verification iv
         JOIN users u ON u.id = iv.verified_by
         WHERE iv.evidence_id = ?
         ORDER BY iv.verified_at DESC`
      )
      .all(item.id);

    const signatures = db
      .prepare(
        `SELECT ds.*, u.name AS signer_name, u.badge_number AS signer_badge
         FROM digital_signatures ds
         JOIN users u ON u.id = ds.signer_id
         WHERE ds.evidence_id = ?
         ORDER BY ds.signed_at DESC`
      )
      .all(item.id);

    const custodyEvents = db
      .prepare(
        `SELECT cc.*, u.name AS actor_name, u.badge_number AS actor_badge
         FROM chain_of_custody cc
         JOIN users u ON u.id = cc.user_id
         WHERE cc.evidence_id = ?
         ORDER BY cc.id ASC`
      )
      .all(item.id) as Array<{
      id: number;
      evidence_id: string;
      user_id: string;
      event_type: string;
      timestamp: string;
      description: string;
      previous_event_hash: string;
      current_event_hash: string;
      actor_name: string;
      actor_badge: string;
    }>;

    const custodyValidation = verifyCustodyChain(custodyEvents);

    res.json({
      evidence: item,
      encryptionMetadata,
      integrityHistory,
      signatures,
      custodyEvents,
      custodyValidation,
    });
  });

  // Authorized Decryption & Download
  app.get('/api/evidence/:id/decrypt', auth, (req: AuthenticatedRequest, res: Response) => {
    const id = req.params.id;
    const item = db
      .prepare('SELECT * FROM evidence WHERE id = ? OR evidence_code = ?')
      .get(id, id) as
      | {
          id: string;
          case_id: string;
          evidence_code: string;
          original_filename: string;
          safe_storage_name: string;
          mime_type: string;
          sha256_hash: string;
        }
      | undefined;

    if (!item) {
      res.status(404).json({ error: 'Evidence item not found.' });
      return;
    }
    if (!canAccessCase(db, req.user!, item.case_id)) {
      res.status(403).json({ error: 'Unauthorized decryption request blocked.' });
      return;
    }

    const enc = db
      .prepare('SELECT * FROM encryption_metadata WHERE evidence_id = ?')
      .get(item.id) as
      | {
          iv_hex: string;
          auth_tag_hex: string;
          aad: string;
          wrapped_aes_key_b64: string;
        }
      | undefined;
    if (!enc) {
      res.status(500).json({ error: 'Encryption metadata missing for this artifact.' });
      return;
    }

    try {
      const vaultPath = resolveVaultFilePath(getVaultDir(), item.safe_storage_name);
      const ciphertext = fs.readFileSync(vaultPath);
      const plaintext = decryptEvidenceBuffer(
        ciphertext,
        {
          ivHex: enc.iv_hex,
          authTagHex: enc.auth_tag_hex,
          aad: enc.aad,
          wrappedAesKeyB64: enc.wrapped_aes_key_b64,
        },
        keys.wrappingKeys.privateKeyPem
      );

      db.transaction(() => {
        appendCustodyEvent(db, {
          evidenceId: item.id,
          userId: req.user!.id,
          eventType: 'AUTHORIZED_DECRYPTION',
          description: `Authorized AES-256-GCM decryption & RSA-OAEP key unwrap executed by ${req.user!.name} (${req.user!.badgeNumber}).`,
        });
        recordAuditLog(db, {
          userId: req.user!.id,
          actorEmail: req.user!.email,
          actorRole: req.user!.role,
          action: 'EVIDENCE_DECRYPTED_DOWNLOAD',
          resourceType: 'EVIDENCE',
          resourceId: item.id,
          status: 'SUCCESS',
          ipAddress: getClientIp(req),
          details: `Authorized decryption of ${item.evidence_code} (${item.original_filename}).`,
        });
      })();

      res.setHeader('Content-Type', item.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${item.original_filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(plaintext);
    } catch {
      recordAuditLog(db, {
        userId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        action: 'EVIDENCE_DECRYPTION_FAILED',
        resourceType: 'EVIDENCE',
        resourceId: item.id,
        status: 'FAILURE',
        ipAddress: getClientIp(req),
        details: `Decryption or GCM authentication tag verification failed for ${item.evidence_code}.`,
      });
      res.status(500).json({ error: 'Decryption failed: GCM authentication tag or ciphertext integrity check failed.' });
    }
  });

  // SHA-256 Integrity Verification
  app.post('/api/evidence/:id/verify-integrity', auth, (req: AuthenticatedRequest, res: Response) => {
    const id = req.params.id;
    const item = db
      .prepare('SELECT * FROM evidence WHERE id = ? OR evidence_code = ?')
      .get(id, id) as
      | {
          id: string;
          case_id: string;
          evidence_code: string;
          safe_storage_name: string;
          sha256_hash: string;
        }
      | undefined;

    if (!item) {
      res.status(404).json({ error: 'Evidence item not found.' });
      return;
    }
    if (!canAccessCase(db, req.user!, item.case_id)) {
      res.status(403).json({ error: 'You are not authorized to verify this evidence.' });
      return;
    }

    const enc = db
      .prepare('SELECT * FROM encryption_metadata WHERE evidence_id = ?')
      .get(item.id) as
      | {
          iv_hex: string;
          auth_tag_hex: string;
          aad: string;
          wrapped_aes_key_b64: string;
        }
      | undefined;

    const verifiedAt = new Date().toISOString();
    let calculatedSha256 = 'UNAVAILABLE';
    let status: 'INTEGRITY VERIFIED' | 'INTEGRITY MISMATCH' | 'VERIFICATION FAILED' = 'VERIFICATION FAILED';
    let details = '';

    try {
      if (!enc) {
        throw new Error('Encryption metadata record is missing.');
      }
      const vaultPath = resolveVaultFilePath(getVaultDir(), item.safe_storage_name);
      if (!fs.existsSync(vaultPath)) {
        throw new Error('Encrypted evidence artifact missing from vault storage.');
      }
      const ciphertext = fs.readFileSync(vaultPath);
      const plaintext = decryptEvidenceBuffer(
        ciphertext,
        {
          ivHex: enc.iv_hex,
          authTagHex: enc.auth_tag_hex,
          aad: enc.aad,
          wrappedAesKeyB64: enc.wrapped_aes_key_b64,
        },
        keys.wrappingKeys.privateKeyPem
      );

      calculatedSha256 = computeSha256Hex(plaintext);
      if (calculatedSha256 === item.sha256_hash) {
        status = 'INTEGRITY VERIFIED';
        details = 'Decrypted payload SHA-256 digest exactly matches original acquisition digest.';
      } else {
        status = 'INTEGRITY MISMATCH';
        details = 'Recalculated SHA-256 digest differs from the stored acquisition digest.';
      }
    } catch (err: unknown) {
      status = 'VERIFICATION FAILED';
      details = err instanceof Error ? err.message : 'Authenticated decryption failed during integrity verification.';
    }

    const verificationId = crypto.randomUUID();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO integrity_verification (
          id, evidence_id, verified_by, expected_sha256, calculated_sha256, status, details, verified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        verificationId,
        item.id,
        req.user!.id,
        item.sha256_hash,
        calculatedSha256,
        status,
        details,
        verifiedAt
      );

      db.prepare('UPDATE evidence SET integrity_status = ? WHERE id = ?').run(status, item.id);

      appendCustodyEvent(db, {
        evidenceId: item.id,
        userId: req.user!.id,
        eventType: 'INTEGRITY_VERIFICATION',
        description: `SHA-256 integrity check result: ${status}. ${details}`,
        timestamp: verifiedAt,
      });

      recordAuditLog(db, {
        userId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        action: 'INTEGRITY_VERIFICATION_EXECUTED',
        resourceType: 'EVIDENCE',
        resourceId: item.id,
        status: status === 'INTEGRITY VERIFIED' ? 'SUCCESS' : 'WARNING',
        ipAddress: getClientIp(req),
        details: `${item.evidence_code} integrity verification -> ${status}.`,
      });
    })();

    const verification = db
      .prepare(
        `SELECT iv.*, u.name AS verifier_name, u.badge_number AS verifier_badge
         FROM integrity_verification iv JOIN users u ON u.id = iv.verified_by
         WHERE iv.id = ?`
      )
      .get(verificationId);

    res.json({ verification });
  });

  // Digital Signature: Sign Canonical Manifest (RSA-PSS-SHA256)
  app.post('/api/evidence/:id/sign', auth, (req: AuthenticatedRequest, res: Response) => {
    const id = req.params.id;
    const item = db
      .prepare('SELECT * FROM evidence WHERE id = ? OR evidence_code = ?')
      .get(id, id) as
      | {
          id: string;
          case_id: string;
          evidence_code: string;
          original_filename: string;
          file_size: number;
          mime_type: string;
          sha256_hash: string;
          uploaded_by: string;
          uploaded_at: string;
        }
      | undefined;

    if (!item) {
      res.status(404).json({ error: 'Evidence item not found.' });
      return;
    }
    if (!canAccessCase(db, req.user!, item.case_id)) {
      res.status(403).json({ error: 'You are not authorized to sign this evidence manifest.' });
      return;
    }

    const enc = db
      .prepare('SELECT aes_algorithm, rsa_algorithm FROM encryption_metadata WHERE evidence_id = ?')
      .get(item.id) as { aes_algorithm: string; rsa_algorithm: string } | undefined;

    const manifestJson = buildCanonicalManifest({
      evidenceId: item.id,
      caseId: item.case_id,
      originalFilename: item.original_filename,
      fileSize: item.file_size,
      mimeType: item.mime_type,
      sha256Hash: item.sha256_hash,
      uploadedBy: item.uploaded_by,
      uploadedAt: item.uploaded_at,
      encryptionAlgorithm: enc ? `${enc.aes_algorithm} + ${enc.rsa_algorithm}` : 'AES-256-GCM + RSA-OAEP-SHA256',
    });

    const signatureB64 = signManifest(manifestJson, keys.signingKeys.privateKeyPem);
    const verifiedImmediately = verifyManifestSignature(
      manifestJson,
      signatureB64,
      keys.signingKeys.publicKeyPem
    );
    if (!verifiedImmediately) {
      res.status(500).json({ error: 'Generated signature failed self-verification.' });
      return;
    }

    const signedAt = new Date().toISOString();
    const signatureId = crypto.randomUUID();

    db.transaction(() => {
      db.prepare(
        `INSERT INTO digital_signatures (
          id, evidence_id, signer_id, algorithm, manifest_json, signature_b64, public_key_pem, key_fingerprint, signed_at, last_verified_at, last_verification_result
        ) VALUES (?, ?, ?, 'RSA-PSS-SHA256', ?, ?, ?, ?, ?, ?, 'VALID')`
      ).run(
        signatureId,
        item.id,
        req.user!.id,
        manifestJson,
        signatureB64,
        keys.signingKeys.publicKeyPem,
        keys.signingKeys.fingerprint,
        signedAt,
        signedAt
      );

      db.prepare("UPDATE evidence SET signature_status = 'VALID' WHERE id = ?").run(item.id);

      appendCustodyEvent(db, {
        evidenceId: item.id,
        userId: req.user!.id,
        eventType: 'DIGITAL_SIGNING',
        description: `Canonical evidence manifest signed using RSA-PSS-SHA256 (Key FP: ${keys.signingKeys.fingerprint}).`,
        timestamp: signedAt,
      });

      recordAuditLog(db, {
        userId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        action: 'EVIDENCE_MANIFEST_SIGNED',
        resourceType: 'EVIDENCE',
        resourceId: item.id,
        status: 'SUCCESS',
        ipAddress: getClientIp(req),
        details: `Signed canonical manifest for ${item.evidence_code} with RSA-PSS-SHA256.`,
      });
    })();

    const signatureRecord = db
      .prepare(
        `SELECT ds.*, u.name AS signer_name, u.badge_number AS signer_badge
         FROM digital_signatures ds JOIN users u ON u.id = ds.signer_id
         WHERE ds.id = ?`
      )
      .get(signatureId);

    res.status(201).json({ signature: signatureRecord });
  });

  // Digital Signature Verification (Rebuilds canonical manifest from live DB record & verifies RSA-PSS signature)
  app.post('/api/evidence/:id/verify-signature', auth, (req: AuthenticatedRequest, res: Response) => {
    const id = req.params.id;
    const item = db
      .prepare('SELECT * FROM evidence WHERE id = ? OR evidence_code = ?')
      .get(id, id) as
      | {
          id: string;
          case_id: string;
          evidence_code: string;
          original_filename: string;
          file_size: number;
          mime_type: string;
          sha256_hash: string;
          uploaded_by: string;
          uploaded_at: string;
        }
      | undefined;

    if (!item) {
      res.status(404).json({ error: 'Evidence item not found.' });
      return;
    }
    if (!canAccessCase(db, req.user!, item.case_id)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const latestSig = db
      .prepare('SELECT * FROM digital_signatures WHERE evidence_id = ? ORDER BY signed_at DESC LIMIT 1')
      .get(item.id) as
      | {
          id: string;
          algorithm: string;
          manifest_json: string;
          signature_b64: string;
          public_key_pem: string;
          key_fingerprint: string;
          signed_at: string;
        }
      | undefined;

    if (!latestSig) {
      db.prepare("UPDATE evidence SET signature_status = 'UNAVAILABLE' WHERE id = ?").run(item.id);
      res.json({
        result: 'UNAVAILABLE',
        reason: 'No digital signature exists for this evidence record yet.',
      });
      return;
    }

    const enc = db
      .prepare('SELECT aes_algorithm, rsa_algorithm FROM encryption_metadata WHERE evidence_id = ?')
      .get(item.id) as { aes_algorithm: string; rsa_algorithm: string } | undefined;

    const liveCanonicalManifest = buildCanonicalManifest({
      evidenceId: item.id,
      caseId: item.case_id,
      originalFilename: item.original_filename,
      fileSize: item.file_size,
      mimeType: item.mime_type,
      sha256Hash: item.sha256_hash,
      uploadedBy: item.uploaded_by,
      uploadedAt: item.uploaded_at,
      encryptionAlgorithm: enc ? `${enc.aes_algorithm} + ${enc.rsa_algorithm}` : 'AES-256-GCM + RSA-OAEP-SHA256',
    });

    const manifestMatchesLive = liveCanonicalManifest === latestSig.manifest_json;
    const cryptoValid = verifyManifestSignature(
      liveCanonicalManifest,
      latestSig.signature_b64,
      latestSig.public_key_pem
    );
    const result: 'VALID' | 'INVALID' = manifestMatchesLive && cryptoValid ? 'VALID' : 'INVALID';
    const verifiedAt = new Date().toISOString();

    db.transaction(() => {
      db.prepare(
        'UPDATE digital_signatures SET last_verified_at = ?, last_verification_result = ? WHERE id = ?'
      ).run(verifiedAt, result, latestSig.id);

      db.prepare('UPDATE evidence SET signature_status = ? WHERE id = ?').run(result, item.id);

      appendCustodyEvent(db, {
        evidenceId: item.id,
        userId: req.user!.id,
        eventType: 'SIGNATURE_VERIFICATION',
        description: `RSA-PSS-SHA256 digital signature verification completed: ${result}.`,
        timestamp: verifiedAt,
      });

      recordAuditLog(db, {
        userId: req.user!.id,
        actorEmail: req.user!.email,
        actorRole: req.user!.role,
        action: 'SIGNATURE_VERIFICATION_EXECUTED',
        resourceType: 'EVIDENCE',
        resourceId: item.id,
        status: result === 'VALID' ? 'SUCCESS' : 'WARNING',
        ipAddress: getClientIp(req),
        details: `Verified digital signature for ${item.evidence_code} -> ${result}.`,
      });
    })();

    res.json({
      result,
      verifiedAt,
      algorithm: latestSig.algorithm,
      keyFingerprint: latestSig.key_fingerprint,
      manifestMatchesLive,
      cryptoValid,
    });
  });

  // Chain of Custody
  app.get('/api/custody', auth, (req: AuthenticatedRequest, res: Response) => {
    const evidenceId = String(req.query.evidenceId || '').trim();
    const user = req.user!;
    const params: unknown[] = [];

    let sql = `
      SELECT cc.*, e.evidence_code, e.original_filename, c.case_code, u.name AS actor_name, u.badge_number AS actor_badge
      FROM chain_of_custody cc
      JOIN evidence e ON e.id = cc.evidence_id
      JOIN cases c ON c.id = e.case_id
      JOIN users u ON u.id = cc.user_id
      WHERE 1=1
    `;

    if (user.role !== 'ADMIN') {
      sql += ' AND EXISTS (SELECT 1 FROM case_assignments ca WHERE ca.case_id = e.case_id AND ca.user_id = ?)';
      params.push(user.id);
    }
    if (evidenceId) {
      sql += ' AND (cc.evidence_id = ? OR e.evidence_code = ?)';
      params.push(evidenceId, evidenceId);
    }
    sql += ' ORDER BY cc.id DESC LIMIT 200';

    const events = db.prepare(sql).all(...params);
    res.json({ events });
  });

  app.get('/api/custody/:evidenceId/validate', auth, (req: AuthenticatedRequest, res: Response) => {
    const evidenceId = req.params.evidenceId;
    const evRow = db
      .prepare('SELECT id, case_id, evidence_code FROM evidence WHERE id = ? OR evidence_code = ?')
      .get(evidenceId, evidenceId) as { id: string; case_id: string; evidence_code: string } | undefined;

    if (!evRow) {
      res.status(404).json({ error: 'Evidence item not found.' });
      return;
    }
    if (!canAccessCase(db, req.user!, evRow.case_id)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const events = db
      .prepare(
        `SELECT cc.*, u.name AS actor_name, u.badge_number AS actor_badge
         FROM chain_of_custody cc JOIN users u ON u.id = cc.user_id
         WHERE cc.evidence_id = ? ORDER BY cc.id ASC`
      )
      .all(evRow.id) as Array<{
      id: number;
      evidence_id: string;
      user_id: string;
      event_type: string;
      timestamp: string;
      description: string;
      previous_event_hash: string;
      current_event_hash: string;
      actor_name: string;
      actor_badge: string;
    }>;

    const validation = verifyCustodyChain(events);
    res.json({
      evidenceId: evRow.id,
      evidenceCode: evRow.evidence_code,
      validation,
      events,
    });
  });

  // Audit & Security Logs (ADMIN only)
  app.get('/api/audit', auth, adminOnly, (req: AuthenticatedRequest, res: Response) => {
    const actionFilter = String(req.query.action || '').trim();
    const statusFilter = String(req.query.status || '').trim().toUpperCase();
    const search = String(req.query.search || '').trim().toLowerCase();

    const params: unknown[] = [];
    let sql = 'SELECT * FROM audit_logs WHERE 1=1';

    if (actionFilter) {
      sql += ' AND action = ?';
      params.push(actionFilter);
    }
    if (['SUCCESS', 'FAILURE', 'WARNING'].includes(statusFilter)) {
      sql += ' AND status = ?';
      params.push(statusFilter);
    }
    if (search) {
      sql += ' AND (LOWER(actor_email) LIKE ? OR LOWER(action) LIKE ? OR LOWER(details) LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    sql += ' ORDER BY id DESC LIMIT 200';

    const auditLogs = db.prepare(sql).all(...params);
    const loginAttempts = db
      .prepare('SELECT * FROM login_attempts ORDER BY id DESC LIMIT 50')
      .all();

    const summary = {
      totalEvents: (db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get() as { c: number }).c,
      failedLogins: (
        db.prepare('SELECT COUNT(*) AS c FROM login_attempts WHERE success = 0').get() as { c: number }
      ).c,
      lockedAccounts: (
        db.prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'LOCKED'").get() as { c: number }
      ).c,
      securityWarnings: (
        db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE status IN ('FAILURE', 'WARNING')").get() as {
          c: number;
        }
      ).c,
    };

    res.json({ auditLogs, loginAttempts, summary });
  });

  // Forensic PDF Report Generation
  app.get('/api/reports/:evidenceId/pdf', auth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const evidenceParam = req.params.evidenceId;
      const evRow = db
        .prepare(
          `SELECT e.*, u.name AS uploader_name, u.badge_number AS uploader_badge
           FROM evidence e JOIN users u ON u.id = e.uploaded_by
           WHERE e.id = ? OR e.evidence_code = ?`
        )
        .get(evidenceParam, evidenceParam) as
        | {
            id: string;
            case_id: string;
            evidence_code: string;
            original_filename: string;
            file_size: number;
            mime_type: string;
            sha256_hash: string;
            uploaded_at: string;
            uploader_name: string;
            uploader_badge: string;
            encryption_status: string;
            integrity_status: string;
            signature_status: string;
          }
        | undefined;

      if (!evRow) {
        res.status(404).json({ error: 'Evidence item not found.' });
        return;
      }
      if (!canAccessCase(db, req.user!, evRow.case_id)) {
        res.status(403).json({ error: 'You are not authorized to generate a report for this evidence.' });
        return;
      }

      const caseRecord = db
        .prepare('SELECT case_code, title, description, category, priority, status, created_at FROM cases WHERE id = ?')
        .get(evRow.case_id) as {
        case_code: string;
        title: string;
        description: string;
        category: string;
        priority: string;
        status: string;
        created_at: string;
      };

      const assignedInvestigators = db
        .prepare(
          `SELECT u.name, u.badge_number, u.email
           FROM case_assignments ca JOIN users u ON u.id = ca.user_id
           WHERE ca.case_id = ?`
        )
        .all(evRow.case_id) as Array<{ name: string; badge_number: string; email: string }>;

      const encryption = db
        .prepare(
          'SELECT aes_algorithm, iv_hex, auth_tag_hex, rsa_algorithm, rsa_key_bits, rsa_key_fingerprint, encrypted_size, encrypted_at FROM encryption_metadata WHERE evidence_id = ?'
        )
        .get(evRow.id) as
        | {
            aes_algorithm: string;
            iv_hex: string;
            auth_tag_hex: string;
            rsa_algorithm: string;
            rsa_key_bits: number;
            rsa_key_fingerprint: string;
            encrypted_size: number;
            encrypted_at: string;
          }
        | undefined;

      const latestIntegrity = db
        .prepare(
          `SELECT iv.expected_sha256, iv.calculated_sha256, iv.status, iv.details, iv.verified_at,
                  u.name AS verifier_name, u.badge_number AS verifier_badge
           FROM integrity_verification iv JOIN users u ON u.id = iv.verified_by
           WHERE iv.evidence_id = ? ORDER BY iv.verified_at DESC LIMIT 1`
        )
        .get(evRow.id) as
        | {
            expected_sha256: string;
            calculated_sha256: string;
            status: string;
            details: string;
            verified_at: string;
            verifier_name: string;
            verifier_badge: string;
          }
        | undefined;

      const latestSignature = db
        .prepare(
          `SELECT ds.algorithm, ds.key_fingerprint, ds.signature_b64, ds.signed_at, ds.last_verified_at, ds.last_verification_result,
                  u.name AS signer_name, u.badge_number AS signer_badge
           FROM digital_signatures ds JOIN users u ON u.id = ds.signer_id
           WHERE ds.evidence_id = ? ORDER BY ds.signed_at DESC LIMIT 1`
        )
        .get(evRow.id) as
        | {
            algorithm: string;
            key_fingerprint: string;
            signature_b64: string;
            signed_at: string;
            last_verified_at: string | null;
            last_verification_result: string | null;
            signer_name: string;
            signer_badge: string;
          }
        | undefined;

      const reportId = `RPT-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const generatedAt = new Date().toISOString();

      // Record report generation in custody & audit log before assembling PDF timeline
      db.transaction(() => {
        appendCustodyEvent(db, {
          evidenceId: evRow.id,
          userId: req.user!.id,
          eventType: 'REPORT_GENERATION',
          description: `Forensic PDF report ${reportId} generated by ${req.user!.name} (${req.user!.badgeNumber}).`,
          timestamp: generatedAt,
        });
        recordAuditLog(db, {
          userId: req.user!.id,
          actorEmail: req.user!.email,
          actorRole: req.user!.role,
          action: 'FORENSIC_REPORT_GENERATED',
          resourceType: 'REPORT',
          resourceId: reportId,
          status: 'SUCCESS',
          ipAddress: getClientIp(req),
          details: `Generated PDF forensic report ${reportId} for ${evRow.evidence_code}.`,
        });
      })();

      const custodyEvents = db
        .prepare(
          `SELECT cc.*, u.name AS actor_name, u.badge_number AS actor_badge
           FROM chain_of_custody cc JOIN users u ON u.id = cc.user_id
           WHERE cc.evidence_id = ? ORDER BY cc.id ASC`
        )
        .all(evRow.id) as Array<{
        id: number;
        evidence_id: string;
        user_id: string;
        event_type: string;
        timestamp: string;
        description: string;
        previous_event_hash: string;
        current_event_hash: string;
        actor_name: string;
        actor_badge: string;
      }>;

      const custodyValidation = verifyCustodyChain(custodyEvents);

      const pdfBuffer = await buildForensicReportPdf({
        reportId,
        generatedAt,
        generatedBy: req.user!,
        caseRecord,
        assignedInvestigators,
        evidence: evRow,
        encryption: encryption || null,
        latestIntegrity: latestIntegrity || null,
        latestSignature: latestSignature || null,
        custodyEvents,
        custodyValidation,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="VERITAS_Report_${evRow.evidence_code}.pdf"`
      );
      res.send(pdfBuffer);
    } catch {
      res.status(500).json({ error: 'Failed to generate PDF forensic report.' });
    }
  });

  // Settings & Cryptographic Configuration Overview
  app.get('/api/settings/crypto-info', auth, (req: AuthenticatedRequest, res: Response) => {
    res.json({
      cryptography: {
        symmetricCipher: 'AES-256-GCM (256-bit ephemeral DEK, 96-bit unique IV, 128-bit auth tag)',
        keyWrapping: `RSA-OAEP with SHA-256 (${keys.wrappingKeys.modulusLength}-bit vault key)`,
        wrappingKeyFingerprint: keys.wrappingKeys.fingerprint,
        digitalSignature: `RSA-PSS with SHA-256 (saltLength=32, ${keys.signingKeys.modulusLength}-bit signing key)`,
        signingKeyFingerprint: keys.signingKeys.fingerprint,
        integrityHash: 'SHA-256 (NIST FIPS 180-4)',
        custodyChainModel: 'SHA-256 hash-linked event ledger in SQLite WAL (tamper-evident)',
      },
      sessionPolicy: {
        cookieFlags: 'HttpOnly, SameSite (None on HTTPS / Lax on localhost), 8-hour TTL',
        csrfProtection: 'Session-bound X-CSRF-Token double verification',
        lockoutPolicy: `${MAX_FAILED_LOGINS} consecutive failed logins -> ${LOCKOUT_MINUTES}-minute account lock`,
        maxEvidenceSizeMb: MAX_EVIDENCE_BYTES / (1024 * 1024),
      },
      currentUser: req.user,
    });
  });

  // Integrity & Signature overview lists for dedicated pages
  app.get('/api/integrity/history', auth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const params: unknown[] = [];
    let sql = `
      SELECT iv.*, e.evidence_code, e.original_filename, c.case_code, u.name AS verifier_name, u.badge_number AS verifier_badge
      FROM integrity_verification iv
      JOIN evidence e ON e.id = iv.evidence_id
      JOIN cases c ON c.id = e.case_id
      JOIN users u ON u.id = iv.verified_by
      WHERE 1=1
    `;
    if (user.role !== 'ADMIN') {
      sql += ' AND EXISTS (SELECT 1 FROM case_assignments ca WHERE ca.case_id = e.case_id AND ca.user_id = ?)';
      params.push(user.id);
    }
    sql += ' ORDER BY iv.verified_at DESC LIMIT 100';
    const history = db.prepare(sql).all(...params);
    res.json({ history });
  });

  app.get('/api/signatures/list', auth, (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;
    const params: unknown[] = [];
    let sql = `
      SELECT ds.id, ds.evidence_id, ds.signer_id, ds.algorithm, ds.manifest_json, ds.signature_b64,
             ds.key_fingerprint, ds.signed_at, ds.last_verified_at, ds.last_verification_result,
             e.evidence_code, e.original_filename, e.signature_status, c.case_code,
             u.name AS signer_name, u.badge_number AS signer_badge
      FROM digital_signatures ds
      JOIN evidence e ON e.id = ds.evidence_id
      JOIN cases c ON c.id = e.case_id
      JOIN users u ON u.id = ds.signer_id
      WHERE 1=1
    `;
    if (user.role !== 'ADMIN') {
      sql += ' AND EXISTS (SELECT 1 FROM case_assignments ca WHERE ca.case_id = e.case_id AND ca.user_id = ?)';
      params.push(user.id);
    }
    sql += ' ORDER BY ds.signed_at DESC LIMIT 100';
    const signatures = db.prepare(sql).all(...params);
    res.json({ signatures });
  });

  // Catch-all for unknown /api routes
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });
}
