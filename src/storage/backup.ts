/**
 * Export / import of study state.
 *
 * This is the safety net for the non-durable storage tiers, and the only way
 * to move progress between the hosted build and the single-file one, so the
 * format is plain versioned JSON with no cleverness.
 */
import type { CardProgress, SchedulerSettings } from '../scheduler/fsrs';
import type { DailyCounts, ExamResult, ReviewLogEntry, ProgressRepository } from './progress';

export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: 'nce-study-backup';
  version: number;
  exportedAt: string;
  progress: Record<string, CardProgress>;
  settings: SchedulerSettings;
  daily: DailyCounts;
  log: ReviewLogEntry[];
  exams: ExamResult[];
}

export function buildBackup(repo: ProgressRepository): BackupFile {
  const snapshot = repo.snapshot();
  return {
    format: 'nce-study-backup',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    ...snapshot,
  };
}

export function serializeBackup(repo: ProgressRepository): string {
  return JSON.stringify(buildBackup(repo), null, 2);
}

export class BackupParseError extends Error {}

export function parseBackup(raw: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BackupParseError('File is not valid JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new BackupParseError('Backup must be a JSON object.');
  }

  const data = parsed as Partial<BackupFile>;

  if (data.format !== 'nce-study-backup') {
    throw new BackupParseError('Not an NCE study backup file.');
  }
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    throw new BackupParseError(
      `Backup version ${String(data.version)} is newer than this app supports (${BACKUP_VERSION}).`,
    );
  }
  if (typeof data.progress !== 'object' || data.progress === null) {
    throw new BackupParseError('Backup is missing progress data.');
  }

  return {
    format: 'nce-study-backup',
    version: data.version,
    exportedAt: data.exportedAt ?? new Date().toISOString(),
    progress: data.progress,
    settings: data.settings as SchedulerSettings,
    daily: data.daily ?? { date: '', new: 0, review: 0 },
    log: data.log ?? [],
    // Absent in backups written before practice-test history existed.
    exams: data.exams ?? [],
  };
}

export function downloadBackup(repo: ProgressRepository): void {
  const blob = new Blob([serializeBackup(repo)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nce-study-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
