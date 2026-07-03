/**
 * Formatting + document-insertion helpers for citation lookup results.
 *
 * Author name shape differs by source: OpenAlex returns "First Middle Last",
 * PubMed returns "Last Initials" (e.g. "Smith JA"). We special-case PubMed so
 * the last name is extracted correctly either way.
 */

export interface CitationMetadata {
  authors?: string[];
  year?: string | number;
  title?: string;
  doi?: string;
  // Present for source_type === 'archive' citations (see backend
  // adaptive_draft.py's _persist_archive_citations).
  archive_id?: string;
  section_type?: string;
  grant_title?: string;
}

export interface InsertableCitation {
  id?: string;
  formatted_citation?: string;
  source_type?: string;
  url?: string;
  // For source_type === 'archive', this is the ProposalSection.id to open in the
  // archive-section pane — see CitationsPanel's "View source" action.
  external_id?: string;
  metadata?: CitationMetadata;
}

function parseAuthorName(raw: string, sourceType?: string): { first: string; last: string } {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: '', last: parts[0] };
  if (sourceType === 'pubmed') {
    // "Smith JA" -> last name first, remaining tokens are initials
    return { first: parts.slice(1).join(' '), last: parts[0] };
  }
  // "John A. Smith" -> last token is the surname
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

function citationYear(citation: InsertableCitation): string {
  const y = citation.metadata?.year;
  return y ? String(y) : '';
}

/** Renders "(Smith, 2020)" / "(Smith & Jones, 2020)" / "(Smith et al., 2020)". */
export function formatInlineCitation(citation: InsertableCitation): string {
  const authors = citation.metadata?.authors || [];
  const year = citationYear(citation);
  const lastNames = authors.map((a) => parseAuthorName(a, citation.source_type).last).filter(Boolean);

  let who: string;
  if (lastNames.length === 0) who = 'Anonymous';
  else if (lastNames.length === 1) who = lastNames[0];
  else if (lastNames.length === 2) who = `${lastNames[0]} & ${lastNames[1]}`;
  else who = `${lastNames[0]} et al.`;

  return year ? `(${who}, ${year})` : `(${who}, n.d.)`;
}

/** Renders a simplified MLA 9-style works-cited entry from available metadata. */
export function formatMlaCitation(citation: InsertableCitation): string {
  const authors = citation.metadata?.authors || [];
  const year = citationYear(citation);
  const title = citation.metadata?.title || '';
  const link = citation.metadata?.doi
    ? `https://doi.org/${citation.metadata.doi}`
    : citation.url || '';

  const parsed = authors.map((a) => parseAuthorName(a, citation.source_type));
  let authorSegment = '';
  if (parsed.length === 1) {
    authorSegment = parsed[0].first ? `${parsed[0].last}, ${parsed[0].first}.` : `${parsed[0].last}.`;
  } else if (parsed.length === 2) {
    const a1 = parsed[0].first ? `${parsed[0].last}, ${parsed[0].first}` : parsed[0].last;
    const a2 = parsed[1].first ? `${parsed[1].first} ${parsed[1].last}` : parsed[1].last;
    authorSegment = `${a1}, and ${a2}.`;
  } else if (parsed.length >= 3) {
    authorSegment = parsed[0].first ? `${parsed[0].last}, ${parsed[0].first}, et al.` : `${parsed[0].last}, et al.`;
  }

  const segments = [authorSegment, title ? `"${title}."` : '', year, link].filter(Boolean);
  return segments.join(' ').trim();
}

/** Appends paragraphHtml at the end of the named section (by <h2> heading), or the document end if not found. */
export function insertParagraphIntoSection(html: string, sectionName: string, paragraphHtml: string): string {
  if (!sectionName) return html + paragraphHtml;
  const regex = new RegExp(
    `(<h2[^>]*>${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h2>)([\\s\\S]*?)(?=<h2|$)`,
    'i'
  );
  if (html.match(regex)) {
    return html.replace(regex, `$1\n${paragraphHtml}$2`);
  }
  return html + paragraphHtml;
}

/**
 * Ensures a "Bibliography" section exists (creating it at the document end if not),
 * then appends the MLA entry — skipping if this exact citation was already inserted.
 */
export function ensureBibliographyAndAppend(html: string, mlaEntry: string, dedupeKey: string): string {
  const safeKey = dedupeKey.replace(/"/g, '');
  if (html.includes(`data-citation-id="${safeKey}"`)) return html;

  const entryHtml = `<p data-citation-id="${safeKey}">${mlaEntry}</p>`;
  const bibRegex = /(<h2[^>]*>\s*Bibliography\s*<\/h2>)([\s\S]*?)(?=<h2|$)/i;
  if (html.match(bibRegex)) {
    return html.replace(bibRegex, `$1$2${entryHtml}`);
  }
  return `${html}\n<h2>Bibliography</h2>\n${entryHtml}`;
}
