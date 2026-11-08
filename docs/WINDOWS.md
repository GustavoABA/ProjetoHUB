# Inicialização no Windows

Execute `INICIAR-PROJETOHUB.cmd` na raiz do repositório. O inicializador requer Node.js 22.12 ou superior. Na primeira abertura, instala as dependências com `npm ci` e compila o programa. A partir daí, reaproveita a instalação e recompila quando o commit ou os arquivos de código mudam.

Ele procura Codex, Docker, ngrok e Ollama e informa quais estão disponíveis. Os serviços opcionais ausentes não impedem o escritório de abrir. O servidor principal inicia em segundo plano, com logs em `%LOCALAPPDATA%\ProjetoHUB\logs`. O launcher confere a API local do ProjetoHUB antes de iniciar outro processo e abre o escritório no Edge maximizado. Se Edge não estiver instalado, abre o navegador padrão. A porta padrão do escritório é 4747; `HABBLAUD_PORT` permite alterá-la. O MCP usa a porta 4748 por padrão, ajustável por `PROJECTHUB_MCP_PORT`.

Para abrir uma janela comum, execute `INICIAR-PROJETOHUB.cmd -Window`. Em **Agentes e tarefas → Configurações → Inicialização do Windows**, o botão **Iniciar com o Windows** cria um atalho na pasta Startup do usuário atual. O botão **Desligar inicialização automática** remove apenas o atalho desta instalação. Nenhuma alteração é feita em outras entradas de inicialização. Pela linha de comando, as mesmas operações são `INICIAR-PROJETOHUB.cmd -InstallAutoStart`, `-RemoveAutoStart` e `-AutoStartStatus`. A opção não é ativada automaticamente.

O servidor inicia o roteador, o MCP e a rotina de detecção do Ollama; o navegador Playwright abre quando necessário. O ngrok só cria um túnel quando sua instalação e configuração estiverem válidas e a chave MCP tiver sido gerada. Docker não é necessário para a instalação nativa. O launcher não instala Node, Edge, Codex, Docker, ngrok ou Ollama; mostra um diagnóstico quando um componente obrigatório falta.

Ainda falta controle de parada e reinício pelo painel, rotação dos logs e validação específica em Windows 10. Abrir o atalho de início automático no login do Windows ainda não foi testado neste computador.
