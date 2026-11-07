import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const STATE_FILES = ['state.json', 'jobs.json', 'router.json', 'applications.json', 'profile.json',
  'whatsapp.json', 'webhook-listener.json', 'connection-session.json', 'navigation.jsonl'] as const;
const EVIDENCE = /^application-evidence\/[a-z0-9-]{1,100}\.png$/i;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE = 20_000_000;
const MAX_TOTAL = 80_000_000;
type Entry = { path: string; sha256: string; data: string };
type Archive = { version: 1; createdAt: string; files: Entry[] };
export type BackupInfo = { id: string; createdAt: string; size: number; file: string };

function hash(data: Buffer): string { return createHash('sha256').update(data).digest('hex'); }
function allowed(path: string): boolean { return (STATE_FILES as readonly string[]).includes(path) || EVIDENCE.test(path); }
function atomic(file: string, data: Buffer | string): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, data, { mode: 0o600 });
  try { renameSync(temp, file); } catch (error) { rmSync(temp, { force: true }); throw error; }
}

/** ProjectHUB state only. Browser cookies, admin key hash, and external credentials stay outside snapshots. */
export class BackupManager {
  private readonly backupDir: string;
  private readonly pendingFile: string;
  constructor(private readonly dataDir: string) {
    this.backupDir = join(dataDir, 'backups');
    this.pendingFile = join(dataDir, 'restore.pending.json');
  }
  private path(id: string): string {
    if (!ID.test(id)) throw new Error('Identificador de backup inválido');
    return join(this.backupDir, `backup-${id}.json.gz`);
  }
  private sourceFiles(): string[] {
    const paths: string[] = [...STATE_FILES].filter((name) => existsSync(join(this.dataDir, name)));
    const evidenceDir = join(this.dataDir, 'application-evidence');
    if (existsSync(evidenceDir) && lstatSync(evidenceDir).isDirectory()) {
      paths.push(...readdirSync(evidenceDir).map((name) => `application-evidence/${name}`).filter((name) => EVIDENCE.test(name)));
    }
    return paths;
  }
  create(): BackupInfo {
    let total = 0;
    const files: Entry[] = this.sourceFiles().map((path) => {
      const source = join(this.dataDir, path);
      if (!lstatSync(source).isFile()) throw new Error(`Arquivo de backup inválido: ${path}`);
      const data = readFileSync(source);
      total += data.length;
      if (data.length > MAX_FILE || total > MAX_TOTAL) throw new Error('Backup excede o limite de tamanho');
      return { path, sha256: hash(data), data: data.toString('base64') };
    });
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const file = this.path(id);
    atomic(file, gzipSync(JSON.stringify({ version: 1, createdAt, files } satisfies Archive)));
    return { id, createdAt, size: lstatSync(file).size, file };
  }
  list(): BackupInfo[] {
    if (!existsSync(this.backupDir)) return [];
    return readdirSync(this.backupDir).flatMap((name) => {
      const match = /^backup-([0-9a-f-]+)\.json\.gz$/i.exec(name);
      if (!match || !ID.test(match[1])) return [];
      const file = this.path(match[1]);
      const stat = lstatSync(file);
      return stat.isFile() ? [{ id: match[1], createdAt: stat.mtime.toISOString(), size: stat.size, file }] : [];
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  private read(id: string): Archive {
    const file = this.path(id);
    if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).size > MAX_TOTAL) throw new Error('Backup não encontrado ou muito grande');
    let archive: Archive;
    try { archive = JSON.parse(gunzipSync(readFileSync(file), { maxOutputLength: MAX_TOTAL * 2 }).toString('utf8')) as Archive; }
    catch { throw new Error('Backup corrompido'); }
    if (archive?.version !== 1 || !Array.isArray(archive.files) || typeof archive.createdAt !== 'string') throw new Error('Formato de backup inválido');
    const seen = new Set<string>();
    let total = 0;
    for (const entry of archive.files) {
      if (!entry || typeof entry.path !== 'string' || !allowed(entry.path) || seen.has(entry.path) ||
          typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256) || typeof entry.data !== 'string') throw new Error('Arquivo de backup inválido');
      seen.add(entry.path);
      const data = Buffer.from(entry.data, 'base64');
      total += data.length;
      if (data.length > MAX_FILE || total > MAX_TOTAL || hash(data) !== entry.sha256) throw new Error('Integridade do backup falhou');
      if (entry.path.endsWith('.json')) {
        try { JSON.parse(data.toString('utf8')); } catch { throw new Error(`JSON inválido no backup: ${entry.path}`); }
      }
    }
    return archive;
  }
  verify(id: string): { createdAt: string; files: string[] } {
    const archive = this.read(id);
    return { createdAt: archive.createdAt, files: archive.files.map((entry) => entry.path) };
  }
  stageRestore(id: string): void {
    this.read(id);
    atomic(this.pendingFile, JSON.stringify({ id, sha256: hash(readFileSync(this.path(id))) }));
  }
  status(): { backups: BackupInfo[]; pendingRestore?: string } {
    let pendingRestore: string | undefined;
    if (existsSync(this.pendingFile)) {
      try { pendingRestore = (JSON.parse(readFileSync(this.pendingFile, 'utf8')) as { id?: string }).id; } catch { /* boot will report invalid marker */ }
    }
    return { backups: this.list(), pendingRestore };
  }
  /** Must run before stores are loaded; a safety snapshot preserves pre-restore data. */
  applyPendingRestore(): boolean {
    if (!existsSync(this.pendingFile)) return false;
    const pending = JSON.parse(readFileSync(this.pendingFile, 'utf8')) as { id: string; sha256: string };
    if (!pending || !ID.test(pending.id) || hash(readFileSync(this.path(pending.id))) !== pending.sha256) throw new Error('Marcador de restauração inválido');
    const archive = this.read(pending.id);
    this.create();
    const archived = new Set(archive.files.map((entry) => entry.path));
    const obsolete = this.sourceFiles().filter((path) => !archived.has(path));
    for (const entry of archive.files) atomic(join(this.dataDir, entry.path), Buffer.from(entry.data, 'base64'));
    for (const path of obsolete) rmSync(join(this.dataDir, path));
    rmSync(this.pendingFile);
    return true;
  }
}
