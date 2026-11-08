/**
 * CouturPro — Moteur de Génération de Documents PDF 1.4 Natifs (Zero-Dependency)
 * Conforme au standard Adobe PDF 1.4 / ISO 32000-1.
 * 100% exécuté côté client en mémoire (TypedArrays / Uint8Array).
 * Fonctionne intégralement hors-ligne sur Android, iPhone/iPad, Windows, Mac et Linux.
 * Génère de véritables fichiers binaires .pdf (MIME: application/pdf) lisibles par tous les lecteurs PDF.
 */

// Table de correspondance WinAnsi (Code Page 1252) pour la typographie française & ouest-africaine
const WIN_ANSI_MAP: Record<string, number> = {
  "€": 0x80,
  "’": 0x92,
  "‘": 0x91,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "°": 0xb0,
  "±": 0xb1,
  "²": 0xb2,
  "³": 0xb3,
  "µ": 0xb5,
  "À": 0xc0,
  "Á": 0xc1,
  "Â": 0xc2,
  "Ã": 0xc3,
  "Ä": 0xc4,
  "Å": 0xc5,
  "Æ": 0xc6,
  "Ç": 0xc7,
  "È": 0xc8,
  "É": 0xc9,
  "Ê": 0xca,
  "Ë": 0xcb,
  "Ì": 0xcc,
  "Í": 0xcd,
  "Î": 0xce,
  "Ï": 0xcf,
  "Ð": 0xd0,
  "Ñ": 0xd1,
  "Ò": 0xd2,
  "Ó": 0xd3,
  "Ô": 0xd4,
  "Õ": 0xd5,
  "Ö": 0xd6,
  "Ø": 0xd8,
  "Ù": 0xd9,
  "Ú": 0xda,
  "Û": 0xdb,
  "Ü": 0xdc,
  "Ý": 0xdd,
  "Þ": 0xde,
  "ß": 0xdf,
  "à": 0xe0,
  "á": 0xe1,
  "â": 0xe2,
  "ã": 0xe3,
  "ä": 0xe4,
  "å": 0xe5,
  "æ": 0xe6,
  "ç": 0xe7,
  "è": 0xe8,
  "é": 0xe9,
  "ê": 0xea,
  "ë": 0xeb,
  "ì": 0xec,
  "í": 0xed,
  "î": 0xee,
  "ï": 0xef,
  "ð": 0xf0,
  "ñ": 0xf1,
  "ò": 0xf2,
  "ó": 0xf3,
  "ô": 0xf4,
  "õ": 0xf5,
  "ö": 0xf6,
  "ø": 0xf8,
  "ù": 0xf9,
  "ú": 0xfa,
  "û": 0xfb,
  "ü": 0xfc,
  "ý": 0xfd,
  "þ": 0xfe,
  "ÿ": 0xff,
  "œ": 0x9c,
  "Œ": 0x8c,
};

export function encodePdfText(str: string | number | null | undefined): string {
  if (str === null || str === undefined) return "";
  const s = String(str);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") {
      out += "\\(";
    } else if (ch === ")") {
      out += "\\)";
    } else if (ch === "\\") {
      out += "\\\\";
    } else {
      const code = ch.charCodeAt(0);
      if (code >= 32 && code <= 126) {
        out += ch;
      } else if (WIN_ANSI_MAP[ch] !== undefined) {
        const byte = WIN_ANSI_MAP[ch];
        out += "\\" + byte.toString(8).padStart(3, "0");
      } else if (code <= 255) {
        out += "\\" + code.toString(8).padStart(3, "0");
      } else {
        out += " ";
      }
    }
  }
  return out;
}

export type RgbColor = [number, number, number];

export interface PdfTableColumn {
  header: string;
  width: number;
  align?: "left" | "right" | "center";
  bold?: boolean;
  color?: RgbColor;
}

export interface SummaryCardItem {
  label: string;
  value: string;
  color?: RgbColor;
}

export interface PdfDocumentOptions {
  title: string;
  subtitle?: string;
  businessName: string;
  dateStr?: string;
  orientation?: "portrait" | "landscape";
}

export class PdfDocument {
  public title: string;
  public subtitle: string;
  public businessName: string;
  public dateStr: string;

  public pageWidth: number;
  public pageHeight: number;
  public margin = 36;
  public contentWidth: number;

  private pages: string[] = [];
  private currentCommands: string[] = [];
  public cursorY: number;

  constructor(options: PdfDocumentOptions) {
    this.title = options.title || "Rapport d'Atelier";
    this.subtitle = options.subtitle || "";
    this.businessName = options.businessName || "Atelier CouturPro";
    this.dateStr =
      options.dateStr ||
      new Date().toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

    if (options.orientation === "landscape") {
      this.pageWidth = 841.89;
      this.pageHeight = 595.28;
    } else {
      this.pageWidth = 595.28;
      this.pageHeight = 841.89;
    }

    this.contentWidth = this.pageWidth - 2 * this.margin;
    this.cursorY = this.pageHeight - this.margin;

    this.startNewPage(true);
  }

  public startNewPage(isFirst = false): void {
    if (this.currentCommands.length > 0) {
      this.pages.push(this.currentCommands.join("\n"));
      this.currentCommands = [];
    }

    this.cursorY = this.pageHeight - this.margin;

    if (isFirst) {
      this.drawMainHeader();
    } else {
      this.drawRunningHeader();
    }
  }

  private drawMainHeader(): void {
    // Fond bandeau supérieur (bleu marine / ardoise élégant)
    this.drawRect(this.margin, this.cursorY - 54, this.contentWidth, 54, [0.08, 0.12, 0.22], true);

    // Titre de l'atelier
    this.drawText(
      this.businessName.toUpperCase(),
      this.margin + 14,
      this.cursorY - 20,
      13,
      "bold",
      [1, 1, 1]
    );

    // Titre du document
    this.drawText(
      this.title,
      this.margin + 14,
      this.cursorY - 38,
      11,
      "bold",
      [0.85, 0.9, 1]
    );

    // Date & label à droite
    this.drawText(
      `Édité le ${this.dateStr}`,
      this.pageWidth - this.margin - 14,
      this.cursorY - 22,
      9,
      "regular",
      [0.8, 0.85, 0.92],
      "right"
    );
    this.drawText(
      "COUTURPRO v2.0 • DOCUMENT OFFICIEL",
      this.pageWidth - this.margin - 14,
      this.cursorY - 38,
      7.5,
      "bold",
      [0.65, 0.75, 0.9],
      "right"
    );

    this.cursorY -= 70;
  }

  private drawRunningHeader(): void {
    this.drawText(
      this.businessName,
      this.margin,
      this.cursorY - 10,
      9,
      "bold",
      [0.3, 0.35, 0.4]
    );
    this.drawText(
      this.title,
      this.margin + 140,
      this.cursorY - 10,
      8.5,
      "italic",
      [0.4, 0.45, 0.5]
    );
    this.drawText(
      `Date: ${this.dateStr}`,
      this.pageWidth - this.margin,
      this.cursorY - 10,
      8,
      "regular",
      [0.5, 0.5, 0.5],
      "right"
    );

    this.drawLine(
      this.margin,
      this.cursorY - 16,
      this.pageWidth - this.margin,
      this.cursorY - 16,
      [0.8, 0.85, 0.9],
      0.75
    );
    this.cursorY -= 30;
  }

  public addSummaryCards(cards: SummaryCardItem[]): void {
    if (!cards || cards.length === 0) return;

    const cardHeight = 44;
    const gap = 8;
    const cardWidth = (this.contentWidth - (cards.length - 1) * gap) / cards.length;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const x = this.margin + i * (cardWidth + gap);
      const y = this.cursorY - cardHeight;

      // Fond de la carte
      this.drawRect(x, y, cardWidth, cardHeight, [0.96, 0.97, 0.99], true);
      this.drawRect(x, y, cardWidth, cardHeight, [0.85, 0.88, 0.92], false, 0.5);

      // Indicateur latéral de couleur
      const color = card.color || [0.2, 0.4, 0.8];
      this.drawRect(x, y, 3.5, cardHeight, color, true);

      // Libellé & valeur
      this.drawText(
        card.label.toUpperCase(),
        x + 8,
        y + cardHeight - 14,
        7,
        "bold",
        [0.4, 0.45, 0.5]
      );
      this.drawText(
        card.value,
        x + 8,
        y + 10,
        11,
        "bold",
        [0.1, 0.15, 0.22]
      );
    }

    this.cursorY -= cardHeight + 14;
  }

  public addSectionTitle(title: string): void {
    if (this.cursorY < this.margin + 60) {
      this.startNewPage();
    }
    this.drawText(title, this.margin, this.cursorY - 12, 11, "bold", [0.1, 0.15, 0.25]);
    this.drawLine(
      this.margin,
      this.cursorY - 16,
      this.pageWidth - this.margin,
      this.cursorY - 16,
      [0.2, 0.4, 0.8],
      1.5
    );
    this.cursorY -= 26;
  }

  public ensureSpace(neededHeight: number): void {
    if (this.cursorY - neededHeight < this.margin + 35) {
      this.startNewPage();
    }
  }

  public addClientHeader(name: string, contactInfo: string): void {
    this.ensureSpace(42);
    // Fond bandeau client sobre et distingué
    this.drawRect(this.margin, this.cursorY - 32, this.contentWidth, 32, [0.93, 0.95, 0.98], true);
    this.drawRect(this.margin, this.cursorY - 32, 4, 32, [0.55, 0.27, 0.07], true); // Accent brun atelier
    this.drawRect(this.margin, this.cursorY - 32, this.contentWidth, 32, [0.82, 0.86, 0.92], false, 0.5);

    this.drawText(name.toUpperCase(), this.margin + 12, this.cursorY - 14, 10, "bold", [0.1, 0.15, 0.25]);
    if (contactInfo) {
      this.drawText(contactInfo, this.margin + 12, this.cursorY - 26, 7.5, "regular", [0.35, 0.4, 0.48]);
    }
    this.cursorY -= 40;
  }

  public addParagraph(text: string): void {
    if (this.cursorY < this.margin + 40) {
      this.startNewPage();
    }
    this.drawText(text, this.margin, this.cursorY - 10, 8.5, "regular", [0.25, 0.3, 0.35]);
    this.cursorY -= 18;
  }

  public addTable(columns: PdfTableColumn[], rows: string[][]): void {
    const headerHeight = 22;
    const rowHeight = 20;

    const renderHeader = () => {
      // Fond d'en-tête de tableau
      this.drawRect(
        this.margin,
        this.cursorY - headerHeight,
        this.contentWidth,
        headerHeight,
        [0.93, 0.95, 0.98],
        true
      );
      this.drawRect(
        this.margin,
        this.cursorY - headerHeight,
        this.contentWidth,
        headerHeight,
        [0.8, 0.84, 0.88],
        false,
        0.75
      );

      let curX = this.margin;
      for (const col of columns) {
        const textX =
          col.align === "right"
            ? curX + col.width - 6
            : col.align === "center"
            ? curX + col.width / 2
            : curX + 6;

        this.drawText(
          col.header.toUpperCase(),
          textX,
          this.cursorY - 15,
          7.5,
          "bold",
          [0.22, 0.28, 0.36],
          col.align || "left"
        );
        curX += col.width;
      }
      this.cursorY -= headerHeight;
    };

    renderHeader();

    for (let r = 0; r < rows.length; r++) {
      if (this.cursorY - rowHeight < this.margin + 35) {
        this.startNewPage();
        renderHeader();
      }

      const row = rows[r];
      const isEven = r % 2 === 0;

      // Alternance de fond (zebra)
      if (isEven) {
        this.drawRect(
          this.margin,
          this.cursorY - rowHeight,
          this.contentWidth,
          rowHeight,
          [0.98, 0.985, 0.99],
          true
        );
      }

      // Ligne séparatrice
      this.drawLine(
        this.margin,
        this.cursorY - rowHeight,
        this.margin + this.contentWidth,
        this.cursorY - rowHeight,
        [0.9, 0.92, 0.94],
        0.5
      );

      let curX = this.margin;
      for (let c = 0; c < columns.length; c++) {
        const col = columns[c];
        const val = row[c] || "";
        const textX =
          col.align === "right"
            ? curX + col.width - 6
            : col.align === "center"
            ? curX + col.width / 2
            : curX + 6;

        // Troncature sécurisée en fonction de la largeur de la colonne
        let displayVal = String(val);
        const maxLen = Math.max(6, Math.floor(col.width / 5.2));
        if (displayVal.length > maxLen) {
          displayVal = displayVal.substring(0, maxLen - 1) + "…";
        }

        const font = col.bold ? "bold" : "regular";
        const color = col.color || [0.15, 0.18, 0.22];
        this.drawText(displayVal, textX, this.cursorY - 14, 8, font, color, col.align || "left");

        curX += col.width;
      }

      this.cursorY -= rowHeight;
    }

    this.cursorY -= 14;
  }

  public drawText(
    text: string,
    x: number,
    y: number,
    size = 10,
    fontStyle: "regular" | "bold" | "italic" = "regular",
    color: RgbColor = [0, 0, 0],
    align: "left" | "right" | "center" = "left"
  ): void {
    const fontId =
      fontStyle === "bold" ? "/F2" : fontStyle === "italic" ? "/F3" : "/F1";
    const escaped = encodePdfText(text);
    const r = color[0].toFixed(2);
    const g = color[1].toFixed(2);
    const b = color[2].toFixed(2);

    let adjustedX = x;
    if (align === "right" || align === "center") {
      const approxWidth = text.length * (size * 0.52);
      if (align === "right") adjustedX = x - approxWidth;
      else if (align === "center") adjustedX = x - approxWidth / 2;
    }

    this.currentCommands.push(`
BT
${fontId} ${size} Tf
${r} ${g} ${b} rg
${adjustedX.toFixed(2)} ${y.toFixed(2)} Td
(${escaped}) Tj
ET`);
  }

  public drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color: RgbColor = [0.9, 0.9, 0.9],
    fill = true,
    strokeWidth = 1
  ): void {
    const r = color[0].toFixed(2);
    const g = color[1].toFixed(2);
    const b = color[2].toFixed(2);

    if (fill) {
      this.currentCommands.push(`
${r} ${g} ${b} rg
${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re
f`);
    } else {
      this.currentCommands.push(`
${r} ${g} ${b} RG
${strokeWidth.toFixed(2)} w
${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re
S`);
    }
  }

  public drawLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: RgbColor = [0.8, 0.8, 0.8],
    width = 1
  ): void {
    const r = color[0].toFixed(2);
    const g = color[1].toFixed(2);
    const b = color[2].toFixed(2);

    this.currentCommands.push(`
${r} ${g} ${b} RG
${width.toFixed(2)} w
${x1.toFixed(2)} ${y1.toFixed(2)} m
${x2.toFixed(2)} ${y2.toFixed(2)} l
S`);
  }

  /**
   * Construit la chaîne binaire conforme PDF 1.4
   */
  public generateBinaryString(): string {
    if (this.currentCommands.length > 0) {
      this.pages.push(this.currentCommands.join("\n"));
      this.currentCommands = [];
    }

    const totalPages = Math.max(1, this.pages.length);

    // Pied de page numéroté sur chaque page (ex: Page 1 sur 3)
    const finalPageStreams = this.pages.map((stream, idx) => {
      const pageNum = idx + 1;
      const footerY = 22;
      const footer = `
0.85 0.88 0.92 RG
0.5 w
${this.margin} ${footerY + 14} m
${this.pageWidth - this.margin} ${footerY + 14} l
S
BT
/F1 7.5 Tf
0.45 0.5 0.55 rg
${this.margin} ${footerY} Td
(${encodePdfText(`${this.businessName} • CouturPro v2.0 • Document officiel certifié`)}) Tj
ET
BT
/F2 7.5 Tf
0.3 0.35 0.4 rg
${this.pageWidth - this.margin - 80} ${footerY} Td
(${encodePdfText(`Page ${pageNum} sur ${totalPages}`)}) Tj
ET`;
      return `${stream}\n${footer}`.trim();
    });

    const objects: { id: number; body: string }[] = [];
    const catalogObjId = 1;
    const pagesObjId = 2;
    const fontRegularId = 3;
    const fontBoldId = 4;
    const fontItalicId = 5;

    let nextId = 6;
    const pageObjIds: number[] = [];
    const contentObjIds: number[] = [];

    for (let i = 0; i < totalPages; i++) {
      pageObjIds.push(nextId++);
      contentObjIds.push(nextId++);
    }

    objects.push({
      id: catalogObjId,
      body: `<< /Type /Catalog /Pages ${pagesObjId} 0 R >>`,
    });

    objects.push({
      id: pagesObjId,
      body: `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${totalPages} >>`,
    });

    objects.push({
      id: fontRegularId,
      body: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    });

    objects.push({
      id: fontBoldId,
      body: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
    });

    objects.push({
      id: fontItalicId,
      body: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>`,
    });

    for (let i = 0; i < totalPages; i++) {
      const pageId = pageObjIds[i];
      const contentId = contentObjIds[i];
      const stream = finalPageStreams[i];
      const streamLength = stream.length;

      objects.push({
        id: pageId,
        body: `<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R /F3 ${fontItalicId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      });

      objects.push({
        id: contentId,
        body: `<< /Length ${streamLength} >>\nstream\n${stream}\nendstream`,
      });
    }

    objects.sort((a, b) => a.id - b.id);

    let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets: number[] = [];

    for (const obj of objects) {
      offsets[obj.id] = pdf.length;
      pdf += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
    }

    const xrefOffset = pdf.length;
    const totalObjs = objects.length + 1;
    pdf += `xref\n0 ${totalObjs}\n`;
    pdf += "0000000000 65535 f \n";
    for (let i = 1; i < totalObjs; i++) {
      const off = offsets[i] || 0;
      pdf += `${off.toString().padStart(10, "0")} 00000 n \n`;
    }

    pdf += `trailer\n<< /Size ${totalObjs} /Root ${catalogObjId} 0 R >>\n`;
    pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

    return pdf;
  }

  /**
   * Génère les octets binaires Uint8Array (compatibilité 8-bit WinAnsi ISO-8859-1)
   */
  public generateBytes(): Uint8Array {
    const binaryStr = this.generateBinaryString();
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i) & 0xff;
    }
    return bytes;
  }

  /**
   * Génère un véritable Blob application/pdf
   */
  public generateBlob(): Blob {
    const bytes = this.generateBytes();
    return new Blob([bytes], { type: "application/pdf" });
  }

  /**
   * Déclenche le téléchargement direct du fichier .pdf
   */
  public download(filename: string): void {
    const cleanFilename = filename.toLowerCase().endsWith(".pdf")
      ? filename
      : `${filename}.pdf`;
    const blob = this.generateBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = cleanFilename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}
