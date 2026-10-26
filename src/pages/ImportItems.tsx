import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCheck, ClipboardList, Download, FileSpreadsheet,
  FileText, History, RotateCcw, Search, ShieldCheck, Trash2, Upload, X
} from 'lucide-react';
import {
  PageHeader, Card, Button, Modal, Field, Input, Select, Textarea, EmptyState, Badge,
  SearchInput, Pager, Checkbox, ConfirmDialog
} from '../components/ui';
import { useApp } from '../state/AppContext';
import { dbAll } from '../lib/db';
import { bump } from '../lib/bus';
import { partCategories, listSuppliers } from '../lib/queries';
import { downloadCsv } from '../lib/csv';
import { formatBytes } from '../lib/money';
import { buildIndex, validateAll, type ExistingIndex } from '../lib/import/validate';
import {
  assignMissingSkus, draftsFromSources, parseInventoryFile, reviewCategories, summarise,
  type CategoryReview, type ParsedFile
} from '../lib/import/pipeline';
import { applyImport } from '../lib/import/apply';
import { listImports } from '../lib/import/history';
import { mapHeaders, fieldsInMapping } from '../lib/import/mapping';
import {
  FIELD_KEYS, FIELD_LABELS, MAX_FILE_BYTES, MAX_ROWS, REVIEW_PAGE_SIZE, REQUIRED_FIELDS,
  type ColumnMapping, type DraftItem, type FieldKey, type ImportHistoryEntry, type ImportReport,
  type SourceTable
} from '../lib/import/types';
import type { Part, Supplier } from '../lib/types';

type Phase = 'upload' | 'mapping' | 'review' | 'result';
type Filter = 'all' | 'attention' | 'selected' | 'duplicates' | 'removed';

interface PlanSource {
  file: ParsedFile;
  tableIndex: number;
  table: SourceTable;
  mapping: ColumnMapping;
  confidence: number;
}

const ACCEPT = '.pdf,.csv,.tsv,.txt,.xlsx';

export default function ImportItems() {
  const { settings, user, toast } = useApp();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('upload');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [sources, setSources] = useState<PlanSource[]>([]);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [draftsMeta, setDraftsMeta] = useState<{ blankRows: number }>({ blankRows: 0 });
  const [index, setIndex] = useState<ExistingIndex | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [history, setHistory] = useState<ImportHistoryEntry[]>([]);
  const [priorImport, setPriorImport] = useState<ImportHistoryEntry | null>(null);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [report, setReport] = useState<ImportReport | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fingerprint, setFingerprint] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const loadIndex = useCallback(async () => {
    const [parts, supplierRows, categories] = await Promise.all([
      dbAll<Part>('parts'), listSuppliers(), partCategories()
    ]);
    setSuppliers(supplierRows);
    setIndex(buildIndex(parts, supplierRows, categories));
  }, []);

  useEffect(() => {
    void loadIndex();
    void listImports().then((h) => setHistory(h.slice(0, 3)));
  }, [loadIndex]);

  const ctx = useMemo(() => ({ index: index ?? buildIndex([], [], []), categoryMap }), [index, categoryMap]);

  /* ------------------------------- extraction ------------------------------ */

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setError(null);
    setBusy(true);
    setPhase('upload');
    const parsed: ParsedFile[] = [];
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        if (file.size > MAX_FILE_BYTES) {
          throw new Error(`“${file.name}” is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}.`);
        }
        setProgress({ done: 0, total: 1, label: `Reading ${file.name}` });
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await parseInventoryFile(file.name, bytes, {
          onProgress: (done, total) => setProgress({ done, total, label: `Extracting ${file.name}` })
        });
        parsed.push(result);
      }

      const plans: PlanSource[] = [];
      for (const file of parsed) {
        file.tables.forEach((table, tableIndex) => {
          if (!table.rows.length) return;
          const auto = mapHeaders(table.headers);
          plans.push({ file, tableIndex, table, mapping: auto.mapping, confidence: auto.confidence });
        });
      }
      if (!plans.length) throw new Error('No rows with data were found in the selected file(s).');

      setSources(plans);
      const fp = parsed[0]?.fingerprint ?? '';
      setFingerprint(fp);
      const previous = fp ? (await listImports()).find((h) => h.fingerprint === fp) : undefined;
      setPriorImport(previous ?? null);
      setPhase('mapping');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be read.');
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  /* -------------------------------- drafts -------------------------------- */

  const buildDrafts = () => {
    const { items: drafts, blankRows } = draftsFromSources(
      sources.map((s) => ({ table: s.table, mapping: s.mapping }))
    );
    setDraftsMeta({ blankRows });
    setItems(validateAll(drafts, ctx));
    setPhase('review');
  };

  const revalidate = useCallback((next: DraftItem[]) => validateAll(next, ctx), [ctx]);

  const updateRow = (id: string, field: FieldKey, value: string) => {
    setItems((prev) => {
      const next = prev.map((item) => (item.id === id
        ? { ...item, edited: true, values: { ...item.values, [field]: value } }
        : item));
      const validated = validateAll(next, ctx);
      return validated.map((item) => {
        if (item.id !== id) return item;
        const was = prev.find((p) => p.id === id);
        const wasBlocked = !!was?.issues.some((i) => i.level === 'error');
        const nowBlocked = item.issues.some((i) => i.level === 'error');
        if (wasBlocked && !nowBlocked) return { ...item, selected: true };
        return item;
      });
    });
  };

  const setDecision = (id: string, decision: DraftItem['decision']) => {
    setItems((prev) => prev.map((item) => {
      if (item.id !== id) return item;
      if (decision === 'update' && !item.duplicate) return item;
      return { ...item, decision, selected: decision !== 'skip' };
    }));
  };

  const toggleRow = (id: string, selected: boolean) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, selected } : item)));
  };

  const removeRows = (ids: string[]) => {
    const set = new Set(ids);
    setItems((prev) => prev.map((item) => (set.has(item.id) ? { ...item, removed: true, selected: false } : item)));
  };

  const restoreRows = (ids: string[]) => {
    const set = new Set(ids);
    setItems((prev) => prev.map((item) => {
      if (!set.has(item.id)) return item;
      const restored = { ...item, removed: false };
      return { ...restored, selected: !restored.issues.some((i) => i.level === 'error') };
    }));
  };

  const assignCodes = () => {
    const existing = (index ? Array.from(index.bySku.values()).map((p) => p.sku) : []);
    const { items: next, assigned } = assignMissingSkus(items, existing);
    setItems(revalidate(next));
    toast(assigned ? `${assigned} code${assigned === 1 ? '' : 's'} assigned.` : 'Every row already has a code.');
  };

  /* --------------------------------- apply --------------------------------- */

  const runImport = async () => {
    if (!user || !sources.length) return;
    setConfirmOpen(false);
    setBusy(true);
    setProgress({ done: 0, total: 1, label: 'Saving approved items' });
    try {
      const result = await applyImport(items, { id: user.id, name: user.name, role: user.role }, {
        fileName: sources.map((s) => s.file.fileName).filter((v, i, a) => a.indexOf(v) === i).join(', '),
        kind: sources[0].file.kind,
        fingerprint: fingerprint || 'unknown',
        onProgress: (done, total) => setProgress({ done, total, label: 'Saving approved items' })
      });
      setReport(result);
      setPhase('result');
      await loadIndex();
      setHistory((await listImports()).slice(0, 3));
      bump();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import could not be completed.');
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  const reset = () => {
    setPhase('upload');
    setSources([]);
    setItems([]);
    setReport(null);
    setError(null);
    setCategoryMap({});
    setPriorImport(null);
    setFingerprint('');
  };

  const summary = summarise(items);
  const mappedFields = useMemo(() => new Set(sources.flatMap((s) => fieldsInMapping(s.mapping))), [sources]);
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedFields.has(f));
  const editingItem = items.find((i) => i.id === editing) ?? null;

  return (
    <div className="page">
      <PageHeader title="Bulk import items" subtitle="Bring a supplier price list into inventory from PDF, CSV or Excel — reviewed before anything is saved.">
        <Link to="/inventory" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /> Inventory</Link>
      </PageHeader>

      <ol className="import-steps" aria-label="Import progress">
        {(['Upload', 'Map columns', 'Review', 'Import'] as const).map((label, i) => {
          const order: Phase[] = ['upload', 'mapping', 'review', 'result'];
          const current = order.indexOf(phase);
          const state = i < current ? 'done' : i === current ? 'active' : 'todo';
          return (
            <li key={label} className={`import-step ${state}`}>
              <span className="dot">{state === 'done' ? <Check size={11} /> : i + 1}</span>
              {label}
            </li>
          );
        })}
      </ol>

      {priorImport && phase !== 'result' && (
        <div className="alert alert-warning" role="status" style={{ marginBottom: 12 }}>
          <AlertTriangle size={15} />
          <span>
            This exact file was imported on {new Date(priorImport.at).toLocaleString()} ({priorImport.imported} item
            {priorImport.imported === 1 ? '' : 's'} added). Importing it again overwrites nothing — rows already in inventory are
            detected by barcode, SKU and part number, and skipped unless you explicitly choose “Update existing”.
          </span>
        </div>
      )}

      {error && (
        <div className="alert alert-danger" role="alert" style={{ marginBottom: 12 }}>
          <AlertTriangle size={15} /><span>{error}</span>
        </div>
      )}

      {busy && progress && (
        <Card style={{ marginBottom: 12 }}>
          <div className="flex items-center gap-10" style={{ padding: '4px 2px' }}>
            <span className="spinner" aria-hidden="true" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 650, fontSize: 12.5 }}>{progress.label}</div>
              <div className="progress" style={{ marginTop: 6 }}>
                <span style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
              </div>
            </div>
            <span className="tiny muted mono">{progress.done}/{progress.total}</span>
          </div>
        </Card>
      )}

      {phase === 'upload' && !busy && (
        <UploadStep onFiles={handleFiles} history={history} priorImport={priorImport} maxRows={MAX_ROWS} />
      )}

      {phase === 'mapping' && (
        <MappingStep
          sources={sources}
          suppliers={suppliers}
          missingRequired={missingRequired}
          onMapping={(sourceIndex, column, field) => setSources((prev) => prev.map((source, i) => {
            if (i !== sourceIndex) return source;
            const mapping: ColumnMapping = {};
            for (const [key, value] of Object.entries(source.mapping)) {
              const at = Number(key);
              if (at === column) continue;                 // the column being changed
              if (field && value === field) continue;      // one field, one column
              mapping[at] = value ?? null;
            }
            mapping[column] = field || null;
            return { ...source, mapping };
          }))}
          onBack={reset}
          onContinue={() => { if (missingRequired.length) return; buildDrafts(); }}
        />
      )}

      {phase === 'review' && (
        <ReviewStep
          items={items}
          index={ctx.index}
          currency={settings.profile.currency}
          blankRows={draftsMeta.blankRows}
          summary={summary}
          categoryMap={categoryMap}
          onCategoryMap={(map) => { setCategoryMap(map); setItems((prev) => validateAll(prev, { index: ctx.index, categoryMap: map })); }}
          onUpdate={updateRow}
          onToggle={toggleRow}
          onRemove={removeRows}
          onRestore={restoreRows}
          onDecision={setDecision}
          onAssignCodes={assignCodes}
          onEdit={setEditing}
          onBack={() => setPhase('mapping')}
          onCancel={reset}
          onConfirm={() => setConfirmOpen(true)}
        />
      )}

      {phase === 'result' && report && (
        <ResultStep report={report} onReset={reset} onGoInventory={() => navigate('/inventory')} />
      )}

      {editingItem && (
        <RowEditor
          item={editingItem}
          currency={settings.profile.currency}
          onChange={(field, value) => updateRow(editingItem.id, field, value)}
          onDecision={(d) => setDecision(editingItem.id, d)}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Import these items?"
        confirmLabel={`Import ${summary.selected} item${summary.selected === 1 ? '' : 's'}`}
        busy={busy}
        onClose={() => setConfirmOpen(false)}
        onConfirm={runImport}
        message={(
          <div className="flex-col gap-10">
            <p>
              {summary.creates} item{summary.creates === 1 ? '' : 's'} will be added to inventory
              {summary.updates ? `, ${summary.updates} existing item${summary.updates === 1 ? '' : 's'} updated` : ''}
              {summary.skipped ? `, ${summary.skipped} skipped` : ''}.
            </p>
            {summary.updates > 0 && (
              <p className="tiny muted">Updated items keep their current stock; only prices and descriptive fields change.</p>
            )}
            <p className="tiny muted">Opening stock is recorded as a movement, exactly like a manual entry. Nothing is deleted.</p>
          </div>
        )}
      />
    </div>
  );
}

/* --------------------------------- upload --------------------------------- */

function UploadStep({ onFiles, history, priorImport, maxRows }: {
  onFiles: (files: FileList | File[]) => void;
  history: ImportHistoryEntry[];
  priorImport: ImportHistoryEntry | null;
  maxRows: number;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex-col gap-12">

      <Card>
        <div
          className={`dropzone ${drag ? 'is-drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
          aria-label="Upload inventory files"
        >
          <div className="dropzone-icon"><Upload size={20} /></div>
          <div className="dropzone-title">Drop a price list here, or click to choose files</div>
          <div className="dropzone-sub">PDF, CSV, Excel (.xlsx) or plain text · up to 25 MB per file, {maxRows.toLocaleString()} rows</div>
          <div className="dropzone-formats">
            <span><FileText size={12} /> PDF with a text layer</span>
            <span><FileSpreadsheet size={12} /> CSV / TSV</span>
            <span><ClipboardList size={12} /> Excel .xlsx</span>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ''; }}
        />
        <div className="table-footer" style={{ marginTop: 2 }}>
          <div className="flex items-center gap-8 tiny muted">
            <ShieldCheck size={12} /> Files are read in this browser. Nothing is uploaded, and nothing is saved until you confirm the review.
          </div>
        </div>
      </Card>

      <Card>
        <div className="card-header"><h3>How extraction works</h3></div>
        <div className="card-body small flex-col gap-8" style={{ color: 'var(--text-soft)' }}>
          <p>
            <b>PDF:</b> the text layer is read page by page. Column positions come from the header row, so quantities and prices stay
            under the right headings even when a row has empty cells. Repeated headers, page footers and “Total” lines are skipped.
          </p>
          <p>
            <b>Scanned PDFs</b> (photographs of paper) have no text layer. Optical character recognition is deliberately not
            bundled, so such a file is refused with an explanation instead of being half-imported.
          </p>
          <p className="tiny muted">
            Column mapping is a deterministic synonym match. After extraction you can correct any mapping, edit every value and
            deselect anything that should not be imported.
          </p>
        </div>
      </Card>

      {history.length > 0 && (
        <Card>
          <div className="card-header"><h3><History size={14} className="inline" /> Recent imports</h3></div>
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>When</th><th>File</th><th className="num">Added</th><th className="num">Skipped</th><th className="num">Failed</th><th>By</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="tiny nowrap">{new Date(h.at).toLocaleString()}</td>
                    <td className="tiny truncate" style={{ maxWidth: 260 }}>{h.fileName}</td>
                    <td className="num">{h.imported + h.updated}</td>
                    <td className="num">{h.skipped}</td>
                    <td className="num" style={{ color: h.failed ? 'var(--danger)' : undefined }}>{h.failed}</td>
                    <td className="tiny">{h.userName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* --------------------------------- mapping -------------------------------- */

function MappingStep({ sources, suppliers, missingRequired, onMapping, onBack, onContinue }: {
  sources: PlanSource[];
  suppliers: Supplier[];
  missingRequired: FieldKey[];
  onMapping: (sourceIndex: number, column: number, field: FieldKey | '') => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex-col gap-12">
      <div className="alert alert-info">
        <ClipboardList size={15} />
        <span>
          Check that each source column lands on the right field. <b>Item name</b> and <b>SKU</b> are required; everything else is
          optional and stays empty when the file does not contain it.
        </span>
      </div>

      {sources.map((source, sourceIndex) => {
        const mapped = fieldsInMapping(source.mapping);
        const used = new Set(mapped);
        return (
          <Card key={`${source.file.fileName}-${source.tableIndex}`}>
            <div className="card-header">
              <div>
                <h3>{source.table.sheet ? `${source.file.fileName} · ${source.table.sheet}` : source.file.fileName}</h3>
                <div className="sub">
                  {source.table.rows.length.toLocaleString()} row{source.table.rows.length === 1 ? '' : 's'} · {mapped.length} column{mapped.length === 1 ? '' : 's'} mapped
                  {!source.table.headerFound && ' · no header row recognised'}
                </div>
              </div>
              <div className="flex items-center gap-8">
                <Badge tone={source.confidence > 0.7 ? 'success' : source.confidence > 0.4 ? 'warning' : 'danger'}>
                  {Math.round(source.confidence * 100)}% auto-mapped
                </Badge>
              </div>
            </div>
            {fieldsInMapping(source.mapping).every((f) => f !== 'name' && f !== 'sku' && f !== 'partNumber') && (
              <div className="alert alert-info" style={{ margin: '0 0 10px' }}>
                <ClipboardList size={14} />
                <span>No item name or code column is mapped here, so this sheet will not add any rows.</span>
              </div>
            )}
            {source.table.notes.length > 0 && (
              <div className="alert alert-warning" style={{ margin: '0 0 10px' }}>
                <AlertTriangle size={14} /><span>{source.table.notes.join(' ')}</span>
              </div>
            )}
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th style={{ width: '32%' }}>Source column</th>
                    <th style={{ width: '34%' }}>Imports as</th>
                    <th>First rows in this column</th>
                  </tr>
                </thead>
                <tbody>
                  {source.table.headers.map((header, column) => {
                    const current = source.mapping[column] ?? '';
                    return (
                      <tr key={`${header}-${column}`}>
                        <td style={{ fontWeight: 600 }}>{header}</td>
                        <td>
                          <Select
                            value={current}
                            aria-label={`Map ${header}`}
                            onChange={(e) => onMapping(sourceIndex, column, e.target.value as FieldKey | '')}
                          >
                            <option value="">Do not import</option>
                            {FIELD_KEYS.map((field) => (
                              <option key={field} value={field} disabled={field !== current && used.has(field)}>
                                {FIELD_LABELS[field]}{field !== current && used.has(field) ? ' (already mapped)' : ''}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="tiny muted truncate" style={{ maxWidth: 260 }}>
                          {source.table.rows.slice(0, 2).map((r) => r[column]).filter(Boolean).join(' · ') || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}

      <Card>
        <div className="flex items-center gap-10 wrap">
          <Button onClick={onBack}><ArrowLeft size={14} /> Choose different files</Button>
          <div className="grow" />
          {missingRequired.length > 0 && (
            <span className="tiny" style={{ color: 'var(--danger)' }}>
              Map {missingRequired.map((f) => FIELD_LABELS[f]).join(' and ')} to continue.
            </span>
          )}
          <Button variant="primary" onClick={onContinue} disabled={missingRequired.length > 0}>
            Review {sources.filter((s) => fieldsInMapping(s.mapping).length > 0)
              .reduce((sum, s) => sum + s.table.rows.length, 0).toLocaleString()} rows <ArrowRight size={14} />
          </Button>
        </div>
        <div className="tiny muted" style={{ marginTop: 8 }}>
          {suppliers.length} supplier{suppliers.length === 1 ? '' : 's'} available for matching. Supplier columns are matched by name; unmatched names are left empty and flagged.
        </div>
      </Card>
    </div>
  );
}

/* --------------------------------- review --------------------------------- */

function ReviewStep({ items, index, currency, blankRows, summary, categoryMap, onCategoryMap, onUpdate, onToggle, onRemove, onRestore, onDecision, onAssignCodes, onEdit, onBack, onCancel, onConfirm }: {
  items: DraftItem[];
  index: ExistingIndex;
  currency: string;
  blankRows: number;
  summary: ReturnType<typeof summarise>;
  categoryMap: Record<string, string>;
  onCategoryMap: (map: Record<string, string>) => void;
  onUpdate: (id: string, field: FieldKey, value: string) => void;
  onToggle: (id: string, selected: boolean) => void;
  onRemove: (ids: string[]) => void;
  onRestore: (ids: string[]) => void;
  onDecision: (id: string, decision: DraftItem['decision']) => void;
  onAssignCodes: () => void;
  onEdit: (id: string | null) => void;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const active = items.filter((i) => !i.removed);
  const removed = items.filter((i) => i.removed);
  const missingCodes = active.filter((i) => !(i.values.sku ?? '').trim() && !(i.values.partNumber ?? '').trim() && (i.values.name ?? '').trim()).length;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return active.filter((item) => {
      if (filter === 'attention' && !item.issues.some((i) => i.level !== 'info')) return false;
      if (filter === 'selected' && !item.selected) return false;
      if (filter === 'duplicates' && !item.duplicate) return false;
      if (!term) return true;
      return [item.values.name, item.values.sku, item.values.barcode, item.values.category, item.values.brand]
        .some((v) => (v ?? '').toLowerCase().includes(term));
    });
  }, [active, filter, query]);

  useEffect(() => { setPage(1); }, [filter, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / REVIEW_PAGE_SIZE));
  const current = filtered.slice((page - 1) * REVIEW_PAGE_SIZE, page * REVIEW_PAGE_SIZE);

  const categories = useMemo(() => reviewCategories(active, index.categories), [active, index.categories]);
  const newCategories = categories.filter((c) => !c.existing);

  return (
    <div className="flex-col gap-12">
      <Card>
        <div className="import-summary">
          <SummaryChip label="Rows read" value={items.length} />
          <SummaryChip label="Will be imported" value={summary.selected} tone="success" />
          <SummaryChip label="Duplicates" value={summary.duplicates} tone={summary.duplicates ? 'warning' : undefined} />
          <SummaryChip label="Need attention" value={summary.blocked} tone={summary.blocked ? 'danger' : undefined} />
          <SummaryChip label="Removed" value={summary.removed} />
          {blankRows > 0 && <span className="tiny muted">{blankRows} blank rows skipped</span>}
        </div>
      </Card>

      <Card>
        <div className="table-toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Search name, SKU or barcode…" />
          <div className="segmented" role="tablist" aria-label="Filter rows">
            {([['all', 'All'], ['attention', 'Needs attention'], ['duplicates', 'Duplicates'], ['selected', 'Selected']] as [Filter, string][]).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="grow" />
          <span className="tiny muted">{filtered.length.toLocaleString()} shown</span>
        </div>

        <div className="table-toolbar" style={{ borderTop: 'none', paddingTop: 0 }}>
          <Button size="sm" variant="ghost" onClick={() => filtered.forEach((i) => onToggle(i.id, true))} disabled={!filtered.length}>
            <CheckCheck size={13} /> Select all
          </Button>
          <Button size="sm" variant="ghost" onClick={() => filtered.forEach((i) => onToggle(i.id, false))} disabled={!filtered.length}>
            <X size={13} /> Clear selection
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onRemove(filtered.filter((i) => i.selected).map((i) => i.id))} disabled={!filtered.some((i) => i.selected)}>
            <Trash2 size={13} /> Remove selected
          </Button>
          {missingCodes > 0 && (
            <Button size="sm" variant="secondary" onClick={onAssignCodes} title="Rows with a name but no code get sequential codes visible here">
              Assign codes to {missingCodes}
            </Button>
          )}
          <div className="grow" />
      {removed.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => onRestore(items.filter((i) => i.removed).map((i) => i.id))}>
              <RotateCcw size={13} /> Restore {removed.length} removed
            </Button>
          )}
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={<Search size={18} />} title="Nothing matches this filter" message="Clear the search or choose another filter." />
        ) : (
          <div className="table-wrap">
            <table className="table import-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }} aria-label="Select" />
                  <th style={{ minWidth: 190 }}>Item name</th>
                  <th style={{ width: 118 }}>SKU</th>
                  <th style={{ width: 110 }}>Category</th>
                  <th style={{ width: 56 }}>Unit</th>
                  <th style={{ width: 100 }} className="num">Cost</th>
                  <th style={{ width: 100 }} className="num">Price</th>
                  <th style={{ width: 62 }} className="num">Qty</th>
                  <th style={{ width: 150 }}>Status</th>
                  <th style={{ width: 62 }} />
                </tr>
              </thead>
              <tbody>
                {current.map((item) => (
                  <tr key={item.id} className={!item.selected ? 'row-muted' : undefined}>
                    <td>
                      <Checkbox label="" checked={item.selected} onChange={(v) => onToggle(item.id, v)} />
                    </td>
                    <td>
                      <input
                        className="cell-input"
                        value={item.values.name ?? ''}
                        onChange={(e) => onUpdate(item.id, 'name', e.target.value)}
                        aria-label={`Name for row ${item.sourceRow}`}
                      />
                      {item.values.brand && <div className="tiny muted">{item.values.brand}{item.values.supplier ? ` · ${item.values.supplier}` : ''}</div>}
                    </td>
                    <td>
                      <input
                        className="cell-input mono"
                        value={item.values.sku ?? item.values.partNumber ?? ''}
                        onChange={(e) => onUpdate(item.id, 'sku', e.target.value)}
                        aria-label={`SKU for row ${item.sourceRow}`}
                      />
                    </td>
                    <td><input className="cell-input" value={item.values.category ?? ''} onChange={(e) => onUpdate(item.id, 'category', e.target.value)} aria-label={`Category for row ${item.sourceRow}`} /></td>
                    <td><input className="cell-input" value={item.values.unit ?? ''} onChange={(e) => onUpdate(item.id, 'unit', e.target.value)} aria-label={`Unit for row ${item.sourceRow}`} /></td>
                    <td><input className="cell-input num mono" value={item.values.cost ?? ''} onChange={(e) => onUpdate(item.id, 'cost', e.target.value)} aria-label={`Cost for row ${item.sourceRow}`} inputMode="decimal" /></td>
                    <td><input className="cell-input num mono" value={item.values.price ?? ''} onChange={(e) => onUpdate(item.id, 'price', e.target.value)} aria-label={`Price for row ${item.sourceRow}`} inputMode="decimal" /></td>
                    <td><input className="cell-input num mono" value={item.values.qty ?? ''} onChange={(e) => onUpdate(item.id, 'qty', e.target.value)} aria-label={`Quantity for row ${item.sourceRow}`} inputMode="decimal" /></td>
                    <td>
                      <RowStatus item={item} onDecision={(d) => onDecision(item.id, d)} />
                    </td>
                    <td className="actions">
                      <button className="btn btn-ghost btn-xs" onClick={() => onEdit(item.id)} title="Edit all fields">Edit</button>
                      <button className="btn btn-ghost btn-xs" onClick={() => onRemove([item.id])} title="Remove row" aria-label={`Remove row ${item.sourceRow}`}><X size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="table-footer">
          <span className="tiny muted">
            {currency} prices and stock are copied exactly as shown. Rows can be edited above before anything is written.
          </span>
          <Pager page={page} total={filtered.length} size={REVIEW_PAGE_SIZE} onPage={setPage} />
        </div>
      </Card>

      {newCategories.length > 0 && (
        <Card>
          <div className="card-header">
            <div>
              <h3>Categories ({newCategories.length} new)</h3>
              <div className="sub">Incoming names that do not match an existing category. Keep them, or point them at one you already use.</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setCategoriesOpen((v) => !v)}>
              {categoriesOpen ? 'Hide' : 'Review'}
            </Button>
          </div>
          {categoriesOpen && (
            <div className="table-wrap">
              <table className="table compact">
                <thead><tr><th>From file</th><th className="num">Items</th><th>Import as</th></tr></thead>
                <tbody>
                  {newCategories.map((c: CategoryReview) => (
                    <tr key={c.key}>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td className="num">{c.count}</td>
                      <td>
                        <Select
                          value={categoryMap[c.name] ?? ''}
                          aria-label={`Category ${c.name}`}
                          onChange={(e) => {
                            const next = { ...categoryMap };
                            if (e.target.value) next[c.name] = e.target.value;
                            else delete next[c.name];
                            onCategoryMap(next);
                          }}
                          style={{ maxWidth: 260 }}
                        >
                          <option value="">Keep “{c.name}”</option>
                          {index.categories.map((existing) => (
                            <option key={existing} value={existing}>{existing}{c.suggestion === existing ? ' (suggested)' : ''}</option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {removed.length > 0 && (
        <Card>
          <div className="card-header">
            <div>
              <h3>Removed rows ({removed.length})</h3>
              <div className="sub">Nothing is imported for these. They stay here until you leave the page, so removal is reversible.</div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => onRestore(removed.map((i) => i.id))}><RotateCcw size={13} /> Restore all</Button>
          </div>
          <div className="table-wrap">
            <table className="table compact">
              <tbody>
                {removed.slice(0, 8).map((item) => (
                  <tr key={item.id}>
                    <td className="tiny" style={{ width: 60 }}>#{item.sourceRow}</td>
                    <td>{item.values.name ?? '—'}</td>
                    <td className="tiny muted mono">{item.values.sku ?? item.values.partNumber ?? '—'}</td>
                    <td className="actions"><button className="btn btn-ghost btn-xs" onClick={() => onRestore([item.id])}>Restore</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex items-center gap-10 wrap">
          <Button onClick={onBack}><ArrowLeft size={14} /> Column mapping</Button>
          <Button variant="ghost" onClick={onCancel}>Cancel import</Button>
          <div className="grow" />
          <span className="tiny muted">
            {summary.creates} new · {summary.updates} updated · {summary.skipped} skipped · {summary.blocked} blocked
          </span>
          <Button variant="primary" onClick={onConfirm} disabled={summary.selected === 0}>
            Review &amp; confirm <ArrowRight size={14} />
          </Button>
        </div>
      </Card>
    </div>
  );
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'warning' | 'danger' }) {
  return (
    <div className={`summary-chip ${tone ?? ''}`}>
      <span className="val">{value.toLocaleString()}</span>
      <span className="lbl">{label}</span>
    </div>
  );
}

function RowStatus({ item, onDecision }: { item: DraftItem; onDecision: (d: DraftItem['decision']) => void }) {
  const blocked = item.issues.some((i) => i.level === 'error');
  const warning = item.issues.some((i) => i.level === 'warning');
  const tooltip = item.issues.map((i) => i.message).join('\n');

  if (item.duplicate) {
    return (
      <div className="flex-col gap-4" title={tooltip}>
        <Badge tone={item.duplicate.kind === 'name' ? 'warning' : 'danger'}>
          {item.duplicate.kind === 'name' ? 'Possible duplicate' : 'Duplicate'}
        </Badge>
        <select
          className="cell-select"
          value={item.decision}
          onChange={(e) => onDecision(e.target.value as DraftItem['decision'])}
          aria-label={`Duplicate action for row ${item.sourceRow}`}
        >
          <option value="skip">Skip</option>
          <option value="create">Create anyway</option>
          <option value="update">Update existing</option>
        </select>
      </div>
    );
  }
  if (blocked) {
    return <Badge tone="danger" dot>Needs fixing</Badge>;
  }
  if (warning) {
    return <Badge tone="warning" dot>Check</Badge>;
  }
  return <Badge tone="success" dot>Ready</Badge>;
}

/* -------------------------------- row editor ------------------------------- */

function RowEditor({ item, currency, onChange, onDecision, onClose }: {
  item: DraftItem;
  currency: string;
  onChange: (field: FieldKey, value: string) => void;
  onDecision: (d: DraftItem['decision']) => void;
  onClose: () => void;
}) {
  const text = (field: FieldKey) => (
    <Input value={item.values[field] ?? ''} onChange={(e) => onChange(field, e.target.value)} />
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Row ${item.sourceRow} · ${item.values.name || 'Untitled item'}`}
      sub={item.source}
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}
    >
      <div className="form-section">
        {item.issues.length > 0 && (
          <div className="flex-col gap-6">
            {item.issues.map((issue, i) => (
              <div key={`${issue.code}-${i}`} className={`alert ${issue.level === 'error' ? 'alert-danger' : issue.level === 'warning' ? 'alert-warning' : 'alert-info'}`}>
                {issue.level === 'error' ? <AlertTriangle size={13} /> : <Check size={13} />}
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        )}

        {item.duplicate && (
          <div className="alert alert-warning">
            <AlertTriangle size={14} />
            <span>
              Matches <b>{item.duplicate.label}</b> ({item.duplicate.existingQty} on hand) by {item.duplicate.kind === 'name' ? 'name, category and brand' : item.duplicate.kind}.
              <div className="flex items-center gap-8" style={{ marginTop: 6 }}>
                <Select value={item.decision} onChange={(e) => onDecision(e.target.value as DraftItem['decision'])} style={{ maxWidth: 220 }} aria-label="Duplicate action">
                  <option value="skip">Skip this row</option>
                  <option value="create">Import as a separate item</option>
                  <option value="update">Update the existing item</option>
                </Select>
                <span className="tiny">Update changes prices and descriptions only — never stock.</span>
              </div>
            </span>
          </div>
        )}

        <div className="form-grid">
          <Field label="Item name" required>{text('name')}</Field>
          <Field label="SKU" required hint="Part number is used when SKU is empty.">{text('sku')}</Field>
          <Field label="Barcode">{text('barcode')}</Field>
          <Field label="Part number">{text('partNumber')}</Field>
        </div>
        <div className="form-grid">
          <Field label="Category">{text('category')}</Field>
          <Field label="Subcategory">{text('subcategory')}</Field>
          <Field label="Brand">{text('brand')}</Field>
          <Field label="Unit">{text('unit')}</Field>
        </div>
        <div className="form-grid">
          <Field label={`Purchase cost (${currency})`}>{text('cost')}</Field>
          <Field label={`Selling price (${currency})`}>{text('price')}</Field>
          <Field label="Opening stock">{text('qty')}</Field>
          <Field label="Reorder level">{text('reorderLevel')}</Field>
          <Field label="Tax rate (%)">{text('taxRate')}</Field>
          <Field label="Warranty (months)">{text('warrantyMonths')}</Field>
          <Field label="Shelf location">{text('location')}</Field>
          <Field label="Compatibility" hint="e.g. Corolla 2018–2022">{text('compatibility')}</Field>
        </div>
        <Field label="Description">
          <Textarea value={item.values.description ?? ''} onChange={(e) => onChange('description', e.target.value)} style={{ minHeight: 56 }} />
        </Field>
        <Field label="Supplier name (matched to your supplier list)">{text('supplier')}</Field>
      </div>
    </Modal>
  );
}

/* --------------------------------- result --------------------------------- */

function ResultStep({ report, onReset, onGoInventory }: { report: ImportReport; onReset: () => void; onGoInventory: () => void }) {
  const failures = report.outcomes.filter((o) => o.status === 'failed');
  const skipped = report.outcomes.filter((o) => o.status === 'skipped');

  const downloadFailures = () => downloadCsv(
    'import-failures',
    ['Row', 'Status', 'Reason'],
    report.outcomes.filter((o) => o.status !== 'imported' && o.status !== 'updated')
      .map((o) => [o.sourceRow, o.status, o.message ?? ''])
  );

  return (
    <div className="flex-col gap-12">
      <Card>
        <div className="card-header">
          <div>
            <h3>{report.cancelled ? 'Import stopped early' : 'Import finished'}</h3>
            <div className="sub">
              {report.fileName} · {new Date(report.finishedAt).toLocaleString()}
            </div>
          </div>
          <Badge tone={report.failed ? 'warning' : 'success'}>{report.failed ? 'Completed with errors' : 'Completed'}</Badge>
        </div>
        <div className="import-summary">
          <SummaryChip label="Added" value={report.imported} tone="success" />
          <SummaryChip label="Updated" value={report.updated} />
          <SummaryChip label="Skipped" value={report.skipped} />
          <SummaryChip label="Failed" value={report.failed} tone={report.failed ? 'danger' : undefined} />
        </div>
        {report.cancelled && (
          <div className="alert alert-warning"><AlertTriangle size={14} /><span>The import was cancelled. Items already written stay in inventory; the rest were not touched.</span></div>
        )}
      </Card>

      {(failures.length > 0 || skipped.length > 0) && (
        <Card>
          <div className="card-header">
            <h3>Rows that were not added ({failures.length + skipped.length})</h3>
            <Button size="sm" variant="secondary" onClick={downloadFailures}><Download size={13} /> Download CSV</Button>
          </div>
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th style={{ width: 70 }}>Row</th><th style={{ width: 90 }}>Result</th><th>Reason</th></tr></thead>
              <tbody>
                {[...failures, ...skipped].slice(0, 100).map((o) => (
                  <tr key={`${o.rowId}-${o.status}`}>
                    <td className="tiny mono">#{o.sourceRow}</td>
                    <td><Badge tone={o.status === 'failed' ? 'danger' : 'neutral'}>{o.status}</Badge></td>
                    <td className="tiny">{o.message ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {failures.length + skipped.length > 100 && (
            <div className="table-footer"><span className="tiny muted">Showing the first 100. Download the CSV for the full list.</span></div>
          )}
        </Card>
      )}

      <Card>
        <div className="flex items-center gap-10 wrap">
          <Button variant="primary" onClick={onGoInventory}>Open inventory</Button>
          <Button onClick={onReset}>Import another file</Button>
          <div className="grow" />
          {report.imported > 0 && (
            <span className="tiny muted">Imported items are in Inventory → Parts, with an opening-stock movement for each quantity.</span>
          )}
        </div>
      </Card>
    </div>
  );
}
