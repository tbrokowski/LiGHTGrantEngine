export interface EditorSection {
  id: string;
  title: string;
  section_type: string;
  content_html: string;
  content_text: string;
  word_count: number;
  order: number;
}

export interface GrantDetail {
  id: string;
  title: string;
  funder: string | null;
  program: string | null;
  status: string;
  priority: string | null;
  pi_name: string | null;
  external_deadline: string | null;
  internal_deadline: string | null;
  call_url: string | null;
  requested_amount: number | null;
  currency: string | null;
  themes: string[];
  notes: string | null;
  call_requirements: string | null;
  editor_sections: Record<string, EditorSection>;
}
