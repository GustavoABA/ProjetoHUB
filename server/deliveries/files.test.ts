import { describe, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { checkFile, DELIVERY_FILE_MAX_BYTES, fileType, insideKnownFolder, pathProblem } from './files';

describe('arquivos das entregas', () => {
  it('só tipos de ver e nada com cara de segredo', () => {
    expect(fileType('/a/b.PNG')).toEqual({ kind: 'image', type: 'image/png' });
    expect(fileType('/a/b.pdf')?.kind).toBe('pdf');
    expect(fileType('/a/b.json')).toBeUndefined();
    expect(pathProblem('/Users/a/p/relatorio.pdf')).toBeUndefined();
    expect(pathProblem('C:\\Users\\a\\p\\relatorio.pdf')).toBeUndefined();
    expect(pathProblem('C:\\Users\\a\\.ssh\\print.png')).toBeDefined();
    expect(pathProblem('C:\\Users\\a\\p\\..\\extrato.pdf')).toBeDefined();
    expect(pathProblem('\\\\servidor\\compartilhamento\\arquivo.pdf')).toBeDefined();
    for (const bad of ['/Users/a/.ssh/x.png', '/Users/a/p/.env.png', '/Users/a/p/secret-plan.pdf', '/Users/a/p/server.key', '/Users/a/.aws/c.txt', '/Users/a/.habblaud/remote-tls/ca.pdf', 'rel.png', '/a/../b.png', '/a/b.sh', '/a/id_ed25519']) {
      expect(pathProblem(bad), bad).toBeDefined();
    }
  });

  it('checkFile: confere o caminho real (link para segredo cai), tamanho e tipo', () => {
    const fs = (real: string, size = 10, file = true) => ({ realpath: () => real, stat: () => ({ isFile: () => file, size }) });
    expect(checkFile('/Users/a/p/x.png', fs('/Users/a/p/x.png'))).toEqual({ path: '/Users/a/p/x.png', size: 10 });
    expect(checkFile('/Users/a/p/x.png', fs('/Users/a/.ssh/x.png'))).toEqual({ error: 'arquivo protegido' });
    expect(checkFile('C:\\Users\\a\\p\\x.png', fs('C:\\Users\\a\\.ssh\\x.png'))).toEqual({ error: 'arquivo protegido' });
    expect(checkFile('/Users/a/p/x.png', fs('/Users/a/p/x.png', DELIVERY_FILE_MAX_BYTES + 1))).toHaveProperty('error');
    expect(checkFile('/Users/a/p/x.png', fs('/Users/a/p/x.png', 1, false))).toEqual({ error: 'não é um arquivo' });
    expect(checkFile('/nao/existe.png')).toEqual({ error: 'arquivo não encontrado' });
  });

  it('lê um anexo real com o formato nativo de caminho do sistema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'habblaud-entrega-'));
    try {
      const file = join(dir, 'relatorio.pdf');
      writeFileSync(file, 'PDF local');
      expect(checkFile(file)).toEqual({ path: realpathSync(file), size: 9 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('insideKnownFolder: só pastas de projeto que alguma conta conhece, as temporárias e os anexos', () => {
    const known = new Set(['/h/.claude/projects/-Users-ana-loja', '/h/.claude-2/projects/-Users-ana-x-y']);
    const opts = { accountDirs: ['/h/.claude', '/h/.claude-2'], roots: ['/tmp', '/h/.habblaud/attachments'], exists: (p: string) => known.has(p) };
    expect(insideKnownFolder('/Users/ana/loja/docs/print.png', opts)).toBe(true);
    expect(insideKnownFolder('/Users/ana/x-y/a.pdf', opts)).toBe(true);
    expect(insideKnownFolder('/tmp/claude/scratch/tela.png', opts)).toBe(true);
    expect(insideKnownFolder('/h/.habblaud/attachments/20261013-ab/foto.jpg', opts)).toBe(true);
    // Fora dos projetos: o resto da pasta pessoal, outra pasta de projeto que ninguém usou e o próprio "/Users".
    expect(insideKnownFolder('/Users/ana/Documents/extrato.pdf', opts)).toBe(false);
    expect(insideKnownFolder('/Users/ana/lojas/a.png', opts)).toBe(false);
    expect(insideKnownFolder('/tmpx/a.png', opts)).toBe(false);
  });

  it('confere pastas conhecidas com caminhos nativos do Windows', () => {
    const account = 'C:\\Users\\ana\\.claude';
    const known = new Set([win32.join(account, 'projects', 'C--Users-ana-loja')]);
    const opts = { accountDirs: [account], roots: ['C:\\Temp'], exists: (p: string) => known.has(p) };
    expect(insideKnownFolder('C:\\Users\\ana\\loja\\docs\\print.png', opts)).toBe(true);
    expect(insideKnownFolder('C:\\Temp\\captura.png', opts)).toBe(true);
    expect(insideKnownFolder('C:\\Users\\ana\\outro\\segredo.pdf', opts)).toBe(false);
    expect(insideKnownFolder('C:\\Temp\\..\\segredo.pdf', opts)).toBe(false);
  });
});
