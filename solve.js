// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader's
// {columns, rows, errors} for every {text, header}, but reads the text with
// indexOf/slice instead of one character at a time.
//
// How it stays identical: the same left-to-right walk, the same broken-row
// policy (BOM dropped, LF/CRLF record ends, blank lines are no records, a
// lone CR outside quotes is dropped with stray_cr, a quoted field runs to the
// next undoubled quote with "" one quote and CRLF/lone CR inside read as LF,
// junk after a closing quote appended as it stands with quote_junk, a quote
// that never closes is literal and the rest is re-read unquoted with
// unterminated_quote, quotes inside unquoted fields are literal, fields stay
// strings, rows padded with "" (short_row) or cut (long_row) to the first
// record's width, errors {code, line, row} in the order met with line the
// 1-based line the record starts on and row its index in rows, null for the
// header).
//
// How it gets faster: a record whose first line holds no quote and no stray
// CR is answered with one slice plus String.split(','); every other record
// is read field by field with indexOf(',') / indexOf('\n') to find each
// field's end and slices for the values, so no character is ever visited
// twice by JavaScript code and no string is built a character at a time.

/** Field ended at a comma (0), a line break (1), or the end of the text (2). */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recLine = 1;
  let recRow = null;

  // How the last field read ended, and how many characters it kept.
  let ended = END;
  let added = 0;

  // Index of the next LF at or after pos (-1: none left); unquoted fields
  // never cross it, so it is recomputed only after a quoted field spans lines.
  let lineEnd = -1;

  // Reads one unquoted field starting at pos, with `value` already collected.
  // A lone CR is dropped (stray_cr); the field ends at a comma, a line break
  // or the end of the text. Returns the field; sets ended and added.
  function unquoted(value) {
    added = 0;
    if (lineEnd !== -1 && pos > lineEnd) lineEnd = text.indexOf('\n', pos);
    const comma = text.indexOf(',', pos);
    let end;
    if (comma !== -1 && (lineEnd === -1 || comma < lineEnd)) {
      end = comma;
      ended = COMMA;
    } else if (lineEnd !== -1) {
      end = lineEnd;
      ended = LINE_BREAK;
    } else {
      end = n;
      ended = END;
    }
    // A CR just before the line break is the CRLF that ends the record.
    let stop = end;
    if (ended === LINE_BREAK && end > pos && text.charCodeAt(end - 1) === 13) stop = end - 1;
    const seg = text.slice(pos, stop);
    const cr = seg.indexOf('\r');
    if (cr === -1) {
      value += seg;
      added += seg.length;
      pos = end + (ended === END ? 0 : 1);
      if (ended === LINE_BREAK) line += 1;
      return value;
    }
    // Stray CRs inside the field: one stray_cr each, dropped from the value.
    let v = value;
    let from = 0;
    for (;;) {
      const c = seg.indexOf('\r', from);
      if (c === -1) {
        v += seg.slice(from);
        added += seg.length - from;
        break;
      }
      errors.push({ code: 'stray_cr', line: recLine, row: recRow });
      v += seg.slice(from, c);
      added += c - from;
      from = c + 1;
    }
    pos = end + (ended === END ? 0 : 1);
    if (ended === LINE_BREAK) line += 1;
    return v;
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field; sets ended.
  function quoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let q = text.indexOf('"', pos);
    let doubled = false;
    while (q !== -1 && text.charCodeAt(q + 1) === 34) {
      doubled = true;
      q = text.indexOf('"', q + 2);
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as unquoted.
      errors.push({ code: 'unterminated_quote', line: recLine, row: recRow });
      pos = open + 1;
      line = openLine;
      return unquoted('"');
    }
    let value = text.slice(open + 1, q);
    // CRLF and lone CR inside quotes each read as one LF.
    if (value.indexOf('\n') !== -1 || value.indexOf('\r') !== -1) {
      let breaks = 0;
      for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        if (c === 10) breaks += 1;
        else if (c === 13 && value.charCodeAt(i + 1) !== 10) breaks += 1;
      }
      line += breaks;
      if (value.indexOf('\r') !== -1) value = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
      if (doubled) value = value.replaceAll('""', '"');
    } else if (doubled) {
      value = value.replaceAll('""', '"');
    }
    pos = q + 1;
    if (pos >= n) {
      ended = END;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      ended = COMMA;
      return value;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      ended = LINE_BREAK;
      return value;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      ended = LINE_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const v = unquoted(value);
    if (added > 0) errors.push({ code: 'quote_junk', line: recLine, row: recRow });
    return v;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recLine = line;
    recRow = header && columns === null ? null : rows.length;

    // Fast path: a record whose first line holds no quote and no stray CR
    // is one slice plus split(','). Anything else goes field by field.
    let fields;
    let lastQuoted = false;
    const nl = text.indexOf('\n', pos);
    lineEnd = nl;
    if (nl !== -1) {
      const seg = text.slice(pos, nl);
      const dq = seg.indexOf('"');
      const cr = seg.indexOf('\r');
      if (dq === -1 && (cr === -1 || cr === seg.length - 1)) {
        fields = (cr === -1 ? seg : seg.slice(0, -1)).split(',');
        pos = nl + 1;
        line += 1;
      }
    }
    if (fields === undefined) {
      fields = [];
      do {
        const q = text.charCodeAt(pos) === 34;
        fields.push(q ? quoted() : unquoted(''));
        lastQuoted = q;
      } while (ended === COMMA);
      // A line that held only stray CRs is left with no characters: no
      // record (its stray_cr errors stay).
      if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;
    }

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
