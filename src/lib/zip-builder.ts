/**
 * CouturPro — Moteur de Génération d'Archive ZIP 100% Client-Side (Zero-Dependency)
 * Implémentation conforme PKZIP 2.0 (Store).
 * Fonctionne intégralement hors-ligne sur Android, iOS, Windows et Mac.
 */

// Table pré-calculée CRC-32 (Polynôme 0xEDB88320)
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

function calculateCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function getDosDateTime(date: Date = new Date()): { time: number; date: number } {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const d =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, date: d };
}

interface ZipEntry {
  filename: string;
  data: Uint8Array;
  crc32: number;
  offset: number;
}

export class SimpleZip {
  private files: { name: string; content: Uint8Array }[] = [];
  private textEncoder = new TextEncoder();

  /**
   * Ajoute un fichier texte ou binaire dans l'archive
   */
  public addFile(filename: string, content: string | Uint8Array): this {
    const data =
      typeof content === "string" ? this.textEncoder.encode(content) : content;
    this.files.push({ name: filename, content: data });
    return this;
  }

  /**
   * Génère le Blob binaire ZIP (application/zip)
   */
  public generateBlob(): Blob {
    const entries: ZipEntry[] = [];
    const localHeaders: Uint8Array[] = [];
    let currentOffset = 0;

    const { time: dosTime, date: dosDate } = getDosDateTime();

    // 1. Écriture des Local File Headers et des données
    for (const file of this.files) {
      const nameBytes = this.textEncoder.encode(file.name);
      const crc = calculateCrc32(file.content);
      const size = file.content.length;

      // Header local de 30 octets
      const header = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(header.buffer);

      view.setUint32(0, 0x04034b50, true); // Signature Local File Header
      view.setUint16(4, 20, true); // Version minimale (2.0)
      view.setUint16(6, 0x0800, true); // Bit 11 activé : Nom encodé en UTF-8
      view.setUint16(8, 0, true); // Compression = 0 (Store)
      view.setUint16(10, dosTime, true);
      view.setUint16(12, dosDate, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, size, true); // Taille compressée
      view.setUint32(22, size, true); // Taille décompressée
      view.setUint16(26, nameBytes.length, true);
      view.setUint16(28, 0, true); // Extra field length

      header.set(nameBytes, 30);

      entries.push({
        filename: file.name,
        data: file.content,
        crc32: crc,
        offset: currentOffset,
      });

      localHeaders.push(header);
      localHeaders.push(file.content);
      currentOffset += header.length + size;
    }

    // 2. Écriture du Central Directory
    const centralHeaders: Uint8Array[] = [];
    const centralDirStartOffset = currentOffset;
    let centralDirSize = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const nameBytes = this.textEncoder.encode(entry.filename);
      const size = entry.data.length;

      // Header Central Directory de 46 octets
      const cHeader = new Uint8Array(46 + nameBytes.length);
      const cView = new DataView(cHeader.buffer);

      cView.setUint32(0, 0x02014b50, true); // Signature Central Directory
      cView.setUint16(4, 20, true); // Version made by
      cView.setUint16(6, 20, true); // Version needed
      cView.setUint16(8, 0x0800, true); // Bit 11 : UTF-8
      cView.setUint16(10, 0, true); // Compression = 0
      cView.setUint16(12, dosTime, true);
      cView.setUint16(14, dosDate, true);
      cView.setUint32(16, entry.crc32, true);
      cView.setUint32(20, size, true);
      cView.setUint32(24, size, true);
      cView.setUint16(28, nameBytes.length, true);
      cView.setUint16(30, 0, true); // Extra field length
      cView.setUint16(32, 0, true); // Comment length
      cView.setUint16(34, 0, true); // Disk number start
      cView.setUint16(36, 0, true); // Internal attributes
      cView.setUint32(38, 0, true); // External attributes
      cView.setUint32(42, entry.offset, true); // Offset du Local Header

      cHeader.set(nameBytes, 46);

      centralHeaders.push(cHeader);
      centralDirSize += cHeader.length;
    }

    // 3. Écriture du End of Central Directory Record (EOCD) (22 octets)
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);

    eocdView.setUint32(0, 0x06054b50, true); // Signature EOCD
    eocdView.setUint16(4, 0, true); // Disk number
    eocdView.setUint16(6, 0, true); // Central dir disk
    eocdView.setUint16(8, entries.length, true); // Entrées sur ce disque
    eocdView.setUint16(10, entries.length, true); // Nombre total d'entrées
    eocdView.setUint32(12, centralDirSize, true); // Taille du Central Dir
    eocdView.setUint32(16, centralDirStartOffset, true); // Offset du début du Central Dir
    eocdView.setUint16(20, 0, true); // Longueur du commentaire

    const totalParts = [...localHeaders, ...centralHeaders, eocd];
    return new Blob(totalParts, { type: "application/zip" });
  }
}
