# Correção do cadastro por convite

Para o fluxo atual com confirmação obrigatória de e-mail, siga primeiro `CONFIRMACAO-EMAIL-INSTALACAO.md`. Este documento descreve a correção de reserva dos convites e seus erros.

O texto “Convite inválido, expirado ou já utilizado” era exibido tanto para um link realmente indisponível quanto para qualquer erro da função SQL `reservar_convite`. Por exemplo: função não instalada, coluna ausente ou falha de comunicação com o banco. A captura da tela, isoladamente, não permite distinguir esses casos.

## Aplicar no projeto publicado

1. No SQL Editor do mesmo projeto Supabase, execute `supabase-schema-correcao-convites.sql`. Este script instala/reinstala apenas a reserva atômica dos convites. Pode ser repetido e não altera o estado de links existentes. Requer os scripts de convites e cargos unificados; se faltar algum, informa qual instalar.
2. Em um terminal, na pasta `imperium-plataforma` deste pacote, com o Supabase CLI autenticado, execute:

```powershell
npx supabase link --project-ref abweepruixcyetrzefhk
npx supabase functions deploy completar-convite
```

O `supabase/config.toml` do pacote define `verify_jwt = false` para essa função: uma pessoa que ainda não tem conta precisa poder concluir o cadastro. A autorização continua sendo o token de convite, validado e consumido atomicamente no servidor; a função SQL só pode ser chamada pela `service_role`.

3. Atualize os arquivos públicos do site com o conteúdo deste pacote, especialmente `index.html`, `js/auth.js` e `sw.js`. Não publique os arquivos SQL, a pasta `supabase` ou os documentos internos na hospedagem do site.
4. Gere um convite novo na tela Usuários e teste o cadastro. Links usados, cancelados ou com mais de sete dias continuam inválidos; a correção não os reativa. Se a conta já estiver criada, entre pela tela de login em vez de repetir o cadastro.

## O que foi corrigido

- Falhas técnicas da reserva recebem uma mensagem específica, sem acusar uso/expiração do link.
- Os logs da Edge Function registram apenas o código da falha de reserva, sem e-mail, senha ou token.
- Um envio de cadastro em andamento não pode ser repetido pelo formulário.
- O navegador exige que o servidor confirme o envio do e-mail antes de mostrar a tela de confirmação pendente.
- Depois do envio, o link inicial é removido da URL. O acesso só é liberado após confirmar o e-mail e criar a senha.
- Erros de conexão restauram o botão e apresentam uma mensagem na tela.

## Validação e limites

Os testes locais usam a função e o formulário reais com respostas do Supabase simuladas. Verificam falha de instalação, convite indisponível, concorrência, aplicação do perfil, envio repetido, falhas no envio do e-mail e ativação após confirmação e criação da senha.

Não foi feita instalação no Supabase nem publicação na hospedagem. Atualizar apenas o ZIP ou os arquivos do site não instala a correção no servidor. Se o erro persistir depois dos passos acima, o código registrado nos logs de `completar-convite` ajuda a identificar a falha técnica.
