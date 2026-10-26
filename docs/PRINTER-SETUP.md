# Thermal and A4 printing

Servixa prints through the browser's print dialog. The page geometry is set by CSS (`src/styles/print.css`),
but the final paper size, orientation and margins are chosen by the **printer driver**, so the driver must
match the document.

## 1. What the app produces

| Document | CSS configuration | Select in the print dialog |
| --- | --- | --- |
| 80 mm receipt | `@page thermal-80 { size: 80mm auto; margin: 3mm }` | Paper: **80 mm roll** (or "80(72) × 3276 mm"), Scale 100 %, Margins **None** |
| 58 mm receipt | `@page thermal-58 { size: 58mm auto; margin: 2mm }` | Paper: **58 mm roll** (or "58(48) × 3276 mm"), Scale 100 %, Margins **None** |
| Invoice / job card / P&L | `@page { size: A4; margin: 12mm }` | Paper: **A4**, Portrait, Margins **Default** |

Receipt width is a setting: **Settings → Documents → Receipt width** (58 mm / 80 mm / A4). The print button in
an invoice opens the matching layout automatically.

## 2. Browser dialog settings that matter

1. **Headers and footers: off.** Chrome adds the URL and date to every sheet otherwise.
2. **Margins: None** for thermal. The app already applies 2–3 mm of its own; doubled margins clip the right
   edge of money columns.
3. **Scale: 100 %.** "Fit to page" shrinks a 58 mm receipt into a tiny strip.
4. **Background graphics: on** only if you want the table header shading; the layout is designed to read in
   black and white without it.
5. **Paper size must equal the roll**, not A4. An 80 mm document scaled onto A4 is the usual cause of
   "receipt prints sideways with huge white space".

## 3. Driver configuration (common printers)

For Epson TM-T20/TM-T82, Xprinter XP-58/80, Star TSP100 and similar:

- Windows: *Devices → Printers → Preferences* → set **Paper size** to the installed roll (58 mm = "58 × 297",
  80 mm = "80 × 297" or "72 mm printable"), *Orientation* Portrait, *Scaling* 100 %.
- Install the vendor driver rather than "Generic / Text Only"; the generic driver ignores `@page` size.
- In Chrome's print preview, confirm the preview is a **single narrow column**. If it looks like a landscape
  page, the driver's paper size is wrong — fix it there, not in the app.
- macOS: add the printer with the vendor PPD, then choose the correct "Paper Size" in the print sheet.

## 4. Known driver limitations

CSS cannot override a driver that forces A4, rotates the job, or applies its own margins. When a receipt
comes out rotated or clipped, the fix is in the driver dialog; the app's CSS is already emitting a page box
of exactly 58 mm or 80 mm wide.

## 5. Verifying output before printing

- Open an invoice and press **Receipt** — the app opens the print surface; in the preview dialog choose
  *Save as PDF* and check the page size reads 80.0 × 279.4 mm (or 58 mm).
- Automated checks in this repository measured exactly that: 80 mm → 1 page 80.1 × 279.4 mm, 58 mm → 1 page
  58.3 × 279.4 mm, A4 → 1 page 210.2 × 297.3 mm (see `docs/TEST-REPORT.md`).
- Physical printer output has **not** been verified on hardware.
