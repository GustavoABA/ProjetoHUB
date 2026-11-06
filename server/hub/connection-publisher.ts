export type ConnectionMetadata = {
  installationId: string;
  mcpUrl: string | null;
  updatedAt: string;
  version: string;
  status: 'online' | 'offline';
  sessionStartedAt: string;
  sessionExpiresAt: string;
};

/** GitHub Contents API publisher. Never serializes credentials into repository content. */
export class ConnectionPublisher {
  private lastPublishAt: string | undefined;
  private lastCommit: string | undefined;
  private lastError: string | undefined;
  constructor(private readonly token: string | undefined, private readonly fetcher: typeof fetch = fetch,
    private readonly branch = 'main', private readonly repository = 'GustavoABA/ProjetoHUB') {
    if (!/^[\w.-]{1,100}$/.test(branch) || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Destino GitHub inválido');
  }
  status() { return { configured: Boolean(this.token), branch: this.branch, repository: this.repository,
    lastPublishAt: this.lastPublishAt, lastCommit: this.lastCommit, lastError: this.lastError }; }
  async publish(input: ConnectionMetadata): Promise<void> {
    if (!this.token) { this.lastError = 'GITHUB_TOKEN não configurado'; throw new Error(this.lastError); }
    if (input.status === 'online') {
      let url: URL;
      try { url = new URL(input.mcpUrl ?? ''); } catch { throw new Error('URL MCP pública inválida'); }
      if (url.protocol !== 'https:' || url.pathname !== '/mcp' || url.username || url.password || url.search || url.hash) throw new Error('URL MCP pública inválida');
    } else if (input.mcpUrl !== null) throw new Error('Conexão offline não pode publicar URL ativa');
    const metadata: ConnectionMetadata = { installationId: input.installationId, mcpUrl: input.mcpUrl,
      updatedAt: input.updatedAt, version: input.version, status: input.status,
      sessionStartedAt: input.sessionStartedAt, sessionExpiresAt: input.sessionExpiresAt };
    const endpoint = `https://api.github.com/repos/${this.repository}/contents/connection/current.json`;
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ProjetoHUB' };
    try {
      const prior = await this.fetcher(`${endpoint}?ref=${encodeURIComponent(this.branch)}`, { headers, signal: AbortSignal.timeout(10_000) });
      if (prior.status !== 404 && !prior.ok) throw new Error(`GitHub GET HTTP ${prior.status}`);
      const sha = prior.ok ? (await prior.json() as { sha?: string }).sha : undefined;
      if (prior.ok && (!sha || !/^[0-9a-f]{6,64}$/i.test(sha))) throw new Error('GitHub não retornou SHA do arquivo');
      const response = await this.fetcher(endpoint, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Update MCP connection status', branch: this.branch,
          content: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`).toString('base64'), ...(sha ? { sha } : {}) }),
        signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`GitHub PUT HTTP ${response.status}`);
      const result = await response.json() as { commit?: { sha?: string } };
      this.lastCommit = result.commit?.sha;
      this.lastPublishAt = new Date().toISOString(); this.lastError = undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Falha ao publicar conexão';
      throw error;
    }
  }
}
