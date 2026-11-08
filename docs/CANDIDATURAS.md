# Candidaturas no ProjetoHUB

O escritório guarda uma candidatura por vaga encontrada, usando o identificador e a URL da fonte. A criação não envia nada. Respostas digitadas devem corresponder a informações verdadeiras confirmadas pelo usuário; campos de senha, token e chave são recusados.

## Fluxo no painel

1. Em **Candidaturas**, prepare uma vaga registrada. Acione **Abrir vaga no navegador do escritório**, faça login manualmente, siga o link de candidatura e selecione a aba do formulário. O navegador usa um perfil dedicado e persistente.
2. Acione **Inspecionar campos e solicitar dados**. O serviço lê apenas rótulos e obrigatoriedade de controles visíveis; não extrai valores nem senhas. Para cada campo de texto obrigatório, com rótulo único e sem resposta salva, cria uma pergunta vinculada à candidatura e uma tarefa independente. Perguntas existentes não são duplicadas. Campos sem rótulo, de senha, arquivo, seleção ou caixa de confirmação aparecem para revisão manual.
3. Responda às perguntas pelo painel ou WhatsApp configurado. Cada resposta preenche somente o campo vinculado no rascunho; se o rascunho estava aprovado, a aprovação anterior é invalidada. Acione **Preencher respostas na aba**. O Playwright preenche somente campos com rótulo exato e único; o painel informa quais não foram encontrados. Revise todos os campos. Formulários em quadros internos, menus e uploads podem exigir intervenção manual.
4. Solicite aprovação e acione **Autorizar envio final**. Alterar respostas depois disso invalida a aprovação.
5. Informe o texto exato do botão de envio e da mensagem de confirmação esperada. O painel mostra o endereço da aba e pede confirmação antes do clique final.
6. O serviço grava `submitting` antes de clicar. Só muda para `submitted` quando a mensagem esperada aparece **depois** do clique. Salva o texto, o endereço sem parâmetros da URL, uma captura PNG local e seu hash. A captura pode ser aberta no painel.

Enquanto houver pergunta pendente vinculada à candidatura, o envio final é bloqueado na API e no painel, mesmo que o estado anterior ainda apareça como aprovado. Se a confirmação não aparecer, o estado será `submission_uncertain`. O sistema não repetirá o clique. Verifique o portal e, se a confirmação estiver presente, use **Verificar confirmação na aba**. Após queda do processo durante `submitting`, a recuperação também usa `submission_uncertain`. Uma candidatura `approved` ainda não foi enviada; `submitted` significa confirmação observada na página selecionada, não garantia de recebimento por e-mail ou de avaliação pela empresa.

O botão **Cancelar pergunta** encerra somente a tarefa daquele campo. A pergunta cancelada não será enviada posteriormente pelo comunicador. Revise e preencha manualmente o campo no portal antes de qualquer envio. Cancelar uma pergunta geral pausa sua tarefa, que pode ser retomada pelo controle de tarefas.

CAPTCHA, login, campos não acessíveis por rótulo e páginas fora do fluxo previsto pedem intervenção humana. A automação não burla verificações de segurança. Use somente sites que permitam essa forma de interação. A captura pode conter dados pessoais e fica em `<dataDir>/projecthub/application-evidence`; não a publique. A proteção em repouso no Windows ainda precisa de melhorias.

## Verificação realizada

O teste de integração `PROJECTHUB_E2E=1 npx vitest run server/hub/applications-playwright.integration.test.ts` abriu Edge real contra páginas **locais de teste**. Sem aprovação, a rota recusou o envio. Após aprovação, preencheu o campo por rótulo, clicou uma vez, verificou a confirmação e recuperou a captura PNG. Em uma segunda página sem confirmação, registrou o envio incerto e recusou repetição. Outra página verificou a inspeção de campos, a criação de perguntas, o bloqueio do envio com pergunta pendente e o preenchimento após resposta. **Nenhum portal externo foi usado e nenhuma candidatura real foi enviada.**
