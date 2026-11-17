import crypto from 'node:crypto';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import type Database from 'better-sqlite3';
import { computeSha256Hex } from './crypto';
import { recordAuditLog } from './db';

export const SESSION_COOKIE_NAME = 'veritas_session';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024; // 25 MB

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  badgeNumber: string;
  department: string;
  role: 'ADMIN' | 'INVESTIGATOR';
  status: 'ACTIVE' | 'LOCKED' | 'DISABLED';
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  sessionId?: string;
  csrfToken?: string;
}

export function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

export function isHttpsRequest(req: Request): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return req.secure || proto.split(',')[0].trim() === 'https';
}

export function extractSessionToken(req: Request): string | null {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer.length > 0) return bearer;
  }
  return null;
}

export function setSessionCookie(res: Response, req: Request, rawToken: string): void {
  const https = isHttpsRequest(req);
  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: https,
    sameSite: https ? 'none' : 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response, req: Request): void {
  const https = isHttpsRequest(req);
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: https,
    sameSite: https ? 'none' : 'lax',
    path: '/',
  });
}

export function sanitizeFilename(originalName: string): string {
  const base = path.basename(originalName || 'evidence.bin').replace(/[\x00-\x1f\x7f]/g, '');
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.slice(0, 180) || 'evidence.bin';
}

export function resolveVaultFilePath(vaultDir: string, safeStorageName: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(safeStorageName) || safeStorageName.includes('..')) {
    throw new Error('Invalid vault storage identifier');
  }
  const resolvedVault = path.resolve(vaultDir);
  const resolvedTarget = path.resolve(resolvedVault, safeStorageName);
  if (!resolvedTarget.startsWith(resolvedVault + path.sep)) {
    throw new Error('Path traversal attempt blocked');
  }
  return resolvedTarget;
}

const ALLOWED_MIME_PREFIXES = ['image/', 'audio/', 'video/', 'text/'];
const ALLOWED_EXACT_MIMES = new Set([
  'application/pdf',
  'application/json',
  'application/xml',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  'application/vnd.tcpdump.pcap',
  'message/rfc822',
]);
const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.tiff',
  '.txt',
  '.log',
  '.csv',
  '.json',
  '.xml',
  '.md',
  '.eml',
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a',
  '.mp4',
  '.webm',
  '.mov',
  '.pcap',
  '.pcapng',
  '.zip',
]);

export function validateEvidenceFile(filename: string, mimeType: string, size: number): {
  valid: boolean;
  reason?: string;
} {
  if (size <= 0) {
    return { valid: false, reason: 'Uploaded evidence file is empty (0 bytes).' };
  }
  if (size > MAX_EVIDENCE_BYTES) {
    return { valid: false, reason: 'Evidence file exceeds the 25 MB vault limit.' };
  }
  const ext = path.extname(filename).toLowerCase();
  const mimeLower = (mimeType || '').toLowerCase();
  const mimeAllowed =
    ALLOWED_EXACT_MIMES.has(mimeLower) ||
    ALLOWED_MIME_PREFIXES.some((prefix) => mimeLower.startsWith(prefix));

  if (!ALLOWED_EXTENSIONS.has(ext) && !mimeAllowed) {
    return {
      valid: false,
      reason: `Unsupported file format (${ext || mimeType || 'unknown'}). Allowed: PDF, images, text/logs, audio, video, PCAP, EML, ZIP.`,
    };
  }
  return { valid: true };
}

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts from this network address. Please wait before trying again.',
  },
});

export function createSessionAuthMiddleware(db: Database.Database) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const rawToken = extractSessionToken(req);
    if (!rawToken) {
      res.status(401).json({ error: 'Authentication required. Please log in.' });
      return;
    }

    const tokenHash = computeSha256Hex(rawToken);
    const row = db
      .prepare(
        `SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.revoked_at,
                u.id AS user_id, u.name, u.email, u.badge_number, u.department, u.role, u.status
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .get(tokenHash) as
      | {
          session_id: string;
          csrf_token: string;
          expires_at: string;
          revoked_at: string | null;
          user_id: string;
          name: string;
          email: string;
          badge_number: string;
          department: string;
          role: 'ADMIN' | 'INVESTIGATOR';
          status: 'ACTIVE' | 'LOCKED' | 'DISABLED';
        }
      | undefined;

    if (!row || row.revoked_at) {
      clearSessionCookie(res, req);
      res.status(401).json({ error: 'Session is invalid or has been terminated.' });
      return;
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        row.session_id
      );
      clearSessionCookie(res, req);
      res.status(401).json({ error: 'Session expired. Please authenticate again.' });
      return;
    }

    if (row.status !== 'ACTIVE') {
      clearSessionCookie(res, req);
      res.status(403).json({ error: `Account is currently ${row.status}. Contact an administrator.` });
      return;
    }

    // Verify CSRF token on state-changing requests
    const method = req.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const providedCsrf = req.headers['x-csrf-token'];
      if (
        typeof providedCsrf !== 'string' ||
        providedCsrf.length === 0 ||
        providedCsrf.length !== row.csrf_token.length ||
        !crypto.timingSafeEqual(Buffer.from(providedCsrf), Buffer.from(row.csrf_token))
      ) {
        recordAuditLog(db, {
          userId: row.user_id,
          actorEmail: row.email,
          actorRole: row.role,
          action: 'CSRF_VALIDATION_FAILED',
          resourceType: 'SECURITY',
          status: 'WARNING',
          ipAddress: getClientIp(req),
          details: `Blocked ${method} ${req.originalUrl} due to invalid or missing CSRF token.`,
        });
        res.status(403).json({ error: 'Security validation failed (invalid CSRF token).' });
        return;
      }
    }

    req.user = {
      id: row.user_id,
      name: row.name,
      email: row.email,
      badgeNumber: row.badge_number,
      department: row.department,
      role: row.role,
      status: row.status,
    };
    req.sessionId = row.session_id;
    req.csrfToken = row.csrf_token;
    next();
  };
}

export function requireRole(db: Database.Database, roles: Array<'ADMIN' | 'INVESTIGATOR'>) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      recordAuditLog(db, {
        userId: req.user.id,
        actorEmail: req.user.email,
        actorRole: req.user.role,
        action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        resourceType: 'AUTHORIZATION',
        status: 'WARNING',
        ipAddress: getClientIp(req),
        details: `Role ${req.user.role} attempted to access ${req.method} ${req.originalUrl}.`,
      });
      res.status(403).json({ error: 'Insufficient permissions for this operation.' });
      return;
    }
    next();
  };
}

export function canAccessCase(
  db: Database.Database,
  user: AuthenticatedUser,
  caseId: string
): boolean {
  if (user.role === 'ADMIN') return true;
  const assigned = db
    .prepare('SELECT 1 FROM case_assignments WHERE case_id = ? AND user_id = ?')
    .get(caseId, user.id);
  return Boolean(assigned);
}
