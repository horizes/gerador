# Agenda presencial por período

Presencial reserva toda a manhã quando começa antes das 12h e toda a tarde quando começa a partir das 12h, sempre no fuso de Brasília. O horário e a duração reais continuam nos avisos, no painel e no arquivo de calendário. Online ocupa apenas sua duração normal.

O período precisa estar livre: reuniões online e reservas internas existentes impedem um novo presencial no mesmo período. Outros horários online livres continuam disponíveis. Um presencial já confirmado impede novas reservas dos dois formatos naquele período. Cancelar libera o período; cada perfil mantém sua própria agenda. A regra também é considerada ao calcular a disponibilidade de presenciais já existentes, preservando seus horários e dados.

## Atualização de uma instalação existente

1. No SQL Editor do projeto Supabase atual, execute `supabase-schema-agenda-periodos.sql`, depois da instalação da agenda por perfil. O script pode ser reaplicado e não altera os registros de reuniões.
2. Publique a pasta atual de `supabase/functions/agenda` na função `agenda`, mantendo o mesmo projeto e as variáveis atuais.
3. Envie os arquivos públicos atualizados para a pasta do subdomínio: `agenda.html`, `css/agenda-publica.css`, `js/agenda-publica.js`, `js/modules/agenda.js`, `index.html` e `sw.js`.

O pacote `imperium-agenda-periodos-atualizacao.zip` contém somente esses arquivos públicos. Não envie o SQL nem os arquivos da função para a pasta pública da Hostinger.

O rodapé da agenda pública mantém o texto da marca, sem a logo quadrada e sem o acesso à plataforma. A logo do topo é preservada.

## Validação

39 testes das regras da agenda e 9 testes do envio de e-mail cobrem conflitos simultâneos, cancelamento, isolamento entre perfis, reservas internas, transporte de mensagens e preservação do horário real nos avisos. A migração foi reaplicada em banco local sem alterar as reservas existentes. Os testes de Google e e-mail usam simulações.

## Correção do envio de confirmação

A agenda usa prioritariamente `RESEND_API_KEY` e `RESEND_FROM_EMAIL`, que já são usados pelas notificações da plataforma. Não é necessário copiar, revelar ou gerar outras credenciais. Instalações que usam somente SMTP continuam compatíveis.

O envio inclui a confirmação com a identidade Imperium, o link do Meet quando disponível e o arquivo de calendário. Cada trabalho tem uma chave de idempotência, e o anexo é estável para a mesma reunião. Uma resposta incerta pede conferência; não é tentado um segundo provedor automaticamente.

O status de uma confirmação anterior só muda após uma nova tentativa ser aceita. Use o botão de reenvio do painel para a reunião que precisa receber outra confirmação. Os testes desta atualização não enviam mensagens reais ao participante.
