import { Note, NoteType } from '../types';

export function exportAsMarkdown(notes: Note[]): string {
  return notes.map(note => {
    const title = note.title || 'Untitled';
    const typeLabel = note.type || 'NOTE';
    const tags = note.tags?.length ? note.tags.map(t => `#${t}`).join(' ') : '';
    const created = new Date(note.createdAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
    const meta = [`Type: ${typeLabel}`, tags ? `Tags: ${tags}` : '', `Created: ${created}`]
      .filter(Boolean).join(' | ');

    return `## ${title}\n${note.content}\n\n${meta}\n---`;
  }).join('\n\n');
}

export function exportAsCSV(notes: Note[]): string {
  const header = 'title,content,type,tags,created,dueDate,priority,completed';
  const escapeCSV = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const rows = notes.map(note => {
    const title = escapeCSV(note.title || '');
    const content = escapeCSV(note.content);
    const type = note.type || 'NOTE';
    const tags = escapeCSV(note.tags?.join(';') || '');
    const created = new Date(note.createdAt).toISOString();
    const dueDate = note.dueDate ? new Date(note.dueDate).toISOString() : '';
    const priority = note.priority || '';
    const completed = note.isCompleted ? 'yes' : 'no';
    return `${title},${content},${type},${tags},${created},${dueDate},${priority},${completed}`;
  });

  return [header, ...rows].join('\n');
}

export function validateImport(data: unknown): { valid: boolean; notes: Note[]; errors: string[] } {
  const errors: string[] = [];
  const validNotes: Note[] = [];

  if (!Array.isArray(data)) {
    return { valid: false, notes: [], errors: ['File must contain a JSON array'] };
  }

  data.forEach((item: unknown, index: number) => {
    if (typeof item !== 'object' || item === null) {
      errors.push(`Item ${index + 1}: not a valid object`);
      return;
    }

    const obj = item as Record<string, unknown>;

    if (typeof obj.id !== 'string' || !obj.id) {
      errors.push(`Item ${index + 1}: missing or invalid 'id'`);
      return;
    }
    if (typeof obj.content !== 'string' || !obj.content) {
      errors.push(`Item ${index + 1}: missing or invalid 'content'`);
      return;
    }
    if (typeof obj.createdAt !== 'number') {
      errors.push(`Item ${index + 1}: missing or invalid 'createdAt'`);
      return;
    }
    if (typeof obj.isProcessed !== 'boolean') {
      errors.push(`Item ${index + 1}: missing or invalid 'isProcessed'`);
      return;
    }

    // Valid note - pass through all fields
    validNotes.push(obj as unknown as Note);
  });

  return {
    valid: validNotes.length > 0,
    notes: validNotes,
    errors,
  };
}
