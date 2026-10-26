import { Link } from 'react-router-dom';
import { LegalShell, LegalSection } from '../components/LegalShell';
import { APP_VERSION } from '../lib/types';

export default function Help() {
  return (
    <LegalShell
      title="Help & Guide"
      kicker="Operator manual"
      updated="Last reviewed 21 October 2026"
    >
      <div className="legal-toc">
        <div className="legal-toc-title">On this page</div>
        <ol>
          <li><a href="#start">First run and sign-in</a></li>
          <li><a href="#daily">A normal day at the workshop</a></li>
          <li><a href="#modules">Module-by-module guide</a></li>
          <li><a href="#money">Money, tax and rounding</a></li>
          <li><a href="#formulas">Reporting formulas</a></li>
          <li><a href="#keys">Keyboard shortcuts</a></li>
          <li><a href="#bulk-import">Bulk inventory import</a></li>
          <li><a href="#printing">Printing documents</a></li>
          <li><a href="#offline">Offline behaviour and limits</a></li>
          <li><a href="#backup">Backups and restore</a></li>
          <li><a href="#security">Security — what this build does and does not do</a></li>
          <li><a href="#roles">Roles and permissions</a></li>
          <li><a href="#faq">Troubleshooting</a></li>
        </ol>
      </div>

      <LegalSection id="start" title="1. First run and sign-in">
        <p>
          This application stores everything in this browser using IndexedDB. The first time you open the app there are no
          accounts, so you are taken to first-time setup. Setup asks for your workshop details, the owner account
          password, tax and document preferences, and optional artwork.
        </p>
        <ol>
          <li>Enter the workshop name, phone and address — these appear on printed invoices and receipts.</li>
          <li>Create the owner account. This account is always an administrator and cannot be disabled.</li>
          <li>Choose currency (default <code>Rs.</code>), time zone and document prefixes.</li>
          <li>Optionally upload a logo, login illustration and dashboard hero image. Defaults are bundled with the app.</li>
        </ol>
        <p>
          Setup is one-time. It is only re-run if you use <b>Settings → Data management → Factory reset</b>.
          After setup you can load a fictional sample workshop to explore the app; sample data is blocked once
          real invoices or job cards exist.
        </p>
      </LegalSection>

      <LegalSection id="daily" title="2. A normal day at the workshop">
        <ol>
          <li><b>Open a cash shift</b> in Cash Shifts and count the float in the drawer. Every cash payment taken
            while the shift is open is attributed to it.</li>
          <li><b>Sell over the counter</b> in POS: add parts, services or labour, choose a customer and vehicle if
            relevant, take one or more payments, and print a thermal receipt.</li>
          <li><b>Book in a repair</b> as a job card: capture the vehicle, the complaint, assign a mechanic and add an
            estimate. Progress the card as work advances.</li>
          <li><b>Invoice the job</b> when it is ready. The job card converts at the agreed estimate or your edited
            amount — stock is never deducted twice.</li>
          <li><b>Receive stock</b> from suppliers via Purchases. Quantities only increase when the purchase is
            received.</li>
          <li><b>Handle returns</b> against an invoice: choose lines and quantities, decide whether each line is
            restocked, and record how the customer is refunded.</li>
          <li><b>Close the shift</b>: enter the counted cash, review the variance and add a note explaining it.</li>
        </ol>
      </LegalSection>

      <LegalSection id="modules" title="3. Module-by-module guide">
        <dl className="legal-dl">
          <dt>Dashboard</dt>
          <dd>Period-aware KPIs, a sales line chart, service mix, monthly bars, low-stock alerts and recent activity.
            Every number is calculated from records; nothing is decorative.</dd>

          <dt>POS Billing</dt>
          <dd>Fast cart with part, service and labour search. Supports split payments across cash, card, bank and
            online, records the tendered amount and change due, and supports partial payment for credit sales.
            Stock is checked against availability before the sale commits.</dd>

          <dt>Job Cards</dt>
          <dd>Full lifecycle: draft → awaiting approval → approved → in progress → on hold → ready → completed, with
            cancellation from any non-final stage. Each card keeps a history timeline, mechanic assignment and an
            estimate that becomes an invoice without deducting parts twice.</dd>

          <dt>Invoices</dt>
          <dd>Searchable register with status and payment filters. Open an invoice to see lines, payments, returns,
            print or reprint, take an additional payment, or void the invoice (voiding restores stock and marks
            payments void; it does not delete history).</dd>

          <dt>Cash Shifts</dt>
          <dd>Open and close drawers, record cash in/out with a reason, and reconcile expected versus counted cash.
            Closed shifts keep the variance for audit.</dd>

          <dt>Customers</dt>
          <dd>Customer directory with balances, purchase history and linked vehicles. Balances come from unpaid
            invoices and credit returns, not manual entry.</dd>

          <dt>Vehicles</dt>
          <dd>Registration-first vehicle records linked to owners, with service history, invoice history and active
            warranty tabs.</dd>

          <dt>Inventory</dt>
          <dd>Stock valuation at cost and retail, low-stock filters, CSV export and a full movement ledger. Stock is
            adjusted only through the adjustment dialog with a required reason; every change is written to the
            movement history. Pressing <kbd>Enter</kbd> in the inventory search box opens the movement history of the
            single part a scanner or search has matched.</dd>

          <dt>Parts</dt>
          <dd>Parts catalogue with SKU, category, cost, sale price, tax rate, reorder level and supplier. Opening
            stock is recorded when a part is created; quantities are never edited directly on this screen.</dd>

          <dt>Services &amp; Labor</dt>
          <dd>Billable service and labour catalogues with fixed prices, tax rates and active/inactive state. These
            feed POS and job cards.</dd>

          <dt>Purchases</dt>
          <dd>Supplier purchases start as drafts (editable, no stock effect), are received to increase stock, and can
            be cancelled. Supplier payments are recorded separately and reduce the supplier balance.</dd>

          <dt>Suppliers</dt>
          <dd>Supplier directory with contact details, payable balance and purchase history.</dd>

          <dt>Returns</dt>
          <dd>Credit notes against completed invoices. Each line controls restocking; refunds can be cash, card,
            bank, online or store credit. Returned amounts reduce invoice balances and reporting revenue.</dd>

          <dt>Warranty</dt>
          <dd>Register warranty coverage for a part, service or custom item against a vehicle and customer. Filters
            show active, expiring within 30 days, expired and claimed. Claims record the fault, resolution and handler.</dd>

          <dt>Expenses</dt>
          <dd>Operating costs by category and payment method. Approved cash expenses are deducted from the open
            shift’s expected drawer.</dd>

          <dt>Mechanics &amp; Staff</dt>
          <dd>Workload per staff member and mechanic performance — completed jobs, billed value and average
            turnaround — computed from real job cards and invoices.</dd>

          <dt>Reports</dt>
          <dd>Profit &amp; loss, sales, expense, purchase and return registers for any period, each exportable to CSV
            or printable. Formulas are printed on the page.</dd>

          <dt>Analytics</dt>
          <dd>Net revenue trend, margin, payment mix, service mix, top parts and mechanic throughput, with
            period-over-period comparison only when the prior period contains data.</dd>

          <dt>Users &amp; Roles</dt>
          <dd>Create accounts, reset passwords, enable or disable staff and edit per-role permissions. Administrators
            always retain full access.</dd>

          <dt>Settings</dt>
          <dd>Business profile, document numbering and print rules, brand artwork, authentication policy,
            notification preferences and data management (backup, restore, sample data, reset).</dd>
        </dl>
      </LegalSection>

      <LegalSection id="money" title="4. Money, tax and rounding">
        <p>
          All amounts are stored as whole numbers of paisa (1 rupee = 100 paisa). Arithmetic is integer-only, so
          totals never drift the way floating-point currency can. Rounding happens once per line, half-up to the
          nearest paisa, and invoice totals are the sum of rounded lines.
        </p>
        <ul>
          <li>Line total = quantity × rate − line discount, then tax is applied to that net line amount.</li>
          <li>Invoice total = Σ line totals − invoice discount + tax.</li>
          <li>Discounts never reduce tax below zero, and the configured maximum discount is enforced when the sale commits.</li>
          <li>Split payments must cover at most the amount due; overpayment is not accepted except where the UI
            explicitly calculates change for cash tender.</li>
        </ul>
      </LegalSection>

      <LegalSection id="formulas" title="5. Reporting formulas">
        <p>These are the exact definitions used by Reports and Analytics. They are also shown on the Reports page.</p>
        <dl className="legal-dl">
          <dt>Gross sales</dt><dd>Σ (quantity × rate − line discount) across completed invoices in the period, before tax.</dd>
          <dt>Net sales</dt><dd>Gross sales − invoice-level discounts.</dd>
          <dt>Returns</dt><dd>Σ pre-tax value of credit notes issued in the period.</dd>
          <dt>Net revenue</dt><dd>Net sales − returns. This is revenue, not profit.</dd>
          <dt>Cost of goods sold (parts)</dt><dd>Σ cost price × quantity for part lines sold, minus the cost of parts returned.</dd>
          <dt>Gross profit</dt><dd>Net revenue − parts cost. Overheads are not allocated, which is why it is labelled gross.</dd>
          <dt>Operating result</dt><dd>Gross profit − approved expenses in the period.</dd>
          <dt>Shift expected cash</dt><dd>Opening float + cash sales − cash refunds − approved cash expenses + cash in − cash out.</dd>
        </dl>
        <p className="legal-note">
          Sales revenue is never presented as profit. Cards labelled “revenue”, “sales” or “collected” are exactly
          that, and any margin figure states the cost basis it uses.
        </p>
      </LegalSection>

      <LegalSection id="keys" title="6. Keyboard shortcuts">
        <table className="legal-table">
          <thead><tr><th>Shortcut</th><th>Action</th></tr></thead>
          <tbody>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd></td><td>Global search across customers, vehicles, invoices, job cards and parts</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>N</kbd></td><td>New record in the current module — sale on POS, job card, purchase or user. Anywhere else it starts a new sale.</td></tr>
            <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>P</kbd></td><td>Print the current document or page</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>Close dialogs, drawers and the search palette</td></tr>
            <tr><td><kbd>Alt</kbd> + <kbd>1</kbd></td><td>Go to Dashboard</td></tr>
            <tr><td><kbd>Alt</kbd> + <kbd>2</kbd></td><td>Go to POS Billing</td></tr>
            <tr><td><kbd>Alt</kbd> + <kbd>3</kbd></td><td>Go to Job Cards</td></tr>
          </tbody>
        </table>
      </LegalSection>

      <LegalSection id="bulk-import" title="7. Bulk inventory import">
        <p>
          Inventory → <b>Bulk import</b> loads a supplier price list into the parts catalogue without typing each item.
          It is available to roles with <code>inventory.manage</code> (Administrator, Manager, Inventory Manager by default).
        </p>
        <ol>
          <li><b>Upload</b> — drop one or more files, or choose them. Accepted: PDF with a text layer, CSV, TSV, TXT and
            Excel .xlsx. Maximum 25 MB per file and 10,000 rows per sheet.</li>
          <li><b>Map columns</b> — the importer proposes a mapping from the file's own headers. Check it; Item name and
            SKU are required (a part number is accepted as the SKU), everything else is optional and stays empty when
            the file does not contain it. A sheet with no name or code column is ignored.</li>
          <li><b>Review</b> — search, filter, edit any cell, open a row for every field, deselect, remove, and restore
            removed rows. Duplicates and problems are labelled per row. Nothing is written at this stage.</li>
          <li><b>Confirm</b> — a summary of what will be added, skipped and flagged; the import only runs after you
            confirm. Then a report shows added, updated, skipped and failed counts, with a CSV of the rows that were
            not added.</li>
        </ol>
        <p><b>What extraction does and does not do</b></p>
        <ul>
          <li>PDF text is read page by page and columns are positioned from the header row, so a blank cell does not
            shift the rest of the line. Repeated headers, page footers and “Total” lines are skipped.</li>
          <li>Scanned PDFs (photographs of paper) have no text layer. <b>Optical character recognition is not bundled</b>:
            it would add a large download and misfires on price and quantity columns. Such files are refused with an
            explanation, and nothing is imported from them.</li>
          <li>Values are never invented. If a price, quantity, category, barcode or supplier is missing from the file it
            stays empty (the catalogue default applies) and the row is flagged for review. Unreadable numbers are
            errors, not zeros.</li>
          <li>Legacy <code>.xls</code>, Word documents and image files are rejected with a message telling you what to
            save the file as instead.</li>
        </ul>
        <p><b>Duplicates</b></p>
        <ul>
          <li>Checked in this order: barcode → SKU → part number → exact name + category + brand. A name-only match is a
            warning you decide on, never an automatic merge.</li>
          <li>For a duplicate you can <b>skip</b> it, <b>create it anyway</b> (when it is genuinely a different product),
            or explicitly <b>update the existing item</b> — which changes prices and descriptive fields only and never
            touches stock on hand.</li>
          <li>Importing the same file twice cannot create accidental copies: the row is matched and skipped, and a
            warning names the earlier import of the same file.</li>
        </ul>
        <p><b>Categories</b> — incoming category names that do not exist yet are listed with a count before import. Keep
            the new name, or point it at a category you already use. Nothing creates hundreds of near-duplicates.</p>
        <p><b>Barcodes</b> — a USB barcode scanner types into any focused field, so scanning works in the part form and in
            search boxes. A barcode can belong to only one part; the catalogue refuses a second assignment. Camera-based
            scanning is <b>not</b> included: it needs a decoder library and a camera permission the app does not otherwise
            use, and it is not required for importing.</p>
      </LegalSection>

      <LegalSection id="printing" title="8. Printing documents">
        <p>
          Invoices, receipts, job cards, purchase orders, credit notes, shift reports and the profit &amp; loss report
          have purpose-built layouts. Thermal receipts support 58 mm and 80 mm paper; documents print to A4.
        </p>
        <ul>
          <li>Set the default receipt width in Settings → Documents.</li>
          <li>In the browser print dialog choose your thermal printer’s paper size, margins “None” and scale 100%.</li>
          <li>The app prints only the document, never the surrounding interface.</li>
          <li>Your logo appears when it is enabled for receipts and when set in Settings → Appearance.</li>
        </ul>
      </LegalSection>

      <LegalSection id="offline" title="9. Offline behaviour and limits">
        <p>
          This app is an installable progressive web app. After the first load the shell, fonts and images are cached,
          so the app opens without a connection and all CRUD continues to work against the local database.
        </p>
        <ul>
          <li>There is no background sync in this build. Anything you record stays on this device until you export a backup.</li>
          <li>The PDF engine used by bulk import is downloaded the first time you import a PDF and then cached, so PDF
            import also works offline afterwards. CSV and Excel parsing needs no download at all.</li>
          <li>Clearing site data, using private browsing, or changing browser profiles will hide or remove the database.</li>
          <li>Two tabs can both write; each transaction is serialised by IndexedDB, but the other tab will not refresh
            until it reloads or receives a change event.</li>
          <li>This release has no server, database or synchronization. The <code>/api/sync</code> endpoint answers
            <code>501</code> by design and never acknowledges a record; move data between devices with a backup.</li>
        </ul>
      </LegalSection>

      <LegalSection id="backup" title="10. Backups and restore">
        <p>
          Settings → Data management exports a single JSON file containing every business record, your settings and
          artwork. The file carries a format marker, version, checksum and record counts.
        </p>
        <ol>
          <li><b>Export</b> before any bulk change, browser update or device hand-over. Keep copies off-device.</li>
          <li><b>Restore</b> validates the file (format, version, structure, checksum), shows a preview of the workshop
            name, export date and record counts, and requires you to type <code>RESTORE</code>.</li>
          <li>Restore then replaces the local database inside one transaction. You choose which administrator account
            to recover and set a new password, because password hashes are deliberately excluded from backups.</li>
        </ol>
        <p className="legal-note">
          A damaged or unsupported backup is rejected before anything is written. If a restore is interrupted, the
          browser rolls the transaction back.
        </p>
        <p><b>Export all data (.zip)</b> writes the same records as one CSV per entity plus a
          <code>manifest.json</code> that lists every file, its columns and the links between them. Open it in a
          spreadsheet, or restore it later. Money is integer paisa, timestamps are milliseconds, text is UTF-8 with
          a byte-order mark, and cells that would be read as formulas by a spreadsheet are prefixed with an
          apostrophe. Password hashes and salts are never written.</p>
        <table className="legal-table">
          <thead><tr><th>File</th><th>Contains</th></tr></thead>
          <tbody>
            <tr><td>customers, vehicles, suppliers, parts, services, labor</td><td>Master records with stable IDs</td></tr>
            <tr><td>invoices + invoice_lines, purchases + purchase_lines, returns + return_lines</td><td>Documents and their line items, linked by parent ID</td></tr>
            <tr><td>jobcards + job_lines + job_history</td><td>Job cards with their lines and status timeline</td></tr>
            <tr><td>payments, expenses, cash_shifts, cash_movements, stock_moves</td><td>Money and stock movement ledger</td></tr>
            <tr><td>warranty + warranty_claims, sequences, users, audit, notifications</td><td>Coverage, numbering, accounts without credentials, activity</td></tr>
            <tr><td>settings.csv, assets.csv, assets/</td><td>Application settings and uploaded artwork</td></tr>
          </tbody>
        </table>
        <p><b>Restoring an archive</b> offers two modes, both previewed before anything is written:</p>
        <ul>
          <li><b>Merge</b> — adds only records whose ID and business key (SKU, invoice number, customer code…) are not
            already on this device. Nothing is overwritten and nothing is deleted; restoring the same archive twice
            adds nothing the second time.</li>
          <li><b>Clean install</b> — replaces the whole workspace with the archive, including settings and accounts. The
            chosen administrator gets a new password; every other account is restored disabled until an administrator
            resets it.</li>
        </ul>
        <p className="legal-note">
          <b>Limits.</b> A restore is all-or-nothing per run and runs in one transaction, so an interrupted restore
          leaves the previous data in place. Two things are not transferred by the CSV archive: the authentication
          secrets (by design) and the short inventory-import history (metadata only). Anything that depends on a
          browser-specific setting — installed app state, notifications permission, camera permission — stays with
          this browser profile.
        </p>
      </LegalSection>

      <LegalSection id="security" title="11. Security — what this build does and does not do">
        <p>
          This is a local-first application, not a hosted service. Sign-in exists to separate staff roles on a shared
          workshop machine, and passwords are stored as PBKDF2-derived hashes with per-user salts — never in plain
          text, never in exports. Failed attempts can trigger a temporary lockout.
        </p>
        <p className="legal-note">
          It is not server-grade security. Anyone with access to this browser profile and developer tools can read the
          local database. Use operating-system accounts, full-disk encryption and physical access control, and do not
          reuse an important password here. There is no password recovery: if the last administrator password is lost
          and no backup exists, the local data cannot be decrypted into a session.
        </p>
      </LegalSection>

      <LegalSection id="roles" title="12. Roles and permissions">
        <p>Five roles ship by default. Administrators can adjust any non-administrator role in Users &amp; Roles.</p>
        <table className="legal-table">
          <thead><tr><th>Role</th><th>Typical use</th></tr></thead>
          <tbody>
            <tr><td>Administrator</td><td>Full access including users, settings and backups. Cannot be locked out.</td></tr>
            <tr><td>Manager</td><td>Operations, purchasing, reports and staff, but not security settings or backups.</td></tr>
            <tr><td>Cashier</td><td>POS, shifts, invoices, customers and vehicle lookup.</td></tr>
            <tr><td>Mechanic</td><td>Job cards, vehicle details and stock visibility.</td></tr>
            <tr><td>Inventory Manager</td><td>Parts, stock, purchases, suppliers and inventory reports.</td></tr>
          </tbody>
        </table>
        <p>Permissions are enforced in navigation, on screen actions and again inside transaction functions.</p>
      </LegalSection>

      <LegalSection id="faq" title="13. Troubleshooting">
        <dl className="legal-dl">
          <dt>The app shows an empty workshop after an update</dt>
          <dd>You may be on a different browser profile or a private window. Restore your latest backup, or reopen the app under the original profile.</dd>
          <dt>A sale is refused because of stock</dt>
          <dd>Quantities are validated against availability at commit time. Receive the purchase, adjust stock with a reason, or allow negative stock in Settings → Documents if your workflow needs it.</dd>
          <dt>Cash variance when closing a shift</dt>
          <dd>Check refunds, approved cash expenses and any cash in/out movements. Variance is counted minus expected; add a note before closing.</dd>
          <dt>Restore says the checksum does not match</dt>
          <dd>The file was edited or truncated. Use the original export; the app refuses partial restores by design.</dd>
          <dt>Printer output is cut off</dt>
          <dd>Match the paper size (58 mm or 80 mm) in the browser print dialog, set margins to none, and disable “fit to page”.</dd>
          <dt>I forgot the administrator password</dt>
          <dd>Restore a backup and set a new administrator password. Without a backup there is no recovery path in a local-only build.</dd>
        </dl>
      </LegalSection>

      <p className="legal-end">
        Version {APP_VERSION}. For the data-handling statement, read the <Link to="/privacy">Privacy &amp; Terms</Link>.
      </p>
    </LegalShell>
  );
}
