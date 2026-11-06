# Candidaturas no ProjetoHUB

O escritório guarda uma candidatura por vaga encontrada, usando o identificador e a URL da fonte. A criação não envia nada. Respostas digitadas devem corresponder a informações verdadeiras confirmadas pelo usuário; campos de senha, token e chave são recusados.

## Fluxo no painel

1. Em **Candidaturas**, prepare uma vaga registrada e salve as respostas confirmadas. Use no nome de cada resposta o texto do rótulo visível no formulário do site.
2. Acione **Abrir vaga no navegador do escritório**. Faça login manualmente, siga o link de candidatura e selecione a aba do formulário. O navegador usa um perfil dedicado e persistente.
3. Acione **Preencher respostas na aba**. O Playwright preenche somente campos com rótulo exato e único; o painel informa quais não foram encontrados. Revise todos os campos. Formulários em quadros internos, menus e uploads podem exigir intervenção manual.
4. Solicite aprovação e acione **Autorizar envio final**. Alterar respostas depois disso invalida a aprovação.
5. Informe o texto exato do botão de envio e da mensagem de confirmação esperada. O painel mostra o endereço da aba e pede confirmação antes do clique final.
6. O serviço grava `submitting` antes de clicar. Só muda para `submitted` quando a mensagem esperada aparece **depois** do clique. Salva o texto, o endereço sem parâmetros da URL, uma captura PNG local e seu hash. A captura pode ser aberta no painel.

Se a confirmação não aparecer, o estado será `submission_uncertain`. O sistema não repetirá o clique. Verifique o portal e, se a confirmação estiver presente, use **Verificar confirmação na aba**. Após queda do processo durante `submitting`, a recuperação também usa `submission_uncertain`. Uma candidatura `approved` ainda não foi enviada; `submitted` significa confirmação observada na página selecionada, não garantia de recebimento por e-mail ou de avaliação pela empresa.

CAPTCHA, login, campos não acessíveis por rótulo e páginas fora do fluxo previsto pedem intervenção humana. A automação não burla verificações de segurança. Use somente sites que permitam essa forma de interação. A captura pode conter dados pessoais e fica em `<dataDir>/projecthub/application-evidence`; não a publique. A proteção em repouso no Windows ainda precisa de melhorias.

## Verificação realizada

O teste de integração `PROJECTHUB_E2E=1 npx vitest run server/hub/applications-playwright.integration.test.ts` abriu Edge real contra uma página **local de teste**. Sem aprovação, a rota recusou o envio. Após aprovação, preencheu o campo por rótulo, clicou uma vez, verificou a confirmação e recuperou a captura PNG. Em uma segunda página local sem confirmação, registrou o envio incerto e recusou repetição. **Nenhum portal externo foi usado e nenhuma candidatura real foi enviada.**
