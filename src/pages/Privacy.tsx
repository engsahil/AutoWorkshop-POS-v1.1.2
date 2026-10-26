import { Link } from 'react-router-dom';
import { LegalShell, LegalSection } from '../components/LegalShell';
import { APP_VERSION } from '../lib/types';

export default function Privacy() {
  return (
    <LegalShell
      title="Privacy & Terms"
      kicker="Fixed policy document"
      updated="Last reviewed 21 October 2026"
    >
      <div className="legal-toc">
        <div className="legal-toc-title">On this page</div>
        <ol>
          <li><a href="#summary">Plain-language summary</a></li>
          <li><a href="#data">What data the app stores</a></li>
          <li><a href="#where">Where data lives and what leaves the device</a></li>
          <li><a href="#auth">Accounts and passwords</a></li>
          <li><a href="#backups">Backups and exports</a></li>
          <li><a href="#retention">Retention, deletion and portability</a></li>
          <li><a href="#rights">Your responsibilities</a></li>
          <li><a href="#terms">Terms of use</a></li>
          <li><a href="#warranty">Warranty and liability</a></li>
          <li><a href="#changes">Changes to this document</a></li>
        </ol>
      </div>

      <LegalSection id="summary" title="1. Plain-language summary">
        <ul>
          <li>This is a local-first workshop management app. Your workshop records are stored in this browser, on this device.</li>
          <li>There is no online account, no cloud database and no analytics or advertising code in this build.</li>
          <li>Data leaves the device only when you export a backup or print a document.</li>
          <li>Passwords are stored as PBKDF2-derived hashes and are never included in exports.</li>
          <li>You control deletion: clear business data or reset the app from Settings → Data management.</li>
        </ul>
      </LegalSection>

      <LegalSection id="data" title="2. What data the app stores">
        <p>The application keeps the following categories of information, each in its own local database store:</p>
        <table className="legal-table">
          <thead><tr><th>Category</th><th>Contents</th><th>Why</th></tr></thead>
          <tbody>
            <tr><td>Business identity</td><td>Workshop name, address, phone, email, tax and registration numbers, hours, logo and artwork</td><td>Appears on documents and receipts</td></tr>
            <tr><td>People</td><td>Customers and staff names, phone numbers, optional email, address and CNIC where entered</td><td>Contact, invoicing and access control</td></tr>
            <tr><td>Vehicles</td><td>Registration number, make, model, year, colour, odometer, VIN, engine number</td><td>Service history and job cards</td></tr>
            <tr><td>Commercial records</td><td>Invoices, job cards, purchases, returns, payments, expenses, cash shifts</td><td>Running the workshop and reporting</td></tr>
            <tr><td>Inventory</td><td>Parts, services, labour rates, suppliers, stock movements, warranties</td><td>Stock control and pricing</td></tr>
            <tr><td>Audit and notifications</td><td>Who did what and when, in-app alerts generated from records</td><td>Accountability and follow-up</td></tr>
            <tr><td>Accounts</td><td>Username, display name, role, password hash and salt, preferences</td><td>Sign-in and permissions</td></tr>
          </tbody>
        </table>
        <p>
          Fields marked optional in the interface are genuinely optional. The application does not ask for, and has no field
          for, payment card numbers, bank credentials or national identity data beyond an optional CNIC typed by you.
        </p>
      </LegalSection>

      <LegalSection id="where" title="3. Where data lives and what leaves the device">
        <p>
          All records are stored in IndexedDB under this site’s origin, together with a service-worker cache that
          holds the application shell, bundled fonts and images so the app opens offline. Session state is kept in
          <code>sessionStorage</code>. Nothing is transmitted to any server: this build has no telemetry,
          no third-party analytics, no advertising SDK and no remote font or icon requests — fonts and icons are
          bundled with the application.
        </p>
        <p>
          The only outbound transfers are the ones you initiate: downloading a backup file, printing, or saving a CSV
          export. If you deploy this project with the optional server boundary at <code>/api</code>, the operator of
          that deployment becomes responsible for the data sent to it; until such a backend is configured, those
          endpoints return <code>501 Not Implemented</code> and the app continues to operate locally.
        </p>
        <p className="legal-note">
          Because storage is per-browser, the same database is not shared between devices, browsers or profiles.
          Clearing site data removes it.
        </p>
      </LegalSection>

      <LegalSection id="auth" title="4. Accounts and passwords">
        <p>
          Accounts exist to separate staff roles on a shared workshop machine. Passwords are never stored in plain
          text: each account keeps a random salt and a PBKDF2-derived hash with a work factor of 150,000 iterations.
          Authentication compares hashes in memory; the plain password is not written to disk, logs or exports.
        </p>
        <p>
          Optional policies include a minimum length, an uppercase requirement, a numeric requirement, session expiry
          and a temporary lockout after repeated failures.
        </p>
        <p className="legal-note">
          This is not server-grade security. A local database can be read with developer tools by anyone who controls
          the browser profile. Treat operating-system account security and device encryption as your real boundary,
          and do not reuse a sensitive password here.
        </p>
      </LegalSection>

      <LegalSection id="backups" title="5. Backups and exports">
        <p>
          Backups are created only when you ask for one. The export is a single JSON file containing your business
          records, settings and uploaded artwork, plus a format marker, version, checksum and record counts. Password
          hashes and salts are deliberately excluded, so restoring requires you to set a new administrator password.
        </p>
        <p>
          A backup file is unencrypted JSON. Store it somewhere you control — an encrypted disk, an access-controlled
          drive — and treat it with the same care as the workshop records themselves. The application never uploads or emails
          backups.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="6. Retention, deletion and portability">
        <ul>
          <li><b>Retention</b> is entirely up to you. The app never expires or deletes records automatically.</li>
          <li><b>Clear business data</b> removes commercial records while keeping staff accounts, settings and numbering.</li>
          <li><b>Factory reset</b> deletes the local database, including accounts and artwork, and returns to first-time setup.</li>
          <li><b>Portability</b> is provided by the JSON backup and CSV exports of registers and stock.</li>
        </ul>
        <p>
          Deleting browser site data has the same effect as a factory reset and cannot be undone without a backup.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="7. Your responsibilities">
        <ul>
          <li>Inform staff that their name, role and activity are recorded in the audit trail.</li>
          <li>Obtain any consent your jurisdiction requires before storing customer contact details or CNIC numbers.</li>
          <li>Protect the device: OS login, screen lock, disk encryption and physical control.</li>
          <li>Keep regular off-device backups and test restores before you rely on them.</li>
          <li>Comply with local tax, invoicing and record-keeping obligations. The application records what you enter; it does
            not file taxes or validate your compliance.</li>
        </ul>
      </LegalSection>

      <LegalSection id="terms" title="8. Terms of use">
        <p>
          This software is provided as a self-hosted workshop management application. You may install, use and modify it for
          your workshop. You are responsible for the accuracy of the data you enter, for the security of the device it
          runs on, and for the backups you keep.
        </p>
        <p>
          You agree not to rely on the application as the sole record for legally mandated accounting, to use it to
          store unlawful content, or to misrepresent its local-only security model as server-grade protection.
        </p>
        <p>
          The software is supplied without any service-level commitment. There is no hosted uptime guarantee because
          there is no hosted service: availability depends on your device and browser.
        </p>
      </LegalSection>

      <LegalSection id="warranty" title="9. Warranty and liability">
        <p>
          The application is provided “as is”, without warranties of merchantability, fitness for a particular
          purpose or non-infringement. To the maximum extent permitted by law, the authors are not liable for lost
          profits, lost data, business interruption or indirect damages arising from use of the application.
        </p>
        <p className="legal-note">
          Keep independent backups. No software can recover data that was never exported and then lost from a browser.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="10. Changes to this document">
        <p>
          This document ships with the application build and is not editable from Settings, so it cannot silently
          diverge from the software’s behaviour. When the software’s data handling changes, this page is updated and
          the review date above changes with it. The current document version is <b>{APP_VERSION}</b>.
        </p>
      </LegalSection>

      <p className="legal-end">
        For operating instructions and reporting definitions, read the <Link to="/help">Help &amp; Guide</Link>.
      </p>
    </LegalShell>
  );
}
