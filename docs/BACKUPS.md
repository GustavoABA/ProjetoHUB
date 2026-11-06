# Backups do ProjetoHUB

O serviço guarda cópias em `<HABBLAUD_DATA_DIR>/projecthub/backups/`. Cria uma cópia na primeira abertura e outra quando a mais recente tiver pelo menos 24 horas. O painel **Agentes e tarefas → Backups locais** permite criar uma cópia imediatamente e agendar a restauração de uma cópia existente.

Cada arquivo compactado inclui uma lista de arquivos permitidos e o SHA-256 de cada conteúdo. O serviço confere tamanho, caminhos e hashes antes de aceitar a restauração. O conteúdo inclui agentes, tarefas, perguntas, vagas, roteador, candidaturas, perfil profissional, estado WhatsApp, sessão administrativa, registro de navegação e capturas que comprovam envios. Pode conter dados pessoais; mantenha o diretório local protegido e faça cópias externas apenas para destino confiável.

O perfil do navegador (cookies e logins), o hash da chave administrativa MCP, as configurações gerais herdadas do Habblaud e credenciais externas ficam fora. A restauração não recupera esses itens. No Windows, a proteção efetiva do diretório depende das permissões da conta e do disco; o modo `0600` dos arquivos é apenas uma proteção adicional onde o sistema de arquivos a respeita.

Para restaurar, escolha uma cópia no painel, confirme e **reinicie o serviço**. O serviço cria antes uma cópia de segurança do estado atual, aplica os arquivos do backup e elimina os arquivos de estado que não existiam nele. A restauração ocorre antes de carregar agentes e filas; processos já em execução não recebem um estado diferente no meio do trabalho. Se um backup estiver danificado, a validação impede seu agendamento. Se a gravação falhar durante a aplicação, o serviço não deve ser iniciado com dados parcialmente restaurados; a cópia de segurança permanece no diretório para recuperação manual.

Backups locais no mesmo disco não substituem cópias externas contra falha física. Ainda não há rotação, criptografia integrada nem restauração automática do perfil do navegador.
