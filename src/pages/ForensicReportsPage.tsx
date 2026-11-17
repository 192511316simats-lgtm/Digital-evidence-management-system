import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { StatusLabel } from '../components/StatusLabel';
import { apiDownload, apiRequest, formatBytes, formatTimestamp } from '../lib/api';
import type { EvidenceRecord } from '../types';

export function ForensicReportsPage() {
  const [evidenceList, setEvidenceList] = useState<EvidenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ evidence: EvidenceRecord[] }>('/api/evidence')
      .then((res) => setEvidenceList(res.evidence))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load evidence items.'))
      .finally(() => setLoading(false));
  }, []);

  const handleDownloadReport = async (ev: EvidenceRecord) => {
    setDownloadingId(ev.id);
    setError(null);
    setFeedback(null);
    try {
      await apiDownload(`/api/reports/${ev.id}/pdf`, `VERITAS_Report_${ev.evidence_code}.pdf`);
      setFeedback(`Generated and downloaded PDF forensic report for ${ev.evidence_code}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate PDF report.');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <AppShell title="Forensic Reports" breadcrumb="VERITAS / Official Documentation">
      {error && (
        <div role="alert" className="mb-5 p-4 bg-[#FDF1F1] border border-[#E9BEBE] rounded-[4px] text-xs text-[#8E2A2A]">
          {error}
        </div>
      )}
      {feedback && (
        <div className="mb-5 p-4 bg-[#EDF3EE] border border-[#B8CEBD] rounded-[4px] text-xs text-[#2F5237]">
          {feedback}
        </div>
      )}

      <div className="bg-white border border-[#E4E5DF] rounded-[4px] p-5 mb-6">
        <h2 className="text-sm font-semibold text-[#252A27]">Database-Verified PDF Forensic Reports</h2>
        <p className="mt-1 text-xs text-[#777D77] leading-relaxed">
          Each PDF report is compiled directly from persisted SQLite records: case details, original SHA-256 digest, AES-256-GCM &amp; RSA-OAEP encryption metadata, latest integrity verification verdict, RSA-PSS digital signature status, and full hash-linked chain of custody history.
        </p>
      </div>

      <div className="bg-white border border-[#E4E5DF] rounded-[4px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E4E5DF] bg-[#FAF9F6] text-[11px] font-semibold text-[#777D77] uppercase">
                <th className="py-3 px-4">Evidence ID</th>
                <th className="py-3 px-4">Artifact & Case</th>
                <th className="py-3 px-4">Encryption</th>
                <th className="py-3 px-4">Integrity Check</th>
                <th className="py-3 px-4">Digital Signature</th>
                <th className="py-3 px-4">Acquired</th>
                <th className="py-3 px-4 text-right">PDF Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E5DF] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 px-4 text-center text-[#777D77]">
                    Loading authorized evidence artifacts...
                  </td>
                </tr>
              ) : evidenceList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 px-4 text-center text-[#777D77]">
                    No evidence records available to report. Acquire evidence first.
                  </td>
                </tr>
              ) : (
                evidenceList.map((ev) => (
                  <tr key={ev.id} className="hover:bg-[#FAF9F6]">
                    <td className="py-3 px-4 font-mono font-semibold whitespace-nowrap">
                      <Link to={`/evidence/${ev.id}`} className="text-[#536B58] hover:underline">
                        {ev.evidence_code}
                      </Link>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-[#252A27] truncate max-w-[200px]">{ev.original_filename}</div>
                      <div className="font-mono text-[11px] text-[#777D77]">
                        {ev.case_code} · {formatBytes(ev.file_size)}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <StatusLabel value={ev.encryption_status} />
                    </td>
                    <td className="py-3 px-4">
                      <StatusLabel value={ev.integrity_status} />
                    </td>
                    <td className="py-3 px-4">
                      <StatusLabel value={ev.signature_status} />
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-[#777D77] whitespace-nowrap">
                      {formatTimestamp(ev.uploaded_at)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={downloadingId === ev.id}
                        onClick={() => handleDownloadReport(ev)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#536B58] hover:bg-[#465B4B] disabled:opacity-50 rounded-[4px] cursor-pointer"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        <span>{downloadingId === ev.id ? 'Generating...' : 'Download PDF'}</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
