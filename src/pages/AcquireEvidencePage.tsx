import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Lock, Upload } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { StatusLabel } from '../components/StatusLabel';
import { apiRequest, formatBytes, getCsrfToken, getFallbackSessionToken } from '../lib/api';
import type { CaseRecord, EncryptionMetadata, EvidenceRecord } from '../types';

export function AcquireEvidencePage() {
  const [searchParams] = useSearchParams();
  const initialCaseId = searchParams.get('caseId') || '';

  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [caseId, setCaseId] = useState(initialCaseId);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<{
    evidence: EvidenceRecord;
    encryptionMetadata: EncryptionMetadata;
  } | null>(null);

  useEffect(() => {
    apiRequest<{ cases: CaseRecord[] }>('/api/cases')
      .then((res) => {
        setCases(res.cases);
        if (!caseId && res.cases.length > 0) {
          setCaseId(res.cases[0].id);
        }
      })
      .catch(() => {});
  }, [caseId]);

  const handleUpload = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!caseId) {
      setError('Select an authorized investigation case.');
      return;
    }
    if (!file) {
      setError('Select an evidence file to acquire.');
      return;
    }

    const formData = new FormData();
    formData.append('caseId', caseId);
    formData.append('notes', notes.trim());
    formData.append('file', file);

    setUploading(true);
    setProgress(0);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/evidence/acquire', true);
    xhr.withCredentials = true;
    const csrf = getCsrfToken();
    if (csrf) {
      xhr.setRequestHeader('X-CSRF-Token', csrf);
    }
    const bearer = getFallbackSessionToken();
    if (bearer) {
      xhr.setRequestHeader('Authorization', `Bearer ${bearer}`);
    }

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };

    xhr.onload = () => {
      setUploading(false);
      try {
        const parsed = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          setResult(parsed);
          setFile(null);
          setNotes('');
        } else {
          setError(parsed.error || `Acquisition failed with status ${xhr.status}`);
        }
      } catch {
        setError('Unexpected response from evidence acquisition endpoint.');
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setError('Network error during encrypted evidence upload.');
    };

    xhr.send(formData);
  };

  return (
    <AppShell title="Acquire Digital Evidence" breadcrumb="VERITAS / Evidence Acquisition">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-white border border-[#E4E5DF] rounded-[4px] p-6">
          <div className="pb-4 mb-5 border-b border-[#E4E5DF]">
            <h2 className="text-base font-semibold text-[#252A27]">
              Cryptographic Evidence Ingestion
            </h2>
            <p className="mt-1 text-xs text-[#777D77]">
              Uploaded artifacts are hashed (SHA-256), encrypted with an ephemeral 256-bit AES-GCM key, wrapped via RSA-OAEP-3072, and stored in the isolated backend vault.
            </p>
          </div>

          {error && (
            <div role="alert" className="mb-5 p-3 bg-[#FDF1F1] border border-[#E9BEBE] rounded-[4px] text-xs text-[#8E2A2A]">
              {error}
            </div>
          )}

          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label htmlFor="acq-case" className="block text-xs font-semibold text-[#252A27] mb-1.5">
                Target Investigation Case
              </label>
              <select
                id="acq-case"
                required
                value={caseId}
                onChange={(e) => setCaseId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
              >
                <option value="">Select case...</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.case_code} — {c.title}
                  </option>
                ))}
              </select>
              {cases.length === 0 && (
                <p className="mt-1.5 text-xs text-[#7A5922]">
                  No authorized cases available. An administrator must create a case and assign you to it first.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="acq-file" className="block text-xs font-semibold text-[#252A27] mb-1.5">
                Evidence File (PDF, Images, Text/Logs, Audio, Video, PCAP, ZIP · Max 25 MB)
              </label>
              <div className="border border-dashed border-[#C7C9C0] bg-[#FAF9F6] rounded-[4px] p-5 text-center">
                <input
                  id="acq-file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff,.txt,.log,.csv,.json,.xml,.md,.eml,.mp3,.wav,.ogg,.m4a,.mp4,.webm,.mov,.pcap,.pcapng,.zip"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-[#4A504C] file:mr-4 file:py-2 file:px-4 file:rounded-[4px] file:border file:border-[#D4D6CE] file:text-xs file:font-semibold file:bg-white file:text-[#252A27] hover:file:bg-[#F5F4EF]"
                />
                {file && (
                  <div className="mt-3 text-xs font-mono text-[#536B58]">
                    Selected: {file.name} ({formatBytes(file.size)}) · {file.type || 'application/octet-stream'}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="acq-notes" className="block text-xs font-semibold text-[#252A27] mb-1.5">
                Acquisition Chain Notes
              </label>
              <textarea
                id="acq-notes"
                rows={3}
                placeholder="Document seizure source, host machine, or collection method..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#D4D6CE] rounded-[4px] focus:outline-none focus:border-[#536B58]"
              />
            </div>

            {uploading && (
              <div>
                <div className="flex justify-between text-xs font-mono text-[#777D77] mb-1">
                  <span>Encrypting & transferring to vault...</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full h-2 bg-[#E4E5DF] rounded-[2px] overflow-hidden">
                  <div
                    className="h-full bg-[#536B58] transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={uploading || cases.length === 0}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] disabled:opacity-50 rounded-[4px] cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>{uploading ? 'Acquiring & Encrypting...' : 'Acquire & Encrypt Evidence'}</span>
              </button>
            </div>
          </form>
        </section>

        {/* Workflow Pipeline & Live Result */}
        <aside className="space-y-6">
          <div className="bg-white border border-[#E4E5DF] rounded-[4px] p-5">
            <h3 className="text-sm font-semibold text-[#252A27] pb-3 border-b border-[#E4E5DF]">
              Cryptographic Pipeline
            </h3>
            <ol className="mt-3 space-y-2.5 text-xs text-[#4A504C]">
              <li>1. Validate MIME type, extension & 25 MB limit</li>
              <li>2. Compute original SHA-256 acquisition digest</li>
              <li>3. Generate random 256-bit AES key & 96-bit GCM nonce</li>
              <li>4. Encrypt evidence payload with AAD binding</li>
              <li>5. Wrap AES key with RSA-OAEP-3072 (SHA-256)</li>
              <li>6. Write ciphertext to protected vault & record custody</li>
            </ol>
          </div>

          {result && (
            <div className="bg-white border border-[#B8CEBD] rounded-[4px] p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#2F5237]">
                <CheckCircle2 className="w-4 h-4" />
                <span>Acquisition & Encryption Complete</span>
              </div>
              <dl className="mt-4 space-y-2.5 text-xs">
                <div>
                  <dt className="text-[#777D77]">Evidence ID</dt>
                  <dd className="font-mono font-semibold text-[#252A27]">{result.evidence.evidence_code}</dd>
                </div>
                <div>
                  <dt className="text-[#777D77]">Original SHA-256</dt>
                  <dd className="font-mono text-[11px] break-all text-[#252A27]">{result.evidence.sha256_hash}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-[#777D77]">Encryption Status</dt>
                  <dd>
                    <StatusLabel value={result.evidence.encryption_status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-[#777D77]">Algorithms</dt>
                  <dd className="font-mono text-[11px] text-[#252A27]">
                    {result.encryptionMetadata.aes_algorithm} + {result.encryptionMetadata.rsa_algorithm} ({result.encryptionMetadata.rsa_key_bits}-bit)
                  </dd>
                </div>
                <div>
                  <dt className="text-[#777D77]">GCM IV (Hex)</dt>
                  <dd className="font-mono text-[11px] break-all text-[#4A504C]">{result.encryptionMetadata.iv_hex}</dd>
                </div>
              </dl>

              <div className="mt-4 pt-3 border-t border-[#E4E5DF]">
                <Link
                  to={`/evidence/${result.evidence.id}`}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#202522] hover:bg-[#323A35] rounded-[4px]"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Open Evidence Dossier</span>
                </Link>
              </div>
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
