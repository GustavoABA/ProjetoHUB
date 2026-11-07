# Evolution API e WhatsApp

No painel **Agentes e tarefas**, informe a URL da Evolution API e, no Windows, sua chave de API em **Conexão Evolution**. O endereço padrão é `http://127.0.0.1:8080`. A chave digitada é protegida pela conta do Windows antes de ser salva; o campo fica vazio após gravar e o valor não pode ser recuperado pela interface. O botão de remoção apaga a chave local. Se o servidor já receber `EVOLUTION_API_KEY` no ambiente, essa variável tem prioridade e a chave deve ser alterada fora do painel. Em Linux/Docker, use a variável de ambiente para a chave.

Os números principal e secundário podem ser informados mais tarde no mesmo painel, somente com DDI, DDD e dígitos. Nenhuma mensagem é enviada ao salvar a conexão ou os números. O diagnóstico é uma consulta de leitura e informa se a instância `procura-de-emprego` existe e qual estado foi informado pela Evolution.

Para ativar o recebimento, configure `PROJECTHUB_WHATSAPP_WEBHOOK_PORT` antes de iniciar o serviço, gere um token no painel e use apenas na instância `procura-de-emprego` o evento `MESSAGES_UPSERT`, a URL `/webhook/evolution` e o cabeçalho `X-ProjectHUB-Token`. Para Evolution em Docker, o listener pode precisar de `PROJECTHUB_WHATSAPP_WEBHOOK_BIND=0.0.0.0` e de uma regra de firewall restrita à rede local. O painel oferece um link para o Evolution Manager na URL configurada. Não altere webhooks globais ou instâncias existentes.

Uma pergunta enviada inclui um código `#...`. A resposta deve começar com esse código para ser vinculada à tarefa certa. A API aceita somente o remetente principal cadastrado. A resposta libera apenas a tarefa relacionada; as demais continuam. O estado “aceito pela Evolution” não comprova entrega no telefone.

O pareamento da nova instância, o envio real e a confirmação de entrega ainda não foram testados. O usuário optou por preencher os números no painel depois. A porta e o webhook ainda são configurados fora do painel; WebSocket da Evolution não está habilitado nesta instalação.
