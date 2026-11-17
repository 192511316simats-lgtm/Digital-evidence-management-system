import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createVeritasServer } from '../server';

class CookieJar {
  private cookies = new Map<string, string>();
  capture(res: Response) {
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const raw of setCookies) {
      const pair = raw.split(';')[0];
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const name = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        if (val === '') {
          this.cookies.delete(name);
        } else {
          this.cookies.set(name, val);
        }
      }
    }
  }
  header(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

test('End-to-end VERITAS backend workflow: setup, auth, RBAC, case, upload, hybrid crypto, verify, sign, custody, audit, PDF', async () => {
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'veritas-e2e-'));
  process.env.VERITAS_DATA_DIR = tmpData;
  const dbPath = path.join(tmpData, 'veritas-test.db');
  const keysDir = path.join(tmpData, 'keys');

  const { app, db } = await createVeritasServer({ dbPath, keysDir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Health reports setupRequired = true
    const health1 = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
    assert.equal(health1.setupRequired, true);

    // 2. Protected route rejects unauthenticated user
    const unauthCases = await fetch(`${baseUrl}/api/cases`);
    assert.equal(unauthCases.status, 401);

    // 3. Initial Admin Setup
    const setupRes = await fetch(`${baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'K. Divya',
        email: 'divya.admin@veritas.gov',
        badgeNumber: 'ADM-001',
        department: 'Digital Forensics',
        password: 'AdminPassword!123',
        confirmPassword: 'AdminPassword!123',
      }),
    });
    assert.equal(setupRes.status, 201);

    // Duplicate admin setup must fail
    const dupSetupRes = await fetch(`${baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Rogue Admin',
        email: 'rogue@veritas.gov',
        badgeNumber: 'ADM-999',
        department: 'Digital Forensics',
        password: 'AdminPassword!123',
        confirmPassword: 'AdminPassword!123',
      }),
    });
    assert.equal(dupSetupRes.status, 403);

    // 4. Invalid login rejected
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'divya.admin@veritas.gov',
        password: 'WrongPassword',
      }),
    });
    assert.equal(badLogin.status, 401);

    // 5. Valid Admin login
    const adminJar = new CookieJar();
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'divya.admin@veritas.gov',
        password: 'AdminPassword!123',
      }),
    });
    assert.equal(adminLoginRes.status, 200);
    adminJar.capture(adminLoginRes);
    const adminLoginData = await adminLoginRes.json();
    assert.equal(adminLoginData.user.role, 'ADMIN');
    const adminCsrf = adminLoginData.csrfToken;

    // 6. Create Investigator
    const createInvRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminJar.header(),
        'X-CSRF-Token': adminCsrf,
      },
      body: JSON.stringify({
        name: 'A. Sharma',
        email: 'sharma.inv@veritas.gov',
        badgeNumber: 'INV-104',
        department: 'Digital Forensics',
        role: 'INVESTIGATOR',
        password: 'InvPassword!123',
      }),
    });
    assert.equal(createInvRes.status, 201);
    const { user: investigator } = await createInvRes.json();

    // 7. Create Investigation Case & Assign Investigator
    const createCaseRes = await fetch(`${baseUrl}/api/cases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminJar.header(),
        'X-CSRF-Token': adminCsrf,
      },
      body: JSON.stringify({
        title: 'Unauthorized Financial Server Exfiltration',
        description: 'Packet captures and server authentication logs from core banking node.',
        category: 'Network Intrusion',
        priority: 'CRITICAL',
        status: 'ACTIVE',
      }),
    });
    assert.equal(createCaseRes.status, 201);
    const { caseRecord } = await createCaseRes.json();

    const assignRes = await fetch(`${baseUrl}/api/cases/${caseRecord.id}/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminJar.header(),
        'X-CSRF-Token': adminCsrf,
      },
      body: JSON.stringify({ userId: investigator.id }),
    });
    assert.equal(assignRes.status, 201);

    // 8. Investigator logs in & verifies RBAC blocks admin-only endpoints
    const invJar = new CookieJar();
    const invLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'sharma.inv@veritas.gov',
        password: 'InvPassword!123',
      }),
    });
    assert.equal(invLoginRes.status, 200);
    invJar.capture(invLoginRes);
    const invLoginData = await invLoginRes.json();
    const invCsrf = invLoginData.csrfToken;

    const invAuditAttempt = await fetch(`${baseUrl}/api/audit`, {
      headers: { Cookie: invJar.header() },
    });
    assert.equal(invAuditAttempt.status, 403);

    // 9. Investigator acquires evidence file
    const samplePayload = '2026-11-17T08:12:44Z SSHD ACCEPTED root from 198.51.100.42\n';
    const form = new FormData();
    form.append('caseId', caseRecord.id);
    form.append('notes', 'Primary auth log snapshot from gateway.');
    form.append('file', new Blob([samplePayload], { type: 'text/plain' }), 'gateway_auth.log');

    const acqRes = await fetch(`${baseUrl}/api/evidence/acquire`, {
      method: 'POST',
      headers: {
        Cookie: invJar.header(),
        'X-CSRF-Token': invCsrf,
      },
      body: form,
    });
    assert.equal(acqRes.status, 201);
    const { evidence, encryptionMetadata } = await acqRes.json();
    assert.equal(evidence.encryption_status, 'ENCRYPTED');
    assert.equal(encryptionMetadata.aes_algorithm, 'AES-256-GCM');
    assert.equal(encryptionMetadata.rsa_algorithm, 'RSA-OAEP-SHA256');

    // 10. Integrity verification returns INTEGRITY VERIFIED
    const verifyIntRes = await fetch(`${baseUrl}/api/evidence/${evidence.id}/verify-integrity`, {
      method: 'POST',
      headers: { Cookie: invJar.header(), 'X-CSRF-Token': invCsrf },
    });
    assert.equal(verifyIntRes.status, 200);
    const { verification } = await verifyIntRes.json();
    assert.equal(verification.status, 'INTEGRITY VERIFIED');
    assert.equal(verification.expected_sha256, verification.calculated_sha256);

    // 11. Sign manifest & Verify digital signature
    const signRes = await fetch(`${baseUrl}/api/evidence/${evidence.id}/sign`, {
      method: 'POST',
      headers: { Cookie: invJar.header(), 'X-CSRF-Token': invCsrf },
    });
    assert.equal(signRes.status, 201);

    const verifySigRes = await fetch(`${baseUrl}/api/evidence/${evidence.id}/verify-signature`, {
      method: 'POST',
      headers: { Cookie: invJar.header(), 'X-CSRF-Token': invCsrf },
    });
    assert.equal(verifySigRes.status, 200);
    const sigVerifyData = await verifySigRes.json();
    assert.equal(sigVerifyData.result, 'VALID');

    // 12. Decryption returns exact original bytes
    const decRes = await fetch(`${baseUrl}/api/evidence/${evidence.id}/decrypt`, {
      headers: { Cookie: invJar.header() },
    });
    assert.equal(decRes.status, 200);
    const decText = await decRes.text();
    assert.equal(decText, samplePayload);

    // 13. Chain of custody validation returns valid = true
    const custodyRes = await fetch(`${baseUrl}/api/custody/${evidence.id}/validate`, {
      headers: { Cookie: invJar.header() },
    });
    assert.equal(custodyRes.status, 200);
    const custodyData = await custodyRes.json();
    assert.equal(custodyData.validation.valid, true);
    assert.ok(custodyData.validation.totalEvents >= 6);

    // 14. PDF Report generation returns valid %PDF bytes
    const pdfRes = await fetch(`${baseUrl}/api/reports/${evidence.id}/pdf`, {
      headers: { Cookie: invJar.header() },
    });
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
    const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
    assert.equal(pdfBytes.subarray(0, 4).toString('ascii'), '%PDF');

    // 15. Tampered vault file detection produces VERIFICATION FAILED / MISMATCH
    const vaultFile = path.join(tmpData, 'vault', evidence.safe_storage_name);
    const origEnc = fs.readFileSync(vaultFile);
    origEnc[0] = origEnc[0] ^ 0xff;
    fs.writeFileSync(vaultFile, origEnc);

    const tamperCheckRes = await fetch(`${baseUrl}/api/evidence/${evidence.id}/verify-integrity`, {
      method: 'POST',
      headers: { Cookie: invJar.header(), 'X-CSRF-Token': invCsrf },
    });
    assert.equal(tamperCheckRes.status, 200);
    const tamperData = await tamperCheckRes.json();
    assert.equal(tamperData.verification.status, 'VERIFICATION FAILED');

    // 16. Admin audit logs contain recorded security and forensic actions
    const auditRes = await fetch(`${baseUrl}/api/audit`, {
      headers: { Cookie: adminJar.header() },
    });
    assert.equal(auditRes.status, 200);
    const auditData = await auditRes.json();
    assert.ok(auditData.auditLogs.length >= 8);

    // 17. Logout invalidates session
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: invJar.header(), 'X-CSRF-Token': invCsrf },
    });
    assert.equal(logoutRes.status, 200);
    const afterLogoutMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: invJar.header() },
    });
    assert.equal(afterLogoutMe.status, 401);

    // 18. Cookie-blocked iframe fallback (Bearer session token + CSRF check + logout revocation)
    assert.ok(adminLoginData.sessionToken);
    const bearerHealth = await fetch(`${baseUrl}/api/health`, {
      headers: { Authorization: `Bearer ${adminLoginData.sessionToken}` },
    }).then((r) => r.json());
    assert.equal(bearerHealth.authenticated, true);

    const bearerMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminLoginData.sessionToken}` },
    });
    assert.equal(bearerMe.status, 200);

    const bearerLogout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminLoginData.sessionToken}`,
        'X-CSRF-Token': adminCsrf,
      },
    });
    assert.equal(bearerLogout.status, 200);
    const afterBearerLogout = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminLoginData.sessionToken}` },
    });
    assert.equal(afterBearerLogout.status, 401);
  } finally {
    server.closeAllConnections?.();
    server.close();
    db.close();
    fs.rmSync(tmpData, { recursive: true, force: true });
  }
});
