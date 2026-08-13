import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 32,
  },
  brand: { fontSize: 18, fontWeight: 700 },
  metaBlock: { alignItems: "flex-end" },
  metaText: { fontSize: 10, color: "#666666" },
  title: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 12, color: "#666666", marginBottom: 24 },
  rowHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#dddddd",
    paddingBottom: 6,
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#eeeeee",
  },
  colTitle: { flex: 1 },
  colSum: { width: 110, textAlign: "right" },
  headerText: { fontSize: 9, textTransform: "uppercase", color: "#888888", letterSpacing: 0.5 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "baseline",
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
  },
  totalLabel: { fontSize: 13, fontWeight: 700, marginRight: 24 },
  totalValue: { fontSize: 15, fontWeight: 700 },
  vatNote: { fontSize: 9, color: "#888888", textAlign: "right", marginTop: 4 },
});

// Bevisst ikke toLocaleString("nb-NO") her: den bruker et unicode minustegn
// (U+2212) og hardt mellomrom (U+00A0) som standardfonten Helvetica i
// react-pdf/pdfkit ikke har glyffer for — minustegnet på rabattlinjer
// forsvant sporløst i PDF-en. Bygger tallet manuelt med vanlige ASCII-tegn.
function formatMoney(n: number) {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  const digits = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${digits} kr`;
}

export interface QuoteLine {
  title: string;
  sum: number;
}

export async function generateQuotePdf({
  companyName,
  dealTitle,
  dateLabel,
  lines,
}: {
  companyName: string;
  dealTitle: string;
  dateLabel: string;
  lines: QuoteLine[];
}): Promise<Buffer> {
  const total = lines.reduce((acc, l) => acc + l.sum, 0);

  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>Cure</Text>
          <View style={styles.metaBlock}>
            <Text style={styles.metaText}>{companyName}</Text>
            <Text style={styles.metaText}>{dateLabel}</Text>
          </View>
        </View>

        <Text style={styles.title}>Pristilbud</Text>
        <Text style={styles.subtitle}>{dealTitle}</Text>

        <View style={styles.rowHeader}>
          <Text style={[styles.colTitle, styles.headerText]}>Beskrivelse</Text>
          <Text style={[styles.colSum, styles.headerText]}>Pris</Text>
        </View>
        {lines.map((l, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.colTitle}>{l.title}</Text>
            <Text style={styles.colSum}>{formatMoney(l.sum)}</Text>
          </View>
        ))}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Totalt eks. mva</Text>
          <Text style={styles.totalValue}>{formatMoney(total)}</Text>
        </View>
        <Text style={styles.vatNote}>Inkl. mva (25 %): {formatMoney(total * 1.25)}</Text>
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
