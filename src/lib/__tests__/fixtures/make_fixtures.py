#!/usr/bin/env python3
"""Generate the binary fixtures used by the import unit tests.

Run from the repository root:  python3 src/lib/__tests__/fixtures/make_fixtures.py
The generated files are committed; this script is documentation of how they
were produced (pure stdlib, no external PDF or Excel library).
"""
import os
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))


# --------------------------------------------------------------------------- pdf
def esc(s):
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def make_pdf(pages, path, width=595, height=842):
    """pages: list of lists of (x, y_from_top, text). A4 points, Helvetica 9pt."""
    n = len(pages)
    page_ids, content_ids, next_id = [], [], 3
    for _ in range(n):
        page_ids.append(next_id)
        content_ids.append(next_id + 1)
        next_id += 2
    font_obj = next_id

    def stream(items):
        out = ["BT", "/F1 9 Tf"]
        for x, y, text in items:
            out.append("1 0 0 1 %.2f %.2f Tm" % (x, height - y))
            out.append("(%s) Tj" % esc(text))
        out.append("ET")
        return "\n".join(out).encode("latin-1")

    buf = bytearray(b"%PDF-1.4\n")
    offsets = {}

    def add(num, body):
        offsets[num] = len(buf)
        buf.extend(("%d 0 obj\n" % num).encode())
        buf.extend(body)
        buf.extend(b"\nendobj\n")

    add(1, b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join("%d 0 R" % pid for pid in page_ids)
    add(2, ("<< /Type /Pages /Count %d /Kids [%s] >>" % (n, kids)).encode())
    for i, items in enumerate(pages):
        data = stream(items)
        comp = zlib.compress(data)
        add(page_ids[i], (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] "
            "/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
            % (width, height, font_obj, content_ids[i])
        ).encode())
        add(content_ids[i], ("<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(comp)).encode()
            + comp + b"\nendstream")
    add(font_obj, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")

    xref = len(buf)
    count = font_obj + 1
    buf.extend(("xref\n0 %d\n" % count).encode())
    buf.extend(b"0000000000 65535 f \n")
    for num in range(1, count):
        buf.extend(("%010d 00000 n \n" % offsets[num]).encode())
    buf.extend(("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (count, xref)).encode())
    open(path, "wb").write(bytes(buf))


COLUMNS = [(40, "Code"), (120, "Item Name"), (300, "Brand"), (370, "Category"),
           (440, "Qty"), (480, "Cost"), (520, "Price")]

ROWS = [
    ("BP-1001", "Brake Pad Set Front", "Bosch", "Brakes", "24", "1250.00", "1890.00"),
    ("BP-1002", "Brake Pad Set Rear", "Bosch", "Brakes", "18", "1100.00", "1650.00"),
    ("OF-2201", "Oil Filter Corolla", "Toyota", "Filters", "60", "320.50", "480.00"),
    ("OF-2202", "Oil Filter Civic", "Honda", "Filters", "44", "345.00", "520.00"),
    ("SP-3301", "Spark Plug Iridium", "NGK", "Ignition", "120", "640.00", "899.00"),
    ("SP-3302", "Spark Plug Standard", "Champion", "Ignition", "80", "210.00", "340.00"),
    ("WB-4401", "Wiper Blade 18in", "Denso", "Accessories", "36", "410.00", "650.00"),
    ("WB-4402", "Wiper Blade 22in", "Denso", "Accessories", "30", "460.00", "720.00"),
    ("AB-5501", "Air Filter Economy", "Sakura", "Filters", "50", "280.00", "420.00"),
    ("AB-5502", "Cabin Filter Carbon", "Sakura", "Filters", "22", "520.00", "780.00"),
    ("CL-6601", "Clutch Plate 160mm", "Exedy", "Transmission", "8", "3400.00", "4700.00"),
    ("CL-6602", "Clutch Cover Assembly", "Exedy", "Transmission", "6", "4100.00", "5600.00"),
    ("SH-7701", "Shock Absorber Front", "KYB", "Suspension", "16", "2900.00", "3900.00"),
    ("SH-7702", "Shock Absorber Rear", "KYB", "Suspension", "14", "2650.00", "3600.00"),
    ("BT-8801", "Battery 55Ah", "Exide", "Electrical", "10", "9800.00", "12500.00"),
    ("BT-8802", "Battery 65Ah", "Exide", "Electrical", "9", "11200.00", "14200.00"),
    ("BL-9901", "Brake Fluid DOT4 500ml", "Total", "Fluids", "48", "390.00", "560.00"),
    ("BL-9902", "Coolant Green 4L", "Total", "Fluids", "20", "1250.00", "1750.00"),
    ("HL-1101", "Headlight Bulb H4", "Osram", "Electrical", "64", "240.00", "390.00"),
    ("HL-1102", "Headlight Bulb H7", "Osram", "Electrical", "58", "265.00", "410.00"),
    ("FB-1201", "Fan Belt 4PK", "Gates", "Engine", "26", "680.00", "980.00"),
    ("FB-1202", "Timing Belt Kit", "Gates", "Engine", "12", "4300.00", "5900.00"),
    ("WS-1301", "Washer Pump", "Denso", "Electrical", "18", "520.00", "790.00"),
    ("RM-1401", "Rear View Mirror", "Suzuki", "Body", "7", "1450.00", "2100.00"),
]


def build_parts_pdf(path, per_page=8):
    pages = []
    total_pages = (len(ROWS) + per_page - 1) // per_page
    for page_no in range(total_pages):
        items = [(40, 46, "AL-MADINA MOTORS - PARTS PRICE LIST"), (40, 62, "Supplier: Metro Auto Parts")]
        y = 96
        for x, label in COLUMNS:
            items.append((x, y, label))
        page_rows = ROWS[page_no * per_page:(page_no + 1) * per_page]
        y += 18
        for row in page_rows:
            for (x, _), value in zip(COLUMNS, row):
                items.append((x, y, value))
            y += 16
        items.append((40, 780, "Page %d of %d" % (page_no + 1, total_pages)))
        if page_no == total_pages - 1:
            items.append((40, y + 6, "Total"))
            items.append((440, y + 6, str(len(ROWS))))
        pages.append(items)
    make_pdf(pages, path)


def build_scanned_pdf(path):
    # A page with a drawing but no text operators: looks scanned to any extractor.
    make_pdf([[(60, 700, "")]], path)


# -------------------------------------------------------------------------- xlsx
def col_letter(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def make_xlsx(path, sheets):
    """sheets: list of (name, rows) where rows are lists of str|int|None."""
    shared, shared_index = [], {}

    def sid(text):
        if text not in shared_index:
            shared_index[text] = len(shared)
            shared.append(text)
        return shared_index[text]

    sheet_xml = []
    for _, rows in sheets:
        parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
                 '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
        for r, row in enumerate(rows, start=1):
            cells = []
            for c, value in enumerate(row):
                if value is None:
                    continue
                ref = "%s%d" % (col_letter(c), r)
                if isinstance(value, (int, float)):
                    cells.append('<c r="%s"><v>%s</v></c>' % (ref, value))
                else:
                    cells.append('<c r="%s" t="s"><v>%d</v></c>' % (ref, sid(str(value))))
            parts.append('<row r="%d">%s</row>' % (r, "".join(cells)))
        parts.append("</sheetData></worksheet>")
        sheet_xml.append("".join(parts))

    workbook = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>']
    for i, (name, _) in enumerate(sheets, start=1):
        workbook.append('<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (name, i, i))
    workbook.append("</sheets></workbook>")

    shared_xml = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
                  '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="%d" uniqueCount="%d">'
                  % (len(shared), len(shared))]
    for text in shared:
        escaped = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        shared_xml.append("<si><t>%s</t></si>" % escaped)
    shared_xml.append("</sst>")

    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                     '<Default Extension="xml" ContentType="application/xml"/>'
                     '<Override PartName="/xl/workbook.xml" '
                     'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                     + "".join('<Override PartName="/xl/worksheets/sheet%d.xml" '
                               'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % i
                               for i in range(1, len(sheets) + 1))
                     + '<Override PartName="/xl/sharedStrings.xml" '
                       'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
                       '</Types>')

    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="xl/workbook.xml"/></Relationships>')

    wb_rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
               '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">']
    for i in range(1, len(sheets) + 1):
        wb_rels.append('<Relationship Id="rId%d" '
                       'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                       'Target="worksheets/sheet%d.xml"/>' % (i, i))
    wb_rels.append('<Relationship Id="rId%d" '
                   'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" '
                   'Target="sharedStrings.xml"/>' % (len(sheets) + 1))
    wb_rels.append("</Relationships>")

    files = [
        ("[Content_Types].xml", content_types),
        ("_rels/.rels", rels),
        ("xl/workbook.xml", "".join(workbook)),
        ("xl/_rels/workbook.xml.rels", "".join(wb_rels)),
        ("xl/sharedStrings.xml", "".join(shared_xml)),
    ]
    for i, xml in enumerate(sheet_xml, start=1):
        files.append(("xl/worksheets/sheet%d.xml" % i, xml))

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files:
            z.writestr(name, data)


SHEET_ROWS = [
    ["Item Code", "Description", "Brand", "Category", "Sub Category", "UOM", "Cost Price",
     "Selling Price", "Opening Stock", "Barcode", "Tax %", "Reorder Level"],
    ["FLT-001", "Air Filter Element", "Sakura", "Filters", "Air", "pcs", 280, 420, 40, "8901234567890", 17, 10],
    ["FLT-002", "Cabin Filter Carbon", "Sakura", "Filters", "Cabin", "pcs", 520, 780, 12, "8901234567891", 17, 5],
    ["BRK-010", "Brake Disc 280mm", "Brembo", "Brakes", "Discs", "pair", 4200, 5900, 6, "", 17, 2],
    ["ENG-220", "Engine Oil 5W-30 4L", "Shell", "Fluids", "Engine Oil", "litre", 3400, 4600, 24, "8901234567892", 0, 6],
    ["ELE-330", "Fuse 15A", "Bosch", "Electrical", "Fuses", "box", 60, 120, 100, "8901234567893", 17, 20],
]

SECOND_SHEET = [
    ["Notes"],
    ["This sheet is not inventory and should be ignored by the operator."],
]


def main():
    build_parts_pdf(os.path.join(HERE, "parts-list.pdf"))
    build_scanned_pdf(os.path.join(HERE, "scanned.pdf"))
    make_xlsx(os.path.join(HERE, "inventory.xlsx"), [
        ("Inventory", SHEET_ROWS),
        ("Notes", SECOND_SHEET),
    ])

    csv_semicolon = (
        "\ufeffItem Code;Item Name;Brand;Category;Qty;Cost;Price;Barcode\n"
        "SC-001;\"Oil Seal, Front\";\"NOK\";Seals;15;\"1.250,50\";1900;8901111111111\n"
        "SC-002;Brake Shoe Set;\"Bosch\";Brakes;9;2100;3100;8901111111112\n"
        "SC-003;\"Hose \"\"Radiator\"\"\";Gates;Cooling;7;850;1400;\n"
    )
    open(os.path.join(HERE, "inventory-semicolon.csv"), "w", encoding="utf-8", newline="").write(csv_semicolon)

    csv_plain = (
        "SKU,Name,Category,Unit,Cost,Price,Qty\n"
        "PL-001,Engine Mount,Tyres,pcs,1200,1800,5\n"
        "PL-002,Engine Mount Rear,Tyres,pcs,1300,1950,4\n"
    )
    open(os.path.join(HERE, "inventory-plain.csv"), "w", encoding="utf-8", newline="").write(csv_plain)

    for name in ("parts-list.pdf", "scanned.pdf", "inventory.xlsx",
                 "inventory-semicolon.csv", "inventory-plain.csv"):
        path = os.path.join(HERE, name)
        print("%-28s %6d bytes" % (name, os.path.getsize(path)))


if __name__ == "__main__":
    import zipfile  # noqa: E402  (kept local so the PDF path needs no imports)
    main()
